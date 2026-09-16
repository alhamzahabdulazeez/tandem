'use strict';
/**
 * Dependency-free test runner for the contracts suite.
 *
 * Discovers `*.test.js` files in this directory and runs each one.
 * This is a separate suite from the legacy `test/run.cjs` because the
 * contract tests validate NEW schemas and state-machine rules that the
 * legacy (pre-supervisory) product never had.
 *
 * Usage: node test/contracts/run.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;

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

const group = (name) => { console.log(`\n== ${name}`); };

const testFiles = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const file of testFiles) {
  const run = require(path.join(DIR, file));
  if (typeof run !== 'function') {
    console.error(`SKIP ${file}: does not export a run(t, group) function`);
    continue;
  }
  console.log(`\n── ${file} ──`);
  run(t, group);
}

console.log(`\ncontracts suite: ${pass} passed, ${fail} failed\n`);
if (failures.length) {
  for (const f of failures) console.log('  FAIL ' + f);
}
process.exit(fail ? 1 : 0);