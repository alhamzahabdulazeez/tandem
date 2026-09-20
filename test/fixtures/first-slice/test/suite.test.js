'use strict';
/**
 * Test suite for the first-slice fixture.
 * Direct-source Node.js test runner suite.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Store } = require('../lib/store.js');
const { runCli } = require('../bin/cli.js');

describe('First-Slice Store Library', () => {
  test('basic set, get, delete operations', () => {
    const store = new Store();
    assert.strictEqual(store.get('alpha'), null);
    assert.strictEqual(store.has('alpha'), false);

    store.set('alpha', '123');
    assert.strictEqual(store.get('alpha'), '123');
    assert.strictEqual(store.has('alpha'), true);
    assert.strictEqual(store.size(), 1);

    const deleted = store.delete('alpha');
    assert.strictEqual(deleted, true);
    assert.strictEqual(store.get('alpha'), null);
    assert.strictEqual(store.size(), 0);
  });

  test('TTL expiry and purging', async () => {
    const store = new Store();
    store.set('temporary', 'val', 50); // 50ms TTL
    assert.strictEqual(store.get('temporary'), 'val');

    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(store.get('temporary'), null);
    assert.strictEqual(store.has('temporary'), false);
  });

  test('list returns non-expired items', () => {
    const store = new Store({ a: '1', b: '2' });
    const list = store.list();
    assert.deepStrictEqual(list, { a: '1', b: '2' });
  });
});

describe('First-Slice CLI Driver', () => {
  test('help and empty command', () => {
    const code = runCli(['--help'], new Store());
    assert.strictEqual(code, 0);
  });

  test('set and get workflow', () => {
    const store = new Store();
    let code = runCli(['set', 'mykey', 'myval'], store);
    assert.strictEqual(code, 0);

    code = runCli(['get', 'mykey'], store);
    assert.strictEqual(code, 0);
  });

  test('get missing key returns exit code 1', () => {
    const store = new Store();
    const code = runCli(['get', 'nonexistent'], store);
    assert.strictEqual(code, 1);
  });

  test('delete operation via CLI', () => {
    const store = new Store({ item: 'x' });
    let code = runCli(['delete', 'item'], store);
    assert.strictEqual(code, 0);

    code = runCli(['delete', 'item'], store);
    assert.strictEqual(code, 1);
  });
});
