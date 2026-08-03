import type {
  GraphNode,
  GraphEdge,
  ForceGraphData,
  ForceGraphNodeData,
  ForceGraphLinkData,
} from "./types";
import { NODE_COLORS, EDGE_COLORS } from "./types";

/**
 * In-memory graph that accumulates nodes and edges as data is fetched.
 * Provides deduplication and serialization to force-graph format.
 */
export class SceneGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      // Merge metadata
      const existing = this.nodes.get(node.id)!;
      this.nodes.set(node.id, {
        ...existing,
        ...node,
        metadata: { ...existing.metadata, ...node.metadata },
      });
    } else {
      this.nodes.set(node.id, node);
    }
  }

  addEdge(edge: GraphEdge): void {
    // Deduplicate by composite key
    if (!this.edges.has(edge.id)) {
      this.edges.set(edge.id, edge);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNeighbors(nodeId: string): GraphNode[] {
    const neighborIds = new Set<string>();
    for (const edge of this.edges.values()) {
      if (edge.source === nodeId) neighborIds.add(edge.target);
      if (edge.target === nodeId) neighborIds.add(edge.source);
    }
    return [...neighborIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  toForceGraphData(): ForceGraphData {
    const nodes: ForceGraphNodeData[] = [];
    const links: ForceGraphLinkData[] = [];

    for (const node of this.nodes.values()) {
      nodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        color: NODE_COLORS[node.type],
        val: node.type === "artist" ? 3 : node.type === "venue" ? 2 : 1,
      });
    }

    for (const edge of this.edges.values()) {
      // Only include edges where both nodes exist
      if (this.nodes.has(edge.source) && this.nodes.has(edge.target)) {
        links.push({
          source: edge.source,
          target: edge.target,
          type: edge.type,
          color: EDGE_COLORS[edge.type],
        });
      }
    }

    return { nodes, links };
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }
}
