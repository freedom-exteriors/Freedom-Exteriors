# Master Calendar Platform

A single engine that pulls calendars (ICS, Google, schedule photos) into one color-coded
view, then generates tasks from them. The same engine serves three verticals: **family**,
**student**, and **small business**. The verticals differ only in seed data and UI labels
(`packages/db/seed-templates/`). The engine never branches on vertical.

Stack: npm workspaces · Fastify + TypeScript API · Prisma 7 on Supabase-hosted Postgres ·
React web app · Supabase Storage for photos · Vercel (web) + Railway (API + cron).

## Build status

| Step | Scope | Status |
|---|---|---|
| 1 | DB schema + migrations, vertical seed templates, dev seed | ✅ done |
| 2 | Auth (email + password, DB sessions, membership-scoped middleware) | next |
| 3 | ICS feed parser + subscription job | |
| 4 | Google Calendar OAuth + sync | |
| 5 | Unified event query endpoint | |
| 6 | Photo extraction → review → confirm | |
| 7 | Automation rule engine | |
| 8 | Dashboard frontend | |
| 9 | Wall/kiosk route | |

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
| Northside Bakery | business | morgan@business.test | casey@business.test (claims "Casey") | |

Each workspace comes with its template's tags and automation rules, some contacts, and
sample events over the next 6 days. Some events are assigned, some are unassigned, and
some have no tag. When the seed runs it prints each workspace's `/wall/<id>` path.

## Layout

```
packages/db/
  prisma/schema.prisma      schema (source of truth)
  prisma/migrations/        SQL migrations
  prisma/seed.ts            dev seed (safe to re-run)
  prisma.config.ts          Prisma 7 config; reads the root .env
  seed-templates/*.json     per-vertical tags, suggested contact roles, default rules
  src/                      createPrismaClient(), createWorkspaceFromTemplate(), generated client
  test/                     node:test suites
packages/shared-types/      types shared by the API and the web app (no Prisma import)
apps/                       api and web start in steps 2 and 8
infra/docker-compose.yml    local Postgres
```

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
7. **Small additions:** `CalendarSource.name` (display label), `Event.allDay`,
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
