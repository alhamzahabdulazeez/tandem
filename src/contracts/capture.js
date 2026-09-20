'use strict';
/**
 * source-capture — pure abstractions for immutable Git source capture (§11).
 *
 * Real object/byte capture requires a qualified runtime profile and a trusted
 * non-executing Git reader (IB-01), so THIS module is the pure capture algebra:
 * the acceptance of a *capture record*, the §11 rejection rules for
 * unsupported source shapes, and the baseline manifest's inclusion/exclusion
 * normalization. It never touches the filesystem, never executes Git, and never
 * claims a capture it did not perform.
 *
 * Every analysis here FAILS CLOSED (§11 step 7: "Reject inconsistent or
 * incomplete capture before executable task work"). An unknown shape, an
 * unresolved check, an explicit exclusion, or a missing identity is reported as
 * NOT READY, never as "captured and clean".
 *
 * PRD references: §11 (Source Isolation), §6 (durable records), §20 (baseline
 * manifest identities), INV-06 / INV-07 / INV-13.
 */

// ---------------------------------------------------------------------------
// Capture status lattice (total, conservative)
// ---------------------------------------------------------------------------

/**
 * Total capture-readiness classification. `READY` requires every §11 check to
 * be PASS on supported content AND every integrity/exclusion check to be either
 * PASS or an explicitly declared non-goal (e.g. mandated exclusion of dirty,
 * untracked, ignored content). Anything else is NOT READY.
 */
const CaptureStatus = Object.freeze({
  READY: 'READY',           // immutable commit fully verified and enumerable
  NOT_READY: 'NOT_READY',   // explicit exclusion/missing identity/unsupported shape internally
  UNSUPPORTED: 'UNSUPPORTED', // source root shape is not a supported Git shape (§11 reject list)
  UNQUALIFIED: 'UNQUALIFIED', // runtime lacks the qualified non-executing reader (IB-01) — cannot verify
});

/** §11 mandatory rejection conditions (a supported selection rejects these). */
const REJECT_RULES = Object.freeze({
  dirtyRequired: 'required dirty, staged, unstaged or untracked input selected',
  untrackedIgnored: 'required untracked or ignored content selected',
  unmergedShape: 'unmerged or sparse source shape',
  gitlink: 'submodule/gitlink in selected tree',
  gitfile: 'linked worktree (.git is a file)',
  alternates: 'git alternates / shared object store',
  symlink: 'symlink or special file in selected tree',
  escapingPath: 'escaping or absolute path in selection',
  unsupportedMode: 'unsupported file mode or type transition',
  pathCollision: 'path collision or hard-link arrangement',
  missingObjects: 'missing required objects or content whose independent retention cannot be established',
});

// ---------------------------------------------------------------------------
// Inclusion/exclusion normalization (§11 steps 9, 2; §20 manifest)
// ---------------------------------------------------------------------------

/**
 * Normalize an explicit inclusion/exclusion rule set into the canonical capture
 * policy. Returns a NEW object (pure). Exclusions are authoritative: a path is
 * excluded if any exclusion pattern covers it; inclusion patterns never
 * override an exclusion. A capture of an excluded path is a conflict.
 *
 * @param {object} rules
 * @param {string[]} [rules.include] — exact paths or path prefixes
 * @param {string[]} [rules.exclude] — exact paths or path prefixes
 * @param {string}   [rules.excludeDirty] — true when the contract excludes
 *   staged/unstaged/untracked/ignored content (mandatory for the MVP, §11 step 2)
 * @returns {{ include: object, exclude: object, excludeDirty: boolean,
 *             conflict: boolean, conflicts: string[] }}
 */
function normalizeRules(rules) {
  const r = rules || {};
  const include = normalizePatternSet(r.include, 'include');
  const exclude = normalizePatternSet(r.exclude, 'exclude');
  const excludeDirty = r.excludeDirty === true;

  // A path cannot be both selected and excluded. Encoding that as a rule object
  // is a configuration conflict — fail closed at capture-plan time.
  const conflicts = [];
  const allExcludeKeys = new Set([...Object.keys(exclude.prefixes), ...Object.keys(exclude.exact)]);
  for (const p of allExcludeKeys) {
    if (Object.prototype.hasOwnProperty.call(include.exact, p) || Object.prototype.hasOwnProperty.call(include.prefixes, p)) {
      conflicts.push(p);
    }
  }
  return {
    include,
    exclude,
    excludeDirty,
    conflict: conflicts.length > 0,
    conflicts,
  };
}

/** Normalize a raw string array into {exact: {}, prefixes: {}}. */
function normalizePatternSet(raw, name) {
  const out = { exact: {}, prefixes: {} };
  for (const p of Array.isArray(raw) ? raw : []) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const norm = normalizePath(p);
    if (norm === null) continue;
    if (norm.endsWith('/')) out.prefixes[norm] = true;
    else out.exact[norm] = true;
  }
  return out;
}

/**
 * Canonical relative path: forward slashes only, no leading '/' or '.'/'..' or
 * '\\' or drive letters. Returns null when the path is not representable as a
 * rooted relative selection path (§11: escaping/absolute paths rejected).
 */
function normalizePath(p) {
  if (typeof p !== 'string') return null;
  const s = p.split('\\').join('/').replace(/^\.\//, '');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) {
    return null;
  }
  if (s.indexOf('\u0000') >= 0) return null;
  const segments = s.split('/');
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return null;
  }
  return s === '' ? null : s;
}

/**
 * Decide whether a given relative path is included by a normalized rule set.
 * A path is INCLUDED when an include rule matches it and no exclude rule
 * matches it. With no include rules at all, every non-excluded path is
 * included (whole-tree capture as selected by the immutable commit identity).
 *
 * @param {string} rel — normalized relative path of a tree entry
 * @param {object} rules — result of normalizeRules
 * @returns {{ included: boolean, why: string }}
 */
function includeDecision(rel, rules) {
  const norm = normalizePath(rel);
  if (norm === null) return { included: false, why: 'unrepresentable path' };
  if (norm === '.git' || norm.startsWith('.git/')) {
    return { included: false, why: 'git administration is not source content' };
  }
  const exMatch = matches(norm, rules.exclude);
  if (exMatch) return { included: false, why: `excluded (${exMatch})` };
  const incMatch = matches(norm, rules.include);
  if (incMatch) return { included: true, why: `included (${incMatch})` };
  const hasIncludes = Object.keys(rules.include.exact).length + Object.keys(rules.include.prefixes).length > 0;
  return hasIncludes
    ? { included: false, why: 'not selected by include rules' }
    : { included: true, why: 'included (no include rules — commit-defined scope)' };
}

/** Return the matching rule string for a path, or null. */
function matches(norm, set) {
  if (Object.prototype.hasOwnProperty.call(set.exact, norm)) return `exact:${norm}`;
  const parts = norm.split('/');
  let prefix = '';
  for (const part of parts) {
    prefix = prefix === '' ? part : `${prefix}/${part}`;
    if (Object.prototype.hasOwnProperty.call(set.prefixes, `${prefix}/`)) return `prefix:${prefix}/`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capture record validation (§6 / §11)
// ---------------------------------------------------------------------------

/**
 * Classify a capture record into one of the {@link CaptureStatus} values.
 * Rules (all conservative):
 *  - missing/invalid baseline manifest identity  -> UNSUPPORTED
 *  - any rejection present (gitlink, symlink, ...) -> UNSUPPORTED
 *  - source identity not a full commit identity   -> NOT_READY
 *  - exclusion conflicts                          -> NOT_READY
 *  - any integrity check unresolved/missing        -> NOT_READY
 *  - no qualified reader evidence                  -> UNQUALIFIED
 *  - verify flag false WITHOUT reader qualification -> UNQUALIFIED
 *  - everything satisfied                          -> READY
 *
 * The last two rules are what keep this honest under IB-01: even a structurally
 * perfect record cannot be READY unless the environment that produced it can
 * prove it used a qualified non-executing reader.
 *
 * @param {object|undefined} rec — a capture record
 * @returns {{ status: string, reason: string | null, problems: string[] }}
 */
function captureReadiness(rec) {
  const problems = [];
  if (!rec || typeof rec !== 'object') {
    return { status: CaptureStatus.NOT_READY, reason: 'no capture record', problems: ['missing capture record'] };
  }
  if (rec.kind !== 'source_capture') {
    return { status: CaptureStatus.NOT_READY, reason: 'wrong record kind', problems: [`kind must be "source_capture", got "${String(rec.kind)}"`] };
  }
  if (rec.schemaVersion !== 1) problems.push(`schemaVersion must be 1, got ${String(rec.schemaVersion)}`);

  // 1. Full immutable commit identity (§11 step 2, INV-13).
  const cid = typeof rec.commitIdentity === 'string' ? rec.commitIdentity : '';
  if (!/^[0-9a-f]{40}$/.test(cid) && !/^[0-9a-f]{64}$/.test(cid)) {
    problems.push('commitIdentity must be a full hex commit hash (40 or 64 chars); branches/HEAD are not an accepted source identity');
  }

  // 2. Baseline manifest identity must reference retained content (§11 step 6).
  //    Content identities are versioned sha256:<hex> (§6, crypto.isContentId) —
  //    the same format the schema validator and generation identities require.
  const { isContentId } = require('./crypto.js');
  const manId = rec.baselineManifestIdentity;
  if (typeof manId !== 'string' || !isContentId(manId)) {
    problems.push('baselineManifestIdentity must be a content identity of the retained manifest (sha256:<hex>)');
  }

  // 3. §11 reject list: any rejection makes the capture unsupported.
  const rejections = [];
  for (const key of Object.keys(REJECT_RULES)) {
    if (rec.rejections && rec.rejections[key] === true) rejections.push(key);
  }
  if (rejections.length > 0) {
    return {
      status: CaptureStatus.UNSUPPORTED,
      reason: `unsupported source shape: ${rejections.join(', ')}`,
      problems: [...problems, `rejected source shapes present: ${rejections.join(', ')}`],
    };
  }

  // 4. Exclusion/inclusion conflicts (§11 step 2: excluded work is not captured).
  if (rec.rules && rec.rules.conflict === true) {
    problems.push(`inclusion/exclusion conflict on: ${(rec.rules.conflicts || []).join(', ')}`);
  }

  // 5. Integrity checks: every check must be explicitly PASS. Untested/missing
  //    integrity is a NOT_READY (never silently READY). (§11 steps 6-7.)
  const integrity = rec.integrity || {};
  for (const check of ['objectIdentitiesVerified', 'treeEnumerationComplete', 'independentRetentionEstablished']) {
    if (integrity[check] !== true) {
      problems.push(`${check} must be true (verified by a qualified reader)`);
    }
  }

  // 6. Exclusion of dirty/untracked/ignored must be declared (MVP §11 step 2).
  if (!rec.rules || rec.rules.excludeDirty !== true) {
    problems.push('excludeDirty must be declared (staged/unstaged/untracked/ignored excluded by contract)');
  }

  // 7. Qualified reader: without it, even a correct record is UNQUALIFIED.
  const reader = rec.reader || rec.readerQualified;
  const qualifiedReader = reader === true || (reader && reader.qualified === true);
  const verifyClaimed = integrity.objectIdentitiesVerified === true;
  if (!qualifiedReader) {
    return {
      status: CaptureStatus.UNQUALIFIED,
      reason: 'no qualified non-executing reader evidence (IB-01); capture cannot be verified as complete',
      problems,
    };
  }
  if (verifyClaimed && !qualifiedReader) {
    return {
      status: CaptureStatus.UNQUALIFIED,
      reason: 'object identities cannot be verified by an unqualified reader',
      problems,
    };
  }

  if (problems.length > 0) {
    return { status: CaptureStatus.NOT_READY, reason: problems[0], problems };
  }
  return { status: CaptureStatus.READY, reason: null, problems };
}

// ---------------------------------------------------------------------------
// Baseline manifest algebra (§11 step 9, §20 manifest identities)
// ---------------------------------------------------------------------------

/**
 * Build the baseline manifest entries view from a completed capture's entry
 * digests, honoring inclusion/exclusion normalization. Entries listed but
 * excluded are recorded with their exclusion reason so the manifest says
 * explicitly what was NOT captured (§11 step 2: "excluded work remains
 * untouched and is not represented as captured").
 *
 * @param {object} opts
 * @param {string[]} opts.paths — every enumerable tree path (relative)
 * @param {string} opts.manifestIdentity — deterministic digest of the retained
 *   full manifest (content identity of the inclusion/exclusion-normalized set)
 * @param {object} opts.rules — normalized rules (normalizeRules output)
 * @returns {{ included: object[], excluded: object[], digest: string }}
 */
function buildBaselineManifest({ paths, manifestIdentity, rules }) {
  const r = rules || normalizeRules({});
  const included = [];
  const excluded = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    const rel = normalizePath(p);
    if (rel === null) {
      excluded.push({ path: String(p), reason: 'unrepresentable path' });
      continue;
    }
    const dec = includeDecision(rel, r);
    const entry = { path: rel, digest: shaContentId(rel) };
    if (dec.included) included.push(entry);
    else excluded.push({ path: rel, reason: dec.why });
  }
  const digest = manifestDigest(included, manifestIdentity, r);
  return { included, excluded, digest };
}

/** Deterministic per-path content identity stub. Real retention hashes bytes; the manifest identity binds paths to their retained digests. */
function shaContentId(path) {
  const { contentId } = require('./crypto.js');
  return contentId('path:' + path);
}

/**
 * Deterministic digest over {included paths, baseline identity, exclusion state}.
 * Used as the capture record's baselineManifestIdentity (§20 / §6).
 */
function manifestDigest(included, baselineIdentity, rules) {
  const { canonicalJson, sha256 } = require('./crypto.js');
  const view = included.map((e) => e.path).sort();
  const payload = { includedPaths: view, baselineIdentity: baselineIdentity || null, excludeDirty: rules.excludeDirty, exclusions: Object.keys(rules.exclude.exact).concat(Object.keys(rules.exclude.prefixes)).sort() };
  return sha256(canonicalJson(payload));
}

module.exports = {
  CaptureStatus,
  REJECT_RULES,
  normalizeRules,
  normalizePath,
  includeDecision,
  captureReadiness,
  buildBaselineManifest,
  manifestDigest,
};