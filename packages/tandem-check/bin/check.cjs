#!/usr/bin/env node
'use strict';
/**
 * packages/tandem-check/bin/check.cjs
 *
 * CLI runner for `tandem-check`.
 * Model-free, zero-config check of uncommitted changes.
 */

const { check, formatReport } = require('../lib/check.cjs');

function parseArgs(args) {
  const options = {
    json: false,
    quiet: false,
    verify: false,
  };

  for (const arg of args) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--verify') {
      options.verify = true;
    }
  }

  return options;
}

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const cwd = process.cwd();

  const result = check(cwd, { verify: options.verify });

  if (options.json) {
    if (!options.quiet) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } else {
    if (!options.quiet) {
      process.stdout.write(formatReport(result) + '\n');
    }
  }

  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}
