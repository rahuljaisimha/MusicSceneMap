import initSqlJs, { type SqlJsConfig } from "sql.js";

// Use the proper type from our declaration
interface DB {
  run(sql: string, params?: unknown[]): unknown;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    get(): unknown[];
    getAsObject(): Record<string, unknown>;
    free(): void;
    reset(): void;
  };
  close(): void;
}

let db: DB | null = null;
let loadingPromise: Promise<DB> | null = null;

/**
 * Decompress a gzipped response using the browser's DecompressionStream API.
 */
async function decompressGzip(response: Response): Promise<ArrayBuffer> {
  const ds = new DecompressionStream("gzip");
  const decompressedStream = response.body!.pipeThrough(ds);
  return new Response(decompressedStream).arrayBuffer();
}

/**
 * Load the SQLite database from the public directory.
 * Returns the same instance if already loaded.
 */
export async function getDb(): Promise<DB> {
  if (db) return db;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Copy sql-wasm.wasm to public/ directory. Serve from same origin.
    const wasmUrl = `${window.location.origin}${import.meta.env.BASE_URL}sql-wasm.wasm`;
    const config: SqlJsConfig = {
      locateFile: () => wasmUrl,
    };

    const SQL = await initSqlJs(config);

    // Fetch the database file (gzipped) — try local first, fall back to remote
    const localUrl = `${import.meta.env.BASE_URL}graph.db.gz`;
    const remoteUrl = "https://github.com/rahuljaisimha/MusicSceneMap/releases/download/data/graph.db.gz";

    let buffer: ArrayBuffer;
    try {
      const localResponse = await fetch(localUrl);
      if (localResponse.ok && localResponse.headers.get("content-type") !== "text/html") {
        buffer = await decompressGzip(localResponse);
      } else {
        throw new Error("Local not available");
      }
    } catch {
      const remoteResponse = await fetch(remoteUrl);
      if (!remoteResponse.ok) {
        throw new Error(`Failed to load graph.db.gz: ${remoteResponse.status}`);
      }
      buffer = await decompressGzip(remoteResponse);
    }
    const instance = new SQL.Database(new Uint8Array(buffer));
    db = instance as unknown as DB;
    return db;
  })();

  return loadingPromise;
}

/**
 * Check if the database is loaded.
 */
export function isDbLoaded(): boolean {
  return db !== null;
}

// --- Query helpers ---

export interface NodeRecord {
  id: string;
  name: string;
  type: string;
}

export interface EdgeRecord {
  source: string;
  target: string;
  rel_type: string;
}

/**
 * Look up a node by name (case-insensitive).
 */
export function findNodeByName(name: string): NodeRecord | null {
  if (!db) return null;
  const stmt = db.prepare("SELECT id, name, type FROM nodes WHERE name = ? COLLATE NOCASE");
  stmt.bind([name]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as NodeRecord;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/**
 * Look up a node by ID.
 */
export function findNodeById(id: string): NodeRecord | null {
  if (!db) return null;
  const stmt = db.prepare("SELECT id, name, type FROM nodes WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as NodeRecord;
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

/**
 * Get all neighbors of a node (both directions).
 */
export function getNeighbors(nodeId: string): Array<{ node: NodeRecord; relType: string }> {
  if (!db) return [];

  const results: Array<{ node: NodeRecord; relType: string }> = [];

  // Edges where this node is the source
  const stmt1 = db.prepare(
    "SELECT n.id, n.name, n.type, e.rel_type FROM edges e JOIN nodes n ON n.id = e.target WHERE e.source = ?"
  );
  stmt1.bind([nodeId]);
  while (stmt1.step()) {
    const row = stmt1.get();
    results.push({
      node: { id: row[0] as string, name: row[1] as string, type: row[2] as string },
      relType: row[3] as string,
    });
  }
  stmt1.free();

  // Edges where this node is the target
  const stmt2 = db.prepare(
    "SELECT n.id, n.name, n.type, e.rel_type FROM edges e JOIN nodes n ON n.id = e.source WHERE e.target = ?"
  );
  stmt2.bind([nodeId]);
  while (stmt2.step()) {
    const row = stmt2.get();
    results.push({
      node: { id: row[0] as string, name: row[1] as string, type: row[2] as string },
      relType: row[3] as string,
    });
  }
  stmt2.free();

  return results;
}

/**
 * BFS shortest path between two nodes.
 * Returns the path as an array of node IDs (including start and end), or null if no path.
 */
export function bfsShortestPath(startId: string, endId: string, maxDepth = 10): string[] | null {
  if (!db) return null;
  if (startId === endId) return [startId];

  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();
  let frontier = [startId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const neighbors = getNeighborIds(nodeId);
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        parent.set(neighborId, nodeId);

        if (neighborId === endId) {
          // Reconstruct path
          const path: string[] = [endId];
          let current = endId;
          while (current !== startId) {
            current = parent.get(current)!;
            path.unshift(current);
          }
          return path;
        }

        nextFrontier.push(neighborId);
      }
    }

    frontier = nextFrontier;
  }

  return null;
}

/**
 * Get neighbor IDs only (faster than full node lookup, for BFS).
 * Skips album nodes with more than MAX_ALBUM_DEGREE connections (likely compilations).
 */
const MAX_ALBUM_DEGREE = 25;
const albumDegreeCache = new Map<string, number>();

function getAlbumDegree(nodeId: string): number {
  const cached = albumDegreeCache.get(nodeId);
  if (cached !== undefined) return cached;
  if (!db) return 0;

  const result = db.exec(
    "SELECT COUNT(*) FROM edges WHERE target = ? OR source = ?",
    [nodeId, nodeId]
  );
  const count = result.length > 0 ? (result[0]!.values[0]![0] as number) : 0;
  albumDegreeCache.set(nodeId, count);
  return count;
}

function isCompilation(nodeId: string): boolean {
  if (!db) return false;
  // Check if it's an album node
  const stmt = db.prepare("SELECT type FROM nodes WHERE id = ?");
  stmt.bind([nodeId]);
  let nodeType = "";
  if (stmt.step()) {
    nodeType = stmt.get()[0] as string;
  }
  stmt.free();

  if (nodeType !== "album") return false;
  return getAlbumDegree(nodeId) > MAX_ALBUM_DEGREE;
}

function getNeighborIds(nodeId: string): string[] {
  if (!db) return [];
  const ids: string[] = [];

  const stmt1 = db.prepare("SELECT target FROM edges WHERE source = ?");
  stmt1.bind([nodeId]);
  while (stmt1.step()) {
    const id = stmt1.get()[0] as string;
    if (!isCompilation(id)) {
      ids.push(id);
    }
  }
  stmt1.free();

  const stmt2 = db.prepare("SELECT source FROM edges WHERE target = ?");
  stmt2.bind([nodeId]);
  while (stmt2.step()) {
    const id = stmt2.get()[0] as string;
    if (!isCompilation(id)) {
      ids.push(id);
    }
  }
  stmt2.free();

  return ids;
}

/**
 * Search nodes by name (partial match).
 */
export function searchNodes(query: string, limit = 10): NodeRecord[] {
  if (!db) return [];
  const results = db.exec(
    "SELECT id, name, type FROM nodes WHERE name LIKE ? COLLATE NOCASE LIMIT ?",
    [`%${query}%`, limit]
  );
  if (results.length === 0) return [];
  return results[0]!.values.map((row) => ({
    id: row[0] as string,
    name: row[1] as string,
    type: row[2] as string,
  }));
}
