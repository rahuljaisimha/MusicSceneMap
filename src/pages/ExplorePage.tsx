import { useState, useCallback } from "react";
import { SearchBar } from "../components/SearchBar";
import { GraphView } from "../components/GraphView";
import { InfoPanel } from "../components/InfoPanel";
import { DebugConsole } from "../components/DebugConsole";
import { SceneGraph } from "../graph/SceneGraph";
import { expandArtist } from "../graph/expand";
import type { GraphNode } from "../graph/types";

export function ExplorePage() {
  const [graph] = useState(() => {
    const g = new SceneGraph();
    g.load();
    return g;
  });
  const [graphData, setGraphData] = useState(graph.toForceGraphData());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);

  const handleSearch = useCallback(
    async (artistName: string) => {
      setLoading(true);
      setError(null);
      try {
        await expandArtist(artistName, graph);
        graph.save();
        setGraphData(graph.toForceGraphData());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [graph]
  );

  const handleReset = useCallback(() => {
    graph.clear();
    setGraphData(graph.toForceGraphData());
    setSelectedNode(null);
    setError(null);
  }, [graph]);

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      if (node.id) {
        const graphNode = graph.getNode(String(node.id));
        setSelectedNode(graphNode ?? null);
        if (graphNode) {
          setPrefill(graphNode.name);
        }
      }
    },
    [graph]
  );

  return (
    <>
      <SearchBar onSearch={handleSearch} loading={loading} prefill={prefill} onPrefillConsumed={() => setPrefill(null)} onReset={handleReset} />
      <DebugConsole />
      {error && <div style={{ color: "#ff6b6b", padding: "0.5rem 1rem" }}>{error}</div>}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>
        <GraphView data={graphData} onNodeClick={handleNodeClick} />
        {selectedNode && (
          <InfoPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </>
  );
}
