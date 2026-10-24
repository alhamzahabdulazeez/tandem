'use strict';
// Shared helpers for held-out graders: load the candidate's express and make requests.
const path = require('node:path');
module.exports = function setup(dir) {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const express = require(dir);
  const request = require(path.join(dir, 'node_modules', 'supertest'));
  return { express, request };
};
