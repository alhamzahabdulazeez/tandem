'use strict';
/** Configuration. Every key optional; every key has a default. */
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const DEFAULTS = Object.freeze({
  typecheckCommand: null,
  testCommand: null,
  lintCommand: null,
  workingSet: ['src/**', 'test/**', 'tests/**', 'lib/**'],
  exclude: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '.tandem/**'],
  maxErrorsToModel: 10,
  maxRepairs: 2,
  blockOnRegression: true,
  verificationDensity: 'auto',
  dependentThreshold: 3,
  memoryThreshold: 3,
  gateTimeoutMs: 120000,
});

/** PowerShell writes a BOM; it breaks JSON.parse. Observed, not theorised. */
function parseJson(text) { return JSON.parse(String(text).replace(/^\uFEFF/, '')); }

function load(cwd) {
  const file = join(cwd, 'tandem.json');
  if (!existsSync(file)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...parseJson(readFileSync(file, 'utf8')) }; }
  catch { return { ...DEFAULTS, _configError: 'tandem.json could not be parsed; defaults used' }; }
}

function globToRegExp(glob) {
  // Placeholders first: replacing ** with .* before * would let the * inside .*
  // be rewritten again, producing a pattern that only matches one level deep.
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = esc
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .split('\u0000').join('(?:.*/)?')
    .split('\u0001').join('.*');
  return new RegExp('^' + body + '$');
}

function inWorkingSet(relPath, cfg) {
  const p = String(relPath).split('\\').join('/');
  if (cfg.exclude.some((g) => globToRegExp(g).test(p))) return false;
  return cfg.workingSet.some((g) => globToRegExp(g).test(p));
}

/**
 * Verification density. Published measurement: strong generators prefer sparse
 * verification; weak generators need frequent checkpoints. Dense-checking a frontier
 * model adds latency without a matching gain.
 */
const STRONG = /(opus|fable|mythos|sonnet-5|gpt-5\.[5-9]|sol|-pro\b|gemini-3\.\d+-pro)/i;

function densityFor(cfg, modelId) {
  if (cfg.verificationDensity === 'dense') return 'dense';
  if (cfg.verificationDensity === 'sparse') return 'sparse';
  if (!modelId) return 'dense';
  return STRONG.test(String(modelId)) ? 'sparse' : 'dense';
}

module.exports = { DEFAULTS, load, parseJson, inWorkingSet, globToRegExp, densityFor };
