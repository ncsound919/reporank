import { readFileSync } from 'fs';
const dataset = JSON.parse(readFileSync('apps/cli/src/__tests__/fixtures/code-review-dataset.json','utf-8'));

const rules = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML\s*=\s*\{/ },
  { name: 'setInterval in useEffect', pattern: /setInterval\s*\(/ },
  { name: 'async without try/catch', pattern: /async\s+function\s+\w+/ },
  { name: 'async arrow without try/catch', pattern: /export\s+async\s+function/ },
  { name: 'no try/catch in async', pattern: /await\s+/ },
];

for (const task of dataset) {
  console.log('=== ' + task.id + ' ===');
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const m = rule.pattern.exec(task.code);
    console.log('  ' + rule.name + ': ' + (m ? `MATCH at ${m.index}: "${task.code.slice(Math.max(0,m.index-5), m.index+20)}"` : 'no match'));
  }
  // Check for try/catch
  const hasTry = /try\s*\{/.test(task.code);
  const hasAsync = /async\s+(function|\(\s*\))/.test(task.code) || /export\s+async\s+/.test(task.code);
  const hasAwait = /\bawait\b/.test(task.code);
  console.log('  hasAsync=' + hasAsync + ' hasAwait=' + hasAwait + ' hasTry=' + hasTry);
}
