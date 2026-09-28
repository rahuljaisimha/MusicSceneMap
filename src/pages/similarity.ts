/**
 * Pure logic for scoring how similar a target artist is to a list of artists,
 * based on the structure of the music graph.
 *
 * This is deliberately decoupled from React and from the sql.js DB: it operates
 * over a small `GraphAccess` interface so it can be unit-tested with an in-memory
 * fake. The SimilarityPage wires the real graphDb helpers into this interface.
 *
 * Similarity philosophy (per the project thesis): two artists are similar when
 * they share musicians, collaborators and history, and the signal is stronger
 * when *multiple independent paths* connect them. We now use *all* parts of the
 * graph — band memberships, support roles, and album credits — and weight each
 * connection by its relationship type:
 *
 *   member_of        > former_member_of > support_musician   (band ties)
 *   album credits     scored by the number of shared credits (collaboration)
 *
 * The weights below are PLACEHOLDER values, intended to be tuned later.
 */

/** A node in the graph as exposed to the scorer. */
export interface SimNode {
  id: string;
  name: string;
  type: string; // "person" | "group" | "album"
}

/** A neighbor of a node, tagged with the relationship type of the edge. */
export interface SimNeighbor {
  node: SimNode;
  relType: string;
}

/** Minimal graph interface the scorer depends on. */
export interface GraphAccess {
  /** Resolve an artist name to a node (case-insensitive), or null if unknown. */
  findNodeByName(name: string): SimNode | null;
  /**
   * All neighbors of a node (both directions), tagged with relationship type.
   * Includes album nodes — the scorer decides how to use them.
   */
  neighbors(nodeId: string): SimNeighbor[];
}

// --- Relationship weights (PLACEHOLDER — tune later) ------------------------

/**
 * Per-relationship-type weight in the range 0..1, where higher means a closer
 * musical relationship. These are placeholders; tune once we have real signal
 * (e.g. from the relationship's added details / MusicBrainz attributes).
 */
export const REL_WEIGHTS: Record<string, number> = {
  member_of: 1.0, // current band member — strongest tie
  former_member_of: 0.75, // former member — slightly less
  support_musician: 0.6, // supporting/touring musician — slightly less again
  // Album-credit relationship types. Each is a comparatively weak single tie;
  // strength accrues via the *count* of shared credits (see ALBUM_CREDIT_*).
  producer: 0.4,
  vocal: 0.35,
  instrument: 0.35,
  mix: 0.3,
  engineer: 0.3,
  recording: 0.3,
};

/** Fallback weight for any relationship type not in REL_WEIGHTS. */
export const DEFAULT_REL_WEIGHT = 0.25;

/** Relationship types that connect a person/group directly to another (non-album). */
export const BAND_REL_TYPES = new Set([
  "member_of",
  "former_member_of",
  "support_musician",
]);

/** Relationship types that represent an album credit (person <-> album). */
export const ALBUM_CREDIT_REL_TYPES = new Set([
  "producer",
  "vocal",
  "instrument",
  "mix",
  "engineer",
  "recording",
]);

/**
 * Album-credit collaboration weighting. Two artists who both have credits on
 * the same album(s) are collaborators; the strength grows with the number of
 * shared album credits but saturates (diminishing returns).
 *   1 shared credit  -> ~0.30, 2 -> ~0.45, 4 -> ~0.60, many -> ALBUM_CREDIT_MAX
 */
export const ALBUM_CREDIT_MAX = 0.7;
export const ALBUM_CREDIT_HALF = 3; // credits at which we reach half of the max

export function relWeight(relType: string): number {
  return REL_WEIGHTS[relType] ?? DEFAULT_REL_WEIGHT;
}

/** Convert a shared-album-credit count into a 0..ALBUM_CREDIT_MAX weight. */
export function albumCreditWeight(sharedCredits: number): number {
  if (sharedCredits <= 0) return 0;
  return ALBUM_CREDIT_MAX * (sharedCredits / (sharedCredits + ALBUM_CREDIT_HALF));
}

// --- Result shapes ----------------------------------------------------------

/** A single connection between the target and a list artist, for display. */
export interface Connection {
  /** "direct" (edge between the two), "shared" (common neighbor), or "album". */
  kind: "direct" | "shared" | "album";
  /** Relationship type driving this connection (or "album_credit"). */
  relType: string;
  /** Human-readable label, e.g. a shared bandmate or album name. */
  via: string;
  /** Weight this connection contributed, 0..1. */
  weight: number;
}

/** Per-list-artist contribution to the overall similarity. */
export interface PairScore {
  /** The list artist's name (as resolved, else as typed). */
  name: string;
  /** Whether the list artist was found in the graph. */
  found: boolean;
  /** Graph distance (hops) to the target over all relationships, or null. */
  distance: number | null;
  /** Strongest connections between target and this artist, for display. */
  connections: Connection[];
  /** This pair's contribution to the score, 0..100. */
  score: number;
}

export interface SimilarityResult {
  targetName: string;
  targetFound: boolean;
  overallScore: number;
  pairs: PairScore[];
}

/** How many hops out to explore when measuring distance. */
const MAX_DISTANCE = 6;

// --- Graph helpers ----------------------------------------------------------

/**
 * BFS distance (in hops) between two node ids over ALL relationships.
 * Album nodes are traversable connectors. Returns null if unreachable.
 */
function bfsDistance(
  graph: GraphAccess,
  startId: string,
  endId: string,
  maxDepth = MAX_DISTANCE
): number | null {
  if (startId === endId) return 0;
  const visited = new Set<string>([startId]);
  let frontier = [startId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const { node: nb } of graph.neighbors(id)) {
        if (visited.has(nb.id)) continue;
        if (nb.id === endId) return depth;
        visited.add(nb.id);
        next.push(nb.id);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Split a node's neighbors into:
 *  - direct: person/group neighbors keyed by id -> best (relType, weight)
 *  - albums: album neighbors keyed by id -> the credit relType linking to them
 */
interface Split {
  direct: Map<string, { name: string; relType: string; weight: number }>;
  albums: Map<string, { name: string; relType: string }>;
}

function splitNeighbors(graph: GraphAccess, nodeId: string): Split {
  const direct = new Map<string, { name: string; relType: string; weight: number }>();
  const albums = new Map<string, { name: string; relType: string }>();

  for (const { node, relType } of graph.neighbors(nodeId)) {
    if (node.type === "album") {
      // Keep one credit relType per album (first seen is fine for weighting).
      if (!albums.has(node.id)) albums.set(node.id, { name: node.name, relType });
    } else {
      const w = relWeight(relType);
      const existing = direct.get(node.id);
      if (!existing || w > existing.weight) {
        direct.set(node.id, { name: node.name, relType, weight: w });
      }
    }
  }
  return { direct, albums };
}

// --- Scoring ----------------------------------------------------------------

/**
 * Convert a graph distance into a 0..1 proximity factor.
 * distance 1 -> 1.0, 2 -> 0.6, 3 -> 0.36 ... (0.6^(d-1)); 0 -> 1.0; null -> 0.
 */
export function distanceFactor(distance: number | null): number {
  if (distance === null) return 0;
  if (distance <= 1) return 1;
  return Math.pow(0.6, distance - 1);
}

/**
 * Gather the weighted connections between the target and one list artist:
 *  - direct edge between them (weighted by rel type)
 *  - shared direct neighbors (bandmates / collaborators)
 *  - shared albums (weighted by the number of shared album credits)
 */
export function collectConnections(
  targetSplit: Split,
  artistId: string,
  artistSplit: Split,
  targetHasArtistDirect: { relType: string; weight: number } | undefined
): Connection[] {
  const connections: Connection[] = [];

  // 1. Direct edge target <-> artist.
  if (targetHasArtistDirect) {
    connections.push({
      kind: "direct",
      relType: targetHasArtistDirect.relType,
      via: "direct connection",
      weight: targetHasArtistDirect.weight,
    });
  }

  // 2. Shared direct neighbors (common bandmates / collaborators).
  for (const [id, info] of artistSplit.direct) {
    if (id === artistId) continue;
    const shared = targetSplit.direct.get(id);
    if (shared) {
      // Weight the shared tie by the weaker of the two edges (both must hold).
      const weight = Math.min(shared.weight, info.weight);
      connections.push({
        kind: "shared",
        relType: shared.relType === info.relType ? shared.relType : "member_of",
        via: info.name,
        weight,
      });
    }
  }

  // 3. Shared albums -> collaboration weighted by shared credit count.
  let sharedCredits = 0;
  const sharedAlbumNames: string[] = [];
  for (const [id, info] of artistSplit.albums) {
    if (targetSplit.albums.has(id)) {
      sharedCredits++;
      if (sharedAlbumNames.length < 5) sharedAlbumNames.push(info.name);
    }
  }
  if (sharedCredits > 0) {
    connections.push({
      kind: "album",
      relType: "album_credit",
      via:
        sharedCredits === 1
          ? sharedAlbumNames[0]!
          : `${sharedCredits} shared albums (${sharedAlbumNames.join(", ")})`,
      weight: albumCreditWeight(sharedCredits),
    });
  }

  // Strongest first.
  return connections.sort((a, b) => b.weight - a.weight);
}

/**
 * Score a single (target, listArtist) pair, 0..100.
 *
 * Blends:
 *  - connection strength (best weighted connection + diminishing extra ones)
 *  - graph proximity (BFS distance over all relationships)
 */
export function scorePair(
  graph: GraphAccess,
  target: SimNode,
  targetSplit: Split,
  listArtistName: string
): PairScore {
  const node = graph.findNodeByName(listArtistName);
  if (!node) {
    return { name: listArtistName, found: false, distance: null, connections: [], score: 0 };
  }

  if (node.id === target.id) {
    return {
      name: node.name,
      found: true,
      distance: 0,
      connections: [{ kind: "direct", relType: "member_of", via: "same artist", weight: 1 }],
      score: 100,
    };
  }

  const artistSplit = splitNeighbors(graph, node.id);
  const targetDirectToArtist = targetSplit.direct.get(node.id);

  const connections = collectConnections(
    targetSplit,
    node.id,
    artistSplit,
    targetDirectToArtist
  );

  const distance = bfsDistance(graph, target.id, node.id);

  // Connection strength: strongest connection dominates, additional independent
  // connections add with diminishing returns (multiple paths = stronger signal).
  let connectionStrength = 0;
  if (connections.length > 0) {
    connectionStrength = connections[0]!.weight;
    let decay = 0.5;
    for (let i = 1; i < connections.length; i++) {
      connectionStrength += connections[i]!.weight * decay;
      decay *= 0.5;
    }
    connectionStrength = Math.min(1, connectionStrength);
  }

  const proximity = distanceFactor(distance);

  // Connection strength (rel-type weighted) is the primary signal (70%),
  // graph proximity fills in the rest (30%).
  const score = Math.round((0.7 * connectionStrength + 0.3 * proximity) * 100);

  return {
    name: node.name,
    found: true,
    distance,
    connections: connections.slice(0, 5),
    score,
  };
}

/**
 * Compute the similarity of `targetName` to `listArtists` using the full graph.
 */
export function computeSimilarity(
  graph: GraphAccess,
  targetName: string,
  listArtists: string[]
): SimilarityResult {
  const target = graph.findNodeByName(targetName);
  if (!target) {
    return {
      targetName,
      targetFound: false,
      overallScore: 0,
      pairs: listArtists.map((name) => ({
        name,
        found: false,
        distance: null,
        connections: [],
        score: 0,
      })),
    };
  }

  const targetSplit = splitNeighbors(graph, target.id);

  const pairs = listArtists.map((name) => scorePair(graph, target, targetSplit, name));
  const overallScore = aggregateScore(pairs);
  const sortedPairs = [...pairs].sort((a, b) => b.score - a.score);

  return { targetName: target.name, targetFound: true, overallScore, pairs: sortedPairs };
}

/**
 * Score a single artist (by name) against a list of artists, returning just the
 * overall 0..100 similarity. Convenience wrapper around `computeSimilarity` for
 * ranking external candidates (e.g. concert headliners) against a taste profile.
 *
 * An artist not present in the graph scores 0 (see `SimilarityResult.targetFound`).
 */
export function scoreArtistAgainstList(
  graph: GraphAccess,
  artistName: string,
  listArtists: string[]
): { score: number; found: boolean; result: SimilarityResult } {
  const result = computeSimilarity(graph, artistName, listArtists);
  return { score: result.overallScore, found: result.targetFound, result };
}

/**
 * Aggregate per-pair scores into an overall 0..100 similarity.
 *
 * 60% best connection, 40% average across the list — a single very strong
 * connection meaningfully lifts the score (multiple independent paths =
 * stronger recommendation) while broad-but-weak links still count.
 */
export function aggregateScore(pairs: PairScore[]): number {
  const scored = pairs.filter((p) => p.found);
  if (scored.length === 0) return 0;

  const scores = scored.map((p) => p.score);
  const best = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  return Math.round(0.6 * best + 0.4 * avg);
}
