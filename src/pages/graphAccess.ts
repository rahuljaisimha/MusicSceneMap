/**
 * Builds a `GraphAccess` (the interface the similarity scorer depends on)
 * backed by the real sql.js browser graph DB. Shared by the Similarity page and
 * the Discover "Concerts" flow so the adapter lives in one place.
 *
 * Uses ALL relationships (band memberships, support roles, album credits) so the
 * scorer can weight each connection by type.
 *
 * Doesn't wait for the graph download: until the DB has loaded, every lookup
 * returns nothing, so the tiered access resolves artists from Postgres instead.
 * Lookups switch to the local graph as soon as it's ready.
 */

import { HUB_DAMPED_TYPES, type GraphAccess, type SimNode, type SimNeighbor } from "./similarity";
import { findNodeById, findNodeByName, getNeighbors, getRelDegree } from "../db/graphDb";

export function buildGraphAccess(): GraphAccess {
  return {
    findNodeByName(name: string): SimNode | null {
      const node = findNodeByName(name);
      return node ? { id: node.id, name: node.name, type: node.type } : null;
    },
    findNodeById(id: string): SimNode | null {
      const node = findNodeById(id);
      return node ? { id: node.id, name: node.name, type: node.type } : null;
    },
    degree(nodeId: string, relType: string): number | undefined {
      return getRelDegree(nodeId, relType, HUB_DAMPED_TYPES) ?? undefined;
    },
    neighbors(nodeId: string): SimNeighbor[] {
      return getNeighbors(nodeId).map(({ node, relType, outgoing }) => ({
        node: { id: node.id, name: node.name, type: node.type },
        relType,
        outgoing,
      }));
    },
  };
}
