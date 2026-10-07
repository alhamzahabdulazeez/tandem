'use strict';
module.exports = (fresh, assert) => {
  assert.strictEqual(fresh({ 'if-none-match': '"a"', 'cache-control': 'No-Cache' }, { etag: '"a"' }), false);
  assert.strictEqual(fresh({ 'if-none-match': '"a"', 'cache-control': 'NO-CACHE' }, { etag: '"a"' }), false);
  assert.strictEqual(fresh({ 'if-none-match': '"a"', 'cache-control': 'max-age=0' }, { etag: '"a"' }), true);
};
