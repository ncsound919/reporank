import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryCache, RedisCache, createCacheProvider } from "./index.js";

// ─── MemoryCache ──────────────────────────────────────────────

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  afterEach(() => {
    cache.destroy();
  });

  it("stores and retrieves a value", async () => {
    await cache.set("key1", "hello");
    expect(await cache.get("key1")).toBe("hello");
  });

  it("returns undefined for missing key", async () => {
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("respects TTL", async () => {
    await cache.set("ephemeral", "gone", 1); // 1 second
    expect(await cache.get("ephemeral")).toBe("gone");
    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));
    expect(await cache.get("ephemeral")).toBeUndefined();
  }, 10_000);

  it("deletes a key", async () => {
    await cache.set("delete-me", "value");
    const deleted = await cache.delete("delete-me");
    expect(deleted).toBe(true);
    expect(await cache.get("delete-me")).toBeUndefined();
  });

  it("returns false when deleting missing key", async () => {
    expect(await cache.delete("not-exists")).toBe(false);
  });

  it("clears all keys", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBeUndefined();
  });

  it("stores objects", async () => {
    const obj = { name: "test", nested: { value: 42 } };
    await cache.set("obj", obj);
    expect(await cache.get("obj")).toEqual(obj);
  });

  it("isConnected returns false", () => {
    expect(cache.isConnected()).toBe(false);
  });

  it("backend is 'memory'", () => {
    expect(cache.backend).toBe("memory");
  });

  it("evicts expired entries on evictExpired call", async () => {
    await cache.set("a", 1, 1); // 1 second TTL
    expect(cache.size).toBe(1);
    await new Promise((r) => setTimeout(r, 1100));
    // Manually trigger eviction (timer interval is 60s by default)
    cache.evictExpired();
    expect(cache.size).toBe(0);
  }, 10_000);
});

// ─── RedisCache ───────────────────────────────────────────────

describe("RedisCache", () => {
  let cache: RedisCache;

  afterEach(async () => {
    if (cache) await cache.disconnect();
  });

  it("falls back gracefully when Redis is unreachable", async () => {
    cache = new RedisCache({ url: "redis://localhost:16379", connectTimeout: 500 });
    await cache.connect();
    expect(cache.isConnected()).toBe(false);
    // Operations should not throw
    await cache.set("key", "val");
    expect(await cache.get("key")).toBeUndefined();
  });

  it("backend is 'redis'", () => {
    cache = new RedisCache();
    expect(cache.backend).toBe("redis");
  });

  // Integration test — only runs when Redis is actually available
  it.runIf(process.env.REDIS_TEST === "1")("connects and operates against real Redis", async () => {
    cache = new RedisCache({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    await cache.connect();
    expect(cache.isConnected()).toBe(true);

    await cache.set("test-key", { hello: "world" });
    const val = await cache.get<{ hello: string }>("test-key");
    expect(val).toEqual({ hello: "world" });

    const deleted = await cache.delete("test-key");
    expect(deleted).toBe(true);

    const afterDelete = await cache.get("test-key");
    expect(afterDelete).toBeUndefined();
  });
});

// ─── Factory ──────────────────────────────────────────────────

describe("createCacheProvider", () => {
  it("returns MemoryCache when no Redis URL is given", async () => {
    const cache = await createCacheProvider();
    expect(cache.backend).toBe("memory");
    expect(cache.isConnected()).toBe(false);
  });

  it("returns MemoryCache when Redis is unreachable", async () => {
    const logger = vi.fn();
    const cache = await createCacheProvider({
      redisUrl: "redis://localhost:16379",
      connectTimeout: 500,
      logger,
    });
    expect(cache.backend).toBe("memory");
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("unreachable"),
    );
  });

  it("returns RedisCache when Redis is reachable", async () => {
    // This test requires Docker Redis running
    const cache = await createCacheProvider({
      redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
      connectTimeout: 1000,
    });
    if (cache.backend === "memory") {
      console.warn("  ⚠ Redis not available — skipping Redis integration test");
      return;
    }
    expect(cache.backend).toBe("redis");
    expect(cache.isConnected()).toBe(true);
  });

  it("MemoryCache set/get roundtrip works after factory fallback", async () => {
    const cache = await createCacheProvider({ redisUrl: "redis://localhost:16379", connectTimeout: 300 });
    expect(cache.backend).toBe("memory");
    await cache.set("roundtrip", { ok: true });
    expect(await cache.get("roundtrip")).toEqual({ ok: true });
  });
});

// ─── Edge Cases ────────────────────────────────────────────────

describe("Cache edge cases", () => {
  it("handles undefined values gracefully", async () => {
    const cache = new MemoryCache();
    await cache.set("undef", undefined);
    expect(await cache.get("undef")).toBeUndefined();
    cache.destroy();
  });

  it("handles null values", async () => {
    const cache = new MemoryCache();
    await cache.set("null", null);
    expect(await cache.get("null")).toBeNull();
    cache.destroy();
  });

  it("handles numeric keys stored as strings", async () => {
    const cache = new MemoryCache();
    await cache.set("num", 42);
    expect(await cache.get("num")).toBe(42);
    cache.destroy();
  });
});
