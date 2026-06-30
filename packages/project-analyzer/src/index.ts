#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeNode } from './analyzers/node.js';
import { analyzePython } from './analyzers/python.js';
import { analyzeRust } from './analyzers/rust.js';
import { analyzeGo } from './analyzers/go.js';

const program = new Command();

program
  .name('project-analyzer')
  .description('Analyze a directory to infer the tech stack')
  .argument('<path>', 'Directory path to analyze')
  .option('--output-json', 'Output results as JSON')
  .action(async (targetPath, options) => {
    try {
      const node = await analyzeNode(targetPath);
      const python = await analyzePython(targetPath);
      const rust = await analyzeRust(targetPath);
      const go = await analyzeGo(targetPath);
      
      let language = 'unknown';
      if (node.found && !python.found) language = 'typescript/node';
      else if (python.found && !node.found) language = 'python';
      else if (node.found && python.found) language = 'mixed';

      const results = {
        stack: { language },
        node,
        python,
        rust,
        go
      };

      if (options.outputJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log('Analysis Results:', results);
      }
    } catch (err) {
      if (options.outputJson) {
        console.error(JSON.stringify({ error: String(err) }));
      } else {
        console.error('Error analyzing project:', err);
      }
      process.exit(1);
    }
  });

program.parse();
