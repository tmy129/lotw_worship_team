import type { Client } from "pg";

export type Assignment = { weekId: string; role: string; memberId: string; memberName: string };

// 主領 and 配唱 seat two people; every other role seats one.
const TWO_SEAT_ROLES = new Set(["主領", "配唱"]);
const PLACEHOLDER = "—";
const isPersonId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Every week this person is assigned to, with the roles they hold that week. */
export async function getMySchedule(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ weekId: string; roles: string[] }[]> {
  const personId = String(params.memberId ?? "");
  // Members are person ids now. Anything else — a stale email id from an old
  // client, say — has no schedule rather than being an error, which is how the
  // sheet backend answered an unknown member.
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return [];
  const { rows } = await client.query(
    `select to_char(s.week_id, 'YYYY-MM-DD') as week_id,
            array_agg(s.role order by s.role) as roles
       from worship_schedule s
      where s.person_id = $1
      group by s.week_id
      order by s.week_id`,
    [personId],
  );
  return rows.map(r => ({ weekId: r.week_id, roles: r.roles }));
}

export async function getSchedule(client: Client, params: Record<string, unknown>): Promise<Assignment[]> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return [];
  const { rows } = await client.query(
    `select to_char(week_id, 'YYYY-MM-DD') as "weekId", role,
            coalesce(person_id::text, '') as "memberId",
            coalesce(member_name, '') as "memberName"
       from worship_schedule
      where week_id = $1::date
      order by role, slot`,
    [weekId],
  );
  return rows;
}

/**
 * Replaces a week's assignments in one transaction. Seats are numbered in the
 * order given, so the unique index rejects a role with more people than seats
 * and the previous schedule survives the failure untouched.
 */
export async function saveSchedule(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ saved: boolean }> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");
  const assignments = Array.isArray(params.assignments) ? params.assignments : [];

  const seats = new Map<string, number>();
  const rows: [string, number, string | null, string][] = [];
  for (const a of assignments as Record<string, unknown>[]) {
    const role = String(a.role ?? "").trim();
    const memberName = String(a.memberName ?? "").trim();
    // A dash records that nobody is assigned, which the database expresses by
    // having no row at all.
    if (!role || (!memberName && !a.memberId) || memberName === PLACEHOLDER) continue;
    const slot = (seats.get(role) ?? 0) + 1;
    seats.set(role, slot);
    if (slot > (TWO_SEAT_ROLES.has(role) ? 2 : 1)) {
      throw new Error(`${role} has more people than seats in ${weekId}`);
    }
    rows.push([role, slot, isPersonId(a.memberId) ? a.memberId : null, memberName]);
  }

  await client.query("begin");
  try {
    await client.query("delete from worship_schedule where week_id = $1::date", [weekId]);
    for (const [role, slot, personId, memberName] of rows) {
      await client.query(
        `insert into worship_schedule (week_id, role, slot, person_id, member_name, updated_at)
         values ($1::date, $2, $3, $4::uuid, $5, now())`,
        [weekId, role, slot, personId, memberName],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  return { saved: true };
}

/**
 * Marks a week's schedule confirmed. The calendar invitations and LINE
 * notifications the sheet backend sent from here are wired in with those
 * integrations; this is the data half.
 */
export async function confirmSchedule(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ confirmed: boolean; weekId: string }> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");
  await client.query("begin");
  try {
    await client.query("update worship_schedule set confirmed_at = now() where week_id = $1::date", [weekId]);
    await client.query("update worship_weeks set status = 'confirmed' where id = $1::date", [weekId]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
  return { confirmed: true, weekId };
}

/** Each person's most recent 練前預備 week, as a map of person id to week. */
export async function getPrePracticeHistory(client: Client): Promise<Record<string, string>> {
  const { rows } = await client.query(
    `select person_id::text as person_id, to_char(max(week_id), 'YYYY-MM-DD') as latest
       from worship_schedule
      where role = '練前預備' and person_id is not null
      group by person_id`,
  );
  return Object.fromEntries(rows.map(r => [r.person_id, r.latest]));
}
