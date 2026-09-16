'use strict';
/**
 * Tests for src/contracts/crypto.js — deterministic content hashing (PRD §6, §20).
 */

const assert = require('node:assert');
const C = require('../../src/contracts/crypto.js');

module.exports = function run(t, group) {
  group('canonicalJson');

  t('object keys are sorted deterministically', () => {
    const a = C.canonicalJson({ b: 1, a: 2, c: 3 });
    const b = C.canonicalJson({ c: 3, b: 1, a: 2 });
    assert.strictEqual(a, b);
    assert.strictEqual(a, '{"a":2,"b":1,"c":3}');
  });

  t('nested objects sort recursively', () => {
    assert.strictEqual(
      C.canonicalJson({ z: { y: 1, x: 2 }, m: [3, 2, 1] }),
      C.canonicalJson({ m: [3, 2, 1], z: { x: 2, y: 1 } }));
  });

  t('array order is preserved', () => {
    assert.notStrictEqual(C.canonicalJson([1, 2]), C.canonicalJson([2, 1]));
  });

  t('undefined values are dropped', () => {
    assert.strictEqual(C.canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  });

  t('NaN and Infinity are rejected (fail closed)', () => {
    assert.throws(() => C.canonicalJson({ a: NaN }), /non-finite/);
    assert.throws(() => C.canonicalJson({ a: Infinity }), /non-finite/);
  });

  t('circular references are rejected', () => {
    const o = { a: {} };
    o.a.self = o;
    assert.throws(() => C.canonicalJson(o), /circular/);
  });

  group('sha256 and contentId');

  t('sha256 of an empty string matches the known vector', () => {
    assert.strictEqual(C.sha256(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  t('sha256 is deterministic', () => {
    assert.strictEqual(C.sha256('hello world'), C.sha256('hello world'));
    assert.notStrictEqual(C.sha256('hello world'), C.sha256('hello worlD'));
  });

  t('contentId is prefixed with sha256: and is 71 chars', () => {
    const id = C.contentId('abc');
    assert.ok(C.isContentId(id));
    assert.strictEqual(id.length, 71); // 7 + 64
  });

  t('contentId equal bytes => equal id; different bytes => different id', () => {
    assert.strictEqual(C.contentId('same'), C.contentId('same'));
    assert.notStrictEqual(C.contentId('same'), C.contentId('diff'));
  });

  t('contentId accepts Buffers directly', () => {
    assert.strictEqual(C.contentId(Buffer.from('abc', 'utf8')), C.contentId('abc'));
  });

  t('contentId rejects non-string non-Buffer input', () => {
    assert.throws(() => C.contentId(42), /expected a string or Buffer/);
    assert.throws(() => C.contentId(NaN), /expected a string or Buffer/);
    assert.throws(() => C.contentId(null), /expected a string or Buffer/);
    assert.throws(() => C.contentId(undefined), /expected a string or Buffer/);
  });

  t('isContentId rejects malformed ids', () => {
    assert.strictEqual(C.isContentId('sha256:zzzz'), false);
    assert.strictEqual(C.isContentId('x' + '0'.repeat(64)), false);
    assert.strictEqual(C.isContentId('sha256:' + '0'.repeat(63)), false);
    assert.strictEqual(C.isContentId(undefined), false);
  });

  group('manifest');

  t('manifest sorts entries by path regardless of input order', () => {
    const m = C.manifest([
      { path: 'b.js', contentId: C.contentId('b') },
      { path: 'a.js', contentId: C.contentId('a') },
    ]);
    assert.strictEqual(m.entries[0].path, 'a.js');
    assert.strictEqual(m.entries[1].path, 'b.js');
  });

  t('manifest digest is deterministic for equivalent entry sets', () => {
    const m1 = C.manifest([{ path: 'x', contentId: C.contentId('c') }]);
    const m2 = C.manifest([{ path: 'x', contentId: C.contentId('c') }]);
    assert.strictEqual(m1.entriesDigest, m2.entriesDigest);
  });

  t('manifest digest changes when content changes', () => {
    const m1 = C.manifest([{ path: 'x', contentId: C.contentId('c1') }]);
    const m2 = C.manifest([{ path: 'x', contentId: C.contentId('c2') }]);
    assert.notStrictEqual(m1.entriesDigest, m2.entriesDigest);
  });

  t('manifest rejects duplicate paths', () => {
    assert.throws(() => C.manifest([
      { path: 'a', contentId: C.contentId('1') },
      { path: 'a', contentId: C.contentId('2') },
    ]), /duplicate path/);
  });

  t('manifest rejects an entry with a malformed contentId', () => {
    assert.throws(() => C.manifest([{ path: 'a', contentId: 'sha256:nope' }]), /invalid contentId/);
  });

  t('manifest rejects an entry with a non-string path', () => {
    assert.throws(() => C.manifest([{ path: '', contentId: C.contentId('c') }]), /non-empty string/);
  });

  t('manifest counts the entries', () => {
    const m = C.manifest([
      { path: 'a', contentId: C.contentId('1') },
      { path: 'b', contentId: C.contentId('2') },
      { path: 'c', contentId: C.contentId('3') },
    ]);
    assert.strictEqual(m.count, 3);
  });

  t('manifest preserves explicit mode and size fields', () => {
    const m = C.manifest([{ path: 'a', contentId: C.contentId('x'), mode: 0o100644, size: 3 }]);
    assert.strictEqual(m.entries[0].mode, 0o100644);
    assert.strictEqual(m.entries[0].size, 3);
  });

  t('manifest permits null mode/size (caller-owned missing data stays missing)', () => {
    const m = C.manifest([{ path: 'a', contentId: null, mode: null, size: null }]);
    assert.strictEqual(m.count, 1);
    assert.strictEqual(m.entries[0].size, null);
  });
};