import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GAME_ARTISTS } from "../game/artists";

describe("GAME_ARTISTS", () => {
  it("identifies every artist by a unique MusicBrainz ID", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const a of GAME_ARTISTS) expect(a.mbid, a.name).toMatch(uuid);
    expect(new Set(GAME_ARTISTS.map((a) => a.mbid)).size).toBe(GAME_ARTISTS.length);
  });

  it("keeps one entry per line, as scripts/process_mb_dump.py reads them", () => {
    const src = readFileSync(new URL("../game/artists.ts", import.meta.url), "utf8");
    const lines = src.split("\n").filter((l) => /mbid: "/.test(l));
    expect(lines.length).toBe(GAME_ARTISTS.length);
    for (const l of lines) expect(l).toMatch(/\{ name: ".*", type: "(person|group)", mbid: "[0-9a-f-]{36}" \}/);
  });
});
