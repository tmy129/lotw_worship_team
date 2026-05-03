// ============================================================
//  敬拜團隊管理後台 — Google Apps Script 後端
// ============================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

const SHEETS = {
  MEMBERS:       'Members',
  WEEKS:         'Weeks',
  VOTES:         'Votes',
  SCHEDULE:      'Schedule',
  SONGS:         'Songs',
  VOTE_SETTINGS: 'VoteSettings',
};

// ── Router ───────────────────────────────────────────────────
function doGet(e)  { return route(e); }
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    switch (action) {
      case "saveMember":         return ok(saveMember(payload));
      case "deleteMember":       return ok(deleteMember(payload.id));
      case "saveVoteSetting":    return ok(saveVoteSetting(payload));
      case "deleteVoteSetting":  return ok(deleteVoteSetting(payload.id));
      case "castVote":           return ok(castVote(payload));
      case "saveSchedule":       return ok(saveSchedule(payload));
      case "confirmSchedule":    return ok(confirmSchedule(payload));
      case "saveSongs":          return ok(saveSongs(payload));
      case "publishSongs":       return ok(publishSongs(payload));
      case "submitLeaderSong":   return ok(submitLeaderSong(payload));
      case "sendSongReminder":   return ok(sendSongReminder(payload));
      case "sendReminder":       return ok(sendReminder(payload));
      case "runAISchedule":      return ok(handleRunAISchedule(payload));
      case "bindLineUser":       return ok(bindLineUser(payload));
      default:                   return err("Unknown action: " + action);
    }
  } catch (e) {
    return err(e.message);
  }
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data ?? null }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route(e) {
  const params = e.parameter || {};
  const body   = (() => { try { return JSON.parse(e.postData?.contents || '{}'); } catch { return {}; } })();
  const action = params.action || body.action;

  const handlers = {
    getMembers:        getMembers,
    saveMember:        () => saveMember(body),
    deleteMember:      () => deleteMember(body.id),
    getWeeks:          getWeeks,
    getWeeksByMonths:  () => getWeeksByMonths(params.months),
    saveWeek:          () => saveWeek(body),
    getVoteSettings:   getVoteSettings,
    saveVoteSetting:   () => saveVoteSetting(body),
    deleteVoteSetting: () => deleteVoteSetting(body.id),
    getVotes:          () => getVotes(params.weekId),
    getVotesByMember:  () => getVotesByMember(params.memberId, params.months),
    getVoteSummary:    () => getVoteSummary(params.months),
    castVote:          () => castVote(body),
    castVoteBulk:      () => castVoteBulk(body),
    getSchedule:            () => getSchedule(params.weekId),
    getMySchedule:          () => getMySchedule(params.memberId),
    getPrePracticeHistory:  () => getPrePracticeHistory(),
    saveSchedule:           () => saveSchedule(body),
    confirmSchedule:        () => confirmSchedule(body),
    getSongs:          () => getSongs(params.weekId),
    saveSongs:         () => saveSongs(body),
    publishSongs:      () => publishSongs(body),
    submitLeaderSong:  () => submitLeaderSong(body),
    sendSongReminder:  () => sendSongReminder(body),
    sendReminder:      () => sendReminder(body),
    loginWithLine:     () => loginWithLine(params),
    bindLineUser:      () => bindLineUser(body),
  };

  try {
    const fn = handlers[action];
    if (!fn) return json({ ok: false, error: `Unknown action: ${action}` });
    return json({ ok: true, data: fn() });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 初始化 ───────────────────────────────────────────────────
function initSheets() {
  const defs = {
    Members:      ['id','name','role','instruments','email','constraints','avColor','initials','active','canPPT','lineUserId'],
    Weeks:        ['id','label','practiceTime','serviceTime','status'],
    Votes:        ['weekId','memberId','vote','updatedAt'],
    Schedule:     ['weekId','role','memberId','memberName','updatedAt','confirmedAt'],
    Songs:        ['weekId','slot','name','confirmed','youtube'],
    VoteSettings: ['id','months','deadline','openedAt','openedBy','status','note'],
  };
  Object.entries(defs).forEach(([name, headers]) => {
    let sh = SS.getSheetByName(name);
    if (!sh) {
      sh = SS.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length)
        .setBackground('#4A4A8A').setFontColor('#FFFFFF').setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  return 'Sheets initialized';
}

// ── 工具 ─────────────────────────────────────────────────────
function sheetToObjects(sheetName) {
  const sh = SS.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const [headers, ...rows] = sh.getDataRange().getValues();
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      // Google Sheets 會把某些欄位自動轉成 Date 物件，統一轉回字串
      if (val instanceof Date) {
        // 只有 id/weekId/memberId 類的 key 才強制轉純字串，避免破壞 updatedAt 等日期欄位
        const isIdField = /^id$|Id$/.test(h);
        if (isIdField) {
          // 轉成 ISO 後只取日期部分不夠，直接取 raw text
          // 用 getDisplayValues 會更準確，但這裡改用格式化避免時區問題
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
      }
      obj[h] = val;
    });
    return obj;
  });
}

// ── 全域 weekId 正規化：統一轉成 yyyy-mm-dd 補零格式 ─────────
function normalizeWeekId(rawId) {
  const s = String(rawId).trim();
  // 已是 yyyy-mm-dd 格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 去掉時間部分（ISO 格式 2026-06-05T16:...）
  const dateOnly = s.split('T')[0].split(' ')[0];
  // 嘗試解析並格式化成 yyyy-mm-dd
  try {
    const parts = dateOnly.split('-');
    if (parts.length === 3) {
      const y = parts[0].padStart(4, '0');
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    // 嘗試用 Date 解析
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
  } catch(e) {}
  return s;
}

// 取得工作表的顯示值（純文字，不受 Sheets 型別轉換影響）
function sheetToObjectsRaw(sheetName) {
  const sh = SS.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const rows    = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getDisplayValues();
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(row[i]).trim(); });
    return obj;
  });
}

function findRowById(sheetName, id) {
  const sh = SS.getSheetByName(sheetName);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return { sheet: sh, rowIdx: i + 1, data: data[i] };
  }
  return null;
}

function genId(prefix) { return prefix + Date.now().toString(36); }

// ── Members ───────────────────────────────────────────────────
function getMembers() {
  return sheetToObjects(SHEETS.MEMBERS)
    .filter(m => m.active !== false && m.active !== 'FALSE')
    .map(m => ({
      ...m,
      instruments: String(m.instruments).split(','),
      canPPT: m.canPPT === true || m.canPPT === 'TRUE',
    }));
}

function saveMember(body) {
  const sh = SS.getSheetByName(SHEETS.MEMBERS);
  const instruments = Array.isArray(body.instruments) ? body.instruments.join(',') : body.instruments;
  const canPPT = body.canPPT ? true : false;
  if (body.id) {
    const found = findRowById(SHEETS.MEMBERS, body.id);
    if (found) {
      sh.getRange(found.rowIdx, 1, 1, 10).setValues([[
        body.id, body.name, body.role, instruments,
        body.email, body.constraints, body.avColor, body.initials, true, canPPT
      ]]);
      return { updated: true, id: body.id };
    }
  }
  const id = genId('m');
  const colors = ['av-purple','av-teal','av-coral','av-blue','av-amber'];
  sh.appendRow([id, body.name, body.role || 'member', instruments, body.email,
    body.constraints || '無特殊限制', colors[Math.floor(Math.random()*colors.length)],
    body.name?.slice(-1) || '?', true, canPPT]);
  return { created: true, id };
}

function deleteMember(id) {
  const found = findRowById(SHEETS.MEMBERS, id);
  if (!found) return { error: 'not found' };
  found.sheet.getRange(found.rowIdx, 9).setValue(false);
  return { deleted: true };
}

// ── Weeks ─────────────────────────────────────────────────────
function normalizeWeek(w) {
  const normId = normalizeWeekId(String(w.id));
  return { ...w, id: normId, label: normId };
}

function getWeeks() {
  return sheetToObjects(SHEETS.WEEKS).map(normalizeWeek);
}

function getWeeksByMonths(monthsParam) {
  if (!monthsParam) return [];
  const months = String(monthsParam).split(',').map(Number);
  return sheetToObjects(SHEETS.WEEKS)
    .filter(w => {
      const match = String(w.id).match(/\d{4}-(\d{1,2})-/);
      return match && months.includes(parseInt(match[1]));
    })
    .map(normalizeWeek);
}

function saveWeek(body) {
  const sh = SS.getSheetByName(SHEETS.WEEKS);
  const id    = normalizeWeekId(String(body.id || genId('w')));
  const label = id; // label mirrors the normalized id
  if (body.id) {
    const found = findRowById(SHEETS.WEEKS, body.id);
    if (found) {
      sh.getRange(found.rowIdx, 1, 1, 5).setValues([[
        id, label, body.practiceTime, body.serviceTime, body.status || 'upcoming'
      ]]);
      return { updated: true };
    }
  }
  sh.appendRow([id, label, body.practiceTime, body.serviceTime, 'upcoming']);
  return { created: true, id };
}

// ── VoteSettings ──────────────────────────────────────────────
function getVoteSettings() {
  return sheetToObjects(SHEETS.VOTE_SETTINGS).map(s => ({
    ...s,
    months: String(s.months).split(',').map(Number),
    deadline: s.deadline ? new Date(s.deadline).toISOString().split('T')[0] : '',
    openedAt: s.openedAt ? new Date(s.openedAt).toISOString() : '',
  }));
}

function saveVoteSetting(body) {
  const sh = SS.getSheetByName(SHEETS.VOTE_SETTINGS);
  const months = Array.isArray(body.months) ? body.months.join(',') : String(body.months);
  const deadline = body.deadline ? new Date(body.deadline) : '';
  const now = new Date();

  if (body.id) {
    const found = findRowById(SHEETS.VOTE_SETTINGS, body.id);
    if (found) {
      sh.getRange(found.rowIdx, 1, 1, 7).setValues([[
        body.id, months, deadline,
        found.data[3], found.data[4],
        body.status || found.data[5],
        body.note || found.data[6] || ''
      ]]);
      return { updated: true };
    }
  }

  const id = genId('vs');
  sh.appendRow([id, months, deadline, now, body.openedBy || '', 'open', body.note || '']);
  return { created: true, id };
}

function deleteVoteSetting(id) {
  const found = findRowById(SHEETS.VOTE_SETTINGS, id);
  if (!found) return { error: 'not found' };
  found.sheet.deleteRow(found.rowIdx);
  return { deleted: true };
}

// ── Votes ─────────────────────────────────────────────────────
function getVotes(weekId) {
  // 用 raw display values 讀取，避免 Sheets 把 weekId 自動轉成 Date 物件
  return sheetToObjectsRaw(SHEETS.VOTES).filter(v => v.weekId === String(weekId).trim());
}

function getVotesByMember(memberId, monthsParam) {
  // 用 raw display values，memberId 存的是 email 字串，不受日期轉換影響
  const all = sheetToObjectsRaw(SHEETS.VOTES);
  const filtered = memberId ? all.filter(v => String(v.memberId).trim() === String(memberId).trim()) : all;
  if (!monthsParam) return filtered;
  const weeks = getWeeksByMonths(monthsParam);
  const weekIds = new Set(weeks.map(w => String(w.id).trim()));
  return filtered.filter(v => {
    const vwId = normalizeWeekId(String(v.weekId).trim());
    return weekIds.has(vwId);
  });
}

function getVoteSummary(monthsParam) {
  if (!monthsParam) return { weeks: [], summary: {} };
  const weeks = getWeeksByMonths(monthsParam);
  const allVotes = sheetToObjectsRaw(SHEETS.VOTES);
  const weekIds = new Set(weeks.map(w => String(w.id).trim()));

  const votes = allVotes.filter(v => weekIds.has(normalizeWeekId(String(v.weekId).trim())));
  const summary = {};
  weeks.forEach(w => { summary[String(w.id).trim()] = {}; });
  votes.forEach(v => {
    const wKey = normalizeWeekId(String(v.weekId).trim());
    const mKey = String(v.memberId).trim();
    if (wKey && summary[wKey] !== undefined) summary[wKey][mKey] = v.vote;
  });
  return { weeks, summary };
}

function castVote(body) {
  const { memberId, vote } = body;
  // 正規化 weekId：統一格式為 "yyyy-mm-dd"（補零）
  const weekId = normalizeWeekId(String(body.weekId).trim());
  const sh = SS.getSheetByName(SHEETS.VOTES);
  // 用 getDisplayValues 讀取，避免 Sheets 把已存的 weekId 轉成 Date 物件
  const displayVals = sh.getLastRow() > 1
    ? sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues()
    : [[]];
  for (let i = 1; i < displayVals.length; i++) {
    const rowWkId = normalizeWeekId(String(displayVals[i][0]).trim());
    const rowMbId = String(displayVals[i][1]).trim();
    if (rowWkId === weekId && rowMbId === String(memberId).trim()) {
      sh.getRange(i + 1, 3, 1, 2).setValues([[vote, new Date()]]);
      return { updated: true };
    }
  }
  sh.appendRow([weekId, String(memberId).trim(), vote, new Date()]);
  return { created: true };
}

function castVoteBulk(body) {
  const { memberId, weekIds, vote } = body;
  if (!weekIds || !weekIds.length) return { saved: 0 };
  weekIds.forEach(weekId => castVote({ weekId, memberId, vote }));
  return { saved: weekIds.length };
}

// ── Schedule ──────────────────────────────────────────────────
function getSchedule(weekId) {
  // Use sheetToObjectsRaw (getDisplayValues) so weekId cells that Google Sheets
  // auto-converted to Date objects are still returned as their display string "yyyy-mm-dd".
  const wid = String(weekId).trim();
  const rows = sheetToObjectsRaw(SHEETS.SCHEDULE).filter(s => s.weekId === wid);

  // Deduplicate by role — last row wins.
  // saveSchedule appends rows at the bottom after deleting old ones, so the last
  // row for each role is always the most recently saved. This guards against any
  // stale rows that survived before the getDisplayValues fix was deployed.
  const byRole = {};
  rows.forEach(row => { byRole[row.role] = row; });
  return Object.values(byRole);
}

// Returns all weeks where this member is assigned, with their roles.
function getMySchedule(memberId) {
  const mid = String(memberId).trim();
  const allRows = sheetToObjectsRaw(SHEETS.SCHEDULE);
  const allWeeks = getWeeks();
  const result = [];
  for (const week of allWeeks) {
    const weekRows = allRows.filter(s => s.weekId === week.id && (s.memberId === mid || s.memberName === mid));
    if (weekRows.length) {
      result.push({ weekId: week.id, roles: weekRows.map(r => r.role) });
    }
  }
  return result;
}

// Returns every 練前讀經 assignment across all weeks, keyed by memberId → latest weekId.
// Used by the frontend to determine who is "due" to lead next.
function getPrePracticeHistory() {
  const rows = sheetToObjectsRaw(SHEETS.SCHEDULE).filter(s => s.role === "練前讀經");

  // Step 1: deduplicate per week — last row in the sheet wins (same logic as getSchedule).
  // This prevents a stale row from a previous AI run (different member, same week)
  // from polluting a second member's history.
  const byWeek = {};
  rows.forEach(r => { if (r.memberId) byWeek[r.weekId] = r; });

  // Step 2: for each member, keep the latest week they were assigned.
  const byMember = {};
  Object.values(byWeek).forEach(r => {
    if (!byMember[r.memberId] || r.weekId > byMember[r.memberId]) {
      byMember[r.memberId] = r.weekId;
    }
  });
  return byMember; // { memberId: "2026-03-30", ... }
}

function saveSchedule(body) {
  const { weekId, assignments } = body;
  const wid = String(weekId).trim();
  const sh = SS.getSheetByName(SHEETS.SCHEDULE);
  // Use getDisplayValues so the date-converted cells still match the "yyyy-mm-dd" string.
  const all = sh.getDataRange().getDisplayValues();
  for (let i = all.length - 1; i >= 1; i--) {
    if (all[i][0].trim() === wid) sh.deleteRow(i + 1);
  }
  const now = new Date();
  assignments.forEach(a => sh.appendRow([wid, a.role, a.memberId || '', a.memberName, now, '']));
  return { saved: true };
}

function confirmSchedule(body) {
  const { weekId } = body;
  const wid = String(weekId).trim();
  const schedule = getSchedule(wid);
  const weeks = getWeeks();
  const week = weeks.find(w => w.id === wid);
  const members = getMembers();
  const sh = SS.getSheetByName(SHEETS.SCHEDULE);
  const all = sh.getDataRange().getDisplayValues();
  for (let i = 1; i < all.length; i++) {
    if (all[i][0].trim() === wid) sh.getRange(i + 1, 6).setValue(new Date()); // col 6 = confirmedAt
  }
  const calendarResults = createCalendarEvents(week, schedule, members);
  const wFound = findRowById(SHEETS.WEEKS, wid);
  if (wFound) SS.getSheetByName(SHEETS.WEEKS).getRange(wFound.rowIdx, 5).setValue('confirmed');
  return { confirmed: true, calendarEvents: calendarResults };
}

function createCalendarEvents(week, schedule, members) {
  const calendar = CalendarApp.getDefaultCalendar();
  const results = [];
  const assignedMembers = schedule
    .map(s => members.find(m => m.id === s.memberId || m.name === s.memberName))
    .filter(Boolean);
  const uniqueMembers = [...new Map(assignedMembers.map(m => [m.id, m])).values()];
  const guestEmails = uniqueMembers.map(m => m.email).filter(e => e?.includes('@'));

  ['practice','service'].forEach(type => {
    const timeStr = type === 'practice' ? week?.practiceTime : week?.serviceTime;
    if (!timeStr || timeStr === '無練習') return;
    try {
      const start = parseDatetime(timeStr);
      if (!start) return;
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const title = type === 'practice' ? `敬拜團練習 — ${week.label}` : `主日敬拜服事 — ${week.label}`;
      const event = calendar.createEvent(title, start, end, {
        description: buildEventDescription(week, schedule, type),
        guests: guestEmails.join(','), sendInvites: true,
      });
      results.push({ type, eventId: event.getId() });
    } catch (e) { results.push({ type, error: e.message }); }
  });
  return results;
}

function buildEventDescription(week, schedule, type) {
  return [
    type === 'practice' ? '【週四練習】' : '【週六主日敬拜服事】',
    `📅 ${week.label}`, '',
    '🎵 本週服事名單：',
    ...schedule.map(s => `  ${s.role}：${s.memberName}`),
    '', type === 'practice' ? '請準時出席，若有狀況請提前告知管理員。' : '請提前30分鐘到場準備，感謝你的服事！',
  ].join('\n');
}

function parseDatetime(str) {
  const m1 = String(str).match(/(\d{4})\/(\d+)\/(\d+)[^0-9]*(\d+):(\d+)/);
  if (m1) return new Date(+m1[1], +m1[2]-1, +m1[3], +m1[4], +m1[5]);
  const m2 = String(str).match(/(\d+)\/(\d+)[^0-9]*(\d+):(\d+)/);
  if (m2) return new Date(new Date().getFullYear(), +m2[1]-1, +m2[2], +m2[3], +m2[4]);
  return null;
}

// ── Songs ─────────────────────────────────────────────────────
function normalizeSongWeekId(cellVal) {
  if (cellVal instanceof Date) return Utilities.formatDate(cellVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return normalizeWeekId(String(cellVal).trim());
}

function getSongs(weekId) {
  const wid = normalizeWeekId(String(weekId).trim());
  return sheetToObjectsRaw(SHEETS.SONGS)
    .filter(s => normalizeWeekId(s.weekId) === wid)
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map(s => ({ ...s, youtube: s.youtube || '' }));
}

function deleteSongRows(sh, wid) {
  const all = sh.getDataRange().getValues();
  for (let i = all.length - 1; i >= 1; i--) {
    if (normalizeSongWeekId(all[i][0]) === wid) sh.deleteRow(i + 1);
  }
}

function saveSongs(body) {
  const { weekId, songs } = body;
  const wid = normalizeWeekId(String(weekId).trim());
  const sh = SS.getSheetByName(SHEETS.SONGS);
  deleteSongRows(sh, wid);
  songs.forEach((s, idx) => sh.appendRow([wid, idx+1, s.name||'', s.confirmed||false, s.youtube||'']));
  return { saved: true };
}

function publishSongs(body) {
  const { weekId } = body;
  const wid = String(weekId).trim();
  const songs = getSongs(wid);
  const schedule = getSchedule(wid);
  const members = getMembers();

  const songList = songs.map((s, i) => {
    const line = `${i + 1}. ${s.name || '（待定）'}`;
    return s.youtube ? `${line}\n   ${s.youtube}` : line;
  }).join('\n');

  const week = getWeeks().find(w => w.id === wid);
  const msg = `【詩歌公告】${week?.label || wid}\n\n本週詩歌如下：\n${songList}\n\n感謝你的服事！`;

  const assignedIds = new Set(schedule.map(s => s.memberId).filter(Boolean));
  const assignedNames = new Set(schedule.map(s => s.memberName).filter(Boolean));
  const recipients = members.filter(m => assignedIds.has(m.id) || assignedNames.has(m.name));

  let notified = 0;
  recipients.forEach(m => {
    try { sendLineMessage(m.lineUserId, msg); notified++; }
    catch(e) { Logger.log('publishSongs LINE notify failed: ' + m.name + ' ' + e.message); }
  });
  return { published: true, sentTo: notified };
}

// 主領提交第三首詩歌，並通知團長/管理員
// ── LINE Messaging API ────────────────────────────────────────
// Requires LINE_MESSAGING_TOKEN in Script Properties (Long-lived Channel Access Token).
function sendLineMessage(lineUserId, text) {
  if (!lineUserId) return { skipped: true, reason: 'no lineUserId' };
  const token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) throw new Error('LINE_MESSAGING_TOKEN not set in Script Properties');
  const resp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('LINE push failed: ' + resp.getContentText());
  }
  return { sent: true };
}

function submitLeaderSong(body) {
  const { weekId, songs } = body;
  const wid = normalizeWeekId(String(weekId).trim());
  const sh = SS.getSheetByName(SHEETS.SONGS);
  deleteSongRows(sh, wid);
  (songs || []).forEach((s, idx) => sh.appendRow([wid, idx + 1, s.name || '', false, s.youtube || '']));

  const members = getMembers();
  const recipients = members.filter(m => m.role === 'leader' || m.role === 'admin');
  const week = getWeeks().find(w => w.id === wid);
  const songList = (songs || []).map((s, i) => {
    const line = `${i+1}. ${s.name || '（未填）'}`;
    return s.youtube ? `${line}\n   ${s.youtube}` : line;
  }).join('\n');
  const msg = `【選歌通知】${week?.label || wid}\n\n主領已提交本週三首詩歌：\n${songList}\n\n請登入系統確認後發佈。`;

  let notified = 0;
  recipients.forEach(m => {
    try { sendLineMessage(m.lineUserId, msg); notified++; }
    catch(e) { Logger.log('submitLeaderSong LINE notify failed: ' + m.name + ' ' + e.message); }
  });
  return { submitted: true, notified };
}

// 發提醒給主領（若第三首歌尚未提交）
function sendSongReminder(body) {
  const { weekId } = body;
  const wid = String(weekId).trim();
  const songs = getSongs(wid);
  const song3 = songs.find(s => Number(s.slot) === 3);
  if (song3?.name) return { skipped: true, reason: '已有第三首詩歌' };

  const schedule = getSchedule(wid);
  const leaderAssignment = schedule.find(s => s.role === '主領');
  if (!leaderAssignment) return { error: '該週找不到主領' };

  const members = getMembers();
  const leader = members.find(m => m.id === leaderAssignment.memberId || m.name === leaderAssignment.memberName);
  if (!leader) return { error: '找不到主領成員資料' };

  const week = getWeeks().find(w => w.id === wid);
  const msg = `【選歌提醒】${week?.label || wid}\n\n親愛的 ${leader.name}，\n\n提醒您本週第三首詩歌尚未提交，請盡快登入系統完成選歌，讓團員有時間準備。`;
  sendLineMessage(leader.lineUserId, msg);
  return { sent: true, to: leader.name };
}

// 每週四自動檢查：若主領尚未提交第三首歌則發提醒
// 設定方式：在 Apps Script 編輯器執行一次 installSongReminderTrigger()
function autoSongReminderCheck() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const weeks = getWeeks();
  for (const week of weeks) {
    const serviceDate = new Date(week.id + 'T00:00:00');
    const dow = serviceDate.getDay(); // 0=Sun … 6=Sat
    const daysBack = (dow - 4 + 7) % 7 + 7; // back to PREVIOUS week's Thursday
    const deadline = new Date(serviceDate);
    deadline.setDate(serviceDate.getDate() - daysBack);
    const deadlineStr = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (deadlineStr === today) {
      try { sendSongReminder({ weekId: week.id }); } catch(e) { Logger.log(e.message); }
    }
  }
}

// 執行一次以安裝每週四自動提醒觸發器
function installSongReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoSongReminderCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoSongReminderCheck')
    .timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(9).create();
  return 'Trigger installed: autoSongReminderCheck every Thursday at 9am';
}

// Run once in Apps Script editor to add the youtube column to existing Songs sheet
function migrateAddYoutube() {
  const sh = SS.getSheetByName(SHEETS.SONGS);
  if (!sh) return 'Songs sheet not found';
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.includes('youtube')) return 'Already has youtube column';
  sh.getRange(1, headers.length + 1).setValue('youtube');
  return 'Added youtube column at column ' + (headers.length + 1);
}

function sendReminder(body) {
  const { weekId } = body;
  return { sent: false, reason: 'use sendSongReminder instead' };
}

// ── LINE Login ────────────────────────────────────────────────
// Requires LINE_CHANNEL_ID and LINE_CHANNEL_SECRET in Script Properties.
function loginWithLine(params) {
  const { code, code_verifier, redirect_uri } = params;
  const props = PropertiesService.getScriptProperties();
  const channelId     = props.getProperty('LINE_CHANNEL_ID');
  const channelSecret = props.getProperty('LINE_CHANNEL_SECRET');
  if (!channelId || !channelSecret) throw new Error('LINE channel not configured');

  const tokenResp = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type:    'authorization_code',
      code,
      redirect_uri,
      client_id:     channelId,
      client_secret: channelSecret,
      code_verifier,
    },
    muteHttpExceptions: true,
  });
  const tokenData = JSON.parse(tokenResp.getContentText());
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

  const profileResp = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
    muteHttpExceptions: true,
  });
  const profile = JSON.parse(profileResp.getContentText());
  if (!profile.userId) throw new Error('LINE profile fetch failed');

  const members = getMembers();
  const member = members.find(m => m.lineUserId === profile.userId) || null;
  return { lineUserId: profile.userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, member };
}

function bindLineUser(body) {
  const { memberId, lineUserId } = body;
  const sh = SS.getSheetByName(SHEETS.MEMBERS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  let lineCol = headers.indexOf('lineUserId') + 1;
  if (!lineCol) {
    lineCol = headers.length + 1;
    sh.getRange(1, lineCol).setValue('lineUserId');
  }
  const found = findRowById(SHEETS.MEMBERS, memberId);
  if (!found) throw new Error('Member not found');
  sh.getRange(found.rowIdx, lineCol).setValue(lineUserId);
  const members = getMembers();
  return { bound: true, member: members.find(m => m.id === memberId) || null };
}

// Run once in Apps Script editor to add lineUserId column to existing Members sheet.
function migrateAddLineUserId() {
  const sh = SS.getSheetByName(SHEETS.MEMBERS);
  if (!sh) return 'Members sheet not found';
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.includes('lineUserId')) return 'Already has lineUserId column';
  sh.getRange(1, headers.length + 1).setValue('lineUserId');
  return 'Added lineUserId column at column ' + (headers.length + 1);
}

function handleRunAISchedule(payload) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not set in Script Properties");

  const response = UrlFetchApp.fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + apiKey },
      payload: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: payload.prompt }],
        max_tokens: 4000,
        temperature: 0.3,
      }),
      muteHttpExceptions: true,
    }
  );

  const data = JSON.parse(response.getContentText());
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || "";
}