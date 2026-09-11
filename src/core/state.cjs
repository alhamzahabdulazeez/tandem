'use strict';
/** Session state and deterministic memory. Stored at .tandem/state.json. */
const fs = require('node:fs');
const path = require('node:path');

function file(cwd) { return path.join(cwd, '.tandem', 'state.json'); }

function empty() {
  return {
    greenTests: [],
    lastFailureKey: '',
    repairCount: 0,
    seenImports: [],
    disabled: {},
    gates: null,
    errorCounts: {},   // "file|CODE" -> times seen across sessions
    memory: [],        // promoted lessons, deterministic
    graphStamp: null,
  };
}

function load(cwd) {
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(file(cwd), 'utf8')) }; }
  catch { return empty(); }
}

function save(cwd, s) {
  fs.mkdirSync(path.dirname(file(cwd)), { recursive: true });
  fs.writeFileSync(file(cwd), JSON.stringify(s, null, 2));
}

/** A repair that removes a previously passing test is worse than the original failure. */
function detectRegression(green, passingNow) {
  const now = new Set(passingNow);
  const regressed = (green || []).filter((t) => !now.has(t));
  const before = new Set(green || []);
  return {
    regressed,
    fixed: (passingNow || []).filter((t) => !before.has(t)),
    hasRegression: regressed.length > 0,
  };
}

/** Order-independent so the same failure is recognised however the errors are sorted. */
function failureKey(errors) {
  return (errors || []).map((e) => e.file + '|' + (e.code || e.message)).sort().join(',');
}

/**
 * Memory — deterministic by construction.
 * A model never decides what is worth remembering. An (file, code) pair seen
 * `threshold` times is promoted verbatim. No summarisation, no judgement.
 */
function recordErrors(state, errors, threshold) {
  const promoted = [];
  for (const e of errors || []) {
    const key = e.file + '|' + (e.code || e.message);
    state.errorCounts[key] = (state.errorCounts[key] || 0) + 1;
    if (state.errorCounts[key] === threshold && !state.memory.some((m) => m.key === key)) {
      const lesson = { key, file: e.file, code: e.code, message: e.message, seen: threshold };
      state.memory.push(lesson);
      promoted.push(lesson);
    }
  }
  return promoted;
}

function memoryBrief(state, cap = 5) {
  if (!state.memory || state.memory.length === 0) return '';
  const lines = state.memory.slice(-cap)
    .map((m) => `- ${m.file}${m.code ? ' ' + m.code : ''}: ${m.message}`);
  return 'Recurring problems in this project — do not repeat them:\n' + lines.join('\n');
}

module.exports = { empty, load, save, detectRegression, failureKey, recordErrors, memoryBrief };
