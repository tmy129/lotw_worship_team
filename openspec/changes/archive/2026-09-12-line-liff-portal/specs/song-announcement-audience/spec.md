## ADDED Requirements

### Requirement: The song announcement reaches teams recorded as its audience

The weekly song announcement SHALL be delivered to the week's roster and to the active members of every team recorded as a song audience. The recorded audience SHALL include 影音組.

#### Scenario: The audio-visual team is notified for a week it does not serve in

- **WHEN** the song list for a week is published
- **THEN** the active members of 影音組 receive the announcement
- **AND** they receive it whether or not anybody from that team appears in the week's schedule

#### Scenario: The roster still receives the announcement

- **WHEN** the song list for a week is published
- **THEN** everybody assigned to that week, other than the speaker, receives the announcement

### Requirement: The audience is held as data, not as a list of people

The teams whose members receive the song announcement SHALL be recorded in worship's own storage and read at send time, so that changing the audience requires no code change. Membership of those teams SHALL be read from the church management system rather than copied.

#### Scenario: A team added to the audience is notified without a deployment

- **WHEN** a further team is recorded as a song audience and a song list is then published
- **THEN** the active members of that team receive the announcement

#### Scenario: A person who leaves an audience team stops receiving announcements

- **WHEN** a person's membership of an audience team is made inactive in the church management system and a song list is then published
- **THEN** that person does not receive the announcement, unless they are on the week's roster

### Requirement: Each recipient is messaged once

A person who is both on the week's roster and a member of an audience team SHALL receive exactly one announcement.

#### Scenario: Overlapping membership does not duplicate the message

- **WHEN** a person serving in the published week is also an active member of an audience team
- **THEN** exactly one message is sent to that person

##### Example: recipient set for one week

- **GIVEN** the week's roster is 保秀貞 and 張翔, and 張翔 is also an active member of an audience team
- **AND** the audience team's other active member is 蘇建勳
- **WHEN** the song list for that week is published
- **THEN** three messages are sent, one each to 保秀貞, 張翔 and 蘇建勳

### Requirement: A recipient without a LINE binding is skipped and reported

A recipient who holds no worship LINE binding SHALL be skipped rather than failing the publication, and SHALL be named in the action's outcome.

#### Scenario: An unbound audience member does not block the announcement

- **WHEN** a song list is published and one member of an audience team holds no worship LINE binding
- **THEN** every other recipient receives the announcement
- **AND** the action succeeds, naming the skipped person in its outcome
