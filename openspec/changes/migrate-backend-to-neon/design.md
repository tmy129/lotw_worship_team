## Context

The current backend is a single Apps Script file bound to a Google Sheet, deployed as a web app and reached by the SPA at a `script.google.com/macros/s/<deployment>/exec` URL. It exposes about thirty actions through two entry points: `doGet` routes read actions from query parameters, `doPost` routes write actions from a JSON body. Both return the same envelope, `{ok: true, data}` on success and `{ok: false, error}` on failure, and both gate on a shared `APP_SECRET` compared against a Script Property.

Six sheet tabs hold the data: Members, Weeks, Votes, Schedule, Songs, VoteSettings. Because a sheet has no keys or constraints, the handlers carry defensive logic that a database would enforce: week ids are re-normalized to `YYYY-MM-DD` on every read because Sheets silently coerces date-like cells to Date objects, schedule reads de-duplicate rows by role (with 主領 and 配唱 allowed two people and every other role one), pre-practice history de-duplicates per week before picking each member's latest assignment, and `saveSchedule` deletes every row for a week before re-appending. Reads pull whole ranges and are masked by a five-minute `CacheService` layer.

The Members tab holds 18 active people keyed by email address, each carrying name, in-app role, a comma-joined instruments string, a canPPT flag, free-text scheduling constraints, avatar color, initials, and a LINE user identifier. Every one of the 18 currently has both an email and a LINE identifier. Votes and Schedule reference members by that email-shaped id.

The church management system is a separate application — Next.js on Cloudflare Workers through `@opennextjs/cloudflare`, Neon Postgres through Drizzle, deployed as the `lotw-mgmt` Worker, with its code in one directory and its Spectra artifacts in another. Its schema already contains what the worship roster duplicates: `persons` (51 rows, name in Chinese with an optional `english_name`, plus email, active, and admin flags), `teams` including 敬拜部, `team_positions` for that team named 主領, 配唱, 鼓, 鋼琴, 吉他, BASS, PPT, and 練前預備, `team_members` joining a person to a team with a role of 組長, 副組長, or 組員, `team_member_positions` joining a team membership to its positions, and `identities` holding LINE bindings with a pending, approved, or rejected status. Its own notes record that 49 of the 51 persons were bulk-imported with only a name and a membership status, so email and `english_name` are empty for most of them. It uses a single Neon database for both development and production.

Three behaviors of the worship backend are bound to the Google runtime rather than to the data: `CalendarApp` creates the practice and service events and invites members by email, a `ScriptApp` weekly time-based trigger runs the song reminder check, and `PropertiesService` holds every secret. LINE Login, LINE Messaging push, and the Groq scheduling proxy are already plain HTTPS calls with no Google coupling.

The SPA is a Vite single-file bundle published to GitHub Pages by `.github/workflows/deploy.yml`, and all backend access goes through one `api(action, params, body)` helper.

## Goals / Non-Goals

**Goals:**

- Serve every action the SPA still needs from Cloudflare Workers backed by Neon, with response shapes the SPA parses unchanged apart from the member id format.
- Derive the worship roster from the management system so a person is added, deactivated, or given an instrument in exactly one place.
- Move the integrity rules that are currently defensive JavaScript into schema constraints.
- Replace the three Google-runtime dependencies (Calendar, timed trigger, Script Properties) with equivalents that run in the Worker.
- Leave the Apps Script deployment reversible until cutover is verified, then decommission it.

**Non-Goals:**

- Modifying the management system's schema, admin UI, or repository. This change reads its tables and seeds `identities` once; any new column or screen it needs is its own change in its own repository.
- Writing worship data back into management-owned tables during normal operation. After the one-off identity seed, every management table is read-only to the worship Worker.
- Replacing the shared-secret gate with real sessions or JWT. The secret is embedded in a public bundle and this is a known weakness, but changing the auth model at the same time as the storage layer would make a parity comparison impossible. It is a follow-up change.
- Building a member editing experience in the worship app. Member records are edited in the management system's admin pages.
- Unifying the two LINE channels. Worship keeps its own channel and its own binding table; moving everyone onto the management system's channel is a later change, recorded under Decisions.
- Two-way synchronization with the Google Sheet. After cutover the sheet is a frozen historical backup, not a write path.
- Rewriting the AI scheduling logic or any UI, view, or user-facing workflow beyond the member screen becoming read-only.

## Decisions

### Cloudflare Workers with Hyperdrive as the API runtime

Neon is only the database; the API layer has to run somewhere. Workers was chosen over Vercel Functions because the management system already runs there, so both applications share one deployment story and one Cloudflare account, and because Cron Triggers cover the song reminder without a second product. Postgres over TCP is not directly reachable from a Worker, so Hyperdrive provides the pooled connection and the Worker talks to it through the standard Postgres driver.

The Neon Data API with PostgREST and row-level security was rejected outright: the side-effecting actions (LINE push, calendar invitations, the Groq proxy, the reminder cron) cannot live in the database, so it would split the backend across two runtimes rather than replacing one.

### Shared Neon database with the management system

The worship tables live in the same Neon database as the management system rather than in a database of their own. This is what makes the roster join possible in a single query, with no synchronization job, no cache invalidation, and no window in which the two systems disagree about who is on the team. The cost is a shared blast radius and a schema dependency across repositories, mitigated by the worship Worker treating every management table as read-only and by worship tables carrying a `worship_` prefix so ownership is legible in the table list.

An HTTP API on the management system was rejected because it would require a change in that repository to serve the worship app, and every roster read would pay a second network hop for data sitting in the same database. A periodically synchronized copy was rejected because it reintroduces exactly the divergence this change exists to remove.

### Member directory read from the management system

`getMembers` becomes a query joining `persons` to their 敬拜部 `team_members` row, that row's `team_member_positions`, the worship profile table, and the approved `identities` row. A person appears in the worship roster when they have an active 敬拜部 membership and an active person record. The returned shape keeps the field names the SPA already consumes — id, name, role, instruments, email, constraints, avColor, initials, active, canPPT, lineUserId — so no component changes.

The id becomes the person UUID. The sheet keyed members by email, and votes and schedule rows carry that email, so the import remaps them through a person match. Matching applies four rules in order, stopping at the first that yields exactly one candidate: exact email, exact normalized name against `name` or `english_name`, the name being a suffix of a `name`, and the name equalling a token of an `english_name`. Normalization strips all whitespace and folds case, the same rule the management system already applies during LINE binding. The last two rules exist because the worship sheet records nicknames while the church record holds full names: 筠軒 is the personal name of 周筠軒, and `english_name` stores full English names such as Richard Chang, so an exact comparison against Richard fails. Measured against the current 18 members and 51 persons, the four rules resolve 15 with no ambiguity; the rest are written to a mapping file for a human to complete, and the import refuses to run until every member referenced by a vote or schedule row resolves to exactly one person.

### Worship-specific member attributes in a worship-owned profile table

Scheduling constraints, avatar color, initials, the in-app admin, leader, or member role, and the short name the team calls each other by have no counterpart in the church record and no meaning outside this app, so they live in `worship_member_profiles`, keyed by the person id with a foreign key to `persons`. The display name matters more than it looks: the church record holds 保秀貞, the team says Victoria, and that short name is what the schedule grid, the AI prompt and the LINE messages have always shown. Treating it as a worship attribute keeps the roster reading the way it does today without asserting anything about the person's real name. A person with no profile row still appears in the roster under their formal name with the member role, so adding someone to 敬拜部 in the management system is sufficient to make them schedulable.

Adding these columns to `persons` or `team_members` was rejected: worship-only fields in the all-church tables would be visible to every other feature of the management system and would make that schema harder to reason about.

### Instruments sourced from the 敬拜部 team positions

The instruments a member plays are their 敬拜部 positions, maintained in the management system's admin pages, and the worship app reads them without writing. PPT and 練前預備 are positions in that team as well; PPT continues to be treated as a service role rather than an instrument skill, matching how the scheduling code already separates them. The canPPT flag is derived from holding the PPT position rather than stored.

Keeping an editable copy in the worship app was rejected because two editable copies of the same fact is the problem this change removes. The consequence is that changing someone's instruments now requires management-system access, which is why the worship member screen becomes read-only with a link rather than silently losing the ability.

### LINE bindings stay worship-owned, in worship's own id space

LINE user identifiers are scoped to the provider that issued them, not to the person. The worship app authenticates through LINE Login channel 2009964527 while the management system uses channel 2007892040, and the two people bound in both systems carry different identifiers in each — empirical proof that the channels sit under different providers. The eighteen identifiers recorded in the worship sheet are therefore meaningless in the management system's `identities` table, whose unique index is on the identifier alone with no notion of which channel issued it.

Worship keeps its own channel and stores its bindings in `worship_line_identities`, keyed by the management system's person id. The two id spaces stay separate, which is what they actually are, and nobody has to re-bind. The migration seeds this table from the sheet, and the worship login flow continues to resolve a LINE profile to a person through it.

Unifying on the management system's channel was considered and deferred: it is the better end state — one identity per person, with the approval flow the management system already runs — but it requires sixteen of the eighteen members to bind again before they can sign in, and the team chose not to disrupt them for this migration. Adding a channel column to the management system's `identities` was rejected because modifying that schema is a Non-Goal here; it belongs to whichever change eventually unifies the two.

### Postgres schema mirroring sheet entities with real constraints

Each remaining tab becomes a worship-owned table with the field names the SPA already consumes. The constraints replace the defensive read-time logic:

- `worship_weeks.id` is a `date` column, which makes the week-id normalization that runs on every sheet read structurally impossible to need again. Every table referencing a week uses a foreign key to it.
- `worship_votes` gets a composite primary key of week and person, so casting a vote becomes an upsert instead of a scan-and-rewrite.
- `worship_schedule` gets a partial unique index: one row per week and role for single-person roles, and one row per week, role, and person for 主領 and 配唱. The de-duplication in `getSchedule` and `getPrePracticeHistory` then has nothing left to clean up.
- Every table that names a member references `persons` by UUID, so a vote or assignment for a deleted person cannot survive.

### One-off export and import instead of dual-write

The team is under twenty people with a few hundred rows in total, and the app has clear idle periods between Saturday services. A dual-write bridge would cost more code than the migration itself and would need a conflict policy for a problem this size does not have. Instead the six sheet tabs are exported to CSV from Google Sheets and an export script normalizes them into one snapshot, a match script produces the member-to-person mapping, an import script loads the result into Neon inside one transaction, and cutover happens during an idle window with the sheet frozen. The export deliberately does not read through the Apps Script actions: `getSchedule` and `getSongs` de-duplicate before returning, so duplicate rows left by manual sheet edits would be silently resolved at export time and the import would never see the conflict it is meant to catch.

The exported data carries two historical irregularities the import resolves explicitly. Eleven schedule rows use the role 弦樂, which is what the team called the position the church record names Keyboard; the import renames them, which is safe because no week holds both labels. One week, 2026-04-11, assigns two people to 吉他, a single-person role. Rather than loosening the constraint or dropping the row quietly, the import reads a waiver file naming the exact week and role, keeps the last exported row — the same one `getSchedule` has been showing all along, since it resolves conflicts last-row-wins — and reports the drop. Any conflict without a waiver still aborts the load. Rollback is repointing the SPA at the still-deployed Apps Script URL.

### Google Calendar API as the calendar's owner

`sendScheduleCalendar` keeps its current observable behavior — it creates the practice and service events, invites the members serving that week, and excludes PPT-only members from the practice invitation — but calls the Calendar API over HTTP instead of `CalendarApp`.

It authenticates as the account that owns the calendar, using a refresh token obtained once through the consent screen and stored as a Worker secret, rather than as a service account. A service account cannot invite attendees without domain-wide delegation, which is configured in the Google Workspace admin console that a personal Gmail account does not have — and this calendar belongs to a personal Gmail account. Acting as the owner also preserves the current behavior exactly, because the Apps Script backend has always run as that same account: invitations keep coming from the sender the team already sees.

The cost is a credential that can be revoked, where a service account key would not expire. That is accepted, because the alternative does not deliver invitations at all. Emailing ICS attachments was rejected earlier for losing the ability to update an event after a schedule change, and that reasoning is unchanged.


### Workers Cron Trigger for the weekly song reminder

The Thursday 09:00 Asia/Taipei trigger installed by `installSongReminderTrigger` becomes a Cron Trigger declared in the Worker configuration. Cron expressions are UTC, so the schedule is expressed as the corresponding UTC time and the handler re-derives the local date before deciding whether to send, preserving the current same-day comparison behavior.

### Keep the shared-secret gate, unchanged, for this migration

The Worker compares the same shared secret the SPA already sends, using a constant-time comparison rather than the current string equality. Anything more is out of scope, as recorded in Non-Goals.

## Implementation Contract

**Behavior.** After cutover, every SPA screen behaves as it does today while talking to a Workers endpoint backed by the shared Neon database, with two deliberate differences: the member management screen is read-only and links to the management system, and members are exactly the people with an active 敬拜部 membership there. Votes, schedules, songs, LINE push, AI scheduling, calendar invitations, and the weekly reminder are unchanged from the user's point of view.

**Interface and data shape.** The Worker accepts `GET /?action=<name>&secret=<secret>&...` for reads and `POST /` with a JSON body of `{action, secret, ...fields}` for writes. It answers `{"ok": true, "data": <payload>}` or `{"ok": false, "error": "<message>"}` with `Content-Type: application/json` and an allow-origin header for the SPA origin. The action set matches the current Apps Script handlers minus saveMember and deleteMember. loginWithLine and bindLineUser stay, resolving and recording bindings in worship's own table. Specifically:

- `getMembers` returns one entry per person with an active 敬拜部 membership, with instruments as an array of that person's positions, canPPT as a boolean derived from the PPT position, and profile fields defaulted when no profile row exists.
- `getInitialData` returns `{members, weeks, voteSettings}` plus `mySchedule` when a member id is supplied.
- `getSchedule` returns one row per role for single-person roles and up to two rows for 主領 and 配唱.
- `getPrePracticeHistory` returns a map of member id to that member's latest 練前預備 week id.
- `getVoteSummary` returns week id to member id to vote value.
- `getSongsForMonth` and `getSpeakersForMonth` return maps keyed by week id for a `YYYY-MM` month.
- Member identifiers are person UUID strings in every request and response; week identifiers are `YYYY-MM-DD` strings.

**Failure modes.** A missing or wrong secret returns `{"ok": false, "error": "Unauthorized"}`. An unknown action, including the three removed ones, returns an error naming the action. A database error surfaces as a message rather than a stack trace. A LINE login for a profile with no approved identity returns a null member rather than an error, so the SPA can show its existing unbound state. Groq and LINE failures surface the upstream message rather than an empty success.

**Acceptance criteria.** The parity script replays a fixed set of read actions against both backends and reports a diff per action. Literal deep-equality is the wrong test: the sheet backend returned display strings where the database returns typed values, and the roster now comes from the church record rather than the sheet. Both payloads are therefore normalized the same way before comparison — member identifiers translated through the mapping file, scalars compared by value rather than representation so that "TRUE" equals true and "3" equals 3, empty string and null and absent treated alike, the fields no screen reads ignored — the practice and service times, the moment a vote opened, and every row's last-updated stamp, which the sheet returned as instants and the CSV export carries only as the text a person typed, schedule rows naming the placeholder dash treated as absent, and collections compared as maps keyed by their natural key rather than by array order.

Parity then means one of two things depending on the action. Every action that reads worship-owned data — weeks, votes, vote summaries, schedules, pre-practice history, songs, speakers — must match exactly under that normalization. The roster actions, getMembers and the members inside getInitialData, are compared only for people present on both sides and only on the fields that drive scheduling: display name, in-app role, scheduling constraint, PPT eligibility, and the instruments the two vocabularies share. People present on only one side are reported rather than failed, because the roster is the 敬拜部 membership by design and reconciling the two lists is a step in the migration plan, not a defect in the API.

Four differences are known and expected, and parity does not require them to match: member identifiers move from email addresses to person ids; instruments come from team positions and so include 練前預備, which the sheet never listed; email is present for only the few people whose church record carries one; and a vote setting whose months cell holds the literal string "undefined" reads as an empty list instead of a list containing null. Write actions are verified by asserting resulting row state and re-reading through the matching read action. The roster join is verified by adding a test person to 敬拜部 in the management system, confirming they appear in `getMembers` with the expected instruments, then removing them. The binding seed is verified by asserting 18 worship bindings exist for the matched persons, that a person already bound is left untouched, that an identifier already held by another person is refused, and that re-running the seed changes nothing.

**In scope.** The Worker project, the worship schema and its migration, the export, match, import, seed, and parity scripts, the roster join, the read-only member screen, repointing the SPA's API base URL, the cron and calendar replacements, secret migration to Worker bindings, and removing the Apps Script sources after cutover.

**Out of scope.** Everything in Non-Goals, plus any change to the SPA's scheduling heuristics, prompt templates, or styling.

## Risks / Trade-offs

- [A worship nickname can have no counterpart in the church record, so the mapping cannot be completed automatically] → Measured on the current data, three of eighteen members are unresolved. The match script writes an explicit mapping file listing them, a human completes it, and the import refuses to run while any referenced member is unresolved. Filling `english_name` in the management system is the durable fix and can be done during the same review.
- [The two systems keep separate LINE bindings, so a person who re-binds in one is not bound in the other, and the identifiers cannot be compared across them] → Accepted for this change and recorded under Decisions. `worship_line_identities` keys on the person id, so whenever the channels are unified the worship rows can be matched to management rows person by person rather than by identifier.
- [The roster after cutover is the 敬拜部 team membership, which is not the same set of people as the worship sheet: measured on the completed mapping, all 16 team members appear in the sheet, but two sheet members — 蘇建勳 and 易學仁 — hold no 敬拜部 membership and would lose access at cutover] → The mapping review reconciles the two lists before cutover, and every difference is resolved by adding or removing a 敬拜部 membership in the management system rather than by special-casing anyone in the worship application.
- [A LINE identifier in the sheet may already be bound to a different person in `identities`, or a person may already have an identity] → The seed script skips persons who already have an identity, refuses to attach an identifier that exists on another person, and reports both cases for manual resolution rather than overwriting.
- [Two applications now share one database, so a schema change in the management system can break the worship Worker without any change in this repository] → The worship Worker reads a documented, narrow set of columns; the health action exercises the roster join so a breaking upstream change surfaces immediately rather than at the next Saturday.
- [Most persons have no email, so calendar invitations will reach fewer people than they do today] → The action reports skipped attendees, and the gap is closed by filling emails in the management system rather than by keeping a second address book.
- [The sheet holds rows that violate the new constraints — duplicate schedule rows, votes for people no longer on the team] → The import validates before loading and fails loudly with the offending rows rather than silently dropping them.
- [Cutover changes the origin the SPA talks to, so a missing CORS header breaks every request at once] → The Worker is exercised from the deployed GitHub Pages origin before the SPA is repointed.
- [The calendar refresh token can be revoked, and a revoked token would fail only when someone confirms a schedule] → The action reports the upstream error instead of reporting success, and the calendar path can stay on Apps Script until it is proven, because it is independent of the data migration.
- [The shared secret remains embedded in a public bundle] → Accepted for this change and recorded in Non-Goals.
- [Rollback after users have written to Neon would lose those writes] → Cutover happens in an idle window and the sheet stays frozen but intact.

## Migration Plan

1. Provision the Hyperdrive binding against the management system's existing Neon database and apply the worship schema migration to a Neon branch.
2. Export the sheet, run the match script, and complete the mapping file with a human review of every unresolved member.
3. Import into the branch with the completed mapping; resolve any constraint violations it reports.
4. Seed `worship_line_identities` on the branch, then build and deploy the Worker to a staging route and run the parity script until read actions match.
5. Verify write actions, the roster join against a test 敬拜部 membership, the calendar path, and the cron handler on the branch.
6. Freeze the sheet, re-run export, match, import, and seed against the production database, deploy the Worker to its production route, and repoint the SPA's API base URL through the build environment.
7. Watch for a full service cycle (one Thursday practice and one Saturday service), then delete the Apps Script sources and its deployment, keeping the sheet as a read-only archive.

Rollback at any point before step 7 is repointing the SPA at the Apps Script URL, which stays deployed and functional throughout. The identity seed is additive and does not need reverting.

## Open Questions

- Who reviews and approves the person mapping file, and should the same review fill `english_name` in the management system so future matching is automatic? The 49 bulk-imported persons are the ones affected.
- Should the Worker be served from a custom domain or the workers.dev subdomain? This only affects the CORS allow-list value and the environment variable set at build time.
