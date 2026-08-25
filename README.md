# computed-css-diff

Headless **computed-style diffing** for CSS refactors. Captures `getComputedStyle`
for every DOM element across multiple viewports on two builds and diffs the values,
so you can prove a stylesheet migration (e.g. SCSS → Tailwind) doesn't change
rendering — with per-property, per-element precision that pixel diffing can't give you.

```
node css-diff.mjs compare http://localhost:3000/page http://localhost:3001/page --collapse
375x900: 9 changed, 1 added, 1 removed
total element differences: 11
report: css-diff-report.json
```

## Why not visual regression testing?

Tools like BackstopJS/Percy compare screenshots. They tell you *something* looks
different; they don't tell you *which property on which element*. This tool answers
exactly that, which makes it:

- **Precise** — `padding-top: 16px → 24px` on `html>body>main` (`.card`), not a red blob.
- **LLM-friendly** — the JSON report is a flat list of change records you can loop
  over in an agent ("assess each change, is it intentional?").
- **Fixture-free** — point it at two URLs; no per-page snapshot configs to maintain.

## Install

```bash
npm install
npx playwright install chromium
```

Requires Node 18+.

## Usage

```bash
# both builds running at once (e.g. old branch on :3000, new branch on :3001)
node css-diff.mjs compare <oldUrl> <newUrl> [options]

# or, when you can't run both at once (single dev server):
node css-diff.mjs dump <url> -o old.snap.json      # on the old branch
git checkout my-tailwind-branch && npm run build   # rebuild, restart server
node css-diff.mjs dump <url> -o new.snap.json      # on the new branch
node css-diff.mjs diff old.snap.json new.snap.json
```

Exit code is `1` when differences are found, `0` when rendering is identical —
CI-friendly as-is.

### Key options

| Flag | Effect |
| --- | --- |
| `--viewports 375,768,1024,1440` | Widths to capture (default shown; height via `--height`, default 900) |
| `--collapse` | Fold cascade/shorthand noise into single records (**recommended**) |
| `--root ".card"` | Target specific node(s): every match plus its subtree (default `body`, whole page) |
| `--md report.md` | Also write a human-readable Markdown report |
| `--props color,padding` | Compare only these properties (default: curated list of ~160) |
| `--all-props` | Compare every computed property |
| `--ignore font-family` | Properties to skip when diffing |
| `--pseudo` | Also capture `::before` / `::after` |
| `--wait-selector "#app"` | Wait for a selector before capture |
| `--delay 500` | Extra settle time (ms) before capture |
| `--storage-state auth.json` | Playwright storageState for logged-in pages |
| `--color-scheme dark` | Emulate `prefers-color-scheme` (default `light`) |
| `--browser firefox` | `chromium` (default) \| `firefox` \| `webkit` |
| `--save-snapshots base` | (compare) also write `base.old.json` / `base.new.json` |

Run `node css-diff.mjs --help` for the full list.

### Iterating on a single component

Point `--root` at your component instead of the whole page. **Every match** is
captured — the element plus its subtree — so one flag covers all instances, and
unrelated parts of the page are ignored entirely:

```bash
# all instances of .card, and nothing else
node css-diff.mjs compare http://localhost:3000/pricing http://localhost:3001/pricing \
  --root ".card" --collapse

# several components at once
node css-diff.mjs compare ... --root ".card, .sidebar, #nav"
```

Instances match across builds by DOM position, so a new/removed instance shows up
as an `added`/`removed` record rather than misaligning the rest.

## Report format

JSON, flat, one record per changed element:

```jsonc
{
  "tool": "computed-css-diff",
  "format": 2,
  "old": { "url": "…", "capturedAt": "…" },
  "new": { "url": "…", "capturedAt": "…" },
  "summary": {
    "totalChanges": 11,
    "byViewport": { "375x900": { "changed": 9, "added": 1, "removed": 1 } },
    "topProperties": [{ "property": "color", "count": 8 }]   // root causes bubble up
  },
  "changes": [
    {
      "viewport": "375x900",
      "type": "changed",            // changed | added | removed
      "path": "html>body>main>h2",  // structural DOM path
      "selector": "html > body > main > h2",  // queryable CSS selector
      "hint": { "id": null, "cls": "title", "text": "Hello" },
      "box": { "old": [17, 17, 341, 23], "new": [25, 25, 325, 23] },
      "changes": {
        "font-weight": { "old": "700", "new": "600" }
      }
    }
  ]
}
```

## `--collapse`: cutting the noise

Computed styles cascade, so one real change fans out into dozens of diffs.
`--collapse` folds them back up:

- **currentColor cascades** — a `color` change ripples into `border-color`,
  `outline`, `caret-color`, `text-decoration-color`, `column-rule`, etc. on the
  same element. Collapsed into the single `color` record with a
  `cascaded: […]` list of the properties it drove.
- **shorthand/longhand duplicates** — `padding` absorbs `padding-top/right/…`
  (same for `margin`, `gap`→`row-gap`/`column-gap`, `border-radius`), recorded
  in an `expands: […]` list.

Nothing is lost — the folded properties are named in the record — but a
22-property diff becomes 5 real changes, which is what you (or an LLM) actually
want to review.

## How it works

1. Launches headless Chromium (Playwright), waits for `load`, `networkidle`,
   and `document.fonts.ready`.
2. Injects a stylesheet freezing animations/transitions so capture is
   deterministic (`--no-freeze` to disable).
3. Walks the DOM under `--root`, recording per element: a structural path, a
   queryable selector, id/class/text hints, bounding box, and the computed
   values of ~160 visually-relevant properties.
4. Matches elements between builds by path — tolerant of sibling re-indexing
   (adding a `<li>` won't false-positive its siblings) — and diffs values.
   Genuinely new/removed elements are reported as `added`/`removed`.

## Development

```bash
bash test.sh   # serves fixtures on two ports, runs 5 e2e scenarios
```

Scenarios: collapsed compare, uncollapsed compare (raw keeps `border-color`),
self-compare must yield zero diffs (determinism), and the dump→diff flow.
