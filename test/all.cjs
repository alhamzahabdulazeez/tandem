'use strict';
/**
 * Unified test runner — discovers every unit test file under test/ (all
 * *.test.js, including the contracts suite) and runs each exported run(t,g).
 *
 * Usage: node test/all.cjs
 *
 * Each test file MUST export a function `run(t, group)` (same contract as
 * `test/contracts/run.cjs`).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;

function collect(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'fixtures' || ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { collect(full, out); continue; }
    if (ent.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const files = collect(ROOT, []).sort();
if (files.length === 0) {
  console.error('no test files discovered under ' + ROOT);
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];

const t = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${name}\n       ${e.message}`);
  }
};
const group = (name) => {};

for (const file of files) {
  let run;
  try {
    run = require(file);
  } catch (e) {
    fail++;
    failures.push(`${path.relative(ROOT, file)}: load error\n       ${e.message}`);
    continue;
  }
  if (typeof run !== 'function') {
    fail++;
    failures.push(`${path.relative(ROOT, file)}: does not export run(t, group)`);
    continue;
  }
  const g = (name) => { console.log(`\n== ${name}`); };
  console.log(`\n── ${path.relative(ROOT, file)} ──`);
  try {
    run(t, g);
  } catch (e) {
    fail++;
    failures.push(`${path.relative(ROOT, file)}: suite error\n       ${e.message}`);
  }
}

// Run deterministic repository auditor
console.log('\n── Repository Audit (bin/audit.cjs) ──');
try {
  const { runAllAudits } = require('../bin/audit.cjs');
  const auditResult = runAllAudits();
  if (!auditResult.passed) {
    for (const d of auditResult.defects) {
      fail++;
      failures.push(`Audit Defect [${d.type}]: ${d.message} (${d.file}:${d.line})`);
    }
    console.log(`Repository audit FAILED with ${auditResult.defects.length} defect(s)`);
  } else {
    pass++;
    console.log('Repository audit PASSED (0 defects)');
  }
} catch (e) {
  fail++;
  failures.push(`Repository audit execution error\n       ${e.message}`);
}

console.log(`\nunits suite: ${pass} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
}
process.exit(fail ? 1 : 0);