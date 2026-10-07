'use strict';
module.exports = (fresh, assert) => {
  assert.strictEqual(typeof fresh.parseTokenList, 'function');
  assert.deepStrictEqual(fresh.parseTokenList(' "a" , "b"'), ['"a"', '"b"']);
  assert.deepStrictEqual(fresh.parseTokenList('"a"'), ['"a"']);
  assert.strictEqual(fresh({ 'if-none-match': '"a"' }, { etag: '"a"' }), true);
};
