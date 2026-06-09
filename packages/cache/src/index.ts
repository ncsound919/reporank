/**
 * @reporank/cache — Resilient Cache Provider
 *
 * Provides a unified cache interface with automatic Redis → Memory fallback.
 * If Redis is unavailable, the provider silently degrades to an in-memory store
 * so the pipeline never crashes due to missing infrastructure.
 */

import { EventEmitter } from "node:events";

// ─── Types ────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number | null; // null = no expiry
}

export interface CacheProvider {
  /** Retrieve a cached value. Returns `undefined` on miss or expiry. */
  get<T>(key: string): Promise<T | undefined>;
  /** Store a value with an optional TTL in seconds. */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Delete a specific key. */
  delete(key: string): Promise<boolean>;
  /** Clear all cached entries. */
  clear(): Promise<void>;
  /** Whether the underlying store is Redis (true) or in-memory (false). */
  isConnected(): boolean;
  /** Human-readable backend name: "redis" | "memory" */
  readonly backend: string;
}

// ─── Memory Cache ──────────────────────────────────────────────

export class MemoryCache implements CacheProvider {
  readonly backend = "memory";
  private store = new Map<string, CacheEntry>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cleanupIntervalMs = 60_000) {
    this.evictionTimer = setInterval(() => this.evictExpired(), cleanupIntervalMs);
    this.evictionTimer.unref();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  isConnected(): boolean {
    return false;
  }

  /** Remove expired entries from the map. Public for testing. */
  evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  /** For testing / introspection. */
  get size(): number {
    return this.store.size;
  }

  destroy(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.store.clear();
  }
}

// ─── Redis Cache ───────────────────────────────────────────────

export interface RedisCacheOptions {
  /** Redis connection URL (default: "redis://localhost:6379"). */
  url?: string;
  /** Connection timeout in ms (default: 3000). */
  connectTimeout?: number;
  /** Key prefix for namespacing (default: "reporank:"). */
  keyPrefix?: string;
}

export class RedisCache implements CacheProvider {
  readonly backend = "redis";
  private client: import("ioredis").Redis | null = null;
  private connected = false;
  private options: Required<RedisCacheOptions>;

  constructor(options: RedisCacheOptions = {}) {
    this.options = {
      url: options.url ?? "redis://localhost:6379",
      connectTimeout: options.connectTimeout ?? 3000,
      keyPrefix: options.keyPrefix ?? "reporank:",
    };
  }

  /** Initialise the connection. Call once after construction. */
  async connect(): Promise<void> {
    if (this.client) return;
    const { Redis } = await import("ioredis");
    this.client = new Redis(this.options.url, {
      connectTimeout: this.options.connectTimeout,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // don't auto-retry; fallback is handled by factory
      lazyConnect: true,
    });

    // Suppress unhandled error events by attaching a noop handler
    this.client.on("error", () => {});

    try {
      await this.client.connect();
      this.connected = true;
    } catch {
      this.connected = false;
      this.client = null;
    }
  }

  private ensureClient(): import("ioredis").Redis {
    if (!this.client || !this.connected) {
      throw new Error("Redis is not connected");
    }
    return this.client;
  }

  private prefixed(key: string): string {
    return `${this.options.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.ensureClient().get(this.prefixed(key));
      if (raw === null) return undefined;
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const pk = this.prefixed(key);
      if (ttlSeconds !== undefined) {
        await this.ensureClient().setex(pk, ttlSeconds, serialized);
      } else {
        await this.ensureClient().set(pk, serialized);
      }
    } catch {
      // Silently fail — caller expects resilience
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.ensureClient().del(this.prefixed(key));
      return result > 0;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const stream = this.ensureClient().scanStream({ match: `${this.options.keyPrefix}*` });
      const pipeline = this.ensureClient().pipeline();
      for await (const keys of stream) {
        if (keys.length > 0) pipeline.del(keys);
      }
      await pipeline.exec();
    } catch {
      // Silently fail
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Gracefully close the Redis connection. */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────

export interface CacheProviderFactoryOptions {
  /** Redis connection URL. Omit to skip Redis and use memory directly. */
  redisUrl?: string;
  /** Connection timeout in ms (default: 3000). */
  connectTimeout?: number;
  /** Key prefix for Redis namespacing (default: "reporank:"). */
  keyPrefix?: string;
  /** Log function for warnings (default: console.warn). */
  logger?: (msg: string) => void;
}

/**
 * Create a CacheProvider that attempts Redis and falls back to in-memory.
 *
 * Usage:
 * ```ts
 * const cache = await createCacheProvider({ redisUrl: "redis://localhost:6379" });
 * // cache.backend === "redis" or "memory"
 * ```
 */
export async function createCacheProvider(
  options: CacheProviderFactoryOptions = {},
): Promise<CacheProvider> {
  const logger = options.logger ?? ((msg: string) => console.warn(`[cache] ${msg}`));

  // If no Redis URL provided, skip straight to memory
  if (!options.redisUrl) {
    logger("No Redis URL provided; using in-memory cache");
    return new MemoryCache();
  }

  const redis = new RedisCache({
    url: options.redisUrl,
    connectTimeout: options.connectTimeout ?? 3000,
    keyPrefix: options.keyPrefix,
  });

  try {
    await redis.connect();
    if (redis.isConnected()) {
      logger(`Connected to Redis at ${options.redisUrl}`);
      return redis;
    }
  } catch {
    // Fall through to memory
  }

  logger(`Redis at ${options.redisUrl} unreachable; falling back to in-memory cache`);
  return new MemoryCache();
}

// ─── Re-export EventEmitter for extension ──────────────────────
export { EventEmitter };
