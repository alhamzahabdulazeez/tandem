'use strict';
/**
 * Tests for packages/tandem-check — standalone model-free risk checker (D-01).
 *
 * Assertions:
 * - Zero runtime dependencies
 * - No imports of src/adapter/, src/contracts/, src/control/, src/store/
 * - Zero network, zero API keys, zero model references
 * - CLI flags: --json, --quiet, --verify
 * - Exit codes: 0 (clean), 1 (finding), 2 (not git repo), 3 (clean unverified)
 * - Blast radius, uncovered export detection, test weakening detection
 * - Output formatting without color codes or absolute paths
 */

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..', '..', 'packages', 'tandem-check');
const BIN = path.join(PKG_ROOT, 'bin', 'check.cjs');
const checkMod = require('../../packages/tandem-check/index.cjs');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-check-test-'));
}

function initGitRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
}

function commitFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'commit ' + relPath], { cwd: dir, stdio: 'ignore' });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

module.exports = function run(t, group) {
  group('tandem-check package isolation and zero-dependency contract');

  t('package.json has zero runtime dependencies and requires node >= 18', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.name, 'tandem-check');
    assert.strictEqual(pkg.dependencies, undefined);
    assert.ok(pkg.engines && pkg.engines.node);
    assert.ok(pkg.bin && pkg.bin['tandem-check']);
  });

  t('package source contains no network, API key, model, or forbidden internal imports', () => {
    function walk(dir) {
      const files = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) files.push(...walk(full));
        else if (ent.isFile() && (ent.name.endsWith('.cjs') || ent.name.endsWith('.js') || ent.name.endsWith('.json'))) {
          files.push(full);
        }
      }
      return files;
    }

    const files = walk(PKG_ROOT);
    for (const f of files) {
      if (f.endsWith('package.json')) continue;
      const text = fs.readFileSync(f, 'utf8');

      // Zero network / API key / model references
      assert.ok(!text.includes('TANDEM_API_KEY'), `${f} must not reference TANDEM_API_KEY`);
      assert.ok(!text.includes('TANDEM_BASE_URL'), `${f} must not reference TANDEM_BASE_URL`);
      assert.ok(!text.includes('fetch('), `${f} must not call fetch()`);
      assert.ok(!text.includes('https://'), `${f} must not contain https://`);
      assert.ok(!text.includes('http://'), `${f} must not contain http://`);

      // Forbidden internal paths
      assert.ok(!text.includes('src/adapter'), `${f} must not import src/adapter`);
      assert.ok(!text.includes('src/contracts'), `${f} must not import src/contracts`);
      assert.ok(!text.includes('src/control'), `${f} must not import src/control`);
      assert.ok(!text.includes('src/store'), `${f} must not import src/store`);
    }
  });

  group('tandem-check exit codes and CLI behavior');

  t('returns exit code 2 when run outside a git repository', () => {
    const dir = makeTmpDir();
    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 2);
    assert.ok(out.includes('Cannot determine: not a git repository'));
  });

  t('returns exit code 0 on a clean git repo with no uncommitted changes', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'README.md', '# Clean Repo\n');

    const out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    assert.ok(out.includes('Clean: no uncommitted changes'));
  });

  t('returns exit code 3 on uncommitted changes without findings when --verify is omitted', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'index.js', 'console.log("hello");\n');
    writeFile(dir, 'index.js', 'console.log("world");\n');

    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 3);
    assert.ok(out.includes('Clean (unverified)'));
  });

  t('returns exit code 0 when --verify is used and tests pass', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'package.json', JSON.stringify({ name: 'demo', scripts: { test: 'node test.js' } }, null, 2));
    commitFile(dir, 'index.js', 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
    commitFile(dir, 'test.js', 'const { add } = require("./index.js");\nif (add(1, 2) !== 3) process.exit(1);\n');

    // Make an uncommitted change that keeps test passing and references add
    writeFile(dir, 'index.js', 'function add(a, b) { return (a + b); }\nmodule.exports = { add };\n');

    const out = execFileSync(process.execPath, [BIN, '--verify'], { cwd: dir, encoding: 'utf8' });
    assert.ok(out.includes('Clean: 1 file(s) changed, 0 findings, verified with tests'));
  });

  t('supports --json flag', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'index.js', 'console.log("hello");\n');
    writeFile(dir, 'index.js', 'console.log("modified");\n');

    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN, '--json'], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      out = e.stdout || '';
    }
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.isGitRepo, true);
    assert.strictEqual(parsed.exitCode, 3);
    assert.strictEqual(Array.isArray(parsed.changes), true);
  });

  t('supports --quiet flag and outputs nothing on stdout', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'index.js', 'console.log("hello");\n');
    writeFile(dir, 'index.js', 'console.log("modified");\n');

    let out = '';
    let status = 0;
    try {
      out = execFileSync(process.execPath, [BIN, '--quiet'], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 3);
    assert.strictEqual(out.trim(), '');
  });

  group('tandem-check risk detection features');

  t('detects blast radius through reverse dependency graph', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'src/util.js', 'function util() {}\nmodule.exports = { util };\n');
    commitFile(dir, 'src/app.js', 'const { util } = require("./util.js");\nmodule.exports = { app: 1 };\n');
    commitFile(dir, 'src/cli.js', 'const { util } = require("./util.js");\n');
    commitFile(dir, 'test/test.js', 'const { util } = require("../src/util.js");\nconst { app } = require("../src/app.js");\nutil();\n');

    // Modify util.js
    writeFile(dir, 'src/util.js', 'function util() { return 1; }\nmodule.exports = { util };\n');

    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      out = e.stdout || '';
    }
    assert.ok(out.includes('src/util.js (3 dependents):'), out);
    assert.ok(out.includes('src/app.js'), out);
    assert.ok(out.includes('src/cli.js'), out);
    assert.ok(out.includes('test/test.js'), out);
  });

  t('detects uncovered changes when exported symbols are unreferenced in test files', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'src/math.js', 'function add(a,b) { return a+b; }\nfunction subtract(a,b) { return a-b; }\nmodule.exports = { add, subtract };\n');
    commitFile(dir, 'test/math.test.js', 'const { add } = require("../src/math.js");\nassert.equal(add(1,2), 3);\n');

    // Change subtract which is unreferenced by any test
    writeFile(dir, 'src/math.js', 'function add(a,b) { return a+b; }\nfunction subtract(a,b) { return a - b - 0; }\nmodule.exports = { add, subtract };\n');

    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 1);
    assert.ok(out.includes("exported symbol 'subtract' is not referenced by any test file"), out);
    assert.ok(out.includes('Verdict: Finding: 1 issue(s) detected'), out);
  });

  t('detects test weakening: test skips (.skip, xit)', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'src/auth.js', 'function login() { return true; }\nmodule.exports = { login };\n');
    commitFile(dir, 'test/auth.test.js', 'const { login } = require("../src/auth.js");\nit("logs in", () => { assert.ok(login()); });\n');

    // Add .skip to the test
    writeFile(dir, 'test/auth.test.js', 'const { login } = require("../src/auth.js");\nit.skip("logs in", () => { assert.ok(login()); });\n');

    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 1);
    assert.ok(out.includes('added test skip (.skip or xit)'), out);
  });

  t('detects test weakening: removed assertions without replacement', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'src/calc.js', 'function calc() { return 42; }\nmodule.exports = { calc };\n');
    commitFile(dir, 'test/calc.test.js', 'const { calc } = require("../src/calc.js");\nassert.equal(calc(), 42);\nassert.ok(calc() > 0);\nassert.strictEqual(typeof calc(), "number");\n');

    // Remove two assertions
    writeFile(dir, 'test/calc.test.js', 'const { calc } = require("../src/calc.js");\nassert.equal(calc(), 42);\n');

    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 1);
    assert.ok(out.includes('removed 2 assertion(s) without replacement'), out);
  });

  t('detects test weakening: deleted test file', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'src/foo.js', 'function foo() {}\nmodule.exports = { foo };\n');
    commitFile(dir, 'test/foo.test.js', 'const { foo } = require("../src/foo.js");\nfoo();\n');

    fs.unlinkSync(path.join(dir, 'test', 'foo.test.js'));

    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      status = e.status;
      out = e.stdout || '';
    }
    assert.strictEqual(status, 1);
    assert.ok(out.includes('test file was deleted'), out);
  });

  t('output contains no color codes and no absolute paths', () => {
    const dir = makeTmpDir();
    initGitRepo(dir);
    commitFile(dir, 'index.js', 'console.log("a");\n');
    writeFile(dir, 'index.js', 'console.log("b");\n');

    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN], { cwd: dir, encoding: 'utf8' });
    } catch (e) {
      out = e.stdout || '';
    }

    // No ANSI escape codes (\u001b[...)
    assert.ok(!/\u001b\[/.test(out), 'Output must not contain ANSI escape codes');
    // No absolute paths
    assert.ok(!out.includes(dir), 'Output must not contain absolute paths');
  });

  group('tandem-check exported library API');

  t('exports public API functions and helpers', () => {
    assert.strictEqual(typeof checkMod.check, 'function');
    assert.strictEqual(typeof checkMod.formatReport, 'function');
    assert.strictEqual(typeof checkMod.inspect, 'function');
    assert.strictEqual(typeof checkMod.walk, 'function');
    assert.strictEqual(typeof checkMod.reportContentDigest, 'function');
    assert.strictEqual(typeof checkMod.depgraph, 'object');
    assert.strictEqual(typeof checkMod.depgraph.build, 'function');
    assert.strictEqual(typeof checkMod.depgraph.dependentsOf, 'function');
    assert.strictEqual(typeof checkMod.depgraph.dependentCount, 'function');
    assert.strictEqual(typeof checkMod.depgraph.extractImports, 'function');
    assert.strictEqual(typeof checkMod.depgraph.resolveRelative, 'function');

    const checkLib = require('../../packages/tandem-check/lib/check.cjs');
    assert.strictEqual(typeof checkLib.isGitRepository, 'function');
    assert.strictEqual(typeof checkLib.getChanges, 'function');
    assert.strictEqual(typeof checkLib.getDiffText, 'function');
    assert.strictEqual(typeof checkLib.computeBlastRadius, 'function');
    assert.strictEqual(typeof checkLib.findUncoveredChanges, 'function');
    assert.strictEqual(typeof checkLib.findTestWeakening, 'function');
    assert.strictEqual(typeof checkLib.runVerify, 'function');

    const inspectLib = require('../../packages/tandem-check/lib/inspect.cjs');
    assert.strictEqual(typeof inspectLib.CHECKER_VERSION, 'number');
  });
};
