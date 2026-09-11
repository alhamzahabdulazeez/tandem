'use strict';
/** Structured gate-output parsing. Ported from the tested TypeScript version. */

/** `tsc --pretty false` emits: path(line,col): error TSxxxx: message */
function parseTsc(raw) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/.exec(line.trim());
    if (m) out.push({ file: m[1], line: Number(m[2]), column: Number(m[3]), code: m[4], message: m[5].trim() });
  }
  return out;
}

function parseVitestJson(raw) {
  const start = String(raw).indexOf('{');
  if (start < 0) return null;
  let doc;
  try { doc = JSON.parse(String(raw).slice(start)); } catch { return null; }
  if (!doc || !Array.isArray(doc.testResults)) return null;
  const errors = [], passing = [];
  for (const f of doc.testResults) {
    const file = typeof f.name === 'string' ? f.name : '';
    if (!Array.isArray(f.assertionResults)) continue;
    for (const a of f.assertionResults) {
      const name = a.fullName || a.title || '';
      if (a.status === 'passed') { passing.push(name); continue; }
      if (a.status === 'failed') {
        const msg = (a.failureMessages || []).join(' ').split('\n')[0] || 'assertion failed';
        errors.push({ file, line: null, column: null, code: null, message: (name + ': ' + msg).slice(0, 300) });
      }
    }
  }
  return { errors, passing };
}

/** Dedupe by (file, code) so one cascading error does not crowd out other causes. */
function dedupe(errors) {
  const seen = new Set(), out = [];
  for (const e of errors) {
    const key = e.file + '::' + (e.code || e.message);
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out;
}

/** Shallower paths first: a root cause usually sits above the files importing it. */
function orderByDependency(errors) {
  const depth = (p) => String(p).split(/[\\/]/).length;
  return [...errors].sort((a, b) =>
    depth(a.file) - depth(b.file) || String(a.file).localeCompare(String(b.file)) || (a.line || 0) - (b.line || 0));
}

function headTail(raw, head = 2000, tail = 2000) {
  const s = String(raw);
  if (s.length <= head + tail) return s;
  return s.slice(0, head) + '\n...[truncated ' + (s.length - head - tail) + ' chars]...\n' + s.slice(-tail);
}

function format(errors) {
  return errors.map((e) =>
    e.file + (e.line ? ':' + e.line + (e.column ? ':' + e.column : '') : '') +
    (e.code ? ' ' + e.code : '') + ' ' + e.message).join('\n');
}

module.exports = { parseTsc, parseVitestJson, dedupe, orderByDependency, headTail, format };
