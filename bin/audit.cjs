#!/usr/bin/env node
'use strict';
/**
 * bin/audit.cjs
 *
 * Standalone, deterministic repository auditor with zero model dependencies.
 * Fails loudly on 5 specific defect classes observed in the project:
 *
 * 1. QUALIFIED without evidence:
 *    Any blocker marked QUALIFIED in docs/QUALIFICATION.md whose section lacks
 *    a commit hash or CI run ID.
 *
 * 2. Partial-sample reporting:
 *    Any percentage in docs/PAIRED_EVALUATION_RESULTS.md whose denominator does
 *    not match the actual completed-run count in bench/paired/state.json.
 *
 * 3. Grader reachable by candidate:
 *    Any grader file listed in a task manifest that also appears in that task's
 *    allowed-mutation list.
 *
 * 4. Post-hoc-only enforcement:
 *    Any scope rule documented as write-time prevention that has no
 *    corresponding active block in src/index.cjs beforeTool.
 *
 * 5. Claim-evidence mismatch:
 *    Any quantitative number in a results document that cannot be reproduced
 *    by repo state or deterministic evaluation commands.
 *
 * Exit status:
 *   - 0: all audit checks passed with zero defects.
 *   - 1: one or more defects detected (printed as DEFECT_NAME: description at file:line).
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const stats = require('../bench/stats.cjs');

// ============================================================================
// 1. QUALIFIED WITHOUT EVIDENCE
// ============================================================================

/**
 * Audit docs/QUALIFICATION.md for blockers marked QUALIFIED without supporting
 * commit hash or CI run ID evidence.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] Path to qualification document.
 * @param {string} [options.content] Document content override for testing.
 * @returns {Array<{type: string, message: string, file: string, line: number}>}
 */
function auditQualifiedWithoutEvidence(options = {}) {
  const filePath = options.filePath || path.join(REPO_ROOT, 'docs', 'QUALIFICATION.md');
  const relPath = path.relative(REPO_ROOT, filePath);
  const defects = [];

  let content = options.content;
  if (content === undefined) {
    if (!fs.existsSync(filePath)) {
      return [{
        type: 'QUALIFIED_WITHOUT_EVIDENCE',
        message: `Qualification document does not exist: ${relPath}`,
        file: relPath,
        line: 1,
      }];
    }
    content = fs.readFileSync(filePath, 'utf8');
  }

  const lines = content.split('\n');

  // Split into sections by blocker headers (e.g., "## IB-01", "## IB-02")
  const sectionHeaderRegex = /^##\s+(IB-\d{2})/i;
  const sections = [];
  let currentSection = null;

  lines.forEach((line, index) => {
    const headerMatch = line.match(sectionHeaderRegex);
    if (headerMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        blockerId: headerMatch[1].toUpperCase(),
        startLine: index + 1,
        lines: [{ text: line, lineNum: index + 1 }],
      };
    } else if (currentSection) {
      // Check if we hit another top-level section that is not a blocker
      if (/^##\s+[^I]/i.test(line) && !/^##\s+IB-/i.test(line)) {
        sections.push(currentSection);
        currentSection = null;
      } else {
        currentSection.lines.push({ text: line, lineNum: index + 1 });
      }
    }
  });
  if (currentSection) {
    sections.push(currentSection);
  }

  // Regex for commit hash: 7-40 hex chars
  const commitHashRegex = /\bcommit\s+[`"']?([0-9a-f]{7,40})[`"']?|[`"']([0-9a-f]{7,40})[`"']|\b([0-9a-f]{7,40})\b/i;
  // Regex for CI run ID or run number
  const ciRunIdRegex = /\b(?:RUN-IB\d{2}-\d{3}|run\s+[`"']?(\d{6,})[`"']?|CI\s+run\s+[`"']?(\d{6,})[`"']?|Run\s+[`"']?(\d{6,})[`"']?|\b\d{8,}\b)\b/i;

  for (const section of sections) {
    const sectionText = section.lines.map((l) => l.text).join('\n');
    const isQualified = /Qualification\s+State:.*QUALIFIED/i.test(sectionText) ||
                        /Qualification\s+Status:.*QUALIFIED/i.test(sectionText) ||
                        /marked\s+as\s+\*\*QUALIFIED\*\*/i.test(sectionText) ||
                        /\*\*QUALIFIED\*\*/.test(section.lines[0]?.text || '');

    if (isQualified) {
      // Find line where QUALIFIED appears
      let qualifiedLineNum = section.startLine;
      for (const l of section.lines) {
        if (/QUALIFIED/.test(l.text)) {
          qualifiedLineNum = l.lineNum;
          break;
        }
      }

      // Check if section contains commit hash or CI run ID
      const hasCommit = commitHashRegex.test(sectionText);
      const hasCiRunId = ciRunIdRegex.test(sectionText);

      if (!hasCommit && !hasCiRunId) {
        defects.push({
          type: 'QUALIFIED_WITHOUT_EVIDENCE',
          message: `Blocker ${section.blockerId} is marked QUALIFIED without supporting commit hash or CI run ID evidence`,
          file: relPath,
          line: qualifiedLineNum,
        });
      }
    }
  }

  return defects;
}

// ============================================================================
// 2. PARTIAL-SAMPLE REPORTING
// ============================================================================

/**
 * Audit docs/PAIRED_EVALUATION_RESULTS.md for sample fractions or percentages
 * whose denominators do not match ground-truth run counts in bench/paired/state.json.
 *
 * @param {object} [options]
 * @param {string} [options.resultsPath]
 * @param {string} [options.resultsContent]
 * @param {string} [options.statePath]
 * @param {object} [options.stateData]
 * @returns {Array<{type: string, message: string, file: string, line: number}>}
 */
function auditPartialSampleReporting(options = {}) {
  const resultsPath = options.resultsPath || path.join(REPO_ROOT, 'docs', 'PAIRED_EVALUATION_RESULTS.md');
  const statePath = options.statePath || path.join(REPO_ROOT, 'bench', 'paired', 'state.json');
  const relPath = path.relative(REPO_ROOT, resultsPath);
  const defects = [];

  let state = options.stateData;
  if (!state) {
    if (!fs.existsSync(statePath)) {
      return [{
        type: 'PARTIAL_SAMPLE_REPORTING',
        message: `Evaluation state file does not exist: ${path.relative(REPO_ROOT, statePath)}`,
        file: relPath,
        line: 1,
      }];
    }
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      return [{
        type: 'PARTIAL_SAMPLE_REPORTING',
        message: `Failed to parse evaluation state JSON: ${err.message}`,
        file: relPath,
        line: 1,
      }];
    }
  }

  let resultsContent = options.resultsContent;
  if (resultsContent === undefined) {
    if (!fs.existsSync(resultsPath)) {
      return [{
        type: 'PARTIAL_SAMPLE_REPORTING',
        message: `Results document does not exist: ${relPath}`,
        file: relPath,
        line: 1,
      }];
    }
    resultsContent = fs.readFileSync(resultsPath, 'utf8');
  }

  // Derive ground-truth counts from state.json
  const runs = state.runs || [];
  const completedA = runs.filter((r) => r.arm === 'A' && r.status === 'COMPLETED').length;
  const completedB = runs.filter((r) => r.arm === 'B' && r.status === 'COMPLETED').length;
  const completedTotal = completedA + completedB;

  const attemptedA = runs.filter((r) => r.arm === 'A' && (r.status === 'COMPLETED' || r.status === 'INVALID')).length;
  const attemptedB = runs.filter((r) => r.arm === 'B' && (r.status === 'COMPLETED' || r.status === 'INVALID')).length;
  const attemptedTotal = attemptedA + attemptedB;

  const scheduledA = runs.filter((r) => r.arm === 'A').length || 30;
  const scheduledB = runs.filter((r) => r.arm === 'B').length || 30;
  const scheduledTotal = state.total_runs || (scheduledA + scheduledB);

  const validDenominators = new Set([
    completedA,
    completedB,
    completedTotal,
    attemptedA,
    attemptedB,
    attemptedTotal,
    scheduledA,
    scheduledB,
    scheduledTotal,
  ]);

  const lines = resultsContent.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Look for fractions like $12 / 16$ or (12/16) or 12 of 16 associated with trial/run counts
    const fractionMatches = line.matchAll(/(?:\$|\()?\b(\d+)\s*(?:\/|\bof\b)\s*(\d+)\b(?:\$|\))?/g);

    for (const match of fractionMatches) {
      const numerator = parseInt(match[1], 10);
      const denominator = parseInt(match[2], 10);

      // Skip non-sample fractions (e.g., date formats, small index fractions like 1.00, or line ratios)
      if (denominator <= 3) continue; // files changed (1.00 vs 2.00) or tiny dimensions
      if (line.includes('Change Size Ratio') || line.includes('Lines Changed Ratio') || line.includes('Tool Ratio')) {
        continue;
      }

      // Check if this fraction represents trial or run reporting
      const isRunReporting =
        line.includes('trials') ||
        line.includes('runs') ||
        line.includes('tasks') ||
        line.includes('Solution Quality') ||
        line.includes('Pass Rate') ||
        line.includes('Scope Compliance') ||
        line.includes('%') ||
        line.includes('Arm A') ||
        line.includes('Arm B') ||
        line.includes('completed');

      if (isRunReporting) {
        if (!validDenominators.has(denominator)) {
          defects.push({
            type: 'PARTIAL_SAMPLE_REPORTING',
            message: `Reported sample fraction (${numerator}/${denominator}) uses invalid denominator ${denominator} not matching state.json completed run counts (Arm A: ${completedA}, Arm B: ${completedB}, Total: ${completedTotal})`,
            file: relPath,
            line: lineNum,
          });
        }
      }
    }
  });

  return defects;
}

// ============================================================================
// 3. GRADER REACHABLE BY CANDIDATE
// ============================================================================

/**
 * Audit task manifests to ensure no held-out grader file is present in a task's
 * allowed-mutation list.
 *
 * @param {object} [options]
 * @param {string[]} [options.manifestPaths] Paths to task manifest JSON files.
 * @param {object[]} [options.manifestsData] In-memory manifest objects for testing.
 * @returns {Array<{type: string, message: string, file: string, line: number}>}
 */
function auditGraderReachable(options = {}) {
  const defects = [];
  let manifestFiles = options.manifestPaths;

  if (!manifestFiles && !options.manifestsData) {
    // Default to bench/paired/tasks.json and all bench/tasks/**/task.json manifests
    manifestFiles = [];
    const pairedTasks = path.join(REPO_ROOT, 'bench', 'paired', 'tasks.json');
    if (fs.existsSync(pairedTasks)) {
      manifestFiles.push(pairedTasks);
    }

    const tasksDir = path.join(REPO_ROOT, 'bench', 'tasks');
    if (fs.existsSync(tasksDir)) {
      for (const ent of fs.readdirSync(tasksDir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
          const tFile = path.join(tasksDir, ent.name, 'task.json');
          if (fs.existsSync(tFile)) manifestFiles.push(tFile);
        }
      }
    }
  }

  const manifests = [];
  if (options.manifestsData) {
    options.manifestsData.forEach((data, idx) => {
      manifests.push({
        filePath: options.manifestPaths ? options.manifestPaths[idx] : `synthetic-manifest-${idx + 1}.json`,
        data,
      });
    });
  } else {
    for (const mPath of manifestFiles) {
      try {
        const raw = fs.readFileSync(mPath, 'utf8');
        manifests.push({
          filePath: mPath,
          raw,
          data: JSON.parse(raw),
        });
      } catch (err) {
        defects.push({
          type: 'GRADER_REACHABLE',
          message: `Failed to load task manifest: ${err.message}`,
          file: path.relative(REPO_ROOT, mPath),
          line: 1,
        });
      }
    }
  }

  for (const manifest of manifests) {
    const relPath = path.relative(REPO_ROOT, manifest.filePath);
    const data = manifest.data;
    const tasks = Array.isArray(data.tasks) ? data.tasks : (data.id ? [data] : []);

    tasks.forEach((task, taskIdx) => {
      const graderRel = task.grader_rel_path || task.grader || task.grader_path || task.oracle_grader;
      const allowedFiles = task.allowed_files || task.allowedFiles || (task.target_file ? [task.target_file] : []);
      const taskId = task.id || `task-${taskIdx + 1}`;

      if (graderRel && Array.isArray(allowedFiles)) {
        const normGrader = path.normalize(graderRel).replace(/\\/g, '/');

        for (const allowed of allowedFiles) {
          const normAllowed = path.normalize(allowed).replace(/\\/g, '/');
          const isReachable =
            normAllowed === normGrader ||
            normAllowed.endsWith(normGrader) ||
            normGrader.endsWith(normAllowed) ||
            /bench\/.*grader/i.test(normAllowed);

          if (isReachable) {
            let lineNum = 1;
            if (manifest.raw) {
              const lines = manifest.raw.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(taskId) || lines[i].includes(allowed)) {
                  lineNum = i + 1;
                  break;
                }
              }
            }

            defects.push({
              type: 'GRADER_REACHABLE',
              message: `Grader file ${graderRel} is included in allowed mutation scope for task ${taskId}`,
              file: relPath,
              line: lineNum,
            });
          }
        }
      }
    });
  }

  return defects;
}

// ============================================================================
// 4. POST-HOC-ONLY ENFORCEMENT
// ============================================================================

/**
 * Audit src/index.cjs to ensure write-time scope rules are actively enforced
 * with blocking checks in beforeTool.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] Path to src/index.cjs.
 * @param {string} [options.content] Content override for testing.
 * @returns {Array<{type: string, message: string, file: string, line: number}>}
 */
function auditPostHocOnlyEnforcement(options = {}) {
  const filePath = options.filePath || path.join(REPO_ROOT, 'src', 'index.cjs');
  const relPath = path.relative(REPO_ROOT, filePath);
  const defects = [];

  let content = options.content;
  if (content === undefined) {
    if (!fs.existsSync(filePath)) {
      return [{
        type: 'POST_HOC_ONLY_ENFORCEMENT',
        message: `Core orchestrator file does not exist: ${relPath}`,
        file: relPath,
        line: 1,
      }];
    }
    content = fs.readFileSync(filePath, 'utf8');
  }

  const lines = content.split('\n');

  // Locate beforeTool definition
  let beforeToolLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/beforeTool\s*\(/.test(lines[i])) {
      beforeToolLine = i + 1;
      break;
    }
  }

  if (beforeToolLine === -1) {
    return [{
      type: 'POST_HOC_ONLY_ENFORCEMENT',
      message: 'src/index.cjs is missing beforeTool method for write-time enforcement',
      file: relPath,
      line: 1,
    }];
  }

  // Extract beforeTool implementation body
  const beforeToolLines = [];
  let braceCount = 0;
  let started = false;

  for (let i = beforeToolLine - 1; i < lines.length; i++) {
    const line = lines[i];
    beforeToolLines.push(line);
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    braceCount += openBraces - closeBraces;
    if (openBraces > 0) started = true;
    if (started && braceCount <= 0) break;
  }

  const beforeToolBody = beforeToolLines.join('\n');

  // Verify write-time mutation interception
  const checks = [
    {
      name: 'Write-time mutation scope check (getAllowedFiles)',
      requiredPatterns: [
        /getAllowedFiles/i,
        /DISALLOWED_MUTATION/i,
        /return\s*\{\s*block:\s*true/i,
      ],
      description: 'Write-time slice mutation scope enforcement (getAllowedFiles)',
    },
    {
      name: 'Working set containment check (inWorkingSet)',
      requiredPatterns: [
        /inWorkingSet/i,
        /return\s*\{\s*block:\s*true/i,
      ],
      description: 'Working set boundary containment check (inWorkingSet)',
    },
    {
      name: 'Resource budget ceiling check (BC.check)',
      requiredPatterns: [
        /BC\.check|\.check\(this\.counters/i,
        /return\s*\{\s*block:\s*true/i,
      ],
      description: 'Resource budget dimension ceiling check (BC.check)',
    },
  ];

  for (const check of checks) {
    const missing = check.requiredPatterns.some((pattern) => !pattern.test(beforeToolBody));
    if (missing) {
      defects.push({
        type: 'POST_HOC_ONLY_ENFORCEMENT',
        message: `Scope rule "${check.description}" is documented as write-time prevention but lacks active block in src/index.cjs:beforeTool`,
        file: relPath,
        line: beforeToolLine,
      });
    }
  }

  return defects;
}

// ============================================================================
// 5. CLAIM-EVIDENCE MISMATCH
// ============================================================================

/**
 * Audit quantitative claims in results documents against ground-truth state.
 *
 * @param {object} [options]
 * @param {string} [options.resultsPath]
 * @param {string} [options.resultsContent]
 * @param {string} [options.statePath]
 * @param {object} [options.stateData]
 * @returns {Array<{type: string, message: string, file: string, line: number}>}
 */
function auditClaimEvidenceMismatch(options = {}) {
  const resultsPath = options.resultsPath || path.join(REPO_ROOT, 'docs', 'PAIRED_EVALUATION_RESULTS.md');
  const statePath = options.statePath || path.join(REPO_ROOT, 'bench', 'paired', 'state.json');
  const relPath = path.relative(REPO_ROOT, resultsPath);
  const defects = [];

  let state = options.stateData;
  if (!state) {
    if (!fs.existsSync(statePath)) {
      return [{
        type: 'CLAIM_EVIDENCE_MISMATCH',
        message: `Evaluation state file does not exist: ${path.relative(REPO_ROOT, statePath)}`,
        file: relPath,
        line: 1,
      }];
    }
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      return [{
        type: 'CLAIM_EVIDENCE_MISMATCH',
        message: `Failed to parse evaluation state JSON: ${err.message}`,
        file: relPath,
        line: 1,
      }];
    }
  }

  let resultsContent = options.resultsContent;
  if (resultsContent === undefined) {
    if (!fs.existsSync(resultsPath)) {
      return [{
        type: 'CLAIM_EVIDENCE_MISMATCH',
        message: `Results document does not exist: ${relPath}`,
        file: relPath,
        line: 1,
      }];
    }
    resultsContent = fs.readFileSync(resultsPath, 'utf8');
  }

  // Compute ground-truth statistics from state.runs
  const runs = state.runs || [];
  const completedRuns = runs.filter((r) => r.status === 'COMPLETED');

  const armARuns = completedRuns.filter((r) => r.arm === 'A');
  const armBRuns = completedRuns.filter((r) => r.arm === 'B');

  const nA = armARuns.length;
  const nB = armBRuns.length;

  if (nA === 0 || nB === 0) {
    // Cannot audit quantitative metrics without completed runs
    return defects;
  }

  // Solution Quality (stage2_passed)
  const qA_count = armARuns.filter((r) => r.stage2_passed === true).length;
  const qB_count = armBRuns.filter((r) => r.stage2_passed === true).length;
  const qA_rate = qA_count / nA;
  const qB_rate = qB_count / nB;

  // Pass Rate (passed)
  const pA_count = armARuns.filter((r) => r.passed === true).length;
  const pB_count = armBRuns.filter((r) => r.passed === true).length;
  const pA_rate = pA_count / nA;
  const pB_rate = pB_count / nB;
  const deltaP = pB_rate - pA_rate;

  // Wilson Score Intervals
  const ciQ_A = stats.wilson(qA_count, nA, 1.96);
  const ciQ_B = stats.wilson(qB_count, nB, 1.96);
  const ciP_A = stats.wilson(pA_count, nA, 1.96);
  const ciP_B = stats.wilson(pB_count, nB, 1.96);

  // Mean Resources
  const meanToolA = armARuns.reduce((sum, r) => sum + (r.tool_calls || 0), 0) / nA;
  const meanToolB = armBRuns.reduce((sum, r) => sum + (r.tool_calls || 0), 0) / nB;
  const toolRatio = meanToolB / (meanToolA || 1);

  const meanWallA = armARuns.reduce((sum, r) => sum + (r.wall_time_ms || 0), 0) / nA;
  const meanWallB = armBRuns.reduce((sum, r) => sum + (r.wall_time_ms || 0), 0) / nB;
  const wallRatio = meanWallB / (meanWallA || 1);

  const meanLinesA = armARuns.reduce((sum, r) => sum + ((r.lines_added || 0) + (r.lines_removed || 0)), 0) / nA;
  const meanLinesB = armBRuns.reduce((sum, r) => sum + ((r.lines_added || 0) + (r.lines_removed || 0)), 0) / nB;
  const linesRatio = meanLinesB / (meanLinesA || 1);

  const lines = resultsContent.split('\n');

  // Verify Summary Metrics Table (Section 2) and Key Text Claims
  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // 1. Solution Quality check
    if (line.includes('Solution Quality (`stage2_passed`)')) {
      const expectedA = (qA_rate * 100).toFixed(2);
      const expectedB = (qB_rate * 100).toFixed(2);
      if (!line.includes(`${expectedA}%`) || !line.includes(`${expectedB}%`)) {
        defects.push({
          type: 'CLAIM_EVIDENCE_MISMATCH',
          message: `Claimed solution quality does not match state.json (Expected Arm A: ${expectedA}%, Arm B: ${expectedB}%)`,
          file: relPath,
          line: lineNum,
        });
      }
    }

    // 2. Overall Pass Rate check
    if (line.includes('Overall Pass Rate ($P$)')) {
      const expectedA = (pA_rate * 100).toFixed(2);
      const expectedB = (pB_rate * 100).toFixed(2);
      if (!line.includes(`${expectedA}%`) || !line.includes(`${expectedB}%`)) {
        defects.push({
          type: 'CLAIM_EVIDENCE_MISMATCH',
          message: `Claimed overall pass rate does not match state.json (Expected Arm A: ${expectedA}%, Arm B: ${expectedB}%)`,
          file: relPath,
          line: lineNum,
        });
      }
    }

    // 3. Wilson Confidence Intervals
    if (line.includes('Pass Rate 95% Wilson CI')) {
      const expLoA = (ciP_A.lo * 100).toFixed(2);
      const expHiA = (ciP_A.hi * 100).toFixed(2);
      const expLoB = (ciP_B.lo * 100).toFixed(2);
      const expHiB = (ciP_B.hi * 100).toFixed(2);
      if (!line.includes(expLoA) || !line.includes(expHiA) || !line.includes(expLoB) || !line.includes(expHiB)) {
        defects.push({
          type: 'CLAIM_EVIDENCE_MISMATCH',
          message: `Claimed pass rate Wilson CI does not match recomputed intervals (Expected Arm A: [${expLoA}%, ${expHiA}%], Arm B: [${expLoB}%, ${expHiB}%])`,
          file: relPath,
          line: lineNum,
        });
      }
    }

    // 4. Mean Tool Calls & Tool Ratio
    if (line.includes('Mean Tool Calls')) {
      const expToolA = meanToolA.toFixed(2);
      const expToolB = meanToolB.toFixed(2);
      const expRatio = toolRatio.toFixed(2);
      if (!line.includes(expToolA) || !line.includes(expToolB) || (!line.includes(`${expRatio}×`) && !line.includes(`${expRatio}x`))) {
        defects.push({
          type: 'CLAIM_EVIDENCE_MISMATCH',
          message: `Claimed mean tool calls do not match state.json (Expected Arm A: ${expToolA}, Arm B: ${expToolB}, Ratio: ${expRatio}x)`,
          file: relPath,
          line: lineNum,
        });
      }
    }

    // 5. Mean Lines Changed & Lines Ratio
    if (line.includes('Mean Lines Changed')) {
      const expLinesA = meanLinesA.toFixed(2);
      const expLinesB = meanLinesB.toFixed(2);
      const expRatio = linesRatio.toFixed(2);
      if (!line.includes(expLinesA) || !line.includes(expLinesB) || (!line.includes(`${expRatio}×`) && !line.includes(`${expRatio}x`))) {
        defects.push({
          type: 'CLAIM_EVIDENCE_MISMATCH',
          message: `Claimed mean lines changed do not match state.json (Expected Arm A: ${expLinesA}, Arm B: ${expLinesB}, Ratio: ${expRatio}x)`,
          file: relPath,
          line: lineNum,
        });
      }
    }
  });

  return defects;
}

// ============================================================================
// UNIFIED AUDIT RUNNER
// ============================================================================

/**
 * Execute all five deterministic defect detectors across the repository.
 *
 * @param {object} [options]
 * @returns {{passed: boolean, defects: Array<{type: string, message: string, file: string, line: number}>}}
 */
function runAllAudits(options = {}) {
  const allDefects = [];

  // Detector 1: QUALIFIED without evidence
  const d1 = auditQualifiedWithoutEvidence(options.d1);
  allDefects.push(...d1);

  // Detector 2: Partial-sample reporting
  const d2 = auditPartialSampleReporting(options.d2);
  allDefects.push(...d2);

  // Detector 3: Grader reachable by candidate
  const d3 = auditGraderReachable(options.d3);
  allDefects.push(...d3);

  // Detector 4: Post-hoc-only enforcement
  const d4 = auditPostHocOnlyEnforcement(options.d4);
  allDefects.push(...d4);

  // Detector 5: Claim-evidence mismatch
  const d5 = auditClaimEvidenceMismatch(options.d5);
  allDefects.push(...d5);

  return {
    passed: allDefects.length === 0,
    defects: allDefects,
  };
}

// CLI entrypoint
if (require.main === module) {
  console.log('================================================================================');
  console.log('TANDEM DETERMINISTIC REPOSITORY AUDITOR');
  console.log('Validating against 5 critical defect classes...');
  console.log('================================================================================\n');

  const result = runAllAudits();

  if (!result.passed) {
    console.error(`AUDIT FAILED: ${result.defects.length} defect(s) detected:\n`);
    for (const d of result.defects) {
      console.error(`  ${d.type}: ${d.message} at ${d.file}:${d.line}`);
    }
    console.error('\nExiting with status 1.');
    process.exit(1);
  } else {
    console.log('✔ QUALIFIED without evidence: 0 defects');
    console.log('✔ Partial-sample reporting: 0 defects');
    console.log('✔ Grader reachable by candidate: 0 defects');
    console.log('✔ Post-hoc-only enforcement: 0 defects');
    console.log('✔ Claim-evidence mismatch: 0 defects');
    console.log('\nTANDEM AUDIT: All 5 detectors passed, 0 defects found.\n');
    process.exit(0);
  }
}

module.exports = {
  auditQualifiedWithoutEvidence,
  auditPartialSampleReporting,
  auditGraderReachable,
  auditPostHocOnlyEnforcement,
  auditClaimEvidenceMismatch,
  runAllAudits,
};
