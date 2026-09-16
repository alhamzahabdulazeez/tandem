'use strict';
/**
 * lock — exclusive single-supervisor ownership (PRD §10, §25; T-03 logic
 * portion). Control-owner identity is an opaque token the caller supplies; the
 * lock itself never invents authority — it just enforces at-most-one holder.
 *
 * Core rules (all fail closed, none environment-dependent):
 *   - At most one holder. A second {@link acquire} with a different owner is
 *     refused ("owned-locked").
 *   - NEVER a timeout: age never transfers ownership (T-03). A lock from a
 *     PREVIOUS boot is reported `stale:true`, and ownership may move only via
 *     an explicit {@link reclaim} documented as the §10 recovery path — never
 *     by time.
 *   - Recovery takes over a PREVIOUS boot's lock (`reclaim`) only. A
 *     same-boot lock is untouchable: that would be a live-incumbent takeover.
 *   - {@link release} refuses to release a lock it does not own.
 *
 * bootId guards against pid reuse across boots. The default source is the
 * Linux boot_id file; its QUALIFICATION as a non-reusable identity is a
 * runtime-profile matter (IB-01), so the returned object carries
 * `qualified:false` for the session fallback and lock users may rely on it
 * accordingly.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FSU = require('./fsutil.cjs');

const LOCK_VERSION = 1;
const LOCK_FILENAME = 'lock';

function defaultBootIdentity() {
  try {
    const raw = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      return { id: 'boot:' + raw, source: 'boot_id', qualified: true };
    }
  } catch { /* not a Linux /proc or unreadable */ }
  let nonce;
  try { nonce = crypto.randomBytes(16).toString('hex'); } catch { nonce = process.hrtime.bigint().toString(16); }
  return {
    id: `session:${Date.now().toString(36)}-${process.pid}-${nonce}`,
    source: 'session',
    qualified: false,
  };
}

function lockPath(root) { return path.join(root, LOCK_FILENAME); }

function readLock(root) {
  const p = lockPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!v || typeof v !== 'object' || v.v !== LOCK_VERSION) {
      return { corrupt: true, file: p };
    }
    return v;
  } catch {
    return { corrupt: true, file: p };
  }
}

function writeLock(root, content) {
  return FSU.writeExclusive(lockPath(root), JSON.stringify(content));
}

/**
 * acquire(root, { ownerIdentity, bootId }) -> { held, reason?, existing?, stale? }
 * held:false with reason 'owned-locked' -> another live owner holds it.
 * held:false with stale:true -> pre-boot residue; {@link reclaim} may take over.
 * held:true -> we now hold the lock; call release() when done.
 */
function acquire(root, opts) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('lock: root must be a non-empty path string');
  const o = opts || {};
  if (typeof o.ownerIdentity !== 'string' || !o.ownerIdentity.length) throw new Error('lock: ownerIdentity is required');
  const boot = o.bootId || defaultBootIdentity();
  FSU.ensureDir(root);
  const existing = readLock(root);
  if (existing) {
    if (existing.corrupt) {
      return { held: false, stale: true, reason: 'corrupt', existing };
    }
    return {
      held: false,
      reason: 'owned-locked',
      stale: existing.bootId !== boot.id,
      existing,
    };
  }
  writeLock(root, {
    v: LOCK_VERSION,
    ownerIdentity: o.ownerIdentity,
    bootId: boot.id,
    bootSource: boot.source,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
  return { held: true };
}

/**
 * reclaim — the ONLY legal takeover path (PRD §10 recovery). It supersedes a
 * PREVIOUS boot's lock only. A same-boot lock, or a corrupt lock, is never
 * taken over here (corrupt needs operator recovery).
 */
function reclaim(root, opts) {
  const o = opts || {};
  const boot = o.bootId || defaultBootIdentity();
  const existing = readLock(root);
  FSU.ensureDir(root);
  if (!existing) {
    return { reclaimed: true, superseded: null };
  }
  if (existing.corrupt) {
    return { reclaimed: false, reason: 'corrupt-lock', existing };
  }
  if (existing.bootId === boot.id) {
    return { reclaimed: false, reason: 'same-boot-takeover-refused', existing };
  }
  try { fs.unlinkSync(lockPath(root)); } catch { /* ignore */ }
  FSU.fsyncDirBestEffort(path.dirname(lockPath(root)));
  writeLock(root, {
    v: LOCK_VERSION,
    ownerIdentity: o.ownerIdentity,
    bootId: boot.id,
    bootSource: boot.source,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
  return { reclaimed: true, superseded: existing.ownerIdentity };
}

/** release — refuse to release a lock owned by someone else. */
function release(root, opts) {
  const o = opts || {};
  const existing = readLock(root);
  if (!existing) return { released: false, reason: 'not-held' };
  if (existing.corrupt) return { released: false, reason: 'corrupt-lock', existing };
  if (existing.ownerIdentity !== o.ownerIdentity) {
    return { released: false, reason: 'wrong-owner', existing };
  }
  try { fs.unlinkSync(lockPath(root)); } catch { /* ignore */ }
  FSU.fsyncDirBestEffort(path.dirname(lockPath(root)));
  return { released: true };
}

function hold(root) {
  const existing = readLock(root);
  if (!existing) return { held: false };
  return { held: true, lock: existing };
}

/**
 * allocateEpoch — durable, internally-consistent epoch for a serialized
 * operation (PRD §10). Pure: caller commits the returned object through the
 * journal; given the same prior epoch it is deterministic.
 */
function epoch(prior, role) {
  if (role !== 'SUPERVISOR' && role !== 'RECOVERY' && role !== 'INITIAL') {
    throw new Error(`lock: unknown epoch role ${role}`);
  }
  const n = (prior && Number.isInteger(prior.number)) ? prior.number + 1 : 1;
  return { kind: 'epoch', role, number: n, allocatedAt: new Date().toISOString() };
}

module.exports = {
  LOCK_VERSION,
  LOCK_FILENAME,
  defaultBootIdentity,
  acquire,
  reclaim,
  release,
  hold,
  epoch,
};