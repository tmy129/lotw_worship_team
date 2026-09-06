import type { Client } from "pg";
import { ROSTER_QUERY, ROSTER_QUERY_BY_PERSON } from "../db";

/**
 * The shape the SPA has always consumed. Only `id` changes meaning: it used to
 * be the member's email address in the sheet and is now the church record's
 * person id.
 */
export type Member = {
  id: string;
  name: string;
  role: string;
  instruments: string[];
  email: string;
  constraints: string;
  avColor: string;
  initials: string;
  active: boolean;
  canPPT: boolean;
  lineUserId: string;
};

const PPT = "PPT";

// The sheet stored a short label for the avatar bubble; derive one when no
// profile row supplies it, so a newly added member still renders.
const defaultInitials = (name: string) => name.slice(-2);

export function toMember(row: Record<string, any>): Member {
  const instruments: string[] = row.instruments ?? [];
  return {
    id: row.id,
    // The team's short name for this person, falling back to the church
    // record's formal name when the worship profile does not set one.
    name: row.display_name || row.name,
    role: row.app_role ?? "member",
    instruments,
    email: row.email ?? "",
    constraints: row.constraints ?? "",
    avColor: row.av_color ?? "",
    initials: row.initials ?? defaultInitials(row.name),
    // Only people with an active 敬拜部 membership are returned at all.
    active: true,
    canPPT: instruments.includes(PPT),
    lineUserId: row.line_user_id ?? "",
  };
}

export async function getMembers(client: Client): Promise<Member[]> {
  const { rows } = await client.query(ROSTER_QUERY);
  return rows.map(toMember);
}

// The worship-owned columns a profile may set. Anything not listed here belongs
// to the church record and is not writable from this application.
const PROFILE_COLUMNS: Record<string, string> = {
  role: "app_role",
  constraints: "constraints",
  avColor: "av_color",
  initials: "initials",
  name: "display_name",
};

/**
 * Upserts the worship-only attributes of one member. Fields absent from the
 * request are left alone; fields present are written, with an empty string
 * clearing the value. Writes nothing outside worship_member_profiles.
 */
export async function saveMemberProfile(
  client: Client,
  params: Record<string, unknown>,
): Promise<Member> {
  const personId = params.memberId ?? params.id;
  if (typeof personId !== "string" || !personId) throw new Error("memberId is required");

  const columns: string[] = [];
  const values: unknown[] = [personId];
  for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
    if (!(field in params)) continue;
    const raw = params[field];
    columns.push(column);
    values.push(raw === "" || raw === null ? null : String(raw));
  }
  if (!columns.length) throw new Error("No profile fields given");

  const placeholders = columns.map((_, i) => `$${i + 2}`);
  const updates = columns.map((c, i) => `${c} = $${i + 2}`);
  await client.query(
    `insert into worship_member_profiles (person_id, ${columns.join(", ")})
     values ($1, ${placeholders.join(", ")})
     on conflict (person_id) do update set ${updates.join(", ")}`,
    values,
  );

  const { rows } = await client.query(`${ROSTER_QUERY_BY_PERSON}`, [personId]);
  if (!rows.length) throw new Error("Member is not on the worship roster");
  return toMember(rows[0]);
}

/**
 * Records which person a LINE account belongs to.
 *
 * Worship signs in through its own LINE channel, so these identifiers live in a
 * worship-owned table and are never written into the management system's
 * identities table — an identifier issued under one provider means nothing
 * under another.
 */
export async function bindLineUser(
  client: Client,
  params: Record<string, unknown>,
): Promise<{ bound: boolean; member: Member }> {
  const personId = params.memberId ?? params.id;
  const lineUserId = params.lineUserId;
  if (typeof personId !== "string" || !personId) throw new Error("memberId is required");
  if (typeof lineUserId !== "string" || !lineUserId) throw new Error("lineUserId is required");

  const held = await client.query(
    "select person_id from worship_line_identities where line_user_id = $1",
    [lineUserId],
  );
  if (held.rows.length && held.rows[0].person_id !== personId) {
    throw new Error("This LINE account is already bound to another member");
  }

  await client.query(
    `insert into worship_line_identities (person_id, line_user_id, display_name)
     values ($1, $2, $3)
     on conflict (person_id) do update set line_user_id = excluded.line_user_id`,
    [personId, lineUserId, typeof params.displayName === "string" ? params.displayName : null],
  );

  const { rows } = await client.query(ROSTER_QUERY_BY_PERSON, [personId]);
  if (!rows.length) throw new Error("Member is not on the worship roster");
  return { bound: true, member: toMember(rows[0]) };
}
