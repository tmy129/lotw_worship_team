## ADDED Requirements

### Requirement: Relational schema for worship entities

The data store SHALL hold weeks, votes, schedule assignments, songs, vote settings, worship member profiles, and worship LINE bindings as Postgres tables with declared primary keys, in the same database as the management system and distinguished from its tables by a worship name prefix. Tables referencing a week SHALL declare a foreign key to the weeks table, and tables naming a member SHALL declare a foreign key to the management system's person record.

#### Scenario: Vote references a missing week

- **WHEN** a vote row is inserted for a week identifier absent from the weeks table
- **THEN** the database rejects the insert and the API surfaces the failure as an error envelope

#### Scenario: Assignment references a person who was deleted

- **WHEN** a person record is deleted in the management system while schedule assignments reference it
- **THEN** the foreign key prevents an orphaned assignment from remaining readable as a valid member reference

### Requirement: Week identifiers stored as dates

The weeks table SHALL store its identifier as a date column, and the API SHALL render it as a `YYYY-MM-DD` string. Normalizing week identifiers at read time SHALL NOT be necessary because the column type admits no other representation.

#### Scenario: Identifier rendered consistently

- **WHEN** any action returns a week identifier
- **THEN** the value is a zero-padded `YYYY-MM-DD` string regardless of how it was supplied at write time

##### Example: accepted write forms and stored result

| Supplied at write | Stored | Returned |
| ----------------- | ------ | -------- |
| 2026-10-03 | 2026-10-03 | "2026-10-03" |
| 2026-10-3 | 2026-10-03 | "2026-10-03" |
| 2026-10-03T00:00:00Z | 2026-10-03 | "2026-10-03" |

### Requirement: One vote per member per week

The votes table SHALL declare a composite primary key over week and person, so a member holds at most one vote for a week. Casting a vote SHALL be an upsert that replaces any prior value and records the update time.

#### Scenario: Member changes their vote

- **WHEN** a member who already voted yes for a week casts no for that same week
- **THEN** the stored vote becomes no, the update time advances, and the week still holds exactly one vote row for that member

### Requirement: Schedule role cardinality enforced by the schema

The schedule table SHALL permit at most two assignments per week for the roles 主領 and 配唱, and exactly one assignment per week for every other role, enforced by unique indexes rather than by de-duplication at read time. Saving a week's schedule SHALL replace that week's assignments atomically.

#### Scenario: Second person assigned to a single-person role

- **WHEN** a save assigns two different members to 鋼琴 in the same week
- **THEN** the database rejects the write and the week's previously stored assignments remain unchanged

#### Scenario: Replacing a week's schedule

- **WHEN** a save supplies a new set of assignments for a week that already has assignments
- **THEN** the prior assignments for that week are removed and the new set is stored in the same transaction, leaving no partial state if the write fails

### Requirement: Worship profile attributes stored with their natural types

The worship member profile table SHALL store the in-app role, scheduling constraint, avatar color, initials, and display name for a person, with at most one profile row per person. The profile MUST NOT duplicate email, instruments, or active status, because those are read from the management system; the display name is the team's short name for the person, not a second copy of the church record's name.

#### Scenario: Duplicate profile prevented

- **WHEN** a second profile row is inserted for a person who already has one
- **THEN** the database rejects the insert

### Requirement: Pre-practice history derived by query

The data store SHALL answer the pre-practice history request with each member's most recent 練前預備 week, computed by query over the schedule table.

#### Scenario: Member assigned in several weeks

- **WHEN** a member holds 練前預備 assignments in three different weeks
- **THEN** the history reports only that member's latest week

##### Example: latest week per member

- **GIVEN** 練前預備 assignments: person A in 2026-03-07 and 2026-05-02, person B in 2026-04-04
- **WHEN** the pre-practice history is requested
- **THEN** the result maps person A to 2026-05-02 and person B to 2026-04-04

### Requirement: Migration from the spreadsheet validates before loading

The import SHALL load exported sheet data into the database inside a single transaction, resolving every member reference through the completed person mapping, and SHALL fail with the offending rows identified when any row violates a schema constraint or names an unmapped member. The import SHALL rename legacy role labels to their current equivalent before validating, so historical rows land under the role the roster now uses. The import MUST NOT silently discard rows: a conflict SHALL be loaded only when a waiver naming that exact week and role records the human decision to keep the last row, and every waived drop SHALL be reported.

#### Scenario: Export contains duplicate schedule rows

- **WHEN** the exported schedule contains two rows assigning different members to 鼓 in the same week
- **THEN** the import aborts, reports both rows and the constraint they violate, and leaves the database unchanged

#### Scenario: Legacy role label

- **WHEN** the export contains schedule rows recorded under a legacy role label that the roster no longer uses
- **THEN** those rows are loaded under the current equivalent role and are counted against that role's cardinality

##### Example: legacy role rename

| Exported role | Loaded as | Rows |
| ------------- | --------- | ---- |
| 弦樂 | Keyboard | 11 |
| Keyboard | Keyboard | 26 |

#### Scenario: Placeholder assignment

- **WHEN** the export contains a schedule row whose member name is the placeholder dash and which names no member
- **THEN** the row is not loaded, because it records the absence of an assignment rather than an assignment, and the count of skipped placeholders is reported

#### Scenario: Waived conflict

- **WHEN** a waiver names the week and role of a cardinality conflict
- **THEN** the last exported row for that week and role is loaded, the earlier rows are dropped, and each dropped row is reported

#### Scenario: Clean export with a complete mapping

- **WHEN** every exported row satisfies the schema constraints, every referenced member resolves through the mapping, and no conflict is outstanding
- **THEN** the import commits, and the row count of each loaded table matches the exported record count less any waived drops
