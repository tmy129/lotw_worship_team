// Replays read actions against both backends and reports what differs.
//
//   node scripts/parity-check.mjs --worker http://127.0.0.1:8787
//   node scripts/parity-check.mjs --self-test
//
// Literal equality is the wrong test. The sheet backend returned whatever the
// spreadsheet displayed — "TRUE", "1", a placeholder dash for an empty seat —
// while the database returns typed values, and the roster now comes from the
// church record rather than the sheet. Both payloads are normalized the same
// way first; what survives normalization is a real difference.

import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

// Fields no screen reads. The sheet stored practice and service times as real
// date cells and returned them as instants, while the CSV export carries only
// the text a person typed ("1/1 週四 19:30"), which cannot be turned back into
// an instant — it has no year. Nothing displays either, so they are out of
// scope for parity. deadline is NOT here: the vote screen reads it.
const IGNORED_FIELDS = new Set([
  "updateAt", "updatedAt", "confirmedAt", "checkedAt",
  "practiceTime", "serviceTime", "openedAt",
]);
const PLACEHOLDER = "—";

// The instruments both sides express the same way. 練前預備 is a team position
// the sheet never listed, and PPT is a position in the church record but a
// separate flag in the sheet — it is compared through canPPT instead. Both are
// left out of the instrument diff rather than reported as differences.
const SHARED_INSTRUMENTS = new Set(["主領", "配唱", "鼓", "鋼琴", "Keyboard", "吉他", "BASS"]);

// Fields of a member that drive scheduling. Email, id and instruments outside
// the shared vocabulary are known to differ by design.
const ROSTER_FIELDS = ["name", "role", "constraints", "canPPT"];

/** Collapses representation differences so only real differences survive. */
export function normalize(value, translate = (v) => v) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const items = value
      .map(v => normalize(v, translate))
      .filter(v => !isPlaceholderRow(v));
    // Order is not part of the contract; compare as a set.
    return items.map(v => JSON.stringify(v)).sort().map(s => JSON.parse(s));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (IGNORED_FIELDS.has(k)) continue;
      const nv = normalize(v, translate);
      if (nv === null) continue; // absent, null and empty string are the same thing
      out[translate(k)] = nv;
    }
    return out;
  }
  if (typeof value === "boolean" || typeof value === "number") return value;
  const s = String(value).trim();
  if (s === "") return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return translate(s);
}

// A schedule row naming the dash records the absence of an assignment, which the
// database expresses by having no row at all.
const isPlaceholderRow = v =>
  v !== null && typeof v === "object" && !Array.isArray(v) && v.memberName === PLACEHOLDER && !v.memberId;

const short = v => {
  const s = JSON.stringify(v);
  return s === undefined ? "(absent)" : s.length > 70 ? s.slice(0, 67) + "…" : s;
};

function diff(a, b, path = "") {
  const out = [];
  if (JSON.stringify(a) === JSON.stringify(b)) return out;

  if (Array.isArray(a) && Array.isArray(b)) {
    // Both sides are already normalized and sorted, so compare element by
    // element and report only the entries that differ.
    const n = Math.max(a.length, b.length);
    if (a.length !== b.length) out.push(`${path || "(root)"}: sheet has ${a.length} items, worker has ${b.length}`);
    for (let i = 0; i < n; i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }

  const bothObjects = a && b && typeof a === "object" && typeof b === "object";
  if (bothObjects) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diff(a[k], b[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  out.push(`${path || "(root)"}: sheet=${short(a)} worker=${short(b)}`);
  return out;
}

// ── self test ───────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const sheetSide = {
    songs: [{ weekId: "2026-05-02", slot: "2", name: "b", confirmed: "FALSE", youtube: "" },
            { weekId: "2026-05-02", slot: "1", name: "a", confirmed: "TRUE", youtube: "u" }],
    schedule: [{ role: "鼓", memberId: "amy@example.com", memberName: "Amy", updateAt: "2026/4/29 下午 4:42:46" },
               { role: "BASS", memberId: "", memberName: "—" }],
  };
  const workerSide = {
    songs: [{ weekId: "2026-05-02", slot: 1, name: "a", confirmed: true, youtube: "u" },
            { weekId: "2026-05-02", slot: 2, name: "b", confirmed: false, youtube: null }],
    schedule: [{ role: "鼓", memberId: "p-amy", memberName: "Amy" }],
  };
  const translate = v => (v === "amy@example.com" ? "p-amy" : v);
  const differences = diff(normalize(sheetSide, translate), normalize(workerSide));
  console.log("self test — payloads differing only in representation:");
  console.log(differences.length ? "  FAIL\n  " + differences.join("\n  ") : "  PASS (no differences after normalization)");

  const real = diff(normalize({ a: "x" }), normalize({ a: "y" }));
  console.log("self test — a genuine difference is still reported:", real.length ? "PASS " + real[0] : "FAIL");
  process.exit(differences.length || !real.length ? 1 : 0);
}

// ── live comparison ─────────────────────────────────────────────────────────
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter(Boolean)
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const WORKER = arg("--worker", "http://127.0.0.1:8787");
const mapping = JSON.parse(fs.readFileSync(arg("--mapping", "migration/person-mapping.json"), "utf8")).members;

const toPerson = new Map(Object.entries(mapping).map(([email, e]) => [email, e.personId]));
// The import renames the legacy role the same way, so the sheet side is mapped
// through it too — otherwise every week that used 弦樂 reads as a difference.
const LEGACY_ROLES = { "弦樂": "Keyboard" };
const translate = v => toPerson.get(v) ?? LEGACY_ROLES[v] ?? v;

// Apps Script occasionally answers with an HTML interstitial instead of JSON.
// That is a transport failure, not a payload difference, so it is retried and
// then reported as such rather than crashing the run.
const callJson = async (url, attempts = 3) => {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(url, { redirect: "follow" });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (i === attempts) return { ok: false, error: `non-JSON response (HTTP ${res.status})` };
      await new Promise(r => setTimeout(r, 500 * i));
    }
  }
};

const callSheet = (action, params) =>
  callJson(`${env.VITE_GAS_URL}?${new URLSearchParams({ action, secret: env.VITE_APP_SECRET, ...params })}`);
const callWorker = (action, params) =>
  callJson(`${WORKER}/?${new URLSearchParams({ action, secret: env.VITE_APP_SECRET, ...params })}`);

// A member present on both sides, for the actions that take one.
const sampleEmail = Object.keys(mapping)[0];
const samplePerson = mapping[sampleEmail].personId;
const WEEK = "2026-05-02";
const MONTH = "2026-05";
const MONTHS = "10,11";

const CASES = [
  { action: "getWeeks" },
  { action: "getWeeksByMonths", params: { months: MONTHS } },
  {
    action: "getVoteSettings",
    // A months cell holding the literal string "undefined" read back as [NaN]
    // from the sheet, which serializes as [null]; the database stores an empty
    // list. Documented in design.md as a known difference.
    expected: d => /^\[\d+\]\.months/.test(d),
  },
  { action: "getVoteSummary", params: { months: MONTHS } },
  { action: "getVotes", params: { weekId: WEEK } },
  { action: "getVotesByMember", sheet: { memberId: sampleEmail, months: MONTHS }, worker: { memberId: samplePerson, months: MONTHS } },
  { action: "getSchedule", params: { weekId: WEEK } },
  { action: "getMySchedule", sheet: { memberId: sampleEmail }, worker: { memberId: samplePerson } },
  { action: "getPrePracticeHistory" },
  { action: "getSongs", params: { weekId: WEEK } },
  { action: "getSongsForMonth", params: { month: MONTH } },
  { action: "getSpeakersForMonth", params: { month: MONTH } },
  { action: "getMembers", roster: true },
  { action: "getInitialData", sheet: { memberId: sampleEmail }, worker: { memberId: samplePerson }, roster: "members" },
];

const rosterDiff = (sheetMembers, workerMembers) => {
  const bySheet = new Map((sheetMembers ?? []).map(m => [translate(m.id), m]));
  const byWorker = new Map((workerMembers ?? []).map(m => [m.id, m]));
  const problems = [], gained = [], onlySheet = [], onlyWorker = [];
  for (const [id, s] of bySheet) {
    const w = byWorker.get(id);
    if (!w) { onlySheet.push(s.name); continue; }
    for (const f of ROSTER_FIELDS) {
      const a = normalize(s[f]), b = normalize(w[f]);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      // Gaining PPT eligibility cannot invalidate an existing schedule; losing
      // it can, so only the loss is a blocker.
      if (f === "canPPT" && a === false && b === true) gained.push(`${s.name}: +PPT`);
      else problems.push(`${s.name}.${f}: sheet=${JSON.stringify(a)} worker=${JSON.stringify(b)}`);
    }
    const shared = xs => (xs ?? []).filter(i => SHARED_INSTRUMENTS.has(i)).sort();
    const si = shared(s.instruments), wi = shared(w.instruments);
    const lost = si.filter(i => !wi.includes(i));
    const extra = wi.filter(i => !si.includes(i));
    // The sheet is being retired, so the church record is allowed to know more
    // than it did. It may not know less: a member who loses an instrument loses
    // the ability to be scheduled on it.
    if (lost.length) problems.push(`${s.name}.instruments: no longer plays ${lost.join(", ")} (sheet=${JSON.stringify(si)} worker=${JSON.stringify(wi)})`);
    if (extra.length) gained.push(`${s.name}: +${extra.join(", ")}`);
  }
  for (const [id, w] of byWorker) if (!bySheet.has(id)) onlyWorker.push(w.name);
  return { problems, gained, onlySheet, onlyWorker };
};

let failures = 0;
for (const c of CASES) {
  const sheetRes = await callSheet(c.action, c.sheet ?? c.params ?? {});
  const workerRes = await callWorker(c.action, c.worker ?? c.params ?? {});

  if (!sheetRes.ok || !workerRes.ok) {
    failures++;
    console.log(`DIFF  ${c.action}`);
    if (!sheetRes.ok) console.log(`        sheet:  ${sheetRes.error}`);
    if (!workerRes.ok) console.log(`        worker: ${workerRes.error}`);
    continue;
  }

  if (c.roster) {
    const pick = d => (c.roster === "members" ? d.members : d);
    const { problems, gained, onlySheet, onlyWorker } = rosterDiff(pick(sheetRes.data), pick(workerRes.data));
    const note = [
      onlySheet.length ? `only in sheet: ${onlySheet.join(", ")}` : null,
      onlyWorker.length ? `only in 敬拜部: ${onlyWorker.join(", ")}` : null,
      gained.length ? `gained in 敬拜部: ${gained.join("; ")}` : null,
    ].filter(Boolean).join(" | ");
    if (problems.length) {
      failures++;
      console.log(`DIFF  ${c.action} (roster)`);
      problems.forEach(p => console.log(`        ${p}`));
    } else {
      console.log(`OK    ${c.action} (roster)`);
    }
    if (note) console.log(`        note: ${note}`);
    continue;
  }

  const all = diff(normalize(sheetRes.data, translate), normalize(workerRes.data));
  const known = c.expected ? all.filter(c.expected) : [];
  const differences = c.expected ? all.filter(d => !c.expected(d)) : all;
  if (differences.length) {
    failures++;
    console.log(`DIFF  ${c.action}`);
    differences.slice(0, 6).forEach(d => console.log(`        ${d}`));
    if (differences.length > 6) console.log(`        … and ${differences.length - 6} more`);
  } else {
    console.log(`OK    ${c.action}`);
  }
  if (known.length) console.log(`        note: ${known.length} known difference(s), e.g. ${known[0]}`);
}

console.log(`\n${CASES.length - failures}/${CASES.length} actions at parity`);
process.exit(failures ? 1 : 0);
