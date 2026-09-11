#!/usr/bin/env node
'use strict';
/**
 * Pre-flight — answer "is the provider actually serving me right now?" before
 * committing hours to a benchmark run.
 *
 * A quota wall and a weak model produce the same FAIL rows. This tells them apart in
 * seconds, so a corrupted run is never mistaken for a result.
 */
const { parseApiKeys } = require('./run.cjs');

function fail(msg) { console.error('PREFLIGHT FAIL: ' + msg); process.exit(1); }

// Guarded so `require('./preflight.cjs')` — used by tests to reach parseApiKeys reuse —
// never fires a network request or calls process.exit() as a side effect of being loaded.
if (require.main === module) {
  // bench/run.cjs accepts TANDEM_API_KEYS (comma-separated, for rotation) with
  // TANDEM_API_KEY as the single-key fallback. Preflight checked only the single-key
  // variable, so a run.cjs-ready setup (TANDEM_API_KEYS alone) failed preflight with
  // "TANDEM_API_KEY is not set" even though the benchmark itself would have started fine.
  const keys = parseApiKeys(process.env.TANDEM_API_KEYS, process.env.TANDEM_API_KEY);
  const key = keys[0];
  const base = process.env.TANDEM_BASE_URL;
  const model = process.argv[2] || process.env.TANDEM_BENCH_MODEL || process.env.TANDEM_MODEL;

  if (!key) fail('neither TANDEM_API_KEYS nor TANDEM_API_KEY is set');
  if (!base) fail('TANDEM_BASE_URL is not set');
  if (!model) fail('no model given — pass one as the first argument');

  console.log('endpoint  ' + base);
  console.log('model     ' + model);
  console.log('key       present (' + key.slice(0, 6) + '…)' + (keys.length > 1 ? ' — ' + keys.length + ' keys configured' : '') + '\n');

  run(key, base, model);
}

async function run(key, base, model) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, max_tokens: 256, messages: [{ role: 'user', content: 'reply with the single word: ready' }] }),
    });
  } catch (e) { fail('network error — ' + e.message); }

  const ms = Date.now() - started;
  const text = await res.text();

  if (!res.ok) {
    console.error('HTTP ' + res.status + '  (' + ms + 'ms)');
    console.error(text.slice(0, 600));
    if (res.status === 429) fail('rate limited or out of quota — wait, or use another key');
    if (res.status === 401 || res.status === 403) fail('key rejected');
    if (res.status === 402) fail('payment or credit required');
    fail('provider returned ' + res.status);
  }

  let body;
  try { body = JSON.parse(text); } catch { fail('response was not JSON: ' + text.slice(0, 300)); }

  const reply = body && body.choices && body.choices[0] && body.choices[0].message
    && body.choices[0].message.content;
  if (!reply) { console.error(text.slice(0, 600)); fail('no content in the response'); }

  console.log('reply     ' + String(reply).trim().slice(0, 60));
  console.log('latency   ' + ms + 'ms');
  console.log('\nPREFLIGHT OK — the provider is serving. Safe to run the benchmark.');
}
