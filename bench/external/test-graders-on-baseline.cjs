'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPOSITORIES = ['fresh', 'encodeurl', 'escape-html'];

let allGradersFailedOnBaseline = true;

for (const repo of REPOSITORIES) {
  const dir = path.join(__dirname, 'candidates', repo);
  const gradersDir = path.join(__dirname, repo, 'graders');
  const files = fs.readdirSync(gradersDir).filter(f => f.endsWith('.cjs')).sort();

  console.log(`\nTesting ${files.length} graders for ${repo} on untouched baseline (${dir}):`);
  for (const file of files) {
    const graderPath = path.join(gradersDir, file);
    const res = spawnSync(process.execPath, [graderPath, dir], { encoding: 'utf8' });
    if (res.status === 0) {
      console.error(`ERROR: Grader ${file} PASSED on untouched baseline for ${repo}! It should fail before task is implemented.`);
      allGradersFailedOnBaseline = false;
    } else {
      console.log(`Grader ${file} properly FAILED on untouched baseline.`);
    }
  }
}

if (!allGradersFailedOnBaseline) {
  console.error('\nSome graders unexpectedly passed on untouched baseline.');
  process.exit(1);
} else {
  console.log('\nAll 30 held-out graders properly fail on untouched baseline.');
  process.exit(0);
}
