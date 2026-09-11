#!/usr/bin/env node
'use strict';
/** tandem — init | doctor | run | bench | version */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CFG = require('../src/core/config.cjs');
const detect = require('../src/gates/detect.cjs');
const DG = require('../src/context/depgraph.cjs');
const DP = require('../src/core/decision-points.cjs');
const PROJ = require('../src/context/project.cjs');
const pkg = require('../package.json');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

function init(cwd) {
  const cfg = CFG.load(cwd);
  const gates = detect.detectGates(cwd, cfg);

  copyDir(path.join(ROOT, 'skills'), path.join(cwd, '.tandem', 'skills'));
  copyDir(path.join(ROOT, 'commands'), path.join(cwd, '.tandem', 'commands'));

  const md = path.join(cwd, 'TANDEM.md');
  if (!fs.existsSync(md)) {
    let tpl = fs.readFileSync(path.join(ROOT, 'templates', 'CLAUDE.md'), 'utf8');
    tpl = tpl.replace('<TYPECHECK>', gates.typecheck.command || 'not detected')
             .replace('<TEST>', gates.test.command || 'not detected')
             .replace('<LINT>', gates.lint.command || 'not configured');
    fs.writeFileSync(md, tpl);
  }
  if ((!gates.typecheck.available || !gates.test.available) && !fs.existsSync(path.join(cwd, 'tandem.json'))) {
    fs.writeFileSync(path.join(cwd, 'tandem.json'),
      JSON.stringify({ typecheckCommand: gates.typecheck.command, testCommand: gates.test.command }, null, 2));
  }

  console.log('tandem initialised\n');
  for (const [n, g] of Object.entries(gates)) {
    console.log(`  ${g.available ? 'enabled ' : 'disabled'}  ${n.padEnd(10)} ${g.available ? g.command : '(' + g.reason + ')'}`);
  }
  console.log('\n  written: .tandem/skills, .tandem/commands, TANDEM.md');
  console.log('\n  run:      tandem run "your task"');
  console.log('  disable:  TANDEM_HOOKS=off');
}

async function doctor(cwd) {
  const cfg = CFG.load(cwd);
  const gates = detect.detectGates(cwd, cfg);
  // The host is ESM-only: require() (src/adapter/pi.cjs) can never resolve it and always
  // reports NOT INSTALLED, even when it is. The real check goes through the same dynamic
  // import the live `run` path uses, in src/adapter/session.mjs.
  const session = await import('../src/adapter/session.mjs');
  const host = await session.loadHost();
  let graph = null;
  try { graph = DG.build(cwd); } catch { /* not a source tree */ }

  console.log(`tandem ${pkg.version}\n`);
  console.log('  host           ', host.ok ? session.HOST_PACKAGE : 'NOT INSTALLED — run: npm i ' + session.HOST_PACKAGE + '  (' + host.error + ')');
  console.log('  hooks          ', process.env.TANDEM_HOOKS === 'off' ? 'OFF (TANDEM_HOOKS=off)' : 'active');
  console.log('\n  gates');
  for (const [n, g] of Object.entries(gates)) {
    console.log(`    ${g.available ? 'enabled ' : 'disabled'}  ${n.padEnd(10)} ${g.available ? g.command : '(' + g.reason + ')'}`);
  }
  console.log('\n  decision points');
  for (const p of DP.ALL) console.log(`    ${p.padEnd(16)} ${DP.DESCRIPTIONS[p]}`);
  if (graph) {
    const busiest = Object.entries(graph.dependents).sort((a, b) => b[1].length - a[1].length)[0];
    console.log('\n  project');
    console.log('    source files  ', graph.files.length);
    if (busiest && busiest[1].length) console.log('    most depended ', `${busiest[0]} (${busiest[1].length} importers)`);
  }
  const skills = PROJ.loadSkills(cwd);
  const commands = PROJ.loadCommands(cwd);
  const conv = PROJ.loadConventions(cwd);
  console.log('\n  project context');
  console.log('    conventions   ', conv ? PROJ.CONVENTIONS + ' (' + Buffer.byteLength(conv) + ' bytes, injected)' : 'none — run: tandem init');
  console.log('    skills        ', Object.keys(skills).length ? Object.keys(skills).join(', ') + '  (lazy)' : 'none');
  console.log('    commands      ', Object.keys(commands).length ? Object.keys(commands).map((c) => '/' + c).join(' ') : 'none');
  console.log('\n  working set    ', cfg.workingSet.join(', '));
  console.log('  repair bound   ', cfg.maxRepairs);
  console.log('  DP3 threshold  ', cfg.dependentThreshold, 'importers');
  console.log('  density        ', cfg.verificationDensity);
  if (cfg._configError) console.log('\n  warning        ', cfg._configError);
  // Never print environment values, tokens or keys.
}

function run(cwd, rest) {
  // The host is ESM-only, so the bridge is .mjs and runs in its own process.
  const bridge = path.join(ROOT, 'src', 'adapter', 'run.mjs');
  const r = spawnSync(process.execPath, [bridge, ...rest], { cwd, stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

function bench(cwd, rest) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bench', 'run.cjs'), ...rest], { cwd, stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

const [, , cmd, ...rest] = process.argv;
const cwd = process.cwd();
if (cmd === 'init') init(cwd);
else if (cmd === 'doctor') doctor(cwd).catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
else if (cmd === 'run') run(cwd, rest);
else if (cmd === 'bench') bench(cwd, rest);
else if (cmd === '--version' || cmd === '-v') console.log(pkg.version);
else {
  console.log(`tandem ${pkg.version}\n`);
  console.log('  init     set up this project');
  console.log('  run      run a task with verification active');
  console.log('  doctor   report gates, decision points and project shape');
  console.log('  bench    measure verification on versus off');
  console.log('\n  disable at any time:  TANDEM_HOOKS=off');
}
