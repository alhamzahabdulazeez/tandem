#!/usr/bin/env node
'use strict';
/**
 * Tandem autopilot: one entry point for every Claude Code hook event.
 *
 *   node hook.cjs SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop | Baseline
 *
 * Decisions are deterministic. No model is called. Internal errors fail open
 * (the action proceeds) and are logged, so a bug here can never brick a session.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const U = require('../lib/util.cjs');
const P = require('../lib/policy.cjs');
const S = require('../lib/scope.cjs');
const V = require('../lib/verify.cjs');
const C = require('../lib/compact.cjs');

const EVENT = process.argv[2] || '';
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// ------------------------------------------------------------------ output --

function emit(obj, { exitCode = 0, stderr = '' } = {}) {
  if (obj) process.stdout.write(JSON.stringify(obj));
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
}

// Exit 2 plus JSON: current versions read the JSON decision, older ones fall
// back to "exit 2 + stderr", which blocks on every version we have probed.
function denyTool(reason) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } },
    { exitCode: 2, stderr: reason });
}
function allowTool(reason, updatedInput) {
  const o = { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason };
  if (updatedInput) o.updatedInput = updatedInput;
  emit({ hookSpecificOutput: o });
}
function rewriteTool(updatedInput) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } });
}

/** Route a test/build command through scripts/run.cjs so only the useful part of its output reaches the model. */
function compactedInput(tool, ti, cfg) {
  if (tool !== 'Bash' || cfg.compactOutput === false) return null;
  const cmd = String(ti.command || '').trim();
  if (!C.isCompactable(cmd)) return null;
  const runner = U.toPosix(path.join(__dirname, 'run.cjs'));
  return Object.assign({}, ti, { command: `node "${runner}" ${Buffer.from(cmd, 'utf8').toString('base64')}` });
}
function feedback(reason) { emit({ decision: 'block', reason }, { exitCode: 2, stderr: reason }); }
function context(event, text) { emit({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }); }
function blockStop(reason) { emit({ decision: 'block', reason }, { exitCode: 2, stderr: reason }); }
function allowStop(message) { emit(message ? { systemMessage: message } : null); }

// ------------------------------------------------------------------- state --

function trackedFiles(root) {
  const out = U.git(root, ['ls-files', '-co', '--exclude-standard']);
  return out ? out.split('\n').filter(Boolean) : [];
}

/** Dirty files with a content hash, so "changed this turn" is exact. */
function dirtySnapshot(root) {
  const out = U.git(root, ['status', '--porcelain', '-uall']);
  const snap = {};
  if (!out) return snap;
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    file = file.replace(/^"|"$/g, '');
    let h = 'deleted';
    try { h = U.sha(fs.readFileSync(path.join(root, file))); } catch { /* deleted */ }
    snap[file] = h;
  }
  return snap;
}

function changedSince(root, snapshot, session) {
  const now = dirtySnapshot(root);
  const changed = new Set();
  for (const [f, h] of Object.entries(now)) if (snapshot[f] !== h) changed.add(f);
  for (const f of Object.keys(snapshot)) if (!(f in now)) changed.add(f); // reverted to HEAD
  for (const f of session.changed || []) changed.add(f);
  return Array.from(changed).filter((f) => !f.startsWith('.git/')).sort();
}

function diffStat(root, files) {
  let add = 0; let del = 0;
  if (!files.length) return { add, del };
  const out = U.git(root, ['diff', '--numstat', 'HEAD', '--', ...files]) || '';
  const seen = new Set();
  for (const l of out.split('\n')) {
    const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    seen.add(m[3]);
    add += m[1] === '-' ? 0 : +m[1];
    del += m[2] === '-' ? 0 : +m[2];
  }
  for (const f of files) {
    if (seen.has(f)) continue;
    try { add += fs.readFileSync(path.join(root, f), 'utf8').split('\n').length; } catch { /* deleted */ }
  }
  return { add, del };
}

function headContent(root, rel) {
  return U.git(root, ['show', `HEAD:${rel}`]);
}

// ------------------------------------------------------------------ events --

function onSessionStart(input, root, dir, cfg) {
  const session = U.loadSession(dir, input.session_id);
  const test = V.detectTestCommand(root, cfg);
  const lines = [
    'Tandem supervisor is active in this project. It decides automatically; you do not need to ask the user about these rules.',
    test
      ? `- Before you finish, Tandem runs \`${test.command}\`. If it fails you will be asked to fix the implementation and finish again.`
      : '- No test command was detected; Tandem will syntax-check what you change before you finish.',
    cfg.testPolicy === 'readonly'
      ? '- Test files are read-only unless the request asks for test changes. Never remove assertions or add .skip/.only.'
      : '- Existing tests are append-only unless the request asks for test changes: add new cases freely, never change or delete existing ones, never add .skip/.only. If a request conflicts with an existing test, stop and tell the user instead of editing that test.',
    '- Writes to .env, keys, lockfiles, CI config and .claude settings are blocked unless the request names them.',
    '- Destructive commands are blocked: git reset --hard, git clean -f, git push, rm -rf of roots, sudo, package publish.',
    `- Running the same command ${cfg.repeatLimit} times with no code change in between is blocked; change something first.`,
  ];
  const files = trackedFiles(root);
  if (files.length && files.length <= 4000) {
    try {
      const graph = require('../lib/depgraph.cjs').build(root);
      const top = Object.entries(graph.dependents)
        .map(([f, d]) => [f, d.length]).filter(([f, n]) => n >= 3 && !P.isTestFile(f))
        .sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (top.length) lines.push(`- Most-imported files (a change here has a wide blast radius): ${top.map(([f, n]) => `${f} (${n})`).join(', ')}`);
    } catch { /* graph is optional */ }
  }
  if (input.source === 'compact' && session.prompt) {
    lines.push(`- Current task scope: ${session.scope.named.length ? session.scope.named.join(', ') : 'no files named'}; ${session.scope.reason}.`);
  }
  if (test && (input.source === 'startup' || input.source === 'clear' || !input.source)) startBaseline(root, dir, cfg, test.command);
  context('SessionStart', lines.join('\n'));
}

function baselineKey(root) {
  const head = (U.git(root, ['rev-parse', 'HEAD']) || 'nohead').trim();
  return `${head}:${U.sha(JSON.stringify(dirtySnapshot(root))).slice(0, 16)}`;
}

function startBaseline(root, dir, cfg, command) {
  const file = path.join(dir, 'baseline.json');
  const key = baselineKey(root);
  const cur = U.readJson(file, null);
  if (cur && cur.key === key && (cur.status === 'done' || (cur.status === 'running' && Date.now() - cur.started < 15 * 60000))) return;
  U.writeJson(file, { key, status: 'running', started: Date.now(), command });
  try {
    const child = spawn(process.execPath, [__filename, 'Baseline'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: Object.assign({}, process.env, { TANDEM_BASELINE_KEY: key, TANDEM_ROOT: root }),
    });
    child.unref();
  } catch (e) { U.logLine(dir, `baseline spawn failed: ${e.message}`); }
}

function onBaseline() {
  const root = path.resolve(process.env.TANDEM_ROOT || process.cwd());
  const dir = U.stateDir(root);
  const cfg = U.loadConfig(root);
  const test = V.detectTestCommand(root, cfg);
  const file = path.join(dir, 'baseline.json');
  if (!test) { U.writeJson(file, { key: process.env.TANDEM_BASELINE_KEY, status: 'none' }); return; }
  const r = V.runTests(root, test.command, cfg.testTimeoutSec);
  U.writeJson(file, {
    key: process.env.TANDEM_BASELINE_KEY,
    status: 'done',
    command: test.command,
    passed: r.passed,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    failSig: V.failSignature(r.output),
    ms: r.ms,
    at: new Date().toISOString(),
  });
}

function onUserPrompt(input, root, dir, cfg) {
  const session = U.loadSession(dir, input.session_id);
  const prompt = String(input.prompt || '');
  session.prompt = prompt.slice(0, 4000);
  session.promptCount += 1;
  session.scope = S.derive(prompt, trackedFiles(root));
  session.snapshot = dirtySnapshot(root);
  session.changed = [];
  session.repairs = 0;
  session.lastFailSig = null;
  session.sameFailCount = 0;
  session.lastCommand = null;
  session.commandRepeats = 0;
  session.turnBlocks = [];
  U.saveSession(dir, input.session_id, session);

  const test = V.detectTestCommand(root, cfg);
  const named = session.scope.named;
  const lines = [
    `Tandem scope for this request: ${named.length ? `files named: ${named.join(', ')}` : 'no specific files named'}.`,
    session.scope.testsAllowed
      ? 'Test changes are allowed for this request, but assertions may not be removed or skipped.'
      : cfg.testPolicy === 'readonly'
        ? `Test files are read-only for this request (${session.scope.reason}). Put the change in the implementation${input.scratchpad_dir ? `; throwaway checks go in ${input.scratchpad_dir}` : ''}.`
        : `Existing tests are append-only for this request (${session.scope.reason}): you may add new test cases, but do not change or delete existing ones. If the request conflicts with an existing test, stop and explain the conflict to the user instead of editing that test.`,
    test ? `Tandem will run \`${test.command}\` before you finish.` : 'Tandem will syntax-check changed files before you finish.',
  ];
  context('UserPromptSubmit', lines.join('\n'));
}

function onPreToolUse(input, root, dir, cfg) {
  const session = U.loadSession(dir, input.session_id);
  session.toolCalls += 1;
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  let verdict = { decision: 'none' };
  let key = tool;

  if (WRITE_TOOLS.has(tool)) {
    const file = ti.file_path || ti.notebook_path || ti.path;
    const abs = file ? path.resolve(root, String(file)) : null;
    const rel = U.relToProject(root, file);
    key = rel || abs || 'unknown';
    let before = null;
    let exists = false;
    if (abs) { try { before = fs.readFileSync(abs, 'utf8'); exists = true; } catch { /* new file */ } }
    const priorBlocks = (session.blocks || []).filter((b) => b.key === key).length;
    verdict = P.decideWrite({
      rel, absPath: abs, exists, toolName: tool, input: ti, before,
      scope: session.scope, cfg, scratch: input.scratchpad_dir || null, priorBlocks,
    });
    if (verdict.decision !== 'deny') { session.lastCommand = null; session.commandRepeats = 0; }
  } else if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '').trim();
    key = cmd.slice(0, 200);
    const repeats = cmd === session.lastCommand ? session.commandRepeats : 0;
    verdict = P.decideBash({ command: cmd, scope: session.scope, cfg, repeats, toRel: (p) => U.relToProject(root, p) });
    if (verdict.decision !== 'deny') { session.lastCommand = cmd; session.commandRepeats = repeats + 1; }
  }

  if (verdict.decision === 'deny') {
    session.blocks = (session.blocks || []).concat([{ key, rule: verdict.rule, tool, at: Date.now() }]).slice(-200);
    U.logLine(dir, `deny ${verdict.rule} ${tool} ${key}`);
  }
  U.saveSession(dir, input.session_id, session);

  if (cfg.mode === 'observe') return emit(null);
  if (verdict.decision === 'deny') return denyTool(verdict.reason);
  const rewritten = compactedInput(tool, ti, cfg);
  if (verdict.decision === 'allow') return allowTool(`Tandem: ${verdict.rule}`, rewritten);
  if (rewritten) return rewriteTool(rewritten);
  return emit(null);
}

function onPostToolUse(input, root, dir, cfg) {
  const tool = input.tool_name;
  if (!WRITE_TOOLS.has(tool)) return emit(null);
  const ti = input.tool_input || {};
  const rel = U.relToProject(root, ti.file_path || ti.notebook_path || ti.path);
  if (!rel) return emit(null);
  const session = U.loadSession(dir, input.session_id);
  if (!session.changed.includes(rel)) session.changed.push(rel);
  U.saveSession(dir, input.session_id, session);
  const err = V.syntaxCheck(root, rel);
  if (err && cfg.mode !== 'observe') return feedback(`Tandem: ${rel} no longer parses after this edit:\n${err}\nFix it before doing anything else.`);
  return emit(null);
}

function writeReceipt(dir, receipt) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  U.writeJson(path.join(dir, 'receipts', `${stamp}.json`), receipt);
  const lines = [
    `# Tandem receipt ${receipt.at}`,
    '',
    `- Verdict: ${receipt.verdict}`,
    `- Files changed: ${receipt.files.length ? receipt.files.join(', ') : 'none'} (+${receipt.add} -${receipt.del})`,
    `- Blocked actions: ${receipt.blocks.length}${receipt.blocks.length ? ` (${Array.from(new Set(receipt.blocks.map((b) => b.rule))).join(', ')})` : ''}`,
    `- Tests: ${receipt.tests || 'not run'}`,
    `- Repair rounds: ${receipt.repairs}`,
    receipt.note ? `- Note: ${receipt.note}` : '',
  ].filter(Boolean);
  try { fs.writeFileSync(path.join(dir, 'last-receipt.md'), `${lines.join('\n')}\n`); } catch { /* ignore */ }
}

function onStop(input, root, dir, cfg) {
  const session = U.loadSession(dir, input.session_id);
  const changed = changedSince(root, session.snapshot || {}, session);
  if (!changed.length) return allowStop(null);

  const blocks = (session.blocks || []).filter((b) => !session.turnStart || b.at >= session.turnStart);
  const { add, del } = diffStat(root, changed);
  const base = { at: new Date().toISOString(), prompt: session.prompt.slice(0, 300), files: changed, add, del, blocks, repairs: session.repairs };
  const finish = (verdict, tests, note, message) => {
    writeReceipt(dir, Object.assign({}, base, { verdict, tests, note }));
    U.saveSession(dir, input.session_id, session);
    return allowStop(message);
  };
  const enforce = cfg.mode !== 'observe';
  const repair = (reason, sig) => {
    if (!enforce) return finish('observed-failure', null, reason.slice(0, 200), `Tandem (observe mode): ${reason.split('\n')[0]}`);
    if (sig && sig === session.lastFailSig) session.sameFailCount += 1; else session.sameFailCount = 0;
    session.lastFailSig = sig || null;
    if (session.repairs >= cfg.maxRepairs || session.sameFailCount >= 2) {
      return finish('handed-back', null, reason.slice(0, 300),
        `Tandem: still failing after ${session.repairs} repair round(s); handing back to you. ${reason.split('\n')[0]}`);
    }
    session.repairs += 1;
    U.saveSession(dir, input.session_id, session);
    return blockStop(`${reason}\n\nRepair round ${session.repairs}/${cfg.maxRepairs}. Fix the implementation, not the tests, then finish again.`);
  };

  // 1. Every changed file still parses.
  const syntax = changed.map((f) => [f, V.syntaxCheck(root, f)]).filter(([, e]) => e);
  if (syntax.length) {
    return repair(`Tandem checked your changes before letting you finish: ${syntax.length} file(s) do not parse.\n${syntax.map(([f, e]) => `${f}: ${e}`).join('\n')}`, `syntax:${syntax.map(([f]) => f).join(',')}`);
  }

  // 2. No test was weakened, by any route (Edit tool or shell).
  const weak = [];
  for (const f of changed.filter((x) => P.isTestFile(x))) {
    if (session.snapshot && session.snapshot[f]) continue; // user had it dirty before this turn
    let after = null;
    try { after = fs.readFileSync(path.join(root, f), 'utf8'); } catch { after = ''; }
    const before = headContent(root, f);
    if (before == null) continue;
    const w = P.weakening(before, after);
    if (after === '') w.push('deletes the test file');
    const testsAllowed = cfg.allowTestEdits === true || (cfg.allowTestEdits !== false && (session.scope.testsAllowed || (session.scope.named || []).includes(f)));
    if (!testsAllowed && cfg.testPolicy !== 'free' && after !== '' && !P.isAppendOnly(before, after)) w.push('changes or removes existing test lines although the request did not ask for test changes');
    if (w.length) weak.push(`${f}: ${w.join('; ')}`);
  }
  if (weak.length) {
    return repair(`Tandem found changed or weakened tests in this change:\n${weak.join('\n')}\nRestore the assertions and make the implementation satisfy them.`, `weak:${weak.join('|')}`);
  }

  // 3. The project's own tests pass, or fail only where they already failed.
  const test = V.detectTestCommand(root, cfg);
  if (!test) return finish('syntax-only', null, 'no test command detected', `Tandem: ${changed.length} file(s) changed (+${add} -${del}); syntax OK; no test command found.`);

  const digest = U.sha(changed.map((f) => { try { return f + U.sha(fs.readFileSync(path.join(root, f))); } catch { return `${f}:gone`; } }).join('|'));
  let r;
  if (session.lastVerify && session.lastVerify.digest === digest) r = session.lastVerify.result;
  else {
    const full = V.runTests(root, test.command, cfg.testTimeoutSec);
    r = { passed: full.passed, exitCode: full.exitCode, timedOut: full.timedOut, zeroTests: full.zeroTests, ms: full.ms, summary: V.summarize(full.output), sig: V.failSignature(full.output) };
    session.lastVerify = { digest, result: r };
  }

  if (r.passed) {
    return finish('verified', `\`${test.command}\` passed (${Math.round(r.ms / 1000)}s)`, null,
      `Tandem verified: ${changed.length} file(s) changed (+${add} -${del}), \`${test.command}\` passed, ${blocks.length} action(s) blocked.`);
  }
  if (r.timedOut) {
    return finish('unverified', `\`${test.command}\` timed out after ${cfg.testTimeoutSec}s`, null,
      `Tandem: \`${test.command}\` timed out after ${cfg.testTimeoutSec}s; change NOT verified.`);
  }
  if (r.zeroTests) {
    return finish('unverified', `\`${test.command}\` ran zero tests`, null, `Tandem: \`${test.command}\` ran zero tests; change NOT verified.`);
  }

  const baseline = U.readJson(path.join(dir, 'baseline.json'), null);
  if (baseline && baseline.status === 'done' && baseline.passed === false) {
    const before = new Set(String(baseline.failSig || '').split('\n').filter(Boolean));
    const now = String(r.sig || '').split('\n').filter(Boolean);
    const fresh = now.filter((l) => !before.has(l));
    if (!fresh.length) {
      return finish('pre-existing-failures', `\`${test.command}\` fails exactly as it did before this session`, null,
        `Tandem: ${changed.length} file(s) changed (+${add} -${del}); \`${test.command}\` already failed before this session and fails the same way now.`);
    }
  }

  return repair(`Tandem ran \`${test.command}\` before letting you finish, and it fails (exit ${r.exitCode}).\n${r.summary}`, r.sig);
}

// -------------------------------------------------------------------- main --

function main() {
  if (EVENT === 'Baseline') return onBaseline();
  const input = U.readStdin();
  const root = U.projectDir(input);
  const cfg = U.loadConfig(root);
  if (cfg.mode === 'off' || process.env.TANDEM_HOOKS === 'off') return emit(null);
  const dir = U.stateDir(root);
  try {
    if (EVENT === 'UserPromptSubmit') {
      const s = U.loadSession(dir, input.session_id);
      s.turnStart = Date.now();
      U.saveSession(dir, input.session_id, s);
    }
    switch (EVENT) {
      case 'SessionStart': return onSessionStart(input, root, dir, cfg);
      case 'UserPromptSubmit': return onUserPrompt(input, root, dir, cfg);
      case 'PreToolUse': return onPreToolUse(input, root, dir, cfg);
      case 'PostToolUse': return onPostToolUse(input, root, dir, cfg);
      case 'Stop': return onStop(input, root, dir, cfg);
      default: return emit(null);
    }
  } catch (e) {
    U.logLine(dir, `internal error in ${EVENT}: ${(e && e.stack) || e}`);
    return emit(null); // fail open
  }
}

main();
