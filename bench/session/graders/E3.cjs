'use strict';
const assert = require('node:assert');
module.exports = async (dir) => {
  const { express, request } = require('./_lib.cjs')(dir);
  const app = express();
  const errs = [];
  app.get('/', (req, res) => {
    for (const bad of [-1, 1.5, '60', NaN]) { try { res.cacheFor(bad); errs.push('no-throw'); } catch (e) { errs.push(e instanceof TypeError ? 'TypeError' : e.name); } }
    assert.strictEqual(res.cacheFor(60), res);
    res.send('ok');
  });
  const r = await request(app).get('/');
  assert.strictEqual(r.headers['cache-control'], 'public, max-age=60');
  assert.deepStrictEqual(errs, ['TypeError', 'TypeError', 'TypeError', 'TypeError']);
  const app0 = express();
  app0.get('/', (req, res) => res.cacheFor(0).send('x'));
  assert.strictEqual((await request(app0).get('/')).headers['cache-control'], 'public, max-age=0');
};
