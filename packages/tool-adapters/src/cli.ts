#!/usr/bin/env node
import { Command } from 'commander';
import { eslintAdapter, vitestAdapter, pytestAdapter } from './index.js';

const program = new Command();

program
  .name('tool-adapter-runner')
  .argument('<tool>', 'Tool to run (eslint, vitest, pytest)')
  .argument('<path>', 'Directory path to run in')
  .action(async (tool, targetPath) => {
    let adapter;
    if (tool === 'eslint') adapter = eslintAdapter;
    else if (tool === 'vitest') adapter = vitestAdapter;
    else if (tool === 'pytest') adapter = pytestAdapter;
    else {
      console.error(JSON.stringify({ error: `Unknown tool: ${tool}` }));
      process.exit(1);
    }
    
    const result = await adapter.run(targetPath);
    console.log(JSON.stringify(result));
  });

program.parse();
