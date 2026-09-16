'use strict';
/**
 * CLI tests for `tandem check` — verification that the dispatcher wires the
 * honest checker and that no unsafe execution is launched (PRD §22, F-05).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'tandem.cjs');

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-check-cli-'));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

module.exports = function run(t, group) {
  group('tandem check CLI');

  t('`tandem check` inspects a clean tree and exits 0', () => {
    const dir = makeDir();
    write(dir, 'src/a.js', 'export const a = 1;\n');
    write(dir, 'src/b.js', 'export const b = 2;\n');
    const out = execFileSync(process.execPath, [BIN, 'check'], { cwd: dir, encoding: 'utf8' });
    assert.ok(out.includes('files read       2'), out);
    assert.ok(out.includes('complete capture yes'), out);
    assert.ok(out.includes('supervised execution: UNAVAILABLE'), out);
  });

  t('`tandem check` does not claim prevention or execution', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'x');
    const out = execFileSync(process.execPath, [BIN, 'check'], { cwd: dir, encoding: 'utf8' });
    assert.ok(out.includes('executed               no'), out);
    assert.ok(out.includes('prevented anything     no'), out);
  });

  t('`tandem check` surfaces unsupported shapes and exits 1 (no false PASS)', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'x');
    fs.symlinkSync(path.join(dir, 'a.js'), path.join(dir, 'link.js'));
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [BIN, 'check'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status;
      out = String(e.stdout || '');
    }
    assert.strictEqual(code, 1); // unsupported shapes => checker does not claim a clean capture
    assert.ok(out.includes('unsupported      1 shape'), out);
    assert.ok(out.includes('complete capture no'), out);
  });

  t('`tandem check` on a missing explicit path refuses with a non-zero exit', () => {
    const cwd = makeDir();
    const missing = path.join(cwd, 'missing');
    let code = 0;
    let err = '';
    try {
      execFileSync(process.execPath, [BIN, 'check', missing], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = e.status;
      err = String(e.stderr || '');
    }
    assert.strictEqual(code, 2);
    assert.ok(/could not inspect/.test(err), err);
  });

  t('`tandem check` accepts an explicit path argument', () => {
    const cwd = makeDir();
    const sub = path.join(cwd, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    write(sub, 'x.js', '1');
    const out = execFileSync(process.execPath, [BIN, 'check', 'sub'], { cwd, encoding: 'utf8' });
    assert.ok(out.includes('files read       1'), out);
  });
};