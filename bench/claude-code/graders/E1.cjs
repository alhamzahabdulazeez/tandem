'use strict';
module.exports = (encodeUrl, assert) => {
  assert.strictEqual(encodeUrl('a b', { encodeSpaceAsPlus: true }), 'a+b');
  assert.strictEqual(encodeUrl('a b'), 'a%20b');
  assert.strictEqual(encodeUrl('/x y?z', { encodeSpaceAsPlus: true }), '/x+y?z');
  assert.strictEqual(encodeUrl('%20', { encodeSpaceAsPlus: true }), '%20');
};
