## Why

Two groups of people are cut off from information the system already holds.

The audio-visual team — 易學仁 and 蘇建勳 — serve every service and need the week's song list, but they are not in 敬拜部, so they are not on the worship roster and no notification addresses them. Both already carry a worship LINE binding from the spreadsheet era; they are simply never named as recipients.

Everyone else has to sign in to a web app to see anything. Worship already runs its own official LINE account — the one every notification this backend sends goes through — and its rich menu is where members look first. A member who wants to know when they are serving, or what the songs are this week, should be able to tap the rich menu and read it, rather than opening a browser and signing in through LINE OAuth.

## What Changes

- A read-only LIFF page, opened from the worship official account's rich menu, showing the signed-in person's upcoming assignments and the coming weeks' published songs. No sign-in step: the page identifies the viewer from the LIFF ID token LINE already issued.
- Identity is established server-side. The page sends its ID token; the Worker verifies it with LINE and resolves the worship binding itself. A caller-supplied LINE user id is never trusted.
- A viewer with no worship binding — an audio-visual member, a newcomer, anyone in the official account — sees the song list and a plain statement that they have no assignments, rather than an error or an empty screen.
- The weekly song announcement reaches teams outside the worship roster. Which teams is stored as data, seeded with 影音組, so adding 司會組 later needs no code change.
- The published site gains a second page. `index.html` remains the full app; `liff.html` is the portal.

## Non-Goals

- No writes from the portal. Voting, song submission, schedule editing and profile editing stay in the full web app; the portal is a reader.
- No self-binding from the portal. All 16 roster members and both audio-visual members already have bindings, so the case is hypothetical; an unbound viewer is told to use the web app rather than being offered a name picker that would let anyone claim any identity.
- The management system's LINE channel is not used to identify portal viewers. Rejected on evidence: 18 of 18 relevant people hold a worship binding, while the management system holds 2 approved identities in total, so that route would leave almost everyone unidentified. The portal registers under worship's own channel and reads worship's own bindings.
- The management system's own LIFF pages, identity table and approval flow are untouched. This change adds a second LIFF app; it does not modify the first.
- The rich menu itself is configured in the LINE console by the account's administrator, not by code in this repository.

## Capabilities

### New Capabilities

- `line-portal`: A LIFF page reachable from a LINE rich menu that identifies its viewer from a server-verified LIFF ID token and shows that person's schedule and the published songs, degrading to songs alone when the viewer has no binding.
- `song-announcement-audience`: Who receives the weekly song announcement — the week's roster plus the members of teams recorded as song recipients.

### Modified Capabilities

(none)

## Impact

- Affected specs: `line-portal`, `song-announcement-audience`
- Affected code:
  - New:
    - `liff.html`
    - `src/liff/main.jsx`
    - `src/liff/Portal.jsx`
    - `src/liff/portal.css`
    - `workers/migrations/0004_song_audience.sql`
  - Modified:
    - `vite.config.js`
    - `workers/src/index.ts`
    - `workers/src/actions/line.ts`
    - `workers/src/actions/notify.ts`
    - `.github/workflows/deploy.yml`
    - `README.md`
  - Removed: (none)
- External configuration, performed by the LINE account administrator: a LIFF app registered under worship's LINE Login channel 2009964527 pointing at the published `liff.html`, and a rich menu entry on the worship official account, which belongs to the same provider, opening it.
- The shared Neon database gains one worship-owned table. The management system's tables are read-only here, as they already are elsewhere in this backend.
