import type { Client } from "pg";
import type { Env } from "../index";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const LOCATION = "世界之光浸信會，10491臺北市中山區中山北路一段121巷32號";
const TZ = "Asia/Taipei";

/**
 * Acts as the calendar's owner.
 *
 * A service account cannot invite attendees without domain-wide delegation,
 * which needs a Workspace admin console this personal account does not have.
 * The owner's refresh token also keeps invitations coming from the sender the
 * team already recognises, because the Apps Script backend ran as this account.
 */
async function accessToken(env: Env): Promise<string> {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const) {
    if (!env[key]) throw new Error(`${key} is not configured`);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(`Google token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data.access_token;
}

const at = (date: string, h: number, m: number) =>
  `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;

// The week id is the service date; practice is the Thursday two days earlier.
function practiceDate(serviceDate: string): string {
  const d = new Date(`${serviceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

type Row = { role: string; memberName: string; email: string | null };

function description(kind: "practice" | "service", weekId: string, rows: Row[]): string {
  const speaker = rows.find(r => r.role === "講員")?.memberName ?? "";
  const team = rows.filter(r => r.role !== "講員");
  return [
    kind === "practice" ? "【週四練習】" : "【週六主日敬拜服事】",
    `📅 ${weekId}`, "",
    ...(speaker ? [`🎤 講員：${speaker}`, ""] : []),
    "🎵 本週服事名單：",
    ...team.map(r => `  ${r.role}：${r.memberName}`),
    "",
    kind === "practice"
      ? "請準時出席，若有狀況請提前告知管理員。"
      : "請提前30分鐘到場準備，感謝你的服事！",
  ].join("\n");
}

export type CalendarOutcome = {
  sent: boolean;
  weekId: string;
  results: { type: string; eventId?: string; guests?: number; error?: string }[];
  noEmail: string[];
};

/**
 * Creates the practice and service events for a week and invites those serving.
 *
 * Someone whose only role that week is PPT is not called to the Thursday
 * practice but is expected on Saturday, which is how the sheet backend invited
 * them. A member with no email on their church record cannot be invited and is
 * reported rather than silently dropped.
 */
export async function sendScheduleCalendar(
  client: Client,
  params: Record<string, unknown>,
  env: Env,
): Promise<CalendarOutcome> {
  const weekId = String(params.weekId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new Error("weekId must be YYYY-MM-DD");

  const { rows } = await client.query<Row>(
    `select s.role,
            coalesce(mp.display_name, p.name, s.member_name) as "memberName",
            p.email
       from worship_schedule s
       left join persons p on p.id = s.person_id
       left join worship_member_profiles mp on mp.person_id = s.person_id
      where s.week_id = $1::date
      order by s.role, s.slot`,
    [weekId],
  );
  if (!rows.length) throw new Error(`No schedule saved for ${weekId}`);

  // Group by person so someone serving twice is invited once, and so the
  // PPT-only rule can see everything they do that week.
  const byMember = new Map<string, { email: string | null; roles: string[] }>();
  for (const r of rows) {
    if (r.role === "講員") continue;
    const entry = byMember.get(r.memberName) ?? { email: r.email, roles: [] };
    entry.roles.push(r.role);
    byMember.set(r.memberName, entry);
  }

  const noEmail: string[] = [];
  const emailsFor = (forPractice: boolean) => {
    const out: string[] = [];
    for (const [name, { email, roles }] of byMember) {
      if (forPractice && roles.every(r => r === "PPT")) continue;
      if (!email?.includes("@")) { if (!noEmail.includes(name)) noEmail.push(name); continue; }
      out.push(email);
    }
    return out;
  };

  const token = await accessToken(env);
  const results: CalendarOutcome["results"] = [];

  const events = [
    { type: "practice" as const, summary: "敬拜團團練", date: practiceDate(weekId), start: [19, 15], end: [21, 0], attendees: emailsFor(true) },
    { type: "service" as const, summary: "主日聚會", date: weekId, start: [9, 15], end: [12, 0], attendees: emailsFor(false) },
  ];

  for (const e of events) {
    // sendUpdates=all is what mails the invitations, which CalendarApp did
    // through its sendInvites option.
    const res = await fetch(`${EVENTS_URL}?sendUpdates=all`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        summary: e.summary,
        location: LOCATION,
        description: description(e.type, weekId, rows),
        start: { dateTime: at(e.date, e.start[0], e.start[1]), timeZone: TZ },
        end: { dateTime: at(e.date, e.end[0], e.end[1]), timeZone: TZ },
        attendees: e.attendees.map(email => ({ email })),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) results.push({ type: e.type, eventId: body.id, guests: e.attendees.length });
    else results.push({ type: e.type, error: body.error?.message || `HTTP ${res.status}` });
  }

  return { sent: true, weekId, results, noEmail };
}
