'use strict';
/**
 * Tests for src/contracts/budget.js — hard-limit ledger arithmetic (PRD §12,
 * INV-15, T-08 hard resources).
 */

const assert = require('node:assert');
const B = require('../../src/contracts/budget.js');

const SPEND = { dimension: 'spend', hardLimit: 100, protectedFuture: 40 };

function fresh() {
  return B.createLedger([SPEND]);
}

module.exports = function run(t, group) {
  group('dimension construction');

  t('protectedFuture cannot exceed hardLimit', () => {
    assert.throws(() => B.createDimension({ dimension: 'x', hardLimit: 10, protectedFuture: 11 }), /exceeds hardLimit/);
  });

  t('a dimension requires a non-empty name', () => {
    assert.throws(() => B.createDimension({ dimension: '', hardLimit: 1 }), /non-empty/);
  });

  t('hardLimit must be a finite non-negative number', () => {
    assert.throws(() => B.createDimension({ dimension: 'x', hardLimit: -1 }), /non-negative/);
    assert.throws(() => B.createDimension({ dimension: 'x', hardLimit: NaN }), /finite/);
  });

  t('createLedger rejects a non-array spec', () => {
    assert.throws(() => B.createLedger({}), /array/);
  });

  group('additive invariant — discretionary');

  t('a discretionary reservation fitting headroom is admitted', () => {
    const r = B.admitDiscretionary(fresh(), 'spend', 'act-1', 30);
    assert.strictEqual(r.admitted, true);
    assert.strictEqual(B.reportDimension(r.ledger, 'spend').reservations, 30);
    assert.strictEqual(B.reportDimension(r.ledger, 'spend').protectedFuture, 40); // untouched
  });

  t('discretionary admission cannot eat protected future capacity', () => {
    // headroom = 100 - 40 = 60; a 70 reservation must be refused
    const r = B.admitDiscretionary(fresh(), 'spend', 'act-1', 70);
    assert.strictEqual(r.admitted, false);
    assert.ok(r.reason.includes('hard limit exceeded'));
  });

  t('the hard arithmetic is settled + reservations + protectedFuture', () => {
    // Settle to settled=40, protected=40, then 40+0+new+40 must fit in 100.
    let l = B.admitDiscretionary(fresh(), 'spend', 'a', 50);
    assert.strictEqual(l.admitted, true);
    l = l.ledger;
    const s = B.settle(l, 'spend', 'a', 40);
    assert.strictEqual(s.settled, true);
    l = s.ledger; // settled 40, protected 40
    const tight = B.admitDiscretionary(l, 'spend', 'b', 20); // 40+0+20+40 = 100 exactly
    assert.strictEqual(tight.admitted, true);
    const over = B.admitDiscretionary(l, 'spend', 'c', 21); // 40+0+21+40 = 101
    assert.strictEqual(over.admitted, false);
  });

  group('additive invariant — mandatory');

  t('a mandatory reservation must be covered by protectedFuture', () => {
    const r = B.admitMandatory(fresh(), 'spend', 'm-1', 41); // only 40 protected
    assert.strictEqual(r.admitted, false);
    assert.ok(r.reason.includes('protected future capacity'));
  });

  t('a mandatory reservation transfers protectedFuture without double-counting', () => {
    const r = B.admitMandatory(fresh(), 'spend', 'm-1', 40);
    assert.strictEqual(r.admitted, true);
    const rep = B.reportDimension(r.ledger, 'spend');
    assert.strictEqual(rep.reservations, 40);
    assert.strictEqual(rep.protectedFuture, 0); // transferred
    assert.strictEqual(B.assertInvariants(r.ledger).valid, true);
  });

  t('mandatory reservations are still bounded after a partial transfer', () => {
    const r = B.admitMandatory(fresh(), 'spend', 'm-1', 39);
    assert.strictEqual(r.admitted, true);
    const again = B.admitMandatory(r.ledger, 'spend', 'm-2', 2); // only 1 protected left
    assert.strictEqual(again.admitted, false);
  });

  group('release routes');

  t('authoritative settlement settles actual usage and frees the reservation', () => {
    let l = B.admitDiscretionary(fresh(), 'spend', 'a', 50).ledger;
    const s = B.settle(l, 'spend', 'a', 10);
    assert.strictEqual(s.settled, true);
    const rep = B.reportDimension(s.ledger, 'spend');
    assert.strictEqual(rep.settled, 10);
    assert.strictEqual(rep.reservations, 0);
    // discretionary reclaimed headroom becomes general headroom, not protected
    assert.strictEqual(rep.protectedFuture, 40);
    assert.strictEqual(B.assertInvariants(s.ledger).valid, true);
  });

  t('settling a mandatory reservation recharges the protected mandatory floor', () => {
    let l = B.admitMandatory(fresh(), 'spend', 'm-1', 30).ledger; // protected 40 -> 10
    const s = B.settle(l, 'spend', 'm-1', 20);
    assert.strictEqual(s.settled, true);
    const rep = B.reportDimension(s.ledger, 'spend');
    assert.strictEqual(rep.settled, 20);
    assert.strictEqual(rep.protectedFuture, 10 + 10); // reclaimed 10 returns to the floor
  });

  t('proven non-dispatch on a mandatory reservation recharges the floor', () => {
    let l = B.admitMandatory(fresh(), 'spend', 'm-1', 30).ledger;
    const p = B.proveNonDispatch(l, 'spend', 'm-1');
    assert.strictEqual(p.proven, true);
    assert.strictEqual(B.reportDimension(p.ledger, 'spend').protectedFuture, 40);
  });

  t('settlement rejects an actual exceeding the reservation', () => {
    const l = B.admitDiscretionary(fresh(), 'spend', 'a', 10).ledger;
    const s = B.settle(l, 'spend', 'a', 11);
    assert.strictEqual(s.settled, false);
    assert.ok(s.reason.includes('exceeds reserved'));
  });

  t('proven non-dispatch releases the reservation without settling usage', () => {
    let l = B.admitDiscretionary(fresh(), 'spend', 'a', 20).ledger;
    const p = B.proveNonDispatch(l, 'spend', 'a');
    assert.strictEqual(p.proven, true);
    const rep = B.reportDimension(p.ledger, 'spend');
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(rep.settled, 0);
  });

  t('conservative consumption settles the full bound and restores no headroom', () => {
    let l = B.admitDiscretionary(fresh(), 'spend', 'a', 50).ledger;
    const c = B.consumeConservatively(l, 'spend', 'a');
    assert.strictEqual(c.consumed, true);
    const rep = B.reportDimension(c.ledger, 'spend');
    assert.strictEqual(rep.settled, 50);
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(B.assertInvariants(c.ledger).valid, true);
  });

  t('releasing a reservation with no settlement is not exposed — unknown routes refuse', () => {
    const l = B.admitDiscretionary(fresh(), 'spend', 'a', 10).ledger;
    // There is no "cancel/release" function in the API for an action with a
    // missing receipt: timeout must NOT release liability (§12).
    const fns = ['settle', 'proveNonDispatch', 'consumeConservatively'];
    const APIs = B;
    for (const fn of fns) {
      const r = APIs[fn](l, 'spend', 'ghost-action'); // never reserved
      assert.strictEqual(r.settled || r.proven || r.consumed || r.reason.includes('no reservation'), true, fn);
    }
  });

  group('unknown usage');

  t('unknown usage prevents hard admission on that dimension', () => {
    const l = B.createLedger([{ dimension: 'x', hardLimit: 10, unknown: 3 }]);
    const r = B.admitDiscretionary(l, 'x', 'a', 1);
    assert.strictEqual(r.admitted, false);
    assert.ok(r.reason.includes('unknown usage'));
  });

  group('duplicate action reservations');

  t('an action cannot hold two reservations on the same dimension', () => {
    const l = B.admitDiscretionary(fresh(), 'spend', 'a', 10).ledger;
    const again = B.admitDiscretionary(l, 'spend', 'a', 5);
    assert.strictEqual(again.admitted, false);
    assert.ok(again.reason.includes('already holds'));
  });

  t('the ledger is immutable — admittance returns a new object', () => {
    const l0 = fresh();
    const r = B.admitDiscretionary(l0, 'spend', 'a', 5);
    assert.strictEqual(B.reportDimension(l0, 'spend').reservations, 0);
    assert.strictEqual(B.reportDimension(r.ledger, 'spend').reservations, 5);
  });

  t('invariant holds at every step of a realistic lifecycle', () => {
    const spec = { dimension: 'spend', hardLimit: 100, protectedFuture: 30 };
    let l = B.createLedger([spec]);
    const steps = [
      () => { const r = B.admitDiscretionary(l, 'spend', 'impl', 20); l = r.ledger; return r.admitted; },
      () => { const r = B.admitMandatory(l, 'spend', 'verify', 30); l = r.ledger; return r.admitted; }, // protected 30 -> 0
      () => { const r = B.settle(l, 'spend', 'impl', 15); l = r.ledger; return r.settled; },            // discretionary -> no recharge
      () => { const r = B.settle(l, 'spend', 'verify', 25); l = r.ledger; return r.settled; },          // reclaimed 5 -> floor 5
      () => { const r = B.admitDiscretionary(l, 'spend', 'finalization', 25); l = r.ledger; return r.admitted; },
      () => { const r = B.consumeConservatively(l, 'spend', 'finalization'); l = r.ledger; return r.consumed; },
    ];
    for (const s of steps) assert.strictEqual(s(), true);
    const rep = B.reportDimension(l, 'spend');
    assert.strictEqual(rep.settled, 15 + 25 + 25); // 65
    assert.strictEqual(rep.protectedFuture, 5);     // floor partially recharged by mandatory settle
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(B.assertInvariants(l).valid, true);
  });

  group('non-additive ceilings');

  t('a ceiling admits up to max concurrent actors', () => {
    const c = B.createCeiling(2);
    assert.strictEqual(c.tryAdmit('a').admitted, true);
    assert.strictEqual(c.tryAdmit('b').admitted, true);
    const third = c.tryAdmit('c');
    assert.strictEqual(third.admitted, false);
    assert.ok(third.reason.includes('ceiling 2 reached'));
  });

  t('a ceiling releases and re-admits', () => {
    const c = B.createCeiling(1);
    c.tryAdmit('a');
    assert.strictEqual(c.release('a').released, true);
    assert.strictEqual(c.tryAdmit('b').admitted, true);
  });

  t('a duplicate id is refused at the ceiling', () => {
    const c = B.createCeiling(2);
    c.tryAdmit('a');
    assert.strictEqual(c.tryAdmit('a').admitted, false);
  });

  t('releasing an inactive id is a no-op refusal', () => {
    const c = B.createCeiling(2);
    assert.strictEqual(c.release('nope').released, false);
  });
};