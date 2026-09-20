'use strict';
/**
 * packages/tandem-check/lib/inspect.cjs
 *
 * Model-free, non-executing inspection of directory contents and deterministic
 * manifest calculation with zero external dependencies.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CHECKER_VERSION = 1;

const DEFAULTS = Object.freeze({
  maxFileBytes: 1 * 1024 * 1024,   // skip-and-flag files larger than this
  maxFiles: 10000,                 // stop enumerating beyond this many entries
  followSymlinks: false,           // symlinks are never followed
  excludeDotGit: true,             // exclude .git internal files from manifest
});

const SHAPE = Object.freeze({
  FILE: 'file',
  DIRECTORY: 'directory',
  SYMLINK: 'symlink',
  SPECIAL: 'special',
  GITFILE: 'gitfile',          // .git as a file => linked worktree
  GITMODULES: 'gitmodules',     // .gitmodules present => submodule
  GITDIR: 'gitdir',             // .git as a directory (normal repo)
});

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function computeContentId(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

function computeManifest(files) {
  const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path));
  const raw = sorted.map((f) => `${f.path}:${f.contentId}:${f.size}:${f.mode}`).join('\n');
  return {
    count: sorted.length,
    entriesDigest: sha256Hex(raw),
    entries: sorted,
  };
}

function entryKind(full, ent) {
  if (ent.isSymbolicLink()) return SHAPE.SYMLINK;
  if (ent.isDirectory()) return SHAPE.DIRECTORY;
  if (ent.isFile()) return SHAPE.FILE;
  return SHAPE.SPECIAL;
}

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
      const firstLine = fs.readFileSync(gitPath, 'utf8').split(/\r?\n/, 1)[0] || '';
      const reason = firstLine.startsWith('gitdir:') ? 'linked worktree (gitdir: lines)' : '.git is a file';
      onMarker(SHAPE.GITFILE, reason);
      return SHAPE.GITFILE;
    }
    if (gitStat.isDirectory()) {
      shape = SHAPE.GITDIR;
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

  const files = [];
  const unsupported = [];
  const lineage = [];
  const excludedDirectories = [];
  let filesRead = 0;
  let filesSkipped = 0;
  let totalBytes = 0;
  let truncated = false;
  let enumerationStopped = false;
  let rootKind = SHAPE.DIRECTORY;

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
      filesSkipped++;
      unsupported.push({ path: path.relative(rootAbs, dir) || '.', kind: SHAPE.SPECIAL, reason: `unreadable directory: ${e.code || e.message}` });
      continue;
    }
    for (const ent of entries) {
      if (files.length + filesSkipped >= o.maxFiles) {
        enumerationStopped = true;
        truncated = true;
        filesSkipped += 1;
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
            contentId: computeContentId(bytes),
          });
          filesRead++;
          totalBytes += bytes.length;
          break;
        }
      }
    }
  }

  const man = computeManifest(files);

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
    claims: {
      executed: false,
      preventedAnything: false,
      supervisedExecution: false,
      completeCapture: !raw.truncated && !raw.enumerationStopped && raw.unsupported.length === 0,
    },
  };

  return Object.freeze(report);
}

function reportContentDigest(report) {
  return report.manifest ? report.manifest.entriesDigest : sha256Hex('{}');
}

module.exports = {
  CHECKER_VERSION,
  SHAPE,
  DEFAULTS,
  walk,
  inspect,
  reportContentDigest,
};
