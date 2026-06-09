#!/usr/bin/env node
// Test VibeServe LLM endpoint
async function main() {
  const url = process.env.VIBESERVE_URL || 'http://127.0.0.1:8001';
  const key = process.env.VIBESERVE_API_KEY || '57dd68ceba254524799f52459ce61affcb95b21bd82815cdebc5efa121e39e95';
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-VibeServe-API-Key'] = key;

  // Test health
  const health = await fetch(url + '/v1/llm/health', { signal: AbortSignal.timeout(5000) });
  const h = await health.json();
  console.log('LLM Health:', JSON.stringify(h, null, 2));

  // Test completion
  const body = JSON.stringify({
    prompt: 'Return a JSON object with a "greeting" field set to "hello"',
    response_format: 'json',
    temperature: 0.2,
  });
  console.log('\nSending completion request...');
  const start = Date.now();
  const resp = await fetch(url + '/v1/llm/complete', {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(30000),
  });
  const elapsed = Date.now() - start;
  const data = await resp.json();
  console.log(`Response (${elapsed}ms):`, JSON.stringify(data, null, 2));
}
main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
