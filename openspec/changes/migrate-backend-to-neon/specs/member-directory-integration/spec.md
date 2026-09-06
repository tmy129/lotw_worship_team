## ADDED Requirements

### Requirement: Roster derived from the management system

The worship roster SHALL be the set of persons holding an active 敬拜部 team membership whose person record is also active, read from the management system's tables. A person added to or removed from that team in the management system SHALL appear in or disappear from the worship roster with no action taken in the worship application.

#### Scenario: Person joins the worship team

- **WHEN** an administrator adds a person to 敬拜部 in the management system and the worship roster is requested afterwards
- **THEN** that person is present in the roster and is available for scheduling

#### Scenario: Team membership deactivated

- **WHEN** a person's 敬拜部 membership is marked inactive
- **THEN** the person is absent from the roster while their past votes and assignments remain stored

### Requirement: Instruments sourced from team positions

A member's instruments SHALL be the names of their 敬拜部 team positions, and the worship application MUST NOT store or modify them. The ability to serve on PPT SHALL be derived from holding the PPT position rather than from a stored flag.

#### Scenario: Positions changed upstream

- **WHEN** an administrator adds the 鋼琴 position to a member in the management system
- **THEN** the next roster read reports that member's instruments including 鋼琴, with no write performed by the worship application

##### Example: derived member fields

| Team positions held | instruments returned | canPPT |
| ------------------- | -------------------- | ------ |
| 主領, 配唱, PPT | ["主領", "配唱", "PPT"] | true |
| 鼓 | ["鼓"] | false |
| none | [] | false |

### Requirement: Worship-specific attributes in a worship-owned profile

Scheduling constraints, avatar color, initials, the in-app role, and the short display name the team uses SHALL be stored in a worship-owned profile table keyed by person id with a foreign key to the management system's person record. The roster SHALL present a member under that display name, falling back to the person's name from the church record when the profile sets none. A member without a profile row SHALL still appear in the roster, carrying the member role and their formal name.

#### Scenario: Member has no profile row

- **WHEN** a person with an active 敬拜部 membership and no worship profile row is read
- **THEN** the roster entry carries their name and email from the person record, an in-app role of member, and no scheduling constraint

#### Scenario: Team uses a different name than the church record

- **WHEN** a member's profile sets a display name that differs from the person's recorded name
- **THEN** the roster presents the display name, and the person record in the management system is unchanged

##### Example: name presented

| Person record | Worship profile display name | Roster shows |
| ------------- | ---------------------------- | ------------ |
| 保秀貞 | Victoria | Victoria |
| 周文卿 | 世綸 | 世綸 |
| 伍運福 | none | 伍運福 |

#### Scenario: Constraint recorded for scheduling

- **WHEN** a scheduling constraint is saved for a member
- **THEN** it is stored in the worship profile, returned with that member, and the management system's person record is unchanged

### Requirement: Management-owned tables are read-only in normal operation

The worship application SHALL only read the management system's tables and MUST NOT insert, update, or delete rows in them, including its identity table.

#### Scenario: Member edit attempted through the worship API

- **WHEN** a request asks the worship API to create, update, or delete a member
- **THEN** the API responds with an error envelope naming the unsupported action, and no management table is written

### Requirement: Members matched to persons during migration

The migration SHALL map every member referenced by an exported vote or schedule row to exactly one person by applying four rules in order and stopping at the first that yields exactly one candidate: exact email address, exact normalized name against the Chinese name or the English name, the normalized name being a suffix of at least two characters of the Chinese name, and the normalized name equalling any whitespace-separated token of the English name. Normalization strips all whitespace and folds case. A rule that yields more than one candidate SHALL stop the search and mark the member ambiguous rather than choosing. Members that do not resolve to exactly one person SHALL be written to a mapping file for human completion, and the import MUST NOT proceed while any referenced member is unresolved.

#### Scenario: Member matched by email

- **WHEN** an exported member's email matches exactly one person record
- **THEN** the mapping records that person's identifier for the member without human input

#### Scenario: Given name is a suffix of the full name

- **WHEN** an exported member's name is a suffix of exactly one person's Chinese name and no earlier rule resolved them
- **THEN** the mapping records that person for the member

#### Scenario: English name carries a surname

- **WHEN** an exported member's name equals one token of exactly one person's English name and no earlier rule resolved them
- **THEN** the mapping records that person for the member

#### Scenario: Nickname with no counterpart

- **WHEN** no rule yields a candidate for an exported member
- **THEN** the member is listed as unresolved in the mapping file, and the import refuses to run until a person is chosen

#### Scenario: Rule yields several candidates

- **WHEN** a rule matches more than one person for the same member
- **THEN** the member is marked ambiguous with those candidates listed, and no later rule is applied

##### Example: matching outcomes

| Exported member | Person records | Rule | Outcome |
| --------------- | -------------- | ---- | ------- |
| name Tammy, email on file | person 張翔 with that email | email | matched |
| name Jean | person 王璟 with english_name Jean | exact name | matched |
| name 筠軒 | person 周筠軒 | suffix | matched |
| name Richard | person 張書銘 with english_name Richard Chang | English name token | matched |
| name 世綸 | no person by email, name, suffix, or token | none | unresolved, written to the mapping file |

### Requirement: Member identifiers are person identifiers

Every worship record that names a member — votes, schedule assignments, and profiles — SHALL reference the management system's person identifier, and the API SHALL use that identifier in requests and responses. The migration SHALL rewrite exported member references through the completed mapping.

#### Scenario: Imported vote references the person

- **WHEN** a vote exported with an email-shaped member id is imported under a completed mapping
- **THEN** the stored vote references the mapped person identifier and the API returns that identifier in the vote summary
