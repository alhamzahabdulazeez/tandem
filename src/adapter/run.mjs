/**
 * `tandem run` — constructs the host agent with Tandem's verification wired in.
 *
 * Written against @earendil-works/pi-agent-core 0.85.1, read from its own type definitions:
 *
 *   new Agent({ streamFn, getApiKey?, initialState: { systemPrompt, model, tools },
 *               beforeToolCall, afterToolCall, shouldStopAfterTurn })
 *   await agent.prompt(text)
 *
 * The three hooks come from session.mjs and carry all five decision points.
 * This file and session.mjs are the only ones that know a host exists.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHooks, loadHost, HOST_PACKAGE } from './session.mjs';
import { createTools } from './tools.mjs';

function loadEnvDefaults() {
  const vars = ['TANDEM_BASE_URL', 'TANDEM_API_KEY', 'TANDEM_MODEL', 'TANDEM_PROVIDER', 'TANDEM_API'];
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length === 0) return;

  const home = os.homedir();
  const rcFiles = [
    path.join(home, '.bashrc'),
    path.join(home, '.profile'),
    path.join(home, '.bash_profile'),
  ];
  for (const rc of rcFiles) {
    if (fs.existsSync(rc)) {
      try {
        const content = fs.readFileSync(rc, 'utf8');
        for (const line of content.split('\n')) {
          const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(?:["']([^"']*)["']|([^\s#]+))/);
          if (m) {
            const key = m[1];
            const val = m[2] !== undefined ? m[2] : m[3];
            if (vars.includes(key) && !process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

function parseArgs(argv) {
  loadEnvDefaults();
  const out = { model: process.env.TANDEM_MODEL || null, provider: process.env.TANDEM_PROVIDER || null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') out.model = argv[++i];
    else if (a === '--provider') out.provider = argv[++i];
    else if (a === '-p' || a === '--print') { /* accepted for familiarity */ }
    else if (a === '-v' || a === '--verbose') { /* accepted */ }
    else out.rest.push(a);
  }
  out.prompt = out.rest.join(' ').trim() || null;
  return out;
}

/**
 * Resolve a model.
 *
 * Verified on the installed host: it exports no getModel-style helper. Models come from
 * the provider layer's store (`createModels` / `InMemoryModelsStore` in pi-ai). Tandem
 * names no provider (decision D-09) — the caller supplies the id and, if the store needs
 * it, the provider id.
 */
async function resolveModel(mod, modelId, provider) {
  if (!modelId) return null;

  let ai = null;
  try { ai = await import('@earendil-works/pi-ai'); } catch { /* optional */ }

  // Prefer the provider layer's own store when it can produce a full Model.
  if (ai && typeof ai.createModels === 'function') {
    try {
      const store = await ai.createModels();
      for (const fn of ['get', 'find', 'resolve', 'byId']) {
        if (store && typeof store[fn] === 'function') {
          const m = provider ? await store[fn](provider, modelId) : await store[fn](modelId);
          if (m && m.api && m.baseUrl) return m;
        }
      }
    } catch { /* fall through */ }
  }

  // Otherwise build a complete Model. Verified against the provider layer's own type:
  // a bare { id } produced an empty assistant turn — every required field must be present.
  const cfg = deps_modelConfig();
  return {
    id: modelId,
    name: modelId,
    api: cfg.api,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: cfg.contextWindow,
    maxTokens: cfg.maxTokens,
    // The host's openai-completions module sends OpenAI's `store: false` field unless the
    // endpoint is on its own hardcoded non-standard-provider list — which cannot cover
    // every OpenAI-compatible endpoint Tandem might be pointed at (D-09: it names none of
    // them). Verified against a real endpoint outside that list: a strict-schema compat
    // layer 400s on the unrecognised field ("Unknown name \"store\": Cannot find field.").
    // The host's own `compat` override exists for exactly this. Omitting the field is
    // harmless for an endpoint that does understand it — the value sent is always `false`
    // regardless of whether the field is present — so this is safe for every endpoint.
    compat: { supportsStore: false },
  };
}

/**
 * Endpoint configuration.
 *
 * Tandem names no provider (decision D-09). The endpoint comes from the caller's own
 * environment under Tandem-owned names, so nothing here is tied to one vendor.
 */
function deps_modelConfig() {
  return {
    api: process.env.TANDEM_API || 'openai-completions',
    provider: process.env.TANDEM_PROVIDER || 'custom',
    baseUrl: process.env.TANDEM_BASE_URL || '',
    contextWindow: Number(process.env.TANDEM_CONTEXT || 128000),
    maxTokens: Number(process.env.TANDEM_MAX_TOKENS || 8192),
  };
}

/**
 * Resolve a stream function.
 *
 * Verified on the installed host: it exports `streamProxy` and `setDefaultStreamFn`, not
 * a bare `streamFn`. `streamProxy(model, context, options)` matches the StreamFn shape.
 */
async function resolveStreamFn(mod) {
  // Verified the hard way: streamProxy is a client for a proxy SERVER. With no proxy
  // configured it builds "undefined/api/stream" and the turn fails. Direct provider
  // calls need the api module's own stream function.
  const api = deps_modelConfig().api;
  const SUBPATHS = {
    'openai-completions': '@earendil-works/pi-ai/api/openai-completions',
    'anthropic-messages': '@earendil-works/pi-ai/api/anthropic-messages',
    'google-generative-ai': '@earendil-works/pi-ai/api/google-generative-ai',
  };
  const sub = SUBPATHS[api];
  if (sub) {
    try {
      const m = await import(sub);
      if (typeof m.stream === 'function') return m.stream;
      if (typeof m.streamSimple === 'function') return m.streamSimple;
    } catch { /* fall through */ }
  }
  for (const n of ['streamFn', 'simpleStream', 'createStreamFn']) {
    if (typeof mod[n] === 'function') return mod[n];
  }
  // Last resort only: works when a proxy server is configured.
  if (typeof mod.streamProxy === 'function') return mod.streamProxy;
  return null;
}

export async function run(argv, deps = {}) {
  const { model: modelId, provider, prompt } = parseArgs(argv);
  const cwd = deps.cwd || process.cwd();
  const err = deps.stderr || ((s) => process.stderr.write(s));
  const out = deps.stdout || ((s) => process.stdout.write(s));

  const host = deps.host || (await loadHost());
  if (!host.ok) {
    err(`tandem: host agent not available.\n\n  npm i -g ${HOST_PACKAGE}\n\n  reason: ${host.error}\n`);
    return 1;
  }
  if (!prompt) { err('tandem run "your task"\n'); return 2; }

  const mod = host.mod;
  if (typeof mod.Agent !== 'function') {
    err('tandem: the installed host does not export Agent.\n  This file is the single integration point — see FINISH.md.\n');
    return 2;
  }

  const hooks = createHooks(cwd, modelId, (s) => err(s + '\n'));

  // A leading /name expands to that command's instructions before the model sees it.
  const cmd = hooks.tandem.expandCommand(prompt);
  const finalPrompt = cmd.expanded ? cmd.prompt : prompt;
  if (cmd.expanded) err(`tandem: expanded /${cmd.command}\n`);
  else if (cmd.unknown) err(`tandem: unknown command /${cmd.unknown} — sending as plain text\n`);
  const streamFn = deps.streamFn || (await resolveStreamFn(mod));
  if (typeof streamFn !== 'function') {
    err('tandem: the host exposes no stream function under a known name.\n' +
        '  Looked for the api module stream, then streamFn/simpleStream, then streamProxy.\n');
    return 2;
  }

  const VERBOSE = process.env.TANDEM_VERBOSE === '1' || process.argv.includes('--verbose');
  const model = deps.model || (await resolveModel(mod, modelId, provider));
  if (VERBOSE) {
    err('  [diag] streamFn      : ' + (streamFn === mod.streamProxy ? 'streamProxy (PROXY MODE)' : 'direct api stream') + '\n');
    err('  [diag] model         : ' + JSON.stringify(model) + '\n');
  }
  if (!model) {
    err(`tandem: could not resolve a model.\n  Pass --model <id> (and --provider <id> if the host needs it).\n`);
    return 2;
  }

  // Tandem's own tools. The host's factories are harness tools needing an execution
  // context the bare Agent does not build — see tools.mjs.
  const tools = deps.tools || createTools(cwd);
  if (VERBOSE) err('  [diag] tools         : ' + tools.length + ' — ' + tools.map((t) => t && t.name).join(', ') + ' (tandem)\n');

  err('tandem: verification active — 5 decision points, working set enforced.\n' +
      '        disable with TANDEM_HOOKS=off\n\n');

  const apiKey = process.env.TANDEM_API_KEY || (deps_modelConfig().baseUrl ? 'none' : null);
  if (VERBOSE) err('  [diag] baseUrl       : ' + (deps_modelConfig().baseUrl || '(unset — set TANDEM_BASE_URL)') + '\n' +
                   '  [diag] api key       : ' + (apiKey ? 'present' : 'MISSING — set TANDEM_API_KEY') + '\n');

  const agent = new mod.Agent({
    streamFn,
    getApiKey: () => apiKey || undefined,
    initialState: { systemPrompt: hooks.preamble, model, tools },
    beforeToolCall: hooks.beforeToolCall,
    afterToolCall: hooks.afterToolCall,
    shouldStopAfterTurn: hooks.shouldStopAfterTurn,
  });

  const seen = [];
  let streamedAnyText = false;
  if (typeof agent.subscribe === 'function') {
    agent.subscribe((ev) => {
      if (!ev) return;
      seen.push(ev.type);
      if (VERBOSE) {
        let extra = '';
        const m = ev.message || ev;
        if (m && m.errorMessage) extra = '\n         ERROR: ' + String(m.errorMessage).slice(0, 500);
        else if (m && m.stopReason) extra = ' stop=' + m.stopReason;
        if (ev.type === 'message_end' && m && Array.isArray(m.content)) {
          extra += ' role=' + (m.role || '?') + ' blocks=[' + m.content.map((c) => c && c.type).join(',') + ']';
          const txt = m.content.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ');
          if (txt) extra += '\n         TEXT: ' + txt.slice(0, 300);
        }
        err('  [diag] event         : ' + ev.type + extra + '\n');
      }

      if (ev.type === 'message_start') {
        streamedAnyText = false;
      } else if (ev.type === 'message_update') {
        if (ev.assistantMessageEvent && ev.assistantMessageEvent.type === 'text_delta' && typeof ev.assistantMessageEvent.delta === 'string') {
          out(ev.assistantMessageEvent.delta);
          streamedAnyText = true;
        }
      } else if (ev.type === 'message_end') {
        const m = ev.message;
        if (!streamedAnyText && m && m.role === 'assistant' && Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block && block.type === 'text' && typeof block.text === 'string') {
              out(block.text);
            }
          }
        }
        streamedAnyText = false;
      }
    });
  }

  try {
    await agent.prompt(finalPrompt);
    if (typeof agent.waitForIdle === 'function') await agent.waitForIdle();

    const telem = typeof hooks.getTelemetry === 'function' ? hooks.getTelemetry() : {
      toolCalls: 0,
      filesRead: [],
      scopeBlocksFired: 0,
    };
    err(`\n[tandem:telemetry] tool_calls=${telem.toolCalls} files_read=${telem.filesRead.length} scope_blocks_fired=${telem.scopeBlocksFired}\n`);

    // A turn that produced no events means the model was never reached.
    if (seen.length === 0) {
      err('\ntandem: the session produced no events — the model was not reached.\n' +
          '        Run again with --verbose, and check that the host has provider\n' +
          '        credentials configured. Tandem does not manage them (D-09).\n');
      return 3;
    }
    const st = typeof agent.state === 'function' ? agent.state() : agent.state;
    if (st && st.errorMessage) { err('\ntandem: agent reported — ' + st.errorMessage + '\n'); return 4; }
    out('\n');
    return 0;
  } catch (e) {
    const telem = typeof hooks.getTelemetry === 'function' ? hooks.getTelemetry() : {
      toolCalls: 0,
      filesRead: [],
      scopeBlocksFired: 0,
    };
    err(`\n[tandem:telemetry] tool_calls=${telem.toolCalls} files_read=${telem.filesRead.length} scope_blocks_fired=${telem.scopeBlocksFired}\n`);
    err('\ntandem: session failed — ' + (e && e.message ? e.message : String(e)) + '\n');
    return 1;
  }
}

// Only run when invoked directly, so tests can import this module.
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  process.exit(await run(process.argv.slice(2)));
}
