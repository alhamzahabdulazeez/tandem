'use strict';
/**
 * Tests for IB-03 Budget Counters & Enforcement.
 *
 * Verifies:
 *   1. Unique-read counting
 *   2. Repeated read not double counting (idempotent unique paths)
 *   3. Refusal at the 80% effective limit across all four dimensions
 *   4. Hard stop at the 100% total ceiling across all four dimensions
 *   5. Line counting on an edit (direct lines and string content)
 *   6. Tool-call counting by name
 *   7. Tandem beforeTool actually blocking when a dimension is exhausted
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BC = require('../../src/control/budget-counters.cjs');
const { Tandem } = require('../../src/index.cjs');

module.exports = function run(t, group) {
  const testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-ib03-'));
  group('IB-03 pure counters: unique-read counting and deduplication');

  t('unique-read counting tracks new files', () => {
    let c = BC.create();
    c = BC.countRead(c, 'src/a.ts');
    c = BC.countRead(c, 'src/b.ts');
    c = BC.countRead(c, 'src/c.ts');

    assert.strictEqual(c.filesRead.size, 3);
    const status = BC.check(c);
    assert.strictEqual(status.counts.filesRead, 3);
  });

  t('repeated read of the same file does not double count', () => {
    let c = BC.create();
    c = BC.countRead(c, 'src/a.ts');
    c = BC.countRead(c, 'src/a.ts');
    c = BC.countRead(c, 'src/a.ts');

    assert.strictEqual(c.filesRead.size, 1);
    const status = BC.check(c);
    assert.strictEqual(status.counts.filesRead, 1);
  });

  t('empty or non-string file read does not increment filesRead count', () => {
    let c = BC.create();
    c = BC.countRead(c, null);
    c = BC.countRead(c, '');
    c = BC.countRead(c, undefined);

    assert.strictEqual(c.filesRead.size, 0);
    assert.strictEqual(BC.check(c).counts.filesRead, 0);
  });

  group('IB-03 pure counters: change and line counting on edits');

  t('countChange tracks unique changed files and accumulated lines', () => {
    let c = BC.create();
    c = BC.countChange(c, 'src/a.ts', 10, 5);
    assert.strictEqual(c.filesChanged.size, 1);
    assert.strictEqual(c.changedLines, 15);

    // Editing same file again accumulates lines without incrementing unique file count
    c = BC.countChange(c, 'src/a.ts', 2, 3);
    assert.strictEqual(c.filesChanged.size, 1);
    assert.strictEqual(c.changedLines, 20);

    // Editing second file increments unique filesChanged
    c = BC.countChange(c, 'src/b.ts', 5, 0);
    assert.strictEqual(c.filesChanged.size, 2);
    assert.strictEqual(c.changedLines, 25);
  });

  t('countChange calculates added and removed lines from string diff content', () => {
    let c = BC.create();
    c = BC.countChange(c, 'src/a.ts', 'line1\nline2\nline3', 'old1\nold2');
    assert.strictEqual(c.filesChanged.size, 1);
    assert.strictEqual(c.changedLines, 5); // 3 added + 2 removed
  });

  group('IB-03 pure counters: tool-call counting by name');

  t('countToolCall tracks total tool calls and breakdown by tool name', () => {
    let c = BC.create();
    c = BC.countToolCall(c, 'read');
    c = BC.countToolCall(c, 'read');
    c = BC.countToolCall(c, 'edit');
    c = BC.countToolCall(c, 'bash');

    assert.strictEqual(c.toolCalls, 4);
    assert.strictEqual(c.toolCallsByName.read, 2);
    assert.strictEqual(c.toolCallsByName.edit, 1);
    assert.strictEqual(c.toolCallsByName.bash, 1);
    assert.strictEqual(c.toolCallsByName.write || 0, 0);
  });

  group('IB-03 refusal at effective limit (80% reserve boundary)');

  t('filesRead refuses when crossing effective limit (32 files)', () => {
    let c = BC.create({ filesRead: 40, reservePct: 0.20 });
    for (let i = 1; i <= 32; i++) {
      c = BC.countRead(c, `file_${i}.ts`);
    }
    let status = BC.check(c);
    assert.strictEqual(status.within, true);
    assert.strictEqual(status.effective.filesRead, 32);
    assert.strictEqual(status.reserved.filesRead, 8);
    assert.strictEqual(status.exceeded.length, 0);

    // 33rd unique file crosses the 80% effective limit
    c = BC.countRead(c, 'file_33.ts');
    status = BC.check(c);
    assert.strictEqual(status.within, false);
    assert.ok(status.exceeded.includes('filesRead'));
    assert.strictEqual(status.hardStop, false);
  });

  t('toolCalls refuses when crossing effective limit (16 calls)', () => {
    let c = BC.create({ toolCalls: 20, reservePct: 0.20 });
    for (let i = 1; i <= 16; i++) {
      c = BC.countToolCall(c, 'bash');
    }
    assert.strictEqual(BC.check(c).within, true);

    // 17th tool call crosses 80% effective limit
    c = BC.countToolCall(c, 'bash');
    const status = BC.check(c);
    assert.strictEqual(status.within, false);
    assert.ok(status.exceeded.includes('toolCalls'));
    assert.strictEqual(status.hardStop, false);
  });

  t('filesChanged refuses when crossing effective limit (9.6 -> 10 files)', () => {
    let c = BC.create({ filesChanged: 12, reservePct: 0.20 });
    for (let i = 1; i <= 9; i++) {
      c = BC.countChange(c, `file_${i}.ts`, 1, 0);
    }
    assert.strictEqual(BC.check(c).within, true);

    // 10th file changed crosses effective limit 9.6
    c = BC.countChange(c, 'file_10.ts', 1, 0);
    const status = BC.check(c);
    assert.strictEqual(status.within, false);
    assert.ok(status.exceeded.includes('filesChanged'));
    assert.strictEqual(status.hardStop, false);
  });

  t('changedLines refuses when crossing effective limit (480 lines)', () => {
    let c = BC.create({ changedLines: 600, reservePct: 0.20 });
    c = BC.countChange(c, 'file.ts', 480, 0);
    assert.strictEqual(BC.check(c).within, true);

    // 481st changed line crosses 80% effective limit
    c = BC.countChange(c, 'file.ts', 1, 0);
    const status = BC.check(c);
    assert.strictEqual(status.within, false);
    assert.ok(status.exceeded.includes('changedLines'));
    assert.strictEqual(status.hardStop, false);
  });

  group('IB-03 hard stop at total ceiling (100%)');

  t('filesRead triggers hard stop when crossing total ceiling (40 files)', () => {
    let c = BC.create({ filesRead: 40 });
    for (let i = 1; i <= 40; i++) {
      c = BC.countRead(c, `file_${i}.ts`);
    }
    let status = BC.check(c);
    assert.strictEqual(status.hardStop, false);

    // 41st file crosses 100% total ceiling
    c = BC.countRead(c, 'file_41.ts');
    status = BC.check(c);
    assert.strictEqual(status.hardStop, true);
    assert.ok(status.hardStops.includes('filesRead'));
  });

  t('toolCalls triggers hard stop when crossing total ceiling (20 calls)', () => {
    let c = BC.create({ toolCalls: 20 });
    for (let i = 1; i <= 20; i++) {
      c = BC.countToolCall(c, 'bash');
    }
    assert.strictEqual(BC.check(c).hardStop, false);

    // 21st tool call crosses 100% total ceiling
    c = BC.countToolCall(c, 'bash');
    const status = BC.check(c);
    assert.strictEqual(status.hardStop, true);
    assert.ok(status.hardStops.includes('toolCalls'));
  });

  t('filesChanged triggers hard stop when crossing total ceiling (12 files)', () => {
    let c = BC.create({ filesChanged: 12 });
    for (let i = 1; i <= 12; i++) {
      c = BC.countChange(c, `file_${i}.ts`, 1, 0);
    }
    assert.strictEqual(BC.check(c).hardStop, false);

    // 13th file crosses 100% total ceiling
    c = BC.countChange(c, 'file_13.ts', 1, 0);
    const status = BC.check(c);
    assert.strictEqual(status.hardStop, true);
    assert.ok(status.hardStops.includes('filesChanged'));
  });

  t('changedLines triggers hard stop when crossing total ceiling (600 lines)', () => {
    let c = BC.create({ changedLines: 600 });
    c = BC.countChange(c, 'file.ts', 600, 0);
    assert.strictEqual(BC.check(c).hardStop, false);

    // 601st line crosses 100% total ceiling
    c = BC.countChange(c, 'file.ts', 1, 0);
    const status = BC.check(c);
    assert.strictEqual(status.hardStop, true);
    assert.ok(status.hardStops.includes('changedLines'));
  });

  group('Tandem beforeTool runtime enforcement and blocking');

  t('beforeTool blocks when toolCalls dimension is exhausted', () => {
    const tandem = new Tandem(testCwd, 'test-model', { toolCalls: 5, filesRead: 100 });
    // First 4 tool calls are permitted (effective limit = 5 - 1 = 4)
    for (let i = 1; i <= 4; i++) {
      const res = tandem.beforeTool({ kind: 'read', file: `file_${i}.ts` });
      assert.strictEqual(res.block, false);
    }

    // 5th tool call exceeds effective limit 4
    const blocked = tandem.beforeTool({ kind: 'read', file: 'file_5.ts' });
    assert.strictEqual(blocked.block, true);
    assert.ok(blocked.reason.includes('toolCalls'));
    assert.ok(blocked.reason.includes('5')); // count 5
    assert.ok(blocked.reason.includes('ceiling 5') || blocked.reason.includes('5'));
  });

  t('beforeTool blocks when filesRead dimension is exhausted', () => {
    const tandem = new Tandem(testCwd, 'test-model', { filesRead: 5, toolCalls: 100 });
    // Read 4 unique files (effective limit = 4)
    for (let i = 1; i <= 4; i++) {
      const res = tandem.beforeTool({ kind: 'read', file: `doc_${i}.ts` });
      assert.strictEqual(res.block, false);
    }

    // Reading same file again does not increment filesRead
    const repeat = tandem.beforeTool({ kind: 'read', file: 'doc_1.ts' });
    assert.strictEqual(repeat.block, false);

    // Reading 5th unique file exceeds effective limit 4
    const blocked = tandem.beforeTool({ kind: 'read', file: 'doc_5.ts' });
    assert.strictEqual(blocked.block, true);
    assert.ok(blocked.reason.includes('filesRead'));
    assert.ok(blocked.reason.includes('count 5'));
  });

  t('beforeTool blocks when changedLines dimension is exhausted', () => {
    const tandem = new Tandem(testCwd, 'test-model', { changedLines: 100, toolCalls: 100 });
    // Edit with 85 lines exceeds effective limit 80
    const blocked = tandem.beforeTool({
      kind: 'edit',
      file: 'src/util.ts',
      new_string: 'a\n'.repeat(84) + 'a',
    });
    assert.strictEqual(blocked.block, true);
    assert.ok(blocked.reason.includes('changedLines'));
    assert.ok(blocked.reason.includes('85'));
    assert.ok(blocked.reason.includes('ceiling 100'));
  });

  t('beforeTool blocks when filesChanged dimension is exhausted', () => {
    const tandem = new Tandem(testCwd, 'test-model', { filesChanged: 5, toolCalls: 100 });
    // Edit 4 unique files
    for (let i = 1; i <= 4; i++) {
      const res = tandem.beforeTool({ kind: 'write', file: `src/f${i}.ts`, content: 'ok' });
      assert.strictEqual(res.block, false);
    }

    // 5th file exceeds effective limit 4
    const blocked = tandem.beforeTool({ kind: 'write', file: 'src/f5.ts', content: 'ok' });
    assert.strictEqual(blocked.block, true);
    assert.ok(blocked.reason.includes('filesChanged'));
    assert.ok(blocked.reason.includes('count 5'));
  });

  t('sessionStart resets budget counters', () => {
    const tandem = new Tandem(testCwd, 'test-model', { toolCalls: 2 });
    tandem.beforeTool({ kind: 'read', file: 'f1.ts' });
    tandem.beforeTool({ kind: 'read', file: 'f2.ts' });
    // Blocked now
    assert.strictEqual(tandem.beforeTool({ kind: 'read', file: 'f3.ts' }).block, true);

    // Reset session
    tandem.sessionStart();
    const fresh = tandem.beforeTool({ kind: 'read', file: 'f1.ts' });
    assert.strictEqual(fresh.block, false);
  });
};
