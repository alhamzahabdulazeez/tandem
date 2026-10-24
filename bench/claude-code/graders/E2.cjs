'use strict';
module.exports = (encodeUrl, assert) => {
  assert.strictEqual(encodeUrl(null), '');
  assert.strictEqual(encodeUrl(undefined), '');
  assert.strictEqual(encodeUrl('a b'), 'a%20b');
  assert.strictEqual(encodeUrl(0), '0');
};
