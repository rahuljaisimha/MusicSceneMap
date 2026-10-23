/**
 * Discover's "related bands" search: a breadth-first walk out from the user's
 * artists over the relationship types they ticked, collecting the first few
 * groups it reaches. Their venues are then added to the venue results.
 *
 * Pure logic (neighbors are injected) so it is testable without sql.js.
 */

export interface RelOption {
  relType: string;
  label: string;
  defaultOn: boolean;
}

/** The relationship types Discover can follow, in display order. Band ties are on by default. */
export const DISCOVER_REL_OPTIONS: RelOption[] = [
  { relType: "member_of", label: "Band members", defaultOn: true },
  { relType: "former_member_of", label: "Former members", defaultOn: true },
  { relType: "support_musician", label: "Supporting musicians", defaultOn: true },
  { relType: "collaborated_with", label: "Played or sang on their records", defaultOn: false },
  { relType: "produced_for", label: "Produced their records", defaultOn: false },
  { relType: "opened_for", label: "Opened for / headlined (concerts)", defaultOn: false },
];

export const DEFAULT_DISCOVER_RELS: string[] = DISCOVER_REL_OPTIONS.filter((o) => o.defaultOn).map((o) => o.relType);

export interface BandNeighbor {
  node: { id: string; name: string; type: string };
  relType: string;
}

export interface FindConnectedBandsOptions {
  /** Node ids of the user's artists (found in the graph). */
  startIds: string[];
  /** Names already in the user's list (not suggested again). */
  exclude: string[];
  /** Relationship types to follow. */
  relTypes: Iterable<string>;
  neighbors: (nodeId: string) => Promise<BandNeighbor[]>;
  /** How many groups to collect. */
  limit?: number;
  /** Called before each expansion; false stops the walk (e.g. a request budget). */
  canExpand?: () => boolean;
}

export async function findConnectedBands(opts: FindConnectedBandsOptions): Promise<Array<{ name: string; mbid: string }>> {
  const allowed = new Set(opts.relTypes);
  const limit = opts.limit ?? 5;
  const found: Array<{ name: string; mbid: string }> = [];
  if (allowed.size === 0) return found;

  const visited = new Set<string>();
  const queue: string[] = [];
  for (const id of opts.startIds) {
    if (!visited.has(id)) {
      visited.add(id);
      queue.push(id);
    }
  }

  while (queue.length > 0 && found.length < limit) {
    if (opts.canExpand && !opts.canExpand()) break;
    const nodeId = queue.shift()!;
    const neighbors = await opts.neighbors(nodeId).catch(() => [] as BandNeighbor[]);
    for (const { node, relType } of neighbors) {
      if (visited.has(node.id) || node.type === "album" || !allowed.has(relType)) continue;
      visited.add(node.id);
      queue.push(node.id);
      if (node.type === "group" && !opts.exclude.includes(node.name)) {
        found.push({ name: node.name, mbid: node.id });
        if (found.length >= limit) break;
      }
    }
  }
  return found;
}
