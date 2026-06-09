#!/usr/bin/env node
// VibeServe HTTP Bridge Latency Benchmark

const BASE = 'http://127.0.0.1:8000';
const AUTH = { 'X-VibeServe-API-Key': 'benchmark-key-2024', 'Content-Type': 'application/json' };

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return { ok: r.ok, status: r.status, body: await r.json() };
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: AUTH, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { ok: r.ok, status: r.status, body: await r.json() };
}

async function measure(name, fn) {
  const s = performance.now();
  try {
    const r = await fn();
    const ms = (performance.now() - s).toFixed(1);
    console.log(JSON.stringify({ name, ok: r.ok, ms, status: r.status }));
  } catch(e) {
    console.log(JSON.stringify({ name, ok: false, ms: 'FAIL', error: e.message }));
  }
}

(async () => {
  await measure('GET /health', () => get(BASE + '/health'));
  await measure('vs_memory_get', () => post(BASE + '/tools/vs_memory_get', { workspace_id: 'benchmark', limit: 5 }));
  await measure('vs_schema_validate', () => post(BASE + '/tools/vs_schema_validate', { data: JSON.stringify({name:'test',val:42}), schema: JSON.stringify({type:'object',required:['name','val']}) }));
  await measure('vs_plan_review', () => post(BASE + '/tools/vs_plan_review', { plan: JSON.stringify({steps:[{step:'test',risk:'low'}]}) }));
  await measure('vs_generate_artifact', () => post(BASE + '/tools/vs_generate_artifact', {prompt:'Generate a React button component', artifact_type:'code_block'}));
  await measure('vs_validate_artifact', () => post(BASE + '/tools/vs_validate_artifact', {artifact:'function test() { return 42; }', max_chars:500}));
})();
