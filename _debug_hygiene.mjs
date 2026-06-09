#!/usr/bin/env node
import { runDeepAnalysis } from "./packages/grading-engine/src/analyzers/index.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const dir = "C:/Users/User/Desktop/jobclaw";
const SKIP = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".cache", ".turbo", "build"]);

function getAllFiles(d) {
  const r = [];
  try {
    for (const e of readdirSync(d)) {
      if (SKIP.has(e)) continue;
      const f = join(d, e);
      if (statSync(f).isDirectory()) r.push(...getAllFiles(f));
      else r.push(f);
    }
  } catch {}
  return r;
}

const allFiles = getAllFiles(dir);
const sourceExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"]);
const sourceFiles = allFiles
  .filter((f) => sourceExts.has(extname(f)))
  .slice(0, 50)
  .map((fp) => {
    try {
      return { path: fp.replace(dir + "\\", ""), content: readFileSync(fp, "utf-8").slice(0, 10000) };
    } catch {
      return null;
    }
  })
  .filter(Boolean);

console.log(`Source files analyzed: ${sourceFiles.length}`);

const deep = runDeepAnalysis(dir, allFiles, sourceFiles, "{}");
console.log(`codeHygiene.score: ${deep.codeHygiene.score}`);
console.log(`codeHygiene.totalCount: ${deep.codeHygiene.totalCount}`);
console.log(`codeHygiene.categoriesFound: ${JSON.stringify(deep.codeHygiene.categoriesFound)}`);
const counts = { critical: 0, high: 0, medium: 0, low: 0 };
for (const f of deep.codeHygiene.findings) counts[f.severity]++;
console.log(`Severity breakdown: ${JSON.stringify(counts)}`);
const computed = Math.max(0, 100 - counts.critical * 15 - counts.high * 5 - counts.medium * 2 - counts.low * 1);
console.log(`Formula: 100 - ${counts.critical}*15 - ${counts.high}*5 - ${counts.medium}*2 - ${counts.low}*1 = ${computed}`);
console.log(`first 3 findings:`, JSON.stringify(deep.codeHygiene.findings.slice(0, 3)));
