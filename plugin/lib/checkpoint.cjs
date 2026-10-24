'use strict';
/**
 * Per-request checkpoints of the whole working tree, including untracked
 * files and changes made from the shell (which Claude Code's own rewind does
 * not cover). Each checkpoint is a git commit object under refs/tandem/, built
 * with a temporary index, so the user's index, branch and stash are untouched.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REF = 'refs/tandem/checkpoints';
const KEEP = 30;

// Snapshots must be byte-exact: no CRLF<->LF conversion on the way in or out
// (Windows git defaults to core.autocrlf=true, which would rewrite line endings on undo).
const EXACT = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.eol=lf'];

function g(root, args, env, input) {
  const r = spawnSync('git', EXACT.concat(args), { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), input, maxBuffer: 64 * 1024 * 1024, timeout: 30000, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function gitDir(root) {
  const r = g(root, ['rev-parse', '--absolute-git-dir']);
  return r.ok ? r.out : null;
}

/** Tree id of the working tree as it is now (nothing stored). */
function currentTree(root) {
  const gd = gitDir(root);
  if (!gd) return null;
  const tmpIndex = path.join(os.tmpdir(), `tandem-idx-c-${process.pid}-${Date.now()}`);
  try {
    try { fs.copyFileSync(path.join(gd, 'index'), tmpIndex); } catch { /* fresh repo */ }
    const env = { GIT_INDEX_FILE: tmpIndex };
    if (!g(root, ['add', '-A', '--', '.'], env).ok) return null;
    const t = g(root, ['write-tree'], env);
    return t.ok ? t.out : null;
  } finally { try { fs.unlinkSync(tmpIndex); } catch { /* ignore */ } }
}

/** Snapshot the working tree. Returns { sha, tree } or null. */
function create(root, label) {
  const gd = gitDir(root);
  if (!gd) return null;
  // Too many untracked files (e.g. an un-ignored node_modules) would make every prompt slow.
  const untracked = g(root, ['ls-files', '-o', '--exclude-standard', '-z']);
  if (untracked.ok && untracked.out.split('\0').length > 5000) return null;
  const tmpIndex = path.join(os.tmpdir(), `tandem-idx-${process.pid}-${Date.now()}`);
  try {
    // Start from the real index so only changed files are hashed.
    try { fs.copyFileSync(path.join(gd, 'index'), tmpIndex); } catch { /* fresh repo */ }
    const env = { GIT_INDEX_FILE: tmpIndex };
    if (!g(root, ['add', '-A', '--', '.'], env).ok) return null;
    const tree = g(root, ['write-tree'], env);
    if (!tree.ok) return null;
    const head = g(root, ['rev-parse', '--verify', '-q', 'HEAD']);
    const prev = g(root, ['rev-parse', '--verify', '-q', `${REF}/latest`]);
    if (prev.ok) {
      const prevTree = g(root, ['rev-parse', `${prev.out}^{tree}`]);
      if (prevTree.ok && prevTree.out === tree.out) return { sha: prev.out, tree: tree.out, reused: true };
    }
    const parents = head.ok ? ['-p', head.out] : [];
    const msg = `tandem checkpoint ${new Date().toISOString()}\n\n${String(label || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    const commit = g(root, ['commit-tree', tree.out, ...parents], { GIT_AUTHOR_NAME: 'tandem', GIT_AUTHOR_EMAIL: 'tandem@localhost', GIT_COMMITTER_NAME: 'tandem', GIT_COMMITTER_EMAIL: 'tandem@localhost' }, msg);
    if (!commit.ok) return null;
    const n = Date.now();
    g(root, ['update-ref', `${REF}/${n}`, commit.out]);
    g(root, ['update-ref', `${REF}/latest`, commit.out]);
    prune(root);
    return { sha: commit.out, tree: tree.out };
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch { /* ignore */ }
  }
}

/** Newest first: [{ ref, sha, at, label }] */
function list(root) {
  const r = g(root, ['for-each-ref', '--sort=-refname', '--format=%(refname)%09%(objectname)%09%(tree)%09%(contents:body)', REF]);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').filter((l) => /\/\d+\t/.test(l)).map((l) => {
    const [ref, sha, tree, ...body] = l.split('\t');
    return { ref, sha, tree, at: new Date(+ref.split('/').pop()).toISOString(), label: body.join(' ').trim().split('\n')[0] };
  });
}

function prune(root) {
  for (const c of list(root).slice(KEEP)) g(root, ['update-ref', '-d', c.ref]);
}

/**
 * Restore the working tree to a checkpoint: files it had come back with its
 * content, files created since (tracked or untracked, not ignored) are removed.
 * The current state is checkpointed first, so an undo can itself be undone.
 */
function restore(root, sha) {
  const before = create(root, 'state before tandem undo');
  const want = new Set(g(root, ['ls-tree', '-r', '--name-only', '-z', sha]).out.split('\0').filter(Boolean));
  const now = g(root, ['ls-files', '-co', '--exclude-standard', '-z']).out.split('\0').filter(Boolean);
  const removed = [];
  for (const f of now) {
    if (want.has(f)) continue;
    try { fs.unlinkSync(path.join(root, f)); removed.push(f); } catch { /* gone */ }
  }
  const tmpIndex = path.join(os.tmpdir(), `tandem-idx-r-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    g(root, ['read-tree', sha], env);
    const co = g(root, ['checkout-index', '-a', '-f'], env);
    if (!co.ok) return { ok: false, error: co.err };
  } finally { try { fs.unlinkSync(tmpIndex); } catch { /* ignore */ } }
  const changed = before ? g(root, ['diff', '--name-only', before.sha, sha]).out.split('\n').filter(Boolean) : [];
  return { ok: true, removed, restoredFrom: sha, safety: before && before.sha, changed };
}

/**
 * Checkpoints an undo can go back to, newest first: the safety snapshots taken
 * by undo itself and any snapshot identical to the current tree are skipped,
 * so "undo" always changes something.
 */
function undoTargets(root) {
  const cur = currentTree(root);
  const seen = new Set([cur]);
  const out = [];
  for (const c of list(root)) {
    if (/^state before tandem undo/.test(c.label) || seen.has(c.tree)) continue;
    seen.add(c.tree);
    out.push(c);
  }
  return out;
}

module.exports = { create, list, restore, undoTargets, currentTree, REF };
