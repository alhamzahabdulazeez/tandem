'use strict';
const assert = require('node:assert');
module.exports = async (dir) => {
  const { express, request } = require('./_lib.cjs')(dir);
  const app = express();
  app.get('/', (req, res) => { const r = res.noStore(); assert.strictEqual(r, res); r.send('ok'); });
  const res = await request(app).get('/');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['cache-control'], 'no-store');
  assert.strictEqual(res.text, 'ok');
};
