'use strict';
/**
 * Gate detection — decision D-05.
 * A gate whose tool is missing is disabled SILENTLY; the hook exits 0.
 * A tool that breaks the user's workflow when it cannot help is worse than no tool.
 */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

function readManifest(cwd) {
  try { return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')); } catch { return null; }
}

function hasBin(cwd, name) {
  if (existsSync(join(cwd, 'node_modules', '.bin', name))) return true;
  if (existsSync(join(cwd, 'node_modules', '.bin', name + '.cmd'))) return true;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function hasDep(manifest, name) {
  if (!manifest) return false;
  return Boolean((manifest.dependencies && manifest.dependencies[name]) ||
                 (manifest.devDependencies && manifest.devDependencies[name]));
}

function hasScript(manifest, name) {
  return Boolean(manifest && manifest.scripts && manifest.scripts[name]);
}

function detectTypecheck(cwd, cfg, m) {
  if (cfg.typecheckCommand) return { available: true, command: cfg.typecheckCommand, reason: null };
  if (!existsSync(join(cwd, 'tsconfig.json'))) return { available: false, command: null, reason: 'no tsconfig.json' };
  if (hasScript(m, 'typecheck')) return { available: true, command: 'npm run typecheck --silent', reason: null };
  if (hasDep(m, 'typescript') || hasBin(cwd, 'tsc')) return { available: true, command: 'npx tsc --noEmit --pretty false', reason: null };
  return { available: false, command: null, reason: 'typescript not installed' };
}

function detectTest(cwd, cfg, m) {
  if (cfg.testCommand) return { available: true, command: cfg.testCommand, reason: null };
  if (hasDep(m, 'vitest')) return { available: true, command: 'npx vitest run --reporter=json', reason: null };
  if (hasScript(m, 'test')) return { available: true, command: 'npm test --silent', reason: null };
  return { available: false, command: null, reason: 'no test runner detected' };
}

function detectLint(cwd, cfg, m) {
  if (cfg.lintCommand) return { available: true, command: cfg.lintCommand, reason: null };
  if (hasDep(m, '@biomejs/biome')) return { available: true, command: 'npx biome check --reporter=json .', reason: null };
  return { available: false, command: null, reason: 'no linter configured' };
}

function detectGates(cwd, cfg) {
  const m = readManifest(cwd);
  return {
    typecheck: detectTypecheck(cwd, cfg || {}, m),
    test: detectTest(cwd, cfg || {}, m),
    lint: detectLint(cwd, cfg || {}, m),
  };
}

module.exports = { detectGates, readManifest, hasBin, hasDep, hasScript };
