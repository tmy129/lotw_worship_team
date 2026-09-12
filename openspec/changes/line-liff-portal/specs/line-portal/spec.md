## ADDED Requirements

### Requirement: Viewer identity comes from a server-verified LIFF ID token

The portal SHALL identify its viewer only from a LIFF ID token verified by LINE against worship's LINE Login channel, and SHALL NOT accept a LINE user id supplied by the caller. The subject of the verified token SHALL be looked up in worship's own bindings to resolve the person.

#### Scenario: A token issued for another channel is refused

- **WHEN** the portal read action receives an ID token whose audience is a channel other than worship's
- **THEN** the action returns an error envelope naming the token as the reason
- **AND** no database query is issued

#### Scenario: A missing or malformed token is refused rather than treated as anonymous

- **WHEN** the portal read action receives no ID token, or one LINE rejects as malformed or expired
- **THEN** the action returns an error envelope naming the token as the reason
- **AND** the response is not an anonymous view of the songs

#### Scenario: A verified token resolves to the bound person

- **WHEN** the portal read action receives a valid ID token whose subject holds a worship binding
- **THEN** the response names the person that binding points to

### Requirement: The portal reports a person's future assignments

The portal SHALL present every upcoming service week the viewer is assigned to, with the roles they hold in that week. Weeks earlier than the current Asia/Taipei date SHALL NOT be presented.

#### Scenario: An assigned member sees their weeks and roles

- **WHEN** a bound member with future assignments opens the portal
- **THEN** each of those weeks is listed with the roles that member holds that week

##### Example: past weeks excluded, roles grouped

- **GIVEN** the current Asia/Taipei date is 2026-09-11
- **AND** the member is assigned 主領 on 2026-09-06, and both 主領 and PPT on 2026-09-20
- **WHEN** the portal read action runs for that member
- **THEN** mySchedule contains exactly one entry, for 2026-09-20, holding the roles 主領 and PPT

#### Scenario: A bound member with nothing scheduled is told so

- **WHEN** a bound member with no future assignments opens the portal
- **THEN** the portal names them and states that they have no upcoming assignments
- **AND** the songs are still presented

### Requirement: The portal serves viewers who have no worship binding

A viewer whose verified LINE account holds no worship binding SHALL be served the songs, SHALL be told that their LINE account is not linked, and SHALL be pointed at the full web app as the place to link it. This case SHALL NOT be reported as an error.

#### Scenario: An unbound viewer still sees the songs

- **WHEN** the portal read action receives a valid ID token whose subject holds no worship binding
- **THEN** the response carries a null member and a non-empty list of upcoming weeks

#### Scenario: An audio-visual member reads the songs without a schedule

- **WHEN** a member of 影音組 who holds a worship binding opens the portal
- **THEN** the songs are presented
- **AND** no assignments are listed, because that person is not on the worship roster

### Requirement: The portal presents only published songs

The portal SHALL present only songs marked confirmed. A week whose songs are absent or unconfirmed SHALL be presented as awaiting announcement rather than omitted from the list of weeks.

#### Scenario: An unconfirmed submission stays out of the portal

- **WHEN** a week holds one confirmed song and one that a leader has submitted but nobody has published
- **THEN** the portal presents the confirmed song only

##### Example: mixed confirmation state

| Week songs                                            | Presented by the portal   |
| ----------------------------------------------------- | ------------------------- |
| slot 1 confirmed, slot 2 confirmed, slot 3 unconfirmed | slots 1 and 2             |
| all three unconfirmed                                  | none; awaiting announcement |
| no rows at all                                         | none; awaiting announcement |

### Requirement: The portal is a reader

The portal SHALL NOT offer voting, song submission, schedule editing, profile editing, or binding a LINE account to a person.

#### Scenario: No write reaches the backend from the portal

- **WHEN** the portal is exercised through every control it presents
- **THEN** every request it issues is a read

### Requirement: The portal states when it is opened outside LINE

Opening the portal's page in an ordinary browser, where no LIFF ID token exists, SHALL produce a statement that it must be opened from LINE. The page SHALL NOT fail with an uncaught error and SHALL NOT start a browser sign-in flow.

#### Scenario: The page is loaded directly in a browser

- **WHEN** the published portal page is loaded outside the LINE app
- **THEN** the page renders a statement that it must be opened from LINE
- **AND** the browser console reports no uncaught error

### Requirement: The portal is published beside the existing app

The portal SHALL be published as a second page of the same site as the existing web app, leaving that app's page and its sign-in flow unchanged, and SHALL be served from the origin the backend already permits.

#### Scenario: Both pages ship from one build

- **WHEN** the site is built
- **THEN** the build output contains both the existing application page and the portal page
- **AND** loading either page from the served output reports no uncaught error
