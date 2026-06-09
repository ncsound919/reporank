import { describe, it, expect } from "vitest";
import { heuristicScan } from "../heuristic_scanner";

describe("heuristic_scanner — security rules", () => {
  it("detects eval() usage", () => {
    const findings = heuristicScan(`function calculate(expr) { return eval(expr); }`);
    const types = findings.map((f) => f.type);
    expect(types).toContain("code-injection");
  });

  it("does NOT flag new Function with static args (false positive guard)", () => {
    const findings = heuristicScan(
      `const add = new Function('a', 'b', 'return a + b');`
    );
    expect(findings.find((f) => f.type === "code-injection")).toBeUndefined();
  });

  it("detects SQL injection via template literal in query()", () => {
    const findings = heuristicScan(
      "db.query(`SELECT * FROM users WHERE id = ${id}`)"
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("sql-injection");
  });

  it("detects SQL injection via string concat in execute()", () => {
    const findings = heuristicScan(
      'db.execute("SELECT * FROM users WHERE id = " + userId)'
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("sql-injection");
  });

  it("detects dangerouslySetInnerHTML (XSS)", () => {
    const findings = heuristicScan(
      `<div dangerouslySetInnerHTML={{ __html: userContent }} />`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("xss");
  });

  it("detects hardcoded API key (sk- prefix)", () => {
    const findings = heuristicScan(
      `const config = { apiKey: "sk-abc123def456ghi789jkl" };`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("hardcoded-secret");
  });

  it("detects MD5 hash (weak crypto)", () => {
    const findings = heuristicScan(
      `const hash = createHash("md5");`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("weak-crypto");
  });

  it("detects Math.random for security tokens", () => {
    const findings = heuristicScan(
      `const token = Math.random().toString(36);`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("insecure-random");
  });
});

describe("heuristic_scanner — quality rules", () => {
  it("detects setInterval without clearInterval (resource leak)", () => {
    const findings = heuristicScan(`
      useEffect(() => {
        setInterval(() => fetchData(), 5000);
      }, []);
    `);
    const types = findings.map((f) => f.type);
    expect(types).toContain("resource-leak");
  });

  it("detects await without try/catch (no-error-handling)", () => {
    const findings = heuristicScan(`
      async function load() {
        const data = await fetchData();
        return data;
      }
    `);
    const types = findings.map((f) => f.type);
    expect(types).toContain("no-error-handling");
  });

  it("does NOT flag try/catch async (no false positive)", () => {
    const findings = heuristicScan(`
      async function load() {
        try {
          const data = await fetchData();
          return data;
        } catch (e) {
          return null;
        }
      }
    `);
    expect(findings.find((f) => f.type === "no-error-handling")).toBeUndefined();
  });

  it("detects any-type-abuse", () => {
    const findings = heuristicScan(
      `function getLen(obj: any) { return obj.value.length; }`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("any-type-abuse");
  });

  it("detects console.log in production code", () => {
    const findings = heuristicScan(
      `function doWork() { console.log("debug"); return 42; }`
    );
    const types = findings.map((f) => f.type);
    expect(types).toContain("debug-code");
  });
});

describe("heuristic_scanner — known dataset entries", () => {
  it("matches the 6-entry dataset correctly — catches hardcoded-secret, code-injection, resource-leak, xss, no-error-handling", () => {
    const cases = [
      { code: "import express from 'express';\nconst app = express();\napp.get('/users', (req, res) => {\n  const id = req.query.id;\n  const sql = `SELECT * FROM users WHERE id = ${id}`;\n  db.query(sql, (err, rows) => {\n    if (err) throw err;\n    res.json(rows);\n  });\n});", expectedTypes: [] as string[] },
      { code: "import express from 'express';\nconst app = express();\napp.get('/data', async (req, res) => {\n  const result = await fetchData(req.params.id);\n  res.json(result);\n});", expectedTypes: ["no-error-handling"] },
      { code: "export const config = {\n  apiKey: 'sk-abc123def456ghi789jkl',\n  endpoint: 'https://api.example.com',\n  timeout: 5000,\n};", expectedTypes: ["hardcoded-secret"] },
      { code: "function calculate(expression: string): number {\n  return eval(expression);\n}", expectedTypes: ["code-injection"] },
      { code: "import { useEffect } from 'react';\nfunction PollingComponent() {\n  useEffect(() => {\n    setInterval(() => {\n      console.log('Polling...');\n    }, 1000);\n  }, []);\n  return <div>Polling</div>;\n}", expectedTypes: ["resource-leak"] },
      { code: "import React from 'react';\nfunction Comment({ content }: { content: string }) {\n  return (\n    <div\n      dangerouslySetInnerHTML={{ __html: content }}\n    />\n  );\n}", expectedTypes: ["xss"] },
    ];
    for (const tc of cases) {
      const findings = heuristicScan(tc.code);
      const types = findings.map((f) => f.type);
      for (const expected of tc.expectedTypes) {
        expect(types).toContain(expected);
      }
    }
  });
});
