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
 * Load the SQLite database from the public directory.
 * Returns the same instance if already loaded.
 */
export async function getDb(): Promise<DB> {
  if (db) return db;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Load sql.js WASM
    const wasmUrl = `${window.location.origin}${import.meta.env.BASE_URL}sql-wasm.wasm`;
    const config: SqlJsConfig = {
      locateFile: () => wasmUrl,
    };

    const SQL = await initSqlJs(config);

    // Fetch the database file (gzipped)
    const dbUrl = `${import.meta.env.BASE_URL}graph.db.gz`;

    const response = await fetch(dbUrl);
    if (!response.ok || response.headers.get("content-type") === "text/html") {
      throw new Error(
        "graph.db.gz not found. Run 'python3 scripts/process_mb_dump.py' to generate it."
      );
    }

    let buffer = await response.arrayBuffer();

    // Check if we need to manually decompress:
    // If Content-Encoding: gzip was set, browser already decompressed it.
    // If not (e.g., GitHub Pages), we get raw gzip bytes — detect via magic number.
    const header = new Uint8Array(buffer, 0, 2);
    if (header[0] === 0x1f && header[1] === 0x8b) {
      // Gzip magic number detected — need manual decompression
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      writer.write(new Uint8Array(buffer));
      writer.close();
      buffer = await new Response(ds.readable).arrayBuffer();
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
export function bfsShortestPath(startId: string, endId: string, maxDepth = 10, allowedRelTypes?: Set<string>): string[] | null {
  if (!db) return null;
  if (startId === endId) return [startId];

  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();
  let frontier = [startId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const neighbors = getNeighborIds(nodeId, allowedRelTypes);
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

function getNeighborIds(nodeId: string, allowedRelTypes?: Set<string>): string[] {
  if (!db) return [];
  const ids: string[] = [];

  const stmt1 = db.prepare("SELECT target, rel_type FROM edges WHERE source = ?");
  stmt1.bind([nodeId]);
  while (stmt1.step()) {
    const id = stmt1.get()[0] as string;
    const relType = stmt1.get()[1] as string;
    if (allowedRelTypes && !allowedRelTypes.has(relType)) continue;
    if (!isCompilation(id)) {
      ids.push(id);
    }
  }
  stmt1.free();

  const stmt2 = db.prepare("SELECT source, rel_type FROM edges WHERE target = ?");
  stmt2.bind([nodeId]);
  while (stmt2.step()) {
    const id = stmt2.get()[0] as string;
    const relType = stmt2.get()[1] as string;
    if (allowedRelTypes && !allowedRelTypes.has(relType)) continue;
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
