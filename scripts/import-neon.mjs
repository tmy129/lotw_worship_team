// Loads a migration snapshot into the worship tables, in one transaction.
//
//   BRANCH_DATABASE_URL=... node scripts/import-neon.mjs \
//     --snapshot migration/export.json --mapping migration/person-mapping.json
//
// Everything is validated before a single row is written: the person mapping has
// to be complete, week references have to resolve, and no role may exceed its
// seat count. A conflict loads only when migration/import-waivers.json names that
// exact week and role, in which case the last exported row wins — the same row
// getSchedule has been showing — and the dropped rows are reported.
//
// Re-runnable: the worship tables are cleared inside the same transaction, so a
// failed load leaves the database exactly as it was.

import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const SNAPSHOT = arg("--snapshot", "migration/export.json");
const MAPPING  = arg("--mapping", "migration/person-mapping.json");
const WAIVERS  = arg("--waivers", "migration/import-waivers.json");

// The team recorded Keyboard as 弦樂 for part of the year. No week holds both
// labels, so the rows merge cleanly into the position the church record names.
const ROLE_RENAMES = { "弦樂": "Keyboard" };
const TWO_SEAT_ROLES = new Set(["主領", "配唱"]);
const PLACEHOLDER = "—";

// Sheets writes times as "2026/4/29 下午 4:42:46" in Asia/Taipei.
function parseSheetTimestamp(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(上午|下午)\s*(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, meridiem, hh, mi, ss] = m;
  let hour = hh ? Number(hh) : 0;
  if (meridiem === "下午" && hour < 12) hour += 12;
  if (meridiem === "上午" && hour === 12) hour = 0;
  const p = n => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(hour)}:${mi ?? "00"}:${ss ?? "00"}+08:00`;
}
const parseSheetDate = v => parseSheetTimestamp(v)?.slice(0, 10) ?? null;
const bool = v => String(v).toUpperCase() === "TRUE";

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
const mapping  = JSON.parse(fs.readFileSync(MAPPING, "utf8")).members;
const waivers  = fs.existsSync(WAIVERS) ? JSON.parse(fs.readFileSync(WAIVERS, "utf8")) : { schedule: [] };
const waived   = new Set((waivers.schedule ?? []).map(w => `${w.weekId}|${w.role}`));

const problems = [];
const personFor = memberId => mapping[memberId]?.personId ?? null;

// ── validate ────────────────────────────────────────────────────────────────
const weekIds = new Set(snapshot.weeks.map(w => w.id));

for (const [key, rows] of [["votes", snapshot.votes], ["schedule", snapshot.schedule], ["songs", snapshot.songs]]) {
  for (const r of rows) {
    if (!weekIds.has(r.weekId)) problems.push(`${key}: week ${r.weekId} is not in the Weeks tab (${JSON.stringify(r)})`);
  }
}
for (const r of snapshot.votes) {
  if (!personFor(r.memberId)) problems.push(`votes: member ${r.memberId} is not mapped to a person (week ${r.weekId})`);
}
for (const m of snapshot.members) {
  if (!personFor(m.id)) problems.push(`members: ${m.name} <${m.id}> is not mapped to a person`);
}

// Schedule needs renaming and placeholder removal before its seats can be counted.
const scheduleRows = [];
let placeholders = 0;
for (const r of snapshot.schedule) {
  const role = ROLE_RENAMES[r.role] ?? r.role;
  if (!r.memberId && r.memberName === PLACEHOLDER) { placeholders++; continue; }
  if (r.memberId && !personFor(r.memberId)) {
    problems.push(`schedule: member ${r.memberId} is not mapped to a person (week ${r.weekId}, role ${role})`);
    continue;
  }
  scheduleRows.push({ ...r, role, personId: r.memberId ? personFor(r.memberId) : null });
}

// Seat assignment, in export order. A role that overflows its seats is a conflict.
const bySeat = new Map();
const kept = [];
const dropped = [];
for (const r of scheduleRows) {
  const key = `${r.weekId}|${r.role}`;
  const seats = TWO_SEAT_ROLES.has(r.role) ? 2 : 1;
  const current = bySeat.get(key) ?? [];
  // 講員 is free text and may legitimately repeat the same name; keep one row.
  const already = current.findIndex(x => (x.personId && x.personId === r.personId) || (!x.personId && !r.personId));
  if (already !== -1) { current[already] = r; bySeat.set(key, current); continue; }
  if (current.length < seats) { current.push(r); bySeat.set(key, current); continue; }
  if (waived.has(key)) { dropped.push(current[current.length - 1]); current[current.length - 1] = r; bySeat.set(key, current); continue; }
  problems.push(`schedule: ${r.weekId} ${r.role} has more people than seats (${[...current, r].map(x => x.memberName).join(", ")}) — add a waiver to accept last-row-wins`);
}
for (const [key, rows] of bySeat) rows.forEach((r, i) => kept.push({ ...r, slot: i + 1 }));

if (problems.length) {
  console.error(`Import aborted — ${problems.length} problem(s), nothing was written:\n`);
  problems.slice(0, 20).forEach(p => console.error(`  - ${p}`));
  if (problems.length > 20) console.error(`  … and ${problems.length - 20} more`);
  process.exit(1);
}

// ── load ────────────────────────────────────────────────────────────────────
const url = process.env.BRANCH_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("Set BRANCH_DATABASE_URL (or DATABASE_URL)."); process.exit(1); }
const sql = neon(url);

const insert = (table, columns, rows) => {
  if (!rows.length) return null;
  const params = [];
  const tuples = rows.map(row => {
    const slots = row.map(v => { params.push(v); return `$${params.length}`; });
    return `(${slots.join(",")})`;
  });
  return sql.query(`insert into ${table} (${columns.join(",")}) values ${tuples.join(",")}`, params);
};

const months = v => (v && v !== "undefined" ? v.split(",").map(Number).filter(n => Number.isFinite(n)) : []);

const statements = [
  // Cleared inside the transaction, so an abort rolls the clear back too.
  sql.query("delete from worship_schedule"),
  sql.query("delete from worship_votes"),
  sql.query("delete from worship_songs"),
  sql.query("delete from worship_member_profiles"),
  sql.query("delete from worship_vote_settings"),
  sql.query("delete from worship_weeks"),
  insert("worship_weeks", ["id", "label", "practice_time", "service_time", "status"],
    snapshot.weeks.map(w => [w.id, w.label, w.practiceTime || null, w.serviceTime || null, w.status || "upcoming"])),
  insert("worship_vote_settings", ["id", "months", "deadline", "opened_at", "opened_by", "status", "note"],
    snapshot.voteSettings.map(v => [v.id, months(v.months), parseSheetDate(v.deadline), parseSheetTimestamp(v.openedAt), v.openedBy || null, v.status || "open", v.note || null])),
  insert("worship_member_profiles", ["person_id", "app_role", "constraints", "av_color", "initials", "display_name"],
    // The sheet's name column is the short name the team uses, not the person's
    // formal name — it belongs to the worship profile, not the church record.
    snapshot.members.map(m => [personFor(m.id), m.role || "member", m.constraints || null, m.avColor || null, m.initials || null, m.name || null])),
  insert("worship_votes", ["week_id", "person_id", "vote", "updated_at"],
    snapshot.votes.map(v => [v.weekId, personFor(v.memberId), v.vote, parseSheetTimestamp(v.updatedAt)])),
  insert("worship_schedule", ["week_id", "role", "slot", "person_id", "member_name", "updated_at"],
    kept.map(r => [r.weekId, r.role, r.slot, r.personId, r.memberName, parseSheetTimestamp(r.updateAt ?? r.updatedAt)])),
  insert("worship_songs", ["week_id", "slot", "name", "confirmed", "youtube"],
    snapshot.songs.map(s => [s.weekId, Number(s.slot), s.name, bool(s.confirmed), s.youtube || null])),
].filter(Boolean);

await sql.transaction(statements);

console.log("Imported:");
console.log(`  weeks          ${snapshot.weeks.length}`);
console.log(`  vote settings  ${snapshot.voteSettings.length}`);
console.log(`  profiles       ${snapshot.members.length}`);
console.log(`  votes          ${snapshot.votes.length}`);
console.log(`  schedule       ${kept.length}  (of ${snapshot.schedule.length} exported)`);
console.log(`  songs          ${snapshot.songs.length}`);
console.log(`\n  ${placeholders} placeholder row(s) skipped (member "${PLACEHOLDER}", no assignment recorded)`);
if (dropped.length) {
  console.log(`  ${dropped.length} row(s) dropped under waiver (last row wins):`);
  dropped.forEach(r => console.log(`    - ${r.weekId} ${r.role} ${r.memberName}`));
}
