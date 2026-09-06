import type { Client } from "pg";

export type Song = { weekId: string; slot: number; name: string; confirmed: boolean; youtube: string };

const SELECT = `select to_char(week_id, 'YYYY-MM-DD') as "weekId", slot, name, confirmed,
                       coalesce(youtube, '') as youtube
                  from worship_songs`;

const isWeekId = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v: string) => /^\d{4}-\d{2}$/.test(v);

export async function getSongs(client: Client, params: Record<string, unknown>): Promise<Song[]> {
  const weekId = String(params.weekId ?? "").trim();
  if (!isWeekId(weekId)) return [];
  const { rows } = await client.query(`${SELECT} where week_id = $1::date order by slot`, [weekId]);
  return rows;
}

/** Every week of a `YYYY-MM` month, each mapped to its songs. */
export async function getSongsForMonth(
  client: Client,
  params: Record<string, unknown>,
): Promise<Record<string, Song[]>> {
  const month = String(params.month ?? "").trim();
  if (!isMonth(month)) return {};
  const { rows: weeks } = await client.query(
    `select to_char(id, 'YYYY-MM-DD') as id from worship_weeks
      where to_char(id, 'YYYY-MM') = $1 order by id`,
    [month],
  );
  const { rows: songs } = await client.query(
    `${SELECT} where to_char(week_id, 'YYYY-MM') = $1 order by week_id, slot`,
    [month],
  );
  const byWeek: Record<string, Song[]> = {};
  for (const w of weeks) byWeek[w.id] = [];
  for (const s of songs) byWeek[s.weekId]?.push(s);
  return byWeek;
}

/** Every week of a month that has a 講員, mapped to that speaker's name. */
export async function getSpeakersForMonth(
  client: Client,
  params: Record<string, unknown>,
): Promise<Record<string, string>> {
  const month = String(params.month ?? "").trim();
  if (!isMonth(month)) return {};
  const { rows } = await client.query(
    `select to_char(week_id, 'YYYY-MM-DD') as "weekId", member_name
       from worship_schedule
      where role = '講員' and to_char(week_id, 'YYYY-MM') = $1 and member_name <> ''`,
    [month],
  );
  return Object.fromEntries(rows.map(r => [r.weekId, r.member_name]));
}

/**
 * Replaces a week's song list. Slots are numbered by position, as the sheet
 * backend did, so the list the client sends is the list that comes back.
 * `confirmed` is carried through for a normal save and forced false for a
 * leader's submission, which still needs an admin to publish it.
 */
export async function saveSongs(
  client: Client,
  params: Record<string, unknown>,
  { confirmed }: { confirmed?: boolean } = {},
): Promise<{ saved: boolean }> {
  const weekId = String(params.weekId ?? "").trim();
  if (!isWeekId(weekId)) throw new Error("weekId must be YYYY-MM-DD");
  const songs = Array.isArray(params.songs) ? (params.songs as Record<string, unknown>[]) : [];

  await client.query("begin");
  try {
    await client.query("delete from worship_songs where week_id = $1::date", [weekId]);
    for (const [i, s] of songs.entries()) {
      await client.query(
        `insert into worship_songs (week_id, slot, name, confirmed, youtube)
         values ($1::date, $2, $3, $4, $5)`,
        [weekId, i + 1, String(s.name ?? ""), confirmed ?? Boolean(s.confirmed), String(s.youtube ?? "")],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  return { saved: true };
}
