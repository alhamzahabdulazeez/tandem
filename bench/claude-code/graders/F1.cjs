'use strict';
// Held-out grader: never present in the candidate's working tree.
module.exports = (fresh, assert) => {
  assert.strictEqual(fresh({ 'if-none-match': ' * ' }, { etag: '"foo"' }), true);
  assert.strictEqual(fresh({ 'if-none-match': '\t*\t' }, { etag: '"foo"' }), true);
  assert.strictEqual(fresh({ 'if-none-match': '*' }, {}), true);
  assert.strictEqual(fresh({ 'if-none-match': '"bar"' }, { etag: '"foo"' }), false);
};
