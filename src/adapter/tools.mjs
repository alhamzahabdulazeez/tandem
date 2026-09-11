/**
 * Tandem's own tools.
 *
 * Why these exist. The host's `createReadTool` and friends are `AgentHarnessTool`s:
 * their execute signature is (toolCallId, params, onUpdate, toolContext, invocation,
 * context) and they require an `ExecutionToolContext { env: FileSystem & Shell }` that the
 * host does not construct for a bare `Agent`. Passing them straight to `Agent` produced
 * exactly the failure observed on real hardware:
 *
 *     Cannot read properties of undefined (reading 'absolutePath')
 *     Cannot read properties of undefined (reading 'cwd')
 *
 * Rather than reverse-engineer the harness wiring, Tandem ships four plain `AgentTool`s.
 *
 * The signature matters and cost a full live run to find. `AgentTool.execute` is
 *
 *     execute(toolCallId: string, params, signal?, onUpdate?)
 *
 * not `execute(params)`. Writing the shorter form makes the first argument the tool call
 * ID, every parameter reads as undefined, and every write lands on the project root:
 *
 *     write failed: EISDIR: illegal operation on a directory
 *
 * `label` is also required by the interface.
 *
 * These tools depend on nothing but Node, so the host's harness internals cannot break them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ content: [{ type: 'text', text: String(s) }], isError: true });

/** Resolve inside the project and refuse to escape it. */
function resolveIn(cwd, p) {
  const abs = path.resolve(cwd, String(p || ''));
  const root = path.resolve(cwd);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export function createTools(cwd, opts = {}) {
  const maxBytes = opts.maxBytes || 200_000;
  const timeoutMs = opts.timeoutMs || 120_000;

  return [
    {
      name: 'read',
      label: 'Read',
      description: 'Read a UTF-8 text file from the project.',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: 'Path relative to the project root.' } },
        required: ['file_path'],
      },
      execute: async (_toolCallId, args) => {
        const p = resolveIn(cwd, args && args.file_path);
        if (!p) return fail('path is outside the project');
        try {
          const body = fs.readFileSync(p, 'utf8');
          return text(body.length > maxBytes ? body.slice(0, maxBytes) + '\n...[truncated]' : body);
        } catch (e) { return fail('read failed: ' + e.message); }
      },
    },
    {
      name: 'write',
      label: 'Write',
      description: 'Create or overwrite a text file, creating parent directories as needed.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path relative to the project root.' },
          content: { type: 'string', description: 'Full file contents.' },
        },
        required: ['file_path', 'content'],
      },
      execute: async (_toolCallId, args) => {
        const p = resolveIn(cwd, args && args.file_path);
        if (!p) return fail('path is outside the project');
        try {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, String((args && args.content) ?? ''));
          return text('wrote ' + path.relative(cwd, p).split(path.sep).join('/'));
        } catch (e) { return fail('write failed: ' + e.message); }
      },
    },
    {
      name: 'edit',
      label: 'Edit',
      description: 'Replace an exact string in a file. old_string must appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
      execute: async (_toolCallId, args) => {
        const p = resolveIn(cwd, args && args.file_path);
        if (!p) return fail('path is outside the project');
        try {
          const body = fs.readFileSync(p, 'utf8');
          const parts = body.split(String(args.old_string));
          if (parts.length === 1) return fail('old_string not found');
          if (parts.length > 2) return fail('old_string appears ' + (parts.length - 1) + ' times; make it unique');
          fs.writeFileSync(p, parts.join(String(args.new_string)));
          return text('edited ' + path.relative(cwd, p).split(path.sep).join('/'));
        } catch (e) { return fail('edit failed: ' + e.message); }
      },
    },
    {
      name: 'bash',
      label: 'Bash',
      description: 'Run a shell command in the project directory.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      execute: async (_toolCallId, args) => {
        const cmd = args && args.command;
        if (!cmd) return fail('no command given');
        const r = spawnSync(String(cmd), {
          cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
        });
        const out = ((r.stdout || '') + (r.stderr || '')).slice(0, maxBytes);
        if (r.status === 0) return text(out || '(no output)');
        return fail('exit ' + (r.status == null ? 'timeout' : r.status) + '\n' + out);
      },
    },
  ];
}

export default { createTools };
