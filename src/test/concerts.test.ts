import { describe, it, expect } from "vitest";
import { rankConcerts, dedupeEvents, headlineArtist } from "../pages/concerts";
import type { GraphAccess, SimNode, SimNeighbor } from "../pages/similarity";
import type { PollstarEvent } from "../api/pollstar";
import { parseVenues, parseCities, parseEvents, formatPollstarDate } from "../api/pollstar";

/**
 * Fake graph: Ty Segall and Charles Moothart are connected (share Fuzz).
 * "Random Opener" is not in the graph at all → scores 0.
 */
function makeGraph(): GraphAccess {
  const nodes: Record<string, SimNode> = {
    ty: { id: "ty", name: "Ty Segall", type: "person" },
    charles: { id: "charles", name: "Charles Moothart", type: "person" },
    fuzz: { id: "fuzz", name: "Fuzz", type: "group" },
  };
  const edges: Array<[string, string, string]> = [
    ["ty", "fuzz", "member_of"],
    ["charles", "fuzz", "member_of"],
  ];
  return {
    findNodeByName(name) {
      return Object.values(nodes).find((n) => n.name.toLowerCase() === name.toLowerCase()) ?? null;
    },
    neighbors(nodeId): SimNeighbor[] {
      const out: SimNeighbor[] = [];
      for (const [s, t, rel] of edges) {
        if (s === nodeId) out.push({ node: nodes[t]!, relType: rel });
        if (t === nodeId) out.push({ node: nodes[s]!, relType: rel });
      }
      return out;
    },
  };
}

function ev(id: string, artist: string, date: string, opts: Partial<PollstarEvent> = {}): PollstarEvent {
  return {
    id,
    name: `${artist} at Venue`,
    playDate: date,
    url: `/events/${id}`,
    isFestival: false,
    venueId: "v1",
    venueName: "Zebulon",
    artists: [{ name: artist, isHeadline: true, genres: [], artistType: "Band" }],
    tickets: [],
    ...opts,
  };
}

describe("headlineArtist", () => {
  it("prefers the headline artist over the first listed", () => {
    const e = ev("1", "X", "2026-10-01");
    e.artists = [
      { name: "Opener", isHeadline: false, genres: [], artistType: "Band" },
      { name: "Headliner", isHeadline: true, genres: [], artistType: "Band" },
    ];
    expect(headlineArtist(e)).toBe("Headliner");
  });

  it("falls back to the first artist when none is flagged headline", () => {
    const e = ev("1", "X", "2026-10-01");
    e.artists = [{ name: "First", isHeadline: false, genres: [], artistType: "Band" }];
    expect(headlineArtist(e)).toBe("First");
  });

  it("returns null when there are no artists", () => {
    const e = ev("1", "X", "2026-10-01");
    e.artists = [];
    expect(headlineArtist(e)).toBe(null);
  });
});

describe("rankConcerts", () => {
  it("ranks a graph-connected artist above an unknown one", () => {
    const g = makeGraph();
    const events = [
      ev("1", "Random Opener", "2026-10-05"),
      ev("2", "Charles Moothart", "2026-10-10"),
    ];
    const ranked = rankConcerts(g, events, ["Ty Segall"]);
    expect(ranked[0]!.artistName).toBe("Charles Moothart");
    expect(ranked[0]!.artistFound).toBe(true);
    expect(ranked[0]!.score).toBeGreaterThan(0);
    expect(ranked[1]!.artistName).toBe("Random Opener");
    expect(ranked[1]!.artistFound).toBe(false);
    expect(ranked[1]!.score).toBe(0);
  });

  it("breaks score ties by soonest date", () => {
    const g = makeGraph();
    const events = [
      ev("late", "Random A", "2026-12-01"),
      ev("early", "Random B", "2026-10-01"),
    ];
    const ranked = rankConcerts(g, events, ["Ty Segall"]);
    // Both score 0 (not in graph) → earlier date first.
    expect(ranked[0]!.id).toBe("early");
  });

  it("scores a repeated headliner once (memoized) and keeps both events", () => {
    const g = makeGraph();
    const events = [
      ev("a", "Charles Moothart", "2026-10-10"),
      ev("b", "Charles Moothart", "2026-11-10"),
    ];
    const ranked = rankConcerts(g, events, ["Ty Segall"]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBe(ranked[1]!.score);
  });

  it("lists supporting artists excluding the headliner", () => {
    const g = makeGraph();
    const e = ev("1", "Charles Moothart", "2026-10-10");
    e.artists = [
      { name: "Charles Moothart", isHeadline: true, genres: [], artistType: "Band" },
      { name: "Support Act", isHeadline: false, genres: [], artistType: "Band" },
    ];
    const ranked = rankConcerts(g, [e], ["Ty Segall"]);
    expect(ranked[0]!.supportingArtists).toEqual(["Support Act"]);
  });
});

describe("dedupeEvents", () => {
  it("removes duplicate event ids", () => {
    const events = [ev("1", "A", "2026-10-01"), ev("1", "A", "2026-10-01"), ev("2", "B", "2026-10-02")];
    expect(dedupeEvents(events)).toHaveLength(2);
  });
});

describe("Pollstar parsing", () => {
  it("parseVenues keeps only venues and maps fields", () => {
    const raw = {
      response: {
        docs: [
          { EntityId: "109231560", ListName: "Zebulon", EntityType: "Venue", City: "Los Angeles", State: "CA", Location: "Los Angeles, CA", Rank: 250 },
          { EntityId: "265", ListName: "Zebulon", EntityType: "Artist", Rank: 0 },
          { EntityId: "502", ListName: "Zebulon, NC", EntityType: "City", Rank: 14 },
        ],
      },
    };
    const venues = parseVenues(raw);
    expect(venues).toHaveLength(1);
    expect(venues[0]).toMatchObject({ id: "109231560", name: "Zebulon", city: "Los Angeles", rank: 250 });
  });

  it("parseEvents flattens events, artists, and tickets", () => {
    const raw = {
      totalEvents: 1,
      events: [
        {
          id: 9217494,
          name: "The Sleeves at Zebulon",
          playDate: "2026-09-28T00:00:00",
          url: "/events/the-sleeves-at-zebulon-9217494",
          isFestival: false,
          venue: { id: 109231560, name: "Zebulon" },
          artists: [{ name: "The Sleeves", isHeadline: true, genres: ["Pop / Rock"], artistType: "Band" }],
          tickets: [{ name: "DiceFM", url: "https://link.dice.fm/x", time: "8:00 PM" }],
        },
      ],
    };
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "9217494",
      venueId: "109231560",
      venueName: "Zebulon",
    });
    expect(events[0]!.artists[0]!.name).toBe("The Sleeves");
    expect(events[0]!.tickets[0]!.url).toBe("https://link.dice.fm/x");
  });

  it("parseEvents drops tickets without a url", () => {
    const raw = { events: [{ id: 1, name: "e", playDate: "2026-10-01", venue: { id: 1, name: "V" }, artists: [], tickets: [{ name: "NoUrl" }] }] };
    expect(parseEvents(raw)[0]!.tickets).toHaveLength(0);
  });

  it("formatPollstarDate produces MM-DD-YYYY", () => {
    expect(formatPollstarDate(new Date(2026, 8, 28))).toBe("09-28-2026");
  });
});

describe("parseCities", () => {
  it("keeps only cities, unescaped, with their rank", () => {
    const raw = {
      response: {
        docs: [
          { EntityId: "65443", ListName: "Berlin, Germany", EntityType: "City", City: "Berlin", State: "", Rank: 250 },
          { EntityId: "48929", ListName: "Berlin", EntityType: "Artist", Rank: 33 },
          { EntityId: "8942", ListName: "Berlin, MD", EntityType: "City", City: "Berlin", State: "MD", Rank: 100 },
          { EntityId: "1", ListName: "Coeur d&#39;Alene, ID", EntityType: "City", City: "Coeur d&#39;Alene", State: "ID" },
        ],
      },
    };
    expect(parseCities(raw)).toEqual([
      { id: "65443", name: "Berlin, Germany", city: "Berlin", state: null, rank: 250 },
      { id: "8942", name: "Berlin, MD", city: "Berlin", state: "MD", rank: 100 },
      { id: "1", name: "Coeur d'Alene, ID", city: "Coeur d'Alene", state: "ID", rank: 0 },
    ]);
  });
});

