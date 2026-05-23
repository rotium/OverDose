/**
 * In-memory `Storage` shim for tests — keeps localStorage-backed code under
 * test from polluting jsdom's real localStorage (which persists across tests
 * in the same file). Pass a fresh instance per test for isolation.
 */
export class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}
