# Master Calendar Platform

The home base for a household (or a student, or a small business). It pulls every calendar
(ICS, Google, schedule photos) into one color-coded view and adds the things a family runs
on: shared grocery lists, honey-do lists, short- and long-term goals, and seasonal
reminders. Families can also link up in shared **circles** to plan carpools, team snacks
and trips. The same engine serves three verticals: **family**,
**student**, and **small business**. The verticals differ only in seed data and UI labels
(`apps/api/                   Fastify API + worker (auth, workspaces, invites, calendar feeds so far)
  src/ingestion/            ICS parser, SSRF-safe fetcher, sync engine + scheduler
packages/db/seed-templates/`). The engine never branches on vertical.

Stack: npm workspaces · Fastify + TypeScript API · Prisma 7 on Supabase-hosted Postgres ·
React web app · Supabase Storage for photos · Vercel (web) + Railway (API + cron).

## Build status

| Step | Scope | Status |
|---|---|---|
| 1 | DB schema + migrations, templates, dev seed (calendar, lists, goals, reminders, circles) | ✅ done |
| 2 | Auth (email + password, DB sessions, membership-scoped middleware) + invites (second parent, join a circle) | ✅ done |
| 3 | ICS feed parser + subscription job | ✅ done |
| 4 | Google Calendar OAuth + sync | ✅ done |
| 5 | Unified event query endpoint (incl. circle events assigned to your household) | ✅ done |
| 6 | Lists & goals API + people/places + schedule-organizer API | ✅ done |
| 7 | Photo extraction → review → confirm | ✅ done |
| 8 | Scheduled jobs: automation rule engine, seasonal reminders, **leave-by traffic alerts**, notification sender | ✅ done |
| 8b | ~~Schedule organizer API~~ | folded into step 6 |
| 9 | Retailer handoff (see below) | *new* |
| 10 | Dashboard frontend (+ web push for leave-by alerts) | next |
| 11 | Wall/kiosk route (+ today's chores and the grocery list) | |

## Local setup

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d   # or any local Postgres 16
npm install                                         # also runs `prisma generate`
npm run db:deploy                                   # apply migrations
npm run db:seed                                     # one workspace per vertical
npm test                                            # db, planner and API tests
npm run dev -w @mcp/api                             # API on :3001
npm run worker -w @mcp/api                          # background jobs (see "Background jobs")
```

`npm run db:migrate` creates a new migration after you edit `schema.prisma`.
`npm run db:reset` drops the database and re-applies migrations and the seed.

### Seeded logins (password: `SEED_USER_PASSWORD`, default `password123`)

| Workspace | Vertical | Owner | Member | Viewer |
|---|---|---|---|---|
| Rivera Family | family | alex@family.test | sam@family.test | maya@family.test (claims participant "Maya") |
| Jordan — Fall Semester | student | jordan@student.test | | pat@student.test (a parent, no participant) |
| Chen Family | family | lee@chen.test | | |
| Northside Bakery | business | morgan@business.test | casey@business.test (claims "Casey") | |
| Eastside FC U12 — Carpool & Snacks *(circle)* | family | alex@family.test | lee@chen.test | |

Each workspace comes with its template's tags and automation rules, some contacts, and
sample events over the next 6 days (some assigned, some unassigned, some untagged). Each
also gets its template's default lists and seasonal reminders, sample grocery and to-do
items, and goals with milestones. The circle links the Rivera and Chen families. It has
carpool drives (one with no driver yet), a potluck, and a "Who's bringing what" list. When the seed runs it prints each workspace's `/wall/<id>` path.

## Layout

```
packages/db/
  prisma/schema.prisma      schema (source of truth)
  prisma/migrations/        SQL migrations
  prisma/seed.ts            dev seed (safe to re-run)
  prisma.config.ts          Prisma 7 config; reads the root .env
  seed-templates/*.json     per-vertical (+ circle) tags, contact roles, rules, lists,
                            store sections, seasonal reminders
  src/                      createPrismaClient(), createWorkspaceFromTemplate(), generated client
  test/                     node:test suites
packages/planner/           schedule organizer + leave-by logic + Google Routes/Geocoding clients (pure, no DB)
scripts/demo-organizer.ts   runs both against the seeded Rivera family: `npm run demo:organizer`
packages/shared-types/      types shared by the API and the web app (no Prisma import)
apps/                       api and web start in steps 2 and 8
infra/docker-compose.yml    local Postgres
```

## API: auth and access control (step 2)

| Endpoint | Who | What |
|---|---|---|
| `POST /auth/signup` | anyone | email + password (8+ chars); can create the first workspace and your participant in one go |
| `POST /auth/login` / `POST /auth/logout` | anyone / signed in | logout kills the session server-side |
| `GET /auth/me` | signed in | you + your workspaces and roles |
| `GET /workspaces`, `POST /workspaces` | signed in | create a home, or a circle "as" one of your homes |
| `GET /workspaces/:id` | viewer+ | details, participants, and template labels/pickers for the UI |
| `GET /workspaces/:id/members` | member+ | |
| `PATCH` / `DELETE /workspaces/:id/members/:mid` | owner (or yourself, to leave) | the last owner can't be removed or demoted |
| `POST` / `GET` / `DELETE /workspaces/:id/invites` | owner | link valid 7 days; optionally tied to an email, and/or to a participant ("Maya's login") |
| `GET /invites/:token` | anyone | preview: "Join Rivera Family as a viewer" |
| `POST /invites/:token/accept` | signed in | circle invites ask which of your households is joining |

**Security choices:**

- **Sessions.** These follow the Lucia guide, implemented in-repo (the package is
  deprecated). The cookie holds a random 256-bit token; the DB stores its SHA-256. Cookies
  are httpOnly, SameSite=Lax, and Secure in production. Sessions last 30 days and extend
  while in use. Logout deletes the row.
- **Passwords.** argon2id. Login responds the same way, and takes the same time, whether
  or not the email exists.
- **Authorization.** Every `/workspaces/:workspaceId/...` route goes through
  `requireWorkspace(minRole)`, which loads *your* membership. A non-member gets **404**,
  identical to a workspace that doesn't exist. A member without enough rights gets 403.
  Future routes (events, lists, planner) use the same guard.
- **CSRF.** POST/PATCH/DELETE must carry an `Origin` in `WEB_ORIGIN`.
- **Rate limits.** Signup/login are rate-limited per IP (10/min), invite lookups 30/min.
- **Invite tokens.** Stored hashed and single-use; concurrent accepts are handled safely.
  Unknown, used and expired tokens all get the same 404.
- 12 API tests cover all of the above, including non-member probing, the last owner,
  invites that are expired, revoked or sent to another email, and circles.

**Production note:** the browser must see the API as same-site, or the SameSite=Lax
cookie won't be sent. Plan: Vercel rewrites `/api/*` to the Railway API, so the browser
only ever talks to one origin, and the Vite dev server proxies the same way locally.
**Not built yet (fast-follows):** password reset and email verification (both need an
email sender), magic links, and "sign out everywhere".

## Calendar feeds (ICS) — step 3

Paste any "subscribe" / iCal / webcal link: SportsEngine, TeamSnap, ParentSquare, a
school district, Outlook or Apple "publish calendar", Google "secret address". The same
code path serves all of them; nothing is special-cased or scraped.

| Endpoint | Who |
|---|---|
| `GET /workspaces/:id/calendar-sources` | viewer+ (feed URLs are masked to `host/…`, since many embed a private token) |
| `POST /workspaces/:id/calendar-sources` `{ feedUrl, name?, defaultParticipantId?, defaultEventTagId?, username?, password? }` | member+; **runs the first sync immediately**, so a bad link fails with a readable message ("That link is a web page, not a calendar feed. Look for Subscribe / iCal / .ics") instead of silently later |
| `PATCH …/:sourceId` `{ name?, defaultParticipantId?, defaultEventTagId?, applyToExisting? }` | member+; "all events from this feed are Maya's". With `applyToExisting` it fills only unassigned/untagged events |
| `DELETE …/:sourceId` | member+ (its events go too) |
| `POST …/:sourceId/sync` | member+; at most once per 5 min |

**Parsing** (`ical.js`):
- Recurring series are expanded into one row per occurrence, including skipped dates
  (EXDATE), single moved occurrences (RECURRENCE-ID) and cancelled ones.
- A moved practice keeps its original key, so it's **updated in place**. Anything a
  person set on it (who's going, driver, tag) sticks.
- Time zones:
  - IANA zones (e.g. America/Chicago) are resolved with the runtime's time-zone
    database, so they're correct across daylight-saving changes.
  - Outlook-style names ("Central Standard Time") use the feed's own time-zone
    definitions.
  - Floating times and all-day dates use the workspace's zone.
- A test fixture exercises all of the above, including a series that crosses the
  November DST change.

**Sync rules:**
- **Who owns what:** the feed owns title, time and location. People own who it's for,
  tag, driver and place. Sync only sets participant/tag when *creating* an event (from
  the source's defaults) and never overwrites them. If the location text changes, the
  geocoded place is cleared for re-lookup.
- **No duplicates:** upserts use the unique key.
- **Deletions:** events removed upstream are deleted inside the window (−30/+365 days).
  Older history is left alone.
- **Empty feeds:** a feed that suddenly comes back **empty never wipes** the calendar;
  it's flagged instead.
- **Polling:** every 30 min + jitter (never faster, per the SportsEngine note).
  Conditional GET (ETag / Last-Modified) makes unchanged feeds cheap. A failure backs off
  60 min and keeps existing events. The error is shown on the source ("That calendar
  link no longer exists").
- **Workers:** each run claims a source before syncing it, so two workers never sync the
  same feed.

**Security:**
- **SSRF:** feed URLs are user input, so the fetcher only allows http(s) (webcal → https).
  It refuses private, loopback, link-local and cloud-metadata addresses, both as IP
  literals *and* in DNS answers at connect time (defeats DNS rebinding). Redirects are
  re-checked, limited to 3, and never forward credentials to another host. There's a
  20 s timeout and a 5 MB cap.
- **Credentials:** feed usernames/passwords are **AES-256-GCM encrypted** at rest
  (`CREDENTIALS_ENCRYPTION_KEY`). Tampering or a wrong key fails loudly.
- **Cross-workspace ids:** `lib/scope.ts` rejects participant and tag ids from another
  workspace.

**Worker:** `npm run worker -w @mcp/api` (a second Railway service). It runs due syncs
every minute; later steps add automation, reminders and leave-by alerts to the same loop.

## Google Calendar — step 4

Flow: **Connect Google** → Google's consent screen (read-only calendar access) → back in
the app, pick which calendars to bring in, e.g. "Rivera Family" but not "Work". Each
picked calendar becomes a `CalendarSource` and syncs with exactly the same rules as ICS
feeds (`ingestion/apply.ts`: the source owns title/time/location, people own
assignments, moved instances update in place, and an empty result never wipes a
calendar).

| Endpoint | Who |
|---|---|
| `POST /workspaces/:id/integrations/google/start` → `{ url }` | member+ |
| `GET /integrations/google/callback` | Google redirects here; always redirects back to `/w/:id/settings/calendars?google=connected\|error&reason=…` |
| `GET /workspaces/:id/integrations/google` | member+; connected accounts, with `mine` |
| `GET` / `POST …/google/:connectionId/calendars` | **only the person who connected that Google account**: it's their account, so others in the family see the chosen calendars' events, not the account's calendar list |
| `DELETE …/google/:connectionId` | that person or an owner; revokes at Google, removes those calendars + events |

**How it's built:**
- **OAuth:** authorization code + **PKCE** + single-use `state` (hashed, 10-minute life,
  bound to the user and workspace that started it; the callback must come from the same
  logged-in user). `access_type=offline` + `prompt=consent` so there's always a refresh
  token. If someone unticks the calendar checkbox on Google's consent screen, the partial
  grant is revoked and they're told why.
- **Tokens:** AES-256-GCM encrypted, **one `OAuthConnection` per Google account**, shared
  by every calendar picked from it (a deviation from the brief's per-source token
  columns, which would duplicate one account's tokens across calendars). Tokens refresh
  automatically 2 minutes before expiry.
- **Revoked access:** if someone removes access in their Google account, the connection
  flips to `needs_reauth`. Syncs pause (existing events stay; Google isn't retried), and
  each calendar shows "reconnect Google". Reconnecting clears it and syncs right away.
- **Events:** `singleEvents=true`, so Google expands repeats. Key = (`recurringEventId`,
  `originalStartTime`), so a moved instance is an update. Cancelled instances and
  "working location" markers are skipped. All-day dates use the workspace time zone.
- Only calendars the account can actually see can be added.

**Setting up Google (one time, ~10 minutes):**

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project
   (e.g. "Home Base").
2. *APIs & Services → Library* → enable **Google Calendar API**.
3. *Google Auth Platform* (OAuth consent screen): user type **External**, app name,
   support email. Under *Audience*, keep it in **Testing** and add your family's Gmail
   addresses as test users. Under *Data access*, add the scope
   `.../auth/calendar.readonly`.
4. *Clients → Create client → Web application*. Authorized redirect URIs:
   `http://localhost:5173/api/integrations/google/callback` (dev) and
   `https://<your-domain>/api/integrations/google/callback` (prod).
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

*Testing-mode caveat:* up to 100 test users, and Google expires refresh tokens for
testing-mode apps after about 7 days, so people would have to reconnect weekly. The app
handles this gracefully (the reconnect prompt above). For real users, submit the app for
Google's verification: `calendar.readonly` is a *sensitive* scope, which means a review
of the app, not the paid security assessment that *restricted* scopes need.

## Unified calendar — step 5

`GET /workspaces/:id/events?start=…&end=…` (viewer+; ISO times; up to 100 days) returns
one time-ordered list from **every** source (ICS feeds, Google, photo imports later),
ready to draw:

```jsonc
{
  "timeZone": "America/Chicago",
  "participants": [{ "id": "…", "name": "Maya", "color": "#DB2777" }],   // legend
  "events": [{
    "id": "…", "title": "U12 Soccer Practice", "start": "…", "end": "…", "allDay": false,
    "location": "Eastside Park Field 3", "description": "…", "url": "…",
    "participant": { "id": "…", "name": "Maya", "color": "#DB2777" },   // null when…
    "unassigned": false,                                                  // …nobody's claimed it
    "tag": { "key": "practice", "label": "Practice", "color": "#22C55E" },
    "driver": { "id": "…", "name": "Alex" },
    "needsDriver": false,          // has a location, not all-day, and no driver yet
    "place": { "id": "…", "name": "Eastside Park" },
    "source": { "id": "…", "name": "Team feed", "type": "ics_feed" },
    "circle": null,                // or { id, name } for circle events
    "editable": true               // false for circle events: edit those in the circle
  }]
}
```

- **Filters:** `participantId`, `tagId`, `assigned=all|assigned|unassigned`,
  `includeCircles=true|false`. Events *overlapping* the range are included (a sleepover
  that started yesterday), and so are zero-length deadlines at the range start. Foreign
  participant/tag ids are rejected.
- **Circle events on your home calendar:**
  - Events assigned to your household (or where your household is driving) appear on
    your home calendar, in your household's circle color.
  - Unclaimed circle events show only to people who are members of that circle, so they
    can claim them.
  - Other households' circle events never appear.
  - Circle events are read-only from the home view.
- **Detail:** `GET /workspaces/:id/events/:eventId`.
- **Claiming:** `PATCH /workspaces/:id/events/:eventId`
  `{ participantId?, eventTagId?, driverParticipantId? }` (member+). This is the
  "nullable until claimed" step. It rejects ids from other workspaces and drivers who
  aren't marked `canDrive`. Syncs never overwrite these fields.

## Household hub API — step 6

All under `/workspaces/:id/…`. Reads are viewer+; writes are member+ **except** where a
list is opened to viewers (`viewerCanAdd`), which is how kids add to Groceries and
Chores without being able to change anything else.

**Task lists & tasks** (`task-lists`, `tasks`)
- Lists: create, rename, reorder, archive; each shows an open count.
- Tasks: filter by list, goal, person, open/done, or `unlisted` (automation output). A
  task can carry who, due date, priority, notes, time estimate, and location
  (home / errand at a place / anywhere).
- **What kids (viewers) can do:**
  - Add a task to an open list. They can set only the title and notes; parents decide
    who, when and how important.
  - Tick off tasks on open lists, and **their own assigned chores** anywhere.
  - Delete what they themselves added.
- Completion records who did it ("Maya finished Unload dishwasher").

**Shopping lists** (`shopping-lists`, `…/items`)
- Items come back in the **store's walking order** from the template (Produce → Dairy →
  … → uncategorized), with checked items at the bottom and "added by Maya" / "got it:
  Alex".
- Adding "milk" when Milk is already on the list merges instead of duplicating. Re-adding
  a bought **staple** just un-checks it.
- `clear-checked` removes bought one-offs but keeps staples. `restock-staples` puts
  every staple back on the list in one tap.
- `handoff?retailer=amazon|target|walmart`, v1 links:
  - **Amazon:** an add-to-cart URL for items with a saved ASIN; search links otherwise.
  - **Target:** product pages (saved TCIN) or search links. You pick Order Pickup or
    Drive Up in Target's app.
  - **Walmart:** product (saved item id) or search links.
  - Kroger/Instacart return `501` until the retailer step.
  - Product ids are validated before they're ever put into a URL.

**Goals** (`goals`)
- Goals are short- or long-term, for the household or one person, and can be created
  with milestones in one call.
- Progress = completed milestones / total, and milestones are ordinary tasks.
- Marking a goal achieved stamps `achievedAt`. Deleting a goal removes its milestone
  tasks, except ones that are also on a list.

**Seasonal reminders** (`recurring-reminders`)
- Listed soonest first, with `nextDate` computed in the household's time zone. Each can
  be edited, paused or deleted.
- Rules are validated (yearly/monthly/weekly RRULEs) and evaluated on *dates*, so no DST
  edge can shift "Oct 15".
- The generator that turns them into tasks runs in the worker (step 8).

**People & places** (`participants`, `participants/:id/availability`, `places`)
- **People:**
  - A color is picked automatically, distinct from the others.
  - "Can drive" and a daily cap on planned-task minutes can be set per person.
  - Free-time windows are replaced as a whole weekly pattern (`PUT`).
- **Places:**
  - Given coordinates are used directly; otherwise the address is geocoded (Google
    Geocoding, biased toward the household's home).
  - Opening hours are entered as `HH:MM` and constrain errands.
  - The first **home** place becomes everyone's starting point.

**Schedule organizer** (`plan`, `tasks/:id/schedule`)
- `POST plan { scope: "day" | "week", date? }` runs `packages/planner` over the
  household's events, accepted plans and open tasks. It writes **suggestions** onto the
  tasks and returns what couldn't be placed and why.
- **Suggestions aren't assignments.** An unassigned to-do suggested for Alex stays
  unassigned (`scheduledParticipant` = Alex) until someone accepts it; dismissing leaves
  nobody holding it.
- `accept`, `move { start, participantId? }`, `dismiss`. Accepted slots are fixed:
  re-planning only replaces suggestions and plans around accepted ones.
- `GET plan?start&end` is the agenda (suggested + accepted) for the dashboard.
- It needs a home place and free hours for at least one person; otherwise it says so
  plainly.

Also: `PATCH /workspaces/:id { name?, timeZone? }` (owner).

## Photo → calendar — step 7

Snap a flyer, schedule, appointment card or shift roster (JPG/PNG/WebP/HEIC, or a PDF).
Claude reads it into **candidate** events, a person reviews them, and **only confirmed
candidates become events**. Nothing is ever added automatically.

| Endpoint | Who |
|---|---|
| `POST /workspaces/:id/schedule-photos` (multipart `file`; `?wait=true` to block until read) | viewer+: kids can snap the team flyer (30/hour per person) |
| `GET …/schedule-photos`, `GET …/:photoId` (candidates + notes), `GET …/:photoId/image` | viewer+ |
| `PATCH …/:photoId/candidates/:candidateId` (title, start, end, allDay, location, participantId, eventTagId) | member+ |
| `POST …/:photoId/confirm { candidateIds, confirmLowConfidence? }`, `POST …/reject`, `POST …/retry` | member+ |
| `DELETE …/:photoId` | member+, or whoever uploaded it; confirmed events stay |

**Upload handling:**
- The file type is checked from its **bytes**, never its name or claimed type.
- Images get their EXIF rotation applied (phone photos are often stored sideways), are
  downscaled to 1568 px, and are re-encoded as JPEG. That also **strips EXIF, including
  GPS location**, before anything is stored.
- Stored in a **private** Supabase Storage bucket (or `apps/api/.data/photos` in dev) and
  served back only through the auth-checked `…/image` route.

**The model call** (`extraction/extractor.ts`, `@anthropic-ai/sdk`):
- Model: `claude-opus-5` (override with `EXTRACTION_MODEL`), adaptive thinking.
- **Structured outputs** (`output_config.format` JSON schema), so the reply always has
  the candidate shape. It's validated again with zod on our side anyway.
- **Server-side refusal fallbacks** (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`): if a safety classifier misfires on an ordinary
  image, the request is re-run on Anthropic's recommended fallback model instead of
  failing.
- The prompt gets today's date, the household's time zone, people and tag keys, and
  asks for:
  - one entry per occurrence ("Tuesdays in October" becomes each date);
  - local wall-clock times exactly as written;
  - honest confidence;
  - the words it read (`sourceText`);
  - notes on anything assumed.
- It's told to treat text in the image as data, not instructions.
- Refusals, truncation, rate limits and malformed output become readable messages ("The
  photo reader is busy — try again in a minute").

**Turning the model's reply into candidates** (`extraction/candidates.ts`):
- **Time zones:** the model returns wall-clock times, and *we* convert them in the
  household's time zone (DST-correct). Models are unreliable with UTC offsets.
- **Assumptions are written down and shown to the reviewer:** no end time → 1 hour;
  ends after midnight; no time → all-day; date in the past.
- **Suggestions:** suggested people and tags are kept only if they match this household's
  actual people and tag keys.
- **Low confidence:** candidates under 0.7 confidence are flagged. Confirming one needs
  `confirmLowConfidence: true`, unless the reviewer edited it (editing counts as
  reviewing).

**Confirming:**
- Confirmed candidates become events in the workspace's **"Photo imports"** source
  (`photo_extraction`), keyed by photo + candidate so they can't be added twice.
- The events carry the confidence, source text and assumptions.
- They appear in the unified calendar like any other event.
- Concurrent reviews are safe: an optimistic lock returns "someone else just changed
  this" instead of losing an edit.

**Processing:**
- Extraction runs right after upload.
- The worker retries uploads that never finished (a crash or deploy mid-read) after 10
  minutes.
- Failed reads can be retried.

**Try it on a real image** (one model call, no database):
`ANTHROPIC_API_KEY=… npm run try:photo -w @mcp/api -- ./flyer.jpg`

## Background jobs — step 8

`npm run worker -w @mcp/api` runs one loop with a job scheduler. Each job has its own
cadence; one failing never stops the others. Every job is **idempotent** (unique keys +
`skipDuplicates`), so a restart, a retry or a second worker never duplicates anything.

| Job | Every | What it does |
|---|---|---|
| `feeds` | 1 min | ICS + Google sync (each source ≤ every 30 min) |
| `photos` | 1 min | retries photo extractions that never finished |
| `departures` | 1 min | leave-by alerts (below) |
| `notifications` | 1 min | sends opted-in emails |
| `automation` | 5 min | rule engine → tasks |
| `reminders` | hourly | seasonal reminders → tasks |

**Automation rules** (`jobs/automation.ts`), from each workspace's template:
- `create_reminder`: a task due `timingOffsetMinutes` before the event, e.g. "Pack
  uniform & gear for {{title}}" (placeholders: `{{title}} {{date}} {{time}} {{person}}
  {{location}}`, rendered in the household's time zone). It's assigned to the event's
  driver when known.
- `flag_unassigned_task` (the brief's unassigned-event trigger path): a high-priority task
  only while the event **needs a person**, meaning nobody's claimed it, or it has a
  location and nobody's driving. It **completes itself** once someone steps in, so stale
  nags don't pile up.
- Tasks appear up to 7 days before they're due. (rule, event) is unique. When an event
  moves, its open tasks' due dates move too. A deleted event takes its tasks with it.

**Seasonal reminders** (`jobs/reminders.ts`):
- The next occurrence becomes a task `leadDays` ahead, on the reminder's list and for its
  person, due midday on the date in the household's time zone.
- (reminder, occurrenceDate) is unique.
- If last time's task is still open, no second one is stacked on it.

**Leave-by alerts** (`jobs/departures.ts`):
- **Which events:** timed events in the next 3 h with a place and a **driver** who can
  drive and has a home place.
- **Origin:** the previous stop if it just ended, else home. Drive time comes from Google
  Routes at the real departure time.
- **Re-checks:** at ~2 h / 45 min / 15 min before leave-by, and immediately if the event's
  time or place changes. This is compared by value, not by timestamps, so clock skew
  can't hide a change.
- **Heads-up:** if traffic pulls leave-by 10+ min earlier, the driver hears right away
  ("Traffic: leave 15 min earlier for Soccer practice").
- **Warning:** exactly one, 10 min before leave-by: "Leave by 3:45 PM — Soccer practice ·
  35 min drive from Home; 20 min longer than usual — heavy traffic." A moved event gets
  a fresh warning for its new time.
- **Who hears it:** the driver's own login; if they don't have one (grandma drives), the
  household's adults.
- **Without `GOOGLE_MAPS_API_KEY`:** it uses a straight-line drive estimate and says so
  ("estimate — no live traffic"), never "traffic is light".
- **Cost:** about 8 Routes calls per driven event (2 per check × initial + 3 re-checks).

**Notifications** (`jobs/notify.ts`, `routes/notifications.ts`):
- An outbox table. `(user, dedupeKey, channel)` is unique, so nothing is ever sent twice.
- **In-app** always: `GET /me/notifications` (+ `unreadCount`) and
  `POST /me/notifications/read { ids | all }`.
- **Email** for people who opt in (`PATCH /me { emailNotifications: true }`) via Resend
  (`RESEND_API_KEY`). Alerts older than 30 minutes are dropped, not sent late: a "leave
  now" email an hour late is worse than none.
- **Web push** (a phone buzz for leave-by) needs the web app's service worker, so it
  ships with the dashboard.

## Home hub: lists, goals, reminders

All of this is generic. Only the template data differs by vertical.

- **Task lists** (`TaskList` + `Task.taskListId`): Honey-do and Chores for families;
  To-do and Packing for students; Maintenance and Admin for businesses. The `Task` table
  also holds automation-generated tasks and goal milestones, so there's one to-do concept
  everywhere. Tasks have an assignee, a due date, a priority, notes and a manual sort
  order, and record who created and who completed them.
- **Shopping lists** (`ShoppingList` / `ShoppingItem`): quantity, store section (sections
  come from the template in walking order: Produce, Dairy…), and *staples*. A staple stays
  on the list after you check it off, so restocking is one tap. Items record who added
  them. A list can have a preferred retailer and each item can have retailer product IDs;
  see below.
- **Anyone can add:** `viewerCanAdd` on a list lets `viewer` logins (kids) add to and
  check off that list while everything else stays read-only for them. It's on by default
  for grocery, chores and bring-lists.
- **Goals** (`Goal`): short- or long-term, for the whole household or one person, with a
  target date. Milestones are ordinary tasks with `goalId`, so progress = completed /
  total and milestones can sit on a list or have an assignee.
- **Seasonal reminders** (`RecurringReminder`): a standard RRULE plus lead time, e.g.
  "Replace HVAC filter" on the 1st of Jan/Apr/Jul/Oct, "Winterize outdoor faucets" Oct 15,
  "Quarterly estimated taxes", "FAFSA opens". A step-8 job creates one task per occurrence
  on the target list. `(recurringReminderId, occurrenceDate)` is unique, so re-runs never
  duplicate. Each template seeds 6–10 of these, and every one can be edited or turned off.

## Schedule organizer (daily + weekly)

`organizeDay` / `organizeWeek` in `packages/planner` fit honey-dos, chores, errands and
calls into the gaps in each person's schedule. They return **suggestions**. You accept
a suggestion (it becomes fixed, like an event) or move it. Re-planning never touches
accepted items.

How it decides what "makes logistical sense":

- **Where you'll be.** Each gap runs from where one block ends (practice at Eastside
  Park) to where the next one starts. For each task location it computes the extra
  driving a slot costs: *detour = (there → task) + (task → next place) − (there → next
  place)*. Errands next to where you already are cost about 0. A home task can't go in a
  40-minute gap between two far-apart events, because the driving doesn't leave room.
- **Placed tasks become stops.** Errands near each other chain into one trip.
- **Several orderings.** A greedy planner is order-sensitive: the Goodwill run could take
  the post-practice slot that the hardware store next door needed. So it plans with a few
  task orderings (by priority, "errands that piggyback on a trip first", shortest first)
  and keeps the best total. The demo shows this: paint samples land right after
  practice (+6 min) and Goodwill moves to a Sunday morning slot.
- **Real constraints.** Each person's availability windows (`AvailabilityWindow`), store
  opening hours (`Place.openingHours`), due dates, a daily cap on planned-task minutes
  (`maxPlannedTaskMinutesPerDay`, so evenings aren't filled wall to wall), errands only for
  people who drive (`canDrive`), transition buffers, and parking/walk-in time per place.
- **Priority.** High priority pulls toward today, low floats. Overdue items come first.
- **Honest leftovers.** Tasks with no time estimate, or that can't fit, come back as
  `unplaced` with a reason ("needs estimate", "no one eligible", "no fitting gap") for
  the UI to show.
- **Cost-aware.** Weekly planning uses a free straight-line drive-time estimate. Live
  traffic is only fetched for today's leave-by alerts.
- Deterministic, pure, and covered by 18 tests (DST days, store hours, chaining, limits).

Needs from the schema, all added: `Workspace.timeZone`, `Place` (geocoded, hours,
parking buffer), `Participant.homePlaceId / canDrive / maxPlannedTaskMinutesPerDay`,
`AvailabilityWindow`, `Event.placeId / driverParticipantId`, `Task.estimatedMinutes /
locationKind / placeId / scheduledStart / scheduledEnd / scheduleStatus / scheduleReason`,
and `ShoppingList.placeId` (a Target list becomes an errand at that Target).

## Leave-by warnings (live traffic)

For each upcoming event with a place and a **driver** (`Event.driverParticipantId`; kids
don't get "leave now" alerts, whoever drives them does):

1. **Origin:** the driver's previous stop if it ended in the last 90 min (school pickup →
   practice), otherwise home. It's inferred from the schedule, not GPS: the web app
   can't track location in the background, and native apps are out of scope.
2. **Drive time with traffic** from Google **Routes API** (`TRAFFIC_AWARE_OPTIMAL`) *at the
   actual departure time*. It asks once, then again at the departure time the first
   answer implies, because traffic at 4:40 and 5:05 PM differs.
3. **Leave by** = start − parking/walk-in − drive − 5 min to get out the door.
4. **Re-check** traffic about 2 h, 45 min and 15 min before leave-by. If leave-by
   moves 10+ minutes earlier, notify right away ("Traffic: leave 15 min earlier for
   Game").
5. **Warn** 10 min before leave-by, once: *"Leave by 4:50 PM — Soccer practice · 30 min
   drive from Home; 15 min longer than usual — heavy traffic."*

State lives in `DepartureAlert` (one per event and driver). Messages go through a
`Notification` outbox (web push / SMS / email) with a dedupe key, so job re-runs never
double-notify. An event with a place but no driver shows "No driver for Swim Practice"
instead, which ties into the "Who's driving?" automation rule. Places are geocoded with
the Google Geocoding API, biased toward the household's area.

**Needs:** `GOOGLE_MAPS_API_KEY` with the Routes API and Geocoding API enabled. Both are
billed per request by Google, which is why the organizer uses free estimates and only
alerts use live traffic. Without a key, the demo uses clearly labeled simulated rush-hour
traffic.

## Circles: planning with other families

A **circle** is a workspace with `kind = circle`: "Eastside FC U12 parents", "Rivera +
Chen camping trip", a study group, a network of partner businesses. Because it's a
workspace, it reuses events, lists, goals, the wall display and the authorization
boundary. Nothing new was needed there.

- Each household in a circle is a `Participant` with `linkedWorkspaceId` pointing at that
  household's home workspace, and it has its own color. A carpool drive or "bring orange
  slices" is assigned to *the Chen family*. A household can join a circle only once.
- Adults from each household get their own `WorkspaceMembership` in the circle, through
  `WorkspaceInvite` (a hashed token that can be limited to an email address). The same
  invite flow handles adding a second parent to a home.
- **Privacy:** joining a circle shares *nothing* from your home. Only what's created in
  the circle is visible to its members. Step 5 will show circle items assigned to your
  household on your home calendar.
- The circle template seeds tags (carpool / get-together / trip / sign-up slot), a "Who's
  bringing what" list, and rules that flag an undriven carpool or an unclaimed sign-up
  slot ahead of time.

## Deployment status

Nothing is deployed yet. Code is on the branch and tested against a local Postgres. The
target setup, per the original brief:

| Piece | Where | Notes |
|---|---|---|
| Postgres | **Supabase** (DB only, Prisma migrations) | Needs a *new* Supabase project. Don't reuse the Freedom Exteriors CRM project. |
| Schedule photos | **Supabase Storage**, private bucket | Same new project. |
| Web app | **Vercel** | A new Vercel project with root directory `master-calendar-platform/apps/web`, separate from the CRM's. |
| API + scheduled jobs | **Railway** (behind a Vercel `/api` rewrite, so cookies are first-party) | The leave-by job runs every few minutes and re-checks traffic. That needs a long-running worker, not Vercel's cron (daily-only on the Hobby plan). |

## Retailer integrations: what's actually possible

None of these retailers let a third-party app read or edit your cart through a login we
hold, and we won't scrape or automate a login (same rule as ParentSquare). What we can do
is *hand the list off* to each store:

| Retailer | What we can do | How |
|---|---|---|
| **Amazon** | Open Amazon with the list's items in the cart, ready to check out | Amazon's add-to-cart link, built from the ASINs saved on items (`retailerRefs.amazon.asin`). Items without an ASIN open an Amazon search. Amazon shut down third-party access to Alexa shopping lists in July 2024, so there is no list sync. |
| **Target** (incl. Order Pickup / Drive Up) | One tap per item to the product page, then Target's app for pickup | Target has no public cart, order or pickup API. Product links come from a saved TCIN, otherwise a Target search link. The person adds items to their cart and picks pickup or Drive Up in Target's app. |
| **Kroger family** (Kroger, Ralphs, King Soopers, Fred Meyer…) | Real add-to-cart for pickup or delivery | Official public API with OAuth; tokens stored encrypted like Google's. |
| **Instacart** (many grocers) | Create a shoppable list the person opens and checks out at a store they choose | Instacart Developer Platform (needs an approved API key). |
| **Walmart** | Add-to-cart link | Walmart's affiliate cart links (needs an affiliate sign-up); to confirm at build time. |

Schema support is in place: `ShoppingList.preferredRetailer`, `ShoppingItem.retailerRefs`
(product IDs per retailer), and the `Retailer` enum. A `RetailerConnection` table for
Kroger OAuth tokens will be added in step 9.

## Schema changes from the brief

The brief's schema is used as written, except for these changes:

1. **`Event.externalRecurrenceId` is `String @default("")`, not `String?`.** Postgres
   treats NULLs as distinct inside a unique constraint. With a nullable column,
   `@@unique([calendarSourceId, externalUid, externalRecurrenceId])` would never match a
   non-recurring event, so every sync would insert a duplicate. Prisma also won't accept
   `null` inside a compound-unique `where`. Non-recurring events use `""`. Recurring
   instances use the instance's original start time as an ISO UTC string. There is a
   test for this.
2. **`Session` model added.** The brief calls for sessions stored in Postgres. Adding the
   table now avoids a second migration in step 2. The row id is the SHA-256 of the
   session token, so a leaked table can't be replayed as sessions.
3. **`Task.automationRuleId` + `@@unique([automationRuleId, eventId])`.** This lets the
   step-7 scheduled job run repeatedly without creating duplicate tasks. Manual tasks
   leave it null and are unaffected.
4. **`WorkspaceMembership.participantId` is `@unique`.** At most one login can claim a
   given participant.
5. **`UploadedScheduleImage.imageUrl` → `storagePath`, plus `errorMessage`.** Schedule
   photos (kids' schedules, client data) belong in a *private* bucket served through
   short-lived signed URLs, so the table stores the object path, not a public URL.
6. **Referential actions.** Deleting a workspace cascades to everything it owns.
   Deleting a participant or tag sets the reference on events and tasks to null, so the
   event becomes unassigned or untagged instead of being deleted.
7. **`Task` grew** list, goal, reminder, priority, notes, position and created/completed-by
   fields so it can be the single to-do concept (see *Home hub*).
8. **Small additions:** `CalendarSource.name` (display label), `Event.allDay`,
   `Event.updatedAt`, `AutomationRule.enabled`, `Participant.createdAt`,
   `Contact.createdAt`, UUID column types, and indexes on `Event.startTime` and on
   workspace foreign keys.

Suggested `Contact.role` values are template data served at runtime, not a table.
`Contact.role` stays free text.

### Known limitation, handled in the API layer

`Event` has no `workspaceId`; it belongs to a workspace through `calendarSource`. The DB
does not stop an event's `participantId` or `eventTagId` from pointing at a row in a
*different* workspace. The API enforces this on every write path
(`apps/api/src/lib/scope.ts`).

## Auth library decision (for step 2)

Lucia v3 was deprecated as a library in 2025. The project now publishes a guide for
implementing sessions yourself, and Auth.js is built around Next.js, not Fastify. Step 2
will therefore follow the Lucia session guide with a small in-repo implementation:
argon2id (`@node-rs/argon2`, already used by the seed), random session tokens, and
SHA-256 ids in the `Session` table. This is the "Lucia" option from the brief without
depending on the unmaintained package.
