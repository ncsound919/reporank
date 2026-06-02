// Curated benchmark dataset of known submissions for calibrating the
// education auditor. Each entry is paired with an expected score range
// so the audit thresholds can be validated against ground truth.
//
// "kind" reflects the intended signal:
//   - "human"     : written by a human from scratch, low AI patterns expected
//   - "ai-heavy"  : clearly AI-generated boilerplate, high contamination expected
//   - "ai-mixed"  : human code with significant AI assistance (PR review style)
//
// Expected ranges are calibrated from internal spot-checks of the
// contamination analyzer on similar code. They are intentionally
// generous (±15) because the analyzer is heuristic.

export interface BenchmarkEntry {
  id: string;
  kind: "human" | "ai-heavy" | "ai-mixed";
  description: string;
  source: string;
  language: "typescript" | "javascript" | "python" | "go" | "rust" | "java";
  code: string;
  /**
   * Expected vibe score range (0-100).
   * "human" → 0-30
   * "ai-mixed" → 30-60
   * "ai-heavy" → 60-100
   */
  expectedVibeRange: [number, number];
}

const TS_HUMAN: BenchmarkEntry = {
  id: "bench-ts-human-1",
  kind: "human",
  description: "Idiomatic TypeScript with quirky parameter naming, no comments, concise.",
  source: "Open-source library (no AI assistance)",
  language: "typescript",
  code: `export function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  const out: T[K][] = [];
  for (let i = 0; i < items.length; i++) {
    out.push(items[i][key]);
  }
  return out;
}

export function groupBy<T>(items: T[], fn: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of items) {
    const k = fn(x);
    if (!out[k]) out[k] = [];
    out[k].push(x);
  }
  return out;
}`,
  expectedVibeRange: [0, 30],
};

const TS_AI_HEAVY: BenchmarkEntry = {
  id: "bench-ts-ai-1",
  kind: "ai-heavy",
  description: "GPT-style: extensive comments, defensive checks, helper functions named by verb.",
  source: "Synthetic — typical ChatGPT-4 output",
  language: "typescript",
  code: `/**
 * Plucks the specified key from each item in the array.
 * @param items The array of items to pluck from.
 * @param key The key to pluck from each item.
 * @returns An array of the plucked values.
 */
export function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  // Validate input parameters
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }
  if (typeof key !== "string" && typeof key !== "number" && typeof key !== "symbol") {
    throw new TypeError("key must be a valid property key");
  }

  // Initialize the result array
  const result: T[K][] = [];

  // Iterate through each item and pluck the key
  for (const item of items) {
    // Check if the item is not null or undefined
    if (item !== null && item !== undefined) {
      // Check if the key exists in the item
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        result.push(item[key]);
      }
    }
  }

  return result;
}

/**
 * Groups items by the result of applying the provided function.
 * @param items The array of items to group.
 * @param fn The function to determine the group key for each item.
 * @returns A record mapping group keys to arrays of items.
 */
export function groupBy<T>(items: T[], fn: (x: T) => string): Record<string, T[]> {
  // Validate input parameters
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }
  if (typeof fn !== "function") {
    throw new TypeError("fn must be a function");
  }

  // Initialize the result object
  const result: Record<string, T[]> = {};

  // Iterate through each item
  for (const item of items) {
    // Compute the group key
    const key = fn(item);
    // Initialize the group if it doesn't exist
    if (!result[key]) {
      result[key] = [];
    }
    // Add the item to the group
    result[key].push(item);
  }

  return result;
}`,
  expectedVibeRange: [60, 100],
};

const TS_AI_MIXED: BenchmarkEntry = {
  id: "bench-ts-mix-1",
  kind: "ai-mixed",
  description: "Human scaffold with AI-added JSDoc and edge-case handling.",
  source: "Open-source PR — author wrote logic, AI added docs",
  language: "typescript",
  code: `// Pull out one field from each object in a list.
export function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map(item => item[key]);
}

// Group items by some computed string.
export function groupBy<T>(items: T[], fn: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of items) {
    const k = fn(x);
    (out[k] ??= []).push(x);
  }
  return out;
}`,
  expectedVibeRange: [20, 50],
};

const PY_HUMAN: BenchmarkEntry = {
  id: "bench-py-human-1",
  kind: "human",
  description: "Pythonic, uses walrus operator, no excessive comments.",
  source: "Personal utility script",
  language: "python",
  code: `def dedupe(items, key=lambda x: x):
    seen = set()
    out = []
    for x in items:
        k = key(x)
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out

def chunked(items, size):
    return [items[i:i + size] for i in range(0, len(items), size)]
`,
  expectedVibeRange: [0, 25],
};

const PY_AI_HEAVY: BenchmarkEntry = {
  id: "bench-py-ai-1",
  kind: "ai-heavy",
  description: "Type-annotated, docstring-rich, defensive — classic Copilot output.",
  source: "Synthetic — Copilot suggestion",
  language: "python",
  code: `from typing import Callable, Iterable, List, TypeVar

T = TypeVar("T")
K = TypeVar("K")

def dedupe(
    items: Iterable[T],
    key: Callable[[T], K] = lambda x: x,
) -> List[T]:
    """Remove duplicates from an iterable while preserving order.

    Args:
        items: The iterable to deduplicate.
        key: A function to compute the comparison key for each item.

    Returns:
        A list of unique items in their original order.
    """
    # Use a set to track seen keys for O(1) lookup
    seen: set = set()
    # Build the result list
    result: List[T] = []
    # Iterate through each item
    for item in items:
        # Compute the key for this item
        k = key(item)
        # Skip if we've already seen this key
        if k in seen:
            continue
        # Add to seen and result
        seen.add(k)
        result.append(item)
    # Return the deduplicated list
    return result

def chunked(
    items: List[T],
    size: int,
) -> List[List[T]]:
    """Split a list into chunks of the specified size.

    Args:
        items: The list to chunk.
        size: The size of each chunk.

    Returns:
        A list of chunks.

    Raises:
        ValueError: If size is not positive.
    """
    # Validate size parameter
    if size <= 0:
        raise ValueError("size must be positive")
    # Use list comprehension to build chunks
    return [items[i:i + size] for i in range(0, len(items), size)]
`,
  expectedVibeRange: [60, 100],
};

const GO_HUMAN: BenchmarkEntry = {
  id: "bench-go-human-1",
  kind: "human",
  description: "Idiomatic Go — terse, no comments, error returned.",
  source: "Open-source CLI tool",
  language: "go",
  code: `package util

import "errors"

func Pluck[T any, K comparable](items []T, key func(T) K) []K {
	out := make([]K, 0, len(items))
	for _, item := range items {
		out = append(out, key(item))
	}
	return out
}

func GroupBy[T any](items []T, key func(T) string) (map[string][]T, error) {
	if items == nil {
		return nil, errors.New("items cannot be nil")
	}
	out := make(map[string][]T)
	for _, item := range items {
		k := key(item)
		out[k] = append(out[k], item)
	}
	return out, nil
}`,
  expectedVibeRange: [0, 30],
};

const JS_AI_HEAVY: BenchmarkEntry = {
  id: "bench-js-ai-1",
  kind: "ai-heavy",
  description: "Defensive JavaScript with arrow functions and verbose type guards.",
  source: "Synthetic — Copilot autocomplete",
  language: "javascript",
  code: `/**
 * Plucks the specified key from each item in the array.
 * @param {Array} items - The array of items to pluck from.
 * @param {string|number|symbol} key - The key to pluck from each item.
 * @returns {Array} An array of the plucked values.
 */
const pluck = (items, key) => {
  // Validate input parameters
  if (!Array.isArray(items)) {
    throw new TypeError('items must be an array');
  }
  // Initialize the result array
  const result = [];
  // Iterate through each item
  for (const item of items) {
    // Check if the item is valid
    if (item != null && typeof item === 'object') {
      // Check if the key exists
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        result.push(item[key]);
      }
    }
  }
  return result;
};`,
  expectedVibeRange: [55, 100],
};

export const BENCHMARK_DATASET: BenchmarkEntry[] = [
  TS_HUMAN,
  TS_AI_HEAVY,
  TS_AI_MIXED,
  PY_HUMAN,
  PY_AI_HEAVY,
  GO_HUMAN,
  JS_AI_HEAVY,
];

export function getBenchmarksByKind(kind: BenchmarkEntry["kind"]): BenchmarkEntry[] {
  return BENCHMARK_DATASET.filter(b => b.kind === kind);
}

export interface CalibrationResult {
  total: number;
  correct: number;
  accuracy: number;
  failures: { id: string; kind: string; expected: [number, number]; actual: number }[];
}

/**
 * Validate the audit's score against the benchmark's expected range.
 * Use to tune thresholds over time.
 */
export function calibrate(measure: (entry: BenchmarkEntry) => number): CalibrationResult {
  const failures: CalibrationResult["failures"] = [];
  let correct = 0;
  for (const entry of BENCHMARK_DATASET) {
    const actual = measure(entry);
    const [low, high] = entry.expectedVibeRange;
    if (actual >= low && actual <= high) {
      correct++;
    } else {
      failures.push({ id: entry.id, kind: entry.kind, expected: entry.expectedVibeRange, actual });
    }
  }
  return {
    total: BENCHMARK_DATASET.length,
    correct,
    accuracy: correct / BENCHMARK_DATASET.length,
    failures,
  };
}
