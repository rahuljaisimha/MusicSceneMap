import { describe, it, expect } from "vitest";
import {
  computeSimilarity,
  aggregateScore,
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
        if (s === nodeId) out.push({ node: nodes[t]!, relType: rel });
        if (t === nodeId) out.push({ node: nodes[s]!, relType: rel });
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

  it("weights the best connection above the plain average", () => {
    // best=80, avg=50 -> 0.6*80 + 0.4*50 = 68
    expect(aggregateScore([mk("a", 80), mk("b", 20)])).toBe(68);
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
        if (s === nodeId) out.push({ node: nodes[t]!, relType: rel });
        if (t === nodeId) out.push({ node: nodes[s]!, relType: rel });
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
