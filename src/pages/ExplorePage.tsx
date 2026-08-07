import { useState, useCallback, useEffect } from "react";
import { SearchBar } from "../components/SearchBar";
import { GraphView } from "../components/GraphView";
import { InfoPanel } from "../components/InfoPanel";
import { DebugConsole } from "../components/DebugConsole";
import { SceneGraph } from "../graph/SceneGraph";
import { getDb, findNodeByName, getNeighbors, searchNodes, isDbLoaded } from "../db/graphDb";
import { debugLog } from "../debug/DebugLog";
import type { GraphNode, NodeType, EdgeType } from "../graph/types";

/** Map SQLite node types to our graph node types */
function mapNodeType(dbType: string): NodeType {
  switch (dbType) {
    case "person": return "musician";
    case "group": return "artist";
    case "album": return "label"; // reuse label color for albums for now
    default: return "artist";
  }
}

/** Map SQLite edge types to our graph edge types */
function mapEdgeType(dbRelType: string): EdgeType {
  switch (dbRelType) {
    case "member_of": return "member_of";
    case "former_member_of": return "former_member_of";
    case "support_musician": return "support_musician";
    case "producer": return "collaborated_with";
    case "vocal": return "collaborated_with";
    case "instrument": return "collaborated_with";
    case "mix": return "collaborated_with";
    case "engineer": return "collaborated_with";
    case "recording": return "collaborated_with";
    case "album_by": return "signed_to";
    default: return "collaborated_with";
  }
}

/**
 * Expand an artist from the SQLite database into the SceneGraph.
 * Only allows person/group nodes — skips albums.
 */
function expandFromDb(name: string, graph: SceneGraph): boolean {
  const node = findNodeByName(name);
  if (!node) {
    // Try partial match, but only persons/groups
    const results = searchNodes(name, 10).filter((n) => n.type !== "album");
    if (results.length === 0) return false;
    return expandNodeById(results[0]!.id, results[0]!.name, results[0]!.type, graph);
  }
  if (node.type === "album") return false;
  return expandNodeById(node.id, node.name, node.type, graph);
}

function expandNodeById(id: string, name: string, type: string, graph: SceneGraph): boolean {
  const nodeType = mapNodeType(type);

  // Add the central node
  graph.addNode({
    id,
    type: nodeType,
    name,
  } as GraphNode);
  graph.markExpanded(id);

  // Get all neighbors (skip album nodes — only show artists/bands)
  const neighbors = getNeighbors(id);
  const filtered = neighbors.filter((n) => n.node.type !== "album");
  debugLog.log(`Expanding "${name}": found ${filtered.length} connections (${neighbors.length - filtered.length} albums hidden)`);

  for (const { node: neighbor, relType } of filtered) {
    const neighborNodeType = mapNodeType(neighbor.type);
    graph.addNode({
      id: neighbor.id,
      type: neighborNodeType,
      name: neighbor.name,
    } as GraphNode);

    const edgeType = mapEdgeType(relType);
    const edgeId = `${id}-${edgeType}-${neighbor.id}`;
    graph.addEdge({
      id: edgeId,
      source: id,
      target: neighbor.id,
      type: edgeType,
    });
  }

  return true;
}

export function ExplorePage() {
  const [graph] = useState(() => {
    const g = new SceneGraph();
    g.load();
    return g;
  });
  const [graphData, setGraphData] = useState(graph.toForceGraphData());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [dbReady, setDbReady] = useState(isDbLoaded());
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<string | null>(null);

  // Load the database on mount
  useEffect(() => {
    if (!dbReady) {
      getDb().then(() => setDbReady(true)).catch((e) => {
        setError(`Failed to load database: ${e instanceof Error ? e.message : "unknown"}`);
      });
    }
  }, [dbReady]);

  const handleSearch = useCallback(
    async (artistName: string) => {
      setLoading(true);
      setError(null);
      try {
        if (!isDbLoaded()) {
          await getDb();
        }
        const found = expandFromDb(artistName, graph);
        if (!found) {
          setError(`No artist found for "${artistName}" in the database`);
        } else {
          graph.save();
          setGraphData(graph.toForceGraphData());
        }
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
      <SearchBar onSearch={handleSearch} loading={loading || !dbReady} prefill={prefill} onPrefillConsumed={() => setPrefill(null)} onReset={handleReset} />
      <DebugConsole />
      {!dbReady && <div style={{ color: "#888", padding: "0.5rem 1rem" }}>Loading graph database…</div>}
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
