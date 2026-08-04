// --- Node Types ---

export type NodeType =
  | "artist"
  | "musician"
  | "venue"
  | "city"
  | "scene"
  | "label"
  | "festival";

export interface BaseNode {
  id: string; // typically MBID or composite key
  type: NodeType;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface ArtistNode extends BaseNode {
  type: "artist";
  mbid?: string;
  disambiguation?: string;
  country?: string;
}

export interface MusicianNode extends BaseNode {
  type: "musician";
  mbid?: string;
}

export interface VenueNode extends BaseNode {
  type: "venue";
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface CityNode extends BaseNode {
  type: "city";
  country?: string;
}

export interface SceneNode extends BaseNode {
  type: "scene";
}

export interface LabelNode extends BaseNode {
  type: "label";
  mbid?: string;
}

export interface FestivalNode extends BaseNode {
  type: "festival";
}

export type GraphNode =
  | ArtistNode
  | MusicianNode
  | VenueNode
  | CityNode
  | SceneNode
  | LabelNode
  | FestivalNode;

// --- Edge Types ---

export type EdgeType =
  | "member_of"
  | "former_member_of"
  | "played_at"
  | "located_in"
  | "part_of_scene"
  | "signed_to"
  | "collaborated_with"
  | "opened_for"
  | "toured_with"
  | "performed_at_festival";

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

// --- Force Graph rendering data ---

export interface ForceGraphNodeData {
  id: string;
  name: string;
  type: NodeType;
  color: string;
  val: number; // node size
  expanded: boolean;
}

export interface ForceGraphLinkData {
  source: string;
  target: string;
  type: EdgeType;
  color: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNodeData[];
  links: ForceGraphLinkData[];
}

// --- Color map for node types ---

export const NODE_COLORS: Record<NodeType, string> = {
  artist: "#ff6b6b",
  musician: "#feca57",
  venue: "#48dbfb",
  city: "#0abde3",
  scene: "#a29bfe",
  label: "#55efc4",
  festival: "#fd79a8",
};

export const EDGE_COLORS: Record<EdgeType, string> = {
  member_of: "#feca57",
  former_member_of: "#636e72",
  played_at: "#48dbfb",
  located_in: "#0abde3",
  part_of_scene: "#a29bfe",
  signed_to: "#55efc4",
  collaborated_with: "#ff6b6b",
  opened_for: "#fdcb6e",
  toured_with: "#e17055",
  performed_at_festival: "#fd79a8",
};
