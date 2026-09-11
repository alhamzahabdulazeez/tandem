'use strict';
/** Gate execution. Every gate is deterministic; no model decides pass or fail. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const P = require('./parse.cjs');

/**
 * On Termux, `node_modules/.bin/<tool>` carries `#!/usr/bin/env node`, and Termux's own
 * `/usr/bin/env` lives elsewhere — so every gate command here (`npx tsc`, `npm test`, ...)
 * fails with "not found" rather than skipping cleanly, and the model is told the tool is
 * broken instead of what its code got wrong. Termux ships the fix for exactly this
 * (`termux-exec`'s LD_PRELOAD shim); it just is not always inherited by a spawned
 * subprocess's environment. Verified: adding it here turns "tsc: not found" into a real
 * type-check run. A no-op on every other platform.
 */
function termuxExecEnv() {
  const prefix = process.env.PREFIX;
  if (!prefix || !prefix.includes('com.termux')) return {};
  const lib = path.join(prefix, 'lib', 'libtermux-exec-ld-preload.so');
  try { return fs.existsSync(lib) ? { LD_PRELOAD: lib } : {}; } catch { return {}; }
}

function exec(command, cwd, timeoutMs) {
  const r = spawnSync(command, {
    cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...termuxExecEnv() },
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status == null ? -1 : r.status };
}

function topErrors(errors, cap) {
  return P.orderByDependency(P.dedupe(errors)).slice(0, cap);
}

/**
 * Type check.
 *
 * `files` narrows the RESULT, never the command. Passing explicit files to tsc makes it
 * ignore tsconfig.json entirely and emit TS5112 — verified, and it silently produced an
 * empty error list. Running the project check and filtering the parsed errors is correct
 * for every toolchain, including `npm run typecheck`.
 */
function typecheck(gate, cwd, cfg, files) {
  if (!gate.available) return { skipped: true, reason: gate.reason };
  const r = exec(gate.command, cwd, cfg.gateTimeoutMs);
  if (r.code === 0) return { skipped: false, passed: true, errors: [], errorCount: 0, scoped: Boolean(files) };

  let all = P.parseTsc(r.out);
  if (files && files.length) {
    const want = new Set(files.map((f) => String(f).split('\\').join('/')));
    const scoped = all.filter((e) => want.has(String(e.file).split('\\').join('/')));
    // No error inside the scope means the scope is healthy, whatever else is broken.
    if (scoped.length === 0) {
      return { skipped: false, passed: true, errors: [], errorCount: 0, scoped: true, projectErrorCount: all.length };
    }
    all = scoped;
  }
  return {
    skipped: false,
    passed: false,
    scoped: Boolean(files),
    errors: topErrors(all, cfg.maxErrorsToModel),
    errorCount: all.length,
    parseFailed: all.length === 0,
    raw: all.length === 0 ? P.headTail(r.out, 800, 800) : null,
  };
}

function tests(gate, cwd, cfg) {
  if (!gate.available) return { skipped: true, reason: gate.reason };
  const r = exec(gate.command, cwd, cfg.gateTimeoutMs);
  const parsed = P.parseVitestJson(r.out);
  if (r.code === 0) {
    return { skipped: false, passed: true, errors: [], errorCount: 0, passing: parsed ? parsed.passing : [] };
  }
  if (!parsed) {
    return { skipped: false, passed: false, errors: [], errorCount: 0, parseFailed: true,
             raw: P.headTail(r.out, 800, 800), passing: [] };
  }
  return { skipped: false, passed: false, errors: topErrors(parsed.errors, cfg.maxErrorsToModel),
           errorCount: parsed.errors.length, passing: parsed.passing };
}

function lint(gate, cwd, cfg) {
  if (!gate.available) return { skipped: true, reason: gate.reason };
  const r = exec(gate.command, cwd, cfg.gateTimeoutMs);
  if (r.code === 0) return { skipped: false, passed: true, errors: [], errorCount: 0 };
  const all = P.parseBiomeJson(r.out) || [];
  return { skipped: false, passed: false, errors: topErrors(all, cfg.maxErrorsToModel),
           errorCount: all.length, parseFailed: all.length === 0, raw: all.length === 0 ? P.headTail(r.out, 800, 800) : null };
}

module.exports = { exec, typecheck, tests, lint, topErrors, termuxExecEnv };
