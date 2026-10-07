'use strict';
module.exports = (encodeUrl, assert) => {
  assert.ok(encodeUrl.ENCODE_CHARS_REGEXP instanceof RegExp);
  assert.strictEqual('a b'.replace(encodeUrl.ENCODE_CHARS_REGEXP, encodeURI), 'a%20b');
  assert.strictEqual(encodeUrl('a b'), 'a%20b');
  assert.strictEqual(encodeUrl('\uD800'), '%EF%BF%BD');
};
