// Test setup: provide a minimal in-memory localStorage shim
// so modules that use the request cache work in the Node test environment.

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

// Always install our shim — Vitest may provide a partial/stub localStorage
// that lacks getItem/setItem, which breaks modules that use the cache/debug log.
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
