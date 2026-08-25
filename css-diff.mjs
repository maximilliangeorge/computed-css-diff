#!/usr/bin/env node
import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

const TOOL = 'computed-css-diff';
const FORMAT_VERSION = 1;
const DEFAULT_HEIGHT = 900;
const DEFAULT_VIEWPORTS = [375, 768, 1024, 1440];

const FREEZE_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';

const DEFAULT_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'float', 'clear',
  'z-index', 'visibility', 'opacity', 'overflow', 'overflow-x', 'overflow-y', 'isolation',
  'vertical-align', 'box-sizing', 'aspect-ratio', 'columns', 'column-width', 'column-count', 'column-rule',

  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-right', 'border-right-width', 'border-right-style', 'border-right-color',
  'border-bottom', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
  'border-left', 'border-left-width', 'border-left-style', 'border-left-color',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'box-shadow', 'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells',

  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap',
  'justify-content', 'justify-items', 'align-items', 'align-self', 'align-content',
  'gap', 'row-gap', 'column-gap', 'order', 'place-items', 'place-content',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
  'grid-auto-flow', 'grid-area',

  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-align-last', 'text-decoration', 'text-decoration-line', 'text-decoration-color',
  'text-decoration-style', 'text-decoration-thickness', 'text-indent', 'text-transform', 'text-overflow',
  'text-shadow', 'text-rendering', 'text-size-adjust',
  'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'direction', 'unicode-bidi', 'writing-mode',
  '-webkit-font-smoothing',

  'color', 'background', 'background-color', 'background-image', 'background-position',
  'background-size', 'background-repeat', 'background-clip', 'background-origin', 'background-attachment',
  'caret-color', 'accent-color',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-opacity',

  'cursor', 'pointer-events', 'user-select', '-webkit-user-select', 'resize',
  'appearance', '-webkit-appearance', 'object-fit', 'object-position', 'image-rendering',
  'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
  'clip-path', 'filter', 'backdrop-filter', 'mix-blend-mode', 'will-change',
  'transform', 'transform-origin', 'translate', 'rotate', 'scale',
  'scroll-behavior', 'scroll-snap-type', 'overscroll-behavior',
];

const HELP = `${TOOL} — diff computed styles between two builds/URLs

Usage:
  css-diff.mjs dump <url> -o snapshot.json [options]       capture one build to a snapshot file
  css-diff.mjs diff <old.json> <new.json> [-o report.json] diff two snapshot files
  css-diff.mjs compare <oldUrl> <newUrl> [-o report.json]  capture + diff in one step

The report is JSON by default: a flat, LLM-friendly list of change records under
\`changes\`, plus a \`summary\` (totals + most-changed properties). Use --md <file>
to also write a human-readable Markdown report.

Options:
  --viewports 375,768,1024,1440   widths to capture (default: ${DEFAULT_VIEWPORTS.join(',')})
  --height 900                    viewport height (default: ${DEFAULT_HEIGHT})
  --root body                     selector for the root node(s): every match and its subtree
                                  is captured. Target one component (--root ".card") or several
                                  (--root ".card, .sidebar"). Default: body (whole page)
  --props color,padding,...       compare only these properties (default: curated list of ~160)
  --all-props                     compare every computed property instead of the curated list
  --ignore font-family,...        properties to ignore when diffing
  --collapse                      fold currentColor cascades + shorthand/longhand duplicates
                                  into single records (recommended for LLM review)
  --pseudo                        also capture ::before/::after styles
  --no-freeze                     do not inject the animation/transition freeze stylesheet
  --delay 500                     extra ms to wait before capture
  --wait-selector "#app"          wait for this selector before capture
  --storage-state auth.json       Playwright storageState for logged-in sessions
  --color-scheme light|dark       emulate prefers-color-scheme (default: light)
  --browser chromium              chromium | firefox | webkit (default: chromium)
  --save-snapshots base           (compare) also write base.old.json / base.new.json
  --md report.md                  also write a Markdown report
  --timeout 30000                 navigation timeout in ms

Exit code 1 when differences are found, 0 when rendering is identical.

Typical migration workflow:
  1. run your app on the old CSS (e.g. port 3000) and the new CSS (port 3001)
  2. node css-diff.mjs compare http://localhost:3000/page http://localhost:3001/page --collapse -o report.json
  (or: dump once from the old branch, rebuild, dump again, then diff the two snapshot files)`;

function die(msg) {
  console.error(msg);
  process.exit(2);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a === '-o') {
      if (argv[i + 1] === undefined) die('missing value for -o');
      flags.o = argv[++i];
      continue;
    }
    if (a === '--no-freeze') { flags.freeze = false; continue; }
    if (a === '--all-props') { flags.allProps = true; continue; }
    if (a === '--pseudo') { flags.pseudo = true; continue; }
    if (a === '--collapse') { flags.collapse = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) die(`missing value for --${key}`);
      flags[key] = v;
      i++;
      continue;
    }
    pos.push(a);
  }
  return { flags, pos };
}

function buildOpts(flags) {
  const viewports = (flags.viewports
    ? String(flags.viewports).split(',').map((s) => parseInt(s.trim(), 10))
    : DEFAULT_VIEWPORTS
  ).filter((n) => Number.isFinite(n) && n > 0);
  if (!viewports.length) die('no valid viewports given');
  return {
    viewports,
    height: flags.height ? parseInt(flags.height, 10) : DEFAULT_HEIGHT,
    props: [...new Set(flags.props ? String(flags.props).split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_PROPS)],
    allProps: !!flags.allProps,
    pseudo: !!flags.pseudo,
    freeze: flags.freeze !== false,
    collapse: !!flags.collapse,
    ignore: new Set(flags.ignore ? String(flags.ignore).split(',').map((s) => s.trim()).filter(Boolean) : []),
    root: flags.root || 'body',
    delay: flags.delay ? parseInt(flags.delay, 10) : 0,
    waitSelector: flags['wait-selector'] || null,
    storageState: flags['storage-state'] || null,
    colorScheme: flags['color-scheme'] || 'light',
    browser: flags.browser || 'chromium',
    timeout: flags.timeout ? parseInt(flags.timeout, 10) : 30000,
  };
}

function browserFor(name) {
  const map = { chromium, firefox, webkit };
  if (!map[name]) die(`unknown --browser "${name}" (use chromium|firefox|webkit)`);
  return map[name];
}

function captureInPage({ rootSelector, props, pseudo, freeze }) {
  const SKIP = new Set([
    'script', 'style', 'noscript', 'link', 'meta', 'title', 'head', 'template',
    'source', 'track', 'base', 'basefont', 'param', 'col', 'colgroup', 'wbr', 'br',
  ]);
  const rootEls = (() => {
    if (rootSelector === 'html') return [document.documentElement];
    try {
      return Array.from(document.querySelectorAll(rootSelector));
    } catch (e) {
      throw new Error('invalid --root selector "' + rootSelector + '": ' + e.message);
    }
  })();
  if (!rootEls.length) throw new Error('root selector matched no elements: ' + rootSelector);

  const pathOf = (el) => {
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = [];
        for (const c of parent.children) if (c.tagName === cur.tagName) sameTag.push(c);
        if (sameTag.length > 1) part += '[' + (sameTag.indexOf(cur) + 1) + '/' + sameTag.length + ']';
      }
      parts.unshift(part);
    }
    return parts.join('>');
  };

  const hintOf = (el) => {
    const id = el.id || null;
    const cls = el.getAttribute ? el.getAttribute('class') : null;
    let text = null;
    if (el.children.length === 0) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t) text = t.slice(0, 80);
    }
    return { id, cls, text };
  };

  const styleOf = (el, pe) => {
    const cs = window.getComputedStyle(el, pe);
    let names = props;
    if (!names) {
      names = [];
      for (let i = 0; i < cs.length; i++) names.push(cs.item(i));
    }
    const out = {};
    for (const n of names) {
      if (freeze && (n.startsWith('transition') || n.startsWith('animation'))) continue;
      const v = cs.getPropertyValue(n);
      if (v !== '') out[n] = v;
    }
    return out;
  };

  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return [
      Math.round(r.x * 100) / 100,
      Math.round(r.y * 100) / 100,
      Math.round(r.width * 100) / 100,
      Math.round(r.height * 100) / 100,
    ];
  };

  const elements = {};
  const seen = new Set();
  for (const rootEl of rootEls) {
    const all = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
    for (const el of all) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (SKIP.has(el.tagName.toLowerCase())) continue;
      const entry = { hint: hintOf(el), box: boxOf(el), styles: styleOf(el, null) };
      if (pseudo) {
        for (const pe of ['::before', '::after']) {
          const cs = window.getComputedStyle(el, pe);
          const content = cs.getPropertyValue('content');
          if (content && content !== 'none' && content !== 'normal') {
            entry[pe] = { content, styles: styleOf(el, pe) };
          }
        }
      }
      elements[pathOf(el)] = entry;
    }
  }
  return elements;
}

async function captureUrl(browser, url, opts) {
  const snapshot = {
    tool: TOOL,
    version: FORMAT_VERSION,
    meta: {
      url,
      capturedAt: new Date().toISOString(),
      options: {
        viewports: opts.viewports,
        height: opts.height,
        root: opts.root,
        freeze: opts.freeze,
        allProps: opts.allProps,
        pseudo: opts.pseudo,
        propCount: opts.props.length,
      },
    },
    viewports: {},
  };
  for (const width of opts.viewports) {
    const ctxOpts = {
      viewport: { width, height: opts.height },
      deviceScaleFactor: 1,
      colorScheme: opts.colorScheme,
    };
    if (opts.storageState) ctxOpts.storageState = opts.storageState;
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: opts.timeout });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await Promise.race([
        page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {}),
        sleep(5000),
      ]);
      if (opts.freeze) {
        await page.addStyleTag({ content: FREEZE_CSS }).catch(() =>
          console.error('warning: could not inject animation-freeze stylesheet (CSP?), capture may be flaky'),
        );
      }
      if (opts.waitSelector) {
        await page.waitForSelector(opts.waitSelector, { timeout: 10000 }).catch(() =>
          console.error(`warning: --wait-selector "${opts.waitSelector}" not found within 10s`),
        );
      }
      if (opts.delay > 0) await sleep(opts.delay);
      const key = `${width}x${opts.height}`;
      process.stderr.write(`capturing ${url} @ ${key}... `);
      snapshot.viewports[key] = await page.evaluate(captureInPage, {
        rootSelector: opts.root,
        props: opts.allProps ? null : opts.props,
        pseudo: opts.pseudo,
        freeze: opts.freeze,
      });
      process.stderr.write(`${Object.keys(snapshot.viewports[key]).length} elements\n`);
    } finally {
      await context.close();
    }
  }
  return snapshot;
}

function viewportSortKey(vp) {
  return parseInt(vp, 10) || 0;
}

function normalizePath(p) {
  return p.replace(/\[\d+\/\d+\]/g, '');
}

function diffElement(ea, eb, ignore) {
  const diffs = {};
  const names = new Set([...Object.keys(ea.styles), ...Object.keys(eb.styles)]);
  for (const n of names) {
    if (ignore && ignore.has(n)) continue;
    const va = ea.styles[n] === undefined ? null : ea.styles[n];
    const vb = eb.styles[n] === undefined ? null : eb.styles[n];
    if (va !== vb) diffs[n] = { old: va, new: vb };
  }
  const boxDiff = ea.box.some((v, i) => v !== eb.box[i]) ? { old: ea.box, new: eb.box } : null;
  const pseudoDiffs = {};
  for (const pe of ['::before', '::after']) {
    const pa = ea[pe];
    const pb = eb[pe];
    if (!pa && !pb) continue;
    if (!pa || !pb) { pseudoDiffs[pe] = { old: pa || null, new: pb || null }; continue; }
    const pd = {};
    if (pa.content !== pb.content) pd.content = { old: pa.content, new: pb.content };
    const pnames = new Set([...Object.keys(pa.styles), ...Object.keys(pb.styles)]);
    for (const n of pnames) {
      if (ignore && ignore.has(n)) continue;
      const va = pa.styles[n] === undefined ? null : pa.styles[n];
      const vb = pb.styles[n] === undefined ? null : pb.styles[n];
      if (va !== vb) pd[n] = { old: va, new: vb };
    }
    if (Object.keys(pd).length) pseudoDiffs[pe] = pd;
  }
  if (!Object.keys(diffs).length && !boxDiff && !Object.keys(pseudoDiffs).length) return null;
  return {
    box: boxDiff,
    props: diffs,
    pseudo: Object.keys(pseudoDiffs).length ? pseudoDiffs : undefined,
  };
}

function diffSnapshots(A, B, ignore) {
  const vpKeys = [...new Set([...Object.keys(A.viewports), ...Object.keys(B.viewports)])].sort(
    (a, b) => viewportSortKey(a) - viewportSortKey(b),
  );
  const result = { old: A.meta, new: B.meta, totalChanges: 0, viewports: {} };
  for (const vp of vpKeys) {
    const a = A.viewports[vp] || {};
    const b = B.viewports[vp] || {};
    const changed = [];
    const added = [];
    const removed = [];

    const onlyA = [];
    const onlyB = [];
    for (const p of Object.keys(a).sort()) if (!b[p]) onlyA.push(p);
    for (const p of Object.keys(b).sort()) if (!a[p]) onlyB.push(p);

    for (const p of Object.keys(a).sort()) {
      if (!b[p]) continue;
      const d = diffElement(a[p], b[p], ignore);
      if (d) changed.push({ path: p, hint: b[p].hint, ...d });
    }

    const groupsA = new Map();
    const groupsB = new Map();
    for (const p of onlyA) {
      const k = normalizePath(p);
      if (!groupsA.has(k)) groupsA.set(k, []);
      groupsA.get(k).push(p);
    }
    for (const p of onlyB) {
      const k = normalizePath(p);
      if (!groupsB.has(k)) groupsB.set(k, []);
      groupsB.get(k).push(p);
    }
    for (const [k, listA] of groupsA) {
      const listB = groupsB.get(k) || [];
      const n = Math.min(listA.length, listB.length);
      for (let i = 0; i < n; i++) {
        const d = diffElement(a[listA[i]], b[listB[i]], ignore);
        if (d) changed.push({ path: listB[i], oldPath: listA[i], hint: b[listB[i]].hint, ...d });
      }
      for (let i = n; i < listA.length; i++) removed.push({ path: listA[i], hint: a[listA[i]].hint });
      for (let i = n; i < listB.length; i++) added.push({ path: listB[i], hint: b[listB[i]].hint });
    }
    for (const [k, listB] of groupsB) {
      if (groupsA.has(k)) continue;
      for (const p of listB) added.push({ path: p, hint: b[p].hint });
    }

    changed.sort((x, y) => (x.path < y.path ? -1 : 1));
    result.viewports[vp] = { changed, added, removed };
    result.totalChanges += changed.length + added.length + removed.length;
  }
  return result;
}

const SHORTHAND_GROUPS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  gap: ['row-gap', 'column-gap'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
};

function collapseProps(props) {
  const out = {};
  const suppressed = new Set();

  const color = props.color;
  if (color && typeof color.old === 'string' && typeof color.new === 'string' && color.old !== color.new) {
    const oc = color.old;
    const nc = color.new;
    const cascaded = [];
    for (const [p, v] of Object.entries(props)) {
      if (p === 'color') continue;
      if (typeof v.old !== 'string' || typeof v.new !== 'string') continue;
      const exact = v.old === oc && v.new === nc;
      const embedded = v.old.includes(oc) && v.old.replaceAll(oc, nc) === v.new;
      if (exact || embedded) {
        cascaded.push(p);
        suppressed.add(p);
      }
    }
    if (cascaded.length) out.color = { old: oc, new: nc, cascaded: cascaded.sort() };
  }

  for (const [shorthand, longhands] of Object.entries(SHORTHAND_GROUPS)) {
    if (!props[shorthand] || suppressed.has(shorthand)) continue;
    const collapsed = longhands.filter((l) => props[l] && !suppressed.has(l));
    if (!collapsed.length) continue;
    for (const l of collapsed) suppressed.add(l);
    const base = out[shorthand] || { ...props[shorthand] };
    base.expands = [...(base.expands || []), ...collapsed].sort();
    out[shorthand] = base;
  }

  for (const [p, v] of Object.entries(props)) {
    if (suppressed.has(p) || out[p]) continue;
    out[p] = v;
  }
  return out;
}

function collapseDiff(d) {
  for (const v of Object.values(d.viewports)) {
    for (const c of v.changed) {
      c.props = collapseProps(c.props);
      if (c.pseudo) {
        for (const pe of Object.keys(c.pseudo)) {
          const pd = c.pseudo[pe];
          if (pd && !('old' in pd) && !('new' in pd)) c.pseudo[pe] = collapseProps(pd);
        }
      }
    }
  }
  return d;
}

function pathToSelector(path) {
  return path
    .split('>')
    .map((seg) => {
      const m = seg.match(/^(.*?)\[(\d+)\/(\d+)\]$/);
      return m ? `${m[1]}:nth-of-type(${m[2]})` : seg;
    })
    .join(' > ');
}

function flattenReport(d, opts) {
  const changes = [];
  for (const [vp, v] of Object.entries(d.viewports)) {
    for (const c of v.changed) {
      changes.push({
        viewport: vp,
        type: 'changed',
        path: c.path,
        ...(c.oldPath ? { oldPath: c.oldPath } : {}),
        selector: pathToSelector(c.path),
        hint: c.hint,
        ...(c.box ? { box: c.box } : {}),
        changes: c.props,
        ...(c.pseudo ? { pseudo: c.pseudo } : {}),
      });
    }
    for (const a of v.added) {
      changes.push({ viewport: vp, type: 'added', path: a.path, selector: pathToSelector(a.path), hint: a.hint });
    }
    for (const r of v.removed) {
      changes.push({ viewport: vp, type: 'removed', path: r.path, selector: pathToSelector(r.path), hint: r.hint });
    }
  }
  const byViewport = {};
  for (const [vp, v] of Object.entries(d.viewports)) {
    byViewport[vp] = { changed: v.changed.length, added: v.added.length, removed: v.removed.length };
  }
  const freq = new Map();
  for (const v of Object.values(d.viewports)) {
    for (const c of v.changed) for (const n of Object.keys(c.props)) freq.set(n, (freq.get(n) || 0) + 1);
  }
  const topProperties = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([property, count]) => ({ property, count }));
  return {
    tool: TOOL,
    format: 2,
    generatedAt: new Date().toISOString(),
    old: { url: d.old.url, capturedAt: d.old.capturedAt },
    new: { url: d.new.url, capturedAt: d.new.capturedAt },
    options: {
      collapsed: !!opts.collapse,
      viewports: opts.viewports,
      ignore: [...opts.ignore],
    },
    summary: { totalChanges: d.totalChanges, byViewport, topProperties },
    changes,
  };
}

function fmtHint(h) {
  if (!h) return '';
  const bits = [];
  if (h.id) bits.push(`id="${h.id}"`);
  if (h.cls) bits.push(`class="${h.cls}"`);
  if (h.text) bits.push(`"${h.text}"`);
  return bits.join(' ');
}

function fmtBox(b) {
  return `[${b.join(', ')}]`;
}

function renderMarkdown(d) {
  const L = [];
  L.push('# Computed CSS diff');
  L.push('');
  L.push(`- old: ${d.old.url} — ${d.old.capturedAt}`);
  L.push(`- new: ${d.new.url} — ${d.new.capturedAt}`);
  L.push(`- **${d.totalChanges} element difference(s)**`);
  L.push('');
  const freq = new Map();
  for (const v of Object.values(d.viewports)) {
    for (const c of v.changed) for (const n of Object.keys(c.props)) freq.set(n, (freq.get(n) || 0) + 1);
  }
  if (freq.size) {
    L.push('## Most changed properties');
    L.push('');
    L.push('| property | elements changed |');
    L.push('| --- | --- |');
    for (const [n, c] of [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25)) {
      L.push(`| \`${n}\` | ${c} |`);
    }
    L.push('');
  }
  for (const [vp, v] of Object.entries(d.viewports)) {
    L.push(`## Viewport ${vp}`);
    L.push('');
    L.push(`changed: ${v.changed.length} · added: ${v.added.length} · removed: ${v.removed.length}`);
    L.push('');
    for (const c of v.changed) {
      L.push(`### \`${c.path}\`${c.oldPath ? ` (was \`${c.oldPath}\`)` : ''}`);
      L.push('');
      const hint = fmtHint(c.hint);
      if (hint) L.push(hint);
      if (c.box) L.push(`- box [x, y, w, h]: ${fmtBox(c.box.old)} → ${fmtBox(c.box.new)}`);
      for (const [n, dd] of Object.entries(c.props)) {
        let line = `- ${n}: \`${dd.old ?? '∅'}\` → \`${dd.new ?? '∅'}\``;
        if (dd.cascaded && dd.cascaded.length) line += `  (also drove: ${dd.cascaded.join(', ')})`;
        if (dd.expands && dd.expands.length) line += `  (= ${dd.expands.join(', ')})`;
        L.push(line);
      }
      if (c.pseudo) {
        for (const [pe, pd] of Object.entries(c.pseudo)) {
          if (pd.old === null || pd.new === null) {
            L.push(`- ${pe}: ${pd.old === null ? 'added' : 'removed'}`);
            continue;
          }
          for (const [n, dd] of Object.entries(pd)) L.push(`- ${pe} ${n}: \`${dd.old}\` → \`${dd.new}\``);
        }
      }
      L.push('');
    }
    for (const x of v.added) L.push(`- **ADDED** \`${x.path}\` ${fmtHint(x.hint)}`);
    for (const x of v.removed) L.push(`- **REMOVED** \`${x.path}\` ${fmtHint(x.hint)}`);
    if (v.added.length || v.removed.length) L.push('');
  }
  return L.join('\n');
}

function emit(d, flags, opts) {
  const out = flags.o || flags.out || 'css-diff-report.json';
  const report = flattenReport(d, opts);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (flags.md) fs.writeFileSync(flags.md, renderMarkdown(d));
  for (const [vp, v] of Object.entries(d.viewports)) {
    console.log(`${vp}: ${v.changed.length} changed, ${v.added.length} added, ${v.removed.length} removed`);
  }
  console.log(`total element differences: ${d.totalChanges}`);
  console.log(`report: ${out}`);
}

async function cmdDump(pos, flags) {
  const url = pos[1];
  if (!url) die('usage: css-diff.mjs dump <url> -o snapshot.json [options]\n\n' + HELP);
  const opts = buildOpts(flags);
  const out = flags.o || flags.out || 'snapshot.json';
  const browser = await browserFor(opts.browser).launch();
  let snap;
  try {
    snap = await captureUrl(browser, url, opts);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(out, JSON.stringify(snap, null, 2));
  console.error(`wrote ${out}`);
}

async function cmdDiff(pos, flags) {
  const [aPath, bPath] = pos.slice(1);
  if (!aPath || !bPath) die('usage: css-diff.mjs diff <old.json> <new.json> [-o report.json] [--md report.md] [--collapse]');
  const opts = buildOpts(flags);
  const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const d = diffSnapshots(A, B, opts.ignore);
  if (opts.collapse) collapseDiff(d);
  emit(d, flags, opts);
  return d.totalChanges > 0 ? 1 : 0;
}

async function cmdCompare(pos, flags) {
  const [urlA, urlB] = pos.slice(1);
  if (!urlA || !urlB) die('usage: css-diff.mjs compare <oldUrl> <newUrl> [-o report.json] [options]\n\n' + HELP);
  const opts = buildOpts(flags);
  const browser = await browserFor(opts.browser).launch();
  let A;
  let B;
  try {
    A = await captureUrl(browser, urlA, opts);
    B = await captureUrl(browser, urlB, opts);
  } finally {
    await browser.close();
  }
  if (flags['save-snapshots']) {
    const base = flags['save-snapshots'];
    fs.writeFileSync(`${base}.old.json`, JSON.stringify(A, null, 2));
    fs.writeFileSync(`${base}.new.json`, JSON.stringify(B, null, 2));
    console.error(`wrote ${base}.old.json and ${base}.new.json`);
  }
  const d = diffSnapshots(A, B, opts.ignore);
  if (opts.collapse) collapseDiff(d);
  emit(d, flags, opts);
  return d.totalChanges > 0 ? 1 : 0;
}

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (flags.help || !cmd) {
    console.log(HELP);
    process.exit(cmd ? 0 : 2);
  }
  let code = 0;
  if (cmd === 'dump') await cmdDump(pos, flags);
  else if (cmd === 'diff') code = await cmdDiff(pos, flags);
  else if (cmd === 'compare') code = await cmdCompare(pos, flags);
  else die(`unknown command "${cmd}"\n\n${HELP}`);
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
