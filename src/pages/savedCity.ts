/**
 * The last city Discover searched, remembered in this browser so the next visit
 * (a reload, or a new page load) starts with it filled in. It's kept as Pollstar's
 * city (id and all), so searching it again needs no lookup.
 */

import type { PollstarCity } from "../api/pollstar";

const STORAGE_KEY = "discover.city";

export function loadCity(): PollstarCity | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (c && typeof c.id === "string" && c.id && typeof c.name === "string" && c.name.trim()) {
      return {
        id: c.id,
        name: c.name,
        city: typeof c.city === "string" ? c.city : null,
        state: typeof c.state === "string" ? c.state : null,
        rank: typeof c.rank === "number" ? c.rank : 0,
      };
    }
  } catch {
    /* nothing remembered */
  }
  return null;
}

export function saveCity(city: PollstarCity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(city));
  } catch {
    /* not remembered */
  }
}
