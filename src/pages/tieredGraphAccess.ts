/**
 * Tiered GraphAccess (Option 4).
 *
 * The similarity scorer uses a SYNCHRONOUS `GraphAccess` (sql.js is sync). Tier-2
 * sources (Postgres edge function, MusicBrainz) are async, so we can't fetch
 * mid-scoring. Instead this module works in two phases:
 *
 *   1. `prepareArtists(artists)` — async. For each artist NOT in the core SQLite
 *      graph, fetch its node + 1-hop neighbors from Tier-2 and stash them in an
 *      in-memory overlay (also cached 24h in localStorage). Fallback chain:
 *        Tier 1: core SQLite (browser)      — instant, but limited coverage
 *        Tier 2: Postgres (graph-neighbors) — same coverage as SQLite today
 *        Tier 3: MusicBrainz (live)         — broad coverage, ~1 req/sec
 *        (Discogs — deferred, follow-up)
 *
 *   2. `build()` — returns a synchronous GraphAccess that reads the core graph
 *      first and falls back to the overlay. Safe to hand to `computeSimilarity`.
 *
 * Only out-of-core artists incur network cost; fully-covered lists stay instant.
 * Tier-2 returns a node + 1 hop, so multi-hop accuracy for out-of-core artists
 * is reduced by design (documented tradeoff; revisit later).
 */

import { refId, refName, type ArtistRef, type GraphAccess, type SimNode, type SimNeighbor } from "./similarity";
import { getCached, setCache } from "../api/cache";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** A resolved artist node plus its 1-hop neighbors, from any tier. */
interface Subgraph {
  node: SimNode;
  neighbors: SimNeighbor[];
}

/** Which tier answered — for debugging / metrics. */
export type Tier = "core" | "postgres" | "musicbrainz" | "miss";

/** An artist to fetch: by MusicBrainz ID when the user picked it, else by name. */
export interface ArtistLookup {
  name: string;
  id?: string;
}

/** Overlay/cache key: "mbid:<id>" for a picked artist, else the lowercased name. */
function lookupKey(ref: ArtistRef): string {
  const id = refId(ref);
  return id ? `mbid:${id}` : refName(ref).toLowerCase();
}

export class TieredGraphAccess {
  /** Overlay of nodes fetched from Tier 2/3, keyed by lookupKey (lowercased name or "mbid:<id>"). */
  private overlayByKey = new Map<string, Subgraph | null>();
  /** Overlay neighbors keyed by node id (so neighbors(id) can find them). */
  private overlayById = new Map<string, Subgraph>();
  /** In-flight resolutions, keyed by lookupKey, to dedupe concurrent fetches. */
  private inFlight = new Map<string, Promise<Tier>>();

  // Injected so this class stays testable without sql.js / real network.
  constructor(
    private core: GraphAccess,
    private fetchPostgres: (artist: ArtistLookup) => Promise<Subgraph | null>,
    private fetchMusicBrainz: (artist: ArtistLookup) => Promise<Subgraph | null>
  ) {}

  /**
   * Ensure each artist is resolvable synchronously afterwards. Artists already
   * in the core graph are skipped (no network). Returns which tier answered
   * each, keyed by its MusicBrainz ID when it has one, else by the name given.
   * Duplicates (same ID, or same name case-insensitively) are resolved once.
   */
  async prepareArtists(artists: ArtistRef[]): Promise<Map<string, Tier>> {
    const tiers = new Map<string, Tier>();

    // Dedupe by key, keeping the first original spelling.
    const uniqueByKey = new Map<string, ArtistRef>();
    for (const ref of artists) {
      const key = lookupKey(ref);
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, ref);
    }

    await Promise.all(
      [...uniqueByKey.values()].map(async (ref) => {
        const tier = await this.resolveOne(ref);
        tiers.set(refId(ref) ?? refName(ref), tier);
      })
    );

    return tiers;
  }

  /** Whether the core graph has this artist (by ID when it has one). */
  private inCore(ref: ArtistRef): boolean {
    const id = refId(ref);
    if (id && this.core.findNodeById) return this.core.findNodeById(id) !== null;
    return this.core.findNodeByName(refName(ref)) !== null;
  }

  /** Resolve a single artist, sharing any in-flight resolution for the same key. */
  private resolveOne(ref: ArtistRef): Promise<Tier> {
    const key = lookupKey(ref);

    // Tier 1: already in core graph?
    if (this.inCore(ref)) return Promise.resolve<Tier>("core");

    // Already resolved this session?
    if (this.overlayByKey.has(key)) {
      const sg = this.overlayByKey.get(key);
      return Promise.resolve<Tier>(sg ? "postgres" : "miss");
    }

    // Share an in-flight fetch for the same key.
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const id = refId(ref);
    const promise = this.fetchAndStore(key, { name: refName(ref), ...(id ? { id } : {}) });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchAndStore(key: string, artist: ArtistLookup): Promise<Tier> {
    try {
      // 24h cache?
      const cached = getCached<Subgraph | null>(`tier2_${key}`, CACHE_TTL_MS);
      if (cached !== null) {
        this.storeOverlay(key, cached);
        return cached ? "postgres" : "miss";
      }

      // Tier 2: Postgres, then Tier 3: MusicBrainz.
      let sg: Subgraph | null = null;
      let tier: Tier = "miss";
      try {
        sg = await this.fetchPostgres(artist);
        if (sg) tier = "postgres";
      } catch { /* fall through */ }

      if (!sg) {
        try {
          sg = await this.fetchMusicBrainz(artist);
          if (sg) tier = "musicbrainz";
        } catch { /* fall through */ }
      }

      this.storeOverlay(key, sg);
      setCache(`tier2_${key}`, sg);
      return tier;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private storeOverlay(key: string, sg: Subgraph | null): void {
    this.overlayByKey.set(key, sg);
    if (sg) {
      this.overlayById.set(sg.node.id, sg);
      // Neighbors may also be looked up by name during scoring.
      for (const nb of sg.neighbors) {
        const nbKey = nb.node.name.toLowerCase();
        if (!this.overlayByKey.has(nbKey) && !this.core.findNodeByName(nb.node.name)) {
          // Store a shallow entry so findNodeByName resolves it (no neighbors known).
          this.overlayById.set(nb.node.id, this.overlayById.get(nb.node.id) ?? { node: nb.node, neighbors: [] });
        }
      }
    }
  }

  /** A synchronous GraphAccess: core graph first, then the prefetched overlay. */
  build(): GraphAccess {
    return {
      findNodeByName: (name: string): SimNode | null => {
        const core = this.core.findNodeByName(name);
        if (core) return core;
        const sg = this.overlayByKey.get(name.toLowerCase());
        return sg ? sg.node : null;
      },
      findNodeById: (id: string): SimNode | null => {
        const core = this.core.findNodeById?.(id);
        if (core) return core;
        return this.overlayById.get(id)?.node ?? null;
      },
      neighbors: (nodeId: string): SimNeighbor[] => {
        const core = this.core.neighbors(nodeId);
        if (core.length > 0) return core;
        const sg = this.overlayById.get(nodeId);
        return sg ? sg.neighbors : [];
      },
    };
  }
}

// --- Real wiring (browser) --------------------------------------------------

/**
 * Build a TieredGraphAccess wired to the real core sql.js graph, the Postgres
 * graph-neighbors edge function, and the live MusicBrainz API.
 */
export async function buildTieredGraphAccess(): Promise<TieredGraphAccess> {
  const { buildGraphAccess } = await import("./graphAccess");
  const { isDbLoaded } = await import("../db/graphDb");
  // Core returns nothing until the background graph download finishes, so
  // lookups go to Postgres meanwhile.
  const core = buildGraphAccess();

  const fetchPostgres = async ({ name, id }: ArtistLookup): Promise<Subgraph | null> => {
    // While the local graph is still downloading, a miss here says nothing
    // about SQLite coverage, so don't record it in search_misses. Read before
    // any await: this runs in the same tick as the core-graph check.
    const logMiss = isDbLoaded();
    const { getGraphNeighbors } = await import("../api/supabase");
    const res = await getGraphNeighbors(id ? { mbid: id } : { name }, { logMiss });
    if (!res.found || !res.artist) return null;
    return {
      node: res.artist,
      neighbors: res.neighbors.map((n) => ({ node: n.node, relType: n.relType })),
    };
  };

  const fetchMusicBrainz = async ({ name, id }: ArtistLookup): Promise<Subgraph | null> => {
    const mb = await import("../api/musicbrainz");
    let mbid = id;
    if (!mbid) {
      const results = await mb.searchArtists(name, 5);
      mbid = mb.pickBestMatch(name, results)?.id;
    }
    if (!mbid) return null;
    const full = await mb.getArtistWithRelations(mbid);

    const node: SimNode = {
      id: full.id,
      name: full.name,
      type: full.type === "Group" ? "group" : "person",
    };

    // `outgoing`: this artist is the edge's source (the member / the supporting musician).
    const neighbors: SimNeighbor[] = [];
    const push = (a: { id: string; name: string; type?: string }, relType: string, outgoing: boolean) =>
      neighbors.push({
        node: { id: a.id, name: a.name, type: a.type === "Group" ? "group" : "person" },
        relType,
        outgoing,
      });

    for (const m of mb.extractBands(full)) push(m.artist, m.current ? "member_of" : "former_member_of", true);
    for (const m of mb.extractMembers(full)) push(m.artist, m.current ? "member_of" : "former_member_of", false);
    for (const s of mb.extractSupportedBands(full)) push(s.artist, "support_musician", true);
    for (const s of mb.extractSupportMusicians(full)) push(s.artist, "support_musician", false);

    return { node, neighbors };
  };

  return new TieredGraphAccess(core, fetchPostgres, fetchMusicBrainz);
}
