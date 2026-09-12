## Context

The worship app plans a whole voting period in one model call. The client builds a prompt from the roster and the availability votes, sends it through the backend's AI proxy to Groq, parses the answer back into per-week assignments, and then runs the result through post-processing that enforces the rotation rules before anything is shown.

The prompt is assembled by the batch prompt builder in `src/App.jsx` and currently measures 7771 characters for a nine-week period, roughly 4900 tokens. Its sections, measured:

| Section | Characters | Share |
| ------- | ---------- | ----- |
| Instrument availability grid | 2813 | 36% |
| Per-week availability list | 2536 | 33% |
| Response format template | 928 | 12% |
| Step-by-step rules | 807 | 10% |
| PPT candidates, roles, header | 687 | 9% |

Two thirds of the prompt is the grid plus the per-week list, and the two encode the same availability data from different directions. Inside the grid, 2004 of 2813 characters are spaces used to align columns for a reader who does not exist. The per-week list repeats a member's instrument list once for every week they are available — nine times for the members who are always free. The response template repeats the same nine lines once per week.

The answer comes back as free text and is parsed by two parsers in sequence: one keyed on `== date ==` section markers and a fallback that scans for date lines with inline roles. The fallback exists because the model does not reliably produce the first shape. Neither parser can tell a truncated answer from a complete one — a plan cut short simply yields fewer weeks, and the caller reports success for whatever parsed.

The prompt also asks for a `REASON` line per week. Nothing in the client reads it: `REASON` appears only in the two prompt templates and in no parser or view. The model spends output tokens on nine explanations that are discarded.

Groq's free tier allows 8000 tokens per minute, counting the prompt and the reserved completion together, which is why the backend derives the output budget from the prompt length rather than fixing it. At the current size the whole request lands near 7800 of 8000, the reasoning effort has been reduced to low to fit, and a second run inside the same minute is rejected.

## Goals / Non-Goals

**Goals:**

- Bring the nine-week prompt under half its current size by removing duplication, not by removing information the model needs.
- Make a malformed or truncated answer a visible failure rather than a partial schedule.
- Stop paying output tokens for text nothing reads.
- Let the roles the planner knows about follow the church record instead of a hard-coded list.
- Establish whether the reasoning effort can be raised now that the prompt is smaller.

**Non-Goals:**

- Changing the rotation rules themselves. The monthly caps, the no-consecutive-weeks rule, who is eligible for PPT, and pre-practice assignment keep their current behavior.
- One implementation does change, because the model is no longer asked for PPT: the eligibility pass currently skips a week that has no PPT row, since until now the model always produced one. It must now fill an empty slot as well as correct a wrong one. The rule it applies — someone available that week, eligible, and not already holding another role — is untouched.
- Changing which model is used, or moving off the free tier. This change makes the request fit; paying for more capacity remains available and independent.
- Redesigning the scheduling screens. The draft review, the grid and the save flow are untouched.
- Adding an explanation of the AI's reasoning to the interface. The discarded `REASON` output is removed here; showing reasoning to leaders would be a product change with its own design.
- Changing the backend's token budget arithmetic, which is correct and stays as it is.

## Decisions

### Availability as one compact table

The aligned grid and the per-week list collapse into a single block: one line per member carrying their instruments, their constraint if any, and the weeks they are available as indices into a numbered week list printed once. A member who plays 主領 and 配唱 and is free for weeks 1, 3 and 5 costs one line instead of appearing in a padded grid and again in three week blocks.

Column alignment is dropped entirely. It exists to make the grid readable to a person, costs 2004 characters of spaces, and the model does not need it — the same information as `name: 1,3,5` is unambiguous and an order of magnitude smaller.

### Structured JSON output instead of a text format

The request asks for JSON matching a schema, using the JSON schema mode the current model supports, rather than a line-oriented format described by a repeated template. This removes the 928-character template — the schema travels as a parameter, not as prose — and replaces both parsers with one schema-validated parse.

The important gain is not size but honesty about failure. A truncated JSON answer does not parse, so it is reported as an error naming what was missing; a truncated text answer parses into fewer weeks and is reported as success. The assignments are carried as a list of role-and-members pairs rather than fixed keys, so the schema can be built from whatever role vocabulary the roster supplies.

### One month per request

A nine-week period asked for in one go is both the hardest version of the problem and the most expensive answer. Measured, the model reliably failed the same cell — the fifth week's piano, where only one of the two pianists was available and the monthly cap pushed it towards the other — and the answer plus one correction very nearly exhausted the per-minute budget on its own.

Requests are therefore split by calendar month. A month is the natural unit rather than a fixed number of weeks: the monthly caps are stated per month, so each request carries a complete and self-contained version of the rule rather than a fragment of one, and a leader planning "October and November" gets two requests instead of one that must hold both months in mind at once.

Each month is planned, validated and if necessary corrected on its own, and the results are concatenated in week order. The rules that span a boundary — a worship leader may not repeat from the previous week, including across months — are not asked of the model at all here; the enforcement pass applies them to the assembled plan afterwards, which is where they were always decided.

### A repair loop, because one attempt is not enough

Validation rejects a plan that assigns someone who is not available that week, and measurement says that is not a rare event: over four runs of the new prompt one was clean, and over three usable runs of the old prompt one was clean — the old one simply never checked, so a run that covered six of nine weeks, and a run that put a member on Keyboard in a week he could not attend, were both reported as success.

Rejecting outright would therefore fail most button presses. Instead the validation errors, which already name the week, the role and the person, are handed back to the model as a follow-up turn asking it to fix exactly those, and the corrected answer is validated again. One correction attempt; if neither validates, the last set of errors is what the leader sees.

Splitting by month also makes the loop affordable. The proxy previously reserved everything the budget had left — 7168 tokens for an answer that uses about 1500 — which allowed exactly one call per minute. Reserving 2000 where an answer uses about 1500 makes the pair cost roughly 7300 of the 8000 available, which fits; reserving 2500 does not, and a third attempt does not fit at any reservation. A rate limit reached mid-loop stops it and is reported rather than retried blindly.

### Rules the client enforces are stated once, not taught

The prompt currently spends 807 characters walking the model through rotation rules step by step. Those rules are enforced afterwards by the client's monthly-cap, consecutive-week and PPT-eligibility passes, which rewrite whatever the model returns. The rules stay in the prompt as a short constraint list, because a first draft that respects them needs less rewriting, but they stop being a tutorial.

### Role vocabulary derived from the roster

The instrument list is currently a constant in the client. It becomes the set of instruments the roster reports, minus the service roles that are assigned by other means: PPT is chosen by the PPT-eligibility pass and pre-practice by its own assignment pass, so neither is offered to the model as an instrument. A position added to the 敬拜部 team in the church management system therefore becomes schedulable without a code change, which is the point of sourcing the roster from there.

### Reasoning effort stays low, for a reason the budget hid

The intention here was to raise the effort back to medium once the smaller prompt afforded it. Measured, that turns out to be impossible on this tier and not because of the prompt at all: at medium the model spends more reasoning tokens on this problem than the whole per-minute budget can buy. Given 3000 tokens it used 2998 on reasoning and emitted nothing; given 7168 it emitted nothing again. At low it reasons for 22 tokens and answers in about 1500.

So the effort stays low, and the reason is recorded here rather than left as a number someone might raise again hopefully. What the smaller prompt actually bought is headroom for the answer and room for the roster to grow, not a better-thinking model. Raising the effort would need a paid tier, and would want measuring against the low-effort plan before being assumed better — the enforcement passes correct the rotation mistakes that more reasoning would mostly be spent avoiding.

### A budget check that fails loudly

A script measures the prompt a given period produces and reports what the proxy will reserve for the answer. Comparing prompt plus reservation against the budget would be circular — the reservation is defined as the remainder — so the measure is the spare capacity above what an answer actually needs, taken as 2000 tokens for the plan and the model's reasoning. It exits non-zero when that spare falls below 1500 tokens, so prompt growth is caught deliberately rather than discovered when a Saturday plan fails.

## Implementation Contract

**Behavior.** A leader plans a period exactly as today: press the button, wait, review a draft covering every week of the period. What changes is that the request comfortably fits the token budget, a bad answer says so instead of quietly covering fewer weeks, and roles the church record knows about are schedulable without a release.

**Interface and data shape.** The client sends the same `runAISchedule` action with a `prompt`. The backend additionally sends a response format naming a JSON schema whose top level is an object with a `weeks` array; each entry carries the week's date as `YYYY-MM-DD` and an `assignments` array of objects with a `role` drawn from the supplied vocabulary and a `members` array of names. The client validates the parsed answer before use: every requested week present exactly once, every role within the vocabulary, every name drawn from that week's availability list, and no role carrying more members than it seats. The existing post-processing passes then run unchanged on the validated result.

**Failure modes.** An answer that is not valid JSON, does not satisfy the schema, omits or duplicates a week, or names someone unavailable is rejected with a message naming the specific failure and the week involved. Nothing partially valid is shown as a schedule. The upstream errors the proxy already surfaces — decommissioned model, rate limit, empty completion — keep their current behavior.

**Acceptance criteria.** For the same nine-week period the prompt is at most half of 7771 characters. The budget script reports at least 1500 tokens of headroom for that period and exits non-zero when it does not. Planning that period returns a schema-valid answer covering all nine weeks, and every assigned name appears in that week's availability list. A deliberately truncated answer and an answer naming an unavailable member are each rejected with a message naming the week and the reason. Running the post-processing passes over the validated result produces assignments that satisfy the monthly caps and the consecutive-week rule, as they do today.

**In scope.** The batch prompt builder, the response parsing and validation that replaces the two text parsers, the schema and response-format parameter in the AI proxy, the reasoning effort setting, the role vocabulary derivation, and the budget script.

**Out of scope.** Everything in Non-Goals, plus the single-week prompt builder and its template, which is unused by the batch flow and stays as it is.

## Where the budget ended up

Measured on the nine-week October–November period, which is the largest this team plans at once:

| | Before | After |
| --- | --- | --- |
| prompt | 7771 characters, 4857 tokens | 1332 characters, 833 tokens |
| reserved for the answer | 7168 tokens — everything left | 2000 tokens per month-sized request |
| spare above what an answer needs | 943 tokens | 4967 tokens |

The budget script exits zero at this size and non-zero below 1500 spare, so the prompt cannot creep back without someone being told.

## What this change did not achieve

Reliability. A nine-week period comes back usable in roughly one run in three, and six rounds of measurement — compacting the availability table, indexing it by week instead of by member, removing and restoring the rotation rules, correcting through a conversation turn and then through a re-ask, and three sizes of completion reservation — moved the failure from one shape to another without moving the rate.

The cause is arithmetic rather than prompting. Every lever competes for the same 8000 tokens a minute: more attempts require a smaller reservation, which truncates the answer; letting the model reason properly costs more than the whole budget. The measurements are recorded in the decisions above so the next person does not repeat them.

What did change is that the failures are visible. Held to the same availability check, the retired prompt was also usable in about one run in three — a run that covered six of nine weeks and a run that scheduled someone who could not attend were both reported as success, because nothing checked. Raising the per-minute budget is the one lever not yet pulled, and the code takes it from a single environment variable.

## Risks / Trade-offs

- [The model assigns people who are not available in that week often enough that a single attempt usually fails validation] → Measured at one clean run in four for the new prompt and one in three for the old, the difference being that the old one did not check. The repair loop hands the errors back and asks for a correction, and the comparison run records how often a plan is usable within three attempts rather than trusting a single run.
- [Removing the step-by-step rule text may produce first drafts that violate rotation rules more often, increasing how much the post-processing rewrites] → Measured: the passes rewrite 11 assignments of a nine-week plan from the new prompt. The retired prompt could not be measured beside it, because two of its four runs returned an incomplete plan. Correctness does not depend on the difference — the passes are unchanged and decide the final answer — but the first draft does sit further from the rotation ideal, which is the price of stating the caps as a preference so that availability wins when they conflict.
- [Deriving roles from the roster could introduce a position that is not an instrument — 練前預備 and PPT are positions on the same team] → Those two are excluded explicitly and by name, because each is assigned by its own pass; the vocabulary is asserted in the budget script's output so an unexpected addition is visible.
- [Compact availability indices are harder for a person to read when debugging a prompt] → The prompt preview screen keeps showing the exact text sent, and the week legend printed at the top makes the indices resolvable.
- [Both this change and the backend migration edit `src/App.jsx`] → This change is applied after that one; its tasks touch the prompt building and parsing, which that change does not modify.

## Migration Plan

1. Build the new prompt alongside the current one and compare their sizes and token estimates for the same nine-week period.
2. Plan that period with both, comparing weeks covered, names outside availability, and how many assignments the post-processing rewrites.
3. Switch the client to the new prompt and validation once the comparison holds, keeping the old builder in history rather than in the code.
4. Raise the reasoning effort and re-run the comparison to confirm the headroom absorbed it.

Rollback is reverting the client change; the backend's schema parameter is inert for a client that does not ask for it.

## Open Questions

- None. The measurements this change rests on were taken on the current data, and the model's schema support is documented for the model in use.
