'use strict';
module.exports = (fresh, assert) => {
  assert.strictEqual(fresh({ 'if-none-match': '"a", *' }, { etag: '"zz"' }), true);
  assert.strictEqual(fresh({ 'if-none-match': '*, "a"' }, { etag: '"zz"' }), true);
  assert.strictEqual(fresh({ 'if-none-match': '"a", "b"' }, { etag: '"zz"' }), false);
  assert.strictEqual(fresh({ 'if-none-match': '"a", "zz"' }, { etag: '"zz"' }), true);
};
