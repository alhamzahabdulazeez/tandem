'use strict';
/**
 * Deterministic content hashing for TANDEM.
 *
 * Provides SHA-256 digests over canonical byte strings and deterministic
 * manifests over source content. These are PURE functions — usable offline
 * and required for content identity (§6), dense cluster manipulation, and
 * frozen payload integrity (§20).
 *
 * PRD reference: §6 (Content identities MUST use a versioned deterministic
 * manifest and cryptographic content digests), §20 (manifests)
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Sortable, deterministic JSON serialization.
 * - Object keys are sorted lexicographically (byte order).
 * - `undefined` values are dropped.
 * - NaN / Infinity are rejected (not valid content for a digest).
 * Produces identical bytes for identical logical content, regardless of
 * insertion order.
 *
 * @param {*} value
 * @returns {string}
 * @throws {Error} if the value contains NaN or Infinity
 */
function canonicalJson(value) {
  // Normalize NaN/Infinity to error: digesting them would silently
  // corrupt content identity.
  const seen = new Set();
  return JSON.stringify(sortValue(value, seen));
}

function sortValue(value, seen) {
  if (value === null || typeof value !== 'object') {
    validateFinite(value);
    return value;
  }
  if (seen.has(value)) {
    throw new Error('canonicalJson: circular reference detected');
  }
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((v) => sortValue(v, seen))
    : sortObject(value, seen);
  seen.delete(value);
  return result;
}

function sortObject(obj, seen) {
  const out = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // drop undefined keys
    out[key] = sortValue(v, seen);
  }
  return out;
}

function validateFinite(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`canonicalJson: non-finite number ${value} is not representable in a deterministic digest`);
  }
}

// ---------------------------------------------------------------------------
// Hashing primitives
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest of a string (UTF-8 encoded).
 * @param {string} input
 * @returns {string} 64 hex chars
 */
function sha256(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

/**
 * SHA-256 hex digest of a Buffer.
 * @param {Buffer} buffer
 * @returns {string}
 */
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Source content identity
// ---------------------------------------------------------------------------

const CONTENT_ID_PREFIX = 'sha256:';

/**
 * Content identity for a single file's bytes.
 * @param {Buffer | string} bytes
 * @returns {string} e.g. `sha256:<hex>`
 * @throws {Error} for non-string / non-Buffer input (fail closed)
 */
function contentId(bytes) {
  let buf;
  if (typeof bytes === 'string') {
    buf = Buffer.from(bytes, 'utf8');
  } else if (Buffer.isBuffer(bytes)) {
    buf = bytes;
  } else {
    throw new Error('contentId: expected a string or Buffer, got ' + (bytes === null ? 'null' : typeof bytes));
  }
  return CONTENT_ID_PREFIX + sha256Buffer(buf);
}

/**
 * Validate the syntax of a content identity string.
 * @param {string} id
 * @returns {boolean}
 */
function isContentId(id) {
  return typeof id === 'string' && /^sha256:[0-9a-f]{64}$/.test(id);
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic manifest over a set of file entries.
 *
 * Each entry is `{ path, type, mode, contentId, size }` where `path` is a
 * POSIX-style relative path. Entries are sorted by path. The manifest digest
 * is the sha256 of the canonical JSON.
 *
 * Canonicalization MUST be deterministic and MUST NOT silently change path or
 * content meaning (§6). Paths are used exactly as given (after the caller has
 * validated them).
 *
 * @param {Array<object>} entries
 * @returns {{ entries: object[], entriesDigest: string, count: number }}
 * @throws {Error} on duplicate paths or invalid entries
 */
function manifest(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('manifest: entries must be an array');
  }
  const seen = new Map();
  const normalized = entries.map((e) => {
    if (!e || typeof e !== 'object') throw new Error('manifest: entry must be an object');
    const path = e.path;
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('manifest: entry.path must be a non-empty string');
    }
    if (seen.has(path)) {
      throw new Error(`manifest: duplicate path "${path}"`);
    }
    seen.set(path, true);
    const clean = {
      path,
      type: e.type || 'file',
      mode: typeof e.mode === 'number' ? e.mode : null,
      contentId: e.contentId == null ? null : e.contentId,
      size: typeof e.size === 'number' && Number.isFinite(e.size) && e.size >= 0 ? e.size : null,
    };
    if (clean.contentId != null && !isContentId(clean.contentId)) {
      throw new Error(`manifest: invalid contentId "${clean.contentId}" for ${path}`);
    }
    return clean;
  });

  normalized.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const json = canonicalJson({ version: 1, entries: normalized });
  return {
    entries: normalized,
    entriesDigest: sha256(json),
    count: normalized.length,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  canonicalJson,
  sha256,
  sha256Buffer,
  contentId,
  isContentId,
  manifest,
  CONTENT_ID_PREFIX,
};