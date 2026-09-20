'use strict';
/**
 * packages/tandem-check/index.cjs
 *
 * Programmatic API for tandem-check.
 */

const { check, formatReport } = require('./lib/check.cjs');
const { inspect, walk, reportContentDigest } = require('./lib/inspect.cjs');
const depgraph = require('./lib/depgraph.cjs');

module.exports = {
  check,
  formatReport,
  inspect,
  walk,
  reportContentDigest,
  depgraph,
};
