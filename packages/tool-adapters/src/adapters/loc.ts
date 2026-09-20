import { execa } from 'execa';
import type { ToolAdapter, AdapterResult } from '../index.js';

/**
 * LOC adapter — real lines-of-code counts from `scc` (preferred) or `tokei`.
 *
 * Both are OSS counters that are far more accurate than a naive newline count
 * (they exclude blanks/comments and report per-language totals). When neither
 * binary is on PATH the adapter reports an honest failure instead of inventing
 * a number; RepoRank must treat LOC as unavailable, not zero.
 */

export interface LocByLanguage {
  code: number;
  comments: number;
  blanks: number;
  files?: number;
}

export interface LocSummary {
  tool: 'scc' | 'tokei';
  total: LocByLanguage;
  byLanguage: Record<string, LocByLanguage>;
}

interface SccRow {
  Name?: string;
  Code?: number;
  Comment?: number;
  Blank?: number;
  Count?: number;
}

interface TokeiLanguage {
  code?: number;
  comments?: number;
  blanks?: number;
  reports?: unknown[];
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Parse `scc --format json` output (an array of per-language rows). */
export function parseSccJson(text: string): LocSummary | null {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const byLanguage: Record<string, LocByLanguage> = {};
  const total: LocByLanguage = { code: 0, comments: 0, blanks: 0, files: 0 };
  for (const r of rows as SccRow[]) {
    const name = String(r?.Name ?? '').trim();
    if (!name) continue;
    const entry: LocByLanguage = {
      code: num(r.Code),
      comments: num(r.Comment),
      blanks: num(r.Blank),
      files: num(r.Count),
    };
    byLanguage[name] = entry;
    total.code += entry.code;
    total.comments += entry.comments;
    total.blanks += entry.blanks;
    if (total.files !== undefined) total.files += entry.files ?? 0;
  }
  if (Object.keys(byLanguage).length === 0) return null;
  return { tool: 'scc', total, byLanguage };
}

/** Parse `tokei --output json` output (a map of language name -> counts). */
export function parseTokeiJson(text: string): LocSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, TokeiLanguage>;
  const byLanguage: Record<string, LocByLanguage> = {};
  const total: LocByLanguage = { code: 0, comments: 0, blanks: 0, files: 0 };
  for (const [name, v] of Object.entries(raw)) {
    if (name === 'Total' || !v || typeof v !== 'object') continue;
    const entry: LocByLanguage = {
      code: num(v.code),
      comments: num(v.comments),
      blanks: num(v.blanks),
      files: Array.isArray(v.reports) ? v.reports.length : undefined,
    };
    byLanguage[name] = entry;
    total.code += entry.code;
    total.comments += entry.comments;
    total.blanks += entry.blanks;
    if (total.files !== undefined) total.files += entry.files ?? 0;
  }
  if (Object.keys(byLanguage).length === 0) return null;
  return { tool: 'tokei', total, byLanguage };
}

async function tryScc(cwd: string): Promise<AdapterResult | null> {
  try {
    const { stdout } = await execa('scc', ['--format', 'json', '.'], { cwd });
    const summary = parseSccJson(stdout);
    if (!summary) return null;
    return { tool: 'scc', success: true, output: JSON.stringify(summary) };
  } catch {
    return null;
  }
}

async function tryTokei(cwd: string): Promise<AdapterResult | null> {
  try {
    const { stdout } = await execa('tokei', ['--output', 'json', '.'], { cwd });
    const summary = parseTokeiJson(stdout);
    if (!summary) return null;
    return { tool: 'tokei', success: true, output: JSON.stringify(summary) };
  } catch {
    return null;
  }
}

export const locAdapter: ToolAdapter = {
  async run(cwd: string): Promise<AdapterResult> {
    const scc = await tryScc(cwd);
    if (scc) return scc;
    const tokei = await tryTokei(cwd);
    if (tokei) return tokei;
    return {
      tool: 'loc',
      success: false,
      output: '',
      errors: ['neither scc nor tokei found on PATH — LOC unavailable (not zero)'],
    };
  },
};
