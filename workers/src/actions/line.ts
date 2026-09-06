import type { Client } from "pg";
import type { Env } from "../index";
import { ROSTER_QUERY_BY_PERSON } from "../db";
import { toMember, type Member } from "./directory";

const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const PROFILE_URL = "https://api.line.me/v2/profile";

export type LoginResult = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  member: Member | null;
};

/** The worship member a LINE account belongs to, or null when unbound. */
export async function memberForLineUser(client: Client, lineUserId: string): Promise<Member | null> {
  const bound = await client.query(
    "select person_id from worship_line_identities where line_user_id = $1",
    [lineUserId],
  );
  if (!bound.rows.length) return null;
  const { rows } = await client.query(ROSTER_QUERY_BY_PERSON, [bound.rows[0].person_id]);
  return rows.length ? toMember(rows[0]) : null;
}

/**
 * Exchanges a LINE authorization code for the signed-in member.
 *
 * The binding is read from worship's own table: worship authenticates through a
 * different LINE channel than the church management system, and an identifier
 * issued under one provider means nothing under the other. An unbound account
 * gets its profile back with a null member so the app can offer to bind it.
 */
export async function loginWithLine(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<LoginResult> {
  if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET) {
    throw new Error("LINE_CHANNEL_ID / LINE_CHANNEL_SECRET is not configured");
  }
  const code = String(params.code ?? "");
  const codeVerifier = String(params.code_verifier ?? "");
  const redirectUri = String(params.redirect_uri ?? "");
  if (!code || !redirectUri) throw new Error("code and redirect_uri are required");

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
  if (!tokenData.access_token) throw new Error(`LINE token exchange failed (HTTP ${tokenRes.status})`);

  const profileRes = await fetch(PROFILE_URL, {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile: any = await profileRes.json().catch(() => ({}));
  if (!profile.userId) throw new Error("LINE profile fetch failed");

  return {
    lineUserId: profile.userId,
    displayName: profile.displayName ?? "",
    pictureUrl: profile.pictureUrl ?? "",
    member: await memberForLineUser(client, profile.userId),
  };
}

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

export type PushOutcome = { sent: number; skipped: string[]; failed: string[] };

/**
 * Pushes one text message to each recipient that has a binding.
 *
 * A member without a binding is skipped rather than failing the whole action —
 * the sheet backend behaved the same way, and a roster where one person has not
 * linked LINE should still notify everyone else.
 */
export async function pushToMembers(
  env: Env,
  recipients: { name: string; lineUserId: string }[],
  text: string,
): Promise<PushOutcome> {
  if (!env.LINE_MESSAGING_TOKEN) throw new Error("LINE_MESSAGING_TOKEN is not configured");
  const outcome: PushOutcome = { sent: 0, skipped: [], failed: [] };

  for (const r of recipients) {
    if (!r.lineUserId) { outcome.skipped.push(r.name); continue; }
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.LINE_MESSAGING_TOKEN}`,
      },
      body: JSON.stringify({ to: r.lineUserId, messages: [{ type: "text", text }] }),
    });
    if (res.ok) outcome.sent++;
    else outcome.failed.push(`${r.name}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  return outcome;
}

/** Everyone serving in a week, with their binding, excluding the free-text speaker. */
export async function servingMembers(
  client: Client,
  weekId: string,
): Promise<{ name: string; lineUserId: string }[]> {
  const { rows } = await client.query(
    `select distinct coalesce(mp.display_name, p.name) as name,
            coalesce(li.line_user_id, '') as "lineUserId"
       from worship_schedule s
       join persons p on p.id = s.person_id
       left join worship_member_profiles mp on mp.person_id = p.id
       left join worship_line_identities li on li.person_id = p.id
      where s.week_id = $1::date and s.role <> '講員'`,
    [weekId],
  );
  return rows;
}

/** Leaders and admins, by the worship app's own role, with their bindings. */
export async function leadersAndAdmins(
  client: Client,
): Promise<{ name: string; lineUserId: string }[]> {
  const { rows } = await client.query(
    `select coalesce(mp.display_name, p.name) as name,
            coalesce(li.line_user_id, '') as "lineUserId"
       from worship_member_profiles mp
       join persons p on p.id = mp.person_id
       left join worship_line_identities li on li.person_id = mp.person_id
      where mp.app_role in ('leader', 'admin')`,
  );
  return rows;
}
