'use strict';
/**
 * Project context — conventions, skills and commands.
 *
 * These were inert in an earlier build: `init` wrote them to disk and nothing read them.
 * They worked in the previous host because it loaded such files natively; this host does
 * not, so Tandem loads them itself.
 *
 * Skills are loaded LAZILY. Published measurement is unambiguous: adding context past a
 * threshold makes results worse, and a targeted 5k retrieval beat a 100k summary. Only a
 * one-line index goes into the preamble; a skill's body is injected when its trigger fires.
 */
const fs = require('node:fs');
const path = require('node:path');

const CONVENTIONS = 'TANDEM.md';
const DIR = '.tandem';

/** Trigger events, derived from the event stream — never chosen by a model. */
const TRIGGERS = Object.freeze({
  'contract-first': ['first-mutation'],
  'verify-each-step': ['first-mutation'],
  'bounded-repair': ['gate-failed'],
  'deterministic-first': ['gate-failed'],
  'no-guessing': ['new-import'],
});

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** Strip YAML front matter and collapse to the instruction body. */
function skillBody(text) {
  return String(text).replace(/^---[\s\S]*?---\s*/, '').trim();
}

function firstLine(text) {
  const m = /^description:\s*(.+)$/m.exec(String(text));
  if (m) return m[1].trim();
  return skillBody(text).split('\n')[0].slice(0, 80);
}

function loadSkills(cwd) {
  const dir = path.join(cwd, DIR, 'skills');
  const out = {};
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const text = readIfExists(path.join(dir, e.name, 'SKILL.md'));
    if (!text) continue;
    out[e.name] = { name: e.name, summary: firstLine(text), body: skillBody(text) };
  }
  return out;
}

function loadCommands(cwd) {
  const dir = path.join(cwd, DIR, 'commands');
  const out = {};
  let files;
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const text = readIfExists(path.join(dir, f));
    if (!text) continue;
    out[f.replace(/\.md$/, '')] = skillBody(text);
  }
  return out;
}

function loadConventions(cwd) {
  const text = readIfExists(path.join(cwd, CONVENTIONS));
  if (!text) return null;
  // Drop the template's own comment block so it never reaches the model.
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** One line per skill. The body stays on disk until its trigger fires. */
function skillIndex(skills) {
  const names = Object.keys(skills);
  if (names.length === 0) return '';
  return 'Available skills (loaded when relevant): ' + names.join(', ');
}

/** Which skill bodies a trigger should inject. */
function skillsFor(skills, trigger) {
  return Object.values(skills).filter((s) => (TRIGGERS[s.name] || []).includes(trigger));
}

/** A leading /name expands to that command's instructions. */
function expandCommand(commands, prompt) {
  const m = /^\/([a-z][a-z0-9-]*)\s*([\s\S]*)$/i.exec(String(prompt || '').trim());
  if (!m) return { expanded: false, prompt };
  const body = commands[m[1].toLowerCase()];
  if (!body) return { expanded: false, prompt, unknown: m[1] };
  const rest = m[2].trim();
  return { expanded: true, command: m[1], prompt: rest ? body + '\n\nTask: ' + rest : body };
}

module.exports = {
  CONVENTIONS, DIR, TRIGGERS,
  loadSkills, loadCommands, loadConventions,
  skillIndex, skillsFor, expandCommand, skillBody, firstLine,
};
