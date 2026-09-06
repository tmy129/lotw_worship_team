import type { Client } from "pg";

export type VoteSetting = {
  id: string;
  months: number[];
  deadline: string;
  openedAt: string;
  openedBy: string;
  status: string;
  note: string;
};

const toSetting = (row: Record<string, any>): VoteSetting => ({
  id: row.id,
  months: row.months ?? [],
  deadline: row.deadline ?? "",
  openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : "",
  openedBy: row.opened_by ?? "",
  status: row.status ?? "open",
  note: row.note ?? "",
});

const SELECT_SETTINGS = `select id, months, to_char(deadline, 'YYYY-MM-DD') as deadline,
                                opened_at, opened_by, status, note
                           from worship_vote_settings`;

export async function getVoteSettings(client: Client): Promise<VoteSetting[]> {
  const { rows } = await client.query(`${SELECT_SETTINGS} order by opened_at nulls first`);
  return rows.map(toSetting);
}

// Matches the id shape the sheet backend generated, so links and stored
// references keep working across the cutover.
const generateId = () => `vs${Date.now().toString(36)}`;

export async function saveVoteSetting(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ created?: boolean; updated?: boolean; id: string }> {
  const months = Array.isArray(params.months)
    ? params.months.map(Number).filter(Number.isInteger)
    : String(params.months ?? "").split(",").map(Number).filter(Number.isInteger);
  const deadline = params.deadline ? String(params.deadline) : null;
  const note = params.note == null ? null : String(params.note);
  const id = typeof params.id === "string" && params.id ? params.id : null;

  if (id) {
    const { rowCount } = await client.query(
      `update worship_vote_settings
          set months = $2, deadline = $3::date,
              status = coalesce($4, status), note = coalesce($5, note)
        where id = $1`,
      [id, months, deadline, params.status ? String(params.status) : null, note],
    );
    if (rowCount) return { updated: true, id };
  }

  const newId = id ?? generateId();
  await client.query(
    `insert into worship_vote_settings (id, months, deadline, opened_at, opened_by, status, note)
     values ($1, $2, $3::date, now(), $4, 'open', $5)`,
    [newId, months, deadline, params.openedBy ? String(params.openedBy) : null, note],
  );
  return { created: true, id: newId };
}

export async function deleteVoteSetting(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ deleted?: boolean; error?: string }> {
  const id = String(params.id ?? "");
  const { rowCount } = await client.query("delete from worship_vote_settings where id = $1", [id]);
  return rowCount ? { deleted: true } : { error: "not found" };
}

// ── Votes ───────────────────────────────────────────────────────────────────

export type Vote = { weekId: string; memberId: string; vote: string };

const SELECT_VOTES = `select to_char(week_id, 'YYYY-MM-DD') as "weekId",
                             person_id::text as "memberId", vote
                        from worship_votes`;

const isPersonId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

const monthList = (monthsParam: unknown): number[] =>
  String(monthsParam ?? "").split(",").map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12);

export async function getVotes(client: Client, params: Record<string, unknown>): Promise<Vote[]> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return [];
  const { rows } = await client.query(`${SELECT_VOTES} where week_id = $1::date`, [weekId]);
  return rows;
}

export async function getVotesByMember(client: Client, params: Record<string, unknown>): Promise<Vote[]> {
  const memberId = params.memberId;
  const months = monthList(params.months);
  // An unknown member simply has no votes, which is how the sheet backend
  // answered rather than failing.
  if (params.memberId !== undefined && !isPersonId(memberId)) return [];

  const wheres: string[] = [];
  const values: unknown[] = [];
  if (isPersonId(memberId)) { values.push(memberId); wheres.push(`person_id = $${values.length}`); }
  if (months.length) { values.push(months); wheres.push(`extract(month from week_id)::int = any($${values.length}::int[])`); }
  const { rows } = await client.query(
    `${SELECT_VOTES}${wheres.length ? " where " + wheres.join(" and ") : ""}`,
    values,
  );
  return rows;
}

/** Weeks in the requested months, plus week -> member -> vote for those weeks. */
export async function getVoteSummary(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ weeks: unknown[]; summary: Record<string, Record<string, string>> }> {
  const months = monthList(params.months);
  if (!months.length) return { weeks: [], summary: {} };

  const { getWeeksByMonths } = await import("./weeks");
  const weeks = await getWeeksByMonths(client, params.months);
  const summary: Record<string, Record<string, string>> = {};
  for (const w of weeks) summary[w.id] = {};

  const { rows } = await client.query(
    `${SELECT_VOTES} where extract(month from week_id)::int = any($1::int[])`,
    [months],
  );
  for (const r of rows) if (summary[r.weekId]) summary[r.weekId][r.memberId] = r.vote;
  return { weeks, summary };
}

export async function castVote(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ created?: boolean; updated?: boolean }> {
  const weekId = String(params.weekId ?? "").trim();
  const memberId = params.memberId;
  const vote = String(params.vote ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");
  if (!isPersonId(memberId)) throw new Error("memberId must be a person id");

  // The composite primary key makes this an upsert rather than the scan and
  // rewrite the spreadsheet needed.
  // An upsert always affects one row, so the row count cannot tell an insert
  // from an update; xmax = 0 only on a freshly inserted tuple.
  const { rows } = await client.query(
    `insert into worship_votes (week_id, person_id, vote, updated_at)
     values ($1::date, $2::uuid, $3, now())
     on conflict (week_id, person_id) do update set vote = excluded.vote, updated_at = now()
     returning (xmax = 0) as inserted`,
    [weekId, memberId, vote],
  );
  return rows[0].inserted ? { created: true } : { updated: true };
}

export async function castVoteBulk(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ saved: number }> {
  const memberId = params.memberId;
  const weekIds = Array.isArray(params.weekIds) ? params.weekIds.map(w => String(w).trim()) : [];
  const vote = String(params.vote ?? "");
  if (!isPersonId(memberId)) throw new Error("memberId must be a person id");
  const valid = weekIds.filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w));
  if (!valid.length) return { saved: 0 };

  await client.query(
    `insert into worship_votes (week_id, person_id, vote, updated_at)
     select unnest($1::date[]), $2::uuid, $3, now()
     on conflict (week_id, person_id) do update set vote = excluded.vote, updated_at = now()`,
    [valid, memberId, vote],
  );
  return { saved: weekIds.length };
}
