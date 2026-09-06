## Why

The backend is a Google Apps Script web app that stores all data in a Google Sheet. Every read pulls whole sheet ranges through `SpreadsheetApp`, masked by a 5-minute `CacheService` layer, and every Apps Script web app call pays a fixed redirect-plus-cold-start cost. This is the source of the multi-second load times the app works around today with batched endpoints (`getInitialData`) and cache helpers. A spreadsheet also has no constraints, no transactions, no joins, and no query language, so integrity rules such as week-id normalization and one-role-per-member are re-implemented defensively in JavaScript on both sides of the wire.

The roster is also duplicated. The church management system (LOTW 教會會友管理系統, a Next.js application on Cloudflare Workers backed by Neon) already holds every congregant in its `persons` table, already models a 敬拜部 team whose `team_positions` are exactly the roles this app schedules — 主領, 配唱, 鼓, 鋼琴, 吉他, BASS, PPT, 練前預備 — and already owns LINE account binding with an approval flow in its `identities` table. The worship sheet keeps a second, hand-maintained copy of the same people, keyed by email address, that drifts from the church record every time someone joins, leaves, or changes their instruments.

Moving the data to the same Neon database the management system uses removes the per-request spreadsheet overhead, makes the integrity rules enforceable in the schema, and lets the worship app read one authoritative roster instead of maintaining its own.

## What Changes

- Worship data moves from six Google Sheets tabs into Neon Postgres tables in the database the management system already uses, with primary keys, foreign keys, and unique constraints.
- **BREAKING** The worship app no longer owns a members table. Member identity, name, email, and active status are read from the management system's `persons`, instruments are read from that person's 敬拜部 positions in `team_member_positions`, and the LINE identifier is read from `identities`. Worship-specific attributes that the church record does not model — scheduling constraints, avatar color, initials, and the in-app admin/leader/member role — live in a worship-owned profile table keyed by person id.
- **BREAKING** Member identifiers change from email addresses to the management system's person UUIDs. The import remaps every vote and schedule row to the matched person, and reports any member it cannot match rather than guessing.
- **BREAKING** Creating, editing, and deleting members leaves this app. The saveMember and deleteMember actions are removed and the member management screen becomes read-only, pointing administrators at the management system's admin pages.
- LINE bindings are unified: the migration seeds the management system's `identities` with the LINE identifiers the worship sheet already holds, and from then on the worship app reads bindings from `identities` instead of storing its own. The bindLineUser action is removed.
- The Apps Script web app is replaced by a Cloudflare Workers API using Hyperdrive for pooled Postgres connections. The Worker keeps the existing action-based request contract and `{ok, data}` / `{ok, error}` envelope so the SPA changes only its base URL.
- Google-runtime dependencies are replaced: `CacheService` and `PropertiesService` by Worker environment bindings, the weekly `ScriptApp` song-reminder trigger by a Workers Cron Trigger, and `CalendarApp` by the Google Calendar API called as the calendar's owner.
- LINE Messaging push and the Groq AI scheduling proxy are ported as-is, including the prompt-size-derived token budget.
- **BREAKING** The Apps Script deployment is decommissioned after cutover and the Google Sheet becomes a historical backup only.

## Non-Goals

Recorded in design.md under Goals / Non-Goals.

## Capabilities

### New Capabilities

- `worship-api`: the HTTP contract the SPA depends on — action routing, shared-secret authentication, response envelope, and the behavior of every read and write action.
- `roster-data-store`: the Postgres schema and data-integrity rules for weeks, votes, schedule assignments, songs, vote settings, and worship member profiles, including week-id normalization and the migration from sheet rows.
- `member-directory-integration`: how the worship app derives its roster from the management system — person matching, instrument sourcing, profile attributes, and the treatment of management-owned tables as read-only.
- `service-integrations`: outbound side effects that leave Apps Script — LINE push, LINE identity lookup, Google Calendar invitations, the scheduled song reminder, and the Groq scheduling proxy.

### Modified Capabilities

(none — no specs exist in openspec/specs yet)

## Impact

- Affected specs: `worship-api`, `roster-data-store`, `member-directory-integration`, `service-integrations`
- Affected code:
  - New:
    - `workers/wrangler.toml`
    - `workers/src/index.ts`
    - `workers/src/db.ts`
    - `workers/src/auth.ts`
    - `workers/src/actions/directory.ts`
    - `workers/src/actions/weeks.ts`
    - `workers/src/actions/votes.ts`
    - `workers/src/actions/schedule.ts`
    - `workers/src/actions/songs.ts`
    - `workers/src/actions/line.ts`
    - `workers/src/actions/ai.ts`
    - `workers/src/integrations/calendar.ts`
    - `workers/src/cron.ts`
    - `workers/migrations/0001_init.sql`
    - `scripts/export-sheets.mjs`
    - `scripts/match-persons.mjs`
    - `scripts/import-neon.mjs`
    - `scripts/seed-line-identities.mjs`
    - `scripts/parity-check.mjs`
  - Modified:
    - `src/App.jsx`
    - `.github/workflows/deploy.yml`
    - `README.md`
  - Removed:
    - `src/Code.gs`
    - `src/appsscript.json`
    - `.clasp.json`
- Affected external systems: the management system's Neon database, which the worship app joins against and whose `identities` rows the migration seeds once; a Cloudflare Workers deployment with a Hyperdrive binding; a Google OAuth client and a refresh token for the account that owns the calendar; and the existing LINE and Groq credentials moved from Script Properties to Worker secrets. The management system's own repository, schema, and admin UI are not modified by this change.
