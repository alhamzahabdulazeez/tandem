'use strict';
/**
 * Shared helpers: hook I/O, project paths, git, per-session state, config.
 * Zero dependencies. Every function is defensive: the supervisor must never
 * crash Claude Code, so failures degrade to "no decision".
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DEFAULT_CONFIG = Object.freeze({
  mode: 'enforce',          // enforce | observe | off
  autoApprove: true,        // pre-approve safe in-project edits and safe shell commands
  testCommand: null,        // null = detect
  testTimeoutSec: 300,
  maxRepairs: 3,            // Stop-hook blocks per prompt before handing back
  repeatLimit: 3,           // identical shell command runs with no edit in between
  protect: [],              // extra path regexes (strings) that are write-protected
  allowTestEdits: null,     // null = decide from the prompt; true/false = force
  testPolicy: 'append-only', // append-only | readonly | free (when the request does not ask for tests)
  allowPush: false,         // git push needs the owner unless this is true
  compactOutput: true,      // route test/build/lint output through the compactor
  checkImports: true,       // new imports must resolve before Claude may finish
  checkPackages: true,      // installs of non-existent or brand-new packages are refused
  allowPackages: [],        // package names exempt from the brand-new check
  checkSecrets: true,       // refuse credentials written into source or commits
});

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function projectDir(input) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd());
}

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/** Path relative to the project, posix separators, or null when outside it. */
function relToProject(root, file) {
  if (!file) return null;
  const abs = path.resolve(root, String(file));
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function git(root, args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeout || 20000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

function isGitRepo(root) {
  const out = git(root, ['rev-parse', '--is-inside-work-tree']);
  return !!out && out.trim() === 'true';
}

/** State lives inside .git so it never shows up in the user's working tree. */
function stateDir(root) {
  let dir = null;
  const gd = git(root, ['rev-parse', '--git-dir']);
  if (gd && gd.trim()) dir = path.join(path.resolve(root, gd.trim()), 'tandem');
  else {
    const h = crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
    dir = path.join(os.tmpdir(), `tandem-${h}`);
  }
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* best effort */ }
}

function emptySession() {
  return {
    prompt: '',
    promptCount: 0,
    scope: { named: [], testsAllowed: false, reason: '' },
    changed: [],
    blocks: [],
    repairs: 0,
    lastFailSig: null,
    sameFailCount: 0,
    lastCommand: null,
    commandRepeats: 0,
    toolCalls: 0,
    lastVerify: null,
  };
}

function sessionFile(dir, id) {
  const safe = String(id || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(dir, 'sessions', `${safe}.json`);
}

function loadSession(dir, id) {
  return Object.assign(emptySession(), readJson(sessionFile(dir, id), {}));
}

function saveSession(dir, id, s) {
  writeJson(sessionFile(dir, id), s);
}

function loadConfig(root) {
  const fromFile = readJson(path.join(root, '.claude', 'tandem.json'), {});
  const cfg = Object.assign({}, DEFAULT_CONFIG, fromFile);
  if (process.env.TANDEM_MODE) cfg.mode = process.env.TANDEM_MODE;
  if (process.env.TANDEM_AUTO_APPROVE) cfg.autoApprove = !/^(0|false|off|no)$/i.test(process.env.TANDEM_AUTO_APPROVE);
  if (process.env.TANDEM_TEST_COMMAND) cfg.testCommand = process.env.TANDEM_TEST_COMMAND;
  if (process.env.TANDEM_TEST_POLICY) cfg.testPolicy = process.env.TANDEM_TEST_POLICY;
  if (process.env.TANDEM_COMPACT) cfg.compactOutput = !/^(0|false|off|no)$/i.test(process.env.TANDEM_COMPACT);
  return cfg;
}

function logLine(dir, line) {
  try { fs.appendFileSync(path.join(dir, 'events.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* ignore */ }
}

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

module.exports = {
  DEFAULT_CONFIG,
  readStdin,
  projectDir,
  relToProject,
  toPosix,
  git,
  isGitRepo,
  stateDir,
  readJson,
  writeJson,
  loadSession,
  saveSession,
  emptySession,
  loadConfig,
  logLine,
  sha,
};
