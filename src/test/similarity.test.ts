import { describe, it, expect } from "vitest";
import {
  computeSimilarity,
  aggregateScore,
  distanceFactor,
  findPath,
  reversePath,
  relWeight,
  albumCreditWeight,
  REL_WEIGHTS,
  DEFAULT_REL_WEIGHT,
  type GraphAccess,
  type SimNode,
  type SimNeighbor,
  type PairScore,
} from "../pages/similarity";

/**
 * In-memory fake graph for testing the scorer without sql.js.
 *
 * Model a small garage-psych slice with band ties AND album credits:
 *   Ty Segall  --member_of--> Fuzz <--member_of-- Charles Moothart
 *   Ty Segall  --member_of--> GOGGS
 *   Charles Moothart --former_member_of--> CFM
 *   Ty Segall  --producer--> AlbumA <--instrument-- Mikal Cronin
 *   Charles Moothart --recording--> AlbumA   (so Ty & Charles share AlbumA)
 *   Osees (isolated)
 */
function makeGraph(): GraphAccess {
  const nodes: Record<string, SimNode> = {
    ty: { id: "ty", name: "Ty Segall", type: "person" },
    charles: { id: "charles", name: "Charles Moothart", type: "person" },
    mikal: { id: "mikal", name: "Mikal Cronin", type: "person" },
    fuzz: { id: "fuzz", name: "Fuzz", type: "group" },
    goggs: { id: "goggs", name: "GOGGS", type: "group" },
    cfm: { id: "cfm", name: "CFM", type: "group" },
    osees: { id: "osees", name: "Osees", type: "group" },
    albumA: { id: "albumA", name: "Album A", type: "album" },
  };

  // Directed edges (source -> target, relType). neighbors() returns both dirs.
  const edges: Array<[string, string, string]> = [
    ["ty", "fuzz", "member_of"],
    ["charles", "fuzz", "member_of"],
    ["ty", "goggs", "member_of"],
    ["charles", "cfm", "former_member_of"],
    ["ty", "albumA", "producer"],
    ["mikal", "albumA", "instrument"],
    ["charles", "albumA", "recording"],
  ];

  return {
    findNodeByName(name: string): SimNode | null {
      return Object.values(nodes).find((n) => n.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    neighbors(nodeId: string): SimNeighbor[] {
      const out: SimNeighbor[] = [];
      for (const [s, t, rel] of edges) {
        if (s === nodeId) out.push({ node: nodes[t]!, relType: rel, outgoing: true });
        if (t === nodeId) out.push({ node: nodes[s]!, relType: rel, outgoing: false });
      }
      return out;
    },
  };
}

describe("relWeight", () => {
  it("ranks member_of > former_member_of > support_musician", () => {
    expect(REL_WEIGHTS.member_of).toBeGreaterThan(REL_WEIGHTS.former_member_of!);
    expect(REL_WEIGHTS.former_member_of).toBeGreaterThan(REL_WEIGHTS.support_musician!);
  });

  it("ranks band ties above album-credit ties", () => {
    expect(relWeight("support_musician")).toBeGreaterThan(relWeight("producer"));
  });

  it("falls back to the default weight for unknown types", () => {
    expect(relWeight("totally_unknown")).toBe(DEFAULT_REL_WEIGHT);
  });
});

describe("albumCreditWeight", () => {
  it("is zero with no shared credits and increases with count", () => {
    expect(albumCreditWeight(0)).toBe(0);
    expect(albumCreditWeight(2)).toBeGreaterThan(albumCreditWeight(1));
    expect(albumCreditWeight(5)).toBeGreaterThan(albumCreditWeight(2));
  });

  it("saturates below the max", () => {
    expect(albumCreditWeight(1000)).toBeLessThan(0.71);
    expect(albumCreditWeight(1000)).toBeGreaterThan(0.65);
  });
});

describe("computeSimilarity", () => {
  it("returns targetFound=false for an unknown artist", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Nonexistent Band", ["Ty Segall"]);
    expect(res.targetFound).toBe(false);
    expect(res.overallScore).toBe(0);
  });

  it("scores an identical target as 100", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Ty Segall", ["Ty Segall"]);
    expect(res.pairs[0]!.score).toBe(100);
  });

  it("finds a shared bandmate connection (Fuzz) between Charles and Ty", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Charles Moothart", ["Ty Segall"]);
    const tyPair = res.pairs.find((p) => p.name === "Ty Segall")!;
    expect(tyPair.found).toBe(true);
    // They share Fuzz (a group) and Album A (album credit).
    const via = tyPair.connections.map((c) => c.via);
    expect(via).toContain("Fuzz");
    expect(tyPair.connections.some((c) => c.kind === "album")).toBe(true);
    expect(res.overallScore).toBeGreaterThan(40);
  });

  it("uses album credits as a connection even without band ties (Mikal)", () => {
    const g = makeGraph();
    // Mikal only connects to Ty via Album A (both have credits on it).
    const res = computeSimilarity(g, "Mikal Cronin", ["Ty Segall"]);
    const tyPair = res.pairs.find((p) => p.name === "Ty Segall")!;
    expect(tyPair.found).toBe(true);
    expect(tyPair.connections.some((c) => c.kind === "album")).toBe(true);
    expect(tyPair.score).toBeGreaterThan(0);
  });

  it("scores an unconnected artist (Osees) at zero", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Osees", ["Ty Segall", "Charles Moothart"]);
    expect(res.overallScore).toBe(0);
    for (const p of res.pairs) {
      expect(p.distance).toBe(null);
      expect(p.connections.length).toBe(0);
    }
  });

  it("ranks a band-tied target above an album-only-tied one", () => {
    const g = makeGraph();
    const list = ["Ty Segall"];
    const charles = computeSimilarity(g, "Charles Moothart", list); // shares Fuzz (member) + album
    const mikal = computeSimilarity(g, "Mikal Cronin", list); // shares album only
    expect(charles.overallScore).toBeGreaterThan(mikal.overallScore);
  });

  it("marks list artists that aren't in the graph as not found", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Ty Segall", ["Charles Moothart", "Unknown Artist"]);
    const unknown = res.pairs.find((p) => p.name === "Unknown Artist")!;
    expect(unknown.found).toBe(false);
    expect(unknown.score).toBe(0);
  });

  it("sorts the breakdown strongest-first", () => {
    const g = makeGraph();
    const res = computeSimilarity(g, "Charles Moothart", ["Osees", "Ty Segall"]);
    expect(res.pairs[0]!.name).toBe("Ty Segall");
    expect(res.pairs[res.pairs.length - 1]!.name).toBe("Osees");
  });
});

describe("aggregateScore", () => {
  const mk = (name: string, score: number, found = true): PairScore => ({
    name,
    found,
    distance: found ? 1 : null,
    connections: [],
    score,
  });

  it("returns 0 when no pairs were found", () => {
    expect(aggregateScore([mk("a", 0, false), mk("b", 0, false)])).toBe(0);
  });

  it("is the best match when the others match weakly: they don't pull it down", () => {
    // Iguana Death Cult: Tim Hellman 77, Fuzz 18 -> 77 (was 65 with best/average)
    expect(aggregateScore([mk("a", 77), mk("b", 18)])).toBe(77);
    expect(aggregateScore([mk("a", 80), mk("b", 59)])).toBe(80);
  });

  it("adds a diminishing bonus for each other good match", () => {
    expect(aggregateScore([mk("a", 77), mk("b", 60)])).toBe(92); // 77 + 0.25*60
    expect(aggregateScore([mk("a", 70), mk("b", 60), mk("c", 60)])).toBe(93); // 70 + 15 + 7.5
    expect(aggregateScore([mk("c", 60), mk("a", 70), mk("b", 10), mk("d", 60)])).toBe(93); // order doesn't matter
    expect(aggregateScore([mk("a", 50), mk("b", 40), mk("c", 40)])).toBe(50); // under 60: no bonus
  });

  it("caps at 100", () => {
    expect(aggregateScore([mk("a", 95), mk("b", 90), mk("c", 90)])).toBe(100);
  });

  it("never drops when an artist is added to the list", () => {
    const base = [mk("a", 70), mk("b", 65)];
    for (const extra of [0, 20, 59, 60, 80]) {
      expect(aggregateScore([...base, mk("x", extra)])).toBeGreaterThanOrEqual(aggregateScore(base));
    }
  });

  it("ignores not-found pairs in the aggregate", () => {
    expect(aggregateScore([mk("a", 60), mk("b", 0, false)])).toBe(60);
  });
});

/**
 * Concert ties from concert-database ("opened_for", opener -> headliner):
 *   Flat Worms --opened_for--> Iguana Death Cult
 *   Flat Worms --opened_for--> Osees <--member_of-- John Dwyer
 *   Earth Tongue --opened_for--> Osees
 */
function makeConcertGraph(): GraphAccess {
  const nodes: Record<string, SimNode> = {
    fw: { id: "fw", name: "Flat Worms", type: "group" },
    idc: { id: "idc", name: "Iguana Death Cult", type: "group" },
    osees: { id: "osees", name: "Osees", type: "group" },
    dwyer: { id: "dwyer", name: "John Dwyer", type: "person" },
    et: { id: "et", name: "Earth Tongue", type: "group" },
  };
  const edges: Array<[string, string, string]> = [
    ["fw", "idc", "opened_for"],
    ["fw", "osees", "opened_for"],
    ["dwyer", "osees", "member_of"],
    ["et", "osees", "opened_for"],
  ];
  return {
    findNodeByName: (name) => Object.values(nodes).find((n) => n.name === name) ?? null,
    neighbors(nodeId) {
      const out: SimNeighbor[] = [];
      for (const [s, t, rel] of edges) {
        if (s === nodeId) out.push({ node: nodes[t]!, relType: rel, outgoing: true });
        if (t === nodeId) out.push({ node: nodes[s]!, relType: rel, outgoing: false });
      }
      return out;
    },
  };
}

describe("opened_for (concert ties)", () => {
  it("weighs below band membership and above a single album credit", () => {
    expect(relWeight("opened_for")).toBeLessThan(relWeight("support_musician"));
    expect(relWeight("opened_for")).toBeGreaterThan(relWeight("producer"));
  });

  it("connects an opener to the headliner it opened for", () => {
    const res = computeSimilarity(makeConcertGraph(), "Iguana Death Cult", ["Flat Worms"]);
    const pair = res.pairs[0]!;
    expect(pair.connections[0]).toMatchObject({ kind: "direct", relType: "opened_for" });
    expect(pair.score).toBeGreaterThan(0);
  });

  it("connects two openers of the same headliner, labelled by that tie", () => {
    const res = computeSimilarity(makeConcertGraph(), "Earth Tongue", ["Flat Worms"]);
    const shared = res.pairs[0]!.connections.find((c) => c.kind === "shared")!;
    expect(shared).toMatchObject({ via: "Osees", relType: "opened_for", weight: REL_WEIGHTS.opened_for });
  });

  it("labels a shared tie by the weaker of the two edges", () => {
    // John Dwyer is in Osees; Flat Worms opened for them: the tie is only as strong as opened_for.
    const res = computeSimilarity(makeConcertGraph(), "John Dwyer", ["Flat Worms"]);
    const shared = res.pairs[0]!.connections.find((c) => c.kind === "shared")!;
    expect(shared).toMatchObject({ via: "Osees", relType: "opened_for", weight: REL_WEIGHTS.opened_for });
  });
});

describe("collaborations (credits on another artist's records)", () => {
  it("weigh below band ties and at least as much as a single album credit", () => {
    expect(relWeight("collaborated_with")).toBeLessThan(relWeight("support_musician"));
    expect(relWeight("produced_for")).toBeLessThan(relWeight("collaborated_with"));
    expect(relWeight("produced_for")).toBeGreaterThan(relWeight("producer"));
  });
});

describe("the path behind a pair (shown in its bottom sheet)", () => {
  it("runs from the liked artist to the compared one, with each edge's direction", () => {
    // Liked: Charles Moothart; compared: GOGGS. Charles is in Fuzz, Ty is in Fuzz and GOGGS.
    const res = computeSimilarity(makeGraph(), "GOGGS", ["Charles Moothart"]);
    const pair = res.pairs[0]!;
    expect(pair.node?.name).toBe("Charles Moothart");
    expect(res.target?.name).toBe("GOGGS");
    expect(pair.distance).toBe(pair.path!.length);
    const steps = pair.path!.map((s) => [s.from.name, s.relType, s.to.name, s.fromIsSource]);
    expect(steps[0]![0]).toBe("Charles Moothart");
    // Every hop continues where the last one ended.
    pair.path!.forEach((s, i) => {
      if (i > 0) expect(s.from.id).toBe(pair.path![i - 1]!.to.id);
    });
    // The last hop is Ty Segall -> GOGGS, read the way the edge points.
    expect(steps[steps.length - 1]).toEqual(["Ty Segall", "member_of", "GOGGS", true]);
  });

  it("keeps the score's two parts", () => {
    const pair = computeSimilarity(makeGraph(), "Charles Moothart", ["Ty Segall"]).pairs[0]!;
    expect(pair.score).toBe(Math.round((0.7 * pair.strength! + 0.3 * pair.proximity!) * 100));
  });

  it("is empty for the same artist and null when unreachable", () => {
    expect(computeSimilarity(makeGraph(), "Ty Segall", ["Ty Segall"]).pairs[0]!.path).toEqual([]);
    expect(computeSimilarity(makeGraph(), "Osees", ["Ty Segall"]).pairs[0]!.path).toBeNull();
  });

  it("reverses a path hop by hop, flipping each direction", () => {
    const g = makeGraph();
    const ty = g.findNodeByName("Ty Segall")!;
    const path = findPath(g, ty, "cfm")!;
    expect(path.map((s) => s.to.name)).toEqual(["Fuzz", "Charles Moothart", "CFM"]);
    const back = reversePath(path);
    expect(back.map((s) => [s.from.name, s.to.name, s.fromIsSource])).toEqual([
      ["CFM", "Charles Moothart", false],
      ["Charles Moothart", "Fuzz", true],
      ["Fuzz", "Ty Segall", false],
    ]);
  });
});

describe("artists picked from the dropdown (by MusicBrainz ID)", () => {
  /** Two artists named Fuzz: the band Ty Segall is in, and an unrelated bassist listed first. */
  function twoFuzzes(): GraphAccess {
    const nodes: SimNode[] = [
      { id: "fuzz-bassist", name: "Fuzz", type: "person" },
      { id: "fuzz-band", name: "Fuzz", type: "group" },
      { id: "ty", name: "Ty Segall", type: "person" },
      { id: "disturbed", name: "Disturbed", type: "group" },
    ];
    const edges: Array<[string, string, string]> = [
      ["ty", "fuzz-band", "member_of"],
      ["fuzz-bassist", "disturbed", "former_member_of"],
    ];
    const byId = (id: string) => nodes.find((n) => n.id === id) ?? null;
    return {
      findNodeByName: (name) => nodes.find((n) => n.name.toLowerCase() === name.toLowerCase()) ?? null,
      findNodeById: byId,
      neighbors(id) {
        const out: SimNeighbor[] = [];
        for (const [s, t, rel] of edges) {
          if (s === id) out.push({ node: byId(t)!, relType: rel, outgoing: true });
          if (t === id) out.push({ node: byId(s)!, relType: rel, outgoing: false });
        }
        return out;
      },
    };
  }

  it("scores the picked artist, not the first one with its name", () => {
    const byName = computeSimilarity(twoFuzzes(), "Ty Segall", ["Fuzz"]).pairs[0]!;
    expect(byName.node?.id).toBe("fuzz-bassist");
    expect(byName.path).toBeNull();

    const picked = computeSimilarity(twoFuzzes(), "Ty Segall", [{ name: "Fuzz", id: "fuzz-band" }]).pairs[0]!;
    expect(picked.node?.id).toBe("fuzz-band");
    expect(picked.distance).toBe(1);
    expect(picked.score).toBe(100);
  });

  it("resolves a picked target by ID too", () => {
    const res = computeSimilarity(twoFuzzes(), { name: "Fuzz", id: "fuzz-band" }, ["Ty Segall"]);
    expect(res.target?.id).toBe("fuzz-band");
  });

  it("doesn't fall back to the name when the picked ID isn't in the graph", () => {
    const res = computeSimilarity(twoFuzzes(), "Ty Segall", [{ name: "Fuzz", id: "not-in-graph" }]);
    expect(res.pairs[0]).toMatchObject({ name: "Fuzz", found: false });
  });
});

describe("distanceFactor (closeness)", () => {
  it("counts 1 and 2 hops as fully close, then drops by 0.6 a hop", () => {
    expect([0, 1, 2].map(distanceFactor)).toEqual([1, 1, 1]);
    expect(distanceFactor(3)).toBeCloseTo(0.6);
    expect(distanceFactor(4)).toBeCloseTo(0.36);
    expect(distanceFactor(5)).toBeCloseTo(0.216);
    expect(distanceFactor(null)).toBe(0);
  });
});
