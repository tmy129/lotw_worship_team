// Turns the six Google Sheets CSV exports into one migration snapshot.
//
//   node scripts/export-sheets.mjs --csv-dir "openspec/google_sheet_export"
//
// Reads CSV rather than the Apps Script actions on purpose: getSchedule and
// getSongs de-duplicate before returning, so duplicate rows left by manual sheet
// edits would vanish here and import-neon.mjs would never see the conflict it
// exists to catch. The snapshot is deliberately faithful — no de-duplication, no
// week-id normalization, no type coercion. The import decides what is valid.

import fs from "node:fs";
import path from "node:path";

const OUT_PATH = "migration/export.json";

// Sheet tab -> snapshot collection. Google exports one file per tab, named
// "<spreadsheet> - <tab>.csv", so the tab is matched as a filename suffix.
const TABS = {
  Members: "members",
  Weeks: "weeks",
  Votes: "votes",
  Schedule: "schedule",
  Songs: "songs",
  VoteSettings: "voteSettings",
};

// RFC 4180: quoted fields may contain commas, newlines and doubled quotes.
// Sheets exports without a trailing newline, so the final row is flushed at EOF.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const [headers, ...body] = rows;
  return body
    // A trailing blank line parses as one empty field; a genuine row never is.
    .filter(r => r.some(v => v.trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const args = process.argv.slice(2);
const csvDir = args[args.indexOf("--csv-dir") + 1];
if (!args.includes("--csv-dir") || !csvDir) {
  console.error('Usage: node scripts/export-sheets.mjs --csv-dir "<directory of sheet CSV exports>"');
  process.exit(1);
}

const files = fs.readdirSync(csvDir).filter(f => f.toLowerCase().endsWith(".csv"));
const snapshot = {};
const missing = [];

for (const [tab, collection] of Object.entries(TABS)) {
  const file = files.find(f => path.basename(f, ".csv").trim().endsWith(`- ${tab}`) || path.basename(f, ".csv").trim() === tab);
  if (!file) { missing.push(tab); continue; }
  snapshot[collection] = toObjects(fs.readFileSync(path.join(csvDir, file), "utf8"));
  console.log(`  ${tab.padEnd(13)} ${String(snapshot[collection].length).padStart(4)} rows  (${file})`);
}

if (missing.length) {
  console.error(`\nMissing CSV for tab(s): ${missing.join(", ")}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`\n→ ${OUT_PATH}`);
