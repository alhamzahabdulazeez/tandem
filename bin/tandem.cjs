#!/usr/bin/env node
'use strict';
/** tandem — init | doctor | run | check | status | evidence | bench | version */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CFG = require('../src/core/config.cjs');
const detect = require('../src/gates/detect.cjs');
const DG = require('../src/context/depgraph.cjs');
const DP = require('../src/core/decision-points.cjs');
const PROJ = require('../src/context/project.cjs');
const CHECK = require('../src/check/checker.cjs');
const REPORT = require('../src/control/report.cjs');
const STATE = require('../src/control/state.cjs');
const pkg = require('../package.json');

/** Canonical durable-supervision store root (§6). Overridable for inspection. */
function storeRoot(cwd, rest) {
  if (rest && rest[0]) return path.resolve(cwd, rest[0]);
  return process.env.TANDEM_STORE ? path.resolve(process.env.TANDEM_STORE) : path.join(cwd, '.tandem', 'store');
}

/** Probe for on-disk store content without creating anything (read-only). */
function storeExists(root) {
  return fs.existsSync(path.join(root, 'journal')) || fs.existsSync(path.join(root, 'snapshot.json'));
}

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

/**
 * `tandem check` — honest, non-executing inspection (PRD §22, F-05).
 *
 * This is the checker/observer mode that is the valid supported state for the
 * repository until Gate-0 blockers close (docs/GATE0-AUDIT.md §J). It executes
 * nothing; it only reports what it could and could not inspect.
 *
 * It deliberately makes no supervision or prevention claim. Supervised
 * execution is reported as unavailable because, per the Gate-0 audit, no
 * qualified support profile exists and IB-01 is open — the code below carries
 * that current-state fact explicitly rather than pretending otherwise.
 */
function check(cwd, rest) {
  // `tandem check [path]` — explicit selection. Defaults to the working
  // directory. The inspected path is not changed in any way.
  const target = (rest && rest[0]) ? path.resolve(cwd, rest[0]) : cwd;
  let report;
  try {
    report = CHECK.inspect(target, { maxFileBytes: 1 * 1024 * 1024, maxFiles: 10000 });
  } catch (e) {
    console.error(`tandem check: could not inspect ${target}: ${e.message}`);
    process.exit(2);
  }

  console.log(`tandem ${pkg.version} — check\n`);
  console.log(`  inspected root   ${report.inspectedRoot}`);
  console.log(`  repo shape       ${report.repoShape}`);
  console.log(`  files read       ${report.scope.filesRead} (${report.scope.totalBytesRead} bytes)`);
  console.log(`  files skipped    ${report.scope.filesSkipped}`);
  const excl = report.excludedDirectories && report.excludedDirectories.length
    ? report.excludedDirectories.join(', ')
    : 'none';
  console.log(`  complete capture ${report.claims.completeCapture ? 'yes' : 'no'}`);
  console.log(`  unsupported      ${report.unsupported.length === 0 ? 'none' : report.unsupported.length + ' shape(s) — see evidence'}`);
  console.log(`  excluded         ${excl} (not source content)`);
  console.log(`  manifest         sha256:${report.manifest.entriesDigest} (${report.manifest.count} entries)`);
  console.log('\n  honest limits (not accomplishments)');
  console.log(`    executed               ${report.claims.executed ? 'yes' : 'no'}`);
  console.log(`    prevented anything     ${report.claims.preventedAnything ? 'yes' : 'no'}`);
  console.log('\n  supervised execution: UNAVAILABLE — no qualified support profile');
  console.log('    (Gate-0 status: IB-01 open; see docs/GATE0-AUDIT.md §J)');

  process.exit(report.unsupported.length ? 1 : 0);
}

const [, , cmd, ...rest] = process.argv;
const cwd = process.cwd();

/**
 * `tandem status` — inspect task, lifecycle, delivery, resource, and recovery
 * state from the durable supervision store (§22). Read-only and additive to
 * `check`. It never executes anything and never acquires the supervision lock.
 * Cases handled honestly:
 *   - no store present   -> reported as absent (nothing fabricated);
 *   - store is corrupt   -> fail closed, exit 1;
 *   - otherwise          -> the read-only section reduction with qualification and
 *                           ownership/identity (§6/§10) facts.
 */
function status(cwd, rest) {
  const root = storeRoot(cwd, rest);
  console.log(`tandem ${pkg.version} — status`);
  if (!storeExists(root)) {
    console.log(`\n  durable supervision store: none at ${root}`);
    console.log('  nothing supervised in this store yet; no status to report');
    return 0;
  }
  let store;
  try {
    store = STATE.open(root);
  } catch (e) {
    console.error(`\n  store corrupt — inspection closed: ${e.message}`);
    return 1;
  }
  if (store.corrupt) {
    console.error(`\n  store corrupt — inspection closed: ${store.corrupt.reason} (at ${store.corrupt.at})`);
    store.close();
    return 1;
  }
  const r = REPORT.statusReport(store.all());
  const fail = (s) => { console.error(`\n  store invalid — statuses not trustworthy: ${s}`); return 1; };
  if (!r.storeValid) return fail(r.storeProblems.join('; '));

  console.log(`\n  store             ${root} (${r.task.present ? r.task.tasks.length + ' incarnations' : 'no task records'})`);
  console.log(`  stateId           ${store.stateId()}`);

  console.log('\n  task');
  if (!r.task.present) console.log('    none');
  for (const t of r.task.tasks) {
    console.log(`    ${t.incarnationId.padEnd(28)} phase=${t.phase} status=${t.incarnationStatus} src=${t.sourceCommit || 'unset'}`);
  }

  console.log('\n  lifecycle (actions)');
  if (!r.lifecycle.present) console.log('    none');
  for (const a of r.lifecycle.actions) {
    console.log(`    ${a.actionId.padEnd(28)} lc=${a.lifecycle} disp=${a.dispatch} exec=${a.execution} dispRes=${a.resourceDisposition}`);
  }
  if (r.lifecycle.present) {
    console.log(`    unresolved=${r.lifecycle.counts.unresolved} quarantined=${r.lifecycle.counts.quarantined}`);
  }

  console.log('\n  generation');
  if (!r.generation.present) console.log('    none');
  for (const g of r.generation.generations) {
    console.log(`    ${g.generationId.padEnd(28)} state=${g.state}${g.treeDigest ? '' : ' (no tree digest bound)'}`);
  }

  console.log('\n  delivery');
  if (!r.delivery.present) console.log('    none');
  for (const d of r.delivery.deliveries) {
    const avail = d.historicallyAttributable ? (d.currentlyAvailable ? 'available' : 'expired/unavailable') : 'not published';
    console.log(`    ${d.deliveryId.padEnd(28)} ${d.persistenceState} → ${avail}  gen=${d.frozenGenerationId}`);
  }

  console.log('\n  resources');
  if (!r.resources.present) console.log('    none');
  for (const q of r.resources.quarantines) console.log(`    ${q.quarantineId.padEnd(28)} quarantine state=${q.state} resource=${q.resource}`);
  for (const s of r.resources.reservations) console.log(`    ${s.reservationId.padEnd(28)} reservation state=${s.state} exp=${s.maxExposure}`);

  console.log('\n  recovery');
  if (!r.recovery.present) console.log('    none');
  for (const f of r.recovery.finalizations) {
    console.log(`    ${f.finalizationId.padEnd(28)} stop=${f.stopReason} successGate=${f.successGate} quiescence=${f.quiescenceProven} fence=${f.fencingEstablished} q=${f.quarantinedResources} result=${f.result}`);
  }
  if (r.recovery.repairCount > 0) {
    for (const x of r.recovery.repairs) {
      console.log(`    repair ${x.repairId.padEnd(24)} allowanceConsumed=${x.allowanceConsumed} dispGeneration=${x.disposableGenerationId || 'unset'}`);
    }
    console.log(`    repairs=${r.recovery.repairCount}/${r.recovery.repairCeiling} (MVP ceiling is one; exceeded=${r.recovery.repairExceeded})`);
  }

  // Unit 15: §6 store identity + §10 ownership integrity (epoch ledger).
  // Read-only reduction; identity/ownership is NOT qualification and grants no
  // execution authority (authorityGranted is always false).
  console.log('\n  ownership (§6/§10)');
  const ow = r.ownership;
  if (!ow.present) {
    for (const p of ow.identityProblems) console.log(`    ${p}`);
  } else {
    console.log(`    store identity    ${ow.storeIdentity || 'UNAVAILABLE'}  (self-consistent=${ow.storeIdentityOk})`);
    console.log(`    owner             ${ow.ownerIdentity}`);
    console.log(`    lock              ${ow.lockIdentity}`);
    console.log(`    canonical path    ${ow.canonicalStorePath}`);
    console.log(`    epoch             ${ow.currentEpoch}  admission=${ow.admissionState}  recovery=${ow.recoveryState}`);
    for (const e of ow.epochAllocations) {
      console.log(`      epoch ${e.epochNumber}  role=${e.role}  owner=${e.ownerIdentity}`);
    }
    console.log(`    ledger integrity  ${ow.ownershipIntegrityOk ? 'clean (contiguous + lawful role transitions)' : 'BROKEN — fail closed'}`);
    for (const p of [...ow.identityProblems, ...ow.ownershipProblems]) console.log(`      ${p}`);
    console.log('    authority        NONE (ownership is not execution authority)');
  }

  // Unit 13: §13 intent inventory + §15 decision-priority facts. Read-only
  // reductions; the decision section reports the deterministic gate the records
  // attest (a derived fact like recoveryStatus.successGate), never an admission.
  console.log('\n  intent (admitted requirements, §13)');
  if (!r.intent.present) console.log('    none');
  for (const x of r.intent.intents) {
    console.log(`    ${x.requirementId.padEnd(20)} class=${x.intentClass} axis=${x.explicitOrInferred} ${x.mandatoryOrOptional}/${x.applicability} src=${x.sourceAndProvenance || 'unset'}`);
  }
  if (r.intent.present) {
    console.log(`    mandatory=${r.intent.mandatoryCount} provenanceOk=${r.intent.provenanceOk} mandatoryIntentOk=${r.intent.mandatoryIntentOk}`);
    for (const p of r.intent.provenanceProblems) console.log(`      provenance: ${p}`);
    for (const p of r.intent.mandatoryIntentProblems) console.log(`      mandatory: ${p}`);
  }

  console.log('\n  decision (§15 priority ladder)');
  console.log(`    gates             ${r.decision.decisionGates.join(' > ')}`);
  const dline = [];
  if (r.decision.authorityDisputeAttested) dline.push('AUTHORITY_DISPUTE');
  if (r.decision.hardStopConditionsAttested) dline.push('HARD_STOP');
  if (r.decision.ambiguityAttested) dline.push('CONSEQUENTIAL_AMBIGUITY');
  if (r.decision.repairExceeded) dline.push('REPAIR_EXCEEDED');
  console.log(`    record-attested   ${dline.length ? dline.join(', ') : 'none'}`);
  console.log(`    implied gate      ${r.decision.impliedGate}  (derived fact from these records; not an admission)`);
  for (const p of r.decision.problems) console.log(`      ${p}`);

  // Unit 14: §5 qualification facts — evidence-reduced; qualification never
  // grants execution authority. Under IB-01 nothing on this host is qualified.
  console.log('\n  qualification (§5 support records)');
  if (!r.qualification.present) {
    console.log('    none');
    console.log(`    profile gate      ${r.qualification.qualified ? 'qualified' : `${r.qualification.qualificationStatus || 'not established'}`} (${r.qualification.qualificationRule || 'no task'})`);
  }
  for (const q of r.qualification.qualifications) {
    console.log(`    ${q.qualificationId.padEnd(24)} profile=${q.profileId} v=${q.profileVersion || 'unset'} claimed=${q.claimedStatus} actual=${q.actualStatus}`);
    for (const p of q.problems) console.log(`      ${p}`);
    if (q.failureModes.length) console.log(`      failure modes: ${q.failureModes.join(', ')}`);
    for (const s of q.staleEvidence) console.log(`      stale: ${s}`);
    if (q.coveredSurfaces.length) console.log(`      covered surfaces: ${q.coveredSurfaces.join(', ')}`);
  }
  if (r.qualification.present) {
    console.log(`    evidence          ${r.qualification.evidenceCount} record(s); profile gate ${r.qualification.qualified ? 'QUALIFIED' : `${r.qualification.qualificationStatus || 'not established'}`}` + (r.qualification.surfacesCovered.length ? `; surfaces with passing proof: ${r.qualification.surfacesCovered.join(', ')}` : ''));
    for (const p of r.qualification.problems) console.log(`      ${p}`);
  }

  // Unit 11: the coherence plane — the SAME gates the §21 reduction consumes,
  // derived from the same records. Status surfaces gate facts (it is not the
  // supervisor; it does not reduce acceptance itself) and fails closed.
  console.log('\n  coherence (derived gates, §16/§17/§20/§21)');
  const c = r.coherence;
  console.log(`    derivation          ${c.derivation.status}${c.derivation.observers ? ` (${c.derivation.observers} ok observer run(s))` : c.derivation.status === 'ESTABLISHED' ? '' : ' — NOT ESTABLISHED'}`);
  for (const reason of c.derivation.reasons) console.log(`      ${reason}`);
  for (const m of c.derivation.envelopeMissing) console.log(`      envelope missing: ${m}`);
  console.log(`    input closure      ${c.inputClosure.closed ? 'closed' : 'OPEN'}`);
  for (const m of c.inputClosure.missing) console.log(`      ${m}`);
  console.log(`    evidence coherent  ${c.evidenceCoherent ? 'yes' : 'no'}`);
  for (const g of c.coherenceGaps) console.log(`      coherence gap: ${g}`);
  console.log(`    payload+manifest   ${c.payloadManifestComplete ? 'complete' : 'not complete (§20)'}`);
  console.log(`    quiescence proven  ${c.quiescenceProven ? 'yes' : 'no'}`);
  console.log(`    authority/ownership${c.cleanAuthorityOwnership ? '  clean' : '  NOT CLEAN'}`);
  console.log(`    intent integrity   ${typeof c.intentIntact === 'boolean' ? (c.intentIntact ? 'intact' : 'BROKEN') : 'not applicable (no intent records)'}`);
  for (const p of c.intentProblems) console.log(`      intent: ${p}`);
  console.log(`    qualification     ${c.qualified === true ? 'qualified' : `${c.qualificationStatus || 'not established'}`}${c.qualificationRule ? ` (${c.qualificationRule})` : ''}`);
  for (const p of c.qualProblems) console.log(`      qual: ${p}`);
  if (c.blockers.length === 0) {
    console.log('    acceptance gates: ALL CLOSED');
  } else {
    console.log('    acceptance blockers:');
    for (const b of c.blockers) console.log(`      - ${b}`);
  }

  console.log('\n  honest limits (not accomplishments)');
  console.log(`    profile qualification: ${c.qualified === true ? 'QUALIFIED (evidence-reduced)' : `${c.qualificationStatus || 'not established'} — the current host has no qualified profile (IB-01)`}`);
  console.log('    supervised execution: UNAVAILABLE — no qualified runtime profile (IB-01)');
  console.log('    this report only inspects durable records; it executes nothing');
  console.log('    the coherence plane is derived status, not an acceptance decision (§21)');
  store.close();
  return 0;
}

/**
 * `tandem evidence` — inspect attributable contracts, actions, observations,
 * and gate evidence (§22). Read-only; reports store validity and the derived
 * qualification gate honestly (CHECKER_ONLY under IB-01).
 */
function evidence(cwd, rest) {
  const root = storeRoot(cwd, rest);
  console.log(`tandem ${pkg.version} — evidence`);
  if (!storeExists(root)) {
    console.log(`\n  durable supervision store: none at ${root}`);
    console.log('  no attributable records to inspect yet');
    return 0;
  }
  let store;
  try {
    store = STATE.open(root);
  } catch (e) {
    console.error(`\n  store corrupt — inspection closed: ${e.message}`);
    return 1;
  }
  if (store.corrupt) {
    console.error(`\n  store corrupt — inspection closed: ${store.corrupt.reason} (at ${store.corrupt.at})`);
    store.close();
    return 1;
  }
  const r = REPORT.evidenceReport(store.all());
  if (!r.storeValid) {
    console.error(`\n  store invalid — evidence not trustworthy: ${r.storeProblems.join('; ')}`);
    store.close();
    return 1;
  }

  console.log(`\n  store           ${root}`);
  console.log(`  gate            ${r.gate} (qualified=${r.qualifiedRuntime})`);
  console.log(`  supervised exec ${r.supervisedExecution ? 'reported available' : 'UNAVAILABLE (IB-01)'}`);

  console.log('\n  attributable contracts');
  if (r.contracts.length === 0) console.log('    none');
  for (const c of r.contracts) console.log(`    ${c.contractId.padEnd(28)} frozen=${c.frozen} obligations=${c.obligationCount}`);

  console.log('\n  actions');
  if (r.actions.length === 0) console.log('    none');
  for (const a of r.actions) console.log(`    ${a.actionId.padEnd(28)} lc=${a.lifecycle} disp=${a.dispatch} exec=${a.execution} op=${a.operation || ''}`);

  console.log('\n  observations / evidence');
  if (r.observations.length === 0) console.log('    none');
  for (const o of r.observations) {
    if (o.kind === 'action_consumption') console.log(`    consumption ${o.id} action=${o.actionId} ack=${o.ack}`);
    else if (o.kind === 'source_capture') console.log(`    source_capture ${o.id} commit=${o.commitIdentity} baseline=${o.baselineManifestIdentity || 'unset'}`);
    else console.log(`    delivery ${o.id} persistence=${o.persisted}`);
  }

  console.log('\n  §23 pipeline evidence');
  const p = r.pipeline;
  if (p.obligationCount === 0) {
    console.log('    no pipeline evidence records');
  } else {
    console.log(`    verdict          ${p.verdict}`);
    console.log(`    authoritative    ${p.authoritative}`);
    console.log(`    obligations      ${p.obligationCount}  evidence=${p.evidenceCount}  invalidations=${p.invalidationCount}`);
    for (const [oblId, ob] of Object.entries(p.byObligation)) {
      const reasons = (ob.reasons || []).length > 0 ? `  (${ob.reasons.join('; ')})` : '';
      console.log(`    obl ${oblId.padEnd(20)} ${ob.outcome}${reasons}`);
    }
  }

  console.log('\n  record inventory');
  for (const [k, n] of Object.entries(r.countByKind)) console.log(`    ${k.padEnd(20)} ${n}`);
  store.close();
  return 0;
}

if (cmd === 'init') init(cwd);
else if (cmd === 'doctor') doctor(cwd).catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
else if (cmd === 'run') run(cwd, rest);
else if (cmd === 'bench') bench(cwd, rest);
else if (cmd === 'check') check(cwd, rest);
else if (cmd === 'status') process.exit(status(cwd, rest));
else if (cmd === 'evidence') process.exit(evidence(cwd, rest));
else if (cmd === '--version' || cmd === '-v') console.log(pkg.version);
else {
  console.log(`tandem ${pkg.version}\n`);
  console.log('  check     honest non-executing inspection of this source tree');
  console.log('  status    inspect durable task/lifecycle/delivery/resource/recovery + coherence gates');
  console.log('  evidence  inspect attributable contracts, actions, observations, gate evidence');
  console.log('  init      set up this project');
  console.log('  run       run a task with verification active');
  console.log('  doctor    report gates, decision points and project shape');
  console.log('  bench     measure verification on versus off');
  console.log('\n  disable at any time:  TANDEM_HOOKS=off');
}
