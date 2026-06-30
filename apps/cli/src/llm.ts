import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const CACHE_VERSION = 1;
const CACHE_FILE_NAME = "llm-cache.json";
const SAVE_ERROR_PREFIX = "[llm-cache] save failed:";

export interface CacheEntry {
  promptHash: string;
  content: string;
  provider: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latencyMs: number;
  timestamp: number;
}

export interface LLMCacheState {
  version: number;
  entries: Record<string, CacheEntry>;
  hits: number;
  misses: number;
}

interface CacheUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function cachePathFor(): string {
  const dir = process.env.VIBESERVE_CACHE_DIR;

  if (typeof dir === "string" && dir.trim() !== "") {
    const resolvedDir = resolve(dir);
    ensureDir(resolvedDir);
    return join(resolvedDir, CACHE_FILE_NAME);
  }

  return resolve(`.${CACHE_FILE_NAME}`);
}

function hashPrompt(
  prompt: string,
  model: string,
  temperature: number,
  responseFormat: string,
): string {
  return createHash("sha256")
    .update(prompt, "utf-8")
    .update("|", "utf-8")
    .update(model, "utf-8")
    .update("|", "utf-8")
    .update(String(temperature), "utf-8")
    .update("|", "utf-8")
    .update(responseFormat, "utf-8")
    .digest("hex");
}

function defaultState(): LLMCacheState {
  return {
    version: CACHE_VERSION,
    entries: {},
    hits: 0,
    misses: 0,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeUsage(value: unknown): CacheUsage {
  const usage = (value ?? {}) as Partial<CacheUsage>;

  const promptTokens = isFiniteNumber(usage.prompt_tokens) ? usage.prompt_tokens : 0;
  const completionTokens = isFiniteNumber(usage.completion_tokens) ? usage.completion_tokens : 0;
  const totalTokens =
    isFiniteNumber(usage.total_tokens) ? usage.total_tokens : promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function normalizeEntry(key: string, value: unknown): CacheEntry | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<CacheEntry>;

  if (
    typeof raw.content !== "string" ||
    typeof raw.provider !== "string" ||
    typeof raw.model !== "string"
  ) {
    return null;
  }

  return {
    promptHash: typeof raw.promptHash === "string" ? raw.promptHash : key,
    content: raw.content,
    provider: raw.provider,
    model: raw.model,
    usage: normalizeUsage(raw.usage),
    latencyMs: isFiniteNumber(raw.latencyMs) ? raw.latencyMs : 0,
    timestamp: isFiniteNumber(raw.timestamp) ? raw.timestamp : Date.now(),
  };
}

function normalizeState(value: unknown): LLMCacheState {
  if (!value || typeof value !== "object") {
    return defaultState();
  }

  const raw = value as Partial<LLMCacheState>;
  if (raw.version !== CACHE_VERSION) {
    return defaultState();
  }

  const entries: Record<string, CacheEntry> = {};
  if (raw.entries && typeof raw.entries === "object") {
    for (const [key, entry] of Object.entries(raw.entries)) {
      const normalized = normalizeEntry(key, entry);
      if (normalized) {
        entries[key] = normalized;
      }
    }
  }

  return {
    version: CACHE_VERSION,
    entries,
    hits: isFiniteNumber(raw.hits) ? raw.hits : 0,
    misses: isFiniteNumber(raw.misses) ? raw.misses : 0,
  };
}

function writeJsonAtomically(path: string, data: unknown): void {
  const dir = dirname(path);
  ensureDir(dir);

  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  writeFileSync(tempPath, payload, "utf-8");
  renameSync(tempPath, path);
}

export class LLMCache {
  private readonly path: string;
  private state: LLMCacheState;

  constructor(path = cachePathFor()) {
    this.path = path;
    this.state = this.load();
  }

  private load(): LLMCacheState {
    if (!existsSync(this.path)) {
      return defaultState();
    }

    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as unknown;
      return normalizeState(raw);
    } catch {
      return defaultState();
    }
  }

  private save(): void {
    try {
      writeJsonAtomically(this.path, this.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${SAVE_ERROR_PREFIX} ${message}\n`);
    }
  }

  private maybePersistCounters(): void {
    const totalLookups = this.state.hits + this.state.misses;
    if (totalLookups % 10 === 0) {
      this.save();
    }
  }

  get(
    prompt: string,
    model: string,
    temperature: number,
    responseFormat: string,
  ): CacheEntry | null {
    const key = hashPrompt(prompt, model, temperature, responseFormat);
    const entry = this.state.entries[key];

    if (entry) {
      this.state.hits += 1;
      this.maybePersistCounters();
      return entry;
    }

    this.state.misses += 1;
    this.maybePersistCounters();
    return null;
  }

  put(
    prompt: string,
    model: string,
    temperature: number,
    responseFormat: string,
    content: string,
    provider: string,
    usage: CacheUsage,
    latencyMs: number,
  ): CacheEntry {
    const key = hashPrompt(prompt, model, temperature, responseFormat);

    const entry: CacheEntry = {
      promptHash: key,
      content,
      provider,
      model,
      usage: normalizeUsage(usage),
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
      timestamp: Date.now(),
    };

    this.state.entries[key] = entry;
    this.save();
    return entry;
  }

  stats(): { entries: number; hits: number; misses: number; hitRate: number } {
    const total = this.state.hits + this.state.misses;

    return {
      entries: Object.keys(this.state.entries).length,
      hits: this.state.hits,
      misses: this.state.misses,
      hitRate: total > 0 ? this.state.hits / total : 0,
    };
  }

  reset(): void {
    this.state = defaultState();
    this.save();
  }
}
