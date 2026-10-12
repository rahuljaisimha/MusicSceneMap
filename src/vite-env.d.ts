/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional override for the graph database URL. Defaults to the same-origin
   * `graph.db.gz`. Set to a CDN URL (e.g. Cloudflare R2) when the host caps
   * static asset size (Cloudflare Pages' 25 MiB limit).
   */
  readonly VITE_GRAPH_DB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
