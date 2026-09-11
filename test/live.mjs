/**
 * Live self-test — run this on a machine that has a provider key.
 *
 * It answers the one question the offline suite cannot: does the host actually invoke
 * Tandem's hooks during a real turn, and do the gates behave against a real model?
 *
 *   node test/live.mjs --model <id>
 *
 * Prints a report. Paste the whole thing back.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(String(process.argv[i]).replace(/^--/, ''), process.argv[i + 1]);
const MODEL = args.get('model') || process.env.TANDEM_MODEL || null;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

console.log('TANDEM live self-test\n');
console.log('node   ', process.version);
console.log('platform', process.platform, process.arch);
console.log('model  ', MODEL || '(none given)');
console.log('endpoint', process.env.TANDEM_BASE_URL || '(TANDEM_BASE_URL unset)');
console.log('api key ', process.env.TANDEM_API_KEY ? 'present' : '(TANDEM_API_KEY unset)');
console.log('');

// ── 1. host resolves ──────────────────────────────────────────────
console.log('1. host');
let host = null;
try {
  const s = await import(path.join(ROOT, 'src/adapter/session.mjs'));
  host = await s.loadHost();
  check('host package resolves', host.ok, host.ok ? 'Agent: ' + typeof host.mod.Agent : host.error);
  if (host.ok) {
    check('Agent is a constructor', typeof host.mod.Agent === 'function');
    const names = Object.keys(host.mod);
    check('tool factories present', names.some((n) => /^create\w+Tool$/.test(n)),
      names.filter((n) => /^create\w+Tool$/.test(n)).join(', ') || 'none');
    const streamNames = names.filter((n) => /stream/i.test(n));
    check('a stream function is discoverable', streamNames.length > 0, streamNames.join(', ') || 'NONE — this is the gap');
  }
} catch (e) { check('host import', false, e.message); }

// ── 2. real project, real gates ───────────────────────────────────
console.log('\n2. gates against a real toolchain');
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-live-'));
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({
  name: 'live', private: true, scripts: { test: 'node -e "process.exit(0)"' },
  devDependencies: { typescript: '^5.6.0' },
}, null, 2));
fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { target: 'ES2023', strict: true, noEmit: true, skipLibCheck: true },
  include: ['src/**/*.ts'],
}, null, 2));
fs.writeFileSync(path.join(proj, 'src/util.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
for (const n of ['a', 'b', 'c']) {
  fs.writeFileSync(path.join(proj, `src/${n}.ts`), `import { add } from './util.js';\nexport const ${n} = add(1, 2);\n`);
}

const { execSync } = require('node:child_process');
try { execSync('npm install --no-audit --no-fund --silent', { cwd: proj, stdio: 'ignore' }); }
catch { /* reported below */ }
check('typescript installed in the test project', fs.existsSync(path.join(proj, 'node_modules', 'typescript')));

const { Tandem } = require(path.join(ROOT, 'src/index.cjs'));
const t = new Tandem(proj, MODEL || 'unknown-weak-model');

const pre = t.sessionStart();
check('session preamble produced', pre.length > 200, Buffer.byteLength(pre) + ' bytes');
check('density selected', ['dense', 'sparse'].includes(t.density), t.density);

const blocked = t.beforeTool({ kind: 'write', file: 'notes.txt', content: 'x' });
check('write outside working set is blocked', blocked.block === true);
check('blocked file was never created', !fs.existsSync(path.join(proj, 'notes.txt')));

const dp3 = t.beforeTool({ kind: 'edit', file: 'src/util.ts', content: 'export const add=(a:number,b:number):number=>a+b;' });
check('DP3 fires for a file with 3 importers', dp3.points.includes('DP3_DEPENDENTS'), dp3.points.join(', '));

fs.writeFileSync(path.join(proj, 'src/bad.ts'), 'export const x: number = "boom";\n');
const dp1 = t.afterTool({ kind: 'write', file: 'src/bad.ts', content: 'export const x: number = "boom";' });
check('DP1 returns a real compiler error', dp1.ok === false && /TS\d+/.test(dp1.message || ''),
  (dp1.message || '').split('\n')[1] || 'no message');

const f1 = t.finish(); const f2 = t.finish(); const f3 = t.finish();
check('repair bound: attempt 1 continues', f1.stopped === false);
check('repair bound: attempt 2 continues', f2.stopped === false);
check('repair bound: third attempt stops', f3.stopped === true,
  (f3.message || '').split('\n')[0]);

fs.writeFileSync(path.join(proj, 'src/bad.ts'), 'export const x: number = 1;\n');
const t2 = new Tandem(proj, MODEL || 'unknown-weak-model'); t2.sessionStart();
const clean = t2.finish();
check('a healthy project finishes clean', clean.message === null);

// ── 3. live model call ────────────────────────────────────────────
console.log('\n3. live model');
if (!MODEL) {
  check('live turn', false, 'no --model given; skipped');
} else if (!host || !host.ok) {
  check('live turn', false, 'host unavailable; skipped');
} else {
  try {
    const { run } = await import(path.join(ROOT, 'src/adapter/run.mjs'));
    const errs = [];
    process.env.TANDEM_VERBOSE = '1';
    const code = await run(['--model', MODEL, 'create src/live.ts exporting double(n: number): number'], {
      cwd: proj, stderr: (s) => errs.push(s), stdout: (s) => errs.push(s),
    });
    const created = fs.existsSync(path.join(proj, 'src/live.ts'));
    check('tandem run completed', code === 0, 'exit ' + code);
    check('the model created the file', created);
    check('the verification banner printed', errs.join('').includes('verification active'));
    console.log('\n  --- session diagnostics ---');
    console.log(errs.join('').split('\n').filter(Boolean).map((l) => '    ' + l).join('\n'));
    const left = fs.readdirSync(path.join(proj, 'src'));
    console.log('    files in src/: ' + left.join(', '));
  } catch (e) { check('live turn', false, e.message); }
}

// ── report ────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
console.log('\n────────────────────────────────');
console.log(`${passed}/${results.length} checks passed`);
const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log('  - ' + f.name + (f.detail ? ': ' + f.detail : ''));
}
console.log('\nproject kept at: ' + proj);
console.log('────────────────────────────────');
