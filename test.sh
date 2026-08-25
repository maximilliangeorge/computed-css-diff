#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

PORT_OLD=8191
PORT_NEW=8192
TMP=$(mktemp -d)
trap 'kill $OLD_PID $NEW_PID 2>/dev/null; rm -rf "$TMP"' EXIT

python3 -m http.server $PORT_OLD --directory fixtures/site-old >/dev/null 2>&1 &
OLD_PID=$!
python3 -m http.server $PORT_NEW --directory fixtures/site-new >/dev/null 2>&1 &
NEW_PID=$!
sleep 1

fail() { echo "FAIL: $1"; exit 1; }

echo "== compare (JSON + collapse): expect differences (exit 1) =="
if node css-diff.mjs compare "http://127.0.0.1:$PORT_OLD/" "http://127.0.0.1:$PORT_NEW/" \
  --viewports 375,1024 --collapse -o "$TMP/report.json" --md "$TMP/report.md"; then
  fail "compare reported no differences"
fi
node test-assert.mjs "$TMP/report.json" diff collapse || fail "collapsed JSON assertions"
node test-assert.mjs "$TMP/report.json" diff || fail "uncollapsed-shape assertions"
grep -q 'font-weight' "$TMP/report.md" || fail "markdown report missing font-weight"

echo "== compare (no collapse) =="
if node css-diff.mjs compare "http://127.0.0.1:$PORT_OLD/" "http://127.0.0.1:$PORT_NEW/" \
  --viewports 375 -o "$TMP/report-raw.json"; then
  fail "compare (raw) reported no differences"
fi
node test-assert.mjs "$TMP/report-raw.json" diff || fail "raw JSON assertions"
node -e '
  const r=require(process.argv[1]);
  const h2=r.changes.find(c=>c.type==="changed"&&c.path.endsWith(">h2"));
  if(!h2.changes["border-color"]) { console.error("raw report should keep border-color"); process.exit(1);}
' "$TMP/report-raw.json" || fail "raw report should not collapse"

echo "== self-compare: expect zero differences (exit 0) =="
node css-diff.mjs compare "http://127.0.0.1:$PORT_OLD/" "http://127.0.0.1:$PORT_OLD/" \
  --viewports 375 --collapse -o "$TMP/self.json" || fail "self-compare reported differences"
node test-assert.mjs "$TMP/self.json" self || fail "self-compare assertions"

echo "== dump + diff flow =="
node css-diff.mjs dump "http://127.0.0.1:$PORT_OLD/" -o "$TMP/old.snap.json" --viewports 375 || fail "dump old"
node css-diff.mjs dump "http://127.0.0.1:$PORT_NEW/" -o "$TMP/new.snap.json" --viewports 375 || fail "dump new"
if node css-diff.mjs diff "$TMP/old.snap.json" "$TMP/new.snap.json" --collapse -o "$TMP/report2.json"; then
  fail "dump/diff reported no differences"
fi
node test-assert.mjs "$TMP/report2.json" diff collapse || fail "dump/diff assertions"

echo "PASS"
