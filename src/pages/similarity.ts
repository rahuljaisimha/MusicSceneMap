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
  /** True when the looked-up node is the edge's source; undefined when the source doesn't say. */
  outgoing?: boolean;
}

/** One hop of a path: `from` and `to` are joined by a `relType` edge. */
export interface PathStep {
  from: SimNode;
  to: SimNode;
  relType: string;
  /** True when `from` is the edge's source (e.g. the member, or the opener); undefined when unknown. */
  fromIsSource?: boolean;
}

/**
 * An artist as the user gave it: a typed name, or the artist they picked from a
 * dropdown with its MusicBrainz ID. Several artists can share a name ("Fuzz"),
 * so a picked artist is looked up by its ID, never by name.
 */
export type ArtistRef = string | { name: string; id?: string };

export function refName(ref: ArtistRef): string {
  return typeof ref === "string" ? ref : ref.name;
}

export function refId(ref: ArtistRef): string | undefined {
  return typeof ref === "string" ? undefined : ref.id;
}

/** Minimal graph interface the scorer depends on. */
export interface GraphAccess {
  /** Resolve an artist name to a node (case-insensitive), or null if unknown. */
  findNodeByName(name: string): SimNode | null;
  /** Resolve a node by id (MusicBrainz ID). Optional: without it, picked artists resolve by name. */
  findNodeById?(id: string): SimNode | null;
  /**
   * All neighbors of a node (both directions), tagged with relationship type.
   * Includes album nodes — the scorer decides how to use them.
   */
  neighbors(nodeId: string): SimNeighbor[];
}

/** The node an artist reference means: by ID when it has one (and the graph can look ids up), else by name. */
export function resolveArtist(graph: GraphAccess, ref: ArtistRef): SimNode | null {
  const id = refId(ref);
  if (id && graph.findNodeById) return graph.findNodeById(id);
  return graph.findNodeByName(refName(ref));
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
  collaborator: 0.5, // album co-credit between two people (graphs built before collaborated_with)
  collaborated_with: 0.5, // sang, played or performed on the other artist's records (count = song credits)
  produced_for: 0.45, // produced the other artist's records
  opened_for: 0.45, // one act opened for the other (concert-database; placeholder)
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
  /** The graph artist this name matched (absent when not found). */
  node?: SimNode;
  /** A shortest path from this artist to the target, one step per hop ([] for the same artist; null when none). */
  path?: PathStep[] | null;
  /** Connection strength, 0..1 (70% of the score). */
  strength?: number;
  /** Closeness from the distance, 0..1 (30% of the score). */
  proximity?: number;
  /** Strongest connections between target and this artist, for display. */
  connections: Connection[];
  /** This pair's contribution to the score, 0..100. */
  score: number;
}

export interface SimilarityResult {
  targetName: string;
  /** The graph artist the target name matched. */
  target?: SimNode;
  targetFound: boolean;
  overallScore: number;
  pairs: PairScore[];
}

/** How many hops out to explore when measuring distance. */
const MAX_DISTANCE = 6;

// --- Graph helpers ----------------------------------------------------------

/**
 * A shortest path (BFS) between two nodes over ALL relationships, one step per
 * hop from `start` to the node with `endId`. Album nodes are traversable
 * connectors. [] when they're the same node; null if unreachable within maxDepth.
 */
export function findPath(
  graph: GraphAccess,
  start: SimNode,
  endId: string,
  maxDepth = MAX_DISTANCE
): PathStep[] | null {
  if (start.id === endId) return [];
  const cameFrom = new Map<string, PathStep>();
  const visited = new Set<string>([start.id]);
  let frontier = [start];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: SimNode[] = [];
    for (const from of frontier) {
      for (const { node: nb, relType, outgoing } of graph.neighbors(from.id)) {
        if (visited.has(nb.id)) continue;
        visited.add(nb.id);
        cameFrom.set(nb.id, { from, to: nb, relType, fromIsSource: outgoing });
        if (nb.id === endId) {
          const path: PathStep[] = [];
          for (let id = endId; id !== start.id; ) {
            const step = cameFrom.get(id)!;
            path.unshift(step);
            id = step.from.id;
          }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

/** The same path walked the other way. */
export function reversePath(path: PathStep[]): PathStep[] {
  return path
    .map((s) => ({
      from: s.to,
      to: s.from,
      relType: s.relType,
      fromIsSource: s.fromIsSource === undefined ? undefined : !s.fromIsSource,
    }))
    .reverse();
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

/** Hops that still count as fully close: a direct tie, or one artist in between. */
export const FULL_CLOSENESS_HOPS = 2;

/**
 * Convert a graph distance into a 0..1 proximity factor.
 * distance 0-2 -> 1.0, 3 -> 0.6, 4 -> 0.36 ... (0.6 per hop past 2); null -> 0.
 */
export function distanceFactor(distance: number | null): number {
  if (distance === null) return 0;
  if (distance <= FULL_CLOSENESS_HOPS) return 1;
  return Math.pow(0.6, distance - FULL_CLOSENESS_HOPS);
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
        // Label it by the weaker tie, the one that sets the weight.
        relType: shared.weight <= info.weight ? shared.relType : info.relType,
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
  listArtist: ArtistRef
): PairScore {
  const node = resolveArtist(graph, listArtist);
  if (!node) {
    return { name: refName(listArtist), found: false, distance: null, connections: [], score: 0, path: null };
  }

  if (node.id === target.id) {
    return {
      name: node.name,
      found: true,
      distance: 0,
      node,
      path: [],
      connections: [{ kind: "direct", relType: "member_of", via: "same artist", weight: 1 }],
      strength: 1,
      proximity: 1,
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

  const pathFromTarget = findPath(graph, target, node.id);
  const distance = pathFromTarget ? pathFromTarget.length : null;

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
    node,
    // Read from the list artist to the target ("how does the artist I like lead to this one").
    path: pathFromTarget ? reversePath(pathFromTarget) : null,
    connections: connections.slice(0, 5),
    strength: connectionStrength,
    proximity,
    score,
  };
}

/**
 * Compute the similarity of `targetName` to `listArtists` using the full graph.
 */
export function computeSimilarity(
  graph: GraphAccess,
  targetArtist: ArtistRef,
  listArtists: ArtistRef[]
): SimilarityResult {
  const target = resolveArtist(graph, targetArtist);
  if (!target) {
    return {
      targetName: refName(targetArtist),
      targetFound: false,
      overallScore: 0,
      pairs: listArtists.map((a) => ({
        name: refName(a),
        found: false,
        distance: null,
        connections: [],
        score: 0,
      })),
    };
  }

  const targetSplit = splitNeighbors(graph, target.id);

  const pairs = listArtists.map((a) => scorePair(graph, target, targetSplit, a));
  const overallScore = aggregateScore(pairs);
  const sortedPairs = [...pairs].sort((a, b) => b.score - a.score);

  return { targetName: target.name, target, targetFound: true, overallScore, pairs: sortedPairs };
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
  artist: ArtistRef,
  listArtists: ArtistRef[]
): { score: number; found: boolean; result: SimilarityResult } {
  const result = computeSimilarity(graph, artist, listArtists);
  return { score: result.overallScore, found: result.targetFound, result };
}

/** Other liked artists add a bonus only when they match at least this well. */
export const BONUS_THRESHOLD = 60;
/** Share of the 2nd-best match's score added as a bonus; each further match adds half the previous share. */
export const BONUS_SHARE = 0.25;

/**
 * Aggregate per-pair scores into an overall 0..100 similarity.
 *
 * The best match counts in full. Every other liked artist that also matches
 * well (>= BONUS_THRESHOLD, 60) adds a bonus: the 2nd adds 25% of its score, the
 * 3rd 12.5%, the 4th 6.25%... (the same diminishing returns as the connections
 * within a pair), capped at 100. So fitting several of your artists lifts the
 * score, and weak matches never pull it down: adding an artist to your list
 * can't lower anything.
 */
export function aggregateScore(pairs: PairScore[]): number {
  const scores = pairs.filter((p) => p.found).map((p) => p.score).sort((a, b) => b - a);
  if (scores.length === 0) return 0;

  let total = scores[0]!;
  let share = BONUS_SHARE;
  for (const s of scores.slice(1)) {
    if (s < BONUS_THRESHOLD) break; // sorted: the rest are weaker
    total += s * share;
    share /= 2;
  }
  return Math.min(100, Math.round(total));
}
