import { describe, it, expect } from "vitest";
import {
  computeSimilarity,
  aggregateScore,
  strongestPaths,
  pathStrength,
  pathLength,
  HOP_DISTANCE,
  HUB_DAMPED,
  REPEATS,
  repeatWeight,
  reversePath,
  relWeight,
  REL_WEIGHTS,
  DEFAULT_REL_WEIGHT,
  REL_DISTANCES,
  relDistance,
  HOP_DAMPING,
  MAX_HOPS,
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

  it("stores each weight as an edge length, -ln(weight)", () => {
    expect(REL_DISTANCES.member_of).toBe(0);
    expect(REL_DISTANCES.produced_for).toBeCloseTo(-Math.log(0.5));
    expect(relDistance("totally_unknown")).toBeCloseTo(-Math.log(DEFAULT_REL_WEIGHT));
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

  it("scores bandmates through their band: 100 x 1.0 x 1.0 x 0.9", () => {
    const res = computeSimilarity(makeGraph(), "Charles Moothart", ["Ty Segall"]);
    const ty = res.pairs[0]!;
    expect(ty.score).toBe(90);
    expect(ty.path!.map((s) => s.to.name)).toEqual(["Fuzz", "Charles Moothart"]);
  });

  it("follows album credits too, but they're weak (Mikal only shares Album A with Ty)", () => {
    const ty = computeSimilarity(makeGraph(), "Mikal Cronin", ["Ty Segall"]).pairs[0]!;
    // instrument 0.35 x producer 0.4 x 0.9
    expect(ty.strength).toBeCloseTo(0.35 * 0.4 * HOP_DAMPING);
    expect(ty.score).toBe(13);
  });

  it("scores an unconnected artist (Osees) at zero", () => {
    const res = computeSimilarity(makeGraph(), "Osees", ["Ty Segall", "Charles Moothart"]);
    expect(res.overallScore).toBe(0);
    for (const p of res.pairs) {
      expect(p.distance).toBe(null);
      expect(p.path).toBe(null);
    }
  });

  it("ranks a band-tied target above an album-only-tied one", () => {
    const list = ["Ty Segall"];
    expect(computeSimilarity(makeGraph(), "Charles Moothart", list).overallScore).toBeGreaterThan(
      computeSimilarity(makeGraph(), "Mikal Cronin", list).overallScore
    );
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
  it("weighs below band membership and above producing", () => {
    expect(relWeight("opened_for")).toBeLessThan(relWeight("former_member_of"));
    expect(relWeight("opened_for")).toBeGreaterThan(relWeight("produced_for"));
  });

  it("connects an opener to the headliner it opened for", () => {
    const pair = computeSimilarity(makeConcertGraph(), "Iguana Death Cult", ["Flat Worms"]).pairs[0]!;
    expect(pair.path!.map((s) => s.relType)).toEqual(["opened_for"]);
    expect(pair.score).toBe(80);
  });

  it("connects two openers of the same headliner, two weak hops", () => {
    const pair = computeSimilarity(makeConcertGraph(), "Earth Tongue", ["Flat Worms"]).pairs[0]!;
    expect(pair.path!.map((s) => s.to.name)).toEqual(["Osees", "Earth Tongue"]);
    expect(pair.strength).toBeCloseTo(0.8 * 0.8 * HOP_DAMPING);
  });

  it("is only as strong as every hop together: member x opened_for", () => {
    const pair = computeSimilarity(makeConcertGraph(), "John Dwyer", ["Flat Worms"]).pairs[0]!;
    expect(pair.strength).toBeCloseTo(1.0 * 0.8 * HOP_DAMPING);
  });
});

describe("collaborations (credits on another artist's records)", () => {
  it("weigh below membership; producing weighs least", () => {
    expect(relWeight("collaborated_with")).toBeLessThan(relWeight("former_member_of"));
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

  it("scores 100 x the path's strength", () => {
    const pair = computeSimilarity(makeGraph(), "GOGGS", ["Charles Moothart"]).pairs[0]!;
    expect(pair.strength).toBeCloseTo(pathStrength(pair.path!));
    expect(pair.score).toBe(Math.round(pair.strength! * 100));
    expect(pair.score).toBe(81); // member x3, two extra hops: 0.9^2
  });

  it("is empty for the same artist and null when unreachable", () => {
    expect(computeSimilarity(makeGraph(), "Ty Segall", ["Ty Segall"]).pairs[0]!.path).toEqual([]);
    expect(computeSimilarity(makeGraph(), "Osees", ["Ty Segall"]).pairs[0]!.path).toBeNull();
  });

  it("reverses a path hop by hop, flipping each direction", () => {
    const g = makeGraph();
    const ty = g.findNodeByName("Ty Segall")!;
    const path = strongestPaths(g, ty, new Set(["cfm"])).get("cfm")!;
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

describe("strongest paths", () => {
  /** A short weak route (A -produced_for- B) and a longer strong one (A -member- X -member- Y -member- B). */
  function routes(): GraphAccess {
    const n = (id: string): SimNode => ({ id, name: id.toUpperCase(), type: "group" });
    const edges: Array<[string, string, string]> = [
      ["a", "b", "produced_for"],
      ["a", "x", "member_of"],
      ["x", "y", "member_of"],
      ["y", "b", "member_of"],
    ];
    return {
      findNodeByName: (name) => (["a", "b", "x", "y"].includes(name.toLowerCase()) ? n(name.toLowerCase()) : null),
      neighbors(id) {
        const out: SimNeighbor[] = [];
        for (const [s, t, rel] of edges) {
          if (s === id) out.push({ node: n(t), relType: rel, outgoing: true });
          if (t === id) out.push({ node: n(s), relType: rel, outgoing: false });
        }
        return out;
      },
    };
  }

  it("prefers a longer path of strong ties over a short weak one", () => {
    const pair = computeSimilarity(routes(), "A", ["B"]).pairs[0]!;
    expect(pair.distance).toBe(3);
    expect(pair.score).toBe(81); // 1 x 1 x 1 x 0.9^2, beats produced_for's 50
  });

  it("damps every hop after the first by HOP_DAMPING", () => {
    const blank = { id: "", name: "", type: "" };
    const step = (relType: string) => ({ from: blank, to: blank, relType, weight: relWeight(relType) });
    expect(pathStrength([])).toBe(1);
    expect(pathStrength([step("produced_for")])).toBeCloseTo(0.5);
    expect(pathStrength([step("member_of"), step("member_of"), step("produced_for")])).toBeCloseTo(0.5 * HOP_DAMPING ** 2);
    expect(pathLength([step("member_of"), step("produced_for")])).toBeCloseTo(-Math.log(0.5) + HOP_DISTANCE);
  });

  it("doesn't follow paths past MAX_HOPS", () => {
    const chain = Array.from({ length: MAX_HOPS + 2 }, (_, i) => `n${i}`);
    const node = (id: string): SimNode => ({ id, name: id, type: "group" });
    const g: GraphAccess = {
      findNodeByName: (name) => (chain.includes(name) ? node(name) : null),
      neighbors(id) {
        const i = chain.indexOf(id);
        return [chain[i - 1], chain[i + 1]].filter((x): x is string => !!x).map((x) => ({ node: node(x), relType: "member_of" }));
      },
    };
    const res = computeSimilarity(g, "n0", [chain[MAX_HOPS]!, chain[MAX_HOPS + 1]!]);
    expect(res.pairs.find((p) => p.name === chain[MAX_HOPS])!.distance).toBe(MAX_HOPS);
    expect(res.pairs.find((p) => p.name === chain[MAX_HOPS + 1])!.path).toBeNull();
  });

  it("carries each hop's weight", () => {
    const path = computeSimilarity(makeConcertGraph(), "John Dwyer", ["Flat Worms"]).pairs[0]!.path!;
    expect(path.map((s) => s.weight)).toEqual([REL_WEIGHTS.opened_for, REL_WEIGHTS.member_of]);
    expect(reversePath(reversePath(path))).toEqual(path);
  });

});

describe("hub damping", () => {
  /**
   * Fan played on a Star's records and on an Indie band's. Star has 140 collaborators
   * (10x the typical 14); Indie has 3. Opener opened for Star (never damped).
   */
  function hubGraph(withDegree = true): GraphAccess {
    const n = (id: string): SimNode => ({ id, name: id, type: "group" });
    const edges: Array<[string, string, string]> = [
      ["Fan", "Star", "collaborated_with"],
      ["Fan", "Indie", "collaborated_with"],
      ["Opener", "Star", "opened_for"],
      ["Member", "Star", "member_of"],
    ];
    const degrees: Record<string, number> = { "Star|collaborated_with": 140, "Fan|collaborated_with": 2, "Indie|collaborated_with": 3 };
    return {
      findNodeByName: (name) => n(name),
      neighbors(id) {
        const out: SimNeighbor[] = [];
        for (const [s, t, rel] of edges) {
          if (s === id) out.push({ node: n(t), relType: rel, outgoing: true });
          if (t === id) out.push({ node: n(s), relType: rel, outgoing: false });
        }
        return out;
      },
      ...(withDegree ? { degree: (id: string, rel: string) => degrees[`${id}|${rel}`] ?? 1 } : {}),
    };
  }

  it("weakens a collaboration with an artist who has many collaborators", () => {
    const g = hubGraph();
    const star = computeSimilarity(g, "Fan", ["Star"]).pairs[0]!;
    const indie = computeSimilarity(g, "Fan", ["Indie"]).pairs[0]!;
    expect(indie.score).toBe(80);
    expect(star.score).toBe(8); // 0.8 x 14/140
    const step = star.path![0]!;
    expect(step).toMatchObject({ baseWeight: 0.8, hubs: [{ node: { id: "Star" }, count: 140 }] });
    expect(step.weight).toBeCloseTo(0.08);
    expect(pathStrength(star.path!)).toBeCloseTo(0.08);
  });

  it("never damps memberships or opened_for", () => {
    expect(Object.keys(HUB_DAMPED)).not.toContain("member_of");
    expect(Object.keys(HUB_DAMPED)).not.toContain("former_member_of");
    expect(Object.keys(HUB_DAMPED)).not.toContain("opened_for");
    const g = hubGraph();
    expect(computeSimilarity(g, "Opener", ["Star"]).pairs[0]!.score).toBe(80);
    expect(computeSimilarity(g, "Member", ["Star"]).pairs[0]!.score).toBe(100);
  });

  it("doesn't damp when the graph can't count links", () => {
    expect(computeSimilarity(hubGraph(false), "Fan", ["Star"]).pairs[0]!.score).toBe(80);
  });
});

describe("repeats (song credits, shows)", () => {
  it("makes a frequent collaborator closer than a one-time one", () => {
    expect(repeatWeight("collaborated_with", 1)).toBe(0.8);
    expect(repeatWeight("collaborated_with")).toBe(0.8); // unknown count = once
    expect(repeatWeight("collaborated_with", 2)).toBeCloseTo(0.84);
    expect(repeatWeight("collaborated_with", 3)).toBeCloseTo(0.872);
    expect(repeatWeight("collaborated_with", 10)).toBeCloseTo(1 - 0.2 * 0.8 ** 9);
    expect(repeatWeight("produced_for", 3)).toBeCloseTo(1 - 0.5 * 0.8 ** 2);
    expect(repeatWeight("collaborated_with", 50)).toBeLessThanOrEqual(1);
  });

  it("treats opening twice like opening 400 times, and once as already close", () => {
    expect(repeatWeight("opened_for", 1)).toBe(0.8);
    expect(repeatWeight("opened_for", 2)).toBe(0.9);
    expect(repeatWeight("opened_for", 400)).toBe(0.9);
    expect("repeated" in REPEATS.opened_for!).toBe(true);
  });

  it("leaves memberships alone", () => {
    expect(repeatWeight("member_of", 5)).toBe(1);
    expect(repeatWeight("former_member_of", 5)).toBe(0.85);
  });

  it("scores a pair with the repeat-adjusted weight, before hub damping", () => {
    const n = (id: string): SimNode => ({ id, name: id, type: "group" });
    const edges: Array<[string, string, string, number]> = [
      ["Session", "Band", "collaborated_with", 10],
      ["Guest", "Band", "collaborated_with", 1],
      ["Opener", "Headliner", "opened_for", 3],
    ];
    const g: GraphAccess = {
      findNodeByName: (name) => n(name),
      neighbors(id) {
        const out: SimNeighbor[] = [];
        for (const [s, t, rel, count] of edges) {
          if (s === id) out.push({ node: n(t), relType: rel, outgoing: true, count });
          if (t === id) out.push({ node: n(s), relType: rel, outgoing: false, count });
        }
        return out;
      },
    };
    const session = computeSimilarity(g, "Session", ["Band"]).pairs[0]!;
    const guest = computeSimilarity(g, "Guest", ["Band"]).pairs[0]!;
    expect(session.score).toBe(97);
    expect(guest.score).toBe(80);
    expect(session.path![0]).toMatchObject({ count: 10 });
    expect(session.path![0]!.baseWeight).toBeCloseTo(repeatWeight("collaborated_with", 10));
    expect(computeSimilarity(g, "Opener", ["Headliner"]).pairs[0]!.score).toBe(90);
  });
});
