/**
 * Discover's date range: plain "YYYY-MM-DD" strings in the user's local time
 * (what <input type="date"> uses). Pollstar only serves today onwards, up to
 * MAX_YEARS_AHEAD.
 */

/** Days the range covers by default: today to a week from today. */
export const DEFAULT_DAYS = 7;
/** How far ahead the range can reach. */
export const MAX_YEARS_AHEAD = 4;

export interface DateRange {
  from: string;
  to: string;
}

/** A date as YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A YYYY-MM-DD date as a local Date (midnight). */
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** `iso` moved by `days` (may be negative). */
export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** The last day the range may reach from `today`. */
export function maxDate(today: string): string {
  const d = parse(today);
  d.setFullYear(d.getFullYear() + MAX_YEARS_AHEAD);
  return isoDate(d);
}

/** Today to DEFAULT_DAYS from today. */
export function defaultRange(now: Date = new Date()): DateRange {
  const today = isoDate(now);
  return { from: today, to: addDays(today, DEFAULT_DAYS) };
}

/** A range Pollstar can serve: from today or later, to on or after from, neither past maxDate. */
export function clampRange({ from, to }: DateRange, now: Date = new Date()): DateRange {
  const today = isoDate(now);
  const last = maxDate(today);
  const f = !from || from < today ? today : from > last ? last : from;
  const t = !to || to < f ? f : to > last ? last : to;
  return { from: f, to: t };
}

/** "Thu, Oct 29 – Thu, Nov 5" (the year too when it isn't this year's, or the two differ). */
export function formatRange({ from, to }: DateRange, now: Date = new Date()): string {
  const a = parse(from);
  const b = parse(to);
  const withYear = a.getFullYear() !== b.getFullYear() || a.getFullYear() !== now.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  return from === to ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
}
