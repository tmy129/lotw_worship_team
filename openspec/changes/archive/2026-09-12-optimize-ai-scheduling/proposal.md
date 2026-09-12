## Why

The batch scheduling prompt has grown to 7771 characters, roughly 4900 tokens. Groq's free tier allows 8000 tokens per minute counting the prompt and the reserved output together, so the Worker reserves what is left — about 2900 tokens — and the whole request lands near 7800. Running the planner twice inside a minute already fails, and the margin will disappear entirely as the roster grows: the prompt got 1000 characters longer the moment the church record filled in members' instruments.

The size is almost all redundancy rather than content. Measured on the current nine-week prompt:

- The instrument availability grid is 2813 characters, of which 2004 are padding spaces used to align columns.
- The per-week availability list is 2536 characters and repeats each member's instrument list once per week they are available — nine times for the members who are always free.
- The response template is 928 characters: the same nine lines repeated once per week.
- The grid and the per-week list encode the same availability data twice, once as role to player to week and once as week to member to instruments.

Two other weaknesses show up alongside the size. The response is free text parsed by two separate parsers — a primary one keyed on `== date ==` markers and a fallback that scans for date lines — because the model does not reliably produce either shape; a truncated or reformatted answer silently yields fewer weeks than requested. And the prompt spends 807 characters restating rotation rules that the client already enforces after the fact, so a model that ignores them costs tokens without changing the outcome.

## What Changes

- The prompt is restructured so each fact appears once: availability is expressed in a single compact table instead of an aligned grid plus a per-week list, member instruments are listed once per member rather than once per member per week, and the response format is described once rather than repeated per week.
- The model is asked for structured JSON matching a schema instead of a line-oriented text format, using the JSON schema mode the current model supports. The two text parsers are replaced by one schema-validated parse, so a malformed or truncated answer is a clear failure rather than a partially parsed schedule.
- Rules the client already enforces after the response — the monthly caps, the no-consecutive-weeks rule, and PPT eligibility — are stated once and briefly rather than as step-by-step instructions, since the enforcement functions decide the final answer regardless.
- The role vocabulary in the prompt is derived from the roster the API returns rather than hard-coded, so a position added to the 敬拜部 team in the church management system becomes schedulable without a code change.
- With the prompt smaller, the reasoning effort returns from low to medium, which is where it was before the token budget forced it down.

## Non-Goals

Recorded in design.md under Goals / Non-Goals.

## Capabilities

### New Capabilities

- `ai-schedule-planning`: how a scheduling request is composed, what the model is asked to return, how that answer is validated, and what the client guarantees regardless of what the model produces.

### Modified Capabilities

(none — no specs exist in openspec/specs yet)

## Impact

- Affected specs: `ai-schedule-planning`
- Affected code:
  - Modified:
    - `src/App.jsx`
    - `workers/src/actions/ai.ts`
  - New:
    - `scripts/prompt-budget.mjs`
- Depends on `migrate-backend-to-neon`: the role vocabulary comes from the roster that change introduces, and both edit `src/App.jsx`. This change is written to be applied after it.
