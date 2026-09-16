'use strict';
/**
 * fsutil — minimal, dependency-free filesystem primitives for the durable
 * store (PRD §6, §20, §25).
 *
 * These are ordinary POSIX primitives (O_EXCL create, fsync, atomic rename).
 * Whether a particular host actually honours the advertised crash guarantees is
 * a qualification matter (IB-01); this module uses the primitives honestly and
 * reports when directory fsync is unavailable rather than pretending it worked.
 */

const fs = require('node:fs');
const path = require('node:path');

const FSUTIL_VERSION = 1;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Best-effort fsync of a directory. Returns true only if it actually ran. */
function fsyncDirBestEffort(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
    return true;
  } catch {
    return false; // unsupported on this filesystem — durability note, not a lie
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

/**
 * Atomic replace: write to a unique temp sibling, fsync, rename over target,
 * then best-effort fsync of the parent directory. Readers never observe a
 * partially-written target.
 */
function atomicWriteFile(target, data) {
  const dir = path.dirname(target);
  const tmp = path.join(dir,
    `.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  fsyncDirBestEffort(dir);
  return target;
}

/**
 * Exclusive single-writer create on the FINAL name (O_EXCL). Throws EEXIST if
 * the target already exists — guarantees a journal entry (or lock) is written
 * at most once. Content is fsync'd before the parent dir is synced.
 */
function writeExclusive(target, data) {
  const dir = path.dirname(target);
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirBestEffort(dir);
  return target;
}

/** Create a directory entry exclusively (no clobber). */
function mkdirExclusive(dir) {
  fs.mkdirSync(dir, { mode: 0o700 });
  fsyncDirBestEffort(path.dirname(dir));
  return dir;
}

module.exports = {
  FSUTIL_VERSION,
  ensureDir,
  fsyncDirBestEffort,
  atomicWriteFile,
  writeExclusive,
  mkdirExclusive,
};