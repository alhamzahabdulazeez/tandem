'use strict';
/**
 * generation — pure immutable-generation / freeze / manifest / publication
 * primitives (§7, §20).
 *
 * The physical acts this algebra governs — closing mutation admission, retiring
 * write grants, draining/fencing source mutators, materializing frozen bytes
 * under a create-once identity, verifying them, durably persisting, and
 * publishing — require a qualified runtime profile (IB-01). Per the same
 * boundary as {@link captureReadiness}, THIS module owns only the
 * deterministic REDUCTION over those facts, and it fails closed:
 *
 *   - the one-way MUTABLE ▸ MUTATION_CLOSED ▸ FROZEN transition guard (§7);
 *   - the TWO separate closure barriers (§20.1 close mutation, §20.2 freeze)
 *     and the freeze-readiness lattice (READY / NOT_READY / UNQUALIFIED);
 *   - the §20 delivery manifest — every one of the eleven mandated identities;
 *   - the payload/manifest-before-success publication ordering invariant and
 *     the fixed §20 crash table;
 *   - create-once identity and its immutability after freeze.
 *
 * A transition or manifest that cannot be established is reported as
 * NOT_READY / not ok — never silently PASS. Freeze in particular is
 * UNQUALIFIED unless a qualified materializer attested the create-once /
 * write-once byte semantics (§20: "A hash of a writable directory is not
 * freezing.").
 */

const { canonicalJson, contentId, sha256, isContentId, manifest: manifestOf } = require('./crypto.js');
const { GenerationState } = require('./records.js');
const { canTransitionGeneration, validateGenerationOneWay } = require('./state-machine.js');

// ---------------------------------------------------------------------------
// Readiness lattice
// ---------------------------------------------------------------------------

/** Total freeze-readiness classification (mirrors CaptureStatus semantics). */
const FreezeStatus = Object.freeze({
  READY: 'READY',           // every §20.2 freeze precondition is durally established
  NOT_READY: 'NOT_READY',   // a required structural guard is missing or unproven
  UNQUALIFIED: 'UNQUALIFIED', // structure is fine but no qualified runtime attested byte materialization
});

// ---------------------------------------------------------------------------
// Barrier 1 — close mutation (§20.1, §7)
// ---------------------------------------------------------------------------

/**
 * Barrier 1: "Close mutation admission for the current generation, retire its
 * write grants, drain/fence all source mutators, and reconcile their effects"
 * (§20.1). This is the precondition for the MUTABLE -> MUTATION_CLOSED edge.
 *
 * Fails closed: any required guard that is not `true` is reported.
 *
 * @param {object} p
 * @param {boolean} [p.mutationAdmissionClosed]
 * @param {boolean} [p.writeGrantsRetired]
 * @param {boolean} [p.mutatorsDrainedOrFenced]
 * @param {boolean} [p.mutatorsReconciled]
 * @returns {{ ok: boolean, barrier: 1, problems: string[] }}
 */
function canCloseMutation(p) {
  const q = p || {};
  const problems = [];
  if (q.mutationAdmissionClosed !== true) problems.push('barrier 1: mutation admission is not closed');
  if (q.writeGrantsRetired !== true) problems.push('barrier 1: write grants not retired');
  if (q.mutatorsDrainedOrFenced !== true) problems.push('barrier 1: source mutators not drained/fenced');
  if (q.mutatorsReconciled !== true) problems.push('barrier 1: mutator effects not reconciled');
  return { ok: problems.length === 0, barrier: 1, problems };
}

// ---------------------------------------------------------------------------
// Barrier 2 — freeze (§20.2)
// ---------------------------------------------------------------------------

/**
 * Freeze readiness for the MUTATION_CLOSED -> FROZEN edge (§20.2: "Materialize
 * and integrity-protect complete frozen source/deliverable bytes under a
 * create-once identity.").
 *
 * The structural guards (state, digests, barrier 1, verification flags) are
 * deterministic. The last guard — that a QUALIFIED runtime attested the
 * create-once / write-once byte semantics — decides between READY and
 * UNQUALIFIED: without IB-01, even a structurally perfect freeze record cannot
 * be claimed frozen, because "a hash of a writable directory is not freezing."
 *
 * @param {object} opts
 * @param {object} opts.generation — the durable generation record
 * @param {object} opts.materialization — evidence of the byte materialization
 *   { barrier1Closed, treeDigestVerified, bytesVerified, createOnceIdentity,
 *     qualifiedMaterializer, retentionDeclared }
 * @returns {{ status: string, reason: string|null, problems: string[] }}
 */
function freezeReadiness(opts) {
  const o = opts || {};
  const generation = o.generation;
  const m = o.materialization || {};
  const problems = [];

  if (!generation || generation.kind !== 'generation') {
    return { status: FreezeStatus.NOT_READY, reason: 'generation record required', problems: ['no generation record'] };
  }
  if (generation.schemaVersion !== 1) problems.push(`schemaVersion must be 1, got ${String(generation.schemaVersion)}`);

  if (generation.state === GenerationState.FROZEN) {
    return { status: FreezeStatus.READY, reason: 'already frozen', problems };
  }
  if (generation.state === GenerationState.MUTABLE) {
    problems.push('generation must reach MUTATION_CLOSED before freeze (one-way edge, §7)');
  }

  // The frozen tree digest must be an immutable content identity.
  if (!isContentId(generation.treeDigest)) {
    problems.push('treeDigest must be an immutable content identity (accepted_generation_and_tree_digest)');
  }

  // Barrier 1 must already be closed before bytes are frozen (§20.1 then §20.2).
  if (m.barrier1Closed !== true) problems.push('barrier 1 (mutation closed) must be established before freeze');

  // The materialized, verified bytes.
  if (m.bytesVerified !== true) problems.push('frozen bytes not verified against the tree digest');
  if (m.treeDigestVerified !== true) problems.push('materialized tree not verified to equal the accepted tree digest');
  if (typeof m.createOnceIdentity !== 'string' || m.createOnceIdentity.length === 0) {
    problems.push('createOnceIdentity required (byte identity must be create-once, §20.2)');
  }
  if (m.retentionDeclared !== true) problems.push('retention must be declared and capacity-reserved (§20)');

  if (problems.length > 0) {
    return { status: FreezeStatus.NOT_READY, reason: problems[0], problems };
  }

  // The qualification boundary (IB-01): only a qualified runtime can attest
  // create-once/write-once byte semantics and immutable storage placement.
  if (m.qualifiedMaterializer !== true) {
    return {
      status: FreezeStatus.UNQUALIFIED,
      reason: 'no qualified materializer attested create-once byte semantics (IB-01); freeze cannot be claimed',
      problems,
    };
  }
  return { status: FreezeStatus.READY, reason: null, problems };
}

// ---------------------------------------------------------------------------
// One-way transition guard (§7)
// ---------------------------------------------------------------------------

/**
 * The deterministic MUTABLE ▸ MUTATION_CLOSED ▸ FROZEN transition with its edge
 * preconditions. The edge table (§7 GENERATION_TRANSITIONS) must admit the
 * current→target pair AND the one-way order must hold; any reverse or skipping
 * edge (MUTABLE -> FROZEN, FROZEN -> anything) is refused.
 *
 * @param {object} opts
 * @param {string} opts.current — GenerationState
 * @param {string} opts.to — GenerationState
 * @param {object} [opts.preconditions] — { barrier1?, materialization?,
 *   generation? }
 * @returns {{ allowed: boolean, reason?: string, readiness?: object }}
 */
function advanceGeneration(opts) {
  const o = opts || {};
  const edge = canTransitionGeneration(o.current, o.to);
  if (!edge.allowed) return { allowed: false, reason: edge.reason };
  const oneWay = validateGenerationOneWay(o.current, o.to);
  if (!oneWay.valid) return { allowed: false, reason: oneWay.reason };

  const pre = o.preconditions || {};
  if (o.to === GenerationState.MUTATION_CLOSED) {
    const b1 = canCloseMutation(pre.barrier1);
    if (!b1.ok) return { allowed: false, reason: b1.problems[0], barrier1: b1 };
    return { allowed: true, reason: null, barrier1: b1 };
  }
  if (o.to === GenerationState.FROZEN) {
    const r = freezeReadiness({ generation: pre.generation, materialization: pre.materialization });
    if (r.status !== FreezeStatus.READY) {
      return { allowed: false, reason: r.reason || r.problems[0], readiness: r };
    }
    return { allowed: true, reason: null, readiness: r };
  }
  return { allowed: false, reason: `unsupported target generation state "${String(o.to)}"` };
}

// ---------------------------------------------------------------------------
// Create-once identity (immutability §13 / §20.2)
// ---------------------------------------------------------------------------

/**
 * Deterministic create-once publication identity for a frozen generation. The
 * identity BINDS the byte object to this generation + tree digest; rewriting
 * either would produce a different identity, so a frozen generation cannot be
 * silently re-rendered under the same identity (§20: "Content MUST NOT be
 * overwritten in place"; §13 immutable).
 */
function createOnceIdentity({ generationId, treeDigest }) {
  if (typeof generationId !== 'string' || generationId.length === 0) throw new Error('createOnceIdentity: generationId required');
  if (!isContentId(treeDigest)) throw new Error('createOnceIdentity: treeDigest must be a content identity');
  return `ci1:${sha256(canonicalJson({ generationId, treeDigest }))}`;
}

function isCreateOnceIdentity(v) {
  return typeof v === 'string' && /^ci1:[0-9a-f]{64}$/.test(v);
}

/**
 * After a generation is FROZEN its create-once identity is immutable: any
 * attempt to bind a different byte identity to the same frozen record is
 * rejected. Before freeze the identity is not yet bound and the guard passes.
 */
function frozenIdentityUnchanged({ generation, proposedIdentity }) {
  if (!generation || generation.kind !== 'generation') return { ok: true, reason: null };
  if (generation.state !== GenerationState.FROZEN) return { ok: true, reason: null };
  if (generation.createOnceIdentity !== proposedIdentity) {
    return { ok: false, reason: 'frozen generation create-once identity is immutable; cannot re-bind bytes' };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// §20 delivery manifest
// ---------------------------------------------------------------------------

/**
 * The ten §20 identities the delivery manifest MUST identify. A manifest
 * missing any of these fails {manifestComplete} (never a silent PASS).
 */
const MANIFEST_FIELDS = [
  'selected_baseline_identity',
  'accepted_generation_and_tree_digest',
  'complete_payload_digest',
  'complete_included_paths_types_modes_and_content_identities',
  'new_files_and_deletions_relative_to_baseline',
  'explicitly_excluded_dependency_or_build_inputs',
  'runtime_and_verification_input_manifest',
  'acceptance_contract_and_evidence_identities',
  'publication_identity_and_persistence_state',
  'retention_start_expiry_and_release_policy',
];

/**
 * Build the deterministic §20 delivery manifest over the provided identities.
 * The complete-included-paths view comes from {@link crypto.manifest} (sorted,
 * duplicate-rejected, content-identity-validated), so the manifest binds real
 * paths/types/modes/content identities and NOT "a hash of a writable directory".
 *
 * The returned {manifestIdentity} is the content identity of the canonical
 * manifest bytes — the identity a delivery record must reference.
 *
 * @param {object} opts
 * @returns {{ fields: object, manifestIdentity: string, includedCount: number }}
 */
function buildDeliveryManifest(opts) {
  const o = opts || {};
  const inc = manifestOf(o.includedEntries || []);
  const newDel = o.newFilesAndDeletions || { newFiles: [], deletions: [] };

  const fields = {
    selected_baseline_identity: o.selectedBaselineIdentity || null,
    accepted_generation_and_tree_digest: o.acceptedGenerationAndTreeDigest || null,
    complete_payload_digest: o.completePayloadDigest || null,
    complete_included_paths_types_modes_and_content_identities: {
      entriesDigest: inc.entriesDigest,
      count: inc.count,
    },
    new_files_and_deletions_relative_to_baseline: {
      newFiles: newDel.newFiles || [],
      deletions: newDel.deletions || [],
    },
    explicitly_excluded_dependency_or_build_inputs: o.explicitlyExcludedInputs || [],
    runtime_and_verification_input_manifest: o.runtimeAndVerificationInputManifest || null,
    acceptance_contract_and_evidence_identities: o.acceptanceContractAndEvidenceIdentities || null,
    publication_identity_and_persistence_state: o.publicationIdentityAndState || null,
    retention_start_expiry_and_release_policy: o.retention || null,
  };

  // Keep the full audited entry set on the manifest too (a view, not the store).
  fields._entries = inc.entries;

  const manifestIdentity = contentId(canonicalJson(fields));
  return { fields, manifestIdentity, includedCount: inc.count };
}

/**
 * Fail-closed manifest completeness. Every one of the ten §20 identities must
 * be present and non-empty (undefined/null/'' is a gap), and the claimed
 * {manifestIdentity} must equal the freshly recomputed digest over those fields
 * (tamper detection). A truthfully-empty scalar list — e.g. no excluded inputs
 * — still counts as "identifies none"; the identity is present.
 *
 * @param {object} manifest — { fields, manifestIdentity }
 * @returns {{ ok: boolean, problems: string[] }}
 */
function manifestComplete(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, problems: ['no manifest'] };
  const fields = manifest.fields || {};
  for (const f of MANIFEST_FIELDS) {
    const v = fields[f];
    if (v === undefined || v === null || v === '') {
      problems.push(`manifest is missing mandated field "${f}"`);
      continue;
    }
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
      // A present-but-empty record (e.g. "no new files and no deletions") still
      // identifies the field; only absence is a gap. Semantic validity of each
      // identity's CONTENT is owned by the relevant sub-reducer.
      continue;
    }
  }
  if (manifest.manifestIdentity != null) {
    const check = contentId(canonicalJson(fields));
    if (manifest.manifestIdentity !== check) {
      problems.push('manifest.manifestIdentity does not match the manifest fields (tampered or stale)');
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Publication ordering & crash table (§20)
// ---------------------------------------------------------------------------

/**
 * The payload/manifest-before-success ordering invariant: "Payload and manifest
 * bytes MUST be fully written, verified, durably persisted, and published
 * before a successful terminal record commits" (§20). Used as the gate before a
 * successful terminal record is admitted.
 *
 * @param {object} p
 * @param {boolean} [p.bytesVerified]
 * @param {boolean} [p.durablyPersisted]
 * @param {boolean} [p.published]
 * @returns {{ ok: boolean, reason: string|null }}
 */
function successOrderingOk(p) {
  const q = p || {};
  if (q.bytesVerified !== true) return { ok: false, reason: 'payload/manifest bytes not verified' };
  if (q.durablyPersisted !== true) return { ok: false, reason: 'payload/manifest not durably persisted' };
  if (q.published !== true) return { ok: false, reason: 'payload/manifest not durably published' };
  return { ok: true, reason: null };
}

/**
 * The fixed §20 crash table. Classification is total and conservative: the
 * only way to reach a success-reportable state is a committed terminal record
 * whose retained bytes are intact. A committed terminal WITHOUT intact
 * retention is reported unavailable/corrupt, never regenerated under the
 * accepted identity.
 *
 * @param {object} p
 * @param {boolean} [p.prepared]
 * @param {boolean} [p.published]
 * @param {boolean} [p.terminalCommitted]
 * @param {boolean} [p.retainedBytesIntact]
 * @returns {{ phase: string, disposition: string }}
 */
function deliveryCrashDisposition(p) {
  const q = p || {};
  if (q.terminalCommitted === true && q.retainedBytesIntact !== true) {
    return { phase: 'AFTER_TERMINAL', disposition: 'UNAVAILABLE_OR_CORRUPT_NO_REGENERATE' };
  }
  if (q.terminalCommitted === true) {
    return { phase: 'AFTER_TERMINAL', disposition: 'SUCCESS_REPORTED' };
  }
  if (q.published === true) {
    return { phase: 'AFTER_PUBLICATION_BEFORE_TERMINAL', disposition: 'NON_SUCCESSFUL_NOT_ACCEPTED' };
  }
  if (q.prepared === true) {
    return { phase: 'AFTER_PREPARATION_BEFORE_PUBLICATION', disposition: 'NON_SUCCESSFUL_UNDELIVERED' };
  }
  return { phase: 'BEFORE_PREPARATION', disposition: 'NON_SUCCESSFUL_UNDELIVERED' };
}

// ---------------------------------------------------------------------------
// Retention (§20)
// ---------------------------------------------------------------------------

/** §20 default retention is seven days (unless the authenticated user selects another supported duration). */
function defaultRetention(start) {
  const s = new Date(start).toISOString();
  return {
    start: s,
    expiry: new Date(new Date(s).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    releasePolicy: 'AUTHENTICATED_RELEASE',
  };
}

/**
 * "Retention MUST be declared and capacity-reserved at admission" (§20). The
 * declaration needs a start, an expiry AFTER start, a release policy, and
 * reserved physical capacity (IB-03). Any missing piece is NOT declared.
 *
 * @param {object} r
 * @returns {{ ok: boolean, problems: string[] }}
 */
function retentionDeclared(r) {
  const problems = [];
  if (!r || typeof r !== 'object') return { ok: false, problems: ['retention not declared'] };
  if (typeof r.start !== 'string' || Number.isNaN(Date.parse(r.start))) problems.push('retention: start required');
  if (typeof r.expiry !== 'string' || Number.isNaN(Date.parse(r.expiry))) problems.push('retention: expiry required');
  if (r.start && r.expiry && Date.parse(r.start) >= Date.parse(r.expiry)) {
    problems.push('retention: expiry must be after start');
  }
  if (typeof r.releasePolicy !== 'string' || r.releasePolicy.length === 0) problems.push('retention: releasePolicy required');
  if (!(typeof r.reservedCapacity === 'number' && Number.isFinite(r.reservedCapacity) && r.reservedCapacity > 0)) {
    problems.push('retention: reservedCapacity (physical capacity) required');
  }
  return { ok: problems.length === 0, problems };
}

module.exports = {
  FreezeStatus,
  MANIFEST_FIELDS,
  canCloseMutation,
  freezeReadiness,
  advanceGeneration,
  createOnceIdentity,
  isCreateOnceIdentity,
  frozenIdentityUnchanged,
  buildDeliveryManifest,
  manifestComplete,
  successOrderingOk,
  deliveryCrashDisposition,
  defaultRetention,
  retentionDeclared,
  GenerationState,
};