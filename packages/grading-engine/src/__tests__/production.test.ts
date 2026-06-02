import { describe, it, expect } from "vitest";
import { analyzeProductionReadiness } from "../analyzers/production";

describe("analyzeProductionReadiness", () => {
  it("detects unhandled rejections in async functions", () => {
    const files = [{ path: "service.ts", content: "async function fetchData() {\n  const res = await fetch(url);\n  return res.json();\n}" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "unhandled-rejection")).toBe(true);
  });

  it("detects sync blocking operations", () => {
    const files = [{ path: "service.ts", content: "const data = readFileSync('config.json');" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "sync-blocking")).toBe(true);
  });

  it("detects missing timeouts on HTTP calls", () => {
    const files = [{ path: "service.ts", content: "const res = await fetch('https://api.example.com');" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "missing-timeout")).toBe(true);
  });

  it("detects hardcoded credentials", () => {
    const files = [{ path: "config.ts", content: "const API_KEY = 'AIzaSyDxMsomeRandomKeyHereForTesting123456789';" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "config-exposure")).toBe(true);
  });

  it("detects missing graceful shutdown", () => {
    const files = [{ path: "app.ts", content: "app.listen(3000);" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "no-graceful-shutdown")).toBe(true);
  });

  it("detects missing health check", () => {
    const files = [{ path: "app.ts", content: "app.listen(3000);" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "missing-healthcheck")).toBe(true);
  });

  it("accepts code with graceful shutdown and health check", () => {
    const files = [
      { path: "server.ts", content: "process.on('SIGTERM', () => {});\nconst app = express();\napp.get('/health', (req, res) => res.json({ status: 'ok' }));\napp.listen(3000);" },
    ];
    const result = analyzeProductionReadiness(files, ["server.ts"]);
    const hasShutdown = result.findings.some(f => f.type === "no-graceful-shutdown");
    const hasHealth = result.findings.some(f => f.type === "missing-healthcheck");
    expect(hasShutdown).toBe(false);
    expect(hasHealth).toBe(false);
  });

  it("detects insufficient logging", () => {
    const files = Array(10).fill(null).map((_, i) => ({ path: `file${i}.ts`, content: 'console.log("hello");' }));
    const result = analyzeProductionReadiness(files, []);
    expect(result.findings.some(f => f.type === "insufficient-logging")).toBe(true);
  });

  it("detects missing .env.example", () => {
    const result = analyzeProductionReadiness([{ path: "app.ts", content: "const x = 1;" }], []);
    expect(result.findings.some(f => f.type === "missing-env")).toBe(true);
  });

  it("sets overallReadiness correctly when critical found", () => {
    const files = [{ path: "config.ts", content: "const SECRET = 'AIzaSyDxMsomeRandomKeyHereForTesting123456789';" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.overallReadiness).toBe("not-ready");
  });

  it("categorizes deploy blockers separately", () => {
    const files = [{ path: "config.ts", content: "const SECRET = 'AIzaSyDxMsomeRandomKeyHereForTesting123456789';" }];
    const result = analyzeProductionReadiness(files, []);
    expect(result.deployBlockers.length).toBeGreaterThanOrEqual(1);
  });

  it("returns summary", () => {
    const result = analyzeProductionReadiness([{ path: "app.ts", content: "const x = 1;" }], []);
    expect(typeof result.summary).toBe("string");
  });
});
