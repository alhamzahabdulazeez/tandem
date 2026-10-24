'use strict';
const assert = require('node:assert');
const path = require('node:path');
module.exports = async (dir) => {
  const { express } = require('./_lib.cjs')(dir);
  assert.strictEqual(express.version, require(path.join(dir, 'package.json')).version);
  assert.strictEqual(typeof express(), 'function');
};
