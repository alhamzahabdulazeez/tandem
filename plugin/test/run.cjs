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
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
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
t('loop: 3rd identical repeat is blocked', () => assert.strictEqual(B('npm test', { repeats: 3 }).rule, 'loop'));
t('loop: 2nd repeat is still allowed', () => assert.notStrictEqual(B('npm test', { repeats: 2 }).decision, 'deny'));

// ------------------------------------------------------------ verify ------
group('verification helpers');
t('failure signature ignores timings', () => assert.strictEqual(V.failSignature('FAIL a 12ms\nok'), V.failSignature('FAIL a 40ms\nok')));
t('summary keeps the failing lines', () => assert.match(V.summarize('ok 1\nnot ok 2 - adds\nok 3'), /not ok 2/));

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
t('Stop allows and writes a receipt once tests pass', () => {
  hook('UserPromptSubmit', { prompt: 'make add.js support three numbers' });
  fs.writeFileSync(path.join(tmp, 'add.js'), 'module.exports = (a, b, c = 0) => a + b + c;\n');
  const r = hook('Stop', {});
  assert.ok(!r.json.decision);
  assert.match(r.json.systemMessage, /verified/);
  assert.ok(fs.existsSync(path.join(tmp, '.git', 'tandem', 'last-receipt.md')));
});
t('Stop catches a test weakened through the shell', () => {
  hook('UserPromptSubmit', { prompt: 'change add.js' });
  fs.writeFileSync(path.join(tmp, 'test', 'add.test.js'), "console.log('ok');\n");
  const r = hook('Stop', {});
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /changed or weakened/);
  run('git', ['checkout', '--', 'test/add.test.js']);
});
t('Stop is silent when nothing changed', () => {
  run('git', ['add', '-A']); run('git', ['commit', '-qm', 'two']);
  hook('UserPromptSubmit', { prompt: 'explain add.js' });
  const r = hook('Stop', {});
  assert.strictEqual(r.json, null);
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
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
