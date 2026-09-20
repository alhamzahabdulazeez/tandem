'use strict';
/**
 * Tests for src/store/lock.cjs — exclusive ownership, no-timeout takeover,
 * recovery-only reclaim (PRD §10, T-03 logic). Boot identity injection keeps
 * cross-boot behaviour deterministic.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LOCK = require('../../src/store/lock.cjs');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-lock-')); }
function tear(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } }

const bootA = { id: 'boot:AAAA', source: 'boot_id', qualified: true };
const bootB = { id: 'boot:BBBB', source: 'boot_id', qualified: true };

module.exports = function run(t, group) {
  group('lock: exclusive ownership');

  t('acquire holds the lock; a second owner is refused', () => {
    const d = dir();
    const a = LOCK.acquire(d, { ownerIdentity: 'supervisor-1', bootId: bootA });
    assert.strictEqual(a.held, true);
    const b = LOCK.acquire(d, { ownerIdentity: 'supervisor-2', bootId: bootA });
    assert.strictEqual(b.held, false);
    assert.strictEqual(b.reason, 'owned-locked');
    assert.strictEqual(b.stale, false);
    assert.strictEqual(b.existing.ownerIdentity, 'supervisor-1');
    tear(d);
  });

  t('release by the owning supervisor frees the lock for the next one', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 's1', bootId: bootA });
    const rel = LOCK.release(d, { ownerIdentity: 's1' });
    assert.strictEqual(rel.released, true);
    const c = LOCK.acquire(d, { ownerIdentity: 's2', bootId: bootA });
    assert.strictEqual(c.held, true);
    tear(d);
  });

  t('release refuses to release someone elses lock', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 's1', bootId: bootA });
    const rel = LOCK.release(d, { ownerIdentity: 's2' });
    assert.strictEqual(rel.released, false);
    assert.strictEqual(rel.reason, 'wrong-owner');
    // still owned by s1
    const c = LOCK.acquire(d, { ownerIdentity: 's2', bootId: bootA });
    assert.strictEqual(c.held, false);
    tear(d);
  });

  t('release when nothing is held is a clean no-op, not an error', () => {
    const d = dir();
    const rel = LOCK.release(d, { ownerIdentity: 's1' });
    assert.strictEqual(rel.released, false);
    assert.strictEqual(rel.reason, 'not-held');
    tear(d);
  });

  t('hold reports current holder without creating one', () => {
    const d = dir();
    assert.strictEqual(LOCK.hold(d).held, false);
    LOCK.acquire(d, { ownerIdentity: 's1', bootId: bootA });
    const h = LOCK.hold(d);
    assert.strictEqual(h.held, true);
    assert.strictEqual(h.lock.ownerIdentity, 's1');
    tear(d);
  });

  t('acquire refuses a missing ownerIdentity', () => {
    assert.throws(() => LOCK.acquire(path.join(os.tmpdir(), 'x'), { bootId: bootA }), /ownerIdentity is required/);
  });

  group('lock: NO timeout takeover (T-03 logic)');

  t('an old lock is never transferred by age', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 'old-incumbent', bootId: bootA });
    // Forge a very old acquiredAt: age must NOT grant the lock.
    const p = path.join(d, 'lock');
    const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    cur.acquiredAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString();
    fs.writeFileSync(p, JSON.stringify(cur));
    const c = LOCK.acquire(d, { ownerIdentity: 'new-supervisor', bootId: bootA });
    assert.strictEqual(c.held, false);
    assert.strictEqual(c.reason, 'owned-locked');
    assert.strictEqual(c.stale, false, 'same boot, same holder — not stale');
    tear(d);
  });

  t('a PREVIOUS boot residue is reported stale, never auto-taken', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 's-prevboot', bootId: bootA });
    const c = LOCK.acquire(d, { ownerIdentity: 's-thisboot', bootId: bootB });
    assert.strictEqual(c.held, false);
    assert.strictEqual(c.stale, true);
    tear(d);
  });

  group('lock: recovery reclaim (§10)');

  t('reclaim supersedes ONLY a previous-boot lock', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 's-prevboot', bootId: bootA });
    const r = LOCK.reclaim(d, { ownerIdentity: 'recovery-1', bootId: bootB });
    assert.strictEqual(r.reclaimed, true);
    assert.strictEqual(r.superseded, 's-prevboot');
    assert.strictEqual(LOCK.hold(d).lock.ownerIdentity, 'recovery-1');
    // And the old owner cannot release a lock it no longer holds.
    const rel = LOCK.release(d, { ownerIdentity: 's-prevboot' });
    assert.strictEqual(rel.released, false);
    tear(d);
  });

  t('reclaim refuses same-boot takeover (live incumbent protection)', () => {
    const d = dir();
    LOCK.acquire(d, { ownerIdentity: 'live-incumbent', bootId: bootA });
    const r = LOCK.reclaim(d, { ownerIdentity: 'sneaky', bootId: bootA });
    assert.strictEqual(r.reclaimed, false);
    assert.strictEqual(r.reason, 'same-boot-takeover-refused');
    assert.strictEqual(LOCK.hold(d).lock.ownerIdentity, 'live-incumbent');
    tear(d);
  });

  t('reclaim on an absent lock just acquires', () => {
    const d = dir();
    const r = LOCK.reclaim(d, { ownerIdentity: 'recovery-1', bootId: bootB });
    assert.strictEqual(r.reclaimed, true);
    assert.strictEqual(r.superseded, null);
    tear(d);
  });

  t('reclaim refuses a corrupt lock (operator recovery needed)', () => {
    const d = dir();
    fs.writeFileSync(path.join(d, 'lock'), 'corrupt-bytes');
    const r = LOCK.reclaim(d, { ownerIdentity: 'r1', bootId: bootB });
    assert.strictEqual(r.reclaimed, false);
    assert.strictEqual(r.reason, 'corrupt-lock');
    tear(d);
  });

  group('lock: boot identity honesty');

  t('default boot identity reports source and qualification', () => {
    const b = LOCK.defaultBootIdentity();
    assert.ok(b.id && typeof b.id === 'string');
    assert.ok(['boot_id', 'session'].includes(b.source));
    assert.strictEqual(typeof b.qualified, 'boolean');
    // A session fallback must be explicit that it is NOT qualified.
    if (b.source === 'session') assert.strictEqual(b.qualified, false);
  });

  group('lock: epoch');

  t('epoch allocates monotonically, namespaced by role', () => {
    const e1 = LOCK.epoch(null, 'INITIAL');
    const e2 = LOCK.epoch(e1, 'SUPERVISOR');
    const e3 = LOCK.epoch(e2, 'RECOVERY');
    assert.strictEqual(e1.number, 1);
    assert.strictEqual(e2.number, 2);
    assert.strictEqual(e3.number, 3);
    assert.strictEqual(e3.role, 'RECOVERY');
    assert.ok(e1.allocatedAt);
  });

  t('epoch rejects unknown roles', () => {
    assert.throws(() => LOCK.epoch(null, 'ROGUE'), /unknown epoch role/);
    assert.throws(() => LOCK.epoch({ number: 1 }, 'WRONG'), /unknown epoch role/);
  });
};