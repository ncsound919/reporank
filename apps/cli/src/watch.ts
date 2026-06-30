import chokidar, { type FSWatcher } from "chokidar";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEBOUNCE_MS = 300;
const DEFAULT_IGNORE = [
  /(^|[\/\\])\../,
  /(^|[\/\\])node_modules([\/\\]|$)/,
  /(^|[\/\\])dist([\/\\]|$)/,
  /(^|[\/\\])build([\/\\]|$)/,
  /(^|[\/\\])coverage([\/\\]|$)/,
  /(^|[\/\\])\.next([\/\\]|$)/,
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dagsterDir = resolve(__dirname, "../../orchestrator-dag");

let runTimeout: NodeJS.Timeout | null = null;
let currentController: AbortController | null = null;
let currentRunId = 0;

function writeInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function buildDagsterConfig(targetPath: string): string {
  return JSON.stringify({
    ops: {
      project_analysis: { config: { target_path: targetPath } },
      static_analysis_results: { config: { target_path: targetPath } },
      tool_adapter_results: { config: { target_path: targetPath } },
    },
  });
}

export async function watchCommand(folder: string): Promise<FSWatcher> {
  const targetPath = resolve(folder);
  writeInfo(`Watching for changes in ${targetPath}...`);

  const runPipeline = async (): Promise<void> => {
    if (currentController) {
      currentController.abort();
    }

    const runId = ++currentRunId;
    const controller = new AbortController();
    currentController = controller;

    writeInfo(`\n[Watch] Triggering Dagster pipeline...`);

    try {
      const { stdout } = await execa(
        "dagster",
        [
          "asset",
          "materialize",
          "--select",
          "*",
          "--config-json",
          buildDagsterConfig(targetPath),
        ],
        {
          cwd: dagsterDir,
          env: {
            ...process.env,
            DAGSTER_HOME: dagsterDir,
          },
          cancelSignal: controller.signal,
        },
      );

      if (currentRunId !== runId) {
        return;
      }

      writeInfo("[Watch] Pipeline completed successfully. Outputting SARIF...");
      if (stdout.trim()) {
        writeInfo(stdout);
      }
    } catch (error: unknown) {
      const err = error as { isCanceled?: boolean; shortMessage?: string; message?: string };

      if (err.isCanceled) {
        writeInfo("[Watch] Pipeline aborted due to new file changes.");
        return;
      }

      writeError(`[Watch] Pipeline failed: ${err.shortMessage || err.message || String(error)}`);
    } finally {
      if (currentController === controller) {
        currentController = null;
      }
    }
  };

  const scheduleRun = (): void => {
    if (runTimeout) {
      clearTimeout(runTimeout);
    }

    runTimeout = setTimeout(() => {
      runTimeout = null;
      void runPipeline();
    }, DEBOUNCE_MS);
  };

  const watcher = chokidar.watch(targetPath, {
    ignored: DEFAULT_IGNORE,
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on("all", () => {
    scheduleRun();
  });

  watcher.on("error", (error) => {
    writeError(`[Watch] File watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  scheduleRun();
  return watcher;
}
