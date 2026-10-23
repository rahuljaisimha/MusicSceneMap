import { describe, it, expect } from "vitest";
import { findConnectedBands, DEFAULT_DISCOVER_RELS, DISCOVER_REL_OPTIONS, type BandNeighbor } from "../pages/relatedBands";

// Ty Segall --member_of--> Fuzz; Ty Segall --produced_for--> White Fence;
// Ty Segall --opened_for--> Osees; Charles Moothart --member_of--> Fuzz, CFM
const nodes: Record<string, { id: string; name: string; type: string }> = {
  ty: { id: "ty", name: "Ty Segall", type: "person" },
  fuzz: { id: "fuzz", name: "Fuzz", type: "group" },
  charles: { id: "charles", name: "Charles Moothart", type: "person" },
  cfm: { id: "cfm", name: "CFM", type: "group" },
  wf: { id: "wf", name: "White Fence", type: "group" },
  osees: { id: "osees", name: "Osees", type: "group" },
};
const edges: Array<[string, string, string]> = [
  ["ty", "fuzz", "member_of"],
  ["charles", "fuzz", "member_of"],
  ["charles", "cfm", "member_of"],
  ["ty", "wf", "produced_for"],
  ["ty", "osees", "opened_for"],
];
const neighbors = async (id: string): Promise<BandNeighbor[]> =>
  edges.flatMap(([s, t, relType]) =>
    s === id ? [{ node: nodes[t]!, relType }] : t === id ? [{ node: nodes[s]!, relType }] : []);

describe("findConnectedBands", () => {
  it("follows band relationships by default", async () => {
    expect(DEFAULT_DISCOVER_RELS).toEqual(["member_of", "former_member_of", "support_musician"]);
    const bands = await findConnectedBands({ startIds: ["ty"], exclude: [], relTypes: DEFAULT_DISCOVER_RELS, neighbors });
    expect(bands.map((b) => b.name)).toEqual(["Fuzz", "CFM"]);
  });

  it("follows the other relationship types when ticked", async () => {
    const bands = await findConnectedBands({
      startIds: ["ty"], exclude: [], neighbors,
      relTypes: [...DEFAULT_DISCOVER_RELS, "produced_for", "opened_for"],
    });
    expect(bands.map((b) => b.name)).toEqual(["Fuzz", "White Fence", "Osees", "CFM"]);
  });

  it("can follow only a non-band relationship", async () => {
    const bands = await findConnectedBands({ startIds: ["ty"], exclude: [], relTypes: ["opened_for"], neighbors });
    expect(bands.map((b) => b.name)).toEqual(["Osees"]);
  });

  it("finds nothing with nothing ticked, skips the user's own artists, stops at the limit", async () => {
    expect(await findConnectedBands({ startIds: ["ty"], exclude: [], relTypes: [], neighbors })).toEqual([]);
    const bands = await findConnectedBands({
      startIds: ["ty"], exclude: ["Fuzz"], neighbors, limit: 1,
      relTypes: DISCOVER_REL_OPTIONS.map((o) => o.relType),
    });
    expect(bands.map((b) => b.name)).toEqual(["White Fence"]);
  });
});
