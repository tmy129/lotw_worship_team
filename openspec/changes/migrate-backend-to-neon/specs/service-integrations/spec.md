## ADDED Requirements

### Requirement: Credentials supplied by runtime bindings

Every external credential — the shared application secret, the database connection, the LINE channel identifier and secret, the LINE messaging token, the Groq API key, and the Google OAuth client and refresh token — SHALL be read from Worker environment bindings. Credentials MUST NOT be committed to the repository or read from a Google Script Property.

#### Scenario: Required credential is absent

- **WHEN** an action requiring a credential runs and that binding is not configured
- **THEN** the action fails with an error envelope naming the missing configuration rather than attempting the outbound call

### Requirement: LINE login resolved through worship bindings

The API SHALL exchange a LINE authorization code for an access token, fetch the LINE profile, and resolve the signed-in member by looking up the worship binding for that LINE user identifier. When no binding exists, the response SHALL carry the LINE profile with a null member so the application can show its unbound state. The API SHALL record a binding on request, associating a LINE user identifier with a person. Bindings SHALL be stored in a worship-owned table, because worship authenticates through a different LINE channel than the management system and identifiers issued by one provider have no meaning under the other. The API MUST NOT read or write the management system's identity table.

#### Scenario: Bound member signs in

- **WHEN** a member whose LINE account is bound signs in
- **THEN** the response carries the LINE profile and the roster member for the person that binding names

#### Scenario: Unbound account signs in

- **WHEN** a LINE account with no worship binding signs in
- **THEN** the response carries the LINE user identifier, display name, and picture with a null member

#### Scenario: Binding recorded

- **WHEN** a bind request supplies a person and a LINE user identifier
- **THEN** the binding is stored in the worship table and the member is returned on the next sign-in

### Requirement: One-off seed of existing LINE bindings

The migration SHALL create worship bindings for the LINE identifiers already recorded in the worship sheet, attaching each to the matched person. The seed SHALL leave an existing binding for that person untouched, SHALL refuse to attach an identifier already held by a different person, and SHALL report both cases. Re-running the seed SHALL change nothing.

#### Scenario: Identifier already bound elsewhere

- **WHEN** the seed encounters a LINE identifier already attached to a different person
- **THEN** it writes no row for that member and reports the conflict for manual resolution

#### Scenario: Person already bound

- **WHEN** the seed encounters a person who already has a worship binding
- **THEN** the existing binding is left as it is and the member is reported as already bound

#### Scenario: Seed run twice

- **WHEN** the seed is executed a second time against the same data
- **THEN** no additional rows are created and every member is reported as already bound

### Requirement: LINE push notifications

The API SHALL push LINE messages for published song lists, leader song submissions, and song reminders, addressing each message to the recipient's bound LINE identifier. A recipient without a binding SHALL be skipped without failing the action for other recipients.

#### Scenario: One recipient has no binding

- **WHEN** a song list is published to a roster where one serving member has no binding
- **THEN** the remaining members receive the message and the action reports success

### Requirement: Calendar invitations through the Google Calendar API

The API SHALL create a practice event and a service event for a requested week on the configured Google calendar, authenticating as the account that owns it, and SHALL invite the members serving that week using the email addresses on their person records. Members whose only role that week is PPT SHALL be excluded from the practice invitation and included in the service invitation. The event description SHALL list the week's roster, including the speaker when one is assigned.

#### Scenario: Member serving only as PPT

- **WHEN** calendar events are created for a week where one member is assigned PPT and no other role
- **THEN** that member is an attendee of the service event and is absent from the practice event

#### Scenario: Member without an email address

- **WHEN** a serving member's person record has no email address
- **THEN** the events are created for the remaining attendees and the response reports which members were skipped

### Requirement: Scheduled song reminder

The API SHALL run a weekly scheduled check that, for each week whose song-selection deadline falls on the current date in Asia/Taipei, sends a LINE reminder to that week's 主領 when the third song is not yet submitted. The deadline for a week SHALL be the Thursday of the preceding week.

#### Scenario: Third song already submitted

- **WHEN** the scheduled check reaches a week whose deadline is today and whose third song has a name
- **THEN** no reminder is sent for that week and the check continues with the remaining weeks

#### Scenario: No leader assigned

- **WHEN** the scheduled check reaches a week whose deadline is today and which has no 主領 assignment
- **THEN** no reminder is sent for that week, the outcome is logged, and the check continues with the remaining weeks

##### Example: deadline derivation

| Service week | Deadline (previous Thursday) | Reminder sent on |
| ------------ | ---------------------------- | ---------------- |
| 2026-10-03 (Saturday) | 2026-09-24 | 2026-09-24 |
| 2026-10-10 (Saturday) | 2026-10-01 | 2026-10-01 |

### Requirement: AI scheduling proxy

The API SHALL forward a supplied scheduling prompt to the Groq chat completions endpoint and return the assistant's message content. The model identifier SHALL be configurable at runtime, and the completion token budget SHALL be derived from the prompt length so that the prompt and the reserved output together stay within the configured per-minute token limit. An empty completion, a non-JSON response, and an upstream error SHALL each surface as an error envelope carrying the upstream detail.

#### Scenario: Upstream rejects the request

- **WHEN** the Groq endpoint returns an error such as a decommissioned model or an exceeded token limit
- **THEN** the API responds with an error envelope carrying the upstream message rather than an empty success payload

#### Scenario: Completion is empty

- **WHEN** the upstream returns a response whose message content is empty
- **THEN** the API responds with an error envelope naming the model, the finish reason, and the token budget that was reserved
