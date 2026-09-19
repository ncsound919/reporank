import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runAuditCore,
  toSharedFindings,
  normalizeSeverity,
  defaultDimension,
  type SharedFinding,
} from "../core-client";
import type { ScanFinding } from "../scan-findings";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as unknown as Response;
}

const finding: ScanFinding = {
  category: "security",
  severity: "critical",
  type: "secret-aws-access-key",
  description: "Potential aws-access-key committed in source",
  recommendation: "Remove the secret and rotate it.",
  confidence: 0.7,
  path: "src/config.ts",
  line: 12,
  located: true,
  source: "regex:secret-patterns",
};

describe("runAuditCore", () => {
  it("returns core on success and posts the expected request", async () => {
    const core = { validation: { confirmed: 1, stale: 0 }, gate: { passed: true } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, core }));
    vi.stubGlobal("fetch", fetchMock);

    const shared = toSharedFindings([finding]);
    const result = await runAuditCore({
      baseUrl: "http://openhub.test/",
      token: "tok",
      targetDir: "/repo",
      findings: shared,
      changedLines: 5,
      labels: ["security"],
      timeoutMs: 1000,
    });

    expect(result).toEqual({ ok: true, core });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://openhub.test/api/audit-core/run");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({
      targetDir: "/repo",
      findings: shared,
      changedLines: 5,
      labels: ["security"],
    });
  });

  it("omits Authorization when no token is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, core: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await runAuditCore({ baseUrl: "http://openhub.test", targetDir: "/repo", findings: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("returns ok:false on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 503, statusText: "Service Unavailable" })),
    );
    const result = await runAuditCore({ baseUrl: "http://openhub.test", targetDir: "/repo", findings: [] });
    expect(result).toEqual({ ok: false, error: "HTTP 503 Service Unavailable" });
  });

  it("returns ok:false when fetch throws (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const result = await runAuditCore({ baseUrl: "http://openhub.test", targetDir: "/repo", findings: [] });
    expect(result).toEqual({ ok: false, error: "connect ECONNREFUSED" });
  });

  it("returns ok:false when the body is not a core envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false })));
    const result = await runAuditCore({ baseUrl: "http://openhub.test", targetDir: "/repo", findings: [] });
    expect(result).toEqual({ ok: false, error: "unexpected core response" });
  });
});

describe("toSharedFindings", () => {
  it("maps a located ScanFinding into the shared shape", () => {
    const [shared] = toSharedFindings([finding]);
    expect(shared).toEqual({
      source: "regex:secret-patterns",
      dimension: "security",
      category: "security",
      severity: "critical",
      confidence: 0.7,
      determinism: "heuristic",
      location: { file: "src/config.ts", line: 12 },
      evidence: "Potential aws-access-key committed in source",
      remediation: "Remove the secret and rotate it.",
    } satisfies SharedFinding);
  });

  it("defaults dimension by category and omits location for unlocated findings", () => {
    const dep: ScanFinding = {
      ...finding,
      category: "dependency",
      path: undefined,
      line: undefined,
      located: false,
      severity: "medium",
      source: "grading-engine:analyzeDependencies",
    };
    const [shared] = toSharedFindings([dep]);
    expect(shared.dimension).toBe("supply-chain");
    expect(shared.location).toBeUndefined();
    expect(shared.determinism).toBe("static");
  });

  it("maps enterprise categories to governance and defaults unknown to quality", () => {
    expect(defaultDimension("enterprise-observability")).toBe("governance");
    expect(defaultDimension("something-else")).toBe("quality");
  });

  it("normalizes severity aliases and defaults unknown to info", () => {
    expect(normalizeSeverity("ERROR")).toBe("high");
    expect(normalizeSeverity("warning")).toBe("medium");
    expect(normalizeSeverity("bogus")).toBe("info");
  });
});
