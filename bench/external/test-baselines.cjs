'use strict';
const path = require('node:path');
const { runTestsInDirectory } = require('./baseline-runner.cjs');

const candidates = ['fresh', 'encodeurl', 'escape-html'];

let allGreen = true;
for (const cand of candidates) {
  const dir = path.join(__dirname, 'candidates', cand);
  console.log(`\nTesting candidate baseline: ${cand} (${dir})`);
  const res = runTestsInDirectory(dir);
  if (res.exitCode !== 0 || res.passed === 0) {
    allGreen = false;
    console.error(`Baseline test for ${cand} FAILED: ${res.passed} passed, ${res.failed} failed`);
  } else {
    console.log(`Baseline test for ${cand} PASSED: ${res.passed} passed, 0 failed`);
  }
}

if (!allGreen) {
  process.exit(1);
} else {
  console.log('\nAll candidate baselines are 100% green.');
  process.exit(0);
}
