'use strict';
/**
 * IB-03 Budget Counters & Enforcement — pure arithmetic & counter algebra.
 *
 * Implements runtime counters and refusal for the four IB-03 dimensions:
 *   1. Unique files read (ceiling: 40, effective: 32, reserved: 8)
 *   2. Unique files changed (ceiling: 12, effective: 9.6, reserved: 2.4)
 *   3. Changed lines (ceiling: 600, effective: 480, reserved: 120)
 *   4. Tool calls (ceiling: 20, effective: 16, reserved: 4)
 *
 * Reserve buffer: 20% mandatory reserve across all bounded dimensions.
 * Crossing the 80% effective limit refuses further work in that dimension.
 * Crossing the 100% total ceiling is a hard stop.
 *
 * Pure: no dependencies, no clock, no filesystem.
 */

const DEFAULT_CEILINGS = Object.freeze({
  filesRead: 40,
  filesChanged: 12,
  changedLines: 600,
  toolCalls: 20,
  reservePct: 0.20,
});

/**
 * Initialize budget counters with optional custom ceilings.
 * @param {object} [ceilings]
 * @returns {object} counters
 */
function create(ceilings) {
  const c = Object.freeze({ ...DEFAULT_CEILINGS, ...(ceilings || {}) });
  return Object.freeze({
    ceilings: c,
    filesRead: new Set(),
    filesChanged: new Set(),
    changedLines: 0,
    toolCalls: 0,
    toolCallsByName: Object.freeze({}),
  });
}

/**
 * Record a file read. Unique paths are counted; repeats are idempotent.
 * @param {object} counters
 * @param {string} file
 * @returns {object} new counters
 */
function countRead(counters, file) {
  const base = counters || create();
  const nextFilesRead = new Set(base.filesRead);
  if (file && typeof file === 'string') {
    nextFilesRead.add(file);
  }
  return Object.freeze({
    ceilings: base.ceilings,
    filesRead: nextFilesRead,
    filesChanged: new Set(base.filesChanged),
    changedLines: base.changedLines,
    toolCalls: base.toolCalls,
    toolCallsByName: { ...base.toolCallsByName },
  });
}

/**
 * Record a file change and lines modified (added and/or removed).
 * @param {object} counters
 * @param {string} file
 * @param {number|string} [addedLines=0]
 * @param {number|string} [removedLines=0]
 * @returns {object} new counters
 */
function countChange(counters, file, addedLines = 0, removedLines = 0) {
  const base = counters || create();
  const nextFilesChanged = new Set(base.filesChanged);
  if (file && typeof file === 'string') {
    nextFilesChanged.add(file);
  }
  const added = typeof addedLines === 'string' ? addedLines.split('\n').length : (Number(addedLines) || 0);
  const removed = typeof removedLines === 'string' ? removedLines.split('\n').length : (Number(removedLines) || 0);
  const nextChangedLines = base.changedLines + added + removed;

  return Object.freeze({
    ceilings: base.ceilings,
    filesRead: new Set(base.filesRead),
    filesChanged: nextFilesChanged,
    changedLines: nextChangedLines,
    toolCalls: base.toolCalls,
    toolCallsByName: { ...base.toolCallsByName },
  });
}

/**
 * Record a tool call by name.
 * @param {object} counters
 * @param {string} [name='unknown']
 * @returns {object} new counters
 */
function countToolCall(counters, name) {
  const base = counters || create();
  const toolName = name ? String(name) : 'unknown';
  const toolCallsByName = { ...base.toolCallsByName, [toolName]: (base.toolCallsByName[toolName] || 0) + 1 };

  return Object.freeze({
    ceilings: base.ceilings,
    filesRead: new Set(base.filesRead),
    filesChanged: new Set(base.filesChanged),
    changedLines: base.changedLines,
    toolCalls: base.toolCalls + 1,
    toolCallsByName: Object.freeze(toolCallsByName),
  });
}

/**
 * Check counters against ceilings, computing 80% effective and 20% reserved boundaries.
 * @param {object} counters
 * @param {object} [ceilings]
 * @returns {{ within: boolean, exceeded: string[], effective: object, reserved: object, hardStop: boolean, hardStops: string[], counts: object, ceilings: object, details: object }}
 */
function check(counters, ceilings) {
  const base = counters || create();
  const c = { ...DEFAULT_CEILINGS, ...(base.ceilings || {}), ...(ceilings || {}) };
  const reservePct = typeof c.reservePct === 'number' && Number.isFinite(c.reservePct) ? c.reservePct : 0.20;

  const dims = ['filesRead', 'filesChanged', 'changedLines', 'toolCalls'];
  const effective = {};
  const reserved = {};
  const counts = {
    filesRead: base.filesRead instanceof Set ? base.filesRead.size : (Array.isArray(base.filesRead) ? base.filesRead.length : Number(base.filesRead || 0)),
    filesChanged: base.filesChanged instanceof Set ? base.filesChanged.size : (Array.isArray(base.filesChanged) ? base.filesChanged.length : Number(base.filesChanged || 0)),
    changedLines: Number(base.changedLines || 0),
    toolCalls: Number(base.toolCalls || 0),
  };

  const exceeded = [];
  const hardStops = [];
  const details = {};

  for (const d of dims) {
    const total = Number(c[d]);
    const res = Math.round(total * reservePct * 100) / 100;
    const eff = Math.round((total - res) * 100) / 100;
    effective[d] = eff;
    reserved[d] = res;

    const count = counts[d];
    const isExceeded = count > eff;
    const isHardStop = count > total;

    if (isExceeded) {
      exceeded.push(d);
    }
    if (isHardStop) {
      hardStops.push(d);
    }

    details[d] = {
      count,
      effective: eff,
      reserved: res,
      ceiling: total,
      exceeded: isExceeded,
      hardStop: isHardStop,
    };
  }

  for (const d of dims) {
    exceeded[d] = details[d];
  }

  return {
    within: exceeded.length === 0,
    exceeded,
    effective,
    reserved,
    hardStop: hardStops.length > 0,
    hardStops,
    counts,
    ceilings: c,
    details,
  };
}

module.exports = {
  DEFAULT_CEILINGS,
  create,
  countRead,
  countChange,
  countToolCall,
  check,
};
