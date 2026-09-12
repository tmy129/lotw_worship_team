# LOTW 敬拜團排班系統

A scheduling app for the worship team at 世界之光浸信會. A React single-page app
published to GitHub Pages, talking to a Cloudflare Worker (`workers/`) over a Neon
Postgres database shared with the church management system, which owns the member
records this app reads.

## The two published pages

`npm run build` produces two self-contained pages in `dist/`:

| Page         | Who it is for                          | How it identifies you                     |
| ------------ | -------------------------------------- | ----------------------------------------- |
| `index.html` | The full app — voting, song selection, scheduling, admin | LINE Login (channel 2009964527) |
| `liff.html`  | The LINE portal — read-only 我的班表 and 詩歌 | A LIFF ID token, verified server-side      |

They are two passes of the same build: `vite-plugin-singlefile` inlines
everything by turning code splitting off, which rollup will not combine with more
than one input, so `vite.liff.config.js` builds the portal into the same `dist`
without emptying it.

## Build variables

Set in GitHub → Settings → Secrets and variables → Actions. The Pages workflow
passes all three to `npm run build`; `.env.local` holds them for local builds.

| Variable           | Where its value comes from                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `VITE_GAS_URL`     | The deployed Worker's URL (`wrangler deploy` prints it)                  |
| `VITE_APP_SECRET`  | Must equal the Worker's `APP_SECRET` secret                              |
| `VITE_LIFF_ID`     | The LIFF app id from the LINE Developers console (see below)             |

None of these are secret in the cryptographic sense — they are compiled into a
public page. The shared secret gates the API against casual traffic; what protects
one person's schedule from another's is the LINE ID token, which the Worker
verifies with LINE on every portal request.

## The LINE portal

The portal is a LIFF app under **worship's own LINE Login channel 2009964527** —
the same channel the web app signs in with, and the same provider as the worship
official account. That is deliberate: every member who has signed in to the web
app has already granted this channel `profile openid`, so opening the portal shows
them no consent screen, and the LINE user id it yields is the one already stored
in `worship_line_identities`. A LIFF under the church management system's channel
would issue identifiers this app cannot resolve.

To set it up in the LINE Developers console:

1. Open channel 2009964527 → **LIFF** → **Add**.
2. Endpoint URL: `https://tmy129.github.io/lotw_worship_team/liff.html`
3. Size: Full. Scopes: **`profile` and `openid`** — without `openid` LINE issues no
   ID token and the portal will report that it cannot identify the viewer.
4. Copy the issued LIFF id into `VITE_LIFF_ID` and re-run the Pages workflow.
5. In the worship official account's rich menu, point an entry at the LIFF URL
   the console shows (`https://liff.line.me/<VITE_LIFF_ID>`).

A viewer whose LINE account has no binding sees the songs and a link to the web
app; only the web app can create a binding.

## Song announcements

Publishing a week's songs notifies that week's roster plus every active member of
the teams recorded in `worship_song_audience_teams`. The table is seeded with
影音組, who serve every service without appearing in any week's schedule.

Membership is read from the management system at send time, so people joining or
leaving a team need no action here. To add another team:

```sql
insert into worship_song_audience_teams (team_id)
select id from teams where name = '司會組'
on conflict (team_id) do nothing;
```

A recipient must be a friend of the worship official account to receive a push;
one who is not is reported in the action's `failed` list.

## Local development

```bash
npm install && npm run dev
```

```bash
cd workers && npx wrangler dev
```

`workers/.dev.vars` holds the Worker's local secrets. Database migrations are the
numbered files in `workers/migrations/`, applied with
`BRANCH_DATABASE_URL=... node scripts/run-sql.mjs workers/migrations/<file>.sql`.
Apply them to a Neon branch before production.
