#!/usr/bin/env node
'use strict';
/**
 * CLI driver for the first-slice fixture.
 * Commands:
 *   set <key> <value> [--ttl <ms>]
 *   get <key>
 *   delete <key>
 *   list
 *   purge
 */

const { Store } = require('../lib/store.js');

function runCli(args = process.argv.slice(2), store = new Store()) {
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write('Usage: fixture-cli <command> [arguments]\n');
    return 0;
  }

  if (command === 'set') {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      process.stderr.write('Error: set requires <key> and <value>\n');
      return 1;
    }
    let ttl = null;
    const ttlIdx = args.indexOf('--ttl');
    if (ttlIdx !== -1 && args[ttlIdx + 1]) {
      ttl = parseInt(args[ttlIdx + 1], 10);
    }
    store.set(key, value, ttl);
    process.stdout.write(`OK: set ${key}\n`);
    return 0;
  }

  if (command === 'get') {
    const key = args[1];
    if (!key) {
      process.stderr.write('Error: get requires <key>\n');
      return 1;
    }
    const val = store.get(key);
    if (val === null) {
      process.stderr.write(`Error: key '${key}' not found or expired\n`);
      return 1;
    }
    process.stdout.write(`${val}\n`);
    return 0;
  }

  if (command === 'delete') {
    const key = args[1];
    if (!key) {
      process.stderr.write('Error: delete requires <key>\n');
      return 1;
    }
    const deleted = store.delete(key);
    if (!deleted) {
      process.stderr.write(`Error: key '${key}' not found\n`);
      return 1;
    }
    process.stdout.write(`OK: deleted ${key}\n`);
    return 0;
  }

  if (command === 'list') {
    const all = store.list();
    process.stdout.write(JSON.stringify(all, null, 2) + '\n');
    return 0;
  }

  if (command === 'purge') {
    const count = store.purgeExpired();
    process.stdout.write(`OK: purged ${count} expired keys\n`);
    return 0;
  }

  process.stderr.write(`Error: unknown command '${command}'\n`);
  return 1;
}

if (require.main === module) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}

module.exports = { runCli };
