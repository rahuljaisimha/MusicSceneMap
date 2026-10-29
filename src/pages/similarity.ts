/**
 * Pure logic for scoring how similar a target artist is to a list of artists,
 * based on the structure of the music graph.
 *
 * This is deliberately decoupled from React and from the sql.js DB: it operates
 * over a small `GraphAccess` interface so it can be unit-tested with an in-memory
 * fake. The SimilarityPage wires the real graphDb helpers into this interface.
 *
 * The graph is treated as a weighted graph: each relationship has a weight
 * (REL_WEIGHTS, 0..1; a band membership is 1.0, producing someone's records
 * 0.3), stored as an edge length −ln(weight) (REL_DISTANCES), so strong ties are
 * short. The first FREE_HOPS (2) hops are free; every hop after that also adds
 * HOP_DISTANCE (−ln 0.9), so a chain of members doesn't stay at 100 forever.
 * Two artists are as close as the shortest path between them:
 *
 *   pair score = 100 × e^(−path length)
 *              = 100 × (weights along the path, multiplied) × 0.9^(hops − 2, if more than 2)
 *
 * Examples: Ty Segall — member — Fuzz = 100; bandmates Mikal Cronin — member —
 * Ty Segall Band — member — Ty Segall = 100; Fuzz — Ty Segall — opened for
 * Osees (3 shows) ← opened for — Iguana Death Cult = 1.0 × 0.9 × 0.8 × 0.9 = 65.
 *
 * One search (Dijkstra from the compared artist) finds the strongest path to
 * every liked artist. The weights are placeholders, intended to be tuned.
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
  /** How often: song credits for collaborated_with / produced_for, shows for opened_for. Unknown when absent. */
  count?: number;
}

/** One hop of a path: `from` and `to` are joined by a `relType` edge. */
export interface PathStep {
  from: SimNode;
  to: SimNode;
  relType: string;
  /** The weight this hop counted for, 0..1: REL_WEIGHTS, damped for hub artists (see HUB_DAMPED). */
  weight: number;
  /** The weight before hub damping: REL_WEIGHTS, raised for repeats (see REPEATS). Defaults to `weight`. */
  baseWeight?: number;
  /** How often (song credits, shows), when the graph knows. */
  count?: number;
  /** The hub artists that damped this hop: their count of this kind of link. */
  hubs?: Array<{ node: SimNode; count: number }>;
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
  /**
   * How many `relType` links a node has (both directions), for hub damping.
   * Optional; undefined when unknown, and then the hop isn't damped.
   */
  degree?(nodeId: string, relType: string): number | undefined;
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
  former_member_of: 0.85, // former member
  support_musician: 0.8, // touring or supporting musician
  collaborator: 0.8, // album co-credit between two people (graphs built before collaborated_with)
  collaborated_with: 0.8, // sang, played or performed on the other artist's records
  produced_for: 0.3, // produced the other artist's records: weak once, never as close as the others (REPEATS)
  opened_for: 0.8, // opened for the headliner at least once (concert-database)
  // Album credits (person -> album), from older graphs that had album nodes.
  producer: 0.4,
  vocal: 0.35,
  instrument: 0.35,
  mix: 0.3,
  engineer: 0.3,
  recording: 0.3,
};

/** Fallback weight for any relationship type not in REL_WEIGHTS. */
export const DEFAULT_REL_WEIGHT = 0.25;

export function relWeight(relType: string): number {
  return REL_WEIGHTS[relType] ?? DEFAULT_REL_WEIGHT;
}

/**
 * Each weight as an edge length, −ln(weight), worked out once when this module
 * loads: the search only adds lengths up. A weight of 1.0 is length 0.
 */
export const REL_DISTANCES: Record<string, number> = Object.fromEntries(
  Object.entries(REL_WEIGHTS).map(([type, w]) => [type, Math.log(1 / w)])
);
const DEFAULT_REL_DISTANCE = Math.log(1 / DEFAULT_REL_WEIGHT);

export function relDistance(relType: string): number {
  return REL_DISTANCES[relType] ?? DEFAULT_REL_DISTANCE;
}

// --- Repeats ------------------------------------------------------------------

/**
 * How repeating a relationship makes it stronger. REL_WEIGHTS is the weight of a
 * one-time tie.
 *  - `closeGap`: each repeat after the first closes this share of the remaining
 *    gap to `max` (default 1.0), so a frequent collaborator is closer than a
 *    one-time one (collaborating: 0.8 -> 0.84 -> 0.87 ... 0.97 at 10 songs).
 *    Producing climbs slowly to a ceiling below every other relationship's
 *    one-time weight: 0.30 once, 0.46 for 5 songs, 0.61 for an album (12),
 *    0.71 for two, never above 0.75.
 *  - `repeated`: the weight for twice or more, however many more: opening for a
 *    band twice is as telling as opening for them 400 times, and once is
 *    already close.
 */
export const REPEATS: Record<string, { closeGap: number; max?: number } | { repeated: number }> = {
  collaborated_with: { closeGap: 0.2 },
  produced_for: { closeGap: 0.1, max: 0.75 },
  opened_for: { repeated: 0.9 },
};

/** A relationship's weight given how often it happened (unknown count = once). */
export function repeatWeight(relType: string, count?: number): number {
  const w = relWeight(relType);
  const rule = REPEATS[relType];
  if (!rule || count === undefined || count <= 1) return w;
  if ("repeated" in rule) return Math.max(w, rule.repeated);
  const max = rule.max ?? 1;
  return max - (max - w) * (1 - rule.closeGap) ** (count - 1);
}

// --- Hub damping --------------------------------------------------------------

/**
 * Relationships weakened at artists with many of them: being one of Taylor
 * Swift's 133 collaborators says less than being one of King Gizzard's 6. At
 * each end of such a hop the weight is multiplied by (typical / count)^exponent
 * when the artist has more than `typical` links of that kind (never above 1).
 * `typical` is roughly the 90th percentile of the count in the graph.
 * Memberships and opened_for aren't damped: those are strong signals however
 * many an artist has.
 */
export const HUB_DAMPED: Record<string, { typical: number; exponent: number }> = {
  collaborated_with: { typical: 14, exponent: 1 },
  produced_for: { typical: 6, exponent: 1 },
  support_musician: { typical: 2, exponent: 1 },
};
export const HUB_DAMPED_TYPES = Object.keys(HUB_DAMPED);

/** The length a hub adds to a hop: −ln((typical / count)^exponent), 0 when not a hub. */
function hubLength(graph: GraphAccess, node: SimNode, relType: string): { length: number; count?: number } {
  const rule = HUB_DAMPED[relType];
  if (!rule || !graph.degree) return { length: 0 };
  const count = graph.degree(node.id, relType);
  if (count === undefined || count <= rule.typical) return { length: 0 };
  return { length: rule.exponent * Math.log(count / rule.typical), count };
}

// --- Result shapes ----------------------------------------------------------

/** Per-list-artist contribution to the overall similarity. */
export interface PairScore {
  /** The list artist's name (as resolved, else as typed). */
  name: string;
  /** Whether the list artist was found in the graph. */
  found: boolean;
  /** Hops along the strongest path to the target, or null when none was found. */
  distance: number | null;
  /** The graph artist this name matched (absent when not found). */
  node?: SimNode;
  /** The strongest path from this artist to the target ([] for the same artist; null when none). */
  path?: PathStep[] | null;
  /** That path's strength, 0..1 (the score / 100 before rounding). */
  strength?: number;
  /** This pair's score, 0..100. */
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

// --- Strongest paths --------------------------------------------------------

/** Hops that cost nothing beyond their weights: a direct tie, or one artist in between (bandmates). */
export const FREE_HOPS = 2;
/** Each hop past FREE_HOPS multiplies a path's strength by this... */
export const HOP_DAMPING = 0.9;
/** ...that is, adds this much length. */
export const HOP_DISTANCE = Math.log(1 / HOP_DAMPING);
/** Paths longer than this many hops aren't followed. */
export const MAX_HOPS = 6;
/** A pair whose strongest path is weaker than this (a score under 2) scores 0. */
export const MIN_STRENGTH = 0.02;
/**
 * How weak a path the Similarity page still looks for (a score of 0.1), so a pair
 * that scores 0 can still show its closest connection. Ranking (scoreArtistAgainstList)
 * stops at MIN_STRENGTH: it only needs the score, and a deeper search costs time per artist.
 */
export const PATH_MIN_STRENGTH = 0.001;
/**
 * The Similarity page's first, quick pass stops here (a score of 5): its pairs show
 * at once, a pair under it shows 0 while a second pass (`closest`) looks for its
 * closest connection (pendingPairs / mergePairs).
 */
export const QUICK_MIN_STRENGTH = 0.05;
/**
 * With `closest`, a pair weaker than this is searched again from the liked artist's
 * end. A search from a hub (will.i.am, Taylor Swift) can spend its MAX_EXPANDED budget
 * on the hub's huge neighbourhood before it reaches a small artist; from the small
 * artist's end the same path is found in a few hundred expansions.
 */
export const RECHECK_BELOW = 0.05;
/** At most this many artists are expanded per search, to bound the time a search can take. */
export const MAX_EXPANDED = 10000;

/** A path's length: each hop's −ln(weight) plus HOP_DISTANCE per hop after FREE_HOPS. 0 for []. */
export function pathLength(path: PathStep[]): number {
  return path.reduce((d, step, i) => d + Math.log(1 / step.weight) + (i >= FREE_HOPS ? HOP_DISTANCE : 0), 0);
}

/** A path's strength, 0..1: e^(−length), i.e. its weights multiplied × 0.9 per hop after FREE_HOPS. */
export function pathStrength(path: PathStep[]): number {
  return Math.exp(-pathLength(path));
}

/** A min-heap of (length, node id). */
class MinHeap {
  private items: Array<[number, string]> = [];
  get size(): number {
    return this.items.length;
  }
  push(item: [number, string]): void {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (a[parent]![0] <= a[i]![0]) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): [number, string] | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The shortest (strongest) path from `start` to each node in `targetIds`
 * (Dijkstra over REL_DISTANCES + hub damping + HOP_DISTANCE), each read from `start`
 * outwards. A target with no path within MAX_HOPS / `minStrength` (default
 * MIN_STRENGTH) is missing from the result. Stops as soon as every target is settled.
 *
 * Approximate in two corners, both from costs that depend on hop count: a node
 * first reached by a short path at the hop limit isn't expanded further, even if
 * a longer path with fewer hops could have continued; and a node reached first
 * by a path with more hops carries more of the hop damping onward than a
 * slightly longer path with fewer hops would.
 */
export function strongestPaths(
  graph: GraphAccess,
  start: SimNode,
  targetIds: Set<string>,
  minStrength: number = MIN_STRENGTH
): Map<string, PathStep[]> {
  const maxLength = Math.log(1 / minStrength);
  const found = new Map<string, PathStep[]>();
  if (targetIds.has(start.id)) found.set(start.id, []);
  const remaining = new Set([...targetIds].filter((id) => id !== start.id));
  if (remaining.size === 0) return found;

  const dist = new Map<string, number>([[start.id, 0]]);
  const hops = new Map<string, number>([[start.id, 0]]);
  const cameFrom = new Map<string, PathStep>();
  const nodes = new Map<string, SimNode>([[start.id, start]]);
  const settled = new Set<string>();
  const heap = new MinHeap();
  heap.push([0, start.id]);

  const pathTo = (id: string): PathStep[] => {
    const path: PathStep[] = [];
    for (let cur = id; cur !== start.id; ) {
      const step = cameFrom.get(cur)!;
      path.unshift(step);
      cur = step.from.id;
    }
    return path;
  };

  let expanded = 0;
  while (heap.size > 0 && remaining.size > 0) {
    const [d, id] = heap.pop()!;
    if (settled.has(id) || d > (dist.get(id) ?? Infinity)) continue;
    settled.add(id);
    if (remaining.delete(id)) found.set(id, pathTo(id));
    if (remaining.size === 0) break;
    if (hops.get(id)! >= MAX_HOPS || ++expanded > MAX_EXPANDED) continue;

    const from = nodes.get(id)!;
    for (const { node, relType, outgoing, count } of graph.neighbors(id)) {
      if (settled.has(node.id)) continue;
      const atFrom = hubLength(graph, from, relType);
      const atTo = hubLength(graph, node, relType);
      const repeated = count !== undefined && count > 1 && relType in REPEATS;
      const base = repeated ? repeatWeight(relType, count) : relWeight(relType);
      const edge = (repeated ? Math.log(1 / base) : relDistance(relType)) + atFrom.length + atTo.length;
      const nd = d + edge + (hops.get(id)! + 1 > FREE_HOPS ? HOP_DISTANCE : 0);
      if (nd > maxLength || nd >= (dist.get(node.id) ?? Infinity)) continue;
      dist.set(node.id, nd);
      hops.set(node.id, hops.get(id)! + 1);
      nodes.set(node.id, node);
      const hubs = [
        ...(atFrom.count ? [{ node: from, count: atFrom.count }] : []),
        ...(atTo.count ? [{ node, count: atTo.count }] : []),
      ];
      cameFrom.set(node.id, {
        from,
        to: node,
        relType,
        weight: Math.exp(-edge),
        baseWeight: base,
        ...(count !== undefined ? { count } : {}),
        ...(hubs.length ? { hubs } : {}),
        fromIsSource: outgoing,
      });
      heap.push([nd, node.id]);
    }
  }
  return found;
}

/** The same path walked the other way. */
export function reversePath(path: PathStep[]): PathStep[] {
  return path
    .map((s) => ({
      ...s,
      from: s.to,
      to: s.from,
      fromIsSource: s.fromIsSource === undefined ? undefined : !s.fromIsSource,
    }))
    .reverse();
}

// --- Scoring ----------------------------------------------------------------

/**
 * Compute the similarity of the target artist to each listed artist using the
 * full graph: one strongest-path search from the target to all of them.
 */
/** Pair score, 0..100, from a path's strength: 0 under MIN_STRENGTH. */
export function strengthScore(strength: number): number {
  return strength < MIN_STRENGTH ? 0 : Math.round(strength * 100);
}

/**
 * `closest` (the Similarity page): look for paths down to PATH_MIN_STRENGTH, so a
 * pair scoring 0 still shows its closest connection, and search a weak pair again
 * from the liked artist's end (RECHECK_BELOW), keeping the stronger path. Off for
 * ranking, which only needs scores and runs once per candidate artist.
 */
export function computeSimilarity(
  graph: GraphAccess,
  targetArtist: ArtistRef,
  listArtists: ArtistRef[],
  { closest = false, quick = false }: { closest?: boolean; quick?: boolean } = {}
): SimilarityResult {
  const minStrength = closest ? PATH_MIN_STRENGTH : quick ? QUICK_MIN_STRENGTH : MIN_STRENGTH;
  const target = resolveArtist(graph, targetArtist);
  if (!target) {
    return {
      targetName: refName(targetArtist),
      targetFound: false,
      overallScore: 0,
      pairs: listArtists.map((a) => ({ name: refName(a), found: false, distance: null, score: 0, path: null })),
    };
  }

  const nodes = listArtists.map((a) => resolveArtist(graph, a));
  const paths = strongestPaths(graph, target, new Set(nodes.filter((n): n is SimNode => n !== null).map((n) => n.id)), minStrength);

  const pairs: PairScore[] = listArtists.map((a, i) => {
    const node = nodes[i];
    if (!node) return { name: refName(a), found: false, distance: null, score: 0, path: null };
    const fromTarget = paths.get(node.id);
    // Read from the list artist to the target ("how does the artist I like lead to this one").
    let path = fromTarget ? reversePath(fromTarget) : null;
    if (closest && node.id !== target.id && (!path || pathStrength(path) < RECHECK_BELOW)) {
      const fromListArtist = strongestPaths(graph, node, new Set([target.id]), minStrength).get(target.id);
      if (fromListArtist && (!path || pathStrength(fromListArtist) > pathStrength(path))) path = fromListArtist;
    }
    if (!path) return { name: node.name, found: true, node, distance: null, path: null, strength: 0, score: 0 };
    const strength = pathStrength(path);
    return { name: node.name, found: true, node, distance: path.length, path, strength, score: strengthScore(strength) };
  });

  const overallScore = aggregateScore(pairs);
  const sortedPairs = [...pairs].sort((a, b) => b.score - a.score);
  return { targetName: target.name, target, targetFound: true, overallScore, pairs: sortedPairs };
}

/** The pairs a quick pass (`quick`) left without a path: they show 0 until a `closest` pass fills them in. */
export function pendingPairs(result: SimilarityResult): PairScore[] {
  return result.pairs.filter((p) => p.found && p.node && p.path == null);
}

/** `result` with `updates` (a later pass over some of its liked artists) swapped in by artist, re-scored and re-sorted. */
export function mergePairs(result: SimilarityResult, updates: PairScore[]): SimilarityResult {
  const byId = new Map(updates.filter((p) => p.node).map((p) => [p.node!.id, p]));
  const pairs = result.pairs.map((p) => (p.node && byId.get(p.node.id)) || p);
  return { ...result, overallScore: aggregateScore(pairs), pairs: [...pairs].sort((a, b) => b.score - a.score) };
}

/**
 * Score a single artist against a list of artists, returning just the overall
 * 0..100 similarity. Convenience wrapper around `computeSimilarity` for ranking
 * external candidates (e.g. concert headliners) against a taste profile.
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
