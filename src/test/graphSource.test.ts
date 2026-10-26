import { describe, it, expect, vi, beforeEach } from "vitest";

const { local, server } = vi.hoisted(() => {
  // The local graph: loaded, with Ty Segall only.
  const local = {
    loaded: true,
    nodes: [{ id: "ty", name: "Ty Segall", type: "person" }],
  };
  // The server: has Zach Bryan (not in the local graph).
  const server = vi.fn(async (params?: { mbid?: string; name?: string }) => {
    const zach = params?.mbid === "zach" || params?.name?.toLowerCase() === "zach bryan";
    return zach
      ? {
          found: true,
          artist: { id: "zach", name: "Zach Bryan", type: "person" },
          neighbors: [
            { node: { id: "bruce", name: "Bruce Springsteen", type: "person" }, relType: "collaborated_with", outgoing: false },
          ],
        }
      : { found: false, artist: null, neighbors: [] };
  });
  return { local, server };
});

vi.mock("../db/graphDb", () => ({
  isDbLoaded: () => local.loaded,
  findNodeById: (id: string) => local.nodes.find((n) => n.id === id) ?? null,
  findNodeByName: (name: string) => local.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase()) ?? null,
  searchNodes: (q: string) => local.nodes.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())),
  getNeighbors: (id: string) =>
    id === "ty" ? [{ node: { id: "fuzz", name: "Fuzz", type: "group" }, relType: "member_of", outgoing: true }] : [],
}));
vi.mock("../api/supabase", () => ({
  getGraphNeighbors: (params: { mbid?: string; name?: string }) => server(params),
}));

const { findArtist, findArtistById, getArtistNeighbors, inLocalGraph } = await import("../db/graphSource");

beforeEach(() => server.mockClear());

describe("graphSource once the local graph has loaded", () => {
  it("answers from the local graph when it has the artist, without the server", async () => {
    expect((await findArtistById("ty"))?.name).toBe("Ty Segall");
    expect((await findArtist("ty segall"))?.id).toBe("ty");
    expect(await getArtistNeighbors("ty")).toHaveLength(1);
    expect(server).not.toHaveBeenCalled();
  });

  it("falls back to the server for an artist the local graph doesn't have (picked by ID)", async () => {
    expect((await findArtistById("zach"))?.name).toBe("Zach Bryan");
    expect(inLocalGraph("zach")).toBe(false);
    const neighbors = await getArtistNeighbors("zach");
    expect(neighbors.map((n) => n.node.name)).toEqual(["Bruce Springsteen"]);
  });

  it("falls back to the server by name too, before the local partial match", async () => {
    local.nodes.push({ id: "zb2", name: "Zach Bryant Trio", type: "group" });
    expect((await findArtist("Zach Bryan", { partial: true }))?.id).toBe("zach");
    expect((await findArtist("Bryant", { partial: true }))?.id).toBe("zb2"); // server has nothing: local partial
    local.nodes.pop();
  });

  it("returns null when neither has the artist", async () => {
    expect(await findArtistById("nobody")).toBeNull();
    expect(await findArtist("Nobody At All")).toBeNull();
  });
});
