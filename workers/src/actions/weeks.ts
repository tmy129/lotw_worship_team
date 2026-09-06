import type { Client } from "pg";

export type Week = {
  id: string;
  label: string;
  practiceTime: string;
  serviceTime: string;
  status: string;
};

// The sheet backend overwrote the label with the normalized id on every read, so
// that is what the SPA has always displayed. The original sheet text is kept in
// the table for history but is not what the client contract returns.
const toWeek = (row: Record<string, any>): Week => ({
  id: row.id,
  label: row.id,
  practiceTime: row.practice_time ?? "",
  serviceTime: row.service_time ?? "",
  status: row.status ?? "upcoming",
});

const SELECT = `select to_char(id, 'YYYY-MM-DD') as id, practice_time, service_time, status
                  from worship_weeks`;

export async function getWeeks(client: Client): Promise<Week[]> {
  const { rows } = await client.query(`${SELECT} order by id`);
  return rows.map(toWeek);
}

export async function getWeeksByMonths(client: Client, monthsParam: unknown): Promise<Week[]> {
  const months = String(monthsParam ?? "")
    .split(",")
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 12);
  if (!months.length) return [];
  const { rows } = await client.query(
    `${SELECT} where extract(month from id)::int = any($1::int[]) order by id`,
    [months],
  );
  return rows.map(toWeek);
}

export async function saveWeek(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ created?: boolean; updated?: boolean; id: string }> {
  const id = String(params.id ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) throw new Error("id must be a YYYY-MM-DD service date");
  const practiceTime = params.practiceTime == null ? null : String(params.practiceTime);
  const serviceTime = params.serviceTime == null ? null : String(params.serviceTime);
  const status = String(params.status ?? "upcoming");

  const { rowCount } = await client.query("select 1 from worship_weeks where id = $1", [id]);
  if (rowCount) {
    await client.query(
      "update worship_weeks set practice_time = $2, service_time = $3, status = $4 where id = $1",
      [id, practiceTime, serviceTime, status],
    );
    return { updated: true, id };
  }
  await client.query(
    // The id is a date and the label is text; Postgres cannot deduce one type
    // for a parameter used as both, so each gets its own cast.
    `insert into worship_weeks (id, label, practice_time, service_time, status)
     values ($1::date, $1::text, $2, $3, 'upcoming')`,
    [id, practiceTime, serviceTime],
  );
  return { created: true, id };
}
