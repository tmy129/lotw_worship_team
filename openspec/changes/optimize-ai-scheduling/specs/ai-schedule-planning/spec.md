## ADDED Requirements

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

### Requirement: Prompt fits the per-minute token budget with headroom

The prompt and the reserved completion together SHALL leave at least 1500 tokens of headroom against the configured per-minute token budget for a nine-week period. A tool SHALL report the measured size and headroom and SHALL exit non-zero when the headroom is below that threshold.

#### Scenario: Prompt grows past the threshold

- **WHEN** the budget tool measures a prompt whose headroom is below 1500 tokens
- **THEN** it reports the prompt size, the reserved output and the headroom, and exits non-zero

### Requirement: The model answers with schema-valid JSON

The request SHALL ask for JSON matching a schema whose top level carries a list of weeks, each with its date and a list of role-and-members entries. The role vocabulary in the schema SHALL be supplied by the caller rather than fixed in the model request.

#### Scenario: Answer conforms

- **WHEN** the model returns JSON satisfying the schema for the requested period
- **THEN** the answer is parsed once, with no fallback parser involved

### Requirement: An invalid plan is rejected, never partially accepted

The client SHALL validate a parsed plan before use: every requested week present exactly once, every role within the supplied vocabulary, every named member drawn from that week's availability list, and no role carrying more members than it seats. A plan failing any of these SHALL be reported as an error naming the week and the reason, and MUST NOT be presented as a schedule.

#### Scenario: Truncated answer

- **WHEN** the model's answer covers fewer weeks than were requested
- **THEN** the client reports which weeks are missing and presents no schedule

#### Scenario: Unavailable member assigned

- **WHEN** the answer assigns a member to a week in which they are not available
- **THEN** the client reports that week and that member, and presents no schedule

#### Scenario: Role carries too many people

- **WHEN** the answer assigns three members to a role that seats two
- **THEN** the client reports that week and role, and presents no schedule

### Requirement: Only schedulable instruments are offered to the model

The role vocabulary SHALL be derived from the instruments the roster reports, excluding PPT and 練前預備, which are assigned by their own passes after the model answers.

#### Scenario: New position added upstream

- **WHEN** a new instrument position is added to the worship team in the church management system and a member holds it
- **THEN** the next prompt offers that instrument as a schedulable role without any code change

#### Scenario: Service roles withheld

- **WHEN** the roster reports members holding PPT or 練前預備
- **THEN** neither appears in the role vocabulary sent to the model

### Requirement: No output is requested that nothing reads

The response SHALL NOT include per-week explanatory prose, because no screen displays it and the completion budget is scarce.

#### Scenario: Plan returned

- **WHEN** the model returns a plan for a period
- **THEN** the answer carries assignments only, with no explanation field

### Requirement: Post-processing guarantees are unchanged

The monthly caps, the consecutive-week rule, PPT eligibility and pre-practice assignment SHALL continue to be enforced on the validated plan, with the same outcomes they produce today.

#### Scenario: Model overuses one person

- **WHEN** a validated plan assigns the same member to a role more often than the monthly cap allows
- **THEN** the enforcement pass rewrites those assignments exactly as it does for the current text-based plan
