import { describe, it, expect } from "vitest";
import { addDays, clampRange, defaultRange, formatRange, isoDate, maxDate } from "../pages/dateRange";

const NOW = new Date(2026, 9, 29, 15, 30); // Thu Oct 29 2026, local time

describe("date range", () => {
  it("defaults to today through a week from today", () => {
    expect(defaultRange(NOW)).toEqual({ from: "2026-10-29", to: "2026-11-05" });
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("keeps a range Pollstar can serve", () => {
    // Before today: from today
    expect(clampRange({ from: "2026-10-01", to: "2026-11-01" }, NOW)).toEqual({ from: "2026-10-29", to: "2026-11-01" });
    // To before from: a single day
    expect(clampRange({ from: "2026-11-10", to: "2026-11-02" }, NOW)).toEqual({ from: "2026-11-10", to: "2026-11-10" });
    // Past four years: cut there
    expect(maxDate("2026-10-29")).toBe("2030-10-29");
    expect(clampRange({ from: "2026-11-01", to: "2032-01-01" }, NOW)).toEqual({ from: "2026-11-01", to: "2030-10-29" });
    // Empty (a cleared input): today
    expect(clampRange({ from: "", to: "" }, NOW)).toEqual({ from: "2026-10-29", to: "2026-10-29" });
  });

  it("writes the range for people", () => {
    expect(formatRange({ from: "2026-10-29", to: "2026-11-05" }, NOW)).toMatch(/Oct 29 – .*Nov 5$/);
    expect(formatRange({ from: "2026-12-30", to: "2027-01-02" }, NOW)).toMatch(/2026 – .*2027$/);
    expect(formatRange({ from: "2026-11-01", to: "2026-11-01" }, NOW)).not.toContain("–");
  });
});
