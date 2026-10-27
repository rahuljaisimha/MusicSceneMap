import { describe, it, expect } from "vitest";
import { requestedRow, sanitizePollstar, MAX_EVENTS } from "../../supabase/functions/_shared/userRequestedData.ts";

const venue = { id: "123456", name: "Zebulon", city: "Los Angeles", state: "CA", location: "Los Angeles, CA", rank: 9 };
const event = (over: Record<string, unknown> = {}) => ({
  id: 98765,
  name: "Osees with Flat Worms",
  playDate: "2026-11-20T00:00:00",
  url: "https://www.pollstar.com/event/98765",
  isFestival: false,
  venue: { id: 123456, name: "Zebulon", address: "2478 Fletcher Dr" },
  artists: [
    { name: "Osees", isHeadline: true, genres: ["Rock"], artistType: "Band", imageUrl: "x" },
    { name: "Flat Worms", isHeadline: false },
    { name: "  " },
  ],
  tickets: [{ name: "Tickets", url: "https://tickets.example/1" }],
  ...over,
});

describe("user-requested data: the row kept for a request", () => {
  it("keeps a Pollstar venue's events under its venue id, cut down to what concert-database reads", () => {
    const row = requestedRow({ source: "pollstar", data: { venue, events: { totalPages: 1, events: [event()] } } });
    expect(row).toEqual({
      source: "pollstar",
      key: "123456",
      data: {
        venue: { id: "123456", name: "Zebulon", city: "Los Angeles", state: "CA", location: "Los Angeles, CA" },
        events: [
          {
            id: "98765",
            name: "Osees with Flat Worms",
            playDate: "2026-11-20T00:00:00",
            url: "https://www.pollstar.com/event/98765",
            isFestival: false,
            venue: { id: "123456" },
            artists: [
              { name: "Osees", isHeadline: true },
              { name: "Flat Worms", isHeadline: false },
            ],
          },
        ],
      },
    });
  });

  it("refuses sources browsers can't hand in", () => {
    expect(() => requestedRow({ source: "setlistfm", data: {} })).toThrow("unknown source");
    expect(() => requestedRow({ source: "__proto__", data: {} })).toThrow("unknown source");
    expect(() => requestedRow({ data: {} })).toThrow("unknown source");
  });
});

describe("sanitizePollstar", () => {
  it("refuses malformed or out-of-place data", () => {
    const bad = (body: unknown) => () => sanitizePollstar(body);
    expect(bad({ events: { events: [] } })).toThrow("missing venue");
    expect(bad({ venue: { ...venue, id: "abc" }, events: { events: [] } })).toThrow("bad venue id");
    expect(bad({ venue, events: {} })).toThrow("missing events");
    expect(bad({ venue, events: { events: [event({ id: "x1" })] } })).toThrow("bad event id");
    expect(bad({ venue, events: { events: [event({ playDate: "soon" })] } })).toThrow("bad playDate");
    expect(bad({ venue, events: { events: [event({ venue: { id: 1 } })] } })).toThrow("event at another venue");
    expect(bad({ venue, events: { events: [event({ url: "https://evil.example/x" })] } })).toThrow("bad url");
    expect(bad({ venue, events: { events: [event({ name: "x".repeat(301) })] } })).toThrow("bad text");
    expect(bad({ venue, events: { events: Array.from({ length: MAX_EVENTS + 1 }, () => event()) } })).toThrow(
      "too many events"
    );
  });

  it("accepts an empty list (the venue has nothing coming up)", () => {
    expect(sanitizePollstar({ venue, events: { events: [] } }).events).toEqual([]);
  });
});
