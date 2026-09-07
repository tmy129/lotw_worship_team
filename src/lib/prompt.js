// The scheduling prompt and the vocabulary it is built from.
//
// Kept out of the component tree so the prompt can be built — and measured —
// without a browser: scripts/prompt-budget.mjs imports this module to check the
// prompt against the model's per-minute token budget.

export const INSTRUMENTS = ["主領","配唱","鼓","鋼琴","Keyboard","吉他","BASS","PPT"];
// PPT is a service role (not an instrument skill) — any available unscheduled member can fill it
export const SKILL_INSTRUMENTS = INSTRUMENTS.filter(r => r !== "PPT");

/**
 * Roles every week needs someone in. This is scheduling policy, not a fact
 * about the roster, so it stays a constant.
 */
export const REQUIRED_ROLES = ["主領", "配唱", "鋼琴", "鼓"];

/**
 * Roles assigned by their own passes after the model answers — PPT by the
 * eligibility pass and 練前預備 by the pre-practice pass — so neither is
 * offered to the model as something to fill.
 */
export const SERVICE_ROLES = ["PPT", "練前預備"];

const instrumentsOf = member =>
  (Array.isArray(member.instruments) ? member.instruments : String(member.instruments).split(","))
    .map(i => i.trim())
    .filter(Boolean);

/**
 * What this roster can actually be scheduled on.
 *
 * Derived rather than hard-coded: the church record owns the worship team's
 * positions, so adding one there makes it schedulable without a release. Order
 * is stable — required roles first in policy order, then everything else in the
 * order the roster mentions it.
 */
export function scheduleRoles(members) {
  const held = new Set();
  for (const m of members) for (const i of instrumentsOf(m)) held.add(i);
  for (const r of SERVICE_ROLES) held.delete(r);
  const required = REQUIRED_ROLES.filter(r => held.has(r));
  const optional = [...held].filter(r => !REQUIRED_ROLES.includes(r));
  return { required, optional, all: [...required, ...optional] };
}

// Case-insensitive check: does this member's instruments list include a given role?
export function memberPlays(member, role) {
  const list = Array.isArray(member.instruments)
    ? member.instruments
    : String(member.instruments).split(",");
  const roleLower = role.trim().toLowerCase();
  return list.some(i => i.trim().toLowerCase() === roleLower);
}

export function fillBatchPrompt(weekRows, note) {
  const roles = scheduleRoles(weekRows.flatMap(r => r.avail));
  // ── Availability, stated once ──
  //
  // The weeks are numbered here and referred to by index below, so a member's
  // instruments and constraint appear on one line however many weeks they are
  // free. The previous shape said the same thing twice — an aligned grid of
  // ✓/✗ per role, then the same people listed again under every week — and
  // two thirds of that was column padding for a reader who does not exist.
  const weekLegend = weekRows.map(({ week }, i) => `${i + 1}=${week.label}`).join(" ");

  const byMember = new Map();
  weekRows.forEach(({ avail }, wi) => {
    avail.forEach(m => {
      if (!byMember.has(m.id)) byMember.set(m.id, { member: m, weeks: [] });
      byMember.get(m.id).weeks.push(wi + 1);
    });
  });

  // Availability is listed by week rather than by member, because that is the
  // question being asked — "who can serve in week 4" — and a model that has to
  // resolve "available in 1,3,5" into a week's roster gets it wrong: measured
  // over four runs of the index form, three assigned someone who was not free
  // that week. Instruments stay on the member, so neither fact repeats.
  const availability = weekRows
    .map(({ week, avail }, i) => `${i + 1}: ${avail.map(m => m.name).join(",") || "（無人）"}`)
    .join("\n");

  const skills = [...byMember.values()].map(({ member }) => {
    const instruments = instrumentsOf(member).filter(i => roles.all.includes(i)).join("、");
    const constraint = member.constraints && member.constraints !== "無特殊限制"
      ? ` ⚠${member.constraints}`
      : "";
    return `${member.name}：${instruments}${constraint}`;
  }).join("\n");

  const emptyWeeks = weekRows
    .map(({ avail }, i) => (avail.length ? null : i + 1))
    .filter(Boolean);

  return `你是教會敬拜團排班AI，請一次規劃以下 ${weekRows.length} 週的完整排班。

【週次編號】${weekLegend}
${note ? `【備注】${note}\n` : ""}${emptyWeeks.length ? `【無人可出席的週次】${emptyWeeks.join(",")}\n` : ""}
【各週可出席者】每列是「週次編號: 該週可出席的人」，只能從該週的名單中挑人
${availability}

【團員會的樂器】⚠ 為排班限制
${skills}

【必要角色】${roles.required.join("、")}
【選填角色】${roles.optional.join("、") || "（無）"} — 若該週可出席名單中有人會該樂器，務必安排；沒有才填「—」

規則（依此順序分配，越前面越難調度）：
1. 先排鋼琴與鼓 —— 會的人最少。某週某樂器只有一人可出席時，先鎖定他。
2. 再排主領、配唱（可 1～2 人），最後排選填角色；沒人會就填「—」。

絕對不可違反：
- 只能從該週「各週可出席者」名單裡挑人。名單上沒有的人，該週一律不可安排，即使他會該樂器。
- 每人同一週只擔任一個角色。
- ⚠ 標記的限制一律遵守。

盡量做到（與上面的硬性規定衝突時，以硬性規定為優先）：
- 同月份同一人：鋼琴至多 2 次（五週的月份 3 次）、主領至多 1 次（五週的月份 2 次）。
- 主領不可與上一週相同，跨月也算。
- 同一人不可連續出現三週；近期常出現的人優先休息。

請為上列 ${weekRows.length} 週各回覆一筆安排，日期使用【週次編號】中的完整日期。`;
}

/**
 * What a plan request needs beyond the prompt: which weeks must come back, and
 * which roles may appear. The proxy turns these into the response schema, so
 * the shape is enforced by the API rather than described in prose and hoped for.
 */
export function batchRequest(weekRows, note) {
  const roles = scheduleRoles(weekRows.flatMap(r => r.avail));
  return {
    prompt: fillBatchPrompt(weekRows, note),
    weeks: weekRows.map(r => r.week.id),
    roles: roles.all,
  };
}

// ── Token budget ────────────────────────────────────────────────────────────
//
// Groq counts the prompt and the reserved completion together against the
// per-minute limit, so the output budget has to be derived from the prompt
// rather than fixed. These are the numbers the Worker's AI proxy uses; keeping
// them here lets scripts/prompt-budget.mjs measure the same thing the runtime
// will do, instead of an approximation of it.

/** Measured on this app's Chinese-heavy prompts. */
export const CHARS_PER_TOKEN = 1.6;
/** Slack left for the request envelope itself. */
export const RESERVE_TOKENS = 200;
export const DEFAULT_TPM_BUDGET = 8000;
export const MIN_OUTPUT_TOKENS = 1024;
export const MAX_OUTPUT_TOKENS = 8192;

export const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * What an answer costs: the plan itself plus the model's reasoning. Measured on
 * a real nine-week run, whose visible answer was about 1580 tokens before any
 * reasoning; 2000 is that rounded up with room for the reasoning to breathe.
 */
export const OUTPUT_NEEDED_TOKENS = 2000;

/**
 * What to reserve per attempt. An answer uses about 1500 tokens, and the
 * per-minute budget has to hold two attempts: the first, and a correction that
 * also carries the answer being corrected. At 2000 the pair costs about 7300 of
 * 8000, which fits; at 2500 it does not.
 */
export const RESERVE_FOR_ANSWER = 2000;

/**
 * What the proxy will reserve for the answer to a prompt of this length, and
 * how much of that reservation is spare.
 *
 * Prompt and reservation always sum to the budget — the reservation is defined
 * as the remainder — so the number that means anything is the slack above what
 * an answer actually needs.
 */
export function completionBudget(promptText, tpmBudget = DEFAULT_TPM_BUDGET) {
  const prompt = estimateTokens(promptText);
  const available = tpmBudget - prompt - RESERVE_TOKENS;
  // Reserve what an answer needs with margin, not everything left over. Taking
  // the remainder would spend the whole per-minute budget on one call and leave
  // nothing for the repair attempt that usually follows.
  const output = Math.max(MIN_OUTPUT_TOKENS, Math.min(RESERVE_FOR_ANSWER, available));
  return { prompt, output, spare: available - output };
}

// ── Reading a plan back ─────────────────────────────────────────────────────

/** 主領 and 配唱 seat two people; every other role seats one. */
export const TWO_SEAT_ROLES = ["主領", "配唱"];

/** How many times to ask before giving up. See requestPlan for why it is two. */
export const PLAN_ATTEMPTS = 2;
const seatsFor = role => (TWO_SEAT_ROLES.includes(role) ? 2 : 1);

/**
 * Turns the model's answer into assignments, or explains why it cannot.
 *
 * The answer is schema-valid by the time it arrives, which settles its shape but
 * says nothing about whether it is a usable plan: the schema cannot know who was
 * available in which week. Everything that could still be wrong is checked here,
 * and anything wrong rejects the whole plan — a schedule that is right for six
 * weeks out of nine is not a schedule, and the previous text parsers quietly
 * returned exactly that when an answer was cut short.
 *
 * Multi-person roles collapse into one assignment carrying both names, which is
 * the shape the rotation passes and the schedule grid have always consumed.
 */
export class PlanRejected extends Error {
  constructor(problems) {
    super(problems.join("；"));
    this.name = "PlanRejected";
    /** Every fault found, so the planner can fix them all in one correction. */
    this.problems = problems;
  }
}

export function parsePlan(text, weekRows, roles) {
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new PlanRejected([`回應不是合法 JSON：${String(text).slice(0, 200)}`]);
  }
  if (!Array.isArray(plan?.weeks)) throw new PlanRejected(["回應缺少 weeks 清單"]);

  const wanted = new Map(weekRows.map(r => [r.week.id, r]));
  const seen = new Set();
  const problems = [];
  const results = [];

  for (const entry of plan.weeks) {
    const row = wanted.get(entry.date);
    if (!row) { problems.push(`回覆了未要求的週次 ${entry.date}`); continue; }
    if (seen.has(entry.date)) { problems.push(`${entry.date}：同一週出現兩次`); continue; }
    seen.add(entry.date);

    const byName = new Map(row.avail.map(m => [m.name, m]));
    const assignments = [];
    for (const a of entry.assignments ?? []) {
      if (!roles.includes(a.role)) { problems.push(`${entry.date}：角色「${a.role}」不在可排班清單中`); continue; }
      const names = (a.members ?? []).filter(n => n && n !== "—");
      if (!names.length) continue;
      if (names.length > seatsFor(a.role)) {
        problems.push(`${entry.date}：${a.role} 安排了 ${names.length} 人，上限 ${seatsFor(a.role)} 人（${names.join("、")}）`);
        continue;
      }
      const members = names.map(name => byName.get(name) ?? name);
      const unknown = members.filter(m => typeof m === "string");
      if (unknown.length) {
        problems.push(`${entry.date}：${a.role} 的「${unknown.join("、")}」不在該週可出席名單中`);
        continue;
      }
      assignments.push({
        role: a.role,
        memberName: members.map(m => m.name).join("、"),
        memberId: members[0].id,
      });
    }
    results.push({ week: row.week, assignments });
  }

  const missing = weekRows.filter(r => !seen.has(r.week.id)).map(r => r.week.id);
  if (missing.length) problems.push(`未回覆這些週次：${missing.join("、")}`);
  if (problems.length) throw new PlanRejected(problems);
  return results;
}

/**
 * Asks for a plan, and asks again with the faults when one comes back unusable.
 *
 * A single attempt usually fails — measured at roughly one clean answer in
 * four — so the faults, which name the week, the role and the person, go back
 * as a correction request rather than to the leader. `send` performs one call
 * and returns the model's text.
 *
 * Two attempts, not more: the free tier's per-minute token budget holds the
 * first call and one correction, and a third would be rejected by the rate
 * limit rather than answered.
 */
async function planMonth({ weekRows, note, send, attempts, label }) {
  const request = batchRequest(weekRows, note);
  let problems = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const text = await send(problems ? { ...request, problems } : request);
    try {
      return parsePlan(text, weekRows, request.roles);
    } catch (e) {
      if (!(e instanceof PlanRejected)) throw e;
      problems = e.problems;
      if (attempt === attempts) {
        throw new Error(`${label} 嘗試 ${attempts} 次仍未產生可用的排班：${e.problems.join("；")}`);
      }
    }
  }
}

/**
 * Plans a period, one calendar month per request.
 *
 * A whole period asked for at once is the hardest version of the problem and
 * the most expensive answer; a month is small enough to get right and carries
 * a complete monthly cap rather than a fragment of one. Rules that span a
 * boundary are left to the enforcement passes, which decide them anyway.
 */
export async function requestPlan({ weekRows, note, send, attempts = PLAN_ATTEMPTS }) {
  const months = new Map();
  for (const row of weekRows) {
    const month = String(row.week.id).slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(row);
  }

  const plan = [];
  for (const [month, rows] of months) {
    plan.push(...await planMonth({ weekRows: rows, note, send, attempts, label: month }));
  }
  // Back into the order the caller asked for, whatever order the months ran in.
  const order = new Map(weekRows.map((r, i) => [r.week.id, i]));
  return plan.sort((a, b) => order.get(a.week.id) - order.get(b.week.id));
}
