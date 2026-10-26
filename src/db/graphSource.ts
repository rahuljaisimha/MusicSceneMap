/**
 * Async graph lookups that work before the browser graph DB has loaded.
 *
 * The ~48MB graph.db.gz downloads in the background (preloadDb in main.tsx).
 * Once it's loaded, these read the local sql.js copy first. Until then, and for
 * any artist the local copy doesn't have (it's cut to fit the download; the
 * server holds every artist), they ask the Postgres graph-neighbors edge
 * function, with miss logging turned off: callers decide what counts as a miss
 * (Explore logs an artist the local graph lacks itself).
 *
 * Remote answers are an artist plus its 1-hop neighbors (artists only, no
 * albums), which is all Explore expansion and Discover's related-band search
 * need. Results are memoized for the session.
 */

import { findNodeByName, findNodeById, getNeighbors, searchNodes, isDbLoaded, type NodeRecord } from "./graphDb";
import { getGraphNeighbors } from "../api/supabase";

export interface Neighbor {
  node: NodeRecord;
  relType: string;
  /** True when the artist looked up is the edge's source (unknown for server lookups). */
  outgoing?: boolean;
}

interface RemoteEntry {
  node: NodeRecord;
  neighbors: Neighbor[];
}

const remoteByName = new Map<string, Promise<RemoteEntry | null>>();
const remoteById = new Map<string, Promise<RemoteEntry | null>>();

/** Fetch from Postgres, sharing in-flight/finished requests. Failed requests aren't cached. */
function fetchRemote(params: { name: string } | { mbid: string }): Promise<RemoteEntry | null> {
  const [cache, key] = "name" in params ? [remoteByName, params.name.toLowerCase()] : [remoteById, params.mbid];
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = getGraphNeighbors(params, { logMiss: false }).then((res) => {
    if (!res.found || !res.artist) return null;
    const entry: RemoteEntry = { node: res.artist, neighbors: res.neighbors };
    // A name lookup also answers later lookups of the same artist by id.
    remoteById.set(entry.node.id, Promise.resolve(entry));
    return entry;
  });
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

/**
 * Find an artist by name (case-insensitive exact match). The local graph first,
 * then the server: the local graph is cut to fit the download, so an artist it
 * doesn't have can still be on the server (which holds every artist). With
 * `partial`, the local graph's substring match is the last resort (the server
 * only does exact). Album nodes are never returned.
 */
export async function findArtist(name: string, options: { partial?: boolean } = {}): Promise<NodeRecord | null> {
  if (isDbLoaded()) {
    const node = findNodeByName(name);
    if (node) return node.type === "album" ? null : node;
  }
  const remote = (await fetchRemote({ name }).catch(() => null))?.node ?? null;
  if (remote || !isDbLoaded() || !options.partial) return remote;
  return searchNodes(name, 10).find((n) => n.type !== "album") ?? null;
}

/** Find an artist by MusicBrainz ID: the local graph, else the server. Album nodes are never returned. */
export async function findArtistById(id: string): Promise<NodeRecord | null> {
  if (isDbLoaded()) {
    const node = findNodeById(id);
    if (node) return node.type !== "album" ? node : null;
  }
  return (await fetchRemote({ mbid: id }))?.node ?? null;
}

/** Whether the local graph has loaded and has this artist. */
export function inLocalGraph(id: string): boolean {
  return isDbLoaded() && findNodeById(id) !== null;
}

/** An artist's 1-hop neighbors (both edge directions): from the local graph if it has the artist, else the server. */
export async function getArtistNeighbors(id: string): Promise<Neighbor[]> {
  if (inLocalGraph(id)) return getNeighbors(id);
  return (await fetchRemote({ mbid: id }))?.neighbors ?? [];
}
