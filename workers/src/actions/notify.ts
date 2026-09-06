import type { Client } from "pg";
import type { Env } from "../index";
import { leadersAndAdmins, pushToMembers, servingMembers, type PushOutcome } from "./line";
import { getSongs } from "./songs";
import { getSchedule } from "./schedule";

const songLines = (songs: { name: string; youtube: string }[], fallback: string) =>
  songs.map((s, i) => {
    const line = `${i + 1}. ${s.name || fallback}`;
    return s.youtube ? `${line}\n   ${s.youtube}` : line;
  }).join("\n");

/** Announces the week's song list to everyone serving that week. */
export async function publishSongs(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<{ published: boolean } & PushOutcome> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");
  const songs = await getSongs(client, { weekId });
  const text = `【詩歌公告】${weekId}\n\n本週詩歌如下：\n${songLines(songs, "（待定）")}\n\n感謝你的服事！`;
  const outcome = await pushToMembers(env, await servingMembers(client, weekId), text);
  return { published: true, ...outcome };
}

/** Tells the leaders and admins that a worship leader has picked the songs. */
export async function notifyLeaderSongs(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<PushOutcome> {
  const weekId = String(params.weekId ?? "").trim();
  const songs = await getSongs(client, { weekId });
  const text = `【選歌通知】${weekId}\n\n主領已提交本週三首詩歌：\n${songLines(songs, "（未填）")}\n\n請登入系統確認後發佈。`;
  return pushToMembers(env, await leadersAndAdmins(client), text);
}

/** Tells everyone serving that the week's schedule is final. */
export async function notifyScheduleConfirmed(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<PushOutcome> {
  const weekId = String(params.weekId ?? "").trim();
  const schedule = await getSchedule(client, { weekId });
  const speaker = schedule.find(s => s.role === "講員")?.memberName ?? "";
  const roster = schedule.filter(s => s.role !== "講員").map(s => `  ${s.role}：${s.memberName}`).join("\n");
  const text = [
    `【服事排班確認】${weekId}`,
    "",
    ...(speaker ? [`🎤 講員：${speaker}`, ""] : []),
    "🎵 本週服事名單：",
    roster,
    "",
    "排班已確認，請留意行事曆邀請。",
  ].join("\n");
  return pushToMembers(env, await servingMembers(client, weekId), text);
}

/**
 * Reminds a week's 主領 that the third song is still missing.
 *
 * Silent when there is nothing to chase: the song is already in, or nobody is
 * leading that week yet.
 */
export async function sendSongReminder(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<{ sent?: number; skipped?: true; reason?: string }> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");

  const songs = await getSongs(client, { weekId });
  if (songs.find(s => s.slot === 3)?.name) return { skipped: true, reason: "已有第三首詩歌" };

  const { rows: leaders } = await client.query(
    `select coalesce(mp.display_name, p.name) as name,
            coalesce(li.line_user_id, '') as "lineUserId"
       from worship_schedule s
       join persons p on p.id = s.person_id
       left join worship_member_profiles mp on mp.person_id = p.id
       left join worship_line_identities li on li.person_id = p.id
      where s.week_id = $1::date and s.role = '主領'`,
    [weekId],
  );
  if (!leaders.length) return { skipped: true, reason: "該週找不到主領" };

  let sent = 0;
  for (const leader of leaders) {
    const text = `【選歌提醒】${weekId}\n\n親愛的 ${leader.name}，\n\n提醒您本週第三首詩歌尚未提交，請盡快登入系統完成選歌，讓團員有時間準備。`;
    const outcome = await pushToMembers(env, [leader], text);
    sent += outcome.sent;
  }
  return { sent };
}

/**
 * Weeks whose song-selection deadline is the given Asia/Taipei date.
 *
 * The deadline is the Thursday of the week before the service, which the sheet
 * backend computed the same way.
 */
export async function weeksDueOn(client: Client, today: string): Promise<string[]> {
  const { rows } = await client.query(
    `select to_char(id, 'YYYY-MM-DD') as id
       from worship_weeks
      where id - ((extract(dow from id)::int - 4 + 7) % 7 + 7) = $1::date`,
    [today],
  );
  return rows.map(r => r.id);
}
