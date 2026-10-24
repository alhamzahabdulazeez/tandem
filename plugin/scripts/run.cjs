#!/usr/bin/env node
'use strict';
/**
 * Runs a test/build command for Claude Code and prints a compacted version of
 * its output. The full output is saved under .git/tandem/logs/ and its path is
 * printed, so the agent can read more when the excerpt is not enough.
 *
 *   node run.cjs <base64 command>
 *
 * Exit code is the command's own. If anything here fails, the raw output is
 * printed unchanged.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compact } = require('../lib/compact.cjs');
const U = require('../lib/util.cjs');

const cmd = Buffer.from(process.argv[2] || '', 'base64').toString('utf8');
if (!cmd) { process.stderr.write('tandem run: no command\n'); process.exit(2); }

const r = spawnSync(cmd, {
  shell: true,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  env: Object.assign({}, process.env, { FORCE_COLOR: '0', NO_COLOR: '1', CI: process.env.CI || '1' }),
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: true,
});
const output = `${r.stdout || ''}${r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''}`;
const code = r.status == null ? 1 : r.status;

let printed = false;
try {
  const c = compact(output, code);
  if (c.compacted) {
    const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const dir = path.join(U.stateDir(root), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    fs.writeFileSync(file, `$ ${cmd}\n${output}`);
    // keep the last 20 logs
    const logs = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort();
    for (const f of logs.slice(0, Math.max(0, logs.length - 20))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    const total = output.split('\n').length;
    const cwd = U.toPosix(process.cwd()).replace(/\/?$/, '/');
    const text = c.text.split(cwd).join('');
    process.stdout.write(`${text}\n\n[Tandem: ${code === 0 ? 'passed' : `exit ${code}`}; output compacted ${total} lines -> ${c.text.split('\n').length}. Full log: ${U.toPosix(file)}]\n`);
    printed = true;
    const sf = path.join(U.stateDir(root), 'compact-stats.json');
    const st = U.readJson(sf, { runs: 0, before: 0, after: 0 });
    U.writeJson(sf, { runs: st.runs + 1, before: st.before + c.before, after: st.after + c.after });
  }
} catch { /* fall through to raw output */ }
if (!printed) process.stdout.write(output);
process.exit(code);
