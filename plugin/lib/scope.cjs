'use strict';
/**
 * Derive the task scope from the user's prompt: which project files it names,
 * and whether it asks for test changes. Deterministic, no model.
 */

const { isTestFile } = require('./policy.cjs');

// The request asks to create or change tests (not merely to keep them passing).
const TESTS_REQUESTED = [
  /\b(?:add|write|create|update|fix|extend|improve|expand|rewrite|refactor|adjust|change|modify|repair)\b[^.\n]{0,40}\b(?:tests?|specs?|test[- ]?cases?|unit[- ]?tests?|coverage|assertions?)\b/i,
  /\b(?:tests?|specs?)\s+(?:for|covering|that\s+cover)\b/i,
  /\b(?:test|spec)\s+files?\b/i,
  /\bTDD\b/,
  /(?:اكتب|أضف|اضف|عدل|عدّل|حدث|حدّث|صحح|أصلح|اصلح)[^.\n]{0,30}(?:اختبار|اختبارات|الاختبار|الاختبارات)/,
];

const PATH_TOKEN = /[A-Za-z0-9_@./\\-]+\.[A-Za-z0-9]{1,8}\b|[A-Za-z0-9_@-]+(?:\/[A-Za-z0-9_@.-]+)+/g;

function testsRequested(prompt) {
  return TESTS_REQUESTED.some((re) => re.test(String(prompt || '')));
}

/**
 * @param {string} prompt
 * @param {string[]} files  tracked project files (posix, relative)
 */
function derive(prompt, files) {
  const text = String(prompt || '').replace(/\b(?:https?|ftp|file):\/\/\S+/gi, ' ');
  const set = new Set(files || []);
  const byBase = new Map();
  for (const f of files || []) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }

  const named = new Set();
  for (const raw of text.match(PATH_TOKEN) || []) {
    const tok = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/[.,:;)]+$/, '');
    if (!tok) continue;
    if (set.has(tok)) { named.add(tok); continue; }
    const suffix = (files || []).filter((f) => f.endsWith(`/${tok}`));
    if (suffix.length && suffix.length <= 3) { suffix.forEach((f) => named.add(f)); continue; }
    const base = byBase.get(tok);
    if (base && base.length <= 3) { base.forEach((f) => named.add(f)); continue; }
    // A path the task asks to create: keep it if it looks like a project path.
    if (/\//.test(tok) && /\.[A-Za-z0-9]{1,8}$/.test(tok) && !tok.startsWith('/') && !tok.includes('..')) named.add(tok);
  }

  const asked = testsRequested(text);
  const namedList = Array.from(named).sort();
  const namesTest = namedList.some((f) => isTestFile(f));
  return {
    named: namedList,
    testsAllowed: asked,
    reason: asked
      ? 'the request asks for test changes'
      : namesTest
        ? 'only the test files the request names may change'
        : 'the request does not ask for test changes',
  };
}

module.exports = { derive, testsRequested };
