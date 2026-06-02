// SVG badge renderers — shields.io-style, no external deps
// 100x20 or 200x20 standard; embedded text uses XML-escaped labels.

import type { TrustScoreResult } from "@reporank/grading-engine";

function clampScore(n: number, max: number = 100): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function colorForScore(score: number, max: number = 100): string {
  const safe = clampScore(score, max);
  const pct = (safe / max) * 100;
  if (pct >= 80) return "#4c1"; // bright green
  if (pct >= 60) return "#97ca00"; // green
  if (pct >= 40) return "#dfb317"; // yellow
  if (pct >= 20) return "#fe7d37"; // orange
  return "#e05d44"; // red
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]!));
}

function badge(label: string, value: string, color: string, suffix: string = ""): string {
  const labelWidth = Math.max(40, label.length * 6.5);
  const valueWidth = Math.max(40, (value + suffix).length * 6.5);
  const total = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#g)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}${escapeXml(suffix)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}${escapeXml(suffix)}</text>
  </g>
</svg>`;
}

export function renderTrustBadge(result: TrustScoreResult): string {
  const v = clampScore(result.trust);
  return badge("trust score", String(v), colorForScore(v), ` · ${result.grade}`);
}

export function renderVibeBadge(vibe: number): string {
  // Vibe is inverted: high vibe = bad (high AI contamination)
  const v = clampScore(vibe);
  const color = v >= 60 ? "#e05d44" : v >= 30 ? "#dfb317" : "#4c1";
  return badge("vibe coding", String(v), color, v >= 60 ? " · high" : v <= 30 ? " · low" : "");
}

export function renderSoftware20Badge(s20: number): string {
  const v = clampScore(s20);
  return badge("software 2.0", String(v), colorForScore(v));
}
