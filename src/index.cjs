'use strict';
/**
 * Tandem orchestrator — host-independent.
 *
 * Consumes neutral events, decides which decision points fire, runs the gates, and
 * returns a verdict. It imports no host package: the adapter translates for it.
 */
const path = require('node:path');
const fs = require('node:fs');

const CFG = require('./core/config.cjs');
const ST = require('./core/state.cjs');
const DP = require('./core/decision-points.cjs');
const RULES = require('./core/rules.cjs');
const DG = require('./context/depgraph.cjs');
const PROJ = require('./context/project.cjs');
const detect = require('./gates/detect.cjs');
const gates = require('./gates/run.cjs');
const repair = require('./gates/repair.cjs');
const P = require('./gates/parse.cjs');

const OFF = () => process.env.TANDEM_HOOKS === 'off' || process.env.TANDEM === 'off';

class Tandem {
  constructor(cwd, modelId) {
    this.cwd = cwd;
    this.cfg = CFG.load(cwd);
    this.state = ST.load(cwd);
    this.density = CFG.densityFor(this.cfg, modelId);
    this.graph = null;
    this.notices = [];
    this.skills = PROJ.loadSkills(cwd);
    this.commands = PROJ.loadCommands(cwd);
    this.conventions = PROJ.loadConventions(cwd);
    this.injected = new Set();   // a skill body is injected at most once per session
  }

  /** Detected once per session and cached; detection must never run per edit. */
  gates() {
    if (!this.state.gates) {
      this.state.gates = detect.detectGates(this.cwd, this.cfg);
      this.save();
    }
    return this.state.gates;
  }

  /** Rebuilt lazily: only DP3 needs it, and only when a mutation is about to happen. */
  depgraph(force) {
    if (!this.graph || force) this.graph = DG.build(this.cwd);
    return this.graph;
  }

  save() { ST.save(this.cwd, this.state); }

  /** D-05: a disabled gate is announced once, then never again. */
  noteDisabled(name, reason) {
    if (this.state.disabled[name]) return;
    this.state.disabled[name] = reason;
    this.save();
    this.notices.push(`TANDEM_DISABLED ${name} (${reason})`);
  }

  sessionStart() {
    this.state.repairCount = 0;
    this.state.lastFailureKey = '';
    this.state.seenImports = [];
    this.state.disabled = {};
    this.state.gates = null;
    this.save();
    const parts = [RULES];
    if (this.conventions) parts.push('Project conventions:\n' + this.conventions);
    const idx = PROJ.skillIndex(this.skills);
    if (idx) parts.push(idx);
    const brief = ST.memoryBrief(this.state);
    if (brief) parts.push(brief);
    return parts.join('\n\n');
  }

  /**
   * Lazily inject the skills a trigger calls for, once each per session.
   * Bodies stay on disk until needed: bulk context measurably degrades results.
   */
  injectSkills(trigger) {
    const out = [];
    for (const s of PROJ.skillsFor(this.skills, trigger)) {
      if (this.injected.has(s.name)) continue;
      this.injected.add(s.name);
      out.push('TANDEM skill — ' + s.name + '\n' + s.body);
    }
    return out;
  }

  /** Expand a leading /command into its instruction body. */
  expandCommand(prompt) { return PROJ.expandCommand(this.commands, prompt); }

  /** Enrich a neutral event with the facts the decision points need. */
  enrich(event) {
    const e = { ...event };
    if (e.file) {
      const rel = path.relative(this.cwd, path.resolve(this.cwd, e.file)).split(path.sep).join('/');
      e.file = rel;
      if (e.kind === 'write' || e.kind === 'edit') {
        const g = this.depgraph();
        e.dependentCount = DG.dependentCount(g, rel);
        const specs = e.content ? DG.extractImports(e.content) : [];
        const seen = new Set(this.state.seenImports);
        e.newImports = specs.filter((s) => !s.startsWith('.') && !seen.has(s));
      }
    }
    return e;
  }

  /**
   * Called BEFORE a tool executes. Pi honours a block; this is where prevention lives.
   * @returns {{block:boolean, reason?:string, points:string[]}}
   */
  beforeTool(rawEvent) {
    if (OFF()) return { block: false, points: [] };
    const e = this.enrich(rawEvent);
    const mutating = e.kind === 'write' || e.kind === 'edit';

    if (mutating && e.file && !CFG.inWorkingSet(e.file, this.cfg)) {
      return { block: true, points: [],
        reason: `${e.file} is outside the working set (${this.cfg.workingSet.join(', ')}). Write there instead.` };
    }

    const points = DP.pointsFor(e, { density: this.density, dependentThreshold: this.cfg.dependentThreshold });

    if (mutating && !this.firstMutationSeen) {
      this.firstMutationSeen = true;
      for (const s of this.injectSkills('first-mutation')) this.notices.push(s);
    }
    if ((e.newImports || []).length > 0) {
      for (const s of this.injectSkills('new-import')) this.notices.push(s);
    }

    // DP3: check the importers before the change lands, not after.
    if (points.includes('DP3_DEPENDENTS')) {
      const g = this.gates();
      if (g.typecheck.available) {
        const deps = DG.dependentsOf(this.depgraph(), e.file);
        const r = gates.typecheck(g.typecheck, this.cwd, this.cfg, deps);
        if (!r.skipped && !r.passed) {
          this.notices.push(
            `TANDEM DP3 — ${deps.length} file(s) import ${e.file} and already fail to type-check:\n` +
            P.format(r.errors) + '\nFix those first, or your change will be judged against a broken baseline.');
        }
      } else { this.noteDisabled('typecheck', g.typecheck.reason); }
    }
    return { block: false, points };
  }

  /**
   * Called AFTER a tool executes.
   * @returns {{ok:boolean, message:string|null, points:string[]}}
   */
  afterTool(rawEvent) {
    if (OFF()) return { ok: true, message: null, points: [] };
    const e = this.enrich(rawEvent);
    const points = DP.pointsFor(e, { density: this.density, dependentThreshold: this.cfg.dependentThreshold });

    for (const s of e.newImports || []) {
      if (!this.state.seenImports.includes(s)) this.state.seenImports.push(s);
    }
    if (e.kind === 'write' || e.kind === 'edit') this.graph = null; // graph is stale

    if (!points.includes('DP1_EDIT')) { this.save(); return { ok: true, message: null, points }; }
    if (!e.file || !/\.(ts|tsx|mts|cts)$/.test(e.file)) { this.save(); return { ok: true, message: null, points }; }

    const g = this.gates();
    if (!g.typecheck.available) {
      this.noteDisabled('typecheck', g.typecheck.reason);
      this.save();
      return { ok: true, message: null, points };
    }

    const r = gates.typecheck(g.typecheck, this.cwd, this.cfg, null);
    if (r.passed) { this.save(); return { ok: true, message: null, points }; }

    ST.recordErrors(this.state, r.errors, this.cfg.memoryThreshold);
    this.save();
    const body = r.parseFailed ? r.raw : P.format(r.errors);
    const extra = this.injectSkills('gate-failed');
    const skillText = extra.length ? '\n\n' + extra.join('\n\n') : '';
    return { ok: false, points, message: 'TANDEM typecheck errors — fix these before continuing:\n' + body + skillText };
  }

  /**
   * Called when the model believes it is finished. DP5.
   * @returns {{done:boolean, message:string|null, stopped:boolean}}
   */
  finish() {
    if (OFF()) return { done: true, message: null, stopped: false };
    const g = this.gates();

    if (g.typecheck.available) {
      const tc = gates.typecheck(g.typecheck, this.cwd, this.cfg, null);
      if (!tc.skipped && !tc.passed) {
        ST.recordErrors(this.state, tc.errors, this.cfg.memoryThreshold);
        const v = repair.evaluate(this.state, tc, 'typecheck', this.cfg);
        this.save();
        return { done: v.action === 'REPORT_AND_STOP', message: v.message, stopped: v.action === 'REPORT_AND_STOP' };
      }
    } else { this.noteDisabled('typecheck', g.typecheck.reason); }

    if (!g.test.available) {
      this.noteDisabled('test', g.test.reason);
      this.save();
      return { done: true, message: null, stopped: false };
    }

    const t = gates.tests(g.test, this.cwd, this.cfg);
    if (t.passed) {
      this.state.greenTests = t.passing;
      this.state.repairCount = 0;
      this.state.lastFailureKey = '';
      this.save();
      return { done: true, message: null, stopped: false };
    }
    ST.recordErrors(this.state, t.errors, this.cfg.memoryThreshold);
    const v = repair.evaluate(this.state, t, 'tests', this.cfg);
    this.save();
    return { done: v.action === 'REPORT_AND_STOP', message: v.message, stopped: v.action === 'REPORT_AND_STOP' };
  }

  drainNotices() { const n = this.notices; this.notices = []; return n; }
}

module.exports = { Tandem, RULES, DECISION_POINTS: DP.DESCRIPTIONS };
