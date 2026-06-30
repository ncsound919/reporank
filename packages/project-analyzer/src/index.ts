#!/usr/bin/env node

import { Command } from "commander";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { analyzeNode } from "./analyzers/node.js";
import { analyzePython } from "./analyzers/python.js";
import { analyzeRust } from "./analyzers/rust.js";
import { analyzeGo } from "./analyzers/go.js";

interface AnalyzerResult {
  found?: boolean;
  [key: string]: unknown;
}

interface ProjectAnalysisResults {
  stack: { language: string };
  node: AnalyzerResult;
  python: AnalyzerResult;
  rust: AnalyzerResult;
  go: AnalyzerResult;
}

const program = new Command();

program
  .name("project-analyzer")
  .description("Analyze a directory to infer the tech stack")
  .showHelpAfterError()
  .argument("<path>", "Directory path to analyze")
  .option("--output-json", "Output results as JSON")
  .action(async (targetPath: string, options: { outputJson?: boolean }) => {
    const resolvedPath = resolve(targetPath);
    await assertDirectoryExists(resolvedPath);

    const [node, python, rust, go] = await Promise.all([
      analyzeNode(resolvedPath),
      analyzePython(resolvedPath),
      analyzeRust(resolvedPath),
      analyzeGo(resolvedPath),
    ]);

    const results: ProjectAnalysisResults = {
      stack: { language: inferLanguage({ node, python, rust, go }) },
      node,
      python,
      rust,
      go,
    };

    if (options.outputJson) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${formatPrettyResults(results)}\n`);
  });

await program.parseAsync(process.argv);

async function assertDirectoryExists(targetPath: string): Promise<void> {
  let stats;
  try {
    stats = await stat(targetPath);
  } catch {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${targetPath}`);
  }
}

function inferLanguage(stacks: {
  node: AnalyzerResult;
  python: AnalyzerResult;
  rust: AnalyzerResult;
  go: AnalyzerResult;
}): string {
  const detected: string[] = [];

  if (stacks.node?.found) {
    detected.push(stacks.node.hasTypeScript ? "typescript/node" : "javascript/node");
  }
  if (stacks.python?.found) detected.push("python");
  if (stacks.rust?.found) detected.push("rust");
  if (stacks.go?.found) detected.push("go");

  if (detected.length === 0) return "unknown";
  if (detected.length === 1) return detected[0];
  return "mixed";
}

function formatPrettyResults(results: ProjectAnalysisResults): string {
  return [
    "Analysis Results",
    `  Language: ${results.stack.language}`,
    `  Node:   ${results.node.found ? "yes" : "no"}`,
    `  Python: ${results.python.found ? "yes" : "no"}`,
    `  Rust:   ${results.rust.found ? "yes" : "no"}`,
    `  Go:     ${results.go.found ? "yes" : "no"}`,
  ].join("\n");
}
