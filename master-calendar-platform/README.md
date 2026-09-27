# Master Calendar Platform

The home base for a household (or a student, or a small business). It pulls every calendar
(ICS, Google, schedule photos) into one color-coded view and adds the things a family runs
on: shared grocery lists, honey-do lists, short- and long-term goals, and seasonal
reminders. Families can also link up in shared **circles** to plan carpools, team snacks
and trips. The same engine serves three verticals: **family**,
**student**, and **small business**. The verticals differ only in seed data and UI labels
(`packages/db/seed-templates/`). The engine never branches on vertical.

Stack: npm workspaces · Fastify + TypeScript API · Prisma 7 on Supabase-hosted Postgres ·
React web app · Supabase Storage for photos · Vercel (web) + Railway (API + cron).

## Build status

| Step | Scope | Status |
|---|---|---|
| 1 | DB schema + migrations, templates, dev seed (calendar, lists, goals, reminders, circles) | ✅ done |
| 2 | Auth (email + password, DB sessions, membership-scoped middleware) + invites (second parent, join a circle) | next |
| 3 | ICS feed parser + subscription job | |
| 4 | Google Calendar OAuth + sync | |
| 5 | Unified event query endpoint (incl. circle events assigned to your household) | |
| 6 | Lists & goals API: shopping lists, task lists, goals with milestones | *new* |
| 7 | Photo extraction → review → confirm | |
| 8 | Scheduled jobs: automation rule engine + seasonal reminder generator | *reminders new* |
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
npm test                                            # template + DB constraint tests
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
packages/shared-types/      types shared by the API and the web app (no Prisma import)
apps/                       api and web start in steps 2 and 8
infra/docker-compose.yml    local Postgres
```

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
