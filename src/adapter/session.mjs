/**
 * Session bridge — the ONLY file that talks to the host agent.
 *
 * The host is ESM-only ("type": "module", exports expose "import" only), so this file is
 * .mjs and loads it with a dynamic import. The Tandem core stays CommonJS and is pulled in
 * through createRequire — the core must never know the host exists.
 *
 * Verified against @earendil-works/pi-agent-core 0.85.1 by reading its type definitions:
 *   beforeToolCall(ctx) -> { block?, reason?, terminate? }   blocks execution
 *   afterToolCall(ctx)  -> { content?, isError?, terminate? } overrides the tool result
 *   shouldStopAfterTurn(ctx) -> boolean                       decides whether the turn ends
 *
 * Those three map exactly onto the five decision points.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Tandem } = require('../index.cjs');

export const HOST_PACKAGE = '@earendil-works/pi-agent-core';

/** @returns {Promise<{ok:true,mod:object}|{ok:false,error:string}>} */
export async function loadHost() {
  try { return { ok: true, mod: await import(HOST_PACKAGE) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

/** Read a file path out of validated tool arguments, whatever the tool calls it. */
function filePathOf(args) {
  if (!args || typeof args !== 'object') return null;
  const a = /** @type {Record<string, unknown>} */ (args);
  for (const k of ['file_path', 'path', 'filePath', 'file']) {
    if (typeof a[k] === 'string') return a[k];
  }
  return null;
}

function contentOf(args) {
  if (!args || typeof args !== 'object') return null;
  const a = /** @type {Record<string, unknown>} */ (args);
  for (const k of ['content', 'new_string', 'newString', 'text']) {
    if (typeof a[k] === 'string') return a[k];
  }
  return null;
}

/** Host tool name -> neutral event kind. Unknown tools fail toward the guarded path. */
function kindOf(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'write') return 'write';
  if (n === 'edit' || n === 'multiedit') return 'edit';
  if (n === 'read' || n === 'grep' || n === 'glob' || n === 'ls' || n === 'search') return 'read';
  if (n === 'bash' || n === 'shell') return 'bash';
  return 'bash';
}

function toEvent(ctx, toolCallsInTurn) {
  const name = ctx && ctx.toolCall && (ctx.toolCall.name || ctx.toolCall.toolName);
  return {
    name,
    tool: name,
    kind: kindOf(name),
    file: filePathOf(ctx && ctx.args),
    content: contentOf(ctx && ctx.args),
    rawArgs: ctx && ctx.args,
    newImports: [],
    dependentCount: 0,
    toolCallsInTurn,
  };
}

/**
 * Build the three hook functions the host expects.
 * Returned object is spread straight into AgentOptions.
 */
export function createHooks(cwd, modelId, log = (s) => process.stderr.write(s + '\n'), ceilings, options) {
  const tandem = new Tandem(cwd, modelId, ceilings, options);
  let toolCallsInTurn = 0;
  let totalToolCalls = 0;
  const filesRead = new Set();
  let scopeBlocksFired = 0;

  const drain = () => { for (const n of tandem.drainNotices()) log(n); };

  return {
    tandem,
    preamble: tandem.sessionStart(),

    async beforeToolCall(ctx) {
      totalToolCalls++;
      toolCallsInTurn++;
      const ev = toEvent(ctx, toolCallsInTurn);
      if (ev.kind === 'read' && ev.file) {
        filesRead.add(ev.file);
      }
      const verdict = tandem.beforeTool(ev);
      drain();
      if (verdict.block) {
        scopeBlocksFired++;
        log(`TANDEM_BLOCK ${verdict.reason}`);
        return { block: true, reason: verdict.reason };
      }
      return undefined;
    },

    async afterToolCall(ctx) {
      const verdict = tandem.afterTool(toEvent(ctx, toolCallsInTurn));
      drain();
      if (verdict.ok) return undefined;
      return {
        content: [{ type: 'text', text: verdict.message }],
        isError: true,
      };
    },

    async shouldStopAfterTurn(ctx) {
      // A turn that called no tools is the model signalling completion. That is DP5.
      const used = Array.isArray(ctx && ctx.toolResults) ? ctx.toolResults.length : toolCallsInTurn;
      toolCallsInTurn = 0;
      if (used > 0) return false;
      const verdict = tandem.finish();
      drain();
      if (verdict.message) log(verdict.message);
      return verdict.done;
    },

    getTelemetry() {
      return {
        toolCalls: totalToolCalls,
        filesRead: Array.from(filesRead),
        scopeBlocksFired,
      };
    },
  };
}

export default { HOST_PACKAGE, loadHost, createHooks };
