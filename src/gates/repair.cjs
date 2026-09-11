'use strict';
/**
 * Bounded, regression-aware repair.
 *
 * Two constraints, both deliberate:
 *  - A repair that removes a previously passing test is rejected, however many errors it fixed.
 *  - After the bound, work stops. Repeated blind attempts degrade output; stopping is correct.
 */
const S = require('../core/state.cjs');

/**
 * @returns {{action:'CONTINUE'|'REPORT_AND_STOP', message:string, repairCount:number,
 *            regression:{regressed:string[],hasRegression:boolean}}}
 */
function evaluate(state, result, gateName, cfg) {
  const key = S.failureKey(result.errors);
  state.repairCount = key === state.lastFailureKey ? (state.repairCount || 0) + 1 : 1;
  state.lastFailureKey = key;

  const regression = cfg.blockOnRegression && Array.isArray(result.passing)
    ? S.detectRegression(state.greenTests, result.passing)
    : { regressed: [], hasRegression: false };

  if (state.repairCount > cfg.maxRepairs) {
    return {
      action: 'REPORT_AND_STOP',
      repairCount: state.repairCount,
      regression,
      message:
        `TANDEM BOUNDED_REPAIR — ${cfg.maxRepairs} attempts on the same ${gateName} failure. Stopping.\n` +
        `Report what remains rather than trying another approach.\n` + format(result),
    };
  }

  let message = '';
  if (regression.hasRegression) {
    message += 'TANDEM REGRESSION — these tests passed before your change and fail now:\n  ' +
               regression.regressed.join('\n  ') + '\nFix the regression first.\n';
  }
  message += `TANDEM ${gateName} failing (attempt ${state.repairCount}/${cfg.maxRepairs}):\n` + format(result);
  return { action: 'CONTINUE', repairCount: state.repairCount, regression, message };
}

function format(result) {
  const P = require('./parse.cjs');
  if (result.parseFailed && result.raw) return result.raw + '\n';
  return P.format(result.errors) + '\n';
}

module.exports = { evaluate };
