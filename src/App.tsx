import { useState, useCallback } from "react";
import { SearchBar } from "./components/SearchBar";
import { GraphView } from "./components/GraphView";
import { InfoPanel } from "./components/InfoPanel";
import { SceneGraph } from "./graph/SceneGraph";
import { expandArtist } from "./graph/expand";
import type { GraphNode } from "./graph/types";

function App() {
  const [graph] = useState(() => new SceneGraph());
  const [graphData, setGraphData] = useState(graph.toForceGraphData());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(
    async (artistName: string) => {
      setLoading(true);
      setError(null);
      try {
        await expandArtist(artistName, graph);
        setGraphData(graph.toForceGraphData());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [graph]
  );

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      if (node.id) {
        const graphNode = graph.getNode(String(node.id));
        setSelectedNode(graphNode ?? null);
      }
    },
    [graph]
  );

  return (
    <>
      <SearchBar onSearch={handleSearch} loading={loading} />
      {error && <div style={{ color: "#ff6b6b", padding: "0.5rem 1rem" }}>{error}</div>}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <GraphView data={graphData} onNodeClick={handleNodeClick} />
        {selectedNode && (
          <InfoPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </>
  );
}

export default App;
