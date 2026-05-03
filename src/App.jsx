import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz1srZBEmJIzJmZ6bUfjUg1MfGubFwtmEw0fBd2R_Xbx0rd7DLFUtVlZ2ug3RL3IRWVAw/exec";

const LINE_CHANNEL_ID   = "2009964527"; // 填入你的 LINE Channel ID
const LINE_REDIRECT_URI = "https://tmy129.github.io/lotw_worship_team/";

function generateVerifier() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function generateChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function startLineLogin() {
  const verifier  = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state     = generateVerifier().slice(0, 16);
  sessionStorage.setItem('line_verifier', verifier);
  sessionStorage.setItem('line_state',    state);
  const qs = new URLSearchParams({
    response_type: 'code', client_id: LINE_CHANNEL_ID,
    redirect_uri: LINE_REDIRECT_URI, state,
    scope: 'profile openid',
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  window.location.href = `https://access.line.me/oauth2/v2.1/authorize?${qs}`;
}

async function api(action, params = {}, body = null) {
  if (body !== null) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.data;
  } else {
    const qs = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.data;
  }
}

const MONTH_NAMES = ['','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const ROLES_MAP = {
  admin:  { label:"管理員", cls:"rp-admin" },
  leader: { label:"團長",   cls:"rp-leader" },
  member: { label:"團員",   cls:"rp-member" },
};

const INSTRUMENTS = ["主領","配唱","鼓","鋼琴","Keyboard","吉他","BASS","PPT"];
// PPT is a service role (not an instrument skill) — any available unscheduled member can fill it
const SKILL_INSTRUMENTS = INSTRUMENTS.filter(r => r !== "PPT");

// Case-insensitive check: does this member's instruments list include a given role?
function memberPlays(member, role) {
  const list = Array.isArray(member.instruments)
    ? member.instruments
    : String(member.instruments).split(",");
  const roleLower = role.trim().toLowerCase();
  return list.some(i => i.trim().toLowerCase() === roleLower);
}

const NAVS = {
  admin: [
    { id:"mySchedule", label:"我的班表", icon:"👤" },
    { id:"songs",      label:"選歌",    icon:"🎵" },
    { id:"vote",       label:"投票",    icon:"🗳" },
    { id:"voteAdmin",  label:"投票管理", icon:"📊" },
    { id:"schedule",   label:"排班",    icon:"📅" },
    { id:"members",    label:"團員",    icon:"👥" },
  ],
  leader: [
    { id:"mySchedule", label:"我的班表", icon:"👤" },
    { id:"songs",      label:"選歌",    icon:"🎵" },
    { id:"vote",       label:"投票",    icon:"🗳" },
    { id:"voteAdmin",  label:"投票管理", icon:"📊" },
    { id:"schedule",   label:"排班",    icon:"📅" },
  ],
  member: [
    { id:"mySchedule", label:"我的班表", icon:"👤" },
    { id:"vote",       label:"投票",    icon:"🗳" },
  ],
};

const DEFAULT_PROMPT_TEMPLATE =
`你是教會敬拜團排班AI，請根據以下資訊安排本週服事人員。

【本週】{weekLabel}

【可出席團員】（格式：姓名（樂器）限制：… 意願：yes/maybe）
{members}

【必要角色】主領、配唱、鋼琴、鼓
【選填角色】Keyboard、吉他、BASS — 若可出席名單中有人會該樂器，務必安排；沒有才填「—」
{prevSchedules}
請依序執行以下步驟再回覆：

步驟1｜掃描樂器
逐一看每位團員括號內的樂器，列出誰能主領、誰打鼓、誰彈鋼琴，並記下每人的「限制」欄位。

步驟2｜檢查限制
若團員有「限制」欄位，嚴格遵守（例：只能配唱、不可主領、當日有事只能某時段等），違反限制的安排一律不採用。

步驟3｜分配角色（請依以下順序進行）
① 先分配「鋼琴」：鋼琴手人數最少，最難調度，優先確保輪替平衡後再進行其他角色
② 再分配「鼓」
③ 再分配「主領」
④ 最後分配「配唱」（可 1～2 人）、Keyboard、吉他、BASS（有人會才填，否則填「—」）
- 每人同一週只能擔任一個角色，不可重複出現
- 主領、配唱、鋼琴、鼓 必須各安排一人，除非整個名單中真的找不到會該樂器的人才填「—」

步驟4｜平衡輪替（根據【近期排班】與【各人出席次數統計】）
- 【鋼琴輪替】同一人同月份擔任「鋼琴」不可超過 2 次；若該月有五週則不超過 3 次。先看統計表，若某人本月鋼琴已達上限，換另一位鋼琴手
- 【主領上限】同一人同月份擔任「主領」不可超過 1 次；若該月有五週則不超過 2 次
- 【主領禁止連週】主領不可與上一週相同，包含跨月（例：六月最後一週與七月第一週不可是同一人主領）
- 同一人不可連續出現三週（任何角色）；若某月有五週則該月同一人不超過 3 次
- 近期頻繁出現的人優先休息

步驟5｜自我檢查
回覆前確認：① 必要角色皆已填人 ② 無重複姓名 ③ 無違反限制 ④ 主領未超過月份上限

只從【可出席團員】中選人，不可捏造名字。

請用以下格式回覆（不要多餘文字，冒號後直接填姓名）：
REASON:40字內說明本週排班考量與輪替邏輯
主領:姓名
配唱:姓名
鼓:姓名
鋼琴:姓名
Keyboard:姓名
吉他:姓名
BASS:姓名`;

const PROMPT_STORAGE_KEY = "lotw_prompt_template";

function loadPromptTemplate() {
  try { return localStorage.getItem(PROMPT_STORAGE_KEY) || DEFAULT_PROMPT_TEMPLATE; } catch { return DEFAULT_PROMPT_TEMPLATE; }
}
function savePromptTemplate(t) {
  try { localStorage.setItem(PROMPT_STORAGE_KEY, t); } catch {}
}

function fillPrompt(template, { week, availableMembers, voteMap, requiredRoles, minPeople, maxPeople, note, previousSchedules = [] }) {
  const memberLines = availableMembers.map(m => {
    const instruments = (Array.isArray(m.instruments) ? m.instruments : m.instruments.split(",")).join("、");
    const vote = voteMap[String(m.id).trim()] || "可以";
    const constraint = m.constraints && m.constraints !== "無特殊限制" ? `，限制：${m.constraints}` : "";
    return `- ${m.name}（${instruments}）${constraint}，意願：${vote}`;
  }).join("\n");

  let prevNote = "";
  if (previousSchedules.length) {
    // Full schedule log
    const log = previousSchedules.map(p =>
      `  ${p.weekLabel}：${p.assignments.filter(a => a.memberName && a.memberName !== "—").map(a => `${a.role}=${a.memberName}`).join("、")}`
    ).join("\n");

    // Per-person monthly count summary
    const monthCount = {}; // "name|yyyy-mm" -> count
    const totalCount = {}; // name -> total appearances
    previousSchedules.forEach(p => {
      const monthKey = p.weekLabel?.match(/^(\d{4}-\d{2})-\d{2}/)?.[1]
                    || p.weekLabel?.match(/(\d{4}\/\d+)\//)?.[1]
                    || p.weekLabel;
      p.assignments.forEach(a => {
        if (!a.memberName || a.memberName === "—") return;
        const names = a.memberName.split("、");
        names.forEach(name => {
          const mk = `${name}|${monthKey}`;
          monthCount[mk] = (monthCount[mk] || 0) + 1;
          totalCount[name] = (totalCount[name] || 0) + 1;
        });
      });
    });

    // Build summary: only show people who appeared ≥1 time
    const summary = Object.entries(totalCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => {
        const monthBreakdown = Object.entries(monthCount)
          .filter(([k]) => k.startsWith(name + "|"))
          .map(([k, c]) => { const mk = k.split("|")[1]; const mo = mk.match(/-(\d+)$/)?.[1] || mk.match(/\/(\d+)$/)?.[1] || mk; return `${+mo}月×${c}`; })
          .join("、");
        return `  ${name}：共${total}週（${monthBreakdown}）`;
      }).join("\n");

    prevNote = `【近期排班記錄】\n${log}\n\n【各人出席次數統計（供輪替參考）】\n${summary}`;
  }

  return template
    .replace(/{weekLabel}/g,     week.label)
    .replace(/{members}/g,       memberLines)
    .replace(/{roles}/g,         (requiredRoles || []).join("、"))
    .replace(/{minPeople}/g,     String(minPeople || ""))
    .replace(/{maxPeople}/g,     String(maxPeople || ""))
    .replace(/{note}/g,          note || "無")
    .replace(/{prevSchedules}/g, prevNote);
}

function fillBatchPrompt(weekRows, note) {
  // ── Per-week available member list ──
  const weekBlocks = weekRows.map(({ week, avail }) => {
    const lines = avail.map(m => {
      const instruments = (Array.isArray(m.instruments) ? m.instruments : m.instruments.split(",")).join("、");
      const constraint = m.constraints && m.constraints !== "無特殊限制" ? `  ⚠限制：${m.constraints}` : "";
      return `  - ${m.name}（${instruments}）${constraint}`;
    }).join("\n");
    return `▶ ${week.label}\n${lines || "  （無人可出席）"}`;
  }).join("\n\n");

  // ── Instrument availability grid ──
  // For every role, show who can play it and which weeks they're available.
  // This lets the AI immediately see patterns like "Tammy only available weeks 1-2 for piano".
  const colHeaders = weekRows.map(r => r.week.label.slice(5)); // "06-06"
  const colW = Math.max(...colHeaders.map(h => h.length)) + 2;
  const nameW = 10;

  const instrGrid = SKILL_INSTRUMENTS.map(role => {
    const playerMap = {}; // id -> { name, avail: [bool] }
    weekRows.forEach(({ avail }, wi) => {
      avail.forEach(m => {
        if (!memberPlays(m, role)) return;
        if (!playerMap[m.id]) playerMap[m.id] = { name: m.name, avail: new Array(weekRows.length).fill(false) };
        playerMap[m.id].avail[wi] = true;
      });
    });
    const players = Object.values(playerMap);
    if (!players.length) return null;

    const header = `  ${" ".repeat(nameW)}${colHeaders.map(h => h.padEnd(colW)).join("")}`;
    const rows = players.map(p =>
      `  ${p.name.padEnd(nameW)}${p.avail.map(a => (a ? "✓" : "✗").padEnd(colW)).join("")}`
    );
    return `${role}：\n${header}\n${rows.join("\n")}`;
  }).filter(Boolean).join("\n\n");

  // ── PPT candidates per week ──
  const pptLines = weekRows.map(({ week, avail }) => {
    const eligible = avail.filter(m => m.canPPT);
    const names = eligible.length ? eligible.map(m => m.name).join("、") : "（無人設定可擔任 PPT）";
    return `  ${week.label}：${names}`;
  }).join("\n");

  const period = weekRows.map(r => r.week.label).join("、");

  return `你是教會敬拜團排班AI，請一次規劃以下 ${weekRows.length} 週的完整排班。

【排班期間】${period}
${note ? `【備注】${note}\n` : ""}【各樂器人員出席總覽】（✓可出席 ✗不可出席，排班前務必先看這裡！）
${instrGrid}

【PPT 候選人】（每週可選名單，從中選一位未擔任其他角色的人擔任 PPT）
${pptLines}

【各週完整可出席名單】
${weekBlocks}

【必要角色】主領、配唱、鋼琴、鼓
【選填角色】Keyboard、吉他、BASS — 若該週可出席名單中有人會該樂器，務必安排；沒有才填「—」

請依序執行以下步驟再回覆：

步驟1｜掃描「各樂器人員出席總覽」
逐一看每個樂器的格子，記下每位演奏者哪幾週有 ✓ 可出席。
特別留意：若某人某樂器只有部分週次 ✓，那幾週他就是唯一選擇，必須優先排定。

步驟2｜檢查限制
若團員有「⚠限制」欄位，嚴格遵守（例：只能配唱、不可主領、當日有事只能某時段等），違反限制的安排一律不採用。

步驟3｜分配角色（請依以下順序進行）
① 先分配「鋼琴」：鋼琴手人數最少，最難調度，優先確保輪替平衡後再進行其他角色
   → 對照總覽，某週若只有一人可彈鋼琴，先鎖定他/她；再把剩餘週次分給其他鋼琴手
② 再分配「鼓」：同理，找出只有一人可打鼓的週次優先鎖定
③ 再分配「主領」
④ 再分配「配唱」（可 1～2 人）
⑤ 再分配「Keyboard」「吉他」「BASS」（有人會才填，否則填「—」）
⑥ 最後從「PPT 候選人」中選一位當週尚未擔任其他角色的人擔任 PPT
- 每人同一週只能擔任一個角色，不可重複出現
- 主領、配唱、鋼琴、鼓 必須各安排一人，除非整個名單中真的找不到才填「—」

步驟4｜平衡輪替（嚴格執行，不可違反）
- 【鋼琴上限】同月份同一人擔任「鋼琴」不超過 2 次；若該月有五週則不超過 3 次
- 【主領上限】同月份同一人擔任「主領」不超過 1 次；若該月有五週則不超過 2 次
- 【主領禁止連週】主領不可與上一週相同，包含跨月（六月最後一週與七月第一週不可同一人）
- 同一人不可連續出現三週（任何角色）；若某月有五週則該月同一人不超過 3 次
- 近期頻繁出現的人優先休息

步驟5｜自我檢查
回覆前確認：
① 必要角色（主領、配唱、鋼琴、鼓）皆已填人
② 無重複姓名（同一週同一人只出現一次）
③ 無違反⚠限制
④ 主領、鋼琴未超過月份上限
⑤ PPT 是當週候選人之一且未擔任其他角色
⑥ 所有人名均來自該週的可出席名單，不捏造姓名

請嚴格按照以下格式回覆，每週用 == 日期 == 標記，每個角色獨立一行，不可合併在同一行：

${weekRows.map(r => `== ${r.week.label} ==
REASON:（說明本週排班考量）
主領:姓名
配唱:姓名
鼓:姓名
鋼琴:姓名
Keyboard:姓名或—
吉他:姓名或—
BASS:姓名或—
PPT:姓名`).join("\n\n")}`;
}

function parseBatchResponse(text, weekRows) {
  const dateKey = s => (s || "").replace(/[^0-9]/g, "");

  // ── Primary: == label == section format ──
  const sections = text.split(/==\s*(.+?)\s*==/);
  if (sections.length > 2) {
    const results = [];
    const used = new Set();
    for (let i = 1; i < sections.length; i += 2) {
      const label    = sections[i].trim();
      const body     = sections[i + 1] || "";
      const labelKey = dateKey(label);
      const row = weekRows.find(r =>
        !used.has(r.week.id) && (
          r.week.label === label || dateKey(r.week.label) === labelKey
        )
      );
      if (!row) continue;
      used.add(row.week.id);
      results.push({ week: row.week, assignments: parseScheduleText(body, row.avail) });
    }
    if (results.length > 0) return results;
  }

  // ── Fallback: date-per-line + inline roles format ──
  // e.g. "2026-06-06\n主領：Clare　配唱：Victoria　鼓：Jerry..."
  const results = [];
  const used = new Set();
  const allLines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < allLines.length; i++) {
    const row = weekRows.find(r =>
      !used.has(r.week.id) && dateKey(r.week.label) === dateKey(allLines[i])
    );
    if (!row) continue;

    // Collect lines until the next date marker
    const bodyLines = [];
    let j = i + 1;
    while (j < allLines.length && !weekRows.some(r => dateKey(r.week.label) === dateKey(allLines[j]))) {
      // Inline roles may be separated by ideographic space (　) or tab — expand to one-per-line
      allLines[j].split(/[　\t]/).forEach(seg => { if (seg.trim()) bodyLines.push(seg.trim()); });
      j++;
    }

    used.add(row.week.id);
    results.push({ week: row.week, assignments: parseScheduleText(bodyLines.join("\n"), row.avail) });
    i = j - 1;
  }

  return results;
}

// Enforce monthly caps that the AI often ignores:
//   鋼琴 ≤ 2/month (≤ 3 if 5-week month)
//   主領 ≤ 1/month (≤ 2 if 5-week month)
//
// Strategy: look at ALL weeks in a month together.
// For an over-scheduled person, only swap weeks where someone ELSE can cover.
// This naturally keeps them on weeks where they are the only option.
// (e.g. Jean stays on weeks 3&4 if Tammy can't attend those weeks)
function enforceMonthlyLimits(parsed, weekRows) {
  const ROLE_LIMITS = { "鋼琴": { base: 2, five: 3 }, "主領": { base: 1, five: 2 } };

  const weeksPerMonth = {};
  parsed.forEach(({ week }) => {
    const mo = week.label.substring(0, 7);
    weeksPerMonth[mo] = (weeksPerMonth[mo] || 0) + 1;
  });

  for (const [role, { base, five }] of Object.entries(ROLE_LIMITS)) {
    // Group parsed indices by month
    const byMonth = {};
    parsed.forEach((r, idx) => {
      const mo = r.week.label.substring(0, 7);
      (byMonth[mo] = byMonth[mo] || []).push(idx);
    });

    for (const [mo, indices] of Object.entries(byMonth)) {
      const max = (weeksPerMonth[mo] || 0) >= 5 ? five : base;

      // Count how many times each member is assigned this role this month
      const memberCount = {};
      indices.forEach(idx => {
        const a = parsed[idx].assignments.find(x => x.role === role);
        if (a?.memberId && a.memberName !== "—")
          memberCount[a.memberId] = (memberCount[a.memberId] || 0) + 1;
      });

      // Fix each over-scheduled member
      for (const [overId, count] of Object.entries(memberCount)) {
        if (count <= max) continue;
        let excess = count - max;

        // Find the weeks this person is assigned AND an alternative can cover
        // (weeks without alternatives are kept — the person is irreplaceable there)
        const swappable = indices
          .filter(idx => parsed[idx].assignments.find(x => x.role === role)?.memberId === overId)
          .map(idx => {
            const weekRow = weekRows.find(r => r.week.id === parsed[idx].week.id);
            const otherIds = new Set(
              parsed[idx].assignments.filter(x => x.memberId && x.role !== role).map(x => x.memberId)
            );
            const alt = weekRow?.avail.find(m => {
              if (m.id === overId) return false;
              if (otherIds.has(m.id)) return false;
              if (!memberPlays(m, role)) return false;
              return (memberCount[m.id] || 0) < max; // alt also under cap
            });
            return alt ? { idx, alt } : null;
          })
          .filter(Boolean);

        // Swap earliest swappable weeks first (up to excess)
        for (const { idx, alt } of swappable) {
          if (excess <= 0) break;
          const aIdx = parsed[idx].assignments.findIndex(x => x.role === role);
          parsed[idx].assignments[aIdx] = { role, memberName: alt.name, memberId: alt.id };
          memberCount[alt.id] = (memberCount[alt.id] || 0) + 1;
          memberCount[overId]--;
          excess--;
        }
      }
    }
  }
  return parsed;
}

// Enforce consecutive-week cap: no member may appear in 3+ consecutive scheduled weeks.
// Strategy: when a streak of 3 is detected, try swapping the LAST week in the streak first
// (and the first week as fallback) to the next available qualified member.
// If no alternative exists for any week in the streak (e.g. Jerry is the only drummer),
// the streak is left intact — we can't create someone out of thin air.
function enforceConsecutive(parsed, weekRows) {
  if (!parsed || parsed.length < 3) return parsed;

  // Work on a sorted copy so consecutive pi-indices really mean consecutive Sundays.
  const sorted = [...parsed].sort((a, b) => a.week.id.localeCompare(b.week.id));
  // Deep-copy assignments so we don't mutate the input
  const result = sorted.map(item => ({
    ...item,
    assignments: item.assignments.map(a => ({ ...a })),
  }));

  // Repeat until stable (handles cascading fixes), max 10 passes
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;

    // Build per-member appearance list: memberId -> [{pi, role}]
    const memberSchedule = {};
    result.forEach((item, pi) => {
      item.assignments.forEach(a => {
        if (!a.memberId || !a.memberName || a.memberName === "—") return;
        if (!memberSchedule[a.memberId])
          memberSchedule[a.memberId] = { name: a.memberName, weeks: [] };
        memberSchedule[a.memberId].weeks.push({ pi, role: a.role });
      });
    });

    for (const [memberId, { weeks }] of Object.entries(memberSchedule)) {
      // Find the first run of 3 consecutive pi values
      let streakStart = -1;
      for (let i = 0; i <= weeks.length - 3; i++) {
        if (weeks[i + 1].pi === weeks[i].pi + 1 && weeks[i + 2].pi === weeks[i].pi + 2) {
          streakStart = i;
          break;
        }
      }
      if (streakStart === -1) continue;

      // Try swapping the LAST week of the streak, then the FIRST (middle is hardest to cover)
      const candidates = [weeks[streakStart + 2], weeks[streakStart]];
      let fixed = false;
      for (const sw of candidates) {
        const weekRow = weekRows.find(r => r.week.id === result[sw.pi].week.id);
        if (!weekRow) continue;

        const currentAssignments = result[sw.pi].assignments;
        const takenIds = new Set(currentAssignments.map(a => a.memberId).filter(Boolean));
        takenIds.delete(memberId); // the slot we're freeing up

        const alt = weekRow.avail.find(m =>
          m.id !== memberId &&
          !takenIds.has(m.id) &&
          memberPlays(m, sw.role)
        );

        if (alt) {
          result[sw.pi].assignments = [
            ...currentAssignments.filter(a => !(a.memberId === memberId && a.role === sw.role)),
            { role: sw.role, memberId: alt.id, memberName: alt.name },
          ];
          changed = true;
          fixed = true;
          break;
        }
      }
      if (fixed) break; // restart outer loop with fresh memberSchedule
    }

    if (!changed) break;
  }

  return result;
}

// Enforce PPT assignment: the assigned person must have canPPT=true and be in that week's avail.
// If not, find a valid replacement from canPPT members who aren't already assigned another role.
function enforcePPT(parsed, weekRows) {
  for (const { week, assignments } of parsed) {
    const pptIdx = assignments.findIndex(a => a.role === "PPT");
    if (pptIdx === -1) continue;

    const weekRow = weekRows.find(r => r.week.id === week.id);
    if (!weekRow) continue;

    const ppt = assignments[pptIdx];
    const isValid = ppt.memberName && ppt.memberName !== "—" && ppt.memberId &&
      weekRow.avail.some(m => m.id === ppt.memberId && m.canPPT);

    if (isValid) continue;

    // Invalid — find a replacement
    const assignedIds = new Set(
      assignments.filter(a => a.memberId && a.role !== "PPT").map(a => a.memberId)
    );
    const replacement = weekRow.avail.find(m => m.canPPT && !assignedIds.has(m.id));
    assignments[pptIdx] = replacement
      ? { role: "PPT", memberName: replacement.name, memberId: replacement.id }
      : { role: "PPT", memberName: "—", memberId: "" };
  }
  return parsed;
}

// Assign 練前讀經/敬拜 leader for each week.
// Picks the scheduled non-PPT member whose last pre-practice date is furthest in the past.
// history: { [memberId]: "yyyy-mm-dd" }  — missing/empty means never assigned (oldest possible).
function assignPrePractice(parsed, history) {
  for (const item of parsed) {
    const scheduled = item.assignments.filter(a =>
      a.memberId && a.memberName && a.memberName !== "—" &&
      a.role !== "PPT" && a.role !== "練前讀經"
    );
    if (!scheduled.length) continue;

    // String compare works: "0000-00-00" < "2026-03-30" — no date parsing needed
    const pick = scheduled.reduce((best, a) => {
      const d1 = history[best.memberId] || "0000-00-00";
      const d2 = history[a.memberId]    || "0000-00-00";
      return d2 < d1 ? a : best;
    });

    item.assignments = item.assignments.filter(a => a.role !== "練前讀經");
    item.assignments.push({ role: "練前讀經", memberId: pick.memberId, memberName: pick.memberName });
  }
  return parsed;
}

function parseScheduleText(text, availableMembers) {
  const lines = text.split("\n");
  const usedIds = new Set(); // deduplicate by member ID

  const resolveMember = raw =>
    availableMembers.find(m => raw.includes(m.name) || m.name.includes(raw));

  return INSTRUMENTS.map(role => {
    const line = lines.find(l => l.startsWith(role + ":") || l.startsWith(role + "："));
    let person = "—";
    if (line) {
      person = line.replace(/^[^:：]+[:：]/, "").trim()
        .replace(/^[（(]/, "").replace(/[）)]$/, "").trim();
    }
    if (!person || person === "—") return { role, memberName: "—", memberId: "" };

    // 配唱 can have two people
    if (role === "配唱") {
      const names = person.split(/[,，、／]/).map(n => n.trim()).filter(Boolean);
      const resolved = names
        .map(n => resolveMember(n))
        .filter(m => m && !usedIds.has(m.id));
      resolved.forEach(m => usedIds.add(m.id));
      if (!resolved.length) return { role, memberName: "—", memberId: "" };
      return { role, memberName: resolved.map(m => m.name).join("、"), memberId: resolved[0].id };
    }

    const member = resolveMember(person);
    if (!member) return { role, memberName: person, memberId: "" };
    if (usedIds.has(member.id)) return { role, memberName: "—", memberId: "" }; // duplicate — clear it
    usedIds.add(member.id);
    return { role, memberName: member.name, memberId: member.id };
  });
}

export default function App() {
  const [currentUser, setCurrentUser]   = useState(null);
  const [view, setView]                 = useState("mySchedule");
  const [members, setMembers]           = useState([]);
  const [weeks, setWeeks]               = useState([]);
  const [weekIdx, setWeekIdx]           = useState(0);
  const [voteSettings, setVoteSettings] = useState([]);
  const [schedule, setSchedule]         = useState([]);
  const [songs, setSongs]               = useState([]);
  const [loading, setLoading]           = useState(false);
  const [toast, setToast]               = useState(null);
  const [aiDraft, setAiDraft]           = useState(null); // { settingId, setting, results: [{week,assignments}] }
  const [linePending, setLinePending]   = useState(null); // { lineUserId, displayName, pictureUrl } — first-time bind
  const [lineLoading, setLineLoading]   = useState(false);

  const week = weeks[weekIdx];

  const showToast = useCallback((msg, type="success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Handle LINE OAuth callback
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const code    = params.get('code');
    const state   = params.get('state');
    if (!code) return;
    window.history.replaceState({}, '', window.location.pathname);
    const storedState = sessionStorage.getItem('line_state');
    const verifier    = sessionStorage.getItem('line_verifier');
    sessionStorage.removeItem('line_state');
    sessionStorage.removeItem('line_verifier');
    if (state !== storedState) { showToast('驗證失敗，請重試', 'error'); return; }
    setLineLoading(true);
    api("loginWithLine", { code, code_verifier: verifier, redirect_uri: LINE_REDIRECT_URI })
      .then(res => {
        if (res.member) { setCurrentUser(res.member); setView("mySchedule"); }
        else setLinePending({ lineUserId: res.lineUserId, displayName: res.displayName, pictureUrl: res.pictureUrl });
      })
      .catch(e => showToast('LINE 登入失敗：' + e.message, 'error'))
      .finally(() => setLineLoading(false));
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    Promise.all([api("getMembers"), api("getWeeks"), api("getVoteSettings")])
      .then(([m, w, vs]) => {
        setMembers(m); setWeeks(w); setVoteSettings(vs);
        if (w.length) {
          const today = new Date().toISOString().slice(0, 10);
          const idx = w.findIndex(wk => wk.id >= today);
          setWeekIdx(idx >= 0 ? idx : w.length - 1);
        }
      })
      .catch(e => showToast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [currentUser]);

  useEffect(() => {
    if (!week) return;
    let cancelled = false;
    const blankSongs = [
      { weekId: week.id, slot:1, name:"", youtube:"", confirmed:false },
      { weekId: week.id, slot:2, name:"", youtube:"", confirmed:false },
      { weekId: week.id, slot:3, name:"", youtube:"", confirmed:false },
    ];
    Promise.all([
      api("getSchedule", { weekId: week.id }),
      api("getSongs", { weekId: week.id }),
    ]).then(([sc, so]) => {
      if (cancelled) return;
      setSchedule(sc);
      if (so.length) {
        setSongs(so.map(s => ({ ...s, youtube: s.youtube || "" })));
      } else {
        setSongs(blankSongs);
      }
    });
    return () => { cancelled = true; };
  }, [week]);

  if (lineLoading) {
    return (
      <div className="shell" style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100dvh" }}>
        <div style={{ textAlign:"center", color:"var(--c-muted)" }}>
          <div style={{ fontSize:32, marginBottom:12 }}>LINE 登入中…</div>
          <div style={{ fontSize:14 }}>請稍候</div>
        </div>
      </div>
    );
  }

  if (linePending) {
    return (
      <div className="shell">
        <LineBindScreen
          linePending={linePending}
          onBind={(member) => {
            api("bindLineUser", {}, { memberId: member.id, lineUserId: linePending.lineUserId })
              .then(res => { setLinePending(null); setCurrentUser(res.member || member); setView("mySchedule"); })
              .catch(e => showToast('綁定失敗：' + e.message, 'error'));
          }}
          onCancel={() => setLinePending(null)}
        />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="shell">
        <LoginScreen members={members} onLogin={user => { setCurrentUser(user); setView("mySchedule"); }}
          onFetchMembers={() => api("getMembers").then(setMembers)} />
      </div>
    );
  }

  const navs = NAVS[currentUser.role] || [];

  return (
    <div className="shell">
      <div className="hdr">
        <div className="hdr-brand">
          <div className="hdr-mark">♪</div>
          <div>
            <div className="hdr-name">LOTW Worship Team</div>
            <div className="hdr-sub">{week?.label || "世界之光敬拜團"}</div>
          </div>
        </div>
        <div className="hdr-actions">
          <span className={`rpill ${ROLES_MAP[currentUser.role]?.cls}`}>{ROLES_MAP[currentUser.role]?.label}</span>
          <button className="hdr-btn" title={currentUser.name} onClick={() => setCurrentUser(null)}>
            <div className={`av av-${currentUser.avColor?.replace('av-','')}`} style={{ width:28, height:28, fontSize:11, border:"none", boxShadow:"none" }}>{currentUser.initials}</div>
          </button>
        </div>
      </div>

      <div className="screen">
        {loading && <div className="ld-bar" />}
        {toast && <div className={`toast${toast.type==="error"?" err":""}`}>{toast.msg}</div>}

        {view === "vote"       && <VoteView voteSettings={voteSettings} currentUser={currentUser} weeks={weeks} showToast={showToast} api={api} />}
        {view === "voteAdmin"  && <VoteAdminView voteSettings={voteSettings} setVoteSettings={setVoteSettings} currentUser={currentUser} showToast={showToast} api={api} weeks={weeks} members={members} setView={setView} setAiDraft={setAiDraft} />}
        {view === "schedule"   && <ScheduleView weeks={weeks} members={members} voteSettings={voteSettings} currentUser={currentUser} showToast={showToast} api={api} aiDraft={aiDraft} setAiDraft={setAiDraft} />}
        {view === "songs"      && <SongsView week={week} weeks={weeks} weekIdx={weekIdx} setWeekIdx={setWeekIdx} songs={songs} setSongs={setSongs} schedule={schedule} currentUser={currentUser} showToast={showToast} api={api} />}
        {view === "members"    && <MembersView members={members} setMembers={setMembers} showToast={showToast} api={api} />}
        {view === "mySchedule" && <MyScheduleView member={currentUser} weeks={weeks} api={api} showToast={showToast} />}
      </div>

      <nav className="bnav">
        {navs.map(n => (
          <button key={n.id} className={`bnav-item${view===n.id?" on":""}`} onClick={() => setView(n.id)}>
            <div className="bnav-icon">{n.icon}</div>
            <span className="bnav-label">{n.label}</span>
            {view === n.id && <div className="bnav-pip" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────
function LoginScreen({ members, onLogin, onFetchMembers }) {
  const [showFallback, setShowFallback] = useState(false);
  const [selected, setSelected]         = useState("");
  const [fetched, setFetched]           = useState(false);
  const [loading, setLoading]           = useState(false);

  const load = async () => {
    setLoading(true);
    try { await onFetchMembers(); setFetched(true); }
    catch(e) { alert("載入失敗：" + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-bg">
      <div className="login-glow">♪</div>
      <div className="login-church">世界之光敬拜團</div>
      <div className="login-church-en">LOTW WORSHIP TEAM</div>
      <div className="login-card">
        <div className="login-h">歡迎回來</div>
        <div className="login-sh">使用 LINE 帳號登入</div>

        <button className="btn btn-full btn-pill" style={{ background:"#06C755", color:"#fff", fontWeight:600, fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
          onClick={startLineLogin}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
          使用 LINE 登入
        </button>

        {!showFallback ? (
          <button className="btn btn-ghost btn-full btn-pill" style={{ marginTop:8, fontSize:13 }}
            onClick={() => { setShowFallback(true); load(); }}>
            管理員備用登入
          </button>
        ) : (
          <>
            {!fetched ? (
              <div style={{ textAlign:"center", color:"var(--c-muted)", fontSize:13, marginTop:12 }}>載入中…</div>
            ) : (
              <>
                <div className="fgrp" style={{ marginTop:12 }}>
                  <label className="lbl">選擇成員</label>
                  <select className="sel" value={selected} onChange={e => setSelected(e.target.value)}>
                    <option value="">-- 請選擇 --</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <button className="btn btn-navy btn-full btn-pill" disabled={!selected}
                  onClick={() => { const m = members.find(x=>x.id===selected); if(m) onLogin(m); }}>
                  登入
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── LINE Bind (first-time) ────────────────────────────────────
function LineBindScreen({ linePending, onBind, onCancel }) {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    api("getMembers").then(setMembers).catch(() => {});
  }, []);

  return (
    <div className="login-bg">
      <div className="login-glow">♪</div>
      <div className="login-church">世界之光敬拜團</div>
      <div className="login-church-en">LOTW WORSHIP TEAM</div>
      <div className="login-card">
        {linePending.pictureUrl && (
          <img src={linePending.pictureUrl} alt="" style={{ width:60, height:60, borderRadius:"50%", margin:"0 auto 12px", display:"block" }} />
        )}
        <div className="login-h" style={{ fontSize:18 }}>嗨，{linePending.displayName}！</div>
        <div className="login-sh">第一次登入，請選擇你的團員帳號</div>
        <div className="login-sh" style={{ fontSize:12, color:"var(--c-muted)", marginBottom:16 }}>之後 LINE 帳號將自動對應</div>
        {members.length === 0 ? (
          <div style={{ textAlign:"center", color:"var(--c-muted)" }}>載入中…</div>
        ) : (
          <>
            <div className="fgrp">
              <label className="lbl">我是</label>
              <select className="sel" value={selected} onChange={e => setSelected(e.target.value)}>
                <option value="">-- 請選擇 --</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button className="btn btn-navy btn-full btn-pill" disabled={!selected}
              onClick={() => { const m = members.find(x=>x.id===selected); if(m) onBind(m); }}>
              確認綁定
            </button>
            <button className="btn btn-ghost btn-full btn-pill" style={{ marginTop:8 }} onClick={onCancel}>
              取消
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Vote Admin ────────────────────────────────────────────────
function VoteAdminView({ voteSettings, setVoteSettings, currentUser, showToast, api, weeks, members, setView, setAiDraft }) {
  const [showForm, setShowForm]         = useState(false);
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [deadline, setDeadline]         = useState("");
  const [note, setNote]                 = useState("");
  const [summaryData, setSummaryData]   = useState(null);
  const [summaryMonths, setSummaryMonths] = useState(null);
  const [batchTarget, setBatchTarget]   = useState(null);

  const allMonths = Array.from({ length:12 }, (_,i) => i+1);
  const toggleMonth = m => setSelectedMonths(prev => prev.includes(m) ? prev.filter(x=>x!==m) : [...prev,m].sort((a,b)=>a-b));

  const openVote = async () => {
    if (!selectedMonths.length) return showToast("請至少選一個月份", "error");
    if (!deadline) return showToast("請設定截止日期", "error");
    await api("saveVoteSetting", {}, { months: selectedMonths, deadline, openedBy: currentUser.name, status: "open", note });
    const updated = await api("getVoteSettings");
    setVoteSettings(updated);
    setShowForm(false); setSelectedMonths([]); setDeadline(""); setNote("");
    showToast(`已開啟 ${selectedMonths.map(m=>MONTH_NAMES[m]).join("、")} 的投票！`);
  };

  const closeVote = async id => {
    await api("saveVoteSetting", {}, { id, status: "closed" });
    setVoteSettings(await api("getVoteSettings"));
    showToast("投票已關閉");
  };

  const deleteSetting = async id => {
    if (!confirm("確定刪除此投票設定？")) return;
    await api("deleteVoteSetting", {}, { id });
    setVoteSettings(prev => prev.filter(s=>s.id!==id));
    showToast("已刪除");
  };

  const viewSummary = async setting => {
    const months = setting.months.join(",");
    const data = await api("getVoteSummary", { months });
    if (data?.summary) {
      const normalized = {};
      Object.entries(data.summary).forEach(([wk, vmap]) => {
        normalized[String(wk).trim()] = Object.fromEntries(Object.entries(vmap).map(([mk,v])=>[String(mk).trim(),v]));
      });
      data.summary = normalized;
    }
    if (data?.weeks) data.weeks = data.weeks.map(w=>({...w, id:String(w.id).trim()}));
    setSummaryData(data); setSummaryMonths(setting.months);
  };

  const isExpired = s => s.deadline && new Date(s.deadline) < new Date();
  const today = new Date().toISOString().split("T")[0];

  return (
    <div>
      <div className="sec-hd">
        <div className="sec-h1">投票管理</div>
        <button className="btn btn-sm btn-navy btn-pill" onClick={() => setShowForm(true)}>＋ 新投票</button>
      </div>

      {showForm && (
        <div className="sov" onClick={() => setShowForm(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">開啟新投票</div>
            <div className="fgrp">
              <label className="lbl">投票月份（可多選）</label>
              <div className="mpick">
                {allMonths.map(m => (
                  <button key={m} className={`mpick-btn${selectedMonths.includes(m)?" on":""}`} onClick={() => toggleMonth(m)}>
                    {MONTH_NAMES[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2" style={{ gap:12, marginBottom:16 }}>
              <div className="fgrp" style={{ marginBottom:0 }}>
                <label className="lbl">截止日期</label>
                <input type="date" className="inp" value={deadline} min={today} onChange={e => setDeadline(e.target.value)} />
              </div>
              <div className="fgrp" style={{ marginBottom:0 }}>
                <label className="lbl">備注（選填）</label>
                <input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder="6-7月服事" />
              </div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn btn-ghost btn-pill" style={{ flex:1 }} onClick={() => setShowForm(false)}>取消</button>
              <button className="btn btn-navy btn-pill" style={{ flex:1 }} onClick={openVote}>開啟投票</button>
            </div>
          </div>
        </div>
      )}

      {voteSettings.length === 0 ? (
        <div className="empty"><div className="empty-icon">🗳</div>尚無投票設定</div>
      ) : (
        voteSettings.map(setting => {
          const expired   = isExpired(setting);
          const isClosed  = setting.status === "closed";
          const monthNames = (setting.months||[]).map(m=>MONTH_NAMES[m]).join("、");
          const weeksCount = weeks.filter(w=>{ const match=String(w.id).match(/\d{4}-(\d+)-/); return match&&(setting.months||[]).includes(+match[1]); }).length;

          return (
            <div className="vs-card" key={setting.id}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:600, color:"var(--text-1)" }}>{monthNames} 服事意願調查</div>
                  <div style={{ fontSize:12, color:"var(--text-3)", marginTop:2 }}>
                    共 {weeksCount} 週 ｜ {setting.openedBy}{setting.note && ` ｜ ${setting.note}`}
                  </div>
                </div>
                <span className={`vs-stat ${isClosed?"vs-closed":expired?"vs-exp":"vs-open"}`}>
                  {isClosed?"已關閉":expired?"已過期":"進行中"}
                </span>
              </div>
              <div style={{ fontSize:13, color:"var(--text-2)", marginBottom:12 }}>
                截止：<strong style={{ color: expired&&!isClosed?"var(--danger)":"var(--text-1)" }}>{setting.deadline||"未設定"}</strong>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button className="btn btn-sm btn-navy btn-pill" onClick={() => viewSummary(setting)}>查看統計</button>
                {(isClosed||expired) && <button className="btn btn-sm btn-pill" style={{ background:"var(--navy-dk)", color:"var(--gold)", borderColor:"var(--navy-dk)" }} onClick={() => setBatchTarget(setting)}>✦ 全期 AI 排班</button>}
                {!isClosed && <button className="btn btn-sm btn-ghost btn-pill" onClick={() => closeVote(setting.id)}>關閉投票</button>}
                <button className="btn btn-sm btn-danger btn-pill" onClick={() => deleteSetting(setting.id)}>刪除</button>
              </div>
              {batchTarget?.id === setting.id && (
                <BatchSchedulePanel setting={setting} weeks={weeks} members={members} api={api} showToast={showToast} onClose={() => setBatchTarget(null)}
                  onDraftReady={(setting, results) => {
                    setAiDraft({ settingId: setting.id, setting, results });
                    setView("schedule");
                  }} />
              )}
            </div>
          );
        })
      )}

      {summaryData && (
        <div style={{ padding:"0 16px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div style={{ fontFamily:"var(--serif)", fontSize:16, color:"var(--navy)" }}>
              {summaryMonths?.map(m=>MONTH_NAMES[m]).join("、")} 投票統計
            </div>
            <button className="btn btn-sm btn-ghost btn-pill" onClick={() => setSummaryData(null)}>關閉</button>
          </div>
          <div style={{ overflowX:"auto", borderRadius:"var(--r-md)", border:"1px solid var(--border-lt)" }}>
            <VoteSummaryTable weeks={summaryData.weeks} summary={summaryData.summary} members={members} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Batch Schedule ────────────────────────────────────────────
function BatchSchedulePanel({ setting, weeks, members, api, showToast, onClose, onDraftReady }) {
  const [aiNote, setAiNote]               = useState("");
  const [running, setRunning]             = useState(false);
  const [progress, setProgress]           = useState(null);
  const [parsedResults, setParsedResults] = useState(null);
  const [previewPrompt, setPreviewPrompt] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const settingWeeks = weeks.filter(w => {
    const m = String(w.id).match(/\d{4}-(\d+)-/);
    return m && setting.months.includes(+m[1]);
  });

  const run = async () => {
    setRunning(true);
    setProgress({ total: settingWeeks.length, done: 0, current: "載入投票資料...", results: [] });
    let summaryData;
    try {
      summaryData = await api("getVoteSummary", { months: setting.months.join(",") });
      if (summaryData?.summary) {
        const norm = {};
        Object.entries(summaryData.summary).forEach(([wk, vmap]) => {
          norm[String(wk).trim()] = Object.fromEntries(Object.entries(vmap).map(([mk,v])=>[String(mk).trim(),v]));
        });
        summaryData.summary = norm;
      }
    } catch(e) {
      showToast("無法取得投票資料：" + e.message, "error");
      setRunning(false); return;
    }

    const weekRows = settingWeeks.map(w => {
      const voteMap = summaryData.summary[String(w.id).trim()] || {};
      const avail   = members.filter(m => { const v = voteMap[String(m.id).trim()]; return v==="yes"||v==="maybe"; });
      return { week: w, avail, voteMap };
    });

    setProgress(prev => ({ ...prev, current: "AI 規劃全期排班中..." }));
    try {
      const [histData] = await Promise.all([api("getPrePracticeHistory")]);
      const practiceHistory = histData || {};
      const prompt  = fillBatchPrompt(weekRows, aiNote);
      const text    = await api("runAISchedule", {}, { prompt });
      const parsed  = assignPrePractice(enforcePPT(enforceConsecutive(enforceMonthlyLimits(parseBatchResponse(text, weekRows), weekRows), weekRows), weekRows), practiceHistory);
      const results = settingWeeks.map(w => {
        const found = parsed.find(p => p.week.id === w.id);
        return found
          ? { week: w, assignments: found.assignments, ok: true }
          : { week: w, ok: false, error: "AI 未回傳此週" };
      });
      setParsedResults(parsed);
      setProgress(prev => ({ ...prev, done: settingWeeks.length, current: null, results }));
      showToast(`AI 規劃完成！共 ${parsed.length} 週，請前往確認後儲存`);
    } catch(e) {
      showToast("全期排班失敗：" + e.message, "error");
      setProgress(prev => ({ ...prev, current: null }));
    }
    setRunning(false);
  };

  const previewBatch = async () => {
    setPreviewLoading(true);
    try {
      const summaryData = await api("getVoteSummary", { months: setting.months.join(",") });
      if (summaryData?.summary) {
        const norm = {};
        Object.entries(summaryData.summary).forEach(([wk, vmap]) => {
          norm[String(wk).trim()] = Object.fromEntries(Object.entries(vmap).map(([mk,v])=>[String(mk).trim(),v]));
        });
        summaryData.summary = norm;
      }
      const weekRows = settingWeeks.map(w => {
        const voteMap = summaryData.summary[String(w.id).trim()] || {};
        const avail   = members.filter(m => { const v = voteMap[String(m.id).trim()]; return v==="yes"||v==="maybe"; });
        return { week: w, avail, voteMap };
      });
      setPreviewPrompt(fillBatchPrompt(weekRows, aiNote));
    } catch(e) { showToast("無法載入 Prompt：" + e.message, "error"); }
    finally { setPreviewLoading(false); }
  };

  return (
    <div style={{ marginTop:16, padding:"16px", background:"var(--cream-md)", borderRadius:"var(--r-md)", border:"1px solid var(--border)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontFamily:"var(--serif)", fontSize:15, color:"var(--navy)" }}>
          全期 AI 排班 — {setting.months.map(m=>MONTH_NAMES[m]).join("、")}（{settingWeeks.length} 週）
        </div>
        <button className="btn btn-sm btn-ghost btn-pill" onClick={onClose} disabled={running}>關閉</button>
      </div>

      {!progress && (
        <>
          <div className="fgrp">
            <label className="lbl">備注給 AI</label>
            <input className="inp" value={aiNote} onChange={e=>setAiNote(e.target.value)} placeholder="例：請盡量平均分配" />
          </div>
          <button className="ai-btn btn-full" onClick={run} style={{ borderRadius:"var(--r-sm)" }}>
            ✦ 開始全期 AI 排班（{settingWeeks.length} 週）
          </button>
          <button className="btn btn-sm btn-ghost btn-pill" style={{ marginTop:8, width:"100%", opacity:0.8 }}
            disabled={previewLoading} onClick={previewBatch}>
            {previewLoading ? "載入中..." : "預覽批次 Prompt"}
          </button>
        </>
      )}

      {previewPrompt && (
        <div className="sov" onClick={() => setPreviewPrompt(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">批次 Prompt 預覽</div>
            <textarea readOnly className="inp"
              style={{ fontFamily:"monospace", fontSize:11, lineHeight:1.6, height:360, resize:"none" }}
              value={previewPrompt}
            />
            <button className="btn btn-navy btn-pill btn-full" style={{ marginTop:8 }} onClick={() => setPreviewPrompt(null)}>關閉</button>
          </div>
        </div>
      )}

      {progress && (
        <>
          <div style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--text-2)", marginBottom:6 }}>
              <span>{running ? `排班中：${progress.current||""}` : "完成！"}</span>
              <span>{progress.done}/{progress.total}</span>
            </div>
            <div className="prog"><div className="prog-fill" style={{ width:`${progress.total?progress.done/progress.total*100:0}%` }} /></div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {progress.results.map((r,i) => (
              <div key={i} style={{ fontSize:12, display:"flex", gap:8, padding:"5px 0", borderBottom:"1px solid var(--border-lt)" }}>
                <span style={{ minWidth:60, color:"var(--text-3)", flexShrink:0 }}>{r.week.label}</span>
                {r.ok
                  ? <span style={{ color:"var(--text-2)" }}>{r.assignments.filter(a=>a.memberName!=="—").map(a=>`${a.role}：${a.memberName}`).join("　")}</span>
                  : <span style={{ color:"var(--danger)" }}>失敗：{r.error}</span>
                }
              </div>
            ))}
          </div>
          {parsedResults && !running && (
            <button className="btn btn-navy btn-pill btn-full" style={{ marginTop:12 }}
              onClick={() => { onDraftReady(setting, parsedResults); onClose(); }}>
              前往確認排班 →
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Vote Summary Table ────────────────────────────────────────
function VoteSummaryTable({ weeks, summary, members }) {
  const activeMembers = members.filter(m => m.active !== false);
  if (!weeks||weeks.length===0) return <div className="empty">尚無資料</div>;

  return (
    <table className="stbl">
      <thead>
        <tr>
          <th className="sticky-c">成員</th>
          {weeks.map(w => {
            const match = String(w.id).match(/\d{4}-(\d+)-(\d+)/);
            return <th key={w.id}>{match?`${match[1]}/${match[2]}`:w.id}</th>;
          })}
          <th>可出席</th>
        </tr>
      </thead>
      <tbody>
        {activeMembers.map(m => {
          const yesCount = weeks.filter(w => summary[String(w.id).trim()]?.[String(m.id).trim()]==="yes").length;
          return (
            <tr key={m.id}>
              <td className="sticky-c">
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div className={`av av-${m.avColor?.replace('av-','')}`} style={{ width:22,height:22,fontSize:9,border:"none",boxShadow:"none" }}>{m.initials}</div>
                  {m.name}
                </div>
              </td>
              {weeks.map(w => {
                const v = summary[String(w.id).trim()]?.[String(m.id).trim()];
                return (
                  <td key={w.id} style={{ textAlign:"center" }}>
                    {v==="yes"?<span style={{ color:"var(--success)",fontWeight:700 }}>✓</span>
                     :v==="no"?<span style={{ color:"var(--danger)",fontWeight:700 }}>✕</span>
                     :<span style={{ color:"var(--border)" }}>—</span>}
                  </td>
                );
              })}
              <td style={{ textAlign:"center", fontWeight:600 }}>
                <span style={{ color: yesCount>=weeks.length*0.7?"var(--success)":"var(--warning)" }}>{yesCount}/{weeks.length}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Vote View ─────────────────────────────────────────────────
function VoteView({ voteSettings, currentUser, weeks, showToast, api }) {
  const [myVotes, setMyVotes]               = useState({});
  const [activeSettingIdx, setActiveSettingIdx] = useState(0);
  const [saving, setSaving]                 = useState(false);

  // Show all settings (open + closed), default to first open one
  const allSettings = voteSettings;
  useEffect(() => {
    const firstOpenIdx = allSettings.findIndex(s => s.status === "open");
    setActiveSettingIdx(firstOpenIdx >= 0 ? firstOpenIdx : 0);
  }, [voteSettings.length]);

  const activeSetting = allSettings[activeSettingIdx];
  const isClosed = activeSetting && (activeSetting.status === "closed" || (activeSetting.deadline && new Date(activeSetting.deadline) < new Date()));

  const settingWeeks = activeSetting
    ? weeks.filter(w => { const m = String(w.id).match(/\d{4}-(\d+)-/); return m && activeSetting.months.includes(+m[1]); })
    : [];

  const weeksByMonth = {};
  settingWeeks.forEach(w => {
    const m = String(w.id).match(/\d{4}-(\d+)-/);
    const month = m ? +m[1] : 0;
    if (!weeksByMonth[month]) weeksByMonth[month] = [];
    weeksByMonth[month].push(w);
  });

  useEffect(() => {
    if (!activeSetting) return;
    api("getVotesByMember", { memberId: currentUser.id, months: activeSetting.months.join(",") })
      .then(votes => {
        const map = {};
        votes.forEach(v => { map[v.weekId] = v.vote; });
        setMyVotes(map);
      });
  }, [activeSetting?.id]);

  const setVote = (weekId, vote) => setMyVotes(prev => ({ ...prev, [weekId]: vote }));

  const bulkMonth = (monthWeeks, vote) => {
    const updates = {};
    monthWeeks.forEach(w => { updates[w.id] = vote; });
    setMyVotes(prev => ({ ...prev, ...updates }));
  };

  const saveAll = async () => {
    const unanswered = settingWeeks.filter(w => !myVotes[w.id]);
    if (unanswered.length > 0) {
      showToast(`請先填寫所有週次（還有 ${unanswered.length} 週未填）`, "error");
      return;
    }
    setSaving(true);
    try {
      for (const [weekId, vote] of Object.entries(myVotes)) {
        await api("castVote", {}, { weekId, memberId: currentUser.id, vote });
      }
      showToast("投票已儲存！");
    } catch(e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const deadline = activeSetting?.deadline;
  const daysLeft = deadline ? Math.ceil((new Date(deadline) - new Date()) / 86400000) : null;
  const answeredCount = settingWeeks.filter(w => myVotes[w.id]).length;
  const totalCount    = settingWeeks.length;

  if (allSettings.length === 0) return (
    <div>
      <div className="sec-hd"><div className="sec-h1">服事意願投票</div></div>
      <div className="empty"><div className="empty-icon">🗳</div>目前沒有投票設定<br /><span style={{ fontSize:12 }}>請等待管理員開啟投票</span></div>
    </div>
  );

  return (
    <div>
      <div className="sec-hd"><div className="sec-h1">服事意願投票</div></div>

      {allSettings.length > 1 && (
        <div className="wpills">
          {allSettings.map((s, i) => {
            const closed = s.status === "closed" || (s.deadline && new Date(s.deadline) < new Date());
            return (
              <button key={s.id} className={`wpill${activeSettingIdx===i?" on":""}`} onClick={() => setActiveSettingIdx(i)}>
                {s.months.map(m=>MONTH_NAMES[m]).join("、")}
                {closed && <span style={{ marginLeft:4, fontSize:10, opacity:0.7 }}>已結束</span>}
              </button>
            );
          })}
        </div>
      )}

      {isClosed ? (
        <div className="reminder" style={{ background:"var(--cream-md)", borderColor:"var(--border)" }}>
          <span className="reminder-icon">🔒</span>
          <div style={{ fontSize:13 }}>
            <strong>投票已結束</strong> — 截止 {deadline}
            <div style={{ marginTop:4, color:"var(--text-2)" }}>你的投票結果如下（僅供檢視）</div>
          </div>
        </div>
      ) : daysLeft !== null ? (
        <div className="reminder">
          <span className="reminder-icon">{daysLeft <= 3 ? "🔴" : "⏰"}</span>
          <div style={{ fontSize:13 }}>
            截止：<strong>{deadline}</strong>
            {daysLeft > 0 ? `，還有 ${daysLeft} 天` : "，已截止"}
            <div style={{ marginTop:4, color:"var(--text-2)" }}>已填 {answeredCount}/{totalCount} 週</div>
          </div>
        </div>
      ) : null}

      {!isClosed && (
        <div style={{ padding:"0 16px 12px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--text-3)", marginBottom:5 }}>
            <span>填寫進度</span><span>{answeredCount}/{totalCount}</span>
          </div>
          <div className="prog"><div className="prog-fill" style={{ width:`${totalCount ? answeredCount/totalCount*100 : 0}%` }} /></div>
        </div>
      )}

      {Object.entries(weeksByMonth).map(([month, monthWeeks]) => (
        <div key={month}>
          <div className="mdiv" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span>{MONTH_NAMES[+month]}</span>
            {!isClosed && (
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn btn-sm btn-ok btn-pill" onClick={() => bulkMonth(monthWeeks,"yes")}>全月可以</button>
                <button className="btn btn-sm btn-ghost btn-pill" onClick={() => bulkMonth(monthWeeks,"no")}>全月不行</button>
              </div>
            )}
          </div>
          <div style={{ padding:"0 16px" }}>
            {monthWeeks.map(w => {
              const match = String(w.id).match(/\d{4}-(\d+)-(\d+)/);
              const label = match ? `${+match[1]}/${+match[2]}` : w.id;
              const myVote = myVotes[w.id];
              return (
                <div key={w.id} className={`vcard${myVote ? " answered-"+myVote : ""}`}>
                  <div className="vcard-top">
                    <div>
                      <div className="vdate">{label}</div>
                      <div className="vday">週六 09:30</div>
                    </div>
                    {myVote
                      ? <span className={`chip ${myVote==="yes"?"chip-success":"chip-danger"}`}>{myVote==="yes"?"✓ 可以":"✕ 不行"}</span>
                      : <span className="chip chip-neutral">未填</span>
                    }
                  </div>
                  {!isClosed && (
                    <div className="vbtns">
                      <button className={`vbtn${myVote==="yes"?" yes-on":""}`} onClick={() => setVote(w.id,"yes")}>✓ 可以服事</button>
                      <button className={`vbtn${myVote==="no"?" no-on":""}`} onClick={() => setVote(w.id,"no")}>✕ 無法參與</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!isClosed && (
        <div style={{ padding:"16px", position:"sticky", bottom:84 }}>
          <button className="btn btn-navy btn-full btn-pill" onClick={saveAll} disabled={saving}>
            {saving ? "儲存中..." : `儲存投票（${answeredCount}/${totalCount} 週）`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Members ───────────────────────────────────────────────────
function MembersView({ members, setMembers, showToast, api }) {
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name:"", role:"member", instruments:[], email:"", constraints:"", canPPT:false });

  const openAdd  = () => { setForm({ name:"", role:"member", instruments:[], email:"", constraints:"", canPPT:false }); setEditTarget("new"); };
  const openEdit = m => { setForm({ ...m, instruments: Array.isArray(m.instruments)?m.instruments:m.instruments.split(",") }); setEditTarget(m.id); };

  const save = async () => {
    const payload = { ...form, id: editTarget==="new"?undefined:editTarget };
    await api("saveMember",{},payload);
    setMembers(await api("getMembers"));
    showToast(editTarget==="new"?"團員已新增！":"團員已更新！");
    setEditTarget(null);
  };

  const remove = async id => {
    if (!confirm("確定移除？")) return;
    await api("deleteMember",{},{ id });
    setMembers(prev=>prev.filter(m=>m.id!==id));
    showToast("已移除");
  };

  const toggleInstrument = inst =>
    setForm(f => ({ ...f, instruments: f.instruments.includes(inst)?f.instruments.filter(i=>i!==inst):[...f.instruments,inst] }));

  return (
    <div>
      <div className="sec-hd">
        <div className="sec-h1">團員名單</div>
        <button className="btn btn-sm btn-navy btn-pill" onClick={openAdd}>＋ 新增</button>
      </div>

      {editTarget && (
        <div className="sov" onClick={() => setEditTarget(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">{editTarget==="new"?"新增":"編輯"}團員</div>
            <div className="grid-2" style={{ marginBottom:12 }}>
              <div className="fgrp" style={{ marginBottom:0 }}><label className="lbl">姓名</label><input className="inp" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
              <div className="fgrp" style={{ marginBottom:0 }}><label className="lbl">Email</label><input className="inp" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
            </div>
            <div className="grid-2" style={{ marginBottom:12 }}>
              <div className="fgrp" style={{ marginBottom:0 }}>
                <label className="lbl">角色</label>
                <select className="sel" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                  <option value="member">團員</option><option value="leader">團長</option><option value="admin">管理員</option>
                </select>
              </div>
              <div className="fgrp" style={{ marginBottom:0 }}><label className="lbl">特殊條件</label><input className="inp" value={form.constraints} onChange={e=>setForm(f=>({...f,constraints:e.target.value}))} /></div>
            </div>
            <div className="fgrp">
              <label className="lbl">擔任樂器/職責</label>
              <div className="itag-row">{SKILL_INSTRUMENTS.map(inst=><button key={inst} className={`itag${form.instruments.includes(inst)?" on":""}`} onClick={()=>toggleInstrument(inst)}>{inst}</button>)}</div>
            </div>
            <div className="fgrp" style={{ marginBottom:8 }}>
              <label className="lbl">PPT 操作</label>
              <button
                className={`itag${form.canPPT ? " on" : ""}`}
                onClick={() => setForm(f => ({ ...f, canPPT: !f.canPPT }))}>
                {form.canPPT ? "✓ 可擔任 PPT" : "不擔任 PPT"}
              </button>
              <span style={{ fontSize:11, color:"var(--text-3)", marginLeft:8 }}>排班時從可出席且未擔任其他角色的人中選擇</span>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button className="btn btn-ghost btn-pill" style={{ flex:1 }} onClick={()=>setEditTarget(null)}>取消</button>
              <button className="btn btn-navy btn-pill" style={{ flex:1 }} onClick={save}>儲存</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {members.map(m => (
          <div className="mem-item" key={m.id}>
            <div className={`av av-${m.avColor?.replace('av-','')}`} style={{ width:40,height:40,fontSize:13 }}>{m.initials}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div className="mem-name">
                {m.name}
                <span className={`rpill ${ROLES_MAP[m.role]?.cls}`}>{ROLES_MAP[m.role]?.label}</span>
                {m.canPPT && <span className="rpill" style={{ background:"var(--cream-md)", color:"var(--text-2)", border:"1px solid var(--border)" }}>PPT</span>}
              </div>
              <div className="mem-detail">{(Array.isArray(m.instruments)?m.instruments:[m.instruments]).join("、")}</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button className="btn btn-sm btn-ghost btn-pill" onClick={()=>openEdit(m)}>編輯</button>
              <button className="btn btn-sm btn-danger btn-pill" onClick={()=>remove(m.id)}>移除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Schedule ──────────────────────────────────────────────────
const ROLE_COLORS = {
  "主領":     { bg:"#fef3c7", color:"#92400e" },
  "配唱":     { bg:"#ede9fe", color:"#5b21b6" },
  "鼓":       { bg:"#fee2e2", color:"#991b1b" },
  "鋼琴":     { bg:"#dbeafe", color:"#1e40af" },
  "Keyboard": { bg:"#d1fae5", color:"#065f46" },
  "吉他":     { bg:"#fce7f3", color:"#9d174d" },
  "BASS":     { bg:"#e0f2fe", color:"#075985" },
  "PPT":      { bg:"#f1f5f9", color:"#475569" },
  "練前讀經": { bg:"#fef9c3", color:"#713f12" },
};

function ScheduleView({ weeks, members, voteSettings, currentUser, showToast, api, aiDraft, setAiDraft }) {
  const [batchSetting, setBatchSetting]   = useState(null);
  const [weekRows, setWeekRows]           = useState([]);
  const [scheduleByWeek, setScheduleByWeek] = useState({});
  const [dirtyWeeks, setDirtyWeeks]       = useState(new Set());
  const [loadingData, setLoadingData]     = useState(false);
  const [running, setRunning]             = useState(false);
  const [saving, setSaving]               = useState(false);
  const [aiNote, setAiNote]               = useState("");
  const [previewPrompt, setPreviewPrompt] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [practiceHistory, setPracticeHistory] = useState({});
  const [isDraft, setIsDraft]             = useState(false);

  const canEdit = currentUser.role === "admin" || currentUser.role === "leader";
  const closedSettings = voteSettings.filter(s =>
    s.status === "closed" || (s.deadline && new Date(s.deadline) < new Date())
  );

  const getSettingWeeks = s => weeks.filter(w => {
    const m = String(w.id).match(/\d{4}-(\d+)-/);
    return m && s.months.includes(+m[1]);
  });

  const normSummary = raw => {
    if (!raw?.summary) return raw;
    const norm = {};
    Object.entries(raw.summary).forEach(([wk, vmap]) => {
      norm[String(wk).trim()] = Object.fromEntries(
        Object.entries(vmap).map(([mk, v]) => [String(mk).trim(), v])
      );
    });
    return { ...raw, summary: norm };
  };

  const buildRows = (sw, summary) => sw.map(w => {
    const voteMap = summary[String(w.id).trim()] || {};
    const avail = members.filter(m => { const v = voteMap[String(m.id).trim()]; return v === "yes" || v === "maybe"; });
    return { week: w, avail, voteMap };
  });

  const loadSetting = async (setting, draftResults = null) => {
    setBatchSetting(setting);
    setWeekRows([]); setScheduleByWeek({}); setDirtyWeeks(new Set());
    setIsDraft(!!draftResults);
    setLoadingData(true);
    try {
      const [data, hist] = await Promise.all([
        api("getVoteSummary", { months: setting.months.join(",") }),
        api("getPrePracticeHistory"),
      ]);
      const sw = getSettingWeeks(setting);
      setWeekRows(buildRows(sw, normSummary(data).summary));
      setPracticeHistory(hist || {});
      if (draftResults) {
        const byWeek = {};
        for (const { week, assignments } of draftResults) byWeek[week.id] = assignments;
        setScheduleByWeek(byWeek);
        setDirtyWeeks(new Set(draftResults.map(r => r.week.id)));
      } else {
        const byWeek = {};
        await Promise.all(sw.map(async w => { byWeek[w.id] = await api("getSchedule", { weekId: w.id }) || []; }));
        setScheduleByWeek(byWeek);
      }
    } catch(e) { showToast("載入失敗：" + e.message, "error"); }
    setLoadingData(false);
  };

  // Auto-load when navigated here with an AI draft
  useEffect(() => {
    if (!aiDraft) return;
    const setting = voteSettings.find(s => s.id === aiDraft.settingId) || aiDraft.setting;
    if (setting) loadSetting(setting, aiDraft.results);
  }, [aiDraft?.settingId]);

  const runBatch = async () => {
    setRunning(true);
    try {
      const prompt = fillBatchPrompt(weekRows, aiNote);
      const text   = await api("runAISchedule", {}, { prompt });
      const parsed = assignPrePractice(
        enforcePPT(enforceConsecutive(enforceMonthlyLimits(parseBatchResponse(text, weekRows), weekRows), weekRows), weekRows),
        practiceHistory
      );
      const byWeek = { ...scheduleByWeek };
      for (const { week: w, assignments } of parsed) {
        await api("saveSchedule", {}, { weekId: w.id, assignments });
        byWeek[w.id] = assignments;
      }
      setScheduleByWeek(byWeek);
      setDirtyWeeks(new Set());
      showToast(`排班完成！共 ${parsed.length} 週`);
    } catch(e) { showToast("排班失敗：" + e.message, "error"); }
    setRunning(false);
  };

  const previewBatch = async () => {
    setPreviewLoading(true);
    try {
      const data = normSummary(await api("getVoteSummary", { months: batchSetting.months.join(",") }));
      setPreviewPrompt(fillBatchPrompt(buildRows(getSettingWeeks(batchSetting), data.summary), aiNote));
    } catch(e) { showToast("載入失敗：" + e.message, "error"); }
    setPreviewLoading(false);
  };

  const updateCell = (weekId, memberId, memberName, newRole) => {
    setScheduleByWeek(prev => {
      let a = [...(prev[weekId] || [])].filter(x => x.memberId !== memberId);
      if (newRole !== "—") {
        a = a.filter(x => x.role !== newRole); // one person per role
        a.push({ role: newRole, memberId, memberName });
      }
      return { ...prev, [weekId]: a };
    });
    setDirtyWeeks(d => new Set([...d, weekId]));
  };

  const updatePrePractice = (weekId, memberId, memberName) => {
    setScheduleByWeek(prev => {
      const without = (prev[weekId] || []).filter(a => a.role !== "練前讀經");
      const updated = memberId
        ? [...without, { role: "練前讀經", memberId, memberName }]
        : without;
      return { ...prev, [weekId]: updated };
    });
    setDirtyWeeks(d => new Set([...d, weekId]));
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      for (const weekId of dirtyWeeks)
        await api("saveSchedule", {}, { weekId, assignments: scheduleByWeek[weekId] || [] });
      setDirtyWeeks(new Set());
      setIsDraft(false);
      if (aiDraft) setAiDraft(null);
      showToast(isDraft ? "排班已確認儲存！" : "修改已儲存！");
    } catch(e) { showToast("儲存失敗：" + e.message, "error"); }
    setSaving(false);
  };

  const allMembers = useMemo(() => {
    const map = new Map();
    weekRows.forEach(({ avail }) => avail.forEach(m => { if (!map.has(m.id)) map.set(m.id, m); }));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [weekRows]);

  return (
    <div>
      <div className="sec-hd"><div className="sec-h1">AI 排班</div></div>

      {/* Setting selector */}
      <div className="card">
        <div className="card-title">選擇投票期間</div>
        {closedSettings.length === 0 ? (
          <div style={{ fontSize:13, color:"var(--text-3)" }}>尚無已結束的投票可供排班</div>
        ) : closedSettings.map(s => {
          const monthNames = (s.months||[]).map(m => MONTH_NAMES[m]).join("、");
          const wkCount = getSettingWeeks(s).length;
          return (
            <button key={s.id}
              className={`btn btn-pill${batchSetting?.id===s.id?" btn-navy":" btn-ghost"}`}
              style={{ justifyContent:"flex-start", textAlign:"left", padding:"10px 14px", marginBottom:6, width:"100%" }}
              onClick={() => loadSetting(s)} disabled={loadingData}>
              <strong>{monthNames}</strong>
              <span style={{ marginLeft:8, fontSize:12, opacity:0.75 }}>{wkCount} 週 ｜{s.note||s.openedBy}</span>
            </button>
          );
        })}
      </div>

      {loadingData && <div style={{ textAlign:"center", padding:24, color:"var(--text-3)", fontSize:13 }}>載入投票資料...</div>}

      {weekRows.length > 0 && (
        <>
          {/* Draft banner */}
          {isDraft && (
            <div className="reminder" style={{ background:"var(--gold-pale)", borderColor:"var(--gold)" }}>
              <span className="reminder-icon">✦</span>
              <div style={{ fontSize:13 }}>
                <strong>AI 草稿（尚未儲存）</strong>
                <div style={{ marginTop:3, color:"var(--text-2)" }}>以下為 AI 建議排班，請確認或調整後按「儲存」</div>
              </div>
            </div>
          )}

          {/* AI controls — hide when viewing draft */}
          {!isDraft && (
            <div className="ai-card">
              <div className="ai-title">{batchSetting.months.map(m=>MONTH_NAMES[m]).join("、")} 全期排班</div>
              <div className="ai-sub">{weekRows.length} 週 ｜ 預計需要 30–60 秒</div>
              <input className="inp" style={{ marginBottom:10 }} value={aiNote}
                onChange={e => setAiNote(e.target.value)} placeholder="備注給 AI（選填）" />
              <button className="ai-btn" onClick={runBatch} disabled={running}>
                {running ? <span className="pulse">AI 排班中，請耐心等候...</span> : "✦ AI 全期排班"}
              </button>
              <button className="btn btn-sm btn-ghost btn-pill"
                style={{ marginTop:8, width:"100%", opacity:0.8 }}
                disabled={previewLoading} onClick={previewBatch}>
                {previewLoading ? "載入中..." : "預覽 Prompt"}
              </button>
            </div>
          )}

          {/* Editable grid — only show once there is schedule data */}
          {Object.values(scheduleByWeek).some(v => v && v.length > 0) && (
            <ScheduleGridCard
              weekRows={weekRows} scheduleByWeek={scheduleByWeek}
              allMembers={allMembers} canEdit={canEdit} onUpdate={updateCell}
              onUpdatePrePractice={updatePrePractice}
              dirtyWeeks={dirtyWeeks} saving={saving} onSave={saveChanges}
              monthLabel={batchSetting.months.map(m => MONTH_NAMES[m]).join("、")} />
          )}
        </>
      )}

      {previewPrompt && (
        <div className="sov" onClick={() => setPreviewPrompt(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-title">批次 Prompt 預覽</div>
            <textarea readOnly className="inp"
              style={{ fontFamily:"monospace", fontSize:11, lineHeight:1.6, height:360, resize:"none" }}
              value={previewPrompt} />
            <button className="btn btn-navy btn-pill btn-full" style={{ marginTop:8 }} onClick={() => setPreviewPrompt(null)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleGridCard({ weekRows, scheduleByWeek, allMembers, canEdit, onUpdate, onUpdatePrePractice, dirtyWeeks, saving, onSave, monthLabel }) {
  const [downloading, setDownloading] = useState(false);

  const downloadPng = async () => {
    setDownloading(true);
    try {
      // Draw the grid with Canvas 2D — no DOM cloning, no CSS variable issues,
      // no viewport clipping. Every pixel is ours to control.
      const SCALE  = 2;       // retina
      const PAD    = 24;
      const NAME_W = 140;
      const COL_W  = 86;
      const ROW_H  = 40;
      const HDR_H  = 38;
      const TITLE_H = 40;
      const FONT = "system-ui,-apple-system,sans-serif";
      const RC = {
        "主領":     { bg:"#fef3c7", fg:"#92400e" },
        "配唱":     { bg:"#ede9fe", fg:"#5b21b6" },
        "鼓":       { bg:"#fee2e2", fg:"#991b1b" },
        "鋼琴":     { bg:"#dbeafe", fg:"#1e40af" },
        "Keyboard": { bg:"#d1fae5", fg:"#065f46" },
        "吉他":     { bg:"#fce7f3", fg:"#9d174d" },
        "BASS":     { bg:"#e0f2fe", fg:"#075985" },
        "PPT":      { bg:"#f1f5f9", fg:"#475569" },
        "練前讀經": { bg:"#fef9c3", fg:"#713f12" },
      };
      const PP_ROW_H = 36; // height of the 練前讀經 special row

      const W = PAD * 2 + NAME_W + weekRows.length * COL_W;
      const H = PAD * 2 + TITLE_H + HDR_H + PP_ROW_H + allMembers.length * ROW_H;

      const canvas = document.createElement("canvas");
      canvas.width  = W * SCALE;
      canvas.height = H * SCALE;
      const c = canvas.getContext("2d");
      c.scale(SCALE, SCALE);

      // White background
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, W, H);

      // Title
      c.font = `bold 15px ${FONT}`;
      c.fillStyle = "#1e3a5f";
      c.fillText(`服事表　${monthLabel}`, PAD, PAD + 22);

      const tableX = PAD;
      const tableY = PAD + TITLE_H;
      const tableW = NAME_W + weekRows.length * COL_W;

      // Header background — name col uses darker shade, week cols lighter
      c.fillStyle = "#e8dfd2";
      c.fillRect(tableX, tableY, NAME_W, HDR_H);
      c.fillStyle = "#eee8da";
      c.fillRect(tableX + NAME_W, tableY, tableW - NAME_W, HDR_H);

      // Header — "成員"
      c.font = `bold 12px ${FONT}`;
      c.fillStyle = "#555";
      c.fillText("成員", tableX + 10, tableY + HDR_H / 2 + 5);

      // Header — week labels
      weekRows.forEach(({ week }, wi) => {
        const cx = tableX + NAME_W + wi * COL_W + COL_W / 2;
        const label = week.label.slice(5).replace("-", "/");
        c.font = `bold 12px ${FONT}`;
        c.fillStyle = "#1e3a5f";
        c.textAlign = "center";
        c.fillText(label, cx, tableY + HDR_H / 2 + 5);
      });
      c.textAlign = "left";

      // Header bottom border
      c.strokeStyle = "#c8bfaa";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(tableX, tableY + HDR_H);
      c.lineTo(tableX + tableW, tableY + HDR_H);
      c.stroke();

      // 練前讀經 row
      const ppRowY = tableY + HDR_H;
      c.fillStyle = "#fffde7";
      c.fillRect(tableX, ppRowY, tableW, PP_ROW_H);
      c.font = `bold 11px ${FONT}`;
      c.fillStyle = "#713f12";
      c.fillText("練前讀經", tableX + 10, ppRowY + PP_ROW_H / 2 + 4);
      weekRows.forEach(({ week }, wi) => {
        const pp = (scheduleByWeek[week.id] || []).find(a => a.role === "練前讀經");
        const cx = tableX + NAME_W + wi * COL_W + COL_W / 2;
        if (pp?.memberName && pp.memberName !== "—") {
          const rc = RC["練前讀經"];
          c.font = `bold 11px ${FONT}`;
          const tw = c.measureText(pp.memberName).width;
          const bw = tw + 14; const bh = 20; const r = 10;
          const bx = cx - bw / 2; const by = ppRowY + (PP_ROW_H - bh) / 2;
          c.fillStyle = rc.bg;
          c.beginPath(); c.roundRect(bx, by, bw, bh, r); c.fill();
          c.fillStyle = rc.fg; c.textAlign = "center";
          c.fillText(pp.memberName, cx, ppRowY + PP_ROW_H / 2 + 4);
          c.textAlign = "left";
        }
      });
      c.strokeStyle = "#e5ddd0"; c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(tableX, ppRowY + PP_ROW_H);
      c.lineTo(tableX + tableW, ppRowY + PP_ROW_H);
      c.stroke();

      // Member rows (offset by PP_ROW_H)
      allMembers.forEach((member, mi) => {
        const rowY  = tableY + HDR_H + PP_ROW_H + mi * ROW_H;
        const rowBg = mi % 2 === 0 ? "#ffffff" : "#f9f5ee";

        // Row background (week columns only — name column has its own solid bg)
        c.fillStyle = rowBg;
        c.fillRect(tableX + NAME_W, rowY, tableW - NAME_W, ROW_H);

        // Name column solid background (matches grid's #f3ede3)
        c.fillStyle = "#f3ede3";
        c.fillRect(tableX, rowY, NAME_W, ROW_H);

        // Member name
        c.font = `bold 13px ${FONT}`;
        c.fillStyle = "#222";
        c.fillText(member.name, tableX + 10, rowY + ROW_H / 2 + 5);

        // Week cells
        weekRows.forEach(({ week, avail }, wi) => {
          const cellX   = tableX + NAME_W + wi * COL_W;
          const cellCX  = cellX + COL_W / 2;
          const cellMY  = rowY + ROW_H / 2;
          const isAvail = avail.some(m => m.id === member.id);
          const assigned = (scheduleByWeek[week.id] || []).find(a => a.memberId === member.id);
          const role = assigned?.role;

          if (!isAvail) {
            c.fillStyle = "#ede8df";
            c.fillRect(cellX, rowY, COL_W, ROW_H);
            c.font = `13px ${FONT}`;
            c.fillStyle = "#ccc";
            c.textAlign = "center";
            c.fillText("✗", cellCX, cellMY + 5);
          } else if (role && role !== "—") {
            const rc = RC[role] || { bg:"#f3f4f6", fg:"#374151" };
            // Badge pill
            c.font = `bold 11px ${FONT}`;
            const tw = c.measureText(role).width;
            const bw = tw + 18;
            const bh = 22;
            const bx = cellCX - bw / 2;
            const by = cellMY - bh / 2;
            const r  = bh / 2;
            c.fillStyle = rc.bg;
            c.beginPath();
            c.roundRect(bx, by, bw, bh, r);
            c.fill();
            c.fillStyle = rc.fg;
            c.textAlign = "center";
            c.fillText(role, cellCX, cellMY + 4);
          } else {
            c.font = `13px ${FONT}`;
            c.fillStyle = "#ddd";
            c.textAlign = "center";
            c.fillText("—", cellCX, cellMY + 5);
          }
          c.textAlign = "left";
        });

        // Row divider
        c.strokeStyle = "#e5ddd0";
        c.lineWidth = 0.5;
        c.beginPath();
        c.moveTo(tableX, rowY + ROW_H);
        c.lineTo(tableX + tableW, rowY + ROW_H);
        c.stroke();
      });

      // Outer border
      c.strokeStyle = "#c8bfaa";
      c.lineWidth = 1;
      c.strokeRect(tableX, tableY, tableW, HDR_H + PP_ROW_H + allMembers.length * ROW_H);

      // Download
      await new Promise(resolve => canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.download = `服事表_${monthLabel}.png`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
        resolve();
      }));
    } catch (e) {
      console.error("PNG export failed:", e);
    }
    setDownloading(false);
  };

  return (
    <div className="card" style={{ padding:0 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px 10px", borderBottom:"1px solid var(--border-lt)" }}>
        <div style={{ fontWeight:600, fontSize:14, color:"var(--navy)" }}>排班總覽</div>
        <div style={{ display:"flex", gap:8 }}>
          {dirtyWeeks.size > 0 && (
            <button className="btn btn-sm btn-ok btn-pill" onClick={onSave} disabled={saving}>
              {saving ? "儲存中..." : `儲存修改（${dirtyWeeks.size} 週）`}
            </button>
          )}
          <button className="btn btn-sm btn-ghost btn-pill" onClick={downloadPng} disabled={downloading}
            title="匯出排班表 PNG">
            {downloading ? "匯出中..." : "⬇ 下載 PNG"}
          </button>
        </div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <ScheduleGrid weekRows={weekRows} scheduleByWeek={scheduleByWeek}
          allMembers={allMembers} canEdit={canEdit} onUpdate={onUpdate}
          onUpdatePrePractice={onUpdatePrePractice} />
      </div>
    </div>
  );
}

function ScheduleGrid({ weekRows, scheduleByWeek, allMembers, canEdit, onUpdate, onUpdatePrePractice }) {
  return (
    <table style={{ borderCollapse:"collapse", minWidth:"100%", fontSize:12 }}>
      <thead>
        <tr style={{ background:"var(--cream-md)" }}>
          <th style={{ padding:"8px 12px", textAlign:"left", position:"sticky", left:0, background:"#e8dfd2", zIndex:2, borderBottom:"1px solid var(--border)", whiteSpace:"nowrap", minWidth:90, boxShadow:"2px 0 4px rgba(0,0,0,0.08)" }}>
            成員
          </th>
          {weekRows.map(({ week }) => (
            <th key={week.id} style={{ padding:"8px 8px", textAlign:"center", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap", minWidth:76, color:"var(--navy)", fontWeight:600, fontSize:11 }}>
              {week.label.slice(5).replace("-","/")}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {/* 練前讀經 special row */}
        <tr style={{ background:"#fffde7" }}>
          <td style={{ padding:"6px 12px", position:"sticky", left:0, background:"#fffde7", zIndex:1, whiteSpace:"nowrap", borderBottom:"1px solid #e9e0c8", boxShadow:"2px 0 4px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight:600, fontSize:12, color:"#713f12" }}>練前讀經</div>
          </td>
          {weekRows.map(({ week }) => {
            const pp = (scheduleByWeek[week.id] || []).find(a => a.role === "練前讀經");
            const ppId = pp?.memberId || "";
            // Options: non-PPT scheduled members for this week
            const opts = (scheduleByWeek[week.id] || []).filter(a =>
              a.memberId && a.memberName && a.memberName !== "—" && a.role !== "PPT" && a.role !== "練前讀經"
            );
            return (
              <td key={week.id} style={{ padding:"4px 5px", textAlign:"center", borderBottom:"1px solid #e9e0c8" }}>
                {canEdit ? (
                  <select value={ppId}
                    onChange={e => {
                      const sel = opts.find(a => a.memberId === e.target.value);
                      onUpdatePrePractice(week.id, sel?.memberId || "", sel?.memberName || "");
                    }}
                    style={{ fontSize:11, border:"1px solid #d4b896", borderRadius:4, padding:"2px 3px",
                      background: ppId ? "#fef9c3" : "transparent", color: ppId ? "#713f12" : "var(--text-3)",
                      fontWeight: ppId ? 600 : 400, maxWidth:80, cursor:"pointer" }}>
                    <option value="">—</option>
                    {opts.map(a => <option key={a.memberId} value={a.memberId}>{a.memberName}</option>)}
                  </select>
                ) : pp?.memberName && pp.memberName !== "—" ? (
                  <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:10, fontSize:11,
                    background:"#fef9c3", color:"#713f12", fontWeight:600 }}>{pp.memberName}</span>
                ) : (
                  <span style={{ color:"var(--border)" }}>—</span>
                )}
              </td>
            );
          })}
        </tr>

        {allMembers.map((member, mi) => {
          const rowBg = mi % 2 === 0 ? "var(--bg)" : "var(--cream-lt)";
          return (
            <tr key={member.id}>
              <td style={{ padding:"6px 12px", position:"sticky", left:0, background:"#f3ede3", zIndex:1, whiteSpace:"nowrap", borderBottom:"1px solid var(--border-lt)", boxShadow:"2px 0 4px rgba(0,0,0,0.08)" }}>
                <div style={{ fontWeight:500, fontSize:13 }}>{member.name}</div>
              </td>
              {weekRows.map(({ week, avail }) => {
                const isAvail   = avail.some(m => m.id === member.id);
                // Exclude 練前讀經 from the main role cell — it's shown in the dedicated row above
                const assigned  = (scheduleByWeek[week.id] || []).find(a => a.memberId === member.id && a.role !== "練前讀經");
                const isPP      = (scheduleByWeek[week.id] || []).some(a => a.memberId === member.id && a.role === "練前讀經");
                const role      = assigned?.role;
                const rc        = role ? ROLE_COLORS[role] : null;
                return (
                  <td key={week.id} style={{
                    padding:"4px 5px", textAlign:"center", borderBottom:"1px solid var(--border-lt)",
                    background: !isAvail ? "var(--cream-md)" : rowBg,
                  }}>
                    {!isAvail ? (
                      <span style={{ color:"var(--border)", fontSize:13 }}>✗</span>
                    ) : canEdit ? (
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <select value={role || "—"} onChange={e => onUpdate(week.id, member.id, member.name, e.target.value)}
                          style={{ fontSize:11, border:"1px solid var(--border)", borderRadius:4, padding:"2px 2px",
                            background: rc?.bg || "transparent", color: rc?.color || "var(--text-3)",
                            fontWeight: role ? 600 : 400, maxWidth:72, cursor:"pointer" }}>
                          <option value="—">—</option>
                          {INSTRUMENTS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {isPP && <span style={{ fontSize:9, background:"#fef9c3", color:"#713f12", borderRadius:6, padding:"1px 5px", fontWeight:600 }}>讀</span>}
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        {role ? (
                          <span style={{ display:"inline-block", padding:"2px 7px", borderRadius:10, fontSize:11,
                            background: rc?.bg, color: rc?.color, fontWeight:600 }}>{role}</span>
                        ) : (
                          <span style={{ color:"var(--border)" }}>—</span>
                        )}
                        {isPP && <span style={{ fontSize:9, background:"#fef9c3", color:"#713f12", borderRadius:6, padding:"1px 5px", fontWeight:600 }}>讀</span>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Songs ─────────────────────────────────────────────────────
function SongsView({ week, weeks, weekIdx, setWeekIdx, songs, setSongs, schedule, currentUser, showToast, api }) {
  const canManage = currentUser.role === "admin" || currentUser.role === "leader";
  const [saving, setSaving] = useState(false);
  const [reminding, setReminding] = useState(false);

  const leaderAssignment = schedule.find(s => s.role === "主領");
  const song3 = songs.find(s => Number(s.slot) === 3);
  const song3Missing = !song3?.name;
  const deadline = week ? getDeadlineThursday(week.id) : null;
  const deadlineStr = deadline ? `${deadline.getMonth()+1}/${deadline.getDate()}（週四）截止` : "";

  const sendReminder = async () => {
    setReminding(true);
    try {
      const res = await api("sendSongReminder", {}, { weekId: week.id });
      if (res.skipped) showToast("第三首詩歌已提交，不需提醒");
      else if (res.error) showToast(res.error, "error");
      else showToast(`提醒已傳送給 ${leaderAssignment?.memberName || "主領"}`);
    } finally { setReminding(false); }
  };

  const updateName    = (idx, val) => setSongs(prev => prev.map((s,i) => i===idx ? { ...s, name:val, confirmed:false } : s));
  const updateYoutube = (idx, val) => setSongs(prev => prev.map((s,i) => i===idx ? { ...s, youtube:val } : s));
  const confirmSong   = (idx) => setSongs(prev => prev.map((s,i) => i===idx ? { ...s, confirmed:true } : s));

  const save = async () => {
    setSaving(true);
    try { await api("saveSongs", {}, { weekId:week.id, songs }); showToast("詩歌已儲存！"); }
    finally { setSaving(false); }
  };
  const publish = async () => {
    setSaving(true);
    try { await api("saveSongs", {}, { weekId:week.id, songs }); await api("publishSongs", {}, { weekId:week.id }); showToast("詩歌已公佈！"); }
    finally { setSaving(false); }
  };

  const loadPrevWeek = () => {
    const prevIdx = weeks.findIndex(w => w.id === week.id) - 1;
    if (prevIdx < 0) { showToast("沒有上一週的資料", "error"); return; }
    api("getSongs", { weekId: weeks[prevIdx].id }).then(prev => {
      if (!prev.length) { showToast("上週沒有詩歌資料", "error"); return; }
      setSongs(prev.map((s,i) => ({ weekId: week.id, slot: i+1, name: s.name||"", youtube: s.youtube||"", confirmed: false })));
      showToast("已帶入上週詩歌");
    });
  };

  return (
    <div>
      <div className="sec-hd">
        <div className="sec-h1">選歌記錄</div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <button className="btn btn-sm btn-ghost btn-pill" disabled={weekIdx<=0} onClick={()=>setWeekIdx(i=>i-1)}>‹</button>
          <span style={{ fontSize:12, color:"var(--text-2)", minWidth:60, textAlign:"center" }}>{week?.label||""}</span>
          <button className="btn btn-sm btn-ghost btn-pill" disabled={weekIdx>=weeks.length-1} onClick={()=>setWeekIdx(i=>i+1)}>›</button>
          {canManage && <button className="btn btn-sm btn-ghost btn-pill" onClick={loadPrevWeek}>帶入上週</button>}
        </div>
      </div>
      {canManage && leaderAssignment && (
        <div className="reminder" style={{ alignItems:"center" }}>
          <span className="reminder-icon">🎤</span>
          <div style={{ flex:1, fontSize:13 }}>
            主領：<strong>{leaderAssignment.memberName}</strong>
            {song3Missing
              ? <span style={{ marginLeft:8, color:"var(--danger)" }}>第三首詩歌未提交（{deadlineStr}）</span>
              : <span style={{ marginLeft:8, color:"#15803d" }}>已提交第三首詩歌</span>
            }
          </div>
          {song3Missing && (
            <button className="btn btn-sm btn-ghost btn-pill" disabled={reminding} onClick={sendReminder} style={{ flexShrink:0 }}>
              {reminding ? "傳送中…" : "發提醒"}
            </button>
          )}
        </div>
      )}
      <div className="card">
        {songs.map((s,i) => (
          <div key={i} style={{ paddingBottom: i < songs.length-1 ? 14 : 0, marginBottom: i < songs.length-1 ? 14 : 0, borderBottom: i < songs.length-1 ? "1px solid var(--border-lt)" : "none" }}>
            <div className="srow" style={{ marginBottom: canManage || s.youtube ? 6 : 0 }}>
              <div className="snum">{i+1}</div>
              {canManage
                ? <input className="inp" style={{ flex:1, margin:"0 8px" }} value={s.name} placeholder={`第 ${i+1} 首`} onChange={e=>updateName(i,e.target.value)} />
                : <div style={{ flex:1, fontSize:14, fontWeight:500, color: s.name?"var(--text-1)":"var(--text-3)", margin:"0 8px" }}>{s.name||"尚未選定"}</div>
              }
              <span className={`chip ${s.confirmed&&s.name?"chip-success":!s.name?"chip-neutral":"chip-gold"}`}>
                {s.confirmed&&s.name?"已確認":!s.name?"未選":"待確認"}
              </span>
              {canManage&&s.name&&!s.confirmed && <button className="btn btn-sm btn-ok btn-pill" style={{ marginLeft:6 }} onClick={()=>confirmSong(i)}>確認</button>}
            </div>
            {canManage ? (
              <div style={{ display:"flex", alignItems:"center", gap:6, paddingLeft:36 }}>
                <span style={{ fontSize:12, color:"var(--text-3)", flexShrink:0 }}>YouTube</span>
                <input className="inp" style={{ flex:1, fontSize:12 }} value={s.youtube||""} placeholder="貼上 YouTube 連結（選填）" onChange={e=>updateYoutube(i,e.target.value)} />
                {s.youtube && (
                  <a href={s.youtube} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost btn-pill" style={{ flexShrink:0, fontSize:11 }}>▶ 開啟</a>
                )}
              </div>
            ) : s.youtube ? (
              <div style={{ paddingLeft:36 }}>
                <a href={s.youtube} target="_blank" rel="noreferrer" style={{ fontSize:12, color:"var(--navy)", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontSize:14 }}>▶</span> YouTube 連結
                </a>
              </div>
            ) : null}
          </div>
        ))}
        {canManage && (
          <div style={{ display:"flex", gap:8, marginTop:14 }}>
            <button className="btn btn-ok btn-pill" style={{ flex:1 }} disabled={saving} onClick={publish}>公佈給服事團員</button>
            <button className="btn btn-ghost btn-pill" style={{ flex:1 }} disabled={saving} onClick={save}>儲存草稿</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Returns the Thursday of the previous week relative to weekId (yyyy-mm-dd)
function getDeadlineThursday(weekId) {
  const d = new Date(weekId + "T00:00:00");
  const daysBack = (d.getDay() - 4 + 7) % 7 + 7;
  const deadline = new Date(d);
  deadline.setDate(d.getDate() - daysBack);
  return deadline;
}

const MONTH_ZH = ['','一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
function fmtWeekId(id) {
  const m = String(id).match(/\d{4}-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[1])}月${parseInt(m[2])}日` : id;
}
function fmtMonth(id) {
  const m = String(id).match(/\d{4}-(\d{2})/);
  return m ? (MONTH_ZH[parseInt(m[1])] || `${parseInt(m[1])}月`) : id;
}

// ── My Schedule ───────────────────────────────────────────────
function MyScheduleView({ member, weeks, api, showToast }) {
  // Derive sorted unique months from weeks list
  const months = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const w of weeks) {
      const m = w.id.slice(0, 7);
      if (!seen.has(m)) { seen.add(m); result.push(m); }
    }
    return result;
  }, [weeks]);

  const [selectedMonth, setSelectedMonth] = useState("");
  const [upcomingMap, setUpcomingMap]   = useState({}); // { weekId: roles[] }
  const [songsMap, setSongsMap]         = useState({}); // { weekId: songs[] }
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [expandedWeek, setExpandedWeek] = useState(null);

  // Set selectedMonth once weeks load (useState initializer runs before weeks load)
  useEffect(() => {
    if (!months.length || selectedMonth) return;
    const today = new Date().toISOString().slice(0, 7);
    setSelectedMonth(months.find(m => m === today) || months[0]);
  }, [months]);
  const [drafts, setDrafts]             = useState({}); // { weekId: [{slot,name,youtube}] }
  const [submitting, setSubmitting]     = useState(false);

  // Load this member's full schedule once
  useEffect(() => {
    setLoadingSchedule(true);
    api("getMySchedule", { memberId: member.id }).then(list => {
      const map = {};
      for (const item of (list || [])) map[item.weekId] = item.roles;
      setUpcomingMap(map);
    }).catch(() => {}).finally(() => setLoadingSchedule(false));
  }, [member.id]);

  const monthWeeks = useMemo(
    () => weeks.filter(w => w.id.startsWith(selectedMonth)),
    [weeks, selectedMonth]
  );

  // Load songs for all weeks in selected month (parallel)
  useEffect(() => {
    if (!monthWeeks.length) return;
    const ids = monthWeeks.map(w => w.id);
    Promise.all(ids.map(wid =>
      api("getSongs", { weekId: wid }).then(s => ({ wid, songs: s || [] }))
    )).then(results => {
      setSongsMap(prev => {
        const next = { ...prev };
        for (const { wid, songs } of results) next[wid] = songs;
        return next;
      });
    }).catch(() => {});
  }, [selectedMonth]);

  const monthIdx = months.indexOf(selectedMonth);

  const openSongForm = (weekId, currentSongs, weekIdxInList) => {
    const curr = [1,2,3].map(slot => {
      const s = (currentSongs || []).find(s => Number(s.slot) === slot) || {};
      return { slot, name: s.name || "", youtube: s.youtube || "" };
    });
    const hasBlank = curr.some(s => !s.name);
    const prevWeek = weekIdxInList > 0 ? weeks[weekIdxInList - 1] : null;
    if (hasBlank && prevWeek) {
      api("getSongs", { weekId: prevWeek.id }).then(prev => {
        setDrafts(d => ({ ...d, [weekId]: curr.map(s => {
          if (s.name) return s;
          const p = (prev || []).find(p => Number(p.slot) === s.slot) || {};
          return { ...s, name: p.name || "", youtube: p.youtube || "" };
        }) }));
      }).catch(() => setDrafts(d => ({ ...d, [weekId]: curr })));
    } else {
      setDrafts(d => ({ ...d, [weekId]: curr }));
    }
    setExpandedWeek(weekId);
  };

  const submitSongs = async (weekId) => {
    const draft = drafts[weekId] || [];
    if (!draft.some(s => s.name.trim())) { showToast("請至少填入一首詩歌", "error"); return; }
    setSubmitting(true);
    try {
      await api("submitLeaderSong", {}, { weekId, songs: draft.map(s => ({ name: s.name.trim(), youtube: s.youtube.trim() })) });
      const saved = draft.map(s => ({ weekId, slot: s.slot, name: s.name.trim(), youtube: s.youtube.trim(), confirmed: false }));
      setSongsMap(prev => ({ ...prev, [weekId]: saved }));
      setExpandedWeek(null);
      showToast("已提交！團長收到通知後會發佈給團員");
    } catch(e) {
      showToast("提交失敗：" + e.message, "error");
    } finally { setSubmitting(false); }
  };

  const ytLink = (url) => url ? (
    <a href={url} target="_blank" rel="noreferrer"
       style={{ fontSize:10, background:"#FF0000", color:"#fff", borderRadius:3, padding:"2px 7px", textDecoration:"none", fontWeight:700, flexShrink:0 }}>
      YouTube
    </a>
  ) : null;

  const renderWeekCard = (w, isPast = false) => {
    const roles    = upcomingMap[w.id] || [];
    const isServing = roles.length > 0;
    const isLeader  = roles.includes("主領");
    const wSongs    = songsMap[w.id] || [];
    const hasSongs  = wSongs.some(s => s.name);
    const isExpanded = expandedWeek === w.id;
    const draft     = drafts[w.id] || [1,2,3].map(slot => ({ slot, name:"", youtube:"" }));
    const deadline  = getDeadlineThursday(w.id);
    const deadlineStr = `${deadline.getMonth()+1}月${deadline.getDate()}日（週四）`;
    const isPastDeadline = new Date() > deadline;
    const wIdxGlobal = weeks.findIndex(wk => wk.id === w.id);
    const dm = w.id.match(/(\d{4})-(\d{2})-(\d{2})/);
    const fullDate = dm ? `${dm[1]}年${parseInt(dm[2])}月${parseInt(dm[3])}日` : w.id;

    return (
      <div key={w.id} style={{ margin:"0 16px 12px", borderRadius:"var(--r-lg)", overflow:"hidden", boxShadow:"var(--sh-md)", opacity: isPast ? 0.6 : 1 }}>
        <div className="msc-hd" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background: isPast ? "var(--text-3)" : undefined }}>
          <div>
            {isServing && !isPast && <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", marginBottom:2 }}>即將服事</div>}
            <div style={{ fontFamily:"var(--serif)", fontSize:16, color:"#fff" }}>{fullDate}</div>
          </div>
          {isServing && (
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end" }}>
              {roles.map((r,i) => <span key={i} className="chip chip-gold" style={{ fontSize:11 }}>{r}</span>)}
            </div>
          )}
        </div>

        <div className="msc-bd">
          {/* Songs section */}
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", marginBottom:6 }}>本週詩歌</div>

            {isLeader ? (
              <>
                {hasSongs && !isExpanded && (
                  <div style={{ marginBottom:8 }}>
                    {wSongs.filter(s => s.name).map((s,i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                        <span style={{ fontSize:13, color:"var(--text-1)", flex:1 }}>{s.name}</span>
                        {ytLink(s.youtube)}
                      </div>
                    ))}
                  </div>
                )}
                {!hasSongs && !isExpanded && (
                  <div style={{ fontSize:12, color:"var(--text-3)", marginBottom:8 }}>尚未提交</div>
                )}
                {!isPast && (!isExpanded ? (
                  <button className="btn btn-sm btn-ghost btn-pill" style={{ fontSize:12 }}
                    onClick={() => openSongForm(w.id, wSongs, wIdxGlobal)}>
                    {hasSongs ? "更新選歌" : "選歌 →"}
                  </button>
                ) : (
                  <>
                    <div style={{ fontSize:11, color: isPastDeadline&&!hasSongs ? "var(--danger)" : "var(--text-3)", marginBottom:10 }}>
                      截止：{deadlineStr}
                    </div>
                    {draft.map((s, i) => (
                      <div key={i} style={{ marginBottom:10, paddingBottom:10, borderBottom: i<2 ? "1px solid var(--border-lt)" : "none" }}>
                        <div style={{ fontSize:12, fontWeight:600, color:"var(--text-2)", marginBottom:6 }}>第 {i+1} 首</div>
                        <input className="inp" style={{ marginBottom:6 }} value={s.name}
                          onChange={e => setDrafts(d => ({ ...d, [w.id]: d[w.id].map((x,j) => j===i ? { ...x, name:e.target.value } : x) }))}
                          placeholder="歌名" />
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <input className="inp" style={{ flex:1, fontSize:12 }} value={s.youtube}
                            onChange={e => setDrafts(d => ({ ...d, [w.id]: d[w.id].map((x,j) => j===i ? { ...x, youtube:e.target.value } : x) }))}
                            placeholder="YouTube 連結（選填）" />
                          {s.youtube && <a href={s.youtube} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost btn-pill" style={{ flexShrink:0, fontSize:11 }}>▶</a>}
                        </div>
                      </div>
                    ))}
                    <div style={{ display:"flex", gap:8 }}>
                      <button className="btn btn-sm btn-ghost btn-pill" style={{ flex:1 }}
                        onClick={() => setExpandedWeek(null)}>取消</button>
                      <button className="btn btn-ok btn-pill" style={{ flex:2 }} disabled={submitting}
                        onClick={() => submitSongs(w.id)}>
                        {submitting ? "提交中…" : hasSongs ? "更新並重新提交" : "提交詩歌給團長"}
                      </button>
                    </div>
                    {isPastDeadline && !hasSongs && (
                      <div style={{ fontSize:11, color:"var(--danger)", marginTop:6, textAlign:"center" }}>已超過截止日期，請盡快提交</div>
                    )}
                  </>
                ))}
              </>
            ) : hasSongs ? (
              wSongs.filter(s => s.name).map((s,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:13, color:"var(--text-1)", flex:1 }}>{s.name}</span>
                  {ytLink(s.youtube)}
                </div>
              ))
            ) : (
              <div style={{ fontSize:12, color:"var(--text-3)" }}>尚未公佈</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const today = new Date().toISOString().slice(0, 10);
  const futureWeeks = monthWeeks.filter(w => w.id >= today);
  const pastWeeks   = monthWeeks.filter(w => w.id < today);

  return (
    <div>
      <div className="sec-hd" style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div className="sec-h1">我的班表</div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <button className="btn btn-sm btn-ghost btn-pill" disabled={monthIdx <= 0}
            onClick={() => setSelectedMonth(months[monthIdx - 1])}>‹</button>
          <span style={{ fontSize:15, fontFamily:"var(--serif)", color:"var(--navy)", minWidth:40, textAlign:"center" }}>
            {MONTH_ZH[parseInt(selectedMonth.slice(5, 7))] || selectedMonth}
          </span>
          <button className="btn btn-sm btn-ghost btn-pill" disabled={monthIdx >= months.length - 1}
            onClick={() => setSelectedMonth(months[monthIdx + 1])}>›</button>
        </div>
      </div>

      {loadingSchedule ? (
        <div className="empty"><div className="empty-icon">⏳</div><div>載入中…</div></div>
      ) : monthWeeks.length === 0 ? (
        <div className="empty"><div className="empty-icon">📅</div><div>本月沒有排班資料</div></div>
      ) : (
        <>
          {futureWeeks.map(w => renderWeekCard(w, false))}
          {pastWeeks.length > 0 && (
            <>
              {futureWeeks.length > 0 && <div style={{ margin:"4px 16px 12px", fontSize:11, color:"var(--text-3)", fontWeight:600 }}>已完成</div>}
              {pastWeeks.map(w => renderWeekCard(w, true))}
            </>
          )}
        </>
      )}
    </div>
  );
}
