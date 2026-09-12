import type { Client } from "pg";

export type PortalMember = { id: string; name: string };

/**
 * The person a verified LINE account belongs to, read from the binding rather
 * than from the roster.
 *
 * Deliberately not memberForLineUser: that resolves through the 敬拜部 roster, so
 * it answers null for somebody who is bound but not on the worship team — 影音組,
 * for instance. Those people are linked and must be greeted by name; what they
 * lack is assignments, not an identity. Only a genuinely unbound account is null
 * here, which is what makes the portal's "not linked" message trustworthy.
 */
export async function portalMember(
  client: Client,
  lineUserId: string,
): Promise<PortalMember | null> {
  const { rows } = await client.query(
    `select p.id, coalesce(mp.display_name, p.name) as name
       from worship_line_identities li
       join persons p on p.id = li.person_id
       left join worship_member_profiles mp on mp.person_id = p.id
      where li.line_user_id = $1`,
    [lineUserId],
  );
  return rows.length ? { id: rows[0].id, name: rows[0].name } : null;
}

export type PortalWeek = {
  weekId: string;
  songs: { slot: number; name: string; youtube: string }[];
  speaker: string;
};

export type PortalData = {
  member: PortalMember | null;
  mySchedule: { weekId: string; roles: string[] }[];
  weeks: PortalWeek[];
};

/** How many upcoming weeks the portal shows. A phone screen, not a planner. */
const WEEK_WINDOW = 6;

/**
 * Everything the portal shows, in one round trip.
 *
 * Deliberately not assembled from getMySchedule and getSongsForMonth: the former
 * takes a member id as a parameter, which is precisely the trust that verifying
 * the ID token removes, and the latter is keyed by month, so a portal spanning a
 * month boundary would have to work out which months to ask for and pay for two
 * requests on a mobile connection.
 *
 * `today` is the caller's Asia/Taipei date. It is a parameter rather than read
 * from the clock here so the window is deterministic and can be tested at a
 * chosen date; the worker passes the real one.
 */
export async function getPortalData(
  client: Client,
  lineUserId: string,
  today: string,
): Promise<PortalData> {
  const member = await portalMember(client, lineUserId);

  const [weekRows, mine] = await Promise.all([
    client.query(
      `select to_char(id, 'YYYY-MM-DD') as "weekId"
         from worship_weeks
        where id >= $1::date
        order by id
        limit ${WEEK_WINDOW}`,
      [today],
    ),
    // A week already past is not news; the portal answers "when am I next on".
    member
      ? client.query(
          `select to_char(week_id, 'YYYY-MM-DD') as "weekId",
                  array_agg(role order by role) as roles
             from worship_schedule
            where person_id = $1 and week_id >= $2::date
            group by week_id
            order by week_id`,
          [member.id, today],
        )
      : Promise.resolve({ rows: [] as { weekId: string; roles: string[] }[] }),
  ]);

  const weekIds = weekRows.rows.map(r => r.weekId);
  const [songs, speakers] = weekIds.length
    ? await Promise.all([
        // Only what has been published: an unconfirmed row is a leader's draft,
        // and the rich menu reaches the whole congregation.
        client.query(
          `select to_char(week_id, 'YYYY-MM-DD') as "weekId", slot, name,
                  coalesce(youtube, '') as youtube
             from worship_songs
            where week_id = any($1::date[]) and confirmed
            order by week_id, slot`,
          [weekIds],
        ),
        client.query(
          `select to_char(week_id, 'YYYY-MM-DD') as "weekId", coalesce(member_name, '') as speaker
             from worship_schedule
            where week_id = any($1::date[]) and role = '講員'`,
          [weekIds],
        ),
      ])
    : [{ rows: [] }, { rows: [] }];

  const speakerByWeek = new Map<string, string>(speakers.rows.map((r: any) => [r.weekId, r.speaker]));
  const weeks: PortalWeek[] = weekIds.map(weekId => ({
    weekId,
    songs: songs.rows
      .filter((s: any) => s.weekId === weekId)
      .map((s: any) => ({ slot: s.slot, name: s.name, youtube: s.youtube })),
    speaker: speakerByWeek.get(weekId) ?? "",
  }));

  return { member, mySchedule: mine.rows, weeks };
}
