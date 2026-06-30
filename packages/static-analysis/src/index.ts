#!/usr/bin/env node
import { Command } from 'commander';
import { parseNodeAst } from './ast/node-parser.js';
import { parsePythonAst } from './ast/python-parser.js';

const program = new Command();

program
  .name('static-analysis')
  .description('Run static analysis on a project')
  .argument('<path>', 'Directory path to analyze')
  .option('--manifest <json>', 'Project analyzer manifest JSON string')
  .option('--output-json', 'Output results as JSON')
  .action(async (targetPath, options) => {
    try {
      const manifest = options.manifest ? JSON.parse(options.manifest) : null;
      let results: any = { checks: [] };

      if (!manifest || manifest.stack?.language === 'typescript/node' || manifest.stack?.language === 'mixed') {
        results.node = await parseNodeAst(targetPath);
      }
      
      if (!manifest || manifest.stack?.language === 'python' || manifest.stack?.language === 'mixed') {
        results.python = await parsePythonAst(targetPath);
      }

      if (options.outputJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log('Static Analysis Results:', results);
      }
    } catch (err) {
      if (options.outputJson) {
        console.error(JSON.stringify({ error: String(err) }));
      } else {
        console.error('Error during static analysis:', err);
      }
      process.exit(1);
    }
  });

program.parse();
