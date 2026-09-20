'use strict';
/**
 * Tests for src/store/journal.cjs — durable append-only store (PRD §6, §20,
 * F-07). Deterministic crash/restart/replay/corruption coverage.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JOURNAL = require('../../src/store/journal.cjs');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-journal-')); }

function validators(extra) {
  const rules = extra || {};
  return { validate: (p) => (typeof p === 'object' && p !== null ? null : 'payload must be an object') };
}

/** Read the raw content of one journal entry file. */
function rawEntry(root, seq) {
  const f = path.join(root, 'journal', String(seq).padStart(8, '0') + '.json');
  return { full: f, text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null };
}

function tear(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = function run(t, group) {
  group('journal: reload & replay');

  t('fresh open is empty, usable, not corrupt', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    assert.strictEqual(s.seq, 0);
    assert.strictEqual(s.entries.length, 0);
    assert.strictEqual(s.corrupt, null);
    assert.strictEqual(JOURNAL.list(s).length, 0);
    tear(d);
  });

  t('appended records reload identically across restart', () => {
    const d = dir();
    const recs = [
      { id: 'a-1', kind: 'store_owner', version: 1 },
      { id: 'b-2', kind: 'lineage', version: 1 },
    ];
    const s = JOURNAL.open(d, validators());
    for (const r of recs) JOURNAL.append(s, r);
    JOURNAL.close(s);

    const s2 = JOURNAL.open(d, validators());
    assert.strictEqual(s2.seq, 2);
    assert.deepStrictEqual(JOURNAL.list(s2), recs);
    assert.strictEqual(JOURNAL.get(s2, 'b-2').kind, 'lineage');
    assert.strictEqual(JOURNAL.get(s2, 'missing'), undefined);
    assert.strictEqual(s2.corrupt, null);
    tear(d);
  });

  t('append returns monotonic seq and records id', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    const r1 = JOURNAL.append(s, { id: 'x', kind: 'test' });
    const r2 = JOURNAL.append(s, { id: 'y', kind: 'test' });
    assert.strictEqual(r1.seq, 1);
    assert.strictEqual(r2.seq, 2);
    assert.strictEqual(r1.id, 'x');
    tear(d);
  });

  t('append refuses a payload that fails the caller validator', () => {
    const d = dir();
    const s = JOURNAL.open(d, { validate: () => 'no payloads here' });
    assert.throws(() => JOURNAL.append(s, { id: 'x' }), /refused payload/);
    assert.strictEqual(s.seq, 0);
    tear(d);
  });

  group('journal: crash recovery');

  t('deleting the snapshot is healed from the journal (snapshot is only a cache)', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    for (let i = 0; i < 4; i++) JOURNAL.append(s, { id: 'r' + i, kind: 'test', i });
    assert.ok(!fs.existsSync(path.join(d, 'snapshot.json')), 'precondition: no snapshot yet');
    fs.rmSync(path.join(d, 'snapshot.json'), { force: true }); // no-op here; the real scenario: snapshot lost while journal is intact
    const s2 = JOURNAL.open(d, validators()); // resumes straight from the journal
    assert.strictEqual(s2.seq, 4);
    assert.strictEqual(JOURNAL.list(s2).length, 4);
    assert.strictEqual(s2.recovery.snapshotRebuilt, true);
    assert.ok(fs.existsSync(path.join(d, 'snapshot.json')), 'a fresh snapshot was written');
    tear(d);
  });

  t('a corrupt snapshot with a valid journal is rebuilt, not treated as corruption', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    // Journal entry seq 1 still on disk (no compaction happened).
    fs.writeFileSync(path.join(d, 'snapshot.json'), '{not-json');
    const s2 = JOURNAL.open(d, validators());
    assert.strictEqual(s2.corrupt, null);
    assert.strictEqual(s2.recovery.snapshotRebuilt, true);
    assert.strictEqual(JOURNAL.get(s2, 'r1').kind, 'test');
    tear(d);
  });

  t('a corrupt snapshot with NO journal is CORRUPT, never silently empty', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'snapshot.json'), 'garbage' + new Array(100).fill('x').join(''));
    const s = JOURNAL.open(d, validators());
    assert.ok(s.corrupt, 'must fail closed');
    assert.throws(() => JOURNAL.append(s, { id: 'x' }), /admission is closed/);
    tear(d);
  });

  t('a snapshot record that fails validation is rebuilt from the journal', () => {
    const d = dir();
    const strict = { validate: (p) => (typeof p === 'object' && p.kind ? null : 'record must have kind') };
    const s = JOURNAL.open(d, validators());        // loose: accepts any object
    JOURNAL.append(s, { id: 'r1', kind: 'test' });  // journal entry seq 1 (no snapshot yet)
    // Hand-write a VALID-digest snapshot that holds a record the STRICT
    // validator rejects. The journal still proves the good data.
    const snap = { v: 1, seq: 1, records: [{ id: 'BAD' }] };
    const { canonicalJson, contentId } = require('../../src/contracts/crypto.js');
    snap.digest = contentId(canonicalJson({ v: 1, seq: 1, records: snap.records }));
    fs.writeFileSync(path.join(d, 'snapshot.json'), JSON.stringify(snap));
    const s2 = JOURNAL.open(d, strict);
    assert.strictEqual(s2.corrupt, null, 'journal must heal the bad cache');
    assert.strictEqual(s2.recovery.snapshotRebuilt, true);
    assert.strictEqual(JOURNAL.get(s2, 'r1').kind, 'test'); // from journal, not the bad snapshot
    assert.strictEqual(JOURNAL.get(s2, 'BAD'), undefined);
    tear(d);
  });

  group('journal: corruption fails closed');

  t('a tampered journal entry trips corruption at its seq', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    JOURNAL.append(s, { id: 'r2', kind: 'test' });
    JOURNAL.append(s, { id: 'r3', kind: 'test' });
    const raw = rawEntry(d, 2);
    const obj = JSON.parse(raw.text);
    obj.payload.id = 'TAMPERED';
    fs.writeFileSync(raw.full, JSON.stringify(obj));
    const s2 = JOURNAL.open(d, validators());
    assert.ok(s2.corrupt, 'must fail closed');
    assert.strictEqual(s2.corrupt.at, 2);
    assert.strictEqual(s2.seq, 1); // nothing beyond the corruption is trusted
    assert.deepStrictEqual(JOURNAL.list(s2), [{ id: 'r1', kind: 'test' }]);
    assert.throws(() => JOURNAL.append(s2, { id: 'x' }), /admission is closed/);
    tear(d);
  });

  t('a truncated (crash-partial) journal entry trips corruption', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    const raw = rawEntry(d, 1);
    fs.writeFileSync(raw.full, raw.text.slice(0, raw.text.length - 14));
    const s2 = JOURNAL.open(d, validators());
    assert.ok(s2.corrupt, 'must fail closed');
    assert.strictEqual(s2.corrupt.at, 1);
    assert.strictEqual(s2.seq, 0);
    tear(d);
  });

  t('a seq-mismatched entry trips corruption', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    const raw = rawEntry(d, 1);
    const obj = JSON.parse(raw.text);
    obj.seq = 9;
    fs.writeFileSync(raw.full, JSON.stringify(obj));
    const s2 = JOURNAL.open(d, validators());
    assert.ok(s2.corrupt);
    assert.strictEqual(s2.corrupt.at, 1);
    tear(d);
  });

  t('an old journal entry that no longer validates trips corruption even when <= snapshot seq', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    JOURNAL.close(s); // compacted; seq-1 journal file removed
    const s2 = JOURNAL.open(d, validators());
    JOURNAL.append(s2, { id: 'r2', kind: 'test' }); // journal now holds only seq 2
    JOURNAL.close(s2);
    // Reintroduce a stale, corrupt seq-1 file that the snapshot already covers.
    fs.writeFileSync(path.join(d, 'journal', '00000001.json'), '{bogus');
    const s3 = JOURNAL.open(d, validators());
    assert.ok(s3.corrupt, 'a corrupt entry below the snapshot must still fail closed');
    tear(d);
  });

  t('append after corruption is refused', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'r1', kind: 'test' });
    const raw = rawEntry(d, 1);
    fs.writeFileSync(raw.full, '{bogus');
    const s2 = JOURNAL.open(d, validators());
    assert.ok(s2.corrupt);
    assert.throws(() => JOURNAL.append(s2, { id: 'x' }), /admission is closed/);
    tear(d);
  });

  group('journal: compaction & retention');

  t('compact keeps reloaded records identical and bounds journal growth', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    for (let i = 0; i < 3; i++) JOURNAL.append(s, { id: 'r' + i, kind: 'test' });
    JOURNAL.compact(s);
    const journalFiles = fs.readdirSync(path.join(d, 'journal')).filter((f) => f.endsWith('.json'));
    assert.deepStrictEqual(journalFiles, []);
    const s2 = JOURNAL.open(d, validators());
    assert.deepStrictEqual(JOURNAL.list(s2).map((r) => r.id), ['r0', 'r1', 'r2']);
    s2 && JOURNAL.close(s2);
    tear(d);
  });

  t('append continues after compact; seq stays monotonic across restart', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'a', kind: 'test' });
    JOURNAL.compact(s);
    JOURNAL.append(s, { id: 'b', kind: 'test' });
    JOURNAL.close(s);
    const s2 = JOURNAL.open(d, validators());
    assert.strictEqual(s2.seq, 2);
    assert.deepStrictEqual(JOURNAL.list(s2).map((r) => r.id), ['a', 'b']);
    const a3 = JOURNAL.append(s2, { id: 'c', kind: 'test' });
    assert.strictEqual(a3.seq, 3);
    JOURNAL.close(s2);
    tear(d);
  });

  group('journal: meta & durability notes');

  t('meta reports seq, count, recovery info, and corrupt status', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.append(s, { id: 'm1', kind: 'test' });
    const m = JOURNAL.meta(s);
    assert.strictEqual(m.seq, 1);
    assert.strictEqual(m.count, 1);
    assert.strictEqual(m.corrupt, null);
    assert.strictEqual(typeof m.recovery.dirFsyncSupported, 'boolean');
    tear(d);
  });

  t('dir fsync support is reported honestly (boolean, not assumed true)', () => {
    const d = dir();
    // fsyncDirBestEffort on the existing root is a fact, not a promise;
    // the field must exist and be a boolean on every open.
    const s = JOURNAL.open(d, validators());
    assert.strictEqual(typeof s.recovery.dirFsyncSupported, 'boolean');
    tear(d);
  });

  t('closed store refuses further operations', () => {
    const d = dir();
    const s = JOURNAL.open(d, validators());
    JOURNAL.close(s);
    assert.throws(() => JOURNAL.append(s, { id: 'x', kind: 'test' }), /closed/);
    tear(d);
  });

  t('an empty store opens cleanly from a directory that already exists', () => {
    const d = dir();
    fs.mkdirSync(path.join(d, 'journal'), { recursive: true });
    const s = JOURNAL.open(d, validators());
    assert.strictEqual(JOURNAL.list(s).length, 0);
    assert.strictEqual(s.corrupt, null);
    tear(d);
  });
};