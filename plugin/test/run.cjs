'use strict';
/* Zero-dependency tests for the Tandem autopilot plugin. Run: node plugin/test/run.cjs */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const P = require('../lib/policy.cjs');
const S = require('../lib/scope.cjs');
const V = require('../lib/verify.cjs');
const U = require('../lib/util.cjs');

const HOOK = path.join(__dirname, '..', 'scripts', 'hook.cjs');
let passed = 0; let failed = 0;
const annotate = (name, e) => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=${name.replace(/[:,\n]/g, ' ').slice(0, 100)}::${String(e && e.message).replace(/\r?\n/g, '%0A').slice(0, 900)}`); };
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); annotate(name, e); }
}
function group(name) { console.log(`\n== ${name}`); }

const cfg = Object.assign({}, U.DEFAULT_CONFIG);
const noScope = { named: [], testsAllowed: false, reason: '' };

// ------------------------------------------------------------ scope -------
group('scope derivation');
const FILES = ['index.js', 'lib/parse.js', 'test/fresh.js', 'src/gates/detect.cjs', 'README.md', 'package.json'];
t('names an exact path', () => assert.deepStrictEqual(S.derive('fix src/gates/detect.cjs please', FILES).named, ['src/gates/detect.cjs']));
t('names a file by basename', () => assert.deepStrictEqual(S.derive('the bug is in parse.js', FILES).named, ['lib/parse.js']));
t('keeps a new path the task asks to create', () => assert.ok(S.derive('create lib/util/time.js', FILES).named.includes('lib/util/time.js')));
t('"make sure tests pass" does not unlock test edits', () => assert.strictEqual(S.derive('implement X and make sure tests pass', FILES).testsAllowed, false));
t('"add tests for X" unlocks test edits', () => assert.strictEqual(S.derive('add tests for the parser', FILES).testsAllowed, true));
t('Arabic request for tests unlocks test edits', () => assert.strictEqual(S.derive('اكتب اختبارات للدالة', FILES).testsAllowed, true));
t('a URL is not a file', () => assert.deepStrictEqual(S.derive('see https://example.com/a/b.html', FILES).named, []));

// ------------------------------------------------------------ writes ------
group('write policy');
const W = (o) => P.decideWrite(Object.assign({ exists: true, toolName: 'Edit', input: {}, before: '', scope: noScope, cfg, priorBlocks: 0 }, o));
t('source edit in project is pre-approved', () => assert.strictEqual(W({ rel: 'index.js' }).decision, 'allow'));
const RO = Object.assign({}, cfg, { testPolicy: 'readonly' });
t('readonly policy: existing test file is read-only when tests were not requested', () => {
  const v = W({ rel: 'test/fresh.js', cfg: RO });
  assert.strictEqual(v.decision, 'deny'); assert.strictEqual(v.rule, 'test-readonly');
});
t('refusal redirects to the named files', () => assert.match(W({ rel: 'test/fresh.js', cfg: RO, scope: { named: ['index.js'], testsAllowed: false } }).reason, /index\.js/));
t('second refusal for the same file escalates', () => assert.match(W({ rel: 'test/fresh.js', cfg: RO, priorBlocks: 1 }).reason, /refusal #2/));
t('readonly policy: new test file is refused when tests were not requested', () => assert.strictEqual(W({ rel: 'test/new.test.js', cfg: RO, exists: false, toolName: 'Write', input: { content: 'x' } }).decision, 'deny'));
const SRC = "describe('x', function () {\n  it('a', function () {\n    assert.ok(!f('*, b'))\n  })\n})\n";
t('append-only: adding a new test case is allowed', () => {
  const v = W({ rel: 'test/fresh.js', before: SRC, input: { old_string: "  })\n})\n", new_string: "  })\n  it('b', function () {\n    assert.ok(f('a'))\n  })\n})\n" } });
  assert.strictEqual(v.decision, 'allow');
});
t('append-only: flipping an existing assertion is blocked', () => {
  const v = W({ rel: 'test/fresh.js', before: SRC, input: { old_string: "assert.ok(!f('*, b'))", new_string: "assert.ok(f('*, b'))" } });
  assert.strictEqual(v.rule, 'test-modified');
  assert.match(v.reason, /tell the user/);
});
t('append-only: renaming an existing test is blocked', () => assert.strictEqual(W({ rel: 'test/fresh.js', before: SRC, input: { old_string: "it('a'", new_string: "it('a2'" } }).rule, 'test-modified'));
t('append-only: Claude may rewrite a test file it created during this request', () => {
  const v = W({ rel: 'test/new.test.js', exists: true, preexisting: false, before: "it('a', () => { expect(f()).toBe(1) })\n", input: { old_string: 'toBe(1)', new_string: 'toBe(2)' } });
  assert.strictEqual(v.decision, 'allow');
});
t('append-only: .only is still refused in its own new test file', () => assert.strictEqual(W({ rel: 'test/new.test.js', exists: true, preexisting: false, before: "it('a', () => {})", toolName: 'Write', input: { content: "it.only('a', () => {})" } }).rule, 'test-weakening'));
t('append-only: a new test file is allowed', () => assert.strictEqual(W({ rel: 'test/extra.test.js', exists: false, toolName: 'Write', input: { content: "it('x', () => { expect(1).toBe(1) })" } }).decision, 'allow'));
t('append-only: a new test file with .only is still blocked', () => assert.strictEqual(W({ rel: 'test/extra.test.js', exists: false, toolName: 'Write', input: { content: "it.only('x', () => {})" } }).rule, 'test-weakening'));
t('isAppendOnly ignores indentation changes', () => assert.ok(P.isAppendOnly('a\n  b\n', 'a\n    b\nc\n')));
t('test edit allowed when requested', () => {
  const before = "it('a', () => { expect(1).toBe(1); });\n";
  const v = W({ rel: 'test/a.test.js', before, scope: { named: [], testsAllowed: true }, input: { old_string: "it('a'", new_string: "it('a renamed'" } });
  assert.strictEqual(v.decision, 'allow');
});
t('removing an assertion is refused even when tests are allowed', () => {
  const before = "it('a', () => {\n  expect(f()).toBe(1);\n  expect(g()).toBe(2);\n});\n";
  const v = W({ rel: 'test/a.test.js', before, scope: { named: [], testsAllowed: true }, input: { old_string: '  expect(g()).toBe(2);\n', new_string: '' } });
  assert.strictEqual(v.rule, 'test-weakening');
});
t('adding .skip is refused', () => {
  const before = "it('a', () => { expect(1).toBe(1); });\n";
  const v = W({ rel: 'test/a.test.js', before, scope: { named: [], testsAllowed: true }, input: { old_string: "it('a'", new_string: "it.skip('a'" } });
  assert.strictEqual(v.rule, 'test-weakening');
});
t('adding .only is refused', () => {
  const v = W({ rel: 'test/a.test.js', before: "it('a', () => {})", scope: { named: [], testsAllowed: true }, toolName: 'Write', input: { content: "it.only('a', () => {})" } });
  assert.strictEqual(v.rule, 'test-weakening');
});
t('python assert removal is caught', () => {
  const before = 'def test_a():\n    assert f() == 1\n    assert g() == 2\n';
  const v = W({ rel: 'tests/test_a.py', before, scope: { named: [], testsAllowed: true }, toolName: 'Write', input: { content: 'def test_a():\n    assert f() == 1\n' } });
  assert.strictEqual(v.rule, 'test-weakening');
});
t('.env is protected unless named', () => {
  assert.strictEqual(W({ rel: '.env' }).rule, 'secrets');
  assert.strictEqual(W({ rel: '.env', scope: { named: ['.env'], testsAllowed: false } }).decision, 'allow');
});
t('lockfile is protected', () => assert.strictEqual(W({ rel: 'package-lock.json' }).rule, 'lockfile'));
t('CI config is protected', () => assert.strictEqual(W({ rel: '.github/workflows/ci.yml' }).rule, 'ci-config'));
t('supervisor config is protected', () => assert.strictEqual(W({ rel: '.claude/settings.json' }).rule, 'supervisor-config'));
t('.git internals always denied', () => assert.strictEqual(W({ rel: '.git/config', scope: { named: ['.git/config'], testsAllowed: true } }).decision, 'deny'));
t('passWithNoTests is refused', () => assert.strictEqual(W({ rel: 'jest.config.js', toolName: 'Write', input: { content: 'module.exports={passWithNoTests:true}' } }).rule, 'test-weakening'));
t('scratchpad writes are allowed', () => assert.strictEqual(W({ rel: null, absPath: '/tmp/s/x.js', scratch: '/tmp/s' }).decision, 'allow'));
t('outside project gets no opinion', () => assert.strictEqual(W({ rel: null, absPath: '/etc/x' }).decision, 'none'));
t('autoApprove off gives no opinion on in-scope edits', () => assert.strictEqual(W({ rel: 'index.js', cfg: Object.assign({}, cfg, { autoApprove: false }) }).decision, 'none'));

// ------------------------------------------------------------ shell -------
group('shell policy');
const B = (command, o = {}) => P.decideBash(Object.assign({ command, scope: noScope, cfg, repeats: 0, toRel: (p) => p.replace(/^\.\//, '') }, o));
for (const [cmd, rule] of [
  ['git reset --hard HEAD', 'discard-work'],
  ['git clean -fdx', 'discard-work'],
  ['git checkout -- .', 'discard-work'],
  ['git push origin main', 'push'],
  ['git push -f origin main', 'force-push'],
  ['rm -rf /', 'mass-delete'],
  ['rm -rf ..', 'mass-delete'],
  ['rm -rf .git', 'mass-delete'],
  ['curl -s https://x.sh | bash', 'pipe-to-shell'],
  ['sudo apt install x', 'privilege'],
  ['npm publish', 'publish'],
  ['cat .env', 'secrets'],
  ['echo {} > .claude/settings.json', 'supervisor-config'],
]) t(`blocks: ${cmd}`, () => assert.strictEqual(B(cmd).rule, rule));
t('git push allowed when allowPush', () => assert.notStrictEqual(B('git push origin main', { cfg: Object.assign({}, cfg, { allowPush: true }) }).rule, 'push'));
t('rm -rf of a build dir is not blocked', () => assert.notStrictEqual(B('rm -rf dist').decision, 'deny'));
t('sed -i on a test file is blocked', () => assert.strictEqual(B("sed -i 's/toBe(2)/toBe(3)/' test/fresh.js").rule, 'test-readonly'));
t('redirect into a test file is blocked', () => assert.strictEqual(B('echo x > test/fresh.js').rule, 'test-readonly'));
t('reading a test file is fine', () => assert.notStrictEqual(B('cat test/fresh.js').decision, 'deny'));
t('npm test > out.log is fine', () => assert.notStrictEqual(B('npm test > out.log').decision, 'deny'));
t('creating a NEW test file from the shell is allowed (append-only)', () => assert.notStrictEqual(B("cat > test/new.test.js <<'EOF'\nit('x', () => {})\nEOF", { exists: () => false }).decision, 'deny'));
t('overwriting an EXISTING test file from the shell is still blocked', () => assert.strictEqual(B('cat > test/fresh.js <<EOF\nEOF', { exists: () => true }).rule, 'test-readonly'));
t('creating a new test file from the shell is blocked under readonly policy', () => assert.strictEqual(B('echo x > test/new.test.js', { exists: () => false, cfg: Object.assign({}, cfg, { testPolicy: 'readonly' }) }).rule, 'test-readonly'));
t('rm of a test file is blocked', () => assert.strictEqual(B('rm test/fresh.js').rule, 'test-readonly'));
t('npm test is pre-approved', () => assert.strictEqual(B('npm test').decision, 'allow'));
t('git status is pre-approved', () => assert.strictEqual(B('git status').decision, 'allow'));
t('arbitrary command gets no opinion', () => assert.strictEqual(B('node scripts/migrate.js').decision, 'none'));
t('npm test 2>&1 | tail -8 is pre-approved', () => assert.strictEqual(B('npm test 2>&1 | tail -8').decision, 'allow'));
t('cd then npm test is pre-approved', () => assert.strictEqual(B('cd sub && npm test').decision, 'allow'));
t('pipe into an unsafe command is not pre-approved', () => assert.strictEqual(B('cat x | node y.js').decision, 'none'));
t('find -delete is not pre-approved', () => assert.strictEqual(B('find . -name x -delete').decision, 'none'));
t('sed -n is pre-approved, sed -i is not', () => { assert.strictEqual(B('sed -n 1,5p a.js').decision, 'allow'); assert.strictEqual(B("sed -i 's/a/b/' a.js").decision, 'none'); });
t('command substitution is never pre-approved', () => assert.strictEqual(B('echo $(cat x)').decision, 'none'));
t('node -e is never pre-approved', () => assert.strictEqual(B('node -e "console.log(1)"').decision, 'none'));
t('python -c is never pre-approved', () => assert.strictEqual(B('python3 -c "print(1)"').decision, 'none'));
t('node -e writing .env is blocked', () => assert.strictEqual(B(`node -e "require('fs').writeFileSync('.env','X=1')"`).rule, 'secrets'));
t('node -e writing a test file is blocked', () => assert.strictEqual(B(`node -e "require('fs').writeFileSync('test/a.test.js','')"`).rule, 'test-readonly'));
t('python -c writing a test file is blocked', () => assert.strictEqual(B(`python3 -c "open('tests/test_a.py','w').write('')"`).rule, 'test-readonly'));
t('python -c reading .env is blocked', () => assert.strictEqual(B(`python3 -c "print(open('.env').read())"`).rule, 'secrets'));
t('node -e mentioning process.env is not a secrets read', () => assert.notStrictEqual(B('node -e "console.log(process.env.HOME)"').rule, 'secrets'));
t('git branch -D is not pre-approved', () => assert.strictEqual(B('git branch -D feature').decision, 'none'));
t('git branch listing is pre-approved', () => assert.strictEqual(B('git branch -a').decision, 'allow'));
t('sort -o is not pre-approved', () => assert.strictEqual(B('sort -o a.txt b.txt').decision, 'none'));
t('git diff --output is not pre-approved', () => assert.strictEqual(B('git diff --output=x.patch').decision, 'none'));
t('loop: 3rd identical repeat is blocked', () => assert.strictEqual(B('npm test', { repeats: 3 }).rule, 'loop'));
t('loop: 2nd repeat is still allowed', () => assert.notStrictEqual(B('npm test', { repeats: 2 }).decision, 'deny'));

// ------------------------------------------------------------ verify ------
group('verification helpers');
t('failure signature ignores timings', () => assert.strictEqual(V.failSignature('FAIL a 12ms\nok'), V.failSignature('FAIL a 40ms\nok')));
t('summary keeps the failing lines', () => assert.match(V.summarize('ok 1\nnot ok 2 - adds\nok 3'), /not ok 2/));

// ------------------------------------------------------------ compact -----
group('output compaction');
const C = require('../lib/compact.cjs');
const passOut = Array.from({ length: 200 }, (_, i) => `  ok   test number ${i}`).concat(['', '200 passed, 0 failed']).join('\n');
t('short output is returned unchanged', () => assert.strictEqual(C.compact('ok\n1 passed', 0).compacted, false));
t('a passing run shrinks to its summary', () => { const c = C.compact(passOut, 0); assert.ok(c.compacted); assert.match(c.text, /200 passed/); assert.ok(c.after < c.before / 10); });
const failOut = Array.from({ length: 150 }, (_, i) => (i === 70 ? '  FAIL adds two numbers\n       AssertionError: expected 5 to equal 4' : `  ok   case ${i}`)).concat(['149 passed, 1 failed']).join('\n');
t('a failing run keeps the failing test and its message', () => { const c = C.compact(failOut, 1); assert.match(c.text, /FAIL adds two numbers/); assert.match(c.text, /expected 5 to equal 4/); assert.match(c.text, /1 failed/); });
t('every failure line survives the size cap', () => {
  const many = Array.from({ length: 400 }, (_, i) => `  FAIL case ${i} with a fairly long descriptive name that eats budget\n    at foo (node_modules/x/y.js:1:1)\n    context line a\n    context line b`).join('\n');
  const c = C.compact(many, 1);
  for (const i of [0, 199, 399]) assert.ok(c.text.includes(`FAIL case ${i} with`), `case ${i}`);
});
t('dependency stack frames are dropped', () => assert.doesNotMatch(C.compact(failOut + '\n    at x (node_modules/a.js:1:1)'.repeat(50), 1).text, /node_modules/));
t('jest/vitest JSON report becomes a failure list', () => {
  const rep = JSON.stringify({ numFailedTests: 1, numPassedTests: 9, numTotalTests: 10, testResults: [{ name: 'a.test.ts', status: 'failed', assertionResults: [{ status: 'failed', fullName: 'sum adds', failureMessages: ['AssertionError: expected 3 to be 4\n    at node_modules/x.js'] }, { status: 'passed', fullName: 'ok one' }] }], pad: 'x'.repeat(5000) });
  const c = C.compact(rep, 1);
  assert.match(c.text, /× sum adds/); assert.match(c.text, /expected 3 to be 4/); assert.match(c.text, /1 failed, 9 passed/); assert.doesNotMatch(c.text, /ok one/);
});
for (const cmd of ['npm test', 'pnpm run test:unit', 'npx vitest run', 'pytest -q', 'go test ./...', 'cargo test', 'cd pkg && npm test', 'npm test 2>&1', 'npx tsc --noEmit'])
  t(`compactable: ${cmd}`, () => assert.ok(C.isCompactable(cmd)));
for (const cmd of ['npm test 2>&1 | tail -8', 'npm test | tail -n 20', 'pytest -q | head -40'])
  t(`compactable (short-output pipe replaced, exit code kept): ${cmd}`, () => { assert.ok(C.isCompactable(cmd)); assert.doesNotMatch(C.baseCommand(cmd), /tail|head/); });
for (const cmd of ['npm test | grep FAIL', 'npm test > log.txt', 'node app.js', 'npm install', 'npm test; rm -rf x', 'echo $(npm test)', 'git status'])
  t(`not compactable: ${cmd}`, () => assert.ok(!C.isCompactable(cmd)));

// ------------------------------------------------------------ imports -----
group('hallucinated imports');
const I = require('../lib/imports.cjs');
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-imp-'));
fs.mkdirSync(path.join(proj, 'src', 'util'), { recursive: true });
fs.mkdirSync(path.join(proj, 'node_modules', 'lodash'), { recursive: true });
fs.writeFileSync(path.join(proj, 'node_modules', 'lodash', 'package.json'), '{"name":"lodash"}');
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'p', dependencies: { express: '^4' } }));
fs.writeFileSync(path.join(proj, 'src', 'util', 'time.ts'), 'export const x = 1;\n');
fs.writeFileSync(path.join(proj, 'src', 'a.ts'), '');
const NU = (after, before = '') => I.newUnresolved(proj, 'src/a.ts', before, after).map((b) => b.spec);
t('extracts import, export-from, require and dynamic import', () => assert.deepStrictEqual(Array.from(I.jsImports("import a from 'x'\nimport type {T} from \"y\"\nexport * from './z'\nconst q = require('w')\nawait import('v')\n// import 'ignored'")).sort(), ['./z', 'v', 'w', 'x', 'y']));
t('relative import to a missing file is flagged', () => assert.deepStrictEqual(NU("import { f } from './util/clock'"), ['./util/clock']));
t('relative import written as .js for a .ts source resolves', () => assert.deepStrictEqual(NU("import { x } from './util/time.js'"), []));
t('builtins resolve', () => assert.deepStrictEqual(NU("import fs from 'node:fs'\nconst p = require('path')"), []));
t('declared dependency resolves even if not installed', () => assert.deepStrictEqual(NU("import express from 'express'"), []));
t('installed package resolves', () => assert.deepStrictEqual(NU("import _ from 'lodash/fp'"), []));
t('invented package is flagged', () => assert.deepStrictEqual(NU("import { magic } from 'super-json-fixer'"), ['super-json-fixer']));
t('imports that were already there are not re-reported', () => assert.deepStrictEqual(NU("import a from 'ghost-pkg'\nimport b from 'x2'", "import a from 'ghost-pkg'"), ['x2']));
t('python imports are parsed', () => assert.deepStrictEqual(Array.from(I.pyImports('import os, sys as s\nfrom collections import deque\nfrom .local import x\n# import nope')).sort(), ['.local', 'collections', 'os', 'sys']));
t('python: invented module is flagged, stdlib is not', () => {
  fs.writeFileSync(path.join(proj, 'app.py'), '');
  const bad = I.newUnresolved(proj, 'app.py', '', 'import os\nimport json\nimport totally_made_up_mod\n').map((b) => b.spec);
  if (bad.length || spawnSync('python3', ['--version']).status === 0) assert.deepStrictEqual(bad, ['totally_made_up_mod']);
});

// ------------------------------------------------------------ secrets -----
group('secret scanning');
const SEC = require('../lib/secrets.cjs');
// Fake credentials are assembled at runtime so this file never contains one literally.
const rnd = (n, set = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from({ length: n }, (_, i) => set[(i * 7 + 3) % set.length]).join('');
const FAKE = {
  gh: 'gh' + 'p_' + rnd(36),
  aws: 'AK' + 'IA' + rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
  ant: 'sk-' + 'ant-api03-' + rnd(80),
  oai: 'sk-' + 'proj-' + rnd(48),
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----\\n' + rnd(64, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789+/'),
};
for (const [k, v] of Object.entries(FAKE)) t(`detects ${k}`, () => assert.ok(SEC.scan(`const key = "${v}";`).length >= 1));
t('generic high-entropy secret assignment is detected', () => assert.ok(SEC.scan(`const apiKey = "${rnd(32)}9Q+z";`).length));
t('identifiers and doc examples are not secrets', () => {
  assert.deepStrictEqual(SEC.scan("const lastSignificantToken = '?NonExpressionBlockEnd'; const authorIdentity = 'evaluator-identity-2024'; key='-----BEGIN PRIVATE KEY-----\\nXXXX\\nXXXX'; // proto://username:password@host.com"), []);
});
t('placeholders and env reads are not secrets', () => {
  assert.deepStrictEqual(SEC.scan('const apiKey = process.env.API_KEY; const token = "your_token_here_please_replace"; password: "changeme-changeme";'), []);
});
t('the secret value itself is never echoed', () => assert.doesNotMatch(SEC.describe(SEC.scan(FAKE.gh)), new RegExp(FAKE.gh.slice(6, 30))));
t('writing a credential into source is refused', () => {
  const v = W({ rel: 'src/config.js', toolName: 'Write', exists: false, input: { content: `module.exports = { key: "${FAKE.ant}" };` } });
  assert.strictEqual(v.rule, 'secret-in-code'); assert.match(v.reason, /process\.env/);
});
t('a credential that was already in the file does not block an unrelated edit', () => {
  const before = `const k = "${FAKE.aws}";\nconst a = 1;\n`;
  assert.strictEqual(W({ rel: 'src/legacy.js', before, input: { old_string: 'const a = 1;', new_string: 'const a = 2;' } }).decision, 'allow');
});
t('writing the credential into a named .env is fine', () => assert.strictEqual(W({ rel: '.env', scope: { named: ['.env'], testsAllowed: false }, toolName: 'Write', input: { content: `KEY=${FAKE.oai}` } }).decision, 'allow'));
t('.env.example with a real key is refused', () => assert.strictEqual(W({ rel: '.env.example', toolName: 'Write', exists: false, input: { content: `KEY=${FAKE.gh}` } }).rule, 'secret-in-code'));
t('.env.example without real values stays editable', () => assert.strictEqual(W({ rel: '.env.example', toolName: 'Write', exists: false, input: { content: 'API_KEY=your-key-here\n' } }).decision, 'allow'));
t('echoing a credential into a file is refused', () => assert.strictEqual(B(`echo "TOKEN=${FAKE.gh}" >> src/settings.py`).rule, 'secret-in-code'));

// ------------------------------------------------------------ hygiene -----
group('debug leftovers');
const HY = require('../lib/hygiene.cjs');
const L = (arr) => arr.map((text, i) => ({ n: i + 1, text }));
t('debugger and breakpoint() are flagged', () => {
  assert.strictEqual(HY.findings('src/a.ts', '', L(['  debugger;']), false).length, 1);
  assert.strictEqual(HY.findings('app/m.py', '', L(['    breakpoint()']), false).length, 1);
});
t('console.log in a file that never logged is flagged', () => assert.match(HY.findings('src/a.ts', 'export const x = 1;', L(['console.log("here", x)']), false)[0], /console\.log/));
t('console.log in a file that already logs is left alone', () => assert.deepStrictEqual(HY.findings('src/a.ts', 'console.log("start")', L(['console.log("more")']), false), []));
t('console.log in bin/ and in tests is left alone', () => { assert.deepStrictEqual(HY.findings('bin/cli.js', '', L(['console.log(1)']), false), []); assert.deepStrictEqual(HY.findings('test/a.test.js', '', L(['console.log(1)']), true), []); });
t('new TODO markers are counted', () => assert.match(HY.findings('src/a.ts', '', L(['// TODO: handle errors']), false)[0], /1 new TODO/));
t('diff parser keeps added line numbers', () => assert.deepStrictEqual(HY.addedLinesFromDiff('+++ b/src/a.ts\n@@ -3,0 +4,2 @@\n+x\n+y\n')['src/a.ts'], [{ n: 4, text: 'x' }, { n: 5, text: 'y' }]));

// ------------------------------------------------------------ checkpoints -
group('checkpoints and undo');
const CP = require('../lib/checkpoint.cjs');
const cpd = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-cp-'));
const cg = (...a) => spawnSync('git', a, { cwd: cpd, encoding: 'utf8' });
cg('init', '-q'); cg('config', 'user.email', 't@t'); cg('config', 'user.name', 't');
cg('config', 'core.autocrlf', 'true'); // what Git for Windows sets by default: undo must still be byte-exact
fs.writeFileSync(path.join(cpd, '.gitignore'), 'ignored.log\n');
fs.writeFileSync(path.join(cpd, 'a.js'), 'v1\n'); cg('add', '-A'); cg('commit', '-qm', 'i');
fs.writeFileSync(path.join(cpd, 'a.js'), 'v2-uncommitted\n');
fs.writeFileSync(path.join(cpd, 'notes.txt'), 'user untracked work\n');
fs.writeFileSync(path.join(cpd, 'ignored.log'), 'keep me\n');
let cp1;
t('a checkpoint does not touch the index, branch or stash', () => {
  const st = cg('status', '--porcelain').stdout;
  cp1 = CP.create(cpd, 'make it v3');
  assert.ok(cp1 && cp1.sha);
  assert.strictEqual(cg('status', '--porcelain').stdout, st);
  assert.strictEqual(cg('stash', 'list').stdout, '');
});
t('an unchanged tree reuses the last checkpoint', () => assert.ok(CP.create(cpd, 'again').reused));
t('undo restores edits made by tools AND by the shell, and removes new files', () => {
  fs.writeFileSync(path.join(cpd, 'a.js'), 'v3-by-agent\n');
  fs.unlinkSync(path.join(cpd, 'notes.txt'));          // e.g. rm from the shell
  fs.writeFileSync(path.join(cpd, 'junk.js'), 'x\n');   // new file
  const r = CP.restore(cpd, cp1.sha);
  assert.ok(r.ok);
  assert.strictEqual(fs.readFileSync(path.join(cpd, 'a.js'), 'utf8'), 'v2-uncommitted\n');
  assert.strictEqual(fs.readFileSync(path.join(cpd, 'notes.txt'), 'utf8'), 'user untracked work\n');
  assert.ok(!fs.existsSync(path.join(cpd, 'junk.js')));
  assert.strictEqual(fs.readFileSync(path.join(cpd, 'ignored.log'), 'utf8'), 'keep me\n');
});
t('the undo itself can be undone', () => {
  const back = CP.list(cpd).find((c) => /state before tandem undo/.test(c.label));
  CP.restore(cpd, back.sha);
  assert.strictEqual(fs.readFileSync(path.join(cpd, 'a.js'), 'utf8'), 'v3-by-agent\n');
  assert.ok(fs.existsSync(path.join(cpd, 'junk.js')));
});
t('undo skips a checkpoint identical to the current tree (e.g. one taken by the /tandem:undo request itself)', () => {
  CP.create(cpd, '/tandem:undo');
  const targets = CP.undoTargets(cpd);
  assert.ok(targets.length >= 1);
  assert.notStrictEqual(targets[0].tree, CP.currentTree(cpd));
});
t('tandem undo CLI reports what it changed back', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'tandem.cjs'), 'undo', '1'], { cwd: cpd, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: cpd }) });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Restored the working tree[\s\S]*a\.js/);
  const before = fs.readFileSync(path.join(cpd, 'a.js'), 'utf8');
  const r2 = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'tandem.cjs'), 'redo'], { cwd: cpd, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: cpd }) });
  assert.match(r2.stdout, /Brought back/);
  assert.notStrictEqual(fs.readFileSync(path.join(cpd, 'a.js'), 'utf8'), before);
});
fs.rmSync(cpd, { recursive: true, force: true });
t('undo is byte-exact with core.autocrlf=true: CRLF stays CRLF, LF stays LF', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-eol-'));
  const x = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  x('init', '-q'); x('config', 'core.autocrlf', 'true'); x('config', 'user.email', 't@t'); x('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'base.txt'), 'x\n'); x('add', '-A'); x('commit', '-qm', 'i');
  fs.writeFileSync(path.join(d, 'win.txt'), 'a\r\nb\r\n');
  fs.writeFileSync(path.join(d, 'unix.txt'), 'a\nb\n');
  const c = CP.create(d, 'eol');
  fs.writeFileSync(path.join(d, 'win.txt'), 'changed\n');
  fs.writeFileSync(path.join(d, 'unix.txt'), 'changed\r\n');
  CP.restore(d, c.sha);
  assert.strictEqual(fs.readFileSync(path.join(d, 'win.txt'), 'utf8'), 'a\r\nb\r\n');
  assert.strictEqual(fs.readFileSync(path.join(d, 'unix.txt'), 'utf8'), 'a\nb\n');
  fs.rmSync(d, { recursive: true, force: true });
});

// ------------------------------------------------------------ packages ----
group('package install guard');
const K = require('../lib/packages.cjs');
t('parses npm/pnpm/yarn/pip install targets', () => {
  assert.deepStrictEqual(K.installTargets('npm i -D left-pad@1.3.0 @types/node && pip install "requests>=2" -r req.txt').map((x) => x.name), ['left-pad', '@types/node', 'requests']);
  assert.deepStrictEqual(K.installTargets('yarn add react'), [{ eco: 'npm', name: 'react' }]);
  assert.deepStrictEqual(K.installTargets('python -m pip install Flask'), [{ eco: 'pypi', name: 'flask' }]);
  assert.deepStrictEqual(K.installTargets('npm install'), []);
  assert.deepStrictEqual(K.installTargets('npm i ./local-pkg git+https://x/y.git'), []);
});
const day = 86400000; const NOW = Date.parse('2026-10-24T00:00:00Z');
const fake = (db) => async (url) => {
  const name = decodeURIComponent(url.split('/').slice(-1)[0] === 'json' ? url.split('/').slice(-2)[0] : url.split('/').pop());
  const rec = db[name];
  if (!rec) return { status: 404, json: async () => ({}) };
  return { status: 200, json: async () => (url.includes('pypi') ? { releases: { '1.0': [{ upload_time_iso_8601: rec }] } } : { time: { created: rec } }) };
};
const db = { 'left-pad': '2016-03-01T00:00:00Z', requests: '2011-02-14T00:00:00Z', 'expres-session-utils': new Date(NOW - 3 * day).toISOString() };
const CK = (cmd, o = {}) => K.checkInstall(cmd, Object.assign({ fetcher: fake(db), now: NOW }, o));
const asyncTests = [];
const ta = (name, fn) => asyncTests.push([name, fn]);
ta('established package passes', async () => assert.strictEqual((await CK('npm i left-pad')).decision, 'none'));
ta('non-existent npm package is refused', async () => { const v = await CK('npm install reactt-query-pro'); assert.strictEqual(v.rule, 'package-missing'); assert.match(v.reason, /does not exist on npm/); });
ta('non-existent PyPI package is refused', async () => assert.strictEqual((await CK('pip install requestz-ng')).rule, 'package-missing'));
ta('package first published 3 days ago is refused', async () => { const v = await CK('npm i expres-session-utils'); assert.strictEqual(v.rule, 'package-new'); assert.match(v.reason, /3 day/); });
ta('allowPackages exempts a name', async () => assert.strictEqual((await CK('npm i expres-session-utils', { allow: ['expres-session-utils'] })).decision, 'none'));
ta('registry unreachable means no opinion', async () => assert.strictEqual((await CK('npm i whatever', { fetcher: async () => { throw new Error('offline'); } })).decision, 'none'));

// ------------------------------------------------------- end to end -------
group('hook end to end (real git repo, real processes)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-e2e-'));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, Object.assign({ cwd: tmp, encoding: 'utf8' }, opts));
run('git', ['init', '-q']); run('git', ['config', 'user.email', 't@t']); run('git', ['config', 'user.name', 't']);
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node test/add.test.js' } }));
fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b) => a + b;\n');
fs.mkdirSync(path.join(tmp, 'test'));
fs.writeFileSync(path.join(tmp, 'test', 'add.test.js'), "const assert = require('assert');\nconst add = require('../add.js');\nassert.strictEqual(add(2, 2), 4);\nconsole.log('ok');\n");
run('git', ['add', '-A']); run('git', ['commit', '-qm', 'init']);

const hook = (event, input) => {
  const r = spawnSync(process.execPath, [HOOK, event], { cwd: tmp, input: JSON.stringify(Object.assign({ session_id: 's1', cwd: tmp }, input)), encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp }) });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* none */ }
  return { code: r.status, json, stderr: r.stderr };
};

t('SessionStart injects the operating brief with the test command', () => {
  const r = hook('SessionStart', { source: 'startup' });
  assert.match(r.json.hookSpecificOutput.additionalContext, /npm test/);
});
t('UserPromptSubmit derives scope', () => {
  const r = hook('UserPromptSubmit', { prompt: 'make add.js support three numbers' });
  assert.match(r.json.hookSpecificOutput.additionalContext, /add\.js/);
  assert.match(r.json.hookSpecificOutput.additionalContext, /append-only/);
});
t('PreToolUse denies changing an existing assertion with exit 2 and a JSON deny', () => {
  const r = hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'test', 'add.test.js'), old_string: '4);', new_string: '5);' } });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.stderr, /add\.js/);
});
t('PreToolUse routes npm test through the compactor and keeps it pre-approved', () => {
  const r = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'run tests' } });
  const o = r.json.hookSpecificOutput;
  assert.strictEqual(o.permissionDecision, 'allow');
  assert.match(o.updatedInput.command, /run\.cjs" [A-Za-z0-9+/=]+$/);
  assert.strictEqual(o.updatedInput.description, 'run tests');
  const back = Buffer.from(o.updatedInput.command.split(' ').pop(), 'base64').toString();
  assert.strictEqual(back, 'npm test');
});
t('the compactor wrapper runs the real command and keeps its exit code', () => {
  const r = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const x = spawnSync(r.json.hookSpecificOutput.updatedInput.command, { cwd: tmp, shell: true, encoding: 'utf8' });
  assert.strictEqual(x.status, 0); assert.match(x.stdout, /ok/);
});
t('compactOutput:false leaves commands alone', () => {
  const r = spawnSync(process.execPath, [HOOK, 'PreToolUse'], { cwd: tmp, encoding: 'utf8', input: JSON.stringify({ session_id: 's9', tool_name: 'Bash', tool_input: { command: 'npm test' } }), env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp, TANDEM_COMPACT: 'off' }) });
  assert.ok(!JSON.parse(r.stdout).hookSpecificOutput.updatedInput);
});
t('PreToolUse pre-approves the source edit', () => {
  const r = hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'add.js'), old_string: 'a + b', new_string: 'a - b' } });
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'allow');
});
t('PostToolUse reports a syntax error immediately', () => {
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b) => { a + ;\n');
  const r = hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'add.js') } });
  assert.strictEqual(r.code, 2); assert.match(r.stderr, /no longer parses/);
});
t('Stop blocks while the tests fail, and says why', () => {
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b) => a - b;\n');
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /npm test/);
  assert.match(r.json.reason, /Repair round 1\/3/);
});
t('Stop hands back after the same failure repeats (no infinite loop)', () => {
  let r;
  for (let i = 0; i < 5; i++) { r = hook('Stop', {}); if (!r.json || r.json.decision !== 'block') break; }
  assert.ok(!r.json || r.json.decision !== 'block');
  assert.match(r.json.systemMessage, /handing back/);
});
t('PostToolUse warns about an invented import without blocking', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support three numbers' });
  hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'add.js'), old_string: 'module', new_string: 'x' } });
  fs.writeFileSync(path.join(tmp, 'add.js'), "const fmt = require('number-formatter-x');\nmodule.exports = (a, b, c = 0) => a + b + c;\n");
  const r = hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'add.js') } });
  assert.strictEqual(r.code, 0);
  assert.match(r.json.hookSpecificOutput.additionalContext, /number-formatter-x/);
});
t('Stop refuses to finish while that import still does not resolve', () => {
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /do not resolve[\s\S]*number-formatter-x/);
});
t('after compaction the task state is re-injected', () => {
  const r = hook('SessionStart', { source: 'compact' });
  const c = r.json.hookSpecificOutput.additionalContext;
  assert.match(c, /Current request: make add\.js support three numbers/);
  assert.match(c, /Files changed so far for this request: add\.js/);
  assert.match(c, /Imports that did not resolve yet: add\.js: number-formatter-x/);
});
t('Stop allows and writes a receipt once tests pass', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support three numbers' });
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0) => a + b + c;\n');
  const r = hook('Stop', {});
  assert.ok(!r.json.decision);
  assert.match(r.json.systemMessage, /verified/);
  assert.ok(fs.existsSync(path.join(tmp, '.git', 'tandem', 'last-receipt.md')));
});
t('Stop points out a debug leftover once, then lets Claude finish', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support four numbers' });
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0, d = 0) => {\n  console.log("dbg", a);\n  return a + b + c + d;\n};\n');
  const r1 = hook('Stop', {});
  assert.strictEqual(r1.json.decision, 'block');
  assert.match(r1.json.reason, /debug leftovers[\s\S]*add\.js:2/);
  const r2 = hook('Stop', {});
  assert.ok(!r2.json.decision);
  assert.match(fs.readFileSync(path.join(tmp, '.git', 'tandem', 'last-receipt.md'), 'utf8'), /Possible debug leftovers/);
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0) => a + b + c;\n');
});
t('a checkpoint is taken at every request, so /tandem:undo has something to restore', () => {
  assert.ok(CP.list(tmp).length >= 1);
});
t('end to end: Claude can fix a test file it created earlier in the same request', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support three numbers' });
  const f = path.join(tmp, 'test', 'own.test.js');
  fs.writeFileSync(f, "const assert = require('assert');\nassert.strictEqual(1, 2);\n");
  const r = hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: f, old_string: 'assert.strictEqual(1, 2);', new_string: 'assert.strictEqual(1, 1);' } });
  assert.notStrictEqual(r.json && r.json.hookSpecificOutput && r.json.hookSpecificOutput.permissionDecision, 'deny');
  const r2 = hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(tmp, 'test', 'add.test.js'), old_string: '4);', new_string: '5);' } });
  assert.strictEqual(r2.json.hookSpecificOutput.permissionDecision, 'deny');
  fs.unlinkSync(f);
});
t('Stop reuses the agent\'s own passing run on the same tree instead of running the suite again', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support five numbers' });
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0, d = 0, e = 0) => a + b + c + d + e;\n');
  const pre = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  spawnSync(pre.json.hookSpecificOutput.updatedInput.command, { cwd: tmp, shell: true, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp }) });
  const r = hook('Stop', {});
  assert.ok(!r.json.decision);
  assert.match(fs.readFileSync(path.join(tmp, '.git', 'tandem', 'last-receipt.md'), 'utf8'), /not repeated/);
});
t('...but runs the suite again once the tree changed after that run', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support five numbers' });
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b) => a - b;\n');
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0) => a + b + c;\n');
  hook('UserPromptSubmit', { prompt: 'reset' }); hook('Stop', {});
});
t('Stop catches a test weakened through the shell', () => {
  hook('UserPromptSubmit', { prompt: 'change add.js' });
  fs.writeFileSync(path.join(tmp, 'test', 'add.test.js'), "console.log('ok');\n");
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /changed or weakened/);
  run('git', ['checkout', '--', 'test/add.test.js']);
});
t('Stop catches .only in a new test file written from the shell', () => {
  hook('UserPromptSubmit', { prompt: 'change add.js' });
  fs.writeFileSync(path.join(tmp, 'test', 'extra.test.js'), "it.only('x', () => {})\n");
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /extra\.test\.js: adds \.only/);
  fs.unlinkSync(path.join(tmp, 'test', 'extra.test.js'));
});
t('Stop is silent when nothing changed', () => {
  run('git', ['add', '-A']); run('git', ['commit', '-qm', 'two']);
  hook('UserPromptSubmit', { prompt: 'explain add.js' });
  const r = hook('Stop', {});
  assert.strictEqual(r.json, null);
});
t('git commit with a staged credential is refused', () => {
  fs.writeFileSync(path.join(tmp, 'cfg.js'), `module.exports = "${FAKE.gh}";\n`);
  run('git', ['add', 'cfg.js']);
  const r = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "add config"' } });
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.stderr, /github-token .* in cfg\.js/);
  assert.ok(!r.stderr.includes(FAKE.gh));
  run('git', ['rm', '-q', '--cached', 'cfg.js']); fs.unlinkSync(path.join(tmp, 'cfg.js'));
});
t('git add -A && git commit catches an untracked credential file', () => {
  fs.writeFileSync(path.join(tmp, 'keys.txt'), `aws ${FAKE.aws}\n`);
  const r = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m wip' } });
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
  fs.unlinkSync(path.join(tmp, 'keys.txt'));
});
t('a clean commit is not blocked', () => {
  const r = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' } });
  assert.ok(!r.json || !r.json.hookSpecificOutput || r.json.hookSpecificOutput.permissionDecision !== 'deny');
});
t('observe mode never blocks', () => {
  hook('UserPromptSubmit', { prompt: 'x' });
  const r = spawnSync(process.execPath, [HOOK, 'PreToolUse'], { cwd: tmp, encoding: 'utf8', input: JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git reset --hard' } }), env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp, TANDEM_MODE: 'observe' }) });
  assert.strictEqual(r.status, 0);
});
t('internal errors fail open', () => {
  const r = spawnSync(process.execPath, [HOOK, 'PreToolUse'], { cwd: tmp, encoding: 'utf8', input: 'not json', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmp }) });
  assert.strictEqual(r.status, 0);
});
t('state stays out of the working tree', () => {
  const st = run('git', ['status', '--porcelain']).stdout;
  assert.ok(!/tandem/.test(st), st);
});

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(proj, { recursive: true, force: true });
(async () => {
  group('async');
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); annotate(name, e); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
