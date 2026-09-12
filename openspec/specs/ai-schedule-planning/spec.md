# ai-schedule-planning Specification

## Purpose

TBD - created by archiving change 'optimize-ai-scheduling'. Update Purpose after archive.

## Requirements

### Requirement: Each fact appears once in the scheduling prompt

The scheduling prompt SHALL state a member's instruments once, state their availability once as week indices against a week list printed once, and describe the response format once. It MUST NOT align columns with padding, repeat a member's instruments per week, or repeat the response format per week.

#### Scenario: Member available in several weeks

- **WHEN** a prompt is built for a period in which one member is available in every week
- **THEN** that member's instruments appear exactly once in the prompt, and their availability appears as a list of week indices

##### Example: one member's line

| Member | Available weeks | Prompt line |
| ------ | --------------- | ----------- |
| plays 主領 and 配唱, free weeks 1, 3, 5 | 1, 3, 5 | one line naming the member, those instruments and those indices |
| plays 鼓, free every week of nine | all | one line naming the member, that instrument and all nine indices |


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: Prompt fits the per-minute token budget with headroom

The completion the proxy reserves for a nine-week period SHALL exceed what an answer needs by at least 1500 tokens. The reservation is whatever the per-minute budget leaves after the prompt, so the two always sum to the budget and the meaningful measure is the spare capacity above the answer's own requirement, taken as 2000 tokens — the plan itself plus the model's reasoning. A tool SHALL report the prompt size, the reservation and that spare capacity, and SHALL exit non-zero when it falls below the threshold.

#### Scenario: Prompt grows past the threshold

- **WHEN** the budget tool measures a prompt whose spare capacity is below 1500 tokens
- **THEN** it reports the prompt size, the reservation and the spare capacity, and exits non-zero

##### Example: today's prompt against the free tier

| Quantity | Value |
| -------- | ----- |
| per-minute budget | 8000 |
| prompt | 7771 characters, 4857 tokens |
| reserved for the answer | 2943 tokens |
| an answer needs | 2000 tokens |
| spare | 943 — below the threshold, so the tool exits non-zero |


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: A period is planned one month at a time

A request covering more than one calendar month SHALL be split into one request per month, each validated and corrected on its own, and the results assembled in week order. Rules that span a month boundary SHALL NOT be asked of the model; the enforcement passes apply them to the assembled plan.

#### Scenario: Two-month period

- **WHEN** a leader plans a period covering October and November
- **THEN** two requests are made, each naming only that month's weeks and the people available in them, and the schedule that comes back covers every week of both months

#### Scenario: One month fails

- **WHEN** the first month plans successfully and the second cannot be made valid
- **THEN** no schedule is presented, and the report names the month and its faults


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: The model answers with schema-valid JSON

The request SHALL ask for JSON matching a schema whose top level carries a list of weeks, each with its date and a list of role-and-members entries. The role vocabulary in the schema SHALL be supplied by the caller rather than fixed in the model request.

#### Scenario: Answer conforms

- **WHEN** the model returns JSON satisfying the schema for the requested period
- **THEN** the answer is parsed once, with no fallback parser involved


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: An invalid plan is rejected, never partially accepted

The client SHALL validate a parsed plan before use: every requested week present exactly once, every role within the supplied vocabulary, every named member drawn from that week's availability list, and no role carrying more members than it seats. Every fault in a plan SHALL be collected, not just the first. A plan that fails SHALL be sent back to the planner with those faults and a request to correct them, for one correction attempt; when neither validates, the faults from the last attempt SHALL be reported and no schedule presented. A further attempt SHALL NOT be made, because the per-minute token budget holds exactly two calls and a third would be refused rather than answered.

#### Scenario: Truncated answer

- **WHEN** the model's answer covers fewer weeks than were requested and repeated attempts do not fix it
- **THEN** the client reports which weeks are missing and presents no schedule

#### Scenario: A fault the planner can fix

- **WHEN** an answer assigns one unavailable member and the next attempt, given that fault, returns a plan with none
- **THEN** the corrected plan is used and the leader sees a schedule rather than an error

#### Scenario: Rate limit during the loop

- **WHEN** the per-minute token limit is reached partway through the attempts
- **THEN** the loop stops and reports the upstream message rather than retrying against a limit that has not reset

#### Scenario: Unavailable member assigned

- **WHEN** the answer assigns a member to a week in which they are not available
- **THEN** the client reports that week and that member, and presents no schedule

#### Scenario: Role carries too many people

- **WHEN** the answer assigns three members to a role that seats two
- **THEN** the client reports that week and role, and presents no schedule


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: Only schedulable instruments are offered to the model

The role vocabulary SHALL be derived from the instruments the roster reports, excluding PPT and 練前預備, which are assigned by their own passes after the model answers.

#### Scenario: New position added upstream

- **WHEN** a new instrument position is added to the worship team in the church management system and a member holds it
- **THEN** the next prompt offers that instrument as a schedulable role without any code change

#### Scenario: Service roles withheld

- **WHEN** the roster reports members holding PPT or 練前預備
- **THEN** neither appears in the role vocabulary sent to the model, and the prompt does not ask for either

#### Scenario: PPT filled after the answer

- **WHEN** a validated plan carries no PPT for a week
- **THEN** the eligibility pass assigns someone available that week who may operate PPT and holds no other role that week, or records that nobody qualifies


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: No output is requested that nothing reads

The response SHALL NOT include per-week explanatory prose, because no screen displays it and the completion budget is scarce.

#### Scenario: Plan returned

- **WHEN** the model returns a plan for a period
- **THEN** the answer carries assignments only, with no explanation field


<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->

---
### Requirement: Post-processing guarantees are unchanged

The monthly caps, the consecutive-week rule, PPT eligibility and pre-practice assignment SHALL continue to be enforced on the validated plan, with the same outcomes they produce today.

#### Scenario: Model overuses one person

- **WHEN** a validated plan assigns the same member to a role more often than the monthly cap allows
- **THEN** the enforcement pass rewrites those assignments exactly as it does for the current text-based plan

<!-- @trace
source: optimize-ai-scheduling
updated: 2026-09-12
code:
  - workers/src/actions/notify.ts
  - workers/src/actions/votes.ts
  - README.md
  - workers/src/actions/schedule.ts
  - src/App.jsx
  - src/Code.gs
  - src/liff/main.jsx
  - .clasp.json
  - scripts/google-oauth.mjs
  - src/liff/Portal.jsx
  - liff.html
  - package.json
  - scripts/prompt-budget.mjs
  - workers/src/auth.ts
  - eslint.config.js
  - workers/src/index.ts
  - workers/src/actions/directory.ts
  - workers/migrations/0003_member_display_name.sql
  - workers/src/actions/weeks.ts
  - .github/workflows/deploy.yml
  - workers/src/actions/line.ts
  - src/liff/portal.css
  - workers/migrations/0002_line_identities.sql
  - workers/package.json
  - workers/wrangler.toml
  - .spectra.yaml
  - src/lib/prompt.js
  - scripts/parity-check.mjs
  - scripts/match-persons.mjs
  - workers/src/db.ts
  - scripts/import-neon.mjs
  - workers/src/actions/songs.ts
  - scripts/seed-line-identities.mjs
  - workers/migrations/0001_init.sql
  - CLAUDE.md
  - workers/migrations/0004_song_audience.sql
  - workers/src/integrations/calendar.ts
  - vite.liff.config.js
  - scripts/run-sql.mjs
  - workers/src/actions/portal.ts
  - vite.config.js
  - src/App.css
  - scripts/export-sheets.mjs
  - workers/src/actions/ai.ts
-->