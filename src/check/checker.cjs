'use strict';
/**
 * `tandem check` — honest, non-executing inspection of explicitly selected
 * source content.
 *
 * PRD Contract (§22, F-05):
 * - "tandem check MUST use trusted non-executing readers. It MUST NOT import
 *   repository modules, execute package scripts, load executable configuration,
 *   run tests, or invoke untrusted plugins outside qualified supervised
 *   admission."
 * - "The checker MUST NOT claim that it prevented historical actions,
 *   intercepted unsupported agent paths, enforced past user-work protection,
 *   or guaranteed cancellation of an actor it did not control."
 * - "A missing supervised profile MUST produce a truthful checker-only or
 *   blocked result, not unsafe host execution." (§22)
 *
 * This module executes NOTHING: no child processes, no git, no script loading,
 * no configuration evaluation. It only reads directory entries and file bytes
 * within hard bounds, and computes a deterministic content manifest (§6/§20).
 *
 * The CLI layer attaches the current supervised-profile status (which, on this
 * host and repo state, is truthfully "none qualified — checker-only", per
 * docs/GATE0-AUDIT.md §J). The checker itself never asserts authority it
 * does not hold.
 */

const fs = require('node:fs');
const path = require('node:path');
const { contentId, manifest, sha256 } = require('../contracts/crypto.js');

const CHECKER_VERSION = 1;

const DEFAULTS = Object.freeze({
  // Hard bounds. These exist so the checker can report an *honest, bounded*
  // scope instead of silently truncating or pretending a partial walk is a
  // complete capture. They are inspection bounds, not task resource budgets.
  maxFileBytes: 1 * 1024 * 1024,   // skip-and-flag files larger than this
  maxFiles: 10000,                 // stop enumerating beyond this many entries
  followSymlinks: false,           // symlinks are never followed
  // Git administration is not source content (§11). Its shape is detected, but
  // its internal objects/refs are excluded from the content manifest by default.
  excludeDotGit: true,
});

/**
 * Read-only structural marker constants.
 */
const SHAPE = Object.freeze({
  FILE: 'file',
  DIRECTORY: 'directory',
  SYMLINK: 'symlink',
  SPECIAL: 'special',
  GITFILE: 'gitfile',          // .git as a file => linked worktree / gitfile shape
  GITMODULES: 'gitmodules',     // .gitmodules present => submodule indicator
  GITDIR: 'gitdir',             // .git as a directory (normal repository)
});

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/**
 * Walk a root directory non-executing, classifying entries and hashing regular
 * file bytes within bounds. Records every entry's structural kind so the
 * manifest distinguishes supported files from unsupported shapes.
 *
 * @param {string} root — absolute path to inspect
 * @param {object} [opts] — overrides of DEFAULTS
 * @returns {object} raw report (see inspect() for the envelope)
 */
function walk(root, opts) {
  const o = { ...DEFAULTS, ...(opts || {}) };
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('walk: root must be a non-empty path string');
  }
  const rootAbs = path.resolve(root);
  const stats = fs.lstatSync(rootAbs);
  if (!stats.isDirectory()) {
    throw new Error(`walk: root is not a directory: ${rootAbs}`);
  }

  const files = [];      // regular files bound for the manifest
  const unsupported = []; // structural problems
  const lineage = [];    // every path -> kind (for traceability)
  const excludedDirectories = []; // dirs intentionally excluded from content (e.g. .git)
  let filesRead = 0;
  let filesSkipped = 0;
  let totalBytes = 0;
  let truncated = false;
  let enumerationStopped = false;
  let rootKind = SHAPE.DIRECTORY;

  // Detect repository-shape markers at the inspected root only. Normal shapes
  // (gitdir, none) are recorded as facts; problematic shapes are surfaced as
  // unsupported so a checker report never claims a complete capture of work
  // it structurally cannot hold.
  const repoShape = detectRootShape(rootAbs, (kind, reason) => {
    if (kind === SHAPE.SYMLINK) rootKind = SHAPE.SYMLINK;
    unsupported.push({ path: '.git', kind, reason });
  });

  const stack = [rootAbs];
  while (stack.length > 0 && !enumerationStopped) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // A directory we cannot read is dropped from the "complete capture"
      // claim; it is surfaced as an unsupported/scope gap, never silently.
      filesSkipped++;
      unsupported.push({ path: path.relative(rootAbs, dir) || '.', kind: SHAPE.SPECIAL, reason: `unreadable directory: ${e.code || e.message}` });
      continue;
    }
    for (const ent of entries) {
      if (files.length + filesSkipped >= o.maxFiles) {
        enumerationStopped = true;
        truncated = true;
        filesSkipped += 1; // the un-enumerated remainder is a scope gap
        break;
      }
      const full = path.join(dir, ent.name);
      const rel = path.relative(rootAbs, full).split(path.sep).join('/');
      let kind;
      try {
        kind = entryKind(full, ent);
      } catch (e) {
        unsupported.push({ path: rel, kind: SHAPE.SPECIAL, reason: `stat failed: ${e.code || e.message}` });
        continue;
      }

      // Git administration (.git) is not source content (§11): exclude its
      // internal files from the manifest, but record the exclusion explicitly
      // so nothing is silently dropped.
      if (o.excludeDotGit && kind === SHAPE.DIRECTORY && rel === '.git') {
        excludedDirectories.push(rel);
        lineage.push({ path: rel, kind: SHAPE.GITDIR });
        continue;
      }

      lineage.push({ path: rel, kind });

      switch (kind) {
        case SHAPE.DIRECTORY:
          stack.push(full);
          break;
        case SHAPE.SYMLINK:
        case SHAPE.SPECIAL:
          filesSkipped++;
          unsupported.push({ path: rel, kind, reason: kind === SHAPE.SYMLINK ? 'symlink' : 'special file (fifo/socket/device)' });
          break;
        case SHAPE.FILE: {
          const sf = fs.statSync(full);
          if (sf.size > o.maxFileBytes) {
            filesSkipped++;
            truncated = truncated || sf.size > o.maxFileBytes;
            unsupported.push({ path: rel, kind: SHAPE.FILE, reason: `file exceeds ${o.maxFileBytes} bytes inspection bound` });
            continue;
          }
          const bytes = fs.readFileSync(full);
          files.push({
            path: rel,
            type: 'file',
            mode: sf.mode,
            size: bytes.length,
            contentId: contentId(bytes),
          });
          filesRead++;
          totalBytes += bytes.length;
          break;
        }
      }
    }
  }

  const man = manifest(files);

  return {
    root: rootAbs,
    version: CHECKER_VERSION,
    filesRead,
    filesSkipped,
    totalBytes,
    truncated,
    enumerationStopped,
    files,
    unsupported,
    lineage,
    excludedDirectories,
    rootKind,
    repoShape,
    manifest: { count: man.count, entriesDigest: man.entriesDigest },
  };
}

/**
 * Classify one directory entry without following symlinks.
 * @param {string} full
 * @param {fs.Dirent} ent
 * @returns {string} one of SHAPE.*
 */
function entryKind(full, ent) {
  if (ent.isSymbolicLink()) return SHAPE.SYMLINK;
  if (ent.isDirectory()) return SHAPE.DIRECTORY;
  if (ent.isFile()) return SHAPE.FILE;
  return SHAPE.SPECIAL;
}

/**
 * Detect repository-shape markers at root, read-only.
 * Returns the identified repo shape (normal gitdir / gitfile / none / symlink)
 * and calls onMarker(kind, reason) ONLY for problematic shapes that must be
 * surfaced as unsupported.
 * @param {string} rootAbs
 * @param {(kind: string, reason: string) => void} onMarker
 * @returns {string} repo shape id
 */
function detectRootShape(rootAbs, onMarker) {
  const gitPath = path.join(rootAbs, '.git');
  let shape = 'none';
  try {
    const gitStat = fs.lstatSync(gitPath);
    if (gitStat.isSymbolicLink()) {
      onMarker(SHAPE.SYMLINK, '.git is a symlink');
      return SHAPE.SYMLINK;
    }
    if (gitStat.isFile()) {
      // A `.git` file (contents: "gitdir: <path>") identifies a linked
      // worktree or monorepo submodule checkout. Reading its first line is
      // pure data inspection — no execution.
      const firstLine = fs.readFileSync(gitPath, 'utf8').split(/\r?\n/, 1)[0] || '';
      const reason = firstLine.startsWith('gitdir:') ? 'linked worktree (gitdir: lines)' : '.git is a file';
      onMarker(SHAPE.GITFILE, reason);
      return SHAPE.GITFILE;
    }
    if (gitStat.isDirectory()) {
      shape = SHAPE.GITDIR; // normal repository — a supported shape, no marker
    }
  } catch (e) {
    if (e.code !== 'ENOENT') onMarker(SHAPE.SPECIAL, `.git inspection failed: ${e.code || e.message}`);
  }

  const modulesPath = path.join(rootAbs, '.gitmodules');
  try {
    if (fs.statSync(modulesPath).isFile()) {
      onMarker(SHAPE.GITMODULES, '.gitmodules present (submodule indicator)');
    }
  } catch (e) {
    if (e.code !== 'ENOENT') onMarker(SHAPE.SPECIAL, `.gitmodules inspection failed: ${e.code || e.message}`);
  }

  return shape;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce the honest check report.
 *
 * The report explicitly separates what was inspected from what was NOT:
 * - files + manifest have deterministic content identities;
 * - unsupported shapes and scope gaps are surfaced, not omitted;
 * - no execution, prevention, or supervision claim is made.
 *
 * @param {string} root — directory to inspect
 * @param {object} [opts]
 * @returns {object} immutable-ish report object
 */
function inspect(root, opts) {
  const raw = walk(root, opts);

  const report = {
    generator: 'tandem-check',
    version: CHECKER_VERSION,
    inspectedRoot: raw.root,
    scope: {
      entriesEnumerated: raw.lineage.length,
      filesRead: raw.filesRead,
      filesSkipped: raw.filesSkipped,
      totalBytesRead: raw.totalBytes,
      truncated: raw.truncated,
      enumerationStopped: raw.enumerationStopped,
    },
    rootKind: raw.rootKind,
    repoShape: raw.repoShape,
    manifest: { count: raw.manifest.count, entriesDigest: raw.manifest.entriesDigest, entries: raw.files },
    excludedDirectories: raw.excludedDirectories,
    unsupported: raw.unsupported,
    // Explicit honesty block. These are limitations, not accomplishments.
    claims: {
      executed: false,
      preventedAnything: false,
      supervisedExecution: false,
      // A capture is only "complete" when nothing was dropped by bounds AND
      // no structural shape (symlink, gitfile, submodule, oversized file)
      // made part of the tree non-representable in the supported file set.
      completeCapture: !raw.truncated && !raw.enumerationStopped && raw.unsupported.length === 0,
    },
  };

  return Object.freeze(report);
}

/** Stable digest over the report's manifest only (content identity). */
function reportContentDigest(report) {
  return report.manifest ? report.manifest.entriesDigest : sha256('{}');
}

module.exports = {
  CHECKER_VERSION,
  SHAPE,
  DEFAULTS,
  walk,
  inspect,
  reportContentDigest,
};