#!/usr/bin/env node
import fs from 'node:fs';

const reportPath = process.argv[2];
const mode = process.argv[3] || 'diff'; // diff | self
const collapse = process.argv[4] === 'collapse';

const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const fail = (m) => {
  console.error(`ASSERT FAIL: ${m}`);
  process.exit(1);
};

if (r.format !== 2) fail(`expected format 2, got ${r.format}`);
if (!Array.isArray(r.changes)) fail('changes is not an array');

if (mode === 'self') {
  if (r.summary.totalChanges !== 0) fail(`expected 0 changes, got ${r.summary.totalChanges}`);
  if (r.changes.length !== 0) fail(`expected empty changes[], got ${r.changes.length}`);
  console.log('self-compare OK: 0 changes');
  process.exit(0);
}

if (!(r.summary.totalChanges > 0)) fail('expected changes, got none');

const changed = r.changes.filter((c) => c.type === 'changed');
const added = r.changes.filter((c) => c.type === 'added');
const removed = r.changes.filter((c) => c.type === 'removed');

const h2 = changed.find((c) => c.viewport === '375x900' && c.path.endsWith('>h2'));
if (!h2) fail('no changed h2 record at 375');
const fw = h2.changes['font-weight'];
if (!fw || fw.old !== '700' || fw.new !== '600') fail('font-weight 700->600 missing on h2');
if (!h2.selector.includes('h2')) fail(`selector missing h2: ${h2.selector}`);

if (!added.some((a) => a.path.includes('li[4/4]'))) fail('added li[4/4] missing');
if (!removed.some((x) => x.path.endsWith('>em'))) fail('removed em missing');

if (collapse) {
  const color = h2.changes.color;
  if (!color) fail('color change missing on h2');
  if (!Array.isArray(color.cascaded) || !color.cascaded.includes('border-color')) {
    fail('border-color not collapsed into color.cascaded');
  }
  if (h2.changes['border-color']) fail('border-color should be suppressed on h2');

  const card = changed.find((c) => c.viewport === '375x900' && c.hint && c.hint.id === 'main-card');
  if (!card) fail('no card record');
  const pad = card.changes.padding;
  if (!pad) fail('padding shorthand missing on card');
  if (!Array.isArray(pad.expands) || !pad.expands.includes('padding-top')) {
    fail('padding-top not folded into padding.expands');
  }
  if (card.changes['padding-top']) fail('padding-top should be suppressed on card');
  const gap = card.changes.gap || changed.find((c) => c.path.endsWith('>ul') && c.viewport === '375x900')?.changes.gap;
  if (gap && gap.expands && !(gap.expands.includes('row-gap') && gap.expands.includes('column-gap'))) {
    fail('gap.expands should include row-gap and column-gap');
  }
}

console.log(`assertions OK (${mode}${collapse ? ', collapse' : ''}, ${r.summary.totalChanges} changes)`);
