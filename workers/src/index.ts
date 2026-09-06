import { secretMatches } from "./auth";
import { runAISchedule } from "./actions/ai";
import { loginWithLine } from "./actions/line";
import { notifyLeaderSongs, notifyScheduleConfirmed, publishSongs, sendSongReminder, weeksDueOn } from "./actions/notify";
import { bindLineUser, getMembers, saveMemberProfile } from "./actions/directory";
import { confirmSchedule, getMySchedule, getPrePracticeHistory, getSchedule, saveSchedule } from "./actions/schedule";
import { getSongs, getSongsForMonth, getSpeakersForMonth, saveSongs } from "./actions/songs";
import { castVote, castVoteBulk, deleteVoteSetting, getVoteSettings, getVoteSummary, getVotes, getVotesByMember, saveVoteSetting } from "./actions/votes";
import { getWeeks, getWeeksByMonths, saveWeek } from "./actions/weeks";
import { ROSTER_QUERY, withDb } from "./db";
import { sendScheduleCalendar } from "./integrations/calendar";

export type Env = {
  HYPERDRIVE: Hyperdrive;
  APP_SECRET: string;
  ALLOWED_ORIGIN: string;
  GROQ_API_KEY?: string;
  // Set these to change model or token budget without a redeploy — the last
  // model this app used was decommissioned with two months' notice.
  GROQ_MODEL?: string;
  GROQ_TPM_BUDGET?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_MESSAGING_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
};

type Handler = (params: Record<string, unknown>, env: Env) => Promise<unknown>;

// Reads answer GET with query parameters, writes answer POST with a JSON body.
// The split mirrors the Apps Script backend this replaces, so the SPA keeps
// working against the same request grammar.
const READ_ACTIONS: Record<string, Handler> = {
  // Runs the roster join rather than "select 1": that way a breaking change to
  // the management system's tables shows up here, not on a Saturday morning.
  health: async (_params, env) =>
    withDb(env, async client => {
      const roster = await client.query(ROSTER_QUERY);
      return { rosterSize: roster.rowCount, checkedAt: new Date().toISOString() };
    }),

  getMembers: async (_params, env) => withDb(env, getMembers),
  getWeeks: async (_params, env) => withDb(env, getWeeks),
  getWeeksByMonths: async (params, env) => withDb(env, c => getWeeksByMonths(c, params.months)),
  getVoteSettings: async (_params, env) => withDb(env, getVoteSettings),
  loginWithLine: async (params, env) => withDb(env, c => loginWithLine(c, params, env)),
  getMySchedule: async (params, env) => withDb(env, c => getMySchedule(c, params)),
  getVotes: async (params, env) => withDb(env, c => getVotes(c, params)),
  getVotesByMember: async (params, env) => withDb(env, c => getVotesByMember(c, params)),
  getVoteSummary: async (params, env) => withDb(env, c => getVoteSummary(c, params)),
  getSchedule: async (params, env) => withDb(env, c => getSchedule(c, params)),
  getPrePracticeHistory: async (_params, env) => withDb(env, getPrePracticeHistory),
  getSongs: async (params, env) => withDb(env, c => getSongs(c, params)),
  getSongsForMonth: async (params, env) => withDb(env, c => getSongsForMonth(c, params)),
  getSpeakersForMonth: async (params, env) => withDb(env, c => getSpeakersForMonth(c, params)),

  // One round trip for everything the app needs on load — the batching the
  // sheet backend introduced to hide its latency, kept because the SPA calls it.
  getInitialData: async (params, env) =>
    withDb(env, async client => {
      const [members, weeks, voteSettings] = await Promise.all([
        getMembers(client),
        getWeeks(client),
        getVoteSettings(client),
      ]);
      const result: Record<string, unknown> = { members, weeks, voteSettings };
      if (params.memberId) result.mySchedule = await getMySchedule(client, params);
      return result;
    }),
};

const WRITE_ACTIONS: Record<string, Handler> = {
  saveMemberProfile: async (params, env) => withDb(env, client => saveMemberProfile(client, params)),
  bindLineUser: async (params, env) => withDb(env, client => bindLineUser(client, params)),
  saveWeek: async (params, env) => withDb(env, c => saveWeek(c, params)),
  saveVoteSetting: async (params, env) => withDb(env, c => saveVoteSetting(c, params)),
  deleteVoteSetting: async (params, env) => withDb(env, c => deleteVoteSetting(c, params)),
  castVote: async (params, env) => withDb(env, c => castVote(c, params)),
  castVoteBulk: async (params, env) => withDb(env, c => castVoteBulk(c, params)),
  saveSchedule: async (params, env) => withDb(env, c => saveSchedule(c, params)),
  confirmSchedule: async (params, env) =>
    withDb(env, async c => {
      const result = await confirmSchedule(c, params);
      return { ...result, ...(await notifyScheduleConfirmed(c, params, env)) };
    }),
  publishSongs: async (params, env) => withDb(env, c => publishSongs(c, params, env)),
  sendScheduleCalendar: async (params, env) => withDb(env, c => sendScheduleCalendar(c, params, env)),
  sendSongReminder: async (params, env) => withDb(env, c => sendSongReminder(c, params, env)),
  // No database work: the prompt is built by the client and the plan is parsed
  // by the client, so this is purely a credentialed proxy.
  runAISchedule: async (params, env) => runAISchedule(params, env),
  saveSongs: async (params, env) => withDb(env, c => saveSongs(c, params)),
  // A leader's submission always lands unconfirmed; an admin publishes it.
  submitLeaderSong: async (params, env) => withDb(env, async c => {
    await saveSongs(c, params, { confirmed: false });
    return { submitted: true, ...(await notifyLeaderSongs(c, params, env)) };
  }),
};

// Member records live in the management system now. These actions are answered
// explicitly rather than as "unknown action", so an old client gets told why.
const RETIRED_ACTIONS: Record<string, string> = {
  saveMember: "Members are managed in the church management system",
  deleteMember: "Members are managed in the church management system",
};

function corsHeaders(env: Env): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

// Application-level failures still answer 200: the SPA reads the envelope, not
// the status, and an error status would surface as a network error instead.
const envelope = (body: unknown, env: Env) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...corsHeaders(env) },
  });

const ok = (data: unknown, env: Env) => envelope({ ok: true, data: data ?? null }, env);
const fail = (error: string, env: Env) => envelope({ ok: false, error }, env);

export default {
  /**
   * Weekly song-selection check. Cron expressions are UTC, so the local date is
   * derived here before deciding which weeks are due — the deadline is a
   * calendar date in Asia/Taipei, not an instant.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    await withDb(env, async client => {
      for (const weekId of await weeksDueOn(client, today)) {
        try {
          const result = await sendSongReminder(client, { weekId }, env);
          console.log(`song reminder ${weekId}:`, JSON.stringify(result));
        } catch (e) {
          console.error(`song reminder ${weekId} failed:`, e instanceof Error ? e.message : String(e));
        }
      }
    });
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ ok: false, error: "ALLOWED_ORIGIN is not configured" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    let params: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (request.method === "POST") {
      try {
        const body = await request.json<Record<string, unknown>>();
        params = { ...params, ...body };
      } catch {
        return fail("Request body is not valid JSON", env);
      }
    }

    const action = typeof params.action === "string" ? params.action : "";
    if (!action) return fail("No action given", env);

    if (!env.APP_SECRET) return fail("APP_SECRET is not configured", env);
    if (!secretMatches(typeof params.secret === "string" ? params.secret : null, env.APP_SECRET)) {
      return fail("Unauthorized", env);
    }

    if (action in RETIRED_ACTIONS) {
      return fail(`Action ${action} is no longer supported: ${RETIRED_ACTIONS[action]}`, env);
    }

    const handler =
      request.method === "POST" ? WRITE_ACTIONS[action] ?? READ_ACTIONS[action] : READ_ACTIONS[action];
    if (!handler) return fail(`Unknown action: ${action}`, env);

    try {
      return ok(await handler(params, env), env);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`${action} failed:`, message);
      return fail(message, env);
    }
  },
};
