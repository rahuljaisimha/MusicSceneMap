import { useState, useCallback, useEffect, useRef } from "react";
import { SearchBar } from "../components/SearchBar";
import { GraphView } from "../components/GraphView";
import { InfoPanel } from "../components/InfoPanel";
import { DebugConsole } from "../components/DebugConsole";
import { SceneGraph } from "../graph/SceneGraph";
import { getDb, isDbLoaded } from "../db/graphDb";
import { findArtist, findArtistById, getArtistNeighbors } from "../db/graphSource";
import { debugLog } from "../debug/DebugLog";
import { resolveSearchTarget, type SearchResolution } from "./searchResolution";
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
    case "opened_for": return "opened_for";
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
 * Expand an artist into the SceneGraph. Resolves by exact MBID when the user
 * clicked a node (avoids name ambiguity, e.g. two artists both named "Fuzz"),
 * else by name. Only person/group nodes — albums are skipped. Works before the
 * graph DB has downloaded (graphSource falls back to the server).
 */
async function expandArtist(target: SearchResolution, graph: SceneGraph): Promise<boolean> {
  const node = target.by === "id"
    ? await findArtistById(target.id)
    : await findArtist(target.name, { partial: true });
  if (!node) return false;
  const { id, name, type } = node;
  const nodeType = mapNodeType(type);

  // Add the central node
  graph.addNode({
    id,
    type: nodeType,
    name,
  } as GraphNode);
  graph.markExpanded(id);

  // Get all neighbors (skip album nodes — only show artists/bands)
  const neighbors = await getArtistNeighbors(id);
  const filtered = neighbors.filter((n) => n.node.type !== "album");
  debugLog.log(`Expanding "${name}": found ${filtered.length} connections (${neighbors.length - filtered.length} albums hidden)`);

  for (const { node: neighbor, relType, outgoing } of filtered) {
    const neighborNodeType = mapNodeType(neighbor.type);
    graph.addNode({
      id: neighbor.id,
      type: neighborNodeType,
      name: neighbor.name,
    } as GraphNode);

    const edgeType = mapEdgeType(relType);
    // "opened_for" points opener -> headliner; keep that direction when the
    // expanded artist is the headliner. Other relationships are drawn from it.
    const [source, target] = edgeType === "opened_for" && outgoing === false ? [neighbor.id, id] : [id, neighbor.id];
    graph.addEdge({
      id: `${source}-${edgeType}-${target}`,
      source,
      target,
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
  // Remembers the MBID of the last clicked node so a subsequent search can
  // resolve by ID instead of by ambiguous name (e.g. two artists named "Fuzz").
  const pendingNode = useRef<{ name: string; id: string } | null>(null);

  // The graph downloads in the background (main.tsx); search works meanwhile.
  useEffect(() => {
    if (!dbReady) {
      getDb().then(() => setDbReady(true)).catch(() => {
        /* searches keep using the server */
      });
    }
  }, [dbReady]);

  const handleSearch = useCallback(
    async (artistName: string, pickedId?: string) => {
      setLoading(true);
      setError(null);
      try {
        // Resolve by exact MBID if the query matches the last-clicked node, else by name
        // (a dropdown pick carries its MBID, which is exact too)
        const resolution = resolveSearchTarget(artistName, pickedId ? { name: artistName, id: pickedId } : pendingNode.current);
        const found = await expandArtist(resolution, graph);
        pendingNode.current = null;
        if (!found) {
          setError(`No artist found for "${artistName}"`);
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
    pendingNode.current = null;
    setError(null);
  }, [graph]);

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      if (node.id) {
        const graphNode = graph.getNode(String(node.id));
        setSelectedNode(graphNode ?? null);
        if (graphNode) {
          setPrefill(graphNode.name);
          // Remember this exact node so search resolves by MBID, not name
          pendingNode.current = { name: graphNode.name, id: graphNode.id };
        }
      }
    },
    [graph]
  );

  return (
    <>
      <SearchBar onSearch={handleSearch} loading={loading} prefill={prefill} onPrefillConsumed={() => setPrefill(null)} onReset={handleReset} />
      <DebugConsole />
      {!dbReady && <div style={{ color: "#888", padding: "0.5rem 1rem", fontSize: "0.85rem" }}>Loading the full graph in the background. Searches use the server until it's ready.</div>}
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
