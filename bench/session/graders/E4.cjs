'use strict';
const assert = require('node:assert');
module.exports = async (dir) => {
  const { express, request } = require('./_lib.cjs')(dir);
  const app = express();
  app.get('/a', (req, res) => res.problem(404, 'no such widget'));
  app.get('/b', (req, res) => res.problem(429));
  const a = await request(app).get('/a');
  assert.strictEqual(a.status, 404);
  assert.match(a.headers['content-type'], /^application\/problem\+json/);
  assert.deepStrictEqual(JSON.parse(a.text), { type: 'about:blank', title: 'Not Found', status: 404, detail: 'no such widget' });
  const b = await request(app).get('/b');
  assert.strictEqual(b.status, 429);
  assert.deepStrictEqual(JSON.parse(b.text), { type: 'about:blank', title: 'Too Many Requests', status: 429 });
};
