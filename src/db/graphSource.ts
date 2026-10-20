/**
 * Async graph lookups that work before the browser graph DB has loaded.
 *
 * The ~38MB graph.db.gz downloads in the background (preloadDb in main.tsx).
 * Once it's loaded, these read the local sql.js copy. Until then they ask the
 * Postgres graph-neighbors edge function, which holds the same dataset, with
 * miss logging turned off: a miss while the local graph is still downloading
 * says nothing about coverage, so nothing goes into search_misses.
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
 * Find an artist by name (case-insensitive exact match). With `partial`, the
 * local graph also falls back to a substring match; the server only does exact.
 * Album nodes are never returned.
 */
export async function findArtist(name: string, options: { partial?: boolean } = {}): Promise<NodeRecord | null> {
  if (isDbLoaded()) {
    const node = findNodeByName(name);
    if (node) return node.type === "album" ? null : node;
    if (!options.partial) return null;
    return searchNodes(name, 10).find((n) => n.type !== "album") ?? null;
  }
  return (await fetchRemote({ name }))?.node ?? null;
}

/** Find an artist by MusicBrainz ID. Album nodes are never returned. */
export async function findArtistById(id: string): Promise<NodeRecord | null> {
  if (isDbLoaded()) {
    const node = findNodeById(id);
    return node && node.type !== "album" ? node : null;
  }
  return (await fetchRemote({ mbid: id }))?.node ?? null;
}

/** An artist's 1-hop neighbors (both edge directions). */
export async function getArtistNeighbors(id: string): Promise<Neighbor[]> {
  if (isDbLoaded()) return getNeighbors(id);
  return (await fetchRemote({ mbid: id }))?.neighbors ?? [];
}
