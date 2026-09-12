## Context

The worship backend is a Cloudflare Worker over a Neon database shared with the church management system. The published client is a single-file Vite bundle on GitHub Pages that signs in through LINE Login and then calls the Worker with a shared secret. Roster membership, names and instruments are read from the management system; schedules, votes, songs and LINE bindings are worship's own.

Two LINE providers are in play, and they do not share identifiers. Worship owns LINE Login channel 2009964527 and, in the same provider, the worship official account whose Messaging API channel carries every push this backend sends. The church management system owns channel 2007892040 and the church-wide LOTW official account, and already serves its own LIFF pages at `/liff/profile`, `/liff/events` and `/liff/bind`. A LINE user id issued by one provider is meaningless to the other, which is why worship keeps its own bindings table rather than reading the management system's identities.

The coverage of those two tables is lopsided, and it decides this design. Worship holds 18 bindings: all 16 active 敬拜部 members, plus 易學仁 and 蘇建勳, who remain bound from the spreadsheet migration even though they now belong to 影音組 rather than 敬拜部. The management system holds 2 approved identities in total.

## Goals / Non-Goals

**Goals:**

- A person taps a rich menu entry in LINE and immediately sees when they are next serving and what the songs are, with no sign-in step.
- A person with no worship binding still sees the songs.
- The audio-visual team receives the weekly song announcement.
- Nothing about the management system's data or its own LIFF pages changes.

**Non-Goals:**

- Writes from the portal. Voting, song submission, schedule editing and profile editing stay in the full web app.
- Self-binding from the portal. Every person who matters is already bound, and a name picker on an unauthenticated page would let any viewer claim any identity.
- Identifying portal viewers through the management system's channel. Rejected on coverage, as described under the channel decision below.
- Replacing the existing web app or its LINE Login flow. The portal is an additional, narrower surface.
- Configuring the rich menu. That is a LINE console operation performed by the account administrator.

## Decisions

### The portal registers under worship's own LINE Login channel

The LIFF app is created under channel 2009964527, worship's existing LINE Login channel, and its entry is added to the rich menu of the worship official account — the Messaging API channel in that same provider. Menu, LIFF app and bindings therefore all sit in one id space, and the subject of a token minted for a viewer of that menu is the same identifier the web app's LINE Login already stored for them.

The alternative — registering under the management system's channel 2007892040, alongside its existing LIFF apps — is the more obvious choice on paper and is rejected on measurement. Under worship's channel, `liff.getIdToken()` yields a subject that matches a worship binding for all 18 people who have one, so the portal works for every roster member and both audio-visual members on the day it ships. Under the management system's channel it would match 2 people, and everybody else would be sent through an admin-approved binding request before seeing a schedule. Reusing that provider also means reusing its approval queue, which nobody is watching on worship's behalf.

There is no consent screen for the people who matter. The web app's LINE Login already requests the `profile openid` scopes on this channel, and every one of the 18 bound people signed in through it, so the authorization the LIFF needs is already granted; the portal opens straight into their schedule. Only an account that has never used the web app meets a prompt, which is the ordinary first-use flow.

### The viewer is identified by a server-verified LIFF ID token

The page sends the ID token from `liff.getIdToken()`, which LINE issues only when the LIFF app holds the `openid` scope. The Worker posts it to LINE's `https://api.line.me/oauth2/v2.1/verify` endpoint with worship's channel id as `client_id`, and uses the `sub` of the verified payload as the LINE user id. That id is looked up in worship's bindings to find the person, and because the LIFF app and the web app's LINE Login share channel 2009964527, it is the same identifier that login already stored — no re-binding, no second id space.

The rejected alternative is sending `liff.getProfile().userId` and trusting it. Every Worker action is gated only by a shared secret that is compiled into a public bundle, so a caller-supplied user id would let anyone holding that secret read anyone's schedule. Verification moves the guarantee from "the client says so" to "LINE says so", and matches what the existing `loginWithLine` action already does with an authorization code. The shared secret still gates the action, as it gates every action; the ID token is what distinguishes one person from another.

### The portal ships as a second page of the same Vite build

A `liff.html` page is added beside `index.html`, with its own React root under `src/liff/`. Both are inlined by the existing single-file plugin and published by the existing Pages workflow, so the portal lives at `liff.html` under the same origin the Worker already allows.

It is built as a second pass rather than a second rollup input. The single-file plugin inlines everything by turning code splitting off, and rollup refuses that mode with more than one input, so `build.rollupOptions.input` cannot name both pages. `npm run build` therefore runs the default config and then a portal config that writes into the same `dist` without emptying it. The alternative — dropping the single-file plugin so the portal can emit separate chunks — was rejected because the plugin applies to the whole build, and the full app's single-file packaging is what the Pages deployment relies on.

A separate repository or a separate host was rejected: it would duplicate the deployment, and it would need a second entry in the Worker's allowed origin, which today is a single value. Adding the portal to the existing app as a route was rejected because the app's bundle carries the whole administrative UI and its LINE Login flow, which a rich menu reader neither needs nor should wait for.

### The portal reads through one action that returns everything it shows

A single read action, `getPortalData`, takes the ID token and returns the viewer's display name, their upcoming assignments, and the upcoming weeks with their songs and speakers. The portal makes one request.

Reusing `getMySchedule` and `getSongsForMonth` from the portal was rejected on two counts: `getMySchedule` takes a member id as a parameter, which is exactly the trust the ID-token decision removes, and a month-based song read would need the portal to work out which months the coming weeks fall in and issue two requests on a mobile connection.

### The portal shows only published songs

Song rows carry a `confirmed` flag; a worship leader's submission is unconfirmed until an administrator publishes it. The portal returns only confirmed songs, and presents a week with none as awaiting announcement. The full app keeps showing unconfirmed songs to the leaders and administrators who need to act on them. Without this split, a draft song list would reach the whole congregation through the rich menu before anyone approved it.

### Song recipients outside the roster are recorded as teams, not people

A worship-owned table names the management system's teams whose active members receive the weekly song announcement, seeded with 影音組. The announcement's recipients become the week's roster plus the members of those teams, addressed through their worship bindings and de-duplicated so somebody in both groups is messaged once.

Naming the two people directly was rejected: the requirement is about a role in the service, not about two individuals, and the list would go stale the moment the team changes. A constant in the Worker's source was rejected because changing it requires a deploy, while a row can be added by whoever maintains the database. There is deliberately no user interface for the table; adding a team is a SQL insert, which is proportionate to how rarely it happens.

## Implementation Contract

**In scope:** the LIFF page and its build entry, the ID-token verification and portal read action in the Worker, the song-audience table and the recipient rule for the weekly announcement, and the documentation of the new build variable.

**Out of scope:** any write path from the portal, any change to the management system's repository or tables, the rich menu and LIFF app registration in the LINE console, and the existing web app's own LINE Login flow.

**Behavior.** A member of 敬拜部 opening the portal from LINE sees their own display name, every upcoming week they are assigned to with the roles they hold that week, and the coming weeks' published songs. A viewer with a worship binding but no upcoming assignments sees their name and a statement that they have nothing scheduled, alongside the songs. A viewer with no worship binding sees the songs and a statement that their LINE account is not linked, naming the full web app as the place to link it. No viewer sees an error screen merely for being unknown.

**Interface.** One new read action, `getPortalData`, accepts `idToken` and returns:

```
{
  member: { id, name } | null,
  mySchedule: [ { weekId, roles: [string] } ],
  weeks: [ { weekId, songs: [ { slot, name, youtube } ], speaker: string } ]
}
```

`weeks` covers service weeks from the current Asia/Taipei date forward, capped at six, ordered ascending. `songs` contains only confirmed rows. `mySchedule` is empty when `member` is null, and is restricted to weeks from the current date forward. The response travels in the Worker's existing `{ok, data}` envelope and the action is gated by the shared secret like every other action.

**Failure modes.** An absent, malformed, expired, or wrong-channel ID token fails the action with an error envelope naming the token as the reason — it is not silently downgraded to an anonymous view, because that would hide a misconfigured channel behind a page that still renders. A valid token whose subject has no worship binding is not an error: it returns `member: null` with the songs still populated. A member without a binding is skipped by the song announcement and reported in the outcome, as recipients are skipped today.

**Acceptance criteria.**

- Calling `getPortalData` with a token minted for a different channel returns an error envelope naming the token, and issues no database query.
- Calling it with a bound member's token returns that member and their future assignments only; a week in the past does not appear.
- Calling it with an unbound account's token returns `member: null` and a non-empty `weeks`.
- A week holding one confirmed and one unconfirmed song returns only the confirmed one.
- Publishing a song list for a week reaches both audio-visual members in addition to that week's roster, with anybody serving in that week and listed in an audience team receiving exactly one message.
- The built `dist` contains both `index.html` and `liff.html`, and loading `liff.html` outside LINE reports that it must be opened from LINE rather than failing with an uncaught error.

## Risks / Trade-offs

- [The LIFF app is registered without the `openid` scope, so no ID token can be issued] → The scope is set when the LIFF app is created and is asserted before the rich menu entry is added, by opening the portal and reading a real schedule. Without it the page reports a token failure rather than rendering an anonymous view, so the misconfiguration cannot ship silently.
- [The portal's page is public, and its bundle carries the shared secret] → Unchanged from the existing app, which is public and carries the same secret. What the portal adds is that a person's schedule is now reachable only with a LINE-issued token for that person, which is stricter than the existing `getMySchedule`. Making the secret per-user is a separate change.
- [`liff.html` is reachable in an ordinary browser, where the LIFF SDK has no token] → The page detects this and says it must be opened from LINE. It does not attempt a browser login flow.
- [A recipient is bound but has never added the worship official account, so a push to them is rejected] → Both halves of this change depend on the same precondition: a push needs the recipient to be a friend of that account, and the rich menu is only visible to its followers. The song-audience verification asserts a message actually reaches both audio-visual members rather than asserting the recipient list contains them, so a missing friendship surfaces as a reported failure at verification time instead of as a notification nobody receives.
- [Song announcements now reach people who never opted in] → The audience is limited to active members of teams the church itself records, and the message is the same song list the roster already receives.
- [The LIFF SDK is a new external dependency loaded from LINE's CDN] → It is loaded by the page, not bundled, and it is the only supported way to obtain an ID token inside LINE. A failure to load leaves the page reporting that it must be opened from LINE.
- [A second Vite entry could break the existing single-file build] → The build is verified by loading both pages from a served `dist` before deploying, which is the check the project adopted after a blank-page outage.

## Migration Plan

1. Apply the song-audience migration to the production database and seed it with 影音組. It is additive; nothing reads the table until the Worker is deployed.
2. Deploy the Worker with the portal action. The existing app is unaffected, since no existing action changes shape.
3. Build and publish the site with the LIFF id supplied as a build variable. `liff.html` becomes reachable but is not yet linked from anywhere.
4. Register the LIFF app in the LINE console under channel 2009964527, granting it the `profile` and `openid` scopes and pointing it at the published `liff.html`, then add the rich menu entry on the worship official account.

Rollback is per step and independent: removing the rich menu entry hides the portal without touching anything else; the Worker action and the table can remain in place unused.

## Open Questions

- Whether the portal should also show the practice time and location for an assigned week. The schedule table holds those fields but no current screen reads them, so they are left out until somebody asks.
- Whether 司會組 should join 影音組 in the song audience. The table makes this a one-row decision for the church to make later.
