import chokidar from 'chokidar';
import { resolve } from 'node:path';
import { execa } from 'execa';

let runTimeout: NodeJS.Timeout | null = null;
let currentController: AbortController | null = null;

export async function watchCommand(folder: string) {
  const targetPath = resolve(folder);
  console.log(`Watching for changes in ${targetPath}...`);

  const runPipeline = async () => {
    // Cancel the ongoing process if any
    if (currentController) {
      currentController.abort();
    }
    
    currentController = new AbortController();
    const { signal } = currentController;
    
    console.log(`\n[Watch] Triggering Dagster pipeline...`);
    
    try {
      const dagsterDir = resolve(import.meta.dirname, "../../orchestrator-dag");
      
      const { stdout } = await execa("dagster", [
        "asset", "materialize", "--select", "*", 
        "--config-json", JSON.stringify({
          ops: {
            project_analysis: { config: { target_path: targetPath } },
            static_analysis_results: { config: { target_path: targetPath } },
            tool_adapter_results: { config: { target_path: targetPath } }
          }
        })
      ], {
        cwd: dagsterDir,
        env: { ...process.env, DAGSTER_HOME: dagsterDir },
        signal
      });
      
      console.log(`[Watch] Pipeline completed successfully. Outputting SARIF...`);
      console.log(stdout);
    } catch (err: any) {
      if (err.isCanceled) {
        console.log(`[Watch] Pipeline aborted due to new file changes.`);
      } else {
        console.error(`[Watch] Pipeline failed:`, err.message);
      }
    } finally {
      if (currentController?.signal === signal) {
        currentController = null;
      }
    }
  };

  const scheduleRun = () => {
    if (runTimeout) clearTimeout(runTimeout);
    runTimeout = setTimeout(() => {
      runPipeline();
    }, 300); // 300ms debounce
  };

  chokidar.watch(targetPath, { ignored: /(^|[\/\\])\../, ignoreInitial: true }).on('all', (event, path) => {
    scheduleRun();
  });

  // Initial run
  scheduleRun();
}
