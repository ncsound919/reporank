import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PythonFileMetric {
  file: string;
  functions: number;
  classes: number;
  imports: number;
  loc: number;
  maxComplexity: number;
  avgComplexity: number;
  syntaxError?: boolean;
}

export interface PythonAstReport {
  parsed: boolean;
  language: "python";
  files: number;
  metrics: { complexity: number | null; functions: number; classes: number; files: number };
  perFile: PythonFileMetric[];
  reason?: string;
}

/**
 * Runs inside the target's Python (stdlib `ast` only — no third-party install).
 * Emits one JSON document on stdout.
 */
const PY_AST_SCRIPT = `
import ast, json, os, sys

SKIP = {"node_modules", ".git", "dist", "build", ".venv", "venv", "env",
        "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
        "target", "vendor", ".next", "coverage"}
DECISION = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp)

def complexity(fn):
    c = 1
    for node in ast.walk(fn):
        if isinstance(node, DECISION):
            c += 1
        elif isinstance(node, ast.BoolOp):
            c += len(node.values) - 1
        elif isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            for gen in node.generators:
                c += len(gen.ifs)
    return c

def analyze(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            src = fh.read()
    except OSError:
        return None
    loc = src.count("\\n") + 1
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError:
        return {"file": path, "functions": 0, "classes": 0, "imports": 0,
                "loc": loc, "maxComplexity": 0, "avgComplexity": 0, "syntaxError": True}
    functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
    comps = [complexity(fn) for fn in functions]
    return {
        "file": path,
        "functions": len(functions),
        "classes": len(classes),
        "imports": len(imports),
        "loc": loc,
        "maxComplexity": max(comps) if comps else 0,
        "avgComplexity": round(sum(comps) / len(comps), 2) if comps else 0,
    }

def main():
    root = sys.argv[1]
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith(".")]
        for name in filenames:
            if name.endswith(".py"):
                files.append(os.path.join(dirpath, name))
        if len(files) >= 500:
            break
    per = []
    for p in files[:500]:
        m = analyze(p)
        if m is not None:
            per.append(m)
    total_functions = sum(m["functions"] for m in per)
    total_classes = sum(m["classes"] for m in per)
    avg_max = round(sum(m["maxComplexity"] for m in per) / len(per)) if per else 0
    print(json.dumps({
        "parsed": True,
        "language": "python",
        "files": len(per),
        "metrics": {"complexity": avg_max, "functions": total_functions,
                    "classes": total_classes, "files": len(per)},
        "perFile": per,
    }))

main()
`;

/**
 * Real Python AST metrics via the interpreter's stdlib `ast` module. Replaces
 * the previous stub that returned a hardcoded `complexity: 5`. If Python is not
 * installed the report is honestly `parsed: false`, never a fake number.
 */
export async function parsePythonAst(dir: string): Promise<PythonAstReport> {
  try {
    const { stdout } = await execFileAsync("python", ["-c", PY_AST_SCRIPT, dir], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    return JSON.parse(stdout) as PythonAstReport;
  } catch (err) {
    const e = err as (Error & { code?: string | number }) | null;
    const notFound =
      !!e && (e.code === "ENOENT" || /not recognized|command not found/i.test(e.message ?? ""));
    return {
      parsed: false,
      language: "python",
      files: 0,
      metrics: { complexity: null, functions: 0, classes: 0, files: 0 },
      perFile: [],
      reason: notFound ? "python interpreter not found on PATH" : e?.message ?? "python ast failed",
    };
  }
}
