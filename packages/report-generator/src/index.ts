#!/usr/bin/env node
import { Command } from 'commander';
import { formatToSarif } from './formatters/sarif.js';

const program = new Command();

program
  .name('report-generator')
  .description('Generate final report from all previous steps')
  .option('--project-analysis <json>')
  .option('--static-analysis <json>')
  .option('--tool-results <json>')
  .option('--output-json', 'Output report as JSON')
  .option('--sarif', 'Output report in SARIF format')
  .action(async (options) => {
    try {
      const projectAnalysis = options.projectAnalysis ? JSON.parse(options.projectAnalysis) : {};
      const staticAnalysis = options.staticAnalysis ? JSON.parse(options.staticAnalysis) : {};
      const toolResults = options.toolResults ? JSON.parse(options.toolResults) : {};

      const report = {
        summary: 'Pipeline completed successfully',
        projectAnalysis,
        staticAnalysis,
        toolResults
      };

      if (options.sarif) {
        console.log(JSON.stringify(formatToSarif(report), null, 2));
      } else if (options.outputJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('Final Report:', report);
      }
    } catch (err) {
      if (options.outputJson || options.sarif) {
        console.error(JSON.stringify({ error: String(err) }));
      } else {
        console.error('Error generating report:', err);
      }
      process.exit(1);
    }
  });

program.parse();
