/**
 * A Map that maintains insertion-order LRU semantics with idle TTL eviction
 * and a hard cap on entries. Used by all rate limiters for per-IP state.
 */
export class LRUMap<V> {
  private readonly map = new Map<string, V>();
  private readonly idleTtlMs: number;
  private readonly maxEntries: number;
  private readonly cleanupIntervalMs: number;
  private readonly getLastSeen: (v: V) => number;
  private lastCleanupAt = 0;

  constructor(opts: {
    idleTtlMs?: number;
    maxEntries?: number;
    cleanupIntervalMs?: number;
    getLastSeen: (v: V) => number;
  }) {
    this.idleTtlMs = opts.idleTtlMs ?? 30 * 60 * 1000; // 30 minutes
    this.maxEntries = opts.maxEntries ?? 20_000;
    this.cleanupIntervalMs = opts.cleanupIntervalMs ?? 60 * 1000;
    this.getLastSeen = opts.getLastSeen;
  }

  get size() {
    return this.map.size;
  }

  /** Get value without touching LRU order. */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  /** Get value and promote to most-recently-used. */
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Re-insert to move to end (most recent)
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Set/overwrite a key (always placed at most-recently-used position). */
  set(key: string, value: V): void {
    this.map.delete(key); // remove old position if exists
    this.map.set(key, value);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Run periodic cleanup: evict idle entries + trim to maxEntries. */
  cleanup(now: number): void {
    if (now - this.lastCleanupAt < this.cleanupIntervalMs) return;
    this.lastCleanupAt = now;

    for (const [key, value] of this.map) {
      if (now - this.getLastSeen(value) > this.idleTtlMs) {
        this.map.delete(key);
      }
    }

    this.evictOldest();
  }

  /** Evict least-recently-used entries until size <= maxEntries. */
  evictOldest(): void {
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }
}
