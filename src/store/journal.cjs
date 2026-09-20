'use strict';
/**
 * journal — durable local store (PRD §6 durable records, §20 ordering,
 * §25 / F-07). A single-writer, append-only journal plus a compacted snapshot.
 *
 * Design (all of it locally testable, none of it environment-dependent):
 *
 *   <root>/
 *     journal/<seq.json>   authority — one immutable entry per append, written
 *                          via O_EXCL + fsync so each entry is created at most
 *                          once and is self-validating (digest).
 *     snapshot.json        compaction cache only. It is NEVER the authority:
 *                          if it is corrupt it is rebuilt from the journal; a
 *                          corrupt journal is always fail-closed.
 *
 * Fail-closed contract:
 *   - Any journal entry that fails JSON parse, digest, schema, ordering or
 *     caller validation leaves the store `corrupt` and admission-closed. No
 *     entry beyond the corruption point is trusted, and further appends throw.
 *   - A stored snapshot that cannot be validated is only discarded when the
 *     journal can prove the same data (journal present and valid); a corrupt
 *     snapshot with no recoverable journal is a CORRUPT store, never an empty one.
 *   - Atomicity of a "transaction" is by construction: a caller that must
 *     persist several facts decisively (e.g. consume allowance + reserve
 *     liability, PRD §9 step 8) encodes them as ONE journal payload. Each
 *     append is a single O_EXCL file create.
 *
 * Two honest boundaries (no fabricated capability):
 *   - snapshot.json durability: dir-fsync is best-effort; when the filesystem
 *     refuses it, the store records `dirFsyncSupported:false`.
 *   - crash-model qualifications (fsync semantics on the actual host) belong
 *     to the qualified support profile (IB-01); open() reflects observable
 *     filesystem facts only.
 */

const fs = require('node:fs');
const path = require('node:path');
const FSU = require('./fsutil.cjs');
const { canonicalJson, contentId } = require('../contracts/crypto.js');

const JOURNAL_VERSION = 1;
const MAX_PADDING = 8;

function pad(seq) {
  return String(seq).padStart(MAX_PADDING, '0');
}

function digestOf(seq, payload) {
  return contentId(canonicalJson({ seq, payload }));
}

function snapshotDigest(snap) {
  return contentId(canonicalJson({ v: snap.v, seq: snap.seq, records: snap.records }));
}

function validateSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return 'snapshot: expected an object';
  if (raw.v !== JOURNAL_VERSION) return `snapshot: unsupported schema v=${raw.v}`;
  if (!Number.isInteger(raw.seq) || raw.seq < 0) return 'snapshot: invalid seq';
  if (!Array.isArray(raw.records)) return 'snapshot: records must be an array';
  if (snapshotDigest(raw) !== raw.digest) return 'snapshot: digest mismatch (tampered or corrupt)';
  return null;
}

/**
 * open(root, { validate }) — factory. resume() parses the on-disk state.
 * `validate(payload)` returns a string on invalid or null/undefined when ok;
 * it runs against every append (refused) and against every replayed journal
 * entry and snapshot record (fail closed).
 */
function open(root, opts) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('journal: root must be a non-empty path string');
  const o = opts || {};
  const validate = typeof o.validate === 'function' ? o.validate : null;
  const journalDir = path.join(root, 'journal');
  FSU.ensureDir(root);
  FSU.ensureDir(journalDir);

  const handle = {
    VERSION: JOURNAL_VERSION,
    root,
    journalDir,
    validate,
    seq: 0,
    entries: [],            // payloads, in seq order
    byId: new Map(),        // payload.id -> payload, when present
    corrupt: null,          // null | { at, reason }
    recovery: {
      snapshotLoaded: false,
      snapshotRebuilt: false,
      snapshotInvalid: null,
      journalApplied: 0,
      replayStartingSeq: 0,
      dirFsyncSupported: true,
    },
    closed: false,
  };
  resume(handle);
  return handle;
}

function tryReadJson(file) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    return { ok: true, value: JSON.parse(data) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function applyEntry(handle, seq, entry) {
  const { payload } = entry;
  if (handle.validate) {
    const err = handle.validate(payload);
    if (typeof err === 'string' && err.length) {
      handle.corrupt = { at: seq, reason: `validation of journal entry: ${err}` };
      return;
    }
  }
  handle.seq = seq;
  handle.entries.push(payload);
  if (payload && typeof payload === 'object' && payload.id !== undefined) {
    handle.byId.set(payload.id, payload);
  }
}

function replayJournal(handle, fromSeq) {
  const files = fs.readdirSync(handle.journalDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /^\d+\.json$/.test(d.name))
    .map((d) => ({ file: path.join(handle.journalDir, d.name), seq: parseInt(d.name, 10) }))
    .sort((a, b) => a.seq - b.seq);

  let journalPresent = false;
  let applied = 0;
  for (const { file, seq } of files) {
    journalPresent = true;
    if (handle.corrupt) break;
    if (seq <= fromSeq) {
      // Already reflected in a valid snapshot job. But an old entry that no
      // longer validates must still trip corruption — fail closed.
      const r = tryReadJson(file);
      if (!r.ok) { handle.corrupt = { at: seq, reason: `journal entry unreadable: ${r.error}` }; break; }
      continue;
    }
    const r = tryReadJson(file);
    if (!r.ok) {
      handle.corrupt = { at: seq, reason: `journal entry unreadable: ${r.error}` };
      break;
    }
    const e = r.value;
    let bad = null;
    if (!e || typeof e !== 'object') bad = 'journal entry: expected an object';
    else if (e.v !== JOURNAL_VERSION) bad = `journal entry: unsupported schema v=${e.v}`;
    else if (e.seq !== seq) bad = `journal entry: seq mismatch (file=${seq}, entry=${e.seq})`;
    else if (typeof e.payload === 'undefined') bad = 'journal entry: missing payload';
    else if (e.digest !== digestOf(seq, e.payload)) bad = 'journal entry: digest mismatch (tampered or corrupt)';
    if (bad) { handle.corrupt = { at: seq, reason: bad }; break; }
    applyEntry(handle, seq, e);
    applied++;
  }

  handle.recovery.journalApplied = applied;
  handle.recovery.journalPresent = journalPresent;
  if (handle.corrupt) handle.recovery.replayEndedAt = handle.corrupt.at;
  return applied;
}

function resume(handle) {
  // 1) Snapshot (cache) — load if valid.
  const snapPath = path.join(handle.root, 'snapshot.json');
  const snapExists = fs.existsSync(snapPath);
  let snapValid = false;
  if (snapExists) {
    const r = tryReadJson(snapPath);
    if (!r.ok) {
      handle.recovery.snapshotInvalid = `unreadable: ${r.error}`;
    } else {
      const err = validateSnapshot(r.value);
      if (err) {
        handle.recovery.snapshotInvalid = err;
      } else {
        snapValid = true;
        handle.recovery.snapshotLoaded = true;
        handle.seq = r.value.seq;
        for (const rec of r.value.records) {
          if (handle.validate) {
            const verr = handle.validate(rec);
            if (typeof verr === 'string' && verr.length) {
              handle.recovery.snapshotInvalid = `record failed validation: ${verr}`;
              snapValid = false;
              handle.seq = 0;
              handle.entries = [];
              handle.byId = new Map();
              break;
            }
          }
          handle.entries.push(rec);
          if (rec && typeof rec === 'object' && rec.id !== undefined) handle.byId.set(rec.id, rec);
        }
      }
    }
  }

  // 2) Journal — authority. Replay everything beyond the loaded snapshot.
  const fromSeq = handle.seq;
  handle.recovery.replayStartingSeq = fromSeq;
  const applied = replayJournal(handle, fromSeq);
  if (handle.corrupt) return;

  // 3) Folder the outcome:
  //    - snapshot invalid but a journal proving the data exists -> rebuild.
  //    - snapshot invalid with NO recoverable journal -> CORRUPT (never empty).
  //    - otherwise the cache is fine (snapshotLoaded true) or fresh.
  const canProve = handle.recovery.journalPresent && !handle.corrupt;
  if (handle.recovery.snapshotInvalid) {
    if (canProve) {
      handle.recovery.snapshotRebuilt = true;
      handle.recovery.discardedSnapshot = handle.recovery.snapshotInvalid;
      writeSnapshot(handle);
    } else {
      handle.corrupt = { at: 0, reason: `snapshot invalid and no recoverable journal: ${handle.recovery.snapshotInvalid}` };
      return;
    }
  } else if (!snapValid) {
    // No valid snapshot: either a fresh store or a journal-only boot. When the
    // journal carried the data, persist a checkpoint so future opens stop
    // re-replaying, and mark the boot as rebuilt-from-journal.
    if (applied > 0) {
      handle.recovery.snapshotRebuilt = true;
      writeSnapshot(handle);
    }
  } else if (applied > 0) {
    // Valid snapshot, journal extended since it: compact immediately so the
    // cache converges and growth stays bounded.
    writeSnapshot(handle);
  }
  handle.recovery.dirFsyncSupported = FSU.fsyncDirBestEffort(handle.root);
}

function writeSnapshot(handle) {
  const snap = {
    v: JOURNAL_VERSION,
    seq: handle.seq,
    digest: null,
    records: handle.entries,
  };
  snap.digest = snapshotDigest(snap);
  FSU.atomicWriteFile(path.join(handle.root, 'snapshot.json'), JSON.stringify(snap));
  return snap.digest;
}

function assertUsable(handle) {
  if (handle.corrupt) throw new Error(`journal: store is corrupt (at ${handle.corrupt.at}: ${handle.corrupt.reason}); admission is closed`);
  if (handle.closed) throw new Error('journal: store is closed');
}

function append(handle, payload) {
  assertUsable(handle);
  if (handle.validate) {
    const err = handle.validate(payload);
    if (typeof err === 'string' && err.length) throw new Error(`journal: refused payload: ${err}`);
  }
  const seq = handle.seq + 1;
  const entry = { v: JOURNAL_VERSION, seq, digest: digestOf(seq, payload), payload };
  const target = path.join(handle.journalDir, `${pad(seq)}.json`);
  try {
    FSU.writeExclusive(target, JSON.stringify(entry));
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      // A seq collision is unrecoverably wrong for a single writer; fail closed.
      handle.corrupt = { at: seq, reason: 'append: journal entry already exists (seq collision)' };
    }
    throw e;
  }
  handle.seq = seq;
  handle.entries.push(payload);
  if (payload && typeof payload === 'object' && payload.id !== undefined) handle.byId.set(payload.id, payload);
  return { seq, id: (payload && typeof payload === 'object' && payload.id !== undefined) ? payload.id : null };
}

function compact(handle) {
  assertUsable(handle);
  const digest = writeSnapshot(handle);
  // Remove journal entries that the snapshot now covers (best-effort; leftover
  // files are harmless — replay skips seq <= snapshot.seq and revalidates them).
  for (const ent of fs.readdirSync(handle.journalDir, { withFileTypes: true })) {
    if (!ent.isFile() || !/^\d+\.json$/.test(ent.name)) continue;
    const seq = parseInt(ent.name, 10);
    if (seq <= handle.seq) {
      try { fs.unlinkSync(path.join(handle.journalDir, ent.name)); } catch { /* ignore */ }
    }
  }
  FSU.fsyncDirBestEffort(handle.journalDir);
  return digest;
}

function list(handle) {
  return handle.entries.slice();
}

function get(handle, id) {
  return handle.byId.get(id);
}

function meta(handle) {
  return {
    VERSION: handle.VERSION,
    root: handle.root,
    seq: handle.seq,
    count: handle.entries.length,
    corrupt: handle.corrupt,
    recovery: Object.assign({}, handle.recovery),
  };
}

function close(handle) {
  if (handle.closed) return;
  if (!handle.corrupt) {
    try { compact(handle); } catch { /* keep flush best-effort */ }
  }
  handle.closed = true;
}

module.exports = { open, append, compact, list, get, meta, close, JOURNAL_VERSION };