import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  searchArtists,
  getArtistWithRelations,
  extractMembers,
  extractBands,
  extractSupportMusicians,
  pickBestMatch,
  type MBArtist,
} from "../api/musicbrainz";

/**
 * Tests for the recurring MusicBrainz bugs, using real API responses captured
 * as fixtures (src/test/fixtures/). The `fetch` call is stubbed so tests are
 * deterministic and offline — no rate limits, no 503s, no flakiness.
 *
 * To refresh fixtures, re-run the capture commands documented in the project
 * (they hit the live MusicBrainz API for these stable MBIDs).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  const path = join(__dirname, "fixtures", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

const MBIDS = {
  arcticMonkeys: "ada7a83c-e3e1-40f1-93f9-3e73dbc9298a",
  fooFighters: "67f66c07-6e61-4026-ade5-7e782fad3a5d",
  daveGrohl: "4d5f891d-9bce-45ae-ad86-912dd27252fa",
};

// Map request URLs to fixtures
const FIXTURE_ROUTES: Array<{ match: (url: string) => boolean; fixture: string }> = [
  { match: (u) => u.includes("/artist") && u.includes("Fuzz"), fixture: "search-fuzz" },
  { match: (u) => u.includes("/artist") && u.includes("Jack") , fixture: "search-jack-white" },
  { match: (u) => u.includes("/artist") && u.includes("Dave") , fixture: "search-dave-grohl" },
  { match: (u) => u.includes(MBIDS.arcticMonkeys), fixture: "artist-arctic-monkeys" },
  { match: (u) => u.includes(MBIDS.fooFighters), fixture: "artist-foo-fighters" },
  { match: (u) => u.includes(MBIDS.daveGrohl), fixture: "artist-dave-grohl" },
];

beforeEach(() => {
  // Clear the request cache between tests so stubs are hit
  localStorage.clear();

  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const route = FIXTURE_ROUTES.find((r) => r.match(url));
    if (!route) {
      throw new Error(`No fixture for URL: ${url}`);
    }
    const body = loadFixture(route.fixture);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Issue: exact name match vs relevance ranking (Fuzz vs Buzz Fuzz)", () => {
  it("pickBestMatch prefers an exact name match over the top relevance result", () => {
    const results = [
      { id: "buzz-fuzz-id", name: "Buzz Fuzz" },
      { id: "fuzz-id", name: "Fuzz", disambiguation: "USA rock band" },
      { id: "garage-fuzz-id", name: "Garage Fuzz" },
    ] as MBArtist[];

    const best = pickBestMatch("Fuzz", results);
    expect(best?.name).toBe("Fuzz");
    expect(best?.id).toBe("fuzz-id");
  });

  it("pickBestMatch falls back to the top result when no exact match exists", () => {
    const results = [
      { id: "a", name: "Something Else" },
      { id: "b", name: "Another Thing" },
    ] as MBArtist[];

    expect(pickBestMatch("Nonexistent", results)?.id).toBe("a");
  });

  it("searchArtists('Fuzz') returns Buzz Fuzz first, but pickBestMatch selects the exact 'Fuzz'", async () => {
    const results = await searchArtists("Fuzz", 10);
    // MusicBrainz ranks "Buzz Fuzz" first
    expect(results[0]!.name).toBe("Buzz Fuzz");
    // But pickBestMatch corrects this to the exact-named band
    const best = pickBestMatch("Fuzz", results);
    expect(best?.name).toBe("Fuzz");
  });
});

describe("Issue: same-name disambiguation (Jack White)", () => {
  it("multiple distinct artists named 'Jack White' exist, distinguishable by MBID", async () => {
    const results = await searchArtists("Jack White", 10);
    const exactNamed = results.filter((a) => a.name.toLowerCase() === "jack white");
    expect(exactNamed.length).toBeGreaterThan(1);
    const ids = new Set(exactNamed.map((a) => a.id));
    expect(ids.size).toBe(exactNamed.length);
  });
});

describe("Issue: current vs former member deduplication", () => {
  it("Arctic Monkeys members are deduplicated (Alex Turner appears once)", async () => {
    const artist = await getArtistWithRelations(MBIDS.arcticMonkeys);
    const members = extractMembers(artist);

    const ids = members.map((m) => m.artist.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates

    const alexTurner = members.filter((m) => m.artist.name === "Alex Turner");
    expect(alexTurner.length).toBe(1);
    expect(alexTurner[0]!.current).toBe(true);
  });

  it("marks a member current if ANY relationship is not ended (original + member)", () => {
    const artist = {
      id: "band-id",
      name: "Test Band",
      relations: [
        { type: "member of band", "target-type": "artist", direction: "backward", ended: true, artist: { id: "p1", name: "P" } },
        { type: "member of band", "target-type": "artist", direction: "backward", ended: false, artist: { id: "p1", name: "P" } },
      ],
    } as unknown as MBArtist;

    const members = extractMembers(artist);
    expect(members.length).toBe(1);
    expect(members[0]!.current).toBe(true);
  });

  it("Dave Grohl appears exactly once in Foo Fighters members (dedup)", async () => {
    const artist = await getArtistWithRelations(MBIDS.fooFighters);
    const members = extractMembers(artist);
    const dave = members.filter((m) => m.artist.name === "Dave Grohl");
    expect(dave.length).toBe(1);
  });
});

describe("Issue: bands extraction with dedup", () => {
  it("Dave Grohl's bands include Foo Fighters and Nirvana, deduplicated", async () => {
    const artist = await getArtistWithRelations(MBIDS.daveGrohl);
    const bands = extractBands(artist);
    const names = bands.map((b) => b.artist.name);

    expect(names).toContain("Foo Fighters");
    expect(names).toContain("Nirvana");

    // Nirvana appears twice in raw data — must be deduplicated
    const ids = bands.map((b) => b.artist.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Issue: supporting musician relationship type", () => {
  it("Arctic Monkeys supporting musicians include Tom Rowley / Tyler Parkford", async () => {
    const artist = await getArtistWithRelations(MBIDS.arcticMonkeys);
    const supporters = extractSupportMusicians(artist);
    const names = supporters.map((s) => s.artist.name);
    expect(names).toContain("Tom Rowley");
    expect(names).toContain("Tyler Parkford");
  });
});
