/**
 * Pure logic for deciding how the Explore search should resolve an artist:
 * by exact MBID (when the query matches a node the user just clicked) or by
 * name (a fresh typed query).
 *
 * Extracted from ExplorePage so it can be unit-tested without React/graph state.
 */

export interface PendingNode {
  name: string;
  id: string;
}

export type SearchResolution =
  | { by: "id"; id: string }
  | { by: "name"; name: string };

/**
 * Decide whether to search by the pending node's MBID or by the raw name.
 *
 * If the query exactly matches the name of the last clicked node, resolve by
 * that node's MBID (avoids ambiguity when multiple artists share a name, e.g.
 * two bands named "Fuzz"). Otherwise, resolve by name.
 */
export function resolveSearchTarget(
  query: string,
  pending: PendingNode | null
): SearchResolution {
  if (pending && pending.name === query) {
    return { by: "id", id: pending.id };
  }
  return { by: "name", name: query };
}
