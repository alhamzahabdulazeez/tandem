#!/usr/bin/env node
'use strict';
/**
 * Tandem commands for the user.
 *
 *   tandem undo [n]        restore the working tree to the checkpoint taken at
 *                          the start of the last request (or n requests back)
 *   tandem redo            reverse the last undo
 *   tandem checkpoints     list checkpoints
 *   tandem receipt         show the last verification receipt
 *   tandem stats           what Tandem did in this repository
 *
 * Run from the project directory. Exposed in Claude Code as /tandem:undo etc.
 */

const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util.cjs');
const CP = require('../lib/checkpoint.cjs');

const [cmd = 'help', arg] = process.argv.slice(2);
const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const out = (s) => process.stdout.write(`${s}\n`);

function rel(t) {
  const s = Math.round((Date.now() - Date.parse(t)) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

if (!U.isGitRepo(root)) { out('tandem: not a git repository; checkpoints and receipts need git.'); process.exit(1); }

if (cmd === 'checkpoints') {
  const cps = CP.list(root);
  if (!cps.length) out('No checkpoints yet. Tandem takes one at the start of every request.');
  cps.forEach((c, i) => out(`${String(i + 1).padStart(2)}  ${rel(c.at).padEnd(12)} ${c.sha.slice(0, 8)}  ${c.label || ''}`));
} else if (cmd === 'undo') {
  const n = Math.max(1, parseInt(arg || '1', 10) || 1);
  const cps = CP.undoTargets(root);
  const target = cps[n - 1];
  if (!target) { out(cps.length ? `tandem undo: only ${cps.length} earlier state(s) to go back to.` : 'tandem undo: nothing to undo; the working tree matches every checkpoint.'); process.exit(cps.length ? 1 : 0); }
  const r = CP.restore(root, target.sha);
  if (!r.ok) { out(`tandem undo failed: ${r.error}`); process.exit(1); }
  out(`Restored the working tree to the checkpoint from ${rel(target.at)}: "${target.label}".`);
  const touched = Array.from(new Set(r.changed.concat(r.removed)));
  out(touched.length ? `Files changed back: ${touched.slice(0, 30).join(', ')}${touched.length > 30 ? ` (+${touched.length - 30} more)` : ''}` : 'Nothing differed.');
  if (r.safety) out('The state before this undo is saved: /tandem:redo brings it back.');
} else if (cmd === 'redo') {
  const cur = CP.currentTree(root);
  const back = CP.list(root).find((c) => /^state before tandem undo/.test(c.label) && c.tree !== cur);
  if (!back) { out('tandem redo: no undo to reverse.'); process.exit(0); }
  const r = CP.restore(root, back.sha);
  if (!r.ok) { out(`tandem redo failed: ${r.error}`); process.exit(1); }
  const touched = Array.from(new Set(r.changed.concat(r.removed)));
  out(`Brought back the state from before the last undo (${rel(back.at)}).${touched.length ? ` Files: ${touched.slice(0, 30).join(', ')}` : ''}`);
} else if (cmd === 'receipt') {
  const f = path.join(U.stateDir(root), 'last-receipt.md');
  out(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : 'No receipt yet: Tandem writes one when Claude finishes a change.');
} else if (cmd === 'stats') {
  const dir = U.stateDir(root);
  const receipts = fs.existsSync(path.join(dir, 'receipts')) ? fs.readdirSync(path.join(dir, 'receipts')).filter((f) => f.endsWith('.json')).map((f) => U.readJson(path.join(dir, 'receipts', f), null)).filter(Boolean) : [];
  const log = fs.existsSync(path.join(dir, 'events.log')) ? fs.readFileSync(path.join(dir, 'events.log'), 'utf8').split('\n') : [];
  const denies = {};
  for (const l of log) { const m = l.match(/ deny (\S+)/); if (m) denies[m[1]] = (denies[m[1]] || 0) + 1; }
  const comp = U.readJson(path.join(dir, 'compact-stats.json'), { runs: 0, before: 0, after: 0 });
  const verdicts = {};
  for (const r of receipts) verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
  out(`Finished changes: ${receipts.length}${receipts.length ? ` (${Object.entries(verdicts).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  out(`Blocked actions: ${Object.values(denies).reduce((a, b) => a + b, 0)}${Object.keys(denies).length ? ` (${Object.entries(denies).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  out(`Test/build output compacted: ${comp.runs} run(s), ~${Math.round(comp.before / 4)} -> ~${Math.round(comp.after / 4)} tokens (estimated as chars/4)`);
  out(`Checkpoints kept: ${CP.list(root).length}`);
} else {
  out('Usage: tandem undo [n] | redo | checkpoints | receipt | stats');
}
