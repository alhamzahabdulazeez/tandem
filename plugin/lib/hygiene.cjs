'use strict';
/**
 * Debug leftovers in what an agent added: breakpoints always, console.log /
 * print only in files that did not already log that way (so CLIs and loggers
 * are left alone), and new TODO/FIXME markers. Works on added lines only.
 */

const path = require('node:path');

const ALWAYS = [
  { re: /^\s*debugger\s*;?\s*$/, what: 'debugger statement', langs: ['js'] },
  { re: /\bbreakpoint\(\s*\)|\bpdb\.set_trace\(|\bipdb\.set_trace\(/, what: 'breakpoint', langs: ['py'] },
  { re: /\bbinding\.(?:pry|irb)\b/, what: 'breakpoint', langs: ['rb'] },
  { re: /\bdbg!\(/, what: 'dbg! macro', langs: ['rs'] },
];
const PRINT = {
  js: /\bconsole\.(?:log|debug|dir|trace)\s*\(/,
  py: /^\s*print\s*\(/,
  go: /\bfmt\.Print(?:ln|f)?\(/,
};
const MARKER = /\b(?:TODO|FIXME|XXX|HACK)\b/;

function lang(rel) {
  const e = path.extname(rel).toLowerCase();
  if (['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'].includes(e)) return 'js';
  if (e === '.py') return 'py';
  if (e === '.rb') return 'rb';
  if (e === '.rs') return 'rs';
  if (e === '.go') return 'go';
  return null;
}

function isCliLike(rel) {
  return /(?:^|\/)(?:bin|scripts?|cli|tools|examples?|bench|benchmarks?)\//.test(rel) || /(?:^|\/)(?:cli|main|__main__)\.\w+$/.test(rel);
}

/**
 * @param {string} rel
 * @param {string} before  previous content ('' for a new file)
 * @param {string[]} addedLines
 * @param {boolean} isTest
 * @returns {string[]} findings, e.g. "src/a.ts:12 console.log"
 */
function findings(rel, before, addedLines, isTest) {
  const l = lang(rel);
  if (!l) return [];
  const out = [];
  const printRe = PRINT[l];
  const alreadyPrints = printRe && printRe.test(String(before || ''));
  const prevMarkers = (String(before || '').match(new RegExp(MARKER.source, 'g')) || []).length;
  let markers = 0;
  for (const { n, text } of addedLines) {
    for (const a of ALWAYS) if (a.langs.includes(l) && a.re.test(text)) out.push(`${rel}:${n} ${a.what}`);
    if (printRe && !isTest && !alreadyPrints && !isCliLike(rel) && printRe.test(text)) out.push(`${rel}:${n} ${text.trim().slice(0, 60)}`);
    if (MARKER.test(text)) markers++;
  }
  if (markers && !isTest) out.push(`${rel}: ${markers} new TODO/FIXME marker(s)${prevMarkers ? '' : ' in a file that had none'}`);
  return out;
}

/** Parse `git diff -U0` output into { file: [{ n, text }] } of added lines. */
function addedLinesFromDiff(diff) {
  const out = {};
  let file = null;
  let n = 0;
  for (const line of String(diff || '').split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1]; out[file] = out[file] || []; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { n = +h[1]; continue; }
    if (file && line.startsWith('+') && !line.startsWith('+++')) { out[file].push({ n, text: line.slice(1) }); n++; }
  }
  return out;
}

module.exports = { findings, addedLinesFromDiff, lang };
