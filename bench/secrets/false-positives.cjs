#!/usr/bin/env node
'use strict';
/**
 * False-positive check for the secret scanner: scan real code that contains no
 * live credentials and list every hit.
 *
 *   node bench/secrets/false-positives.cjs <dir> [<dir> ...]
 */
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../plugin/lib/secrets.cjs');

let files = 0; let bytes = 0; const hits = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p); continue; }
    if (!/\.(?:c?m?[jt]sx?|json|py|md|ya?ml|toml|sh)$/.test(e.name)) continue;
    if (fs.statSync(p).size > 2e6) continue;
    const t = fs.readFileSync(p, 'utf8'); files++; bytes += t.length;
    for (const f of S.scan(t)) hits.push(`${p}  ${f.rule}  ${f.sample}`);
  }
}
for (const r of process.argv.slice(2)) walk(path.resolve(r));
console.log(`files ${files}, ${(bytes / 1e6).toFixed(1)} MB, hits ${hits.length}`);
for (const h of hits) console.log(h);
