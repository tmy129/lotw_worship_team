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
- Restore the reasoning effort the token budget forced down.

**Non-Goals:**

- Changing the rotation rules themselves. The monthly caps, the no-consecutive-weeks rule, PPT eligibility and pre-practice assignment keep their current behavior and their current implementations.
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

### Rules the client enforces are stated once, not taught

The prompt currently spends 807 characters walking the model through rotation rules step by step. Those rules are enforced afterwards by the client's monthly-cap, consecutive-week and PPT-eligibility passes, which rewrite whatever the model returns. The rules stay in the prompt as a short constraint list, because a first draft that respects them needs less rewriting, but they stop being a tutorial.

### Role vocabulary derived from the roster

The instrument list is currently a constant in the client. It becomes the set of instruments the roster reports, minus the service roles that are assigned by other means: PPT is chosen by the PPT-eligibility pass and pre-practice by its own assignment pass, so neither is offered to the model as an instrument. A position added to the 敬拜部 team in the church management system therefore becomes schedulable without a code change, which is the point of sourcing the roster from there.

### Reasoning effort returns to medium

The backend lowered the reasoning effort to low when the output budget shrank to about 2900 tokens. With the prompt halved the budget roughly doubles, and the effort returns to medium — the setting in use before the token pressure, and the one that produced the more coherent drafts.

### A budget check that fails loudly

A script measures the prompt a given period produces and compares prompt plus reserved output against the configured per-minute budget. It exits non-zero when the headroom falls below 1500 tokens, so prompt growth is caught deliberately rather than discovered when a Saturday plan fails.

## Implementation Contract

**Behavior.** A leader plans a period exactly as today: press the button, wait, review a draft covering every week of the period. What changes is that the request comfortably fits the token budget, a bad answer says so instead of quietly covering fewer weeks, and roles the church record knows about are schedulable without a release.

**Interface and data shape.** The client sends the same `runAISchedule` action with a `prompt`. The backend additionally sends a response format naming a JSON schema whose top level is an object with a `weeks` array; each entry carries the week's date as `YYYY-MM-DD` and an `assignments` array of objects with a `role` drawn from the supplied vocabulary and a `members` array of names. The client validates the parsed answer before use: every requested week present exactly once, every role within the vocabulary, every name drawn from that week's availability list, and no role carrying more members than it seats. The existing post-processing passes then run unchanged on the validated result.

**Failure modes.** An answer that is not valid JSON, does not satisfy the schema, omits or duplicates a week, or names someone unavailable is rejected with a message naming the specific failure and the week involved. Nothing partially valid is shown as a schedule. The upstream errors the proxy already surfaces — decommissioned model, rate limit, empty completion — keep their current behavior.

**Acceptance criteria.** For the same nine-week period the prompt is at most half of 7771 characters. The budget script reports at least 1500 tokens of headroom for that period and exits non-zero when it does not. Planning that period returns a schema-valid answer covering all nine weeks, and every assigned name appears in that week's availability list. A deliberately truncated answer and an answer naming an unavailable member are each rejected with a message naming the week and the reason. Running the post-processing passes over the validated result produces assignments that satisfy the monthly caps and the consecutive-week rule, as they do today.

**In scope.** The batch prompt builder, the response parsing and validation that replaces the two text parsers, the schema and response-format parameter in the AI proxy, the reasoning effort setting, the role vocabulary derivation, and the budget script.

**Out of scope.** Everything in Non-Goals, plus the single-week prompt builder and its template, which is unused by the batch flow and stays as it is.

## Risks / Trade-offs

- [JSON schema mode may follow the schema but fill it poorly in Chinese, or the reasoning model may spend its budget before emitting the object] → The validation names what failed, and the same period is planned with both the old and new prompt before switching, comparing weeks covered and rule violations rather than trusting a single run.
- [Removing the step-by-step rule text may produce first drafts that violate rotation rules more often, increasing how much the post-processing rewrites] → The enforcement passes are unchanged and still decide the final answer, so correctness cannot regress; the comparison run records how many assignments each version rewrites so a quality drop is visible rather than assumed.
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
