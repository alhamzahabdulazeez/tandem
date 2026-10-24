#!/usr/bin/env node
'use strict';
/**
 * Measures the output compactor on real command output.
 *
 *   node bench/compact/measure.cjs --fixture <dir> [--out results.json]
 *
 * <dir> is a copy of bench/fixture with `npm install` done (vitest, typescript)
 * and the bench task specs t07..t10 copied in as *.test.ts. Every scenario runs
 * a real command, captures the raw output, compacts it, and records:
 *   - size before / after (chars, and tokens estimated as chars / 4)
 *   - fidelity: of the raw lines that identify a failure (a failing test, an
 *     assertion message, a compiler error), the share still present verbatim
 *     in the compacted text. A compactor that hides the failure is worse than none.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compact } = require('../../plugin/lib/compact.cjs');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const FX = opt('--fixture') && path.resolve(opt('--fixture'));
const OUT = opt('--out');
const REPO = path.resolve(__dirname, '..', '..');

const IDENTITY = /^\s*(?:FAIL\b|×|✗|✕|not ok\b|→ )|AssertionError|\berror TS\d+|^\s*Error:|expected .+ to |^\s*[-+] (?:Expected|Received)/;

function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' }) });
  return { output: `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`, code: r.status };
}

function patch(file, find, repl) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(find)) throw new Error(`patch target not found in ${file}`);
  fs.writeFileSync(file, s.replace(find, repl));
  return () => fs.writeFileSync(file, s);
}

const scenarios = [
  { name: 'tandem: npm test (pass)', cwd: REPO, cmd: 'node test/run.cjs' },
  { name: 'tandem: plugin suite (pass)', cwd: REPO, cmd: 'node plugin/test/run.cjs' },
  { name: 'tandem: contracts suite (pre-existing failure)', cwd: REPO, cmd: 'node test/contracts/run.cjs' },
  {
    name: 'tandem: plugin suite, bug planted in policy',
    cwd: REPO, cmd: 'node plugin/test/run.cjs',
    setup: () => patch(path.join(REPO, 'plugin/lib/policy.cjs'), "if (a1 < a0) out.push", 'if (false) out.push'),
  },
];
if (FX) {
  scenarios.push(
    { name: 'vitest: features missing (mid-task)', cwd: FX, cmd: 'npx vitest run' },
    { name: 'vitest json reporter (npm test)', cwd: FX, cmd: 'npm test' },
    {
      name: 'vitest: wrong implementation (assertion diffs)', cwd: FX, cmd: 'npx vitest run',
      setup: () => patch(path.join(FX, 'src/api/report.ts'), 'export function summarise',
        'export function topN(store: Store, n: number) { return store.all().sort((a, b) => a.value - b.value).slice(0, n); }\nexport function summarise'),
    },
    { name: 'tsc: type errors (mid-task)', cwd: FX, cmd: 'npx tsc --noEmit --pretty false' },
    {
      name: 'vitest: only spec t08 failing, others pass', cwd: FX, cmd: 'npx vitest run t07 t09 t10',
      setup: () => {
        const undo = [];
        undo.push(patch(path.join(FX, 'src/core/store.ts'), '  size(): number',
          '  expire(maxAge: number, now: number): number { let n = 0; for (const [k, r] of this.items) if (now - r.updatedAt > maxAge) { this.items.delete(k); n++; } return n; }\n  size(): number'));
        undo.push(patch(path.join(FX, 'src/api/report.ts'), 'export function summarise',
          'export function topN(store: Store, n: number) { if (n <= 0) return []; return store.all().sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, n); }\nexport function summarise'));
        return () => undo.reverse().forEach((u) => u());
      },
    },
  );
}

const rows = [];
for (const s of scenarios) {
  const undo = s.setup ? s.setup() : null;
  let r;
  try { r = run(s.cmd, s.cwd); } finally { if (undo) undo(); }
  const c = compact(r.output, r.code);
  const ids = Array.from(new Set(r.output.replace(/\r/g, '').split('\n').filter((l) => IDENTITY.test(l)).map((l) => l.trim())));
  const kept = ids.filter((l) => c.text.includes(l)).length;
  rows.push({
    scenario: s.name, command: s.cmd, exit: r.code,
    rawLines: r.output.split('\n').length, rawChars: c.before,
    outChars: c.after, compacted: c.compacted,
    estTokensBefore: Math.round(c.before / 4), estTokensAfter: Math.round(c.after / 4),
    saved: c.before ? +(1 - c.after / c.before).toFixed(3) : 0,
    failureLines: ids.length, failureLinesKept: kept,
  });
}

const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log('| Scenario | Exit | Raw lines | Tokens before → after (est.) | Saved | Failure lines kept |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.scenario} | ${r.exit} | ${r.rawLines} | ${r.estTokensBefore} → ${r.estTokensAfter} | ${Math.round(r.saved * 100)}% | ${r.failureLines ? `${r.failureLinesKept}/${r.failureLines}` : 'n/a'} |`);
}
console.log(`| **Total** | | ${sum('rawLines')} | ${sum('estTokensBefore')} → ${sum('estTokensAfter')} | ${Math.round((1 - sum('outChars') / sum('rawChars')) * 100)}% | ${sum('failureLinesKept')}/${sum('failureLines')} |`);
if (OUT) fs.writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), node: process.version, rows }, null, 2)}\n`);
