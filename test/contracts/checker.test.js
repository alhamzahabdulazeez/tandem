'use strict';
/**
 * Tests for src/check/checker.cjs — honest non-executing `tandem check`
 * (PRD §22, F-05 checker honesty; R-05a).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CHECK = require('../../src/check/checker.cjs');

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-check-'));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

module.exports = function run(t, group) {
  group('basic inspection');

  t('a plain tree reports a manifest with one entry per file', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'aaa');
    write(dir, 'b.js', 'bbb');
    const r = CHECK.inspect(dir);
    assert.strictEqual(r.manifest.count, 2);
    assert.strictEqual(r.scope.filesRead, 2);
    assert.strictEqual(r.scope.filesSkipped, 0);
    assert.strictEqual(r.scope.totalBytesRead, 6);
  });

  t('the manifest digest is deterministic across runs', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'hello');
    const r1 = CHECK.inspect(dir);
    const r2 = CHECK.inspect(dir);
    assert.strictEqual(r1.manifest.entriesDigest, r2.manifest.entriesDigest);
  });

  t('the manifest digest changes when file content changes', () => {
    const dir = makeDir();
    const p = write(dir, 'a.js', 'one');
    const r1 = CHECK.inspect(dir);
    fs.writeFileSync(p, 'two');
    const r2 = CHECK.inspect(dir);
    assert.notStrictEqual(r1.manifest.entriesDigest, r2.manifest.entriesDigest);
  });

  t('an empty directory yields a zero-entry manifest with a stable digest', () => {
    const dir = makeDir();
    const r1 = CHECK.inspect(dir);
    const r2 = CHECK.inspect(dir);
    assert.strictEqual(r1.manifest.count, 0);
    assert.strictEqual(r1.manifest.entriesDigest, r2.manifest.entriesDigest);
    assert.strictEqual(r1.scope.filesRead, 0);
  });

  group('honesty block');

  t('the report never claims execution, prevention, or supervision', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'x');
    const r = CHECK.inspect(dir);
    assert.strictEqual(r.claims.executed, false);
    assert.strictEqual(r.claims.preventedAnything, false);
    assert.strictEqual(r.claims.supervisedExecution, false);
  });

  t('completeCapture is true when nothing was skipped', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'x');
    const r = CHECK.inspect(dir);
    assert.strictEqual(r.claims.completeCapture, true);
  });

  t('completeCapture is false when the walk was truncated', () => {
    const dir = makeDir();
    write(dir, 'big.bin', 'x'.repeat(4096));
    const r = CHECK.inspect(dir, { maxFileBytes: 100 });
    assert.strictEqual(r.claims.completeCapture, false);
    assert.strictEqual(r.scope.truncated, true);
  });

  t('completeCapture is false when enumeration stopped at the file bound', () => {
    const dir = makeDir();
    for (let i = 0; i < 5; i++) write(dir, `f${i}.js`, 'x');
    const r = CHECK.inspect(dir, { maxFiles: 3 });
    assert.strictEqual(r.claims.completeCapture, false);
    assert.strictEqual(r.scope.enumerationStopped, true);
  });

  group('unsupported shapes');

  t('a symlink is reported unsupported and never followed', () => {
    const dir = makeDir();
    write(dir, 'real.js', 'secret');
    fs.symlinkSync(path.join(dir, 'real.js'), path.join(dir, 'link.js'));
    const r = CHECK.inspect(dir);
    assert.ok(r.unsupported.some((u) => u.path === 'link.js' && u.kind === 'symlink'));
    // The underlying file is still enumerated independently.
    assert.ok(r.manifest.entries.some((e) => e.path === 'real.js'));
    assert.strictEqual(r.claims.completeCapture, false);
  });

  t('a gitfile (.git as a file) is reported as a linked-worktree shape', () => {
    const dir = makeDir();
    write(dir, '.git', 'gitdir: /somewhere/else.git\n');
    const r = CHECK.inspect(dir);
    assert.ok(r.unsupported.some((u) => u.kind === 'gitfile' && /worktree/.test(u.reason)));
    assert.strictEqual(r.claims.completeCapture, false);
  });

  t('a .gitmodules file is reported as a submodule indicator', () => {
    const dir = makeDir();
    write(dir, '.gitmodules', '[submodule "dep"]\n  path = dep\n');
    fs.mkdirSync(path.join(dir, '.git'));
    const r = CHECK.inspect(dir);
    assert.ok(r.unsupported.some((u) => u.kind === 'gitmodules'));
  });

  t('a normal .git directory does not count as unsupported', () => {
    const dir = makeDir();
    fs.mkdirSync(path.join(dir, '.git'));
    const r = CHECK.inspect(dir);
    assert.ok(!r.unsupported.some((u) => u.kind === 'gitdir'));
  });

  t('.git internal objects are excluded from the manifest by default (§11)', () => {
    const dir = makeDir();
    write(dir, 'src/a.js', 'source');
    fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
    write(dir, '.git/objects/pack.pack', 'BINARYGITDATA');
    const r = CHECK.inspect(dir);
    assert.strictEqual(r.manifest.count, 1); // only src/a.js
    assert.ok(r.excludedDirectories.includes('.git'));
    assert.strictEqual(r.repoShape, 'gitdir');
    assert.strictEqual(r.claims.completeCapture, true); // intentional exclusion, not a truncation
  });

  t('excludeDotGit: false walks .git contents', () => {
    const dir = makeDir();
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    write(dir, '.git/HEAD', 'ref: refs/heads/main\n');
    const r = CHECK.inspect(dir, { excludeDotGit: false });
    assert.strictEqual(r.manifest.count, 1);
    assert.deepStrictEqual(r.excludedDirectories, []);
  });

  t('an oversized file is flagged, not read', () => {
    const dir = makeDir();
    write(dir, 'big.bin', 'x'.repeat(2048));
    const r = CHECK.inspect(dir, { maxFileBytes: 16 });
    assert.ok(r.unsupported.some((u) => u.path === 'big.bin' && /exceeds/.test(u.reason)));
    assert.strictEqual(r.scope.filesSkipped, 1);
    assert.strictEqual(r.scope.filesRead, 0);
  });

  group('error handling');

  t('a non-directory root throws', () => {
    const dir = makeDir();
    const f = write(dir, 'x.js', 'x');
    assert.throws(() => CHECK.inspect(f), /not a directory/);
  });

  t('a missing root throws', () => {
    assert.throws(() => CHECK.inspect(path.join(makeDir(), 'nope')), /ENOENT/);
  });

  t('walk rejects a non-string root', () => {
    assert.throws(() => CHECK.walk(42), /root must be a non-empty path string/);
  });

  group('helper exports');

  t('reportContentDigest is the manifest entriesDigest', () => {
    const dir = makeDir();
    write(dir, 'a.js', 'x');
    const r = CHECK.inspect(dir);
    assert.strictEqual(CHECK.reportContentDigest(r), r.manifest.entriesDigest);
  });

  t('the checker module exports the shape markers', () => {
    for (const k of ['FILE', 'DIRECTORY', 'SYMLINK', 'SPECIAL', 'GITFILE', 'GITMODULES', 'GITDIR']) {
      assert.ok(typeof CHECK.SHAPE[k] === 'string', k);
    }
  });
};