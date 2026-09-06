## ADDED Requirements

### Requirement: Action routing over two entry points

The API SHALL accept read actions as HTTP GET requests carrying an `action` query parameter and write actions as HTTP POST requests carrying an `action` field in a JSON body. The API SHALL support every action the SPA invokes: getInitialData, getMembers, getWeeks, getWeeksByMonths, getVoteSettings, getVotes, getVotesByMember, getVoteSummary, getSchedule, getMySchedule, getPrePracticeHistory, getSongs, getSongsForMonth, getSpeakersForMonth, saveWeek, saveVoteSetting, deleteVoteSetting, castVote, castVoteBulk, saveSchedule, confirmSchedule, sendScheduleCalendar, saveSongs, publishSongs, submitLeaderSong, sendSongReminder, runAISchedule, saveMemberProfile, loginWithLine, and bindLineUser. The API SHALL NOT serve saveMember or deleteMember, because member records are owned by the management system.

#### Scenario: Unknown action

- **WHEN** a request names an action the API does not implement
- **THEN** the API responds with an error envelope whose message names the unrecognized action

#### Scenario: Retired member action

- **WHEN** a request names saveMember or deleteMember
- **THEN** the API responds with an error envelope naming the action as unsupported and writes nothing

#### Scenario: Read action over GET

- **WHEN** a GET request supplies action getSchedule and a weekId parameter
- **THEN** the API responds with the schedule rows for that week in a success envelope

### Requirement: Uniform response envelope

The API SHALL answer every request with a JSON body of either `{"ok": true, "data": <payload>}` or `{"ok": false, "error": "<message>"}` and a `Content-Type` of `application/json`. The API SHALL NOT return an HTTP error status in place of an error envelope for application-level failures, because the SPA reads the envelope rather than the status.

#### Scenario: Handler raises an error

- **WHEN** an action handler throws while processing a valid request
- **THEN** the API responds with an error envelope carrying the failure message and does not expose a stack trace

### Requirement: Shared secret authentication

The API SHALL reject any request whose `secret` value does not match the configured shared secret, comparing the two in constant time. The secret SHALL be read from a Worker binding and MUST NOT be embedded in source.

#### Scenario: Missing or wrong secret

- **WHEN** a request omits the secret or supplies a value that does not match
- **THEN** the API responds with an error envelope carrying the message Unauthorized and performs no database read or write

### Requirement: Cross-origin access for the published SPA

The API SHALL include an access-control allow-origin header naming the origin the SPA is served from on every response, including error responses.

#### Scenario: Request from the published site

- **WHEN** the SPA running on the published GitHub Pages origin posts an action to the API
- **THEN** the browser accepts the response because the allow-origin header names that origin

### Requirement: Response payloads preserve the current client contract

The API SHALL return payloads carrying the same field names and structure as the Apps Script backend for the same inputs, so the SPA parses them without modification. Values SHALL be returned in their natural JSON type — booleans as booleans, numbers as numbers — rather than as the display strings a spreadsheet read produced. Member identifiers SHALL be person identifiers rather than email addresses, and week identifiers SHALL be `YYYY-MM-DD` strings in every request and response. Roster content SHALL follow the church record rather than the retired sheet.

#### Scenario: Initial data bundle

- **WHEN** getInitialData is requested with a member id
- **THEN** the payload contains members, weeks, and voteSettings collections plus a mySchedule entry for that member

#### Scenario: Member field types

- **WHEN** getMembers is requested
- **THEN** each member carries instruments as an array of strings and canPPT as a boolean, and people without an active 敬拜部 membership are absent

##### Example: member payload shape

| Field | Source | Returned value |
| ----- | ------ | -------------- |
| id | person record identifier | UUID string |
| name | worship profile display name, else the person's name | "Victoria" |
| instruments | 敬拜部 positions held | ["主領", "鋼琴"] |
| canPPT | PPT position held | true |
| constraints | worship profile, when present | free text, otherwise absent |

#### Scenario: Values carry their natural type

- **WHEN** an action returns a field the spreadsheet stored as a display string, such as a song's slot number or its confirmed flag
- **THEN** the payload carries a number and a boolean rather than the strings the sheet read produced

##### Example: song payload types

| Field | Sheet backend returned | This API returns |
| ----- | ---------------------- | ---------------- |
| slot | "1" | 1 |
| confirmed | "TRUE" | true |

#### Scenario: Unassigned role

- **WHEN** a week's schedule has no one in a role
- **THEN** the payload carries no row for that role, rather than a row naming the placeholder dash

#### Scenario: Schedule role cardinality in responses

- **WHEN** getSchedule is requested for a week where 主領 and 配唱 each have two people assigned and 鼓 has one
- **THEN** the payload contains two rows for 主領, two rows for 配唱, and exactly one row for 鼓

### Requirement: Health check action

The API SHALL expose a health action that executes the roster join and reports success, so a misconfigured database binding or an incompatible upstream schema change is detectable without invoking a business action.

#### Scenario: Database binding is misconfigured

- **WHEN** the health action is requested and the database connection cannot be established
- **THEN** the API responds with an error envelope describing the connection failure

#### Scenario: Upstream table or column is missing

- **WHEN** the health action runs after a management system schema change that removes a column the roster join reads
- **THEN** the API responds with an error envelope naming the failing relation rather than reporting success
