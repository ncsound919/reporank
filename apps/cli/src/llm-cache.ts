// LLM response cache (Phase 1.7 — avoid re-billing on identical prompts).
//
// Caches LLM responses keyed by (prompt-hash, model, temperature).
// This avoids re-running expensive LLM calls on the same content during
// benchmark sweeps or repeated CI runs.
//
// Per AGENTS.md: no hardcoded URLs, no eval(), proper async errors.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CACHE_VERSION = 1;

export interface CacheEntry {
  /** SHA-256 of (prompt + model + temperature + response_format) */
  promptHash: string;
  /** The LLM response content */
  content: string;
  /** Provider used (gemini, ollama, mock, etc.) */
  provider: string;
  /** Model identifier */
  model: string;
  /** Token usage from the LLM */
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Latency in ms */
  latencyMs: number;
  /** When this entry was created (epoch ms) */
  timestamp: number;
}

export interface LLMCacheState {
  version: number;
  /** Map: promptHash -> CacheEntry */
  entries: Record<string, CacheEntry>;
  /** Total number of cache hits since this cache was created */
  hits: number;
  /** Total number of cache misses */
  misses: number;
}

function cachePathFor(): string {
  if (process.env.VIBESERVE_CACHE_DIR) {
    const dir = process.env.VIBESERVE_CACHE_DIR;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "llm-cache.json");
  }
  return resolve(".llm-cache.json");
}

function hashPrompt(prompt: string, model: string, temperature: number, responseFormat: string): string {
  const h = createHash("sha256");
  h.update(prompt, "utf-8");
  h.update("|", "utf-8");
  h.update(model, "utf-8");
  h.update("|", "utf-8");
  h.update(String(temperature), "utf-8");
  h.update("|", "utf-8");
  h.update(responseFormat, "utf-8");
  return h.digest("hex");
}

export class LLMCache {
  private state: LLMCacheState;

  constructor() {
    this.state = this.load();
  }

  private load(): LLMCacheState {
    const path = cachePathFor();
    if (!existsSync(path)) {
      return { version: CACHE_VERSION, entries: {}, hits: 0, misses: 0 };
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      if (raw.version !== CACHE_VERSION) {
        return { version: CACHE_VERSION, entries: {}, hits: 0, misses: 0 };
      }
      return raw as LLMCacheState;
    } catch {
      return { version: CACHE_VERSION, entries: {}, hits: 0, misses: 0 };
    }
  }

  private save(): void {
    const path = cachePathFor();
    try {
      writeFileSync(path, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (e) {
      console.error(`[llm-cache] save failed: ${(e as Error).message}`);
    }
  }

  /** Get a cached response, or return null if not found. */
  get(prompt: string, model: string, temperature: number, responseFormat: string): CacheEntry | null {
    const key = hashPrompt(prompt, model, temperature, responseFormat);
    const entry = this.state.entries[key];
    if (entry) {
      this.state.hits++;
      // Persist hit/miss counters so they survive process restarts
      // (only every 10 hits to avoid I/O thrash on tight loops)
      if ((this.state.hits + this.state.misses) % 10 === 0) this.save();
      return entry;
    }
    this.state.misses++;
    if ((this.state.hits + this.state.misses) % 10 === 0) this.save();
    return null;
  }

  /** Store a response in the cache. */
  put(
    prompt: string,
    model: string,
    temperature: number,
    responseFormat: string,
    content: string,
    provider: string,
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
    latencyMs: number,
  ): CacheEntry {
    const key = hashPrompt(prompt, model, temperature, responseFormat);
    const entry: CacheEntry = {
      promptHash: key,
      content,
      provider,
      model,
      usage,
      latencyMs,
      timestamp: Date.now(),
    };
    this.state.entries[key] = entry;
    this.save();
    return entry;
  }

  /** Stats for logging/reporting. */
  stats(): { entries: number; hits: number; misses: number; hitRate: number } {
    const total = this.state.hits + this.state.misses;
    return {
      entries: Object.keys(this.state.entries).length,
      hits: this.state.hits,
      misses: this.state.misses,
      hitRate: total > 0 ? this.state.hits / total : 0,
    };
  }

  /** Reset the cache (useful for testing). */
  reset(): void {
    this.state = { version: CACHE_VERSION, entries: {}, hits: 0, misses: 0 };
    this.save();
  }
}
