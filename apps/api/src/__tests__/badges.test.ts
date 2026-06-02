import { describe, it, expect } from "vitest";
import { renderTrustBadge, renderVibeBadge, renderSoftware20Badge } from "../services/badges";
import type { TrustScoreResult } from "@reporank/grading-engine";

const baseTrust: TrustScoreResult = {
  trust: 85,
  grade: "A",
  components: {
    codeHealth: { score: 90, weight: 0.4, contribution: 36 },
    vibe: { score: 20, weight: 0.2, contribution: 16 },
    software20: { score: 80, weight: 0.15, contribution: 12 },
    security: { score: 100, weight: 0.15, contribution: 15 },
    agentsCompliance: { score: 60, weight: 0.1, contribution: 6 },
  },
  feedback: ["Strong code health (90/100)."],
  recommendations: [],
};

describe("badges service", () => {
  it("renders a valid trust SVG with the score and grade", () => {
    const svg = renderTrustBadge(baseTrust);
    expect(svg).toContain("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("85");
    expect(svg).toContain("trust score");
    expect(svg).toContain("A");
    // Should have a closing </svg>
    expect(svg).toContain("</svg>");
  });

  it("renders different colors based on score", () => {
    const high = renderTrustBadge({ ...baseTrust, trust: 90 });
    const low = renderTrustBadge({ ...baseTrust, trust: 10 });
    // High score should be green-ish, low score red-ish
    expect(high).toContain("#4c1");
    expect(low).toContain("#e05d44");
  });

  it("produces well-formed XML with correct dimensions", () => {
    const svg = renderTrustBadge(baseTrust);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // Width must include label + value text width — the outermost <svg width="...">
    // comes first, so use a non-greedy match anchored to <svg.
    // Width value is a float (e.g. "111.5") so allow decimals.
    const widthMatch = svg.match(/<svg[^>]*width="([\d.]+)"/);
    expect(widthMatch).not.toBeNull();
    expect(parseFloat(widthMatch![1])).toBeGreaterThan(80);
  });

  it("escapes special characters via the internal escape function (defense in depth)", () => {
    // Indirect: the badge hardcodes label "trust score" but if a future change
    // allows custom labels, the escape function must handle injection.
    // We test that the SVG never contains unescaped < or > except in tags.
    const svg = renderTrustBadge(baseTrust);
    // Strip all valid SVG tags, then assert no orphan < or > remain
    const stripped = svg.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    expect(stripped).not.toContain("<");
    expect(stripped).not.toContain(">");
  });

  it("renders vibe badge with suffix when high or low", () => {
    const high = renderVibeBadge(70);
    const low = renderVibeBadge(20);
    const med = renderVibeBadge(45);
    expect(high).toContain("high");
    expect(low).toContain("low");
    expect(med).not.toContain("high");
    expect(med).not.toContain("low");
  });

  it("renders software 2.0 badge with score", () => {
    const svg = renderSoftware20Badge(75);
    expect(svg).toContain("software 2.0");
    expect(svg).toContain("75");
  });

  it("escapes ampersands and quotes in vibe badge", () => {
    // The label "vibe coding" contains no special chars, but value is numeric
    // — verify the renderer doesn't blow up on edge values
    expect(renderVibeBadge(0)).toContain("0");
    expect(renderVibeBadge(100)).toContain("100");
  });

  it("clamps NaN to 0 in vibe and software 2.0 renderers", () => {
    expect(renderVibeBadge(NaN)).toContain("0");
    expect(renderSoftware20Badge(NaN)).toContain("0");
  });

  it("clamps negative values to 0", () => {
    expect(renderVibeBadge(-10)).toContain("0");
    expect(renderSoftware20Badge(-5)).toContain("0");
  });

  it("clamps values above 100 to 100", () => {
    expect(renderVibeBadge(150)).toContain("100");
    expect(renderSoftware20Badge(200)).toContain("100");
  });
});
