// Maps worship sheet members onto lotw-mgmt person records.
//
// The sheet keys members by email address; every worship row that names a member
// (votes, schedule) carries that email. Neon stores members as person UUIDs, so
// the import needs a member -> person mapping before it can load anything.
//
//   node scripts/match-persons.mjs --snapshot migration/export.json
//   node scripts/match-persons.mjs --validate
//
// The first form writes migration/person-mapping.json, keeping any entry a human
// has already filled in. The second form exits non-zero while anything is still
// unresolved or ambiguous, which is the gate import-neon.mjs runs before loading.
//
// Requires DATABASE_URL for the shared Neon database. Read-only: this script
// never writes to a management-owned table.

import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

const MAPPING_PATH = "migration/person-mapping.json";

// Same normalization the management system applies during LINE binding:
// strip all whitespace (not just the ends) and fold case.
const norm = v => (v ?? "").replace(/\s+/gu, "").toLowerCase();

// Ordered rules — the first one yielding exactly one candidate wins. A rule
// matching several people stops the search and marks the member ambiguous
// rather than picking one.
const RULES = [
  { name: "email",  match: (m, p) => p.email && norm(p.email) === norm(m.email) },
  { name: "exact",  match: (m, p) => [p.name, p.english_name].some(n => n && norm(n) === norm(m.name)) },
  // 筠軒 is the personal name of 周筠軒. Two characters minimum so a single
  // character does not sweep up half the roster.
  { name: "suffix", match: (m, p) => norm(m.name).length >= 2 && p.name && norm(p.name).endsWith(norm(m.name)) },
  // english_name holds full names like "Richard Chang", so compare per token.
  { name: "token",  match: (m, p) => p.english_name && p.english_name.split(/\s+/).some(t => norm(t) === norm(m.name)) },
];

function resolve(member, persons) {
  for (const rule of RULES) {
    const found = persons.filter(p => rule.match(member, p));
    if (found.length === 1) return { rule: rule.name, personId: found[0].id, personName: found[0].name };
    if (found.length > 1)  return { rule: rule.name, ambiguous: found.map(p => ({ id: p.id, name: p.name })) };
  }
  return { rule: null };
}

function readMapping() {
  if (!fs.existsSync(MAPPING_PATH)) return {};
  return JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8")).members ?? {};
}

function report(entries) {
  const byRule = {};
  const open = [];
  for (const [id, e] of Object.entries(entries)) {
    if (!e.personId) { open.push([id, e]); continue; }
    (byRule[e.resolvedBy] ??= []).push(`${e.memberName}→${e.personName}`);
  }
  for (const rule of [...RULES.map(r => r.name), "manual"]) {
    if (byRule[rule]) console.log(`  ${rule.padEnd(7)}: ${byRule[rule].length}  ${byRule[rule].join(", ")}`);
  }
  for (const [id, e] of open) {
    const why = e.ambiguous ? `ambiguous: ${e.ambiguous.map(c => c.name).join(" / ")}` : "no candidate";
    console.log(`  UNRESOLVED ${e.memberName} <${id}> — ${why}`);
  }
  return open.length;
}

const args = process.argv.slice(2);
const validateOnly = args.includes("--validate");

if (validateOnly) {
  const entries = readMapping();
  if (!Object.keys(entries).length) {
    console.error(`No mapping at ${MAPPING_PATH}. Run without --validate first.`);
    process.exit(1);
  }
  console.log(`Validating ${MAPPING_PATH} (${Object.keys(entries).length} members)`);
  const open = report(entries);
  if (open) {
    console.error(`\n${open} member(s) still unresolved — fill in personId before importing.`);
    process.exit(1);
  }
  console.log("\nMapping complete — every member resolves to exactly one person.");
  process.exit(0);
}

const snapshotPath = args[args.indexOf("--snapshot") + 1];
if (!args.includes("--snapshot") || !snapshotPath) {
  console.error("Usage: node scripts/match-persons.mjs --snapshot <export.json> | --validate");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (shared Neon database).");
  process.exit(1);
}

const members = JSON.parse(fs.readFileSync(snapshotPath, "utf8")).members;
const sql = neon(process.env.DATABASE_URL);
const persons = await sql`select id, name, english_name, email from persons`;

// Keep decisions a human already made; only re-resolve what is still open.
const existing = readMapping();
const entries = {};
for (const m of members) {
  const prior = existing[m.id];
  if (prior?.personId) { entries[m.id] = { ...prior, memberName: m.name }; continue; }
  const r = resolve(m, persons);
  entries[m.id] = r.personId
    ? { memberName: m.name, personId: r.personId, personName: r.personName, resolvedBy: r.rule }
    : { memberName: m.name, personId: null, ...(r.ambiguous ? { ambiguous: r.ambiguous } : {}) };
}

fs.mkdirSync(path.dirname(MAPPING_PATH), { recursive: true });
fs.writeFileSync(MAPPING_PATH, JSON.stringify({ members: entries }, null, 2) + "\n");

console.log(`${members.length} members against ${persons.length} persons → ${MAPPING_PATH}`);
const open = report(entries);
if (open) console.log(`\nFill in personId for the ${open} unresolved member(s), then re-run with --validate.`);
