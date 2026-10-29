import { describe, it, expect, beforeEach, vi } from "vitest";
import { TieredGraphAccess } from "../pages/tieredGraphAccess";
import type { GraphAccess, SimNode, SimNeighbor } from "../pages/similarity";

/** Fake core graph containing only Ty Segall + Fuzz. */
function makeCore(): GraphAccess {
  const nodes: Record<string, SimNode> = {
    ty: { id: "ty", name: "Ty Segall", type: "person" },
    fuzz: { id: "fuzz", name: "Fuzz", type: "group" },
  };
  const edges: Array<[string, string, string]> = [["ty", "fuzz", "member_of"]];
  return {
    findNodeByName(name) {
      return Object.values(nodes).find((n) => n.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    findNodeById(id) {
      return nodes[id] ?? null;
    },
    neighbors(id): SimNeighbor[] {
      const out: SimNeighbor[] = [];
      for (const [s, t, rel] of edges) {
        if (s === id) out.push({ node: nodes[t]!, relType: rel });
        if (t === id) out.push({ node: nodes[s]!, relType: rel });
      }
      return out;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("TieredGraphAccess", () => {
  it("uses the core graph and does not call Tier 2/3 for in-core artists", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists(["Ty Segall"]);
    expect(tiers.get("Ty Segall")).toBe("core");
    expect(pg).not.toHaveBeenCalled();
    expect(mb).not.toHaveBeenCalled();

    expect(tiered.build().findNodeByName("Ty Segall")?.id).toBe("ty");
  });

  it("falls back to Postgres for out-of-core artists", async () => {
    const pg = vi.fn().mockResolvedValue({
      node: { id: "sleeves", name: "The Sleeves", type: "group" },
      neighbors: [{ node: { id: "x", name: "Someone", type: "person" }, relType: "member_of" }],
    });
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists(["The Sleeves"]);
    expect(tiers.get("The Sleeves")).toBe("postgres");
    expect(pg).toHaveBeenCalledTimes(1);
    expect(mb).not.toHaveBeenCalled();

    const g = tiered.build();
    expect(g.findNodeByName("The Sleeves")?.id).toBe("sleeves");
    expect(g.neighbors("sleeves")).toHaveLength(1);
  });

  it("falls back to MusicBrainz when Postgres misses", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue({
      node: { id: "mbid1", name: "Obscure Band", type: "group" },
      neighbors: [],
    });
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists(["Obscure Band"]);
    expect(tiers.get("Obscure Band")).toBe("musicbrainz");
    expect(pg).toHaveBeenCalledTimes(1);
    expect(mb).toHaveBeenCalledTimes(1);
    expect(tiered.build().findNodeByName("Obscure Band")?.id).toBe("mbid1");
  });

  it("records a miss when all tiers fail", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists(["Nobody"]);
    expect(tiers.get("Nobody")).toBe("miss");
    expect(tiered.build().findNodeByName("Nobody")).toBe(null);
  });

  it("continues past a Postgres error and tries MusicBrainz", async () => {
    const pg = vi.fn().mockRejectedValue(new Error("500"));
    const mb = vi.fn().mockResolvedValue({
      node: { id: "mbid2", name: "Fallback Act", type: "group" },
      neighbors: [],
    });
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists(["Fallback Act"]);
    expect(tiers.get("Fallback Act")).toBe("musicbrainz");
  });

  it("caches Tier-2 results (second prepare does not refetch)", async () => {
    const pg = vi.fn().mockResolvedValue({
      node: { id: "c1", name: "Cached Band", type: "group" },
      neighbors: [],
    });
    const mb = vi.fn().mockResolvedValue(null);

    const first = new TieredGraphAccess(makeCore(), pg, mb);
    await first.prepareArtists(["Cached Band"]);
    expect(pg).toHaveBeenCalledTimes(1);

    // New instance shares the localStorage cache.
    const second = new TieredGraphAccess(makeCore(), pg, mb);
    await second.prepareArtists(["Cached Band"]);
    expect(pg).toHaveBeenCalledTimes(1); // not called again
    expect(second.build().findNodeByName("Cached Band")?.id).toBe("c1");
  });

  it("resolves the same out-of-core artist only once per session", async () => {
    const pg = vi.fn().mockResolvedValue({
      node: { id: "d1", name: "Dup Band", type: "group" },
      neighbors: [],
    });
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    await tiered.prepareArtists(["Dup Band", "Dup Band"]);
    expect(pg).toHaveBeenCalledTimes(1);
  });
});

describe("TieredGraphAccess holding MusicBrainz back", () => {
  it("stops at Postgres, then asks only MusicBrainz later", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue({ node: { id: "mbid1", name: "Obscure Band", type: "group" }, neighbors: [] });
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const now = await tiered.prepareArtists(["Obscure Band"], { musicBrainz: false });
    expect(now.get("Obscure Band")).toBe("miss");
    expect(mb).not.toHaveBeenCalled();
    expect(tiered.build().findNodeByName("Obscure Band")).toBe(null);
    // Asked again without MusicBrainz: no new request
    await tiered.prepareArtists(["Obscure Band"], { musicBrainz: false });
    expect(pg).toHaveBeenCalledTimes(1);

    const later = await tiered.prepareArtists(["Obscure Band"]);
    expect(later.get("Obscure Band")).toBe("musicbrainz");
    expect(pg).toHaveBeenCalledTimes(1);
    expect(mb).toHaveBeenCalledTimes(1);
    expect(tiered.build().findNodeByName("Obscure Band")?.id).toBe("mbid1");
  });

  it("still uses Postgres when it has the artist", async () => {
    const pg = vi.fn().mockResolvedValue({ node: { id: "s", name: "The Sleeves", type: "group" }, neighbors: [] });
    const mb = vi.fn();
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);
    expect((await tiered.prepareArtists(["The Sleeves"], { musicBrainz: false })).get("The Sleeves")).toBe("postgres");
    expect(mb).not.toHaveBeenCalled();
  });
});

describe("TieredGraphAccess with picked artists (MusicBrainz IDs)", () => {
  it("uses the core graph when it has the ID", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);
    const tiers = await tiered.prepareArtists([{ name: "Fuzz", id: "fuzz" }]);
    expect(tiers.get("fuzz")).toBe("core");
    expect(pg).not.toHaveBeenCalled();
    expect(tiered.build().findNodeById?.("fuzz")?.name).toBe("Fuzz");
  });

  it("fetches an out-of-core pick by its ID, even when the core has another artist with its name", async () => {
    const other = { id: "fuzz-band", name: "Fuzz", type: "group" };
    const pg = vi.fn().mockResolvedValue({
      node: other,
      neighbors: [{ node: { id: "ty", name: "Ty Segall", type: "person" }, relType: "member_of" }],
    });
    const mb = vi.fn().mockResolvedValue(null);
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);

    const tiers = await tiered.prepareArtists([{ name: "Fuzz", id: "fuzz-band" }]);
    expect(tiers.get("fuzz-band")).toBe("postgres");
    expect(pg).toHaveBeenCalledWith({ name: "Fuzz", id: "fuzz-band" });

    const g = tiered.build();
    expect(g.findNodeById?.("fuzz-band")).toEqual(other);
    expect(g.findNodeByName("Fuzz")?.id).toBe("fuzz"); // a typed name still means the core's Fuzz
  });

  it("passes the ID to MusicBrainz when Postgres doesn't have the pick", async () => {
    const pg = vi.fn().mockResolvedValue(null);
    const mb = vi.fn().mockResolvedValue({ node: { id: "mb-1", name: "Rare Act", type: "group" }, neighbors: [] });
    const tiered = new TieredGraphAccess(makeCore(), pg, mb);
    const tiers = await tiered.prepareArtists([{ name: "Rare Act", id: "mb-1" }, { name: "Rare Act", id: "mb-1" }]);
    expect(tiers.get("mb-1")).toBe("musicbrainz");
    expect(mb).toHaveBeenCalledTimes(1);
    expect(mb).toHaveBeenCalledWith({ name: "Rare Act", id: "mb-1" });
  });
});

describe("TieredGraphAccess link counts (hub damping)", () => {
  it("counts an out-of-core artist's links from what Postgres returned", async () => {
    const pg = vi.fn().mockResolvedValue({
      node: { id: "star", name: "Star", type: "person" },
      neighbors: [
        { node: { id: "a", name: "A", type: "person" }, relType: "collaborated_with" },
        { node: { id: "b", name: "B", type: "person" }, relType: "collaborated_with" },
        { node: { id: "c", name: "C", type: "group" }, relType: "member_of" },
      ],
    });
    const core: GraphAccess = { ...makeCore(), degree: (id, rel) => (id === "ty" && rel === "collaborated_with" ? 5 : 0) };
    const tiered = new TieredGraphAccess(core, pg, vi.fn().mockResolvedValue(null));
    await tiered.prepareArtists(["Star"]);
    const g = tiered.build();
    expect(g.degree?.("star", "collaborated_with")).toBe(2);
    expect(g.degree?.("ty", "collaborated_with")).toBe(5); // core count
    expect(g.degree?.("a", "collaborated_with")).toBeUndefined(); // only seen as a neighbour
  });
});
