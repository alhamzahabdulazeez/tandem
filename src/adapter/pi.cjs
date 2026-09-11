'use strict';
/**
 * THE ONLY FILE THAT MAY IMPORT PI.
 *
 * Decision: isolate the host behind one adapter. Pi's package scope and SDK surface
 * changed within four months during development; confining that risk to one file means a
 * breaking upgrade is a one-file fix, not a rewrite.
 *
 * Nothing here may name a gateway, a provider, or a model vendor.
 */

const CANDIDATES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-coding-agent',
];

/**
 * CJS require() of the host. The host is ESM-only, so this can never actually resolve
 * it — it exists to unit-test the "missing host is reported, never crashed on" contract
 * in isolation. The live status check (`tandem doctor`, `tandem run`) uses the async
 * dynamic-import loader of the same name in session.mjs instead.
 * @returns {{ok:true, mod:object, name:string}|{ok:false, tried:string[], error:string}}
 */
function loadHost() {
  const tried = [];
  for (const name of CANDIDATES) {
    tried.push(name);
    try { return { ok: true, mod: require(name), name }; } catch { /* try next */ }
  }
  return { ok: false, tried, error: 'no supported host package could be resolved' };
}

/**
 * Translate a host tool event into the neutral event shape the core understands.
 * The core never sees a host type.
 */
function toEvent(raw, ctx) {
  const name = String(raw && raw.toolName || raw && raw.tool_name || '').toLowerCase();
  const input = (raw && (raw.input || raw.tool_input)) || {};
  const file = input.file_path || input.path || input.filePath || null;

  let kind = 'read';
  if (name === 'write' || name === 'edit' || name === 'multiedit') kind = name === 'multiedit' ? 'edit' : name;
  else if (name === 'bash' || name === 'shell') kind = 'bash';
  else if (name === 'read' || name === 'grep' || name === 'glob' || name === 'search' || name === 'ls') kind = 'read';
  else kind = 'bash'; // unknown tools fail toward the guarded path

  return {
    kind,
    file: file ? String(file) : null,
    content: typeof input.content === 'string' ? input.content : null,
    newImports: [],
    dependentCount: 0,
    toolCallsInTurn: ctx && typeof ctx.toolCallsInTurn === 'number' ? ctx.toolCallsInTurn : undefined,
  };
}

module.exports = { CANDIDATES, loadHost, toEvent };
