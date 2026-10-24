'use strict';
const assert = require('node:assert');
module.exports = async (dir) => {
  const { express, request } = require('./_lib.cjs')(dir);
  const app = express();
  app.get('/', (req, res) => res.json({ t: req.bearerToken === undefined ? '<undef>' : req.bearerToken }));
  const get = async (h) => (await (h ? request(app).get('/').set('Authorization', h) : request(app).get('/'))).body.t;
  assert.strictEqual(await get('Bearer abc.def'), 'abc.def');
  assert.strictEqual(await get('bearer   xyz  '), 'xyz');
  assert.strictEqual(await get('Basic dXNlcjpwYXNz'), '<undef>');
  assert.strictEqual(await get(null), '<undef>');
};
