/**
 * Builds a `GraphAccess` (the interface the similarity scorer depends on)
 * backed by the real sql.js browser graph DB. Shared by the Similarity page and
 * the Discover "Concerts" flow so the adapter lives in one place.
 *
 * Uses ALL relationships (band memberships, support roles, album credits) so the
 * scorer can weight each connection by type.
 */

import type { GraphAccess, SimNode, SimNeighbor } from "./similarity";

export async function buildGraphAccess(): Promise<GraphAccess> {
  const { getDb, findNodeByName, getNeighbors } = await import("../db/graphDb");
  await getDb();

  return {
    findNodeByName(name: string): SimNode | null {
      const node = findNodeByName(name);
      return node ? { id: node.id, name: node.name, type: node.type } : null;
    },
    neighbors(nodeId: string): SimNeighbor[] {
      return getNeighbors(nodeId).map(({ node, relType }) => ({
        node: { id: node.id, name: node.name, type: node.type },
        relType,
      }));
    },
  };
}
