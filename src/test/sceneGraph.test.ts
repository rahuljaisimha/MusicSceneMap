import { describe, it, expect } from "vitest";
import { SceneGraph } from "../graph/SceneGraph";
import { DEFAULT_EXPLORE_RELS, EXPLORE_RELATIONSHIPS } from "../graph/relationships";
import { EDGE_COLORS, type EdgeType } from "../graph/types";

function graph() {
  const g = new SceneGraph();
  g.addNode({ id: "ty", type: "musician", name: "Ty Segall" });
  g.addNode({ id: "fuzz", type: "artist", name: "Fuzz" });
  g.addNode({ id: "wf", type: "artist", name: "White Fence" });
  g.addNode({ id: "osees", type: "artist", name: "Osees" });
  g.markExpanded("ty");
  g.addEdge({ id: "ty-member_of-fuzz", source: "ty", target: "fuzz", type: "member_of" });
  g.addEdge({ id: "ty-produced_for-wf", source: "ty", target: "wf", type: "produced_for" });
  g.addEdge({ id: "ty-opened_for-osees", source: "ty", target: "osees", type: "opened_for" });
  return g;
}

describe("SceneGraph visible relationship types", () => {
  it("draws everything without a filter", () => {
    const d = graph().toForceGraphData();
    expect(d.links).toHaveLength(3);
    expect(d.nodes).toHaveLength(4);
  });

  it("hides edges of unticked types and the artists only they reach", () => {
    const d = graph().toForceGraphData(new Set<EdgeType>(DEFAULT_EXPLORE_RELS));
    expect(d.links.map((l) => l.type)).toEqual(["member_of"]);
    expect(d.nodes.map((n) => n.id).sort()).toEqual(["fuzz", "ty"]);
  });

  it("keeps an expanded artist even with nothing ticked", () => {
    const d = graph().toForceGraphData(new Set<EdgeType>());
    expect(d.links).toHaveLength(0);
    expect(d.nodes.map((n) => n.id)).toEqual(["ty"]);
  });
});

describe("legend", () => {
  it("defaults to the band relationships", () => {
    expect(DEFAULT_EXPLORE_RELS).toEqual(["member_of", "former_member_of", "support_musician"]);
  });

  it("gives every relationship type its own colour", () => {
    const colors = EXPLORE_RELATIONSHIPS.map((r) => EDGE_COLORS[r.type]);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
