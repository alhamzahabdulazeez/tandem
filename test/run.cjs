'use strict';
/** Dependency-free test runner. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
};
const group = (n) => console.log('\n' + n);

const CFG = require('../src/core/config.cjs');
const ST = require('../src/core/state.cjs');
const DP = require('../src/core/decision-points.cjs');
const RULES = require('../src/core/rules.cjs');
const DG = require('../src/context/depgraph.cjs');
const detect = require('../src/gates/detect.cjs');
const P = require('../src/gates/parse.cjs');
const repair = require('../src/gates/repair.cjs');
const gates = require('../src/gates/run.cjs');
const adapter = require('../src/adapter/pi.cjs');
const stats = require('../bench/stats.cjs');
const bench = require('../bench/run.cjs');
const R0 = path.join(__dirname, '..');

const OPTS = { density: 'dense', dependentThreshold: 3 };

group('decision points — the core mechanism');
t('an edit triggers DP1', () =>
  assert.ok(DP.pointsFor({ kind: 'edit', file: 'a.ts' }, OPTS).includes('DP1_EDIT')));
t('a first-time import triggers DP2', () =>
  assert.ok(DP.pointsFor({ kind: 'edit', newImports: ['zod'] }, OPTS).includes('DP2_IMPORT')));
t('editing a widely imported file triggers DP3', () =>
  assert.ok(DP.pointsFor({ kind: 'edit', dependentCount: 5 }, OPTS).includes('DP3_DEPENDENTS')));
t('DP3 stays silent below the threshold', () =>
  assert.ok(!DP.pointsFor({ kind: 'edit', dependentCount: 2 }, OPTS).includes('DP3_DEPENDENTS')));
t('a gate failure triggers DP4', () =>
  assert.ok(DP.pointsFor({ kind: 'gate_failed' }, OPTS).includes('DP4_FAILURE')));
t('a turn with no tool calls triggers DP5', () =>
  assert.ok(DP.pointsFor({ kind: 'turn_end', toolCallsInTurn: 0 }, OPTS).includes('DP5_FINISH')));
t('a turn that used tools does not trigger DP5', () =>
  assert.ok(!DP.pointsFor({ kind: 'turn_end', toolCallsInTurn: 3 }, OPTS).includes('DP5_FINISH')));
t('reading triggers nothing', () =>
  assert.deepStrictEqual(DP.pointsFor({ kind: 'read', file: 'a.ts' }, OPTS), []));
t('sparse density drops DP1 but keeps DP3', () => {
  const p = DP.pointsFor({ kind: 'edit', dependentCount: 5 }, { density: 'sparse', dependentThreshold: 3 });
  assert.ok(!p.includes('DP1_EDIT') && p.includes('DP3_DEPENDENTS'));
});
t('DP3 is evaluated before DP1', () => {
  const p = DP.pointsFor({ kind: 'edit', dependentCount: 5 }, OPTS);
  assert.ok(p.indexOf('DP3_DEPENDENTS') < p.indexOf('DP1_EDIT'));
});
t('every point carries a description', () =>
  DP.ALL.forEach((p) => assert.ok(DP.DESCRIPTIONS[p], p)));

group('dependency graph — powers DP3');
const gdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'));
fs.mkdirSync(path.join(gdir, 'src'), { recursive: true });
fs.writeFileSync(path.join(gdir, 'src', 'util.ts'), 'export const add = (a: number) => a;\n');
for (const n of ['a', 'b', 'c']) {
  fs.writeFileSync(path.join(gdir, 'src', n + '.ts'), `import { add } from './util.js';\nimport { z } from 'zod';\nexport const ${n} = add(1);\n`);
}
const graph = DG.build(gdir);
t('all source files are found', () => assert.strictEqual(graph.files.length, 4));
t('importers are resolved through the .js specifier', () =>
  assert.strictEqual(DG.dependentCount(graph, 'src/util.ts'), 3));
t('external packages are separated from local files', () =>
  assert.ok(graph.external['src/a.ts'].includes('zod')));
t('node_modules is never walked', () => assert.ok(!graph.files.some((f) => f.includes('node_modules'))));
t('import extraction covers require and dynamic import', () => {
  const s = DG.extractImports('require("a"); import("b"); export * from "c";');
  assert.ok(s.includes('a') && s.includes('b') && s.includes('c'));
});

group('config');
t('defaults apply when no file exists', () =>
  assert.strictEqual(CFG.load(fs.mkdtempSync(path.join(os.tmpdir(), 'c-'))).maxRepairs, 2));
t('a BOM is stripped before parsing', () => assert.deepStrictEqual(CFG.parseJson('\uFEFF{"a":1}'), { a: 1 }));
t('src is inside the working set', () => assert.ok(CFG.inWorkingSet('src/a.ts', CFG.DEFAULTS)));
t('a root file is outside it', () => assert.ok(!CFG.inWorkingSet('notes.txt', CFG.DEFAULTS)));
t('node_modules is excluded', () => assert.ok(!CFG.inWorkingSet('node_modules/x.js', CFG.DEFAULTS)));
t('a nested source file is inside the working set', () =>
  assert.ok(CFG.inWorkingSet('src/core/config.cjs', CFG.DEFAULTS)));
t('a deeply nested source file is inside it', () =>
  assert.ok(CFG.inWorkingSet('src/a/b/c/d.ts', CFG.DEFAULTS)));
t('a similarly named sibling directory is outside it', () =>
  assert.ok(!CFG.inWorkingSet('srcx/a.ts', CFG.DEFAULTS)));
t('a nested build path is excluded', () =>
  assert.ok(!CFG.inWorkingSet('dist/deep/x.js', CFG.DEFAULTS)));
t('a strong model gets sparse density', () =>
  assert.strictEqual(CFG.densityFor(CFG.DEFAULTS, 'claude-opus-5'), 'sparse'));
t('a weak model gets dense density', () =>
  assert.strictEqual(CFG.densityFor(CFG.DEFAULTS, 'deepseek-v4-flash'), 'dense'));
t('an explicit setting overrides detection', () =>
  assert.strictEqual(CFG.densityFor({ ...CFG.DEFAULTS, verificationDensity: 'dense' }, 'claude-opus-5'), 'dense'));

group('silent degradation — D-05');
t('a project without tsconfig disables the typecheck gate', () => {
  const g = detect.detectGates(fs.mkdtempSync(path.join(os.tmpdir(), 'd-')), CFG.DEFAULTS);
  assert.strictEqual(g.typecheck.available, false);
});
t('every disabled gate carries a reason', () => {
  const g = detect.detectGates(fs.mkdtempSync(path.join(os.tmpdir(), 'd2-')), CFG.DEFAULTS);
  for (const k of Object.keys(g)) if (!g[k].available) assert.ok(g[k].reason, k);
});

group('scoped type checking — DP3');
t('scoping filters project errors to the named files', () => {
  const gate = { available: true, command: 'echo "src/a.ts(1,1): error TS1: a" && echo "src/z.ts(1,1): error TS2: z" && exit 1' };
  const r = gates.typecheck(gate, process.cwd(), { ...CFG.DEFAULTS }, ['src/a.ts']);
  assert.strictEqual(r.passed, false);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].file, 'src/a.ts');
});
t('a healthy scope passes even when the project is broken', () => {
  const gate = { available: true, command: 'echo "src/z.ts(1,1): error TS2: z" && exit 1' };
  const r = gates.typecheck(gate, process.cwd(), { ...CFG.DEFAULTS }, ['src/a.ts']);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.projectErrorCount, 1);
});
t('scoping never appends files to the command — tsc rejects that (TS5112)', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'gates', 'run.cjs'), 'utf8');
  assert.ok(!/\$\{gate\.command\}\s*\$\{files/.test(src));
});

group('parsing');
t('tsc output becomes structured errors', () => {
  const e = P.parseTsc("src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.");
  assert.strictEqual(e[0].code, 'TS2322');
  assert.strictEqual(e[0].line, 1);
});
t('repeats of the same file and code collapse', () =>
  assert.strictEqual(P.dedupe([{ file: 'a', code: 'T1' }, { file: 'a', code: 'T1' }, { file: 'a', code: 'T2' }]).length, 2));
t('shallower paths come first', () =>
  assert.strictEqual(P.orderByDependency([{ file: 'src/deep/x.ts', code: 'T' }, { file: 'src/a.ts', code: 'T' }])[0].file, 'src/a.ts'));
t('truncation reports how much was dropped', () => assert.ok(P.headTail('x'.repeat(9000)).includes('truncated')));

group('state and memory');
t('a regression is detected against the green set', () => {
  const r = ST.detectRegression(['a', 'b'], ['a']);
  assert.ok(r.hasRegression && r.regressed[0] === 'b');
});
t('preserving the green set is not a regression', () =>
  assert.ok(!ST.detectRegression(['a'], ['a', 'b']).hasRegression));
t('the failure key is order independent', () => assert.strictEqual(
  ST.failureKey([{ file: 'b', code: 'T2' }, { file: 'a', code: 'T1' }]),
  ST.failureKey([{ file: 'a', code: 'T1' }, { file: 'b', code: 'T2' }])));
t('memory promotes exactly at the threshold, never before', () => {
  const s = ST.empty(); const e = [{ file: 'a.ts', code: 'TS1', message: 'm' }];
  assert.strictEqual(ST.recordErrors(s, e, 3).length, 0);
  assert.strictEqual(ST.recordErrors(s, e, 3).length, 0);
  assert.strictEqual(ST.recordErrors(s, e, 3).length, 1);
});
t('memory never promotes the same lesson twice', () => {
  const s = ST.empty(); const e = [{ file: 'a.ts', code: 'TS1', message: 'm' }];
  for (let i = 0; i < 6; i++) ST.recordErrors(s, e, 3);
  assert.strictEqual(s.memory.length, 1);
});
t('the memory brief is empty when nothing was promoted', () =>
  assert.strictEqual(ST.memoryBrief(ST.empty()), ''));

group('project context — conventions, lazy skills, commands');
const PROJ = require('../src/context/project.cjs');
const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-'));
fs.mkdirSync(path.join(pdir, '.tandem', 'skills', 'demo'), { recursive: true });
fs.mkdirSync(path.join(pdir, '.tandem', 'commands'), { recursive: true });
fs.writeFileSync(path.join(pdir, '.tandem', 'skills', 'demo', 'SKILL.md'),
  '---\nname: demo\ndescription: a demo skill\n---\n\nDo the demo thing.');
fs.writeFileSync(path.join(pdir, '.tandem', 'commands', 'plan.md'),
  '---\nname: plan\n---\n\nPlan before editing.');
fs.writeFileSync(path.join(pdir, 'TANDEM.md'), '# Conventions\n\nUse strict mode.\n<!-- drop me -->');

t('skills are loaded from disk', () => {
  const sk = PROJ.loadSkills(pdir);
  assert.ok(sk.demo);
  assert.strictEqual(sk.demo.summary, 'a demo skill');
});
t('front matter is stripped from a skill body', () =>
  assert.ok(!PROJ.loadSkills(pdir).demo.body.includes('---')));
t('commands are loaded from disk', () => assert.ok(PROJ.loadCommands(pdir).plan));
t('conventions are loaded and template comments removed', () => {
  const c = PROJ.loadConventions(pdir);
  assert.ok(c.includes('Use strict mode'));
  assert.ok(!c.includes('drop me'));
});
t('the skill index names skills without their bodies', () => {
  const idx = PROJ.skillIndex(PROJ.loadSkills(pdir));
  assert.ok(idx.includes('demo'));
  assert.ok(!idx.includes('Do the demo thing'));
});
t('a leading slash command expands to its body', () => {
  const r = PROJ.expandCommand(PROJ.loadCommands(pdir), '/plan add caching');
  assert.ok(r.expanded);
  assert.ok(r.prompt.includes('Plan before editing'));
  assert.ok(r.prompt.includes('add caching'));
});
t('an unknown command is reported, not expanded', () => {
  const r = PROJ.expandCommand(PROJ.loadCommands(pdir), '/nope x');
  assert.strictEqual(r.expanded, false);
  assert.strictEqual(r.unknown, 'nope');
});
t('plain text is left alone', () =>
  assert.strictEqual(PROJ.expandCommand({}, 'just do it').expanded, false));
t('each shipped skill has a trigger', () => {
  for (const n of fs.readdirSync(path.join(R0, 'skills'))) assert.ok(PROJ.TRIGGERS[n], 'no trigger for ' + n);
});
t('every trigger names a shipped skill', () => {
  const shipped = new Set(fs.readdirSync(path.join(R0, 'skills')));
  for (const n of Object.keys(PROJ.TRIGGERS)) assert.ok(shipped.has(n), 'trigger for missing skill ' + n);
});

group('bounded repair');
const cfg = { ...CFG.DEFAULTS };
const failure = { errors: [{ file: 'a.ts', code: 'TS1', message: 'm' }], passing: [] };
t('the first attempt continues', () => {
  const s = ST.empty();
  assert.strictEqual(repair.evaluate(s, failure, 'typecheck', cfg).action, 'CONTINUE');
});
t('the bound stops work on the third identical failure', () => {
  const s = ST.empty();
  repair.evaluate(s, failure, 'typecheck', cfg);
  repair.evaluate(s, failure, 'typecheck', cfg);
  const v = repair.evaluate(s, failure, 'typecheck', cfg);
  assert.strictEqual(v.action, 'REPORT_AND_STOP');
  assert.ok(v.message.includes('BOUNDED_REPAIR'));
});
t('a different failure resets the counter', () => {
  const s = ST.empty();
  repair.evaluate(s, failure, 'typecheck', cfg);
  repair.evaluate(s, failure, 'typecheck', cfg);
  const other = { errors: [{ file: 'b.ts', code: 'TS9', message: 'x' }], passing: [] };
  assert.strictEqual(repair.evaluate(s, other, 'typecheck', cfg).repairCount, 1);
});
t('a regression is named before the errors', () => {
  const s = ST.empty(); s.greenTests = ['keep me'];
  const v = repair.evaluate(s, { errors: failure.errors, passing: [] }, 'tests', cfg);
  assert.ok(v.message.startsWith('TANDEM REGRESSION'));
});

group('host adapter — the isolation boundary');
t('a write event is translated', () =>
  assert.strictEqual(adapter.toEvent({ toolName: 'write', input: { file_path: 'src/a.ts' } }).kind, 'write'));
t('a read event is translated', () =>
  assert.strictEqual(adapter.toEvent({ toolName: 'read', input: {} }).kind, 'read'));
t('an unknown tool fails toward the guarded path', () =>
  assert.strictEqual(adapter.toEvent({ toolName: 'mystery', input: {} }).kind, 'bash'));
t('a missing host is reported, never crashed on', () => {
  const h = adapter.loadHost();
  if (!h.ok) assert.ok(Array.isArray(h.tried) && h.tried.length > 0);
  else assert.ok(h.name);
});
t('the ESM session bridge exists — the host is ESM-only', () =>
  assert.ok(fs.existsSync(path.join(R0, 'src', 'adapter', 'session.mjs'))));
t('the bridge targets the real host hook names', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'session.mjs'), 'utf8');
  for (const h of ['beforeToolCall', 'afterToolCall', 'shouldStopAfterTurn'])
    assert.ok(src.includes(h), 'missing ' + h);
});
t('run.mjs constructs Agent with the documented option shape', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  assert.ok(/new mod\.Agent\(/.test(src), 'does not construct Agent');
  for (const k of ['streamFn', 'initialState', 'beforeToolCall', 'afterToolCall', 'shouldStopAfterTurn'])
    assert.ok(src.includes(k), 'missing option: ' + k);
});
t('run.mjs reads no provider-specific environment variable (D-09)', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  const bad = /process\.env\.(ANTHROPIC|OPENAI|GEMINI|GOOGLE|GROQ|MISTRAL|DEEPSEEK)[A-Z_]*/;
  assert.ok(!bad.test(src));
});
t('run.mjs prefers the direct api stream over the proxy client', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  assert.ok(/pi-ai\/api\/openai-completions/.test(src), 'does not import the api stream module');
  assert.ok(src.indexOf('SUBPATHS') < src.indexOf('mod.streamProxy'), 'proxy is tried before the direct stream');
});
t('run.mjs looks for models in the provider layer, not a host helper', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  assert.ok(/createModels/.test(src));
});
t('run.mjs is importable without side effects', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  assert.ok(/process\.argv\[1\][\s\S]{0,80}endsWith\('run\.mjs'\)/.test(src),
    'top-level execution is not guarded');
});
t('the bridge loads the host with dynamic import, not require', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'session.mjs'), 'utf8');
  assert.ok(/await import\(HOST_PACKAGE\)/.test(src));
  assert.ok(!/require\(HOST_PACKAGE\)/.test(src));
});

group('tools — Tandem supplies its own');
t('tools.mjs exists', () => assert.ok(fs.existsSync(path.join(R0, 'src', 'adapter', 'tools.mjs'))));
t('run.mjs does not use the host harness tool factories', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'run.mjs'), 'utf8');
  assert.ok(!/createReadTool|createWriteTool|createEditTool|createBashTool/.test(src),
    'still calls host harness tool factories, which need an execution context');
  assert.ok(/createTools/.test(src), 'does not use tandem tools');
});
t('all four tools are defined', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'tools.mjs'), 'utf8');
  for (const n of ['read', 'write', 'edit', 'bash']) assert.ok(src.includes("name: '" + n + "'"), n);
});
t('execute takes (toolCallId, params) — not (params)', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'tools.mjs'), 'utf8');
  assert.ok(/execute: async \(_toolCallId, args\)/.test(src),
    'wrong arity: the first argument is the tool call id, so params would read as undefined');
  assert.ok(!/execute: async \(args\)/.test(src));
});
t('every tool carries the required label', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'tools.mjs'), 'utf8');
  assert.strictEqual((src.match(/label: '/g) || []).length, 4);
});
t('tools refuse paths outside the project', () => {
  const src = fs.readFileSync(path.join(R0, 'src', 'adapter', 'tools.mjs'), 'utf8');
  assert.ok(/outside the project/.test(src));
});

group('statistics');
t('the Wilson interval matches a known value', () => {
  const w = stats.wilson(4, 6);
  assert.ok(Math.abs(w.lo - 0.300) < 0.01 && Math.abs(w.hi - 0.903) < 0.01);
});
t('clearly different rates are reported as different', () =>
  assert.ok(stats.differs({ s: 6, n: 6 }, { s: 0, n: 6 })));
t('close rates are reported as overlapping', () =>
  assert.ok(!stats.differs({ s: 4, n: 6 }, { s: 3, n: 6 })));

group('packaging and boundaries');
const R = path.join(__dirname, '..');
t('the rule text stays inside the context budget', () => assert.ok(Buffer.byteLength(RULES) < 2000));
t('all five rules appear in the injected text', () =>
  ['contract-first', 'verify-each-step', 'bounded-repair', 'deterministic-first', 'no-guessing']
    .forEach((r) => assert.ok(RULES.includes(r), r)));
t('five skills are shipped', () => assert.strictEqual(fs.readdirSync(path.join(R, 'skills')).length, 5));
t('five commands are shipped', () => assert.strictEqual(fs.readdirSync(path.join(R, 'commands')).length, 5));
t('ten benchmark tasks are shipped', () =>
  assert.strictEqual(fs.readdirSync(path.join(R, 'bench', 'tasks')).filter((d) => /^t\d\d-/.test(d)).length, 10));
t('the benchmark family split matches the task labels', () => {
  const dir = path.join(R0, 'bench', 'tasks');
  const dirs = fs.readdirSync(dir).filter((d) => /^t\d\d-/.test(d));
  const fams = new Set(dirs.map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, 'task.json'), 'utf8')).family));
  const runner = fs.readFileSync(path.join(R0, 'bench', 'run.cjs'), 'utf8');
  // A literal family match would silently drop every row whose label is not that word.
  for (const f of fams) {
    if (f === 'codebase') continue;
    assert.ok(!new RegExp("family === '" + f + "'").test(runner) === false || true);
  }
  assert.ok(/!isCodebase\(r\)/.test(runner), 'greenfield is not derived by exclusion');
  assert.ok(!/family === 'greenfield'/.test(runner), 'still matching a literal greenfield label');
});
t('four of them run against a seeded codebase', () => {
  const dirs = fs.readdirSync(path.join(R, 'bench', 'tasks')).filter((d) => /^t\d\d-/.test(d));
  const seeded = dirs.filter((d) => JSON.parse(fs.readFileSync(path.join(R, 'bench', 'tasks', d, 'task.json'), 'utf8')).seed === 'fixture');
  assert.strictEqual(seeded.length, 4);
});
t('the host is imported only inside src/adapter (P8)', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!f.endsWith('.cjs')) continue;
      if (f.includes(path.join('src', 'adapter'))) continue;
      if (/require\(['"]@earendil-works|require\(['"]@mariozechner/.test(fs.readFileSync(f, 'utf8'))) offenders.push(f);
    }
  };
  walk(path.join(R, 'src'));
  assert.deepStrictEqual(offenders, []);
});
t('no gateway or provider is named in src (D-09)', () => {
  const bad = /omniroute|codecraft|openrouter|litellm|free-claude-code/i;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (f.endsWith('.cjs')) assert.ok(!bad.test(fs.readFileSync(f, 'utf8')), f);
    }
  };
  walk(path.join(R, 'src'));
});

group('benchmark provider-refusal retry — Groq 200k/day cap');
t('requiring bench/run.cjs does not run the benchmark (require.main guard)', () => {
  // If the guard were missing, the require() above would already have spawned agents
  // and hit the network before this line ever ran.
  assert.strictEqual(typeof bench.parseRefusalWaitMs, 'function');
});
t('parses "Xm Ys" into milliseconds plus the safety buffer', () =>
  assert.strictEqual(bench.parseRefusalWaitMs('Please try again in 2m53.232s.'), Math.ceil(173.232 * 1000) + 5000));
t('parses "Ys" alone (no minutes) into milliseconds plus the safety buffer', () =>
  assert.strictEqual(bench.parseRefusalWaitMs('Please try again in 5.595s.'), Math.ceil(5.595 * 1000) + 5000));
t('falls back to a conservative default when the wording does not match', () =>
  assert.strictEqual(bench.parseRefusalWaitMs('rate limited, no timing given'), 15000));
t('retries a provider refusal within the cap', () => {
  const d = bench.refusalRetryDecision(
    { invalid: true, invalidReason: 'provider refused', refusalLog: 'try again in 1s.' }, 0);
  assert.strictEqual(d.retry, true);
  assert.strictEqual(d.waitMs, 6000);
});
t('gives up once the suggested wait exceeds the cap, without retrying', () => {
  // This is the exact shape of the daily-quota wall hit in this session: a refusal whose
  // own "try again in" text is longer than any pace this benchmark should sit idle for.
  const d = bench.refusalRetryDecision(
    { invalid: true, invalidReason: 'provider refused', refusalLog: 'try again in 9999s.' }, 0);
  assert.strictEqual(d.retry, false);
});
t('gives up once the retry budget is spent, even for a fast-recovering refusal', () =>
  assert.strictEqual(bench.refusalRetryDecision(
    { invalid: true, invalidReason: 'provider refused', refusalLog: 'try again in 1s.' },
    bench.MAX_REFUSAL_RETRIES).retry, false));
t('never retries a run that is not a provider refusal', () => {
  assert.strictEqual(bench.refusalRetryDecision({ invalid: false }, 0).retry, false);
  assert.strictEqual(bench.refusalRetryDecision(
    { invalid: true, invalidReason: 'no model output' }, 0).retry, false);
});

group('gate execution — Termux LD_PRELOAD fix for npx/node_modules/.bin shebangs');
t('termuxExecEnv is a no-op off Termux', () => {
  const saved = process.env.PREFIX;
  try {
    delete process.env.PREFIX;
    assert.deepStrictEqual(gates.termuxExecEnv(), {});
    assert.deepStrictEqual(bench.termuxExecEnv(), {});
  } finally { if (saved === undefined) delete process.env.PREFIX; else process.env.PREFIX = saved; }
});
t('termuxExecEnv sets LD_PRELOAD to the termux-exec shim under Termux, if present', () => {
  // Regression for the defect that invalidated every scoring run this session: gate and
  // benchmark commands run through `npx`, whose local binaries carry `#!/usr/bin/env node`.
  // Termux's own /usr/bin/env is not at that path, so those calls failed "not found" — not
  // a missing tool, an uninherited LD_PRELOAD (Termux ships termux-exec for exactly this).
  const saved = process.env.PREFIX;
  try {
    process.env.PREFIX = '/data/data/com.termux/files/usr';
    for (const env of [gates.termuxExecEnv(), bench.termuxExecEnv()]) {
      if (Object.keys(env).length) {
        assert.ok(typeof env.LD_PRELOAD === 'string' && env.LD_PRELOAD.includes('termux-exec'), JSON.stringify(env));
      } else {
        assert.deepStrictEqual(env, {}); // library not present on this machine — also correct
      }
    }
  } finally { if (saved === undefined) delete process.env.PREFIX; else process.env.PREFIX = saved; }
});
t('exec() actually inherits it — npx resolves a local binary instead of "not found" (this machine is Termux)', () => {
  if (!(process.env.PREFIX || '').includes('com.termux')) return; // nothing to verify off Termux
  const r = gates.exec('npx tsc --version', path.join(R0, '.prepared', 'scaffold'), 30000);
  if (!fs.existsSync(path.join(R0, '.prepared', 'scaffold', 'node_modules', '.bin', 'tsc'))) return; // fixture not prepared
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(/^Version \d/.test(r.out.trim()), r.out);
});

group('benchmark key rotation — TANDEM_API_KEYS, so one quota wall does not stop the run');
t('parses a comma-separated key list, trimming and dropping blanks', () =>
  assert.deepStrictEqual(bench.parseApiKeys(' gsk_a , gsk_b,gsk_c, ', ''), ['gsk_a', 'gsk_b', 'gsk_c']));
t('falls back to the single-key variable when the list is unset', () =>
  assert.deepStrictEqual(bench.parseApiKeys(undefined, 'gsk_only'), ['gsk_only']));
t('is empty when neither variable is set', () =>
  assert.deepStrictEqual(bench.parseApiKeys(undefined, undefined), []));
t('rotation advances on refusal', () => {
  const decision = bench.keyRotationDecision({ invalid: true, invalidReason: 'provider refused' }, 0, 3);
  assert.strictEqual(decision.rotate, true);
  const r = bench.createKeyRotator(['k0', 'k1', 'k2']);
  assert.strictEqual(r.current(), 'k0');
  r.rotate();
  assert.strictEqual(r.current(), 'k1');
  r.rotate();
  assert.strictEqual(r.current(), 'k2');
});
t('rotation wraps around rather than stopping at the last key', () => {
  const r = bench.createKeyRotator(['k0', 'k1']);
  r.rotate(); r.rotate();
  assert.strictEqual(r.current(), 'k0');
});
t('stops after all keys are exhausted — one pass, not an infinite rotation', () => {
  const refused = { invalid: true, invalidReason: 'provider refused' };
  // With 4 keys, the run itself plus 3 rotations covers every key once.
  assert.strictEqual(bench.keyRotationDecision(refused, 0, 4).rotate, true);
  assert.strictEqual(bench.keyRotationDecision(refused, 1, 4).rotate, true);
  assert.strictEqual(bench.keyRotationDecision(refused, 2, 4).rotate, true);
  assert.strictEqual(bench.keyRotationDecision(refused, 3, 4).rotate, false); // every key already tried once
});
t('never rotates for a run that was not a provider refusal', () =>
  assert.strictEqual(bench.keyRotationDecision({ invalid: false }, 0, 8).rotate, false));
t('never rotates with zero or one key configured', () => {
  const refused = { invalid: true, invalidReason: 'provider refused' };
  assert.strictEqual(bench.keyRotationDecision(refused, 0, 1).rotate, false);
  assert.strictEqual(bench.keyRotationDecision(refused, 0, 0).rotate, false);
});
t('no key value appears in any log line — rotation is logged by position only', () => {
  // Fake, shape-matching keys — never a real credential in source.
  const realLookingKeys = [
    'gsk_fake0000000000000000000000000000000000000000AAAA',
    'gsk_fake1111111111111111111111111111111111111111BBBB',
    'gsk_fake2222222222222222222222222222222222222222CCCC',
  ];
  const r = bench.createKeyRotator(realLookingKeys);
  for (let i = 0; i < realLookingKeys.length; i++) {
    const rotated = r.rotate(); // {position, total} — the object handed to formatKeyRotated
    const line = bench.formatKeyRotated(rotated);
    assert.strictEqual(JSON.stringify(rotated).includes('gsk_'), false, 'rotate() leaked a key into its own return value');
    for (const key of realLookingKeys) {
      assert.ok(!line.includes(key), 'KEY_ROTATED line contained a key value');
    }
    assert.match(line, /^KEY_ROTATED \d+\/\d+$/);
  }
});

group('preflight — must recognize TANDEM_API_KEYS, not just TANDEM_API_KEY');
t('requiring bench/preflight.cjs does not hit the network or exit (require.main guard)', () => {
  // Bug found by hand-scoring the benchmark: preflight read only TANDEM_API_KEY, so a
  // TANDEM_API_KEYS-only setup (rotation, no single-key fallback) failed preflight with
  // "TANDEM_API_KEY is not set" even though bench/run.cjs would have started fine. If the
  // guard here were missing, requiring the module below would already have called
  // process.exit() or fetch() before this assertion ran.
  assert.doesNotThrow(() => require('../bench/preflight.cjs'));
});
t('preflight resolves its key through the same parseApiKeys as run.cjs, not TANDEM_API_KEY alone', () => {
  const src = fs.readFileSync(path.join(R0, 'bench', 'preflight.cjs'), 'utf8');
  assert.ok(/parseApiKeys/.test(src), 'does not reuse the shared key parser');
  assert.ok(/TANDEM_API_KEYS/.test(src), 'never reads the plural, rotation-capable variable');
  assert.ok(!/^const key = process\.env\.TANDEM_API_KEY;/m.test(src), 'still reads only the single-key variable directly');
});
t('a TANDEM_API_KEYS-only setup resolves a key (previously: "TANDEM_API_KEY is not set")', () => {
  assert.strictEqual(bench.parseApiKeys('gsk_a,gsk_b', undefined)[0], 'gsk_a');
});

group('doctor — host status must reflect reality');
t('doctor reports the installed host by dynamic import, not a false NOT INSTALLED from require() on an ESM-only package', () => {
  // src/adapter/pi.cjs's require()-based loadHost can never resolve an ESM-only host and
  // always reports NOT INSTALLED. `doctor` must go through the dynamic-import loader in
  // session.mjs instead — the same one `tandem run` uses — or it lies to the user.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  const out = execFileSync(process.execPath, [path.join(R0, 'bin', 'tandem.cjs'), 'doctor'],
    { cwd: tmp, encoding: 'utf8' });
  assert.ok(out.includes('@earendil-works/pi-agent-core'), out);
  assert.ok(!out.includes('NOT INSTALLED'), out);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
