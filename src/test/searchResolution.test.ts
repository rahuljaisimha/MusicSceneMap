import { describe, it, expect } from "vitest";
import { resolveSearchTarget } from "../pages/searchResolution";

/**
 * Tests for the Explore search resolution logic.
 *
 * Covers the case where clicking a node in the graph (e.g. "Fuzz", Ty Segall's
 * band) should search by that node's exact MBID rather than by name — because
 * multiple distinct artists share the name "Fuzz" and a name search could
 * resolve to the wrong one.
 */

describe("resolveSearchTarget", () => {
  const fuzzBand = {
    name: "Fuzz",
    id: "1625819f-79d7-4787-b2fb-0e0c260bac85", // Ty Segall's band
  };

  it("resolves by MBID when the query matches the clicked node's name", () => {
    // User clicked "Fuzz" in the graph, then hit search with the prefilled name
    const result = resolveSearchTarget("Fuzz", fuzzBand);
    expect(result).toEqual({ by: "id", id: fuzzBand.id });
  });

  it("resolves by name when there is no pending clicked node", () => {
    const result = resolveSearchTarget("Fuzz", null);
    expect(result).toEqual({ by: "name", name: "Fuzz" });
  });

  it("resolves by name when the query was edited away from the clicked node", () => {
    // User clicked "Fuzz" but then typed a different artist
    const result = resolveSearchTarget("Osees", fuzzBand);
    expect(result).toEqual({ by: "name", name: "Osees" });
  });

  it("does not use the MBID if casing differs (exact name match required)", () => {
    // Name comparison is exact; a differently-cased query falls back to name search
    const result = resolveSearchTarget("fuzz", fuzzBand);
    expect(result).toEqual({ by: "name", name: "fuzz" });
  });
});
