'use strict';
/**
 * derivation — §16 verification-derivation reduction, derived from durable
 * records (single source of truth, Unit 11).
 *
 * "Actual direct-source/dependency/configuration derivation is established or
 * proof remains unresolved" (§16, INV-12). The protected external observer
 * launches the CONTAINED FROZEN candidate from the recorded entrypoint with the
 * pinned runtime and closed resolution, captures bounded I/O, compares outside
 * candidate execution, and writes authoritative records (§16.4-16.6).
 *
 * THIS reducer never observes bytes or launches anything. It classifies the
 * derivation plane from the durable `observer_run` records and the exact frozen
 * generation, FAIL CLOSED on every ÷16 truth:
 *   - no frozen generation                -> MISSING (derivation against a live
 *                                            tree is not actual derivation);
 *   - no observer run for that generation -> MISSING;
 *   - bounded capture / outside comparison incomplete or unreliable
 *                                          -> INCONCLUSIVE;
 *   - observer qualification unattested   -> UNQUALIFIED (IB-01);
 *   - a qualified, bounded, authoritative,
 *     compared-outside-execution run exists
 *                                          -> ESTABLISHED.
 *
 * Unknown resolution or derivation produces MISSING or INCONCLUSIVE (§16).
 * A run recorded against one generation never certifies another (§17 stale
 * reuse; §13 immutability).
 */

const { GenerationState } = require('./records.js');

/** Total derivation-plane classification. */
const DerivationStatus = Object.freeze({
  ESTABLISHED: 'ESTABLISHED',     // qualified, bounded, authoritative, outside-compared observation of the exact frozen generation
  MISSING: 'MISSING',             // absent proof: no frozen generation or no observer run (§16)
  INCONCLUSIVE: 'INCONCLUSIVE',   // present evidence cannot establish reliable derivation (§16)
  UNQUALIFIED: 'UNQUALIFIED',     // structurally complete but no qualified observer attested (IB-01)
});

/** §16.6: the candidate MUST be unable to alter the observation path or its parent authority. */
function isProtectedPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  return p.startsWith('protected/') || p.includes(':protected:');
}

/**
 * Does this observer run apply to the CURRENT frozen generation? A run bound to
 * a different tree digest (a repair generation, a superseded attempt, or a
 * repointed identity) must not certify the frozen one — §17 stale reuse, §18
 * "old `PASS` labels do not certify new bytes".
 *
 * @param {object} run — an observer_run record
 * @param {object} frozenGeneration — the durable generation record (state FROZEN)
 * @returns {{ applies: boolean, reason: string|null }}
 */
function observerApplies({ run, frozenGeneration }) {
  if (!run || run.kind !== 'observer_run') return { applies: false, reason: 'not an observer_run record' };
  if (!frozenGeneration || frozenGeneration.kind !== 'generation' || frozenGeneration.state !== GenerationState.FROZEN) {
    return { applies: false, reason: 'no frozen generation supplied for applicability' };
  }
  const ci = run.candidateIdentity || {};
  if (ci.generationId !== frozenGeneration.generationId) {
    return { applies: false, reason: `run is for ${ci.generationId}, not the frozen ${frozenGeneration.generationId}` };
  }
  if (ci.treeDigest !== frozenGeneration.treeDigest) {
    return { applies: false, reason: 'run tree digest does not match the frozen tree digest (stale or foreign bytes)' };
  }
  return { applies: true, reason: null };
}

/**
 * §16.4 bounded-capture check: stdout, stderr, exit/signal, timeout, and
 * runtime-completion facts, with bounded/known truncation. Unknown truncation
 * (a forgeable green summary, an unread report) is NOT a bounded capture.
 *
 * @param {object|null} captured
 * @returns {{ ok: boolean, problems: string[] }}
 */
function captureBounded(captured) {
  const problems = [];
  if (!captured || typeof captured !== 'object') return { ok: false, problems: ['no capture facts'] };
  const finiteNonNeg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!finiteNonNeg(captured.stdoutBytes)) problems.push('stdout capture is not a bounded byte count');
  if (!finiteNonNeg(captured.stderrBytes)) problems.push('stderr capture is not a bounded byte count');
  if (captured.exitSignal === undefined || captured.exitSignal === null) problems.push('exit/signal fact not recorded');
  if (captured.timeoutSignal === undefined) problems.push('timeout fact not recorded');
  if (!captured.completionFacts) problems.push('runtime-completion facts not recorded');
  if (captured.truncationState !== 'NONE' && captured.truncationState !== 'TRUNCATED_BOUNDED') {
    problems.push('truncation state is unknown/unbounded (§16: truncated required output cannot establish verification)');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The §16 derivation-plane reducer. Purely derived from records; total and
 * conservative. Never returns ESTABLISHED unless an independently attested
 * qualified observer produced a bounded, authoritative, outside-compared
 * observation of the exact frozen tree digest.
 *
 * @param {object} opts
 * @param {object[]} opts.records — folded store records (single source of truth)
 * @returns {{ status: string, reasons: string[], observers: number,
 *   frozenGenerationId: string|null, envelopeMissing: string[] }}
 */
function deriveState({ records }) {
  const list = Array.isArray(records) ? records : [];
  const reasons = [];
  const runs = list.filter((r) => r.kind === 'observer_run');
  const gens = list.filter((r) => r.kind === 'generation');
  const frozen = gens.find((g) => g.state === GenerationState.FROZEN);

  if (!frozen) {
    return {
      status: DerivationStatus.MISSING,
      reasons: ['no frozen generation — derivation against a live tree is not actual derivation (§16.2)'],
      observers: 0,
      frozenGenerationId: null,
      envelopeMissing: [],
    };
  }

  const applying = runs.filter((r) => observerApplies({ run: r, frozenGeneration: frozen }).applies);
  const rejectedRuns = runs.length - applying.length;
  const envelopeMissing = deriveEnvelopeGaps(frozen, applying);

  if (applying.length === 0) {
    return {
      status: DerivationStatus.MISSING,
      reasons: [
        `no observer run for the frozen generation ${frozen.generationId}`,
        ...(rejectedRuns > 0 ? [`${rejectedRuns} run(s) rejected as stale/foreign (tree digest mismatch)`] : []),
      ],
      observers: 0,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }

  // §16 envelope bullet list — the recorded launch MUST cover the closed
  // resolution, roots, identities, and excluded caches. A subset hashed
  // arbitrarily is not input closure (§17).
  if (envelopeMissing.length > 0) {
    return {
      status: DerivationStatus.INCONCLUSIVE,
      reasons: [`derivation envelope incomplete: ${envelopeMissing.join(', ')}`],
      observers: applying.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }

  const caps = applying.filter((r) => captureBounded(r.captured).ok);
  if (caps.length !== applying.length) {
    return {
      status: DerivationStatus.INCONCLUSIVE,
      reasons: ['at least one applying observer run lacks bounded, known-truncation capture (§16.4)'],
      observers: applying.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }

  const outside = caps.filter((r) => r.comparedOutsideExecution === true);
  if (outside.length !== caps.length) {
    return {
      status: DerivationStatus.INCONCLUSIVE,
      reasons: ['comparison was not performed outside candidate execution (§16.5)'],
      observers: caps.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }

  const authoritative = outside.filter((r) => r.classification === 'authoritative'
    && isProtectedPath(r.observationPath));
  const qualified = authoritative.filter((r) => r.qualification && r.qualification.qualified === true);
  const unqualifiedPresent = authoritative.length > 0 && qualified.length === 0;

  if (authoritative.length === 0) {
    return {
      status: DerivationStatus.INCONCLUSIVE,
      reasons: ['no qualified observer attested (IB-01): observations are supporting only — candidate-authored reports stay supporting (§17) and cannot establish actual derivation'],
      observers: outside.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }
  if (unqualifiedPresent) {
    return {
      status: DerivationStatus.UNQUALIFIED,
      reasons: ['observer qualification not attested (IB-01): a structurally complete run cannot establish actual derivation without an independently qualified observer'],
      observers: authoritative.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }
  if (qualified.length !== authoritative.length) {
    return {
      status: DerivationStatus.INCONCLUSIVE,
      reasons: ['mixed qualification among applying authoritative runs'],
      observers: authoritative.length,
      frozenGenerationId: frozen.generationId,
      envelopeMissing,
    };
  }
  return {
    status: DerivationStatus.ESTABLISHED,
    reasons: [],
    observers: qualified.length,
    frozenGenerationId: frozen.generationId,
    envelopeMissing,
  };
}

/** The §16 derivation-envelope bullet list, reduced over the frozen generation + its runs. */
function deriveEnvelopeGaps(frozen, runs) {
  const missing = [];
  if (!frozen.baselineIdentity) missing.push('selected source baseline identity');
  const launch = runs[0] && runs[0].launch;
  if (!launch || typeof launch !== 'object') return missing.concat(['actual source root / entrypoint', 'runtime-toolchain identity', 'module/package resolution', 'environment/lookup paths', 'excluded caches']);
  if (!launch.entrypoint) missing.push('recorded entrypoint (direct-source launch)');
  if (!launch.runtimeIdentity) missing.push('pinned runtime/toolchain identity');
  if (!launch.resolutionScope) missing.push('closed module/package resolution scope');
  if (!launch.envCluster) missing.push('environment/lookup-path identity');
  if (launch.installedDependencyBytes !== true) missing.push('installed dependency bytes (not merely the lockfile)');
  if (launch.cachesDisabled !== true) missing.push('incremental/shared/remote caches disabled');
  if (launch.configParentIncluded !== true) missing.push('configuration search and parent-directory identity');
  return missing;
}

module.exports = {
  DerivationStatus,
  observerApplies,
  captureBounded,
  isProtectedPath,
  deriveEnvelopeGaps,
  deriveState,
};