import { describe, it, expect, vi } from "vitest";
import { fromMusicBrainz, findSuggestions, suggestionDetail, type SuggestionSources } from "../db/artistSuggest";
import type { ArtistMatch } from "../db/graphDb";
import type { MBArtist } from "../api/musicbrainz";

const fuzzUS: MBArtist = {
  id: "fuzz-us",
  name: "Fuzz",
  type: "Group",
  disambiguation: "US garage rock band",
  area: { name: "United States" },
  "begin-area": { name: "San Francisco" },
  tags: [
    { name: "rock", count: 1 },
    { name: "garage rock", count: 4 },
    { name: "spam", count: 0 },
  ],
};
const fuzzUK: MBArtist = { id: "fuzz-uk", name: "Fuzz", type: "Person", area: { name: "United Kingdom" } };

describe("fromMusicBrainz", () => {
  it("maps type, keeps only the disambiguation (no area or tags) and marks it as from MusicBrainz", () => {
    expect(fromMusicBrainz(fuzzUS)).toEqual({
      id: "fuzz-us",
      name: "Fuzz",
      type: "group",
      disambiguation: "US garage rock band",
      fromMusicBrainz: true,
    });
  });

  it("has no label when MusicBrainz has no disambiguation", () => {
    expect(fromMusicBrainz(fuzzUK)).toEqual({ id: "fuzz-uk", name: "Fuzz", type: "person", fromMusicBrainz: true });
  });
});

function sources(db: ArtistMatch[] | Error, mb: MBArtist[] | Error = []): SuggestionSources {
  return {
    searchDb: vi.fn(async () => {
      if (db instanceof Error) throw db;
      return db;
    }),
    searchMusicBrainz: vi.fn(async () => {
      if (mb instanceof Error) throw mb;
      return mb;
    }),
  };
}

const graphFuzzes: ArtistMatch[] = [
  { id: "fuzz-uk", name: "Fuzz", type: "person" },
  { id: "fuzz-us", name: "Fuzz", type: "group" },
  { id: "fuzz-club", name: "Fuzz Club", type: "group" },
];

describe("findSuggestions", () => {
  it("labels graph matches from their own columns without any request", async () => {
    const src = sources([]);
    const local = [{ id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band", area: "San Francisco" }];
    expect(await findSuggestions("fuzz", local, true, 8, src)).toEqual([
      { id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band" },
    ]);
    expect(src.searchDb).not.toHaveBeenCalled();
    expect(src.searchMusicBrainz).not.toHaveBeenCalled();
  });

  it("labels graph matches from Postgres by MBID, in graph order, without MusicBrainz", async () => {
    const src = sources([
      { id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band" },
      { id: "not-in-graph", name: "Fuzzbox", type: "group" },
    ], [fuzzUS]);
    const found = await findSuggestions("fuzz", graphFuzzes, false, 8, src);
    expect(found!.map((s) => s.id)).toEqual(["fuzz-uk", "fuzz-us", "fuzz-club"]);
    expect(found![1]).toEqual({ id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band" });
    expect(src.searchMusicBrainz).not.toHaveBeenCalled();
  });

  it("keeps graph matches unlabelled when Postgres can't be reached, without MusicBrainz", async () => {
    const src = sources(new Error("down"), [fuzzUS]);
    expect(await findSuggestions("fuzz", graphFuzzes, false, 8, src)).toEqual(graphFuzzes);
    expect(src.searchMusicBrainz).not.toHaveBeenCalled();
  });

  it("uses Postgres while the graph is downloading", async () => {
    const db = [{ id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band", area: "San Francisco" }];
    const src = sources(db, [fuzzUK]);
    expect(await findSuggestions("fuzz", null, false, 8, src)).toEqual([
      { id: "fuzz-us", name: "Fuzz", type: "group", disambiguation: "US garage rock band" },
    ]);
    expect(src.searchMusicBrainz).not.toHaveBeenCalled();
  });

  it("falls back to MusicBrainz only when the database has no match", async () => {
    expect(await findSuggestions("fuzz", [], true, 1, sources([], [fuzzUS, fuzzUK]))).toEqual([fromMusicBrainz(fuzzUS)]);
    expect(await findSuggestions("fuzz", null, false, 8, sources([], [fuzzUK]))).toEqual([fromMusicBrainz(fuzzUK)]);
  });

  it("falls back to MusicBrainz when Postgres can't be reached", async () => {
    expect(await findSuggestions("fuzz", null, false, 8, sources(new Error("down"), [fuzzUK]))).toEqual([fromMusicBrainz(fuzzUK)]);
  });

  it("is empty when nothing matches, and null when every source failed", async () => {
    expect(await findSuggestions("zzzz", null, false, 8, sources([], []))).toEqual([]);
    expect(await findSuggestions("zzzz", null, false, 8, sources([], new Error("x")))).toEqual([]);
    expect(await findSuggestions("zzzz", null, false, 8, sources(new Error("x"), new Error("y")))).toBeNull();
  });
});

describe("suggestionDetail", () => {
  it("is the MusicBrainz disambiguation, nothing else", () => {
    expect(suggestionDetail(fromMusicBrainz(fuzzUS))).toBe("US garage rock band");
  });

  it("is null when MusicBrainz has no disambiguation (no city or genre instead)", () => {
    expect(suggestionDetail(fromMusicBrainz(fuzzUK))).toBeNull();
    expect(suggestionDetail({ id: "x", name: "X", type: "group" })).toBeNull();
    expect(suggestionDetail({ id: "x", name: "X", type: "group", disambiguation: "  " })).toBeNull();
  });
});
