// Seeds worship's LINE bindings from the sheet export.
//
//   BRANCH_DATABASE_URL=... node scripts/seed-line-identities.mjs
//
// Bindings live in worship_line_identities, keyed by the management system's
// person id. They are NOT written into that system's identities table: worship
// signs in through its own LINE channel, and an identifier issued by one
// provider means nothing under another, so mixing the two id spaces in one
// column would make every lookup ambiguous.
//
// Idempotent. A person who is already bound keeps the binding they have, and an
// identifier already held by someone else is refused rather than moved.

import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const snapshot = JSON.parse(fs.readFileSync(arg("--snapshot", "migration/export.json"), "utf8"));
const mapping  = JSON.parse(fs.readFileSync(arg("--mapping", "migration/person-mapping.json"), "utf8")).members;

const url = process.env.BRANCH_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("Set BRANCH_DATABASE_URL (or DATABASE_URL)."); process.exit(1); }
const sql = neon(url);

const existing = await sql`
  select w.person_id, w.line_user_id, p.name
    from worship_line_identities w join persons p on p.id = w.person_id`;
const boundPerson = new Map(existing.map(r => [r.person_id, r.line_user_id]));
const boundLineId = new Map(existing.map(r => [r.line_user_id, r]));

const toInsert = [], alreadyBound = [], conflicts = [], noIdentifier = [];

for (const m of snapshot.members) {
  const entry = mapping[m.id];
  if (!m.lineUserId) { noIdentifier.push(m.name); continue; }
  if (!entry?.personId) { conflicts.push(`${m.name}: not mapped to a person`); continue; }

  if (boundPerson.has(entry.personId)) {
    const held = boundPerson.get(entry.personId);
    alreadyBound.push(`${m.name} → ${entry.personName}${held === m.lineUserId ? "" : " (bound to a different identifier — left as it is)"}`);
    continue;
  }
  const owner = boundLineId.get(m.lineUserId);
  if (owner && owner.person_id !== entry.personId) {
    conflicts.push(`${m.name}: identifier already held by ${owner.name}`);
    continue;
  }
  toInsert.push([entry.personId, m.lineUserId, m.name]);
}

if (toInsert.length) {
  const params = [];
  const tuples = toInsert.map(row => `(${row.map(v => { params.push(v); return `$${params.length}`; }).join(",")})`);
  await sql.transaction([
    sql.query(`insert into worship_line_identities (person_id, line_user_id, display_name) values ${tuples.join(",")}`, params),
  ]);
}

console.log(`${snapshot.members.length} member(s) in the export`);
console.log(`  bound now     ${toInsert.length}`);
console.log(`  already bound ${alreadyBound.length}`);
alreadyBound.forEach(l => console.log(`    - ${l}`));
console.log(`  refused       ${conflicts.length}`);
conflicts.forEach(l => console.log(`    - ${l}`));
if (noIdentifier.length) console.log(`  no LINE identifier in the sheet: ${noIdentifier.join(", ")}`);
