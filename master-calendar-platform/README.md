# Master Calendar Platform

The home base for a household (or a student, or a small business). It pulls every calendar
(ICS, Google, schedule photos) into one color-coded view and adds the things a family runs
on: shared grocery lists, honey-do lists, short- and long-term goals, and seasonal
reminders. Families can also link up in shared **circles** to plan carpools, team snacks
and trips. The same engine serves three verticals: **family**,
**student**, and **small business**. The verticals differ only in seed data and UI labels
(`apps/api/                   Fastify API (auth, workspaces, members, invites so far)
packages/db/seed-templates/`). The engine never branches on vertical.

Stack: npm workspaces · Fastify + TypeScript API · Prisma 7 on Supabase-hosted Postgres ·
React web app · Supabase Storage for photos · Vercel (web) + Railway (API + cron).

## Build status

| Step | Scope | Status |
|---|---|---|
| 1 | DB schema + migrations, templates, dev seed (calendar, lists, goals, reminders, circles) | ✅ done |
| 2 | Auth (email + password, DB sessions, membership-scoped middleware) + invites (second parent, join a circle) | ✅ done |
| 3 | ICS feed parser + subscription job | next |
| 4 | Google Calendar OAuth + sync | |
| 5 | Unified event query endpoint (incl. circle events assigned to your household) | |
| 6 | Lists & goals API: shopping lists, task lists, goals with milestones | *new* |
| 7 | Photo extraction → review → confirm | |
| 8 | Scheduled jobs: automation rule engine, seasonal reminders, **leave-by traffic alerts**, notification sender | *expanded* |
| 8b | **Schedule organizer** API: daily/weekly plan, accept/move suggestions (engine already built in `packages/planner`) | *new* |
| 9 | Retailer handoff (see below) | *new* |
| 10 | Dashboard frontend | |
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

### Known limitation, deferred to the API layer

`Event` has no `workspaceId`; it belongs to a workspace through `calendarSource`. The DB
does not stop an event's `participantId` or `eventTagId` from pointing at a row in a
*different* workspace. The API's write paths have to enforce this (step 2 onward).

## Auth library decision (for step 2)

Lucia v3 was deprecated as a library in 2025. The project now publishes a guide for
implementing sessions yourself, and Auth.js is built around Next.js, not Fastify. Step 2
will therefore follow the Lucia session guide with a small in-repo implementation:
argon2id (`@node-rs/argon2`, already used by the seed), random session tokens, and
SHA-256 ids in the `Session` table. This is the "Lucia" option from the brief without
depending on the unmaintained package.
