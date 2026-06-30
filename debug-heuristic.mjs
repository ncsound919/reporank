import { readFileSync } from 'fs';
import { heuristicScan } from './apps/cli/src/heuristic_scanner.ts';

const dataset = JSON.parse(readFileSync('apps/cli/src/__tests__/fixtures/code-review-dataset.json', 'utf-8'));

for (const task of dataset) {
  const findings = heuristicScan(task.code);
  console.log(task.id + ': ' + findings.length + ' findings');
  for (const f of findings) {
    console.log('  [' + f.type + '] line=' + f.line + ' conf=' + f.confidence + ' ' + f.description.slice(0, 80));
  }
}
