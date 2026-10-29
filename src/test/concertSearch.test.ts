import { describe, it, expect } from "vitest";
import { streamConcerts, pickCity, searchProgress, MAX_CITY_PAGES, type ConcertSearchDeps, type ConcertSearchUpdate } from "../pages/concertSearch";
import { sortConcerts, toConcert } from "../pages/concerts";
import type { PollstarCity, PollstarEvent } from "../api/pollstar";

const BERLIN: PollstarCity = { id: "65443", name: "Berlin, Germany", city: "Berlin", state: null, rank: 250 };
const BERLIN_MD: PollstarCity = { id: "8942", name: "Berlin, MD", city: "Berlin", state: "MD", rank: 100 };

function ev(id: string, artist: string, date: string, venueName = "SO36"): PollstarEvent {
  return {
    id,
    name: `${artist} at ${venueName}`,
    playDate: date,
    url: null,
    isFestival: false,
    venueId: venueName,
    venueName,
    artists: [{ name: artist, isHeadline: true, genres: [], artistType: "Band" }],
  };
}

const SCORES: Record<string, number> = { "Ty Segall": 90, "Osees": 70, "Taylor Swift": 4 };

/** Berlin has two pages; Osees plays on both, and page 2 repeats one of page 1's events. */
function deps(log: string[] = []): ConcertSearchDeps {
  const pages: PollstarEvent[][] = [
    [ev("e1", "Taylor Swift", "2027-01-05", "Uber Arena"), ev("e2", "Osees", "2027-02-01")],
    [ev("e3", "Ty Segall", "2027-03-01"), ev("e4", "Osees", "2027-03-20", "Lido"), ev("e2", "Osees", "2027-02-01")],
  ];
  return {
    findCity: async (q) => {
      log.push(`city ${q}`);
      return pickCity([BERLIN_MD, BERLIN], q);
    },
    cityEvents: async (id, page) => {
      log.push(`page ${id}:${page}`);
      return { events: pages[page] ?? [], totalPages: pages.length, totalEvents: 5 };
    },
    scoreMany: async (names, onScore) => {
      log.push(`score ${names.join(", ")}`);
      const out = new Map<string, { score: number; found: boolean }>();
      // Closest first, one at a time
      for (const n of [...names].sort((a, b) => (SCORES[b] ?? 0) - (SCORES[a] ?? 0))) {
        await new Promise((r) => setTimeout(r, 1));
        const s = { score: SCORES[n] ?? 0, found: n in SCORES };
        out.set(n, s);
        onScore(n, s);
      }
      return out;
    },
  };
}

describe("streamConcerts", () => {
  it("lists each page's concerts as soon as it arrives, then re-sorts as they're scored", async () => {
    const updates: ConcertSearchUpdate[] = [];
    await streamConcerts("Berlin", deps(), (u) => updates.push(u));

    expect(updates.find((u) => u.progress.city)!.progress.city).toBe("Berlin, Germany");
    // Page 1's two concerts were listed before they were scored
    const first = updates.find((u) => u.concerts.length > 0)!;
    expect(first.concerts.map((c) => [c.artistName, c.scored])).toEqual([
      ["Taylor Swift", false],
      ["Osees", false],
    ]);
    expect(first.progress).toMatchObject({ stage: "concerts", pagesLoaded: 1, pagesTotal: 2, concertsTotal: 5 });

    const last = updates[updates.length - 1]!;
    expect(last.progress).toMatchObject({ stage: "done", pagesLoaded: 2, scoring: 0 });
    // Every concert scored, best first; the repeated event appears once
    expect(last.concerts.map((c) => [c.id, c.artistName, c.score])).toEqual([
      ["e3", "Ty Segall", 90],
      ["e2", "Osees", 70],
      ["e4", "Osees", 70],
      ["e1", "Taylor Swift", 4],
    ]);
  });

  it("moves each concert into place as soon as its headliner is scored, not when the page is", async () => {
    const updates: ConcertSearchUpdate[] = [];
    const d = deps();
    // One page only, so nothing else arrives in between
    const onePage: ConcertSearchDeps = {
      ...d,
      cityEvents: async (id, page) => ({ ...(await d.cityEvents(id, page)), totalPages: 1 }),
    };
    await streamConcerts("Berlin", onePage, (u) => updates.push(u));
    // Osees (70) is scored before Taylor Swift (4), each in its own update
    const partly = updates.find((u) => u.concerts.some((c) => c.scored) && u.concerts.some((c) => !c.scored))!;
    expect(partly.concerts.map((c) => [c.artistName, c.scored])).toEqual([
      ["Osees", true],
      ["Taylor Swift", false],
    ]);
    expect(partly.progress.scoring).toBe(1);
  });

  it("scores a page's new headliners together, each headliner once", async () => {
    const log: string[] = [];
    await streamConcerts("Berlin", deps(log), () => {});
    expect(log.filter((l) => l.startsWith("score"))).toEqual(["score Taylor Swift, Osees", "score Ty Segall"]);
  });

  it("asks for the city once, then its pages in order", async () => {
    const log: string[] = [];
    await streamConcerts("Berlin", deps(log), () => {});
    expect(log.filter((l) => !l.startsWith("score"))).toEqual(["city Berlin", "page 65443:0", "page 65443:1"]);
  });

  it("stops requesting and reporting when stopped", async () => {
    const log: string[] = [];
    let stop = false;
    const updates: ConcertSearchUpdate[] = [];
    await streamConcerts(
      "Berlin",
      deps(log),
      (u) => {
        updates.push(u);
        if (u.progress.pagesLoaded === 1) stop = true;
      },
      () => stop
    );
    expect(log).not.toContain("page 65443:1");
    expect(updates[updates.length - 1]!.progress.pagesLoaded).toBe(1);
  });

  it("ends with no concerts when there's no such city", async () => {
    const updates: ConcertSearchUpdate[] = [];
    await streamConcerts("Atlantis", { ...deps(), findCity: async () => null }, (u) => updates.push(u));
    expect(updates[updates.length - 1]!.progress).toMatchObject({ stage: "done", city: null });
    expect(updates[updates.length - 1]!.concerts).toEqual([]);
  });

  it(`loads at most ${MAX_CITY_PAGES} pages`, async () => {
    const log: string[] = [];
    const d = deps(log);
    await streamConcerts(
      "Berlin",
      {
        ...d,
        cityEvents: async (_id, page) => {
          log.push(`page ${page}`);
          return { events: [ev(`p${page}`, `Band ${page}`, "2027-01-01")], totalPages: 40, totalEvents: 4000 };
        },
      },
      () => {}
    );
    expect(log.filter((l) => l.startsWith("page"))).toHaveLength(MAX_CITY_PAGES);
  });
});

describe("pickCity", () => {
  const cities = [BERLIN_MD, BERLIN, { id: "40342", name: "New Berlin, IL", city: "New Berlin", state: "IL", rank: 160 }];
  it("takes the biggest city of that name", () => {
    expect(pickCity(cities, "berlin")!.id).toBe("65443");
  });
  it("takes an exact 'City, State' when given", () => {
    expect(pickCity(cities, "Berlin, MD")!.id).toBe("8942");
  });
  it("falls back to a name that starts with it, else none", () => {
    expect(pickCity(cities, "New Ber")!.id).toBe("40342");
    expect(pickCity(cities, "Atlantis")).toBe(null);
  });
});

describe("sortConcerts", () => {
  it("puts unscored concerts after scored ones, by date", () => {
    const a = toConcert(ev("a", "A", "2027-03-01"), "A");
    const b = toConcert(ev("b", "B", "2027-01-01"), "B");
    const c = toConcert(ev("c", "C", "2027-05-01"), "C", { score: 0, found: false });
    expect(sortConcerts([a, b, c]).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("searchProgress", () => {
  const base = { stage: "concerts" as const, city: "Berlin, Germany", pagesLoaded: 1, pagesTotal: 2, concertsTotal: 150, scoring: 0 };
  const scored = (n: number, of: number) =>
    Array.from({ length: of }, (_, i) => toConcert(ev(`e${i}`, `A${i}`, "2027-01-01"), `A${i}`, i < n ? { score: 1, found: true } : undefined));
  it("moves with the pages loaded and the concerts scored, and ends at 1", () => {
    expect(searchProgress({ ...base, stage: "city", city: null, pagesTotal: 0 }, [])).toBe(0.05);
    const half = searchProgress(base, scored(0, 10));
    const halfScored = searchProgress(base, scored(10, 10));
    const all = searchProgress({ ...base, pagesLoaded: 2 }, scored(10, 10));
    expect(half).toBeGreaterThan(0.05);
    expect(halfScored).toBeGreaterThan(half);
    expect(all).toBeCloseTo(1);
    expect(searchProgress({ ...base, stage: "done" }, [])).toBe(1);
  });
});

