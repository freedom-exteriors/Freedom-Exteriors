# Freedom Exteriors CRM

React (Create React App) front end plus Vercel serverless functions in `api/`,
backed by Supabase project `klfrqwplazjryeppamtk`. Deploys from `main` to
https://freedom-exteriors.vercel.app.

## What's where

| Area | Files |
| --- | --- |
| Pipeline / job board (staff) | `src/Pipeline.js` and the document components in `src/` |
| Homeowner portal (`/portal/<token>`, no login) | `src/portal.js` |
| Job photos (private `job-photos` bucket, signed URLs) | `src/photos.js`, `api/portal-photos.js` |
| Text / email | `api/send-sms.js` (Twilio), `api/send-email.js` (Resend), `api/send-reminders.js` (daily cron) |
| Deposits | `api/create-checkout-session.js`, `api/confirm-deposit.js` (Stripe) |
| QuickBooks invoices | `api/quickbooks.js` |
| Hover measurements | `api/hover.js` |
| Scope review (Claude) | `api/scope-review.js`, `src/ScopeReview.js` |
| Database changes | `supabase/migrations/` |

## Invoice Project (separate app)

`invoice-project/` is a separate Next.js app (own Vercel project and own Supabase
project) for generating, cataloging and exporting invoices. See
`invoice-project/README.md`. It shares no code or data with the CRM.

## How data is protected

- **Staff** sign in with Supabase Auth and must be on the `staff` table.
  Row-level security: admins see every job; reps see jobs assigned to them.
- **Homeowners** only reach their job through the portal link. The portal uses
  `portal_*` database functions that return portal-safe fields only. Internal
  **Notes** never reach the portal; the **Note for Homeowner** field does.
- A database trigger (`jobs_preserve_portal_fields`) stops a save from an
  out-of-date screen from erasing a homeowner's signature, deposit, photos, the
  portal link or a QuickBooks invoice marker.
- QuickBooks / Hover tokens live in `integration_tokens` (server only). OAuth
  logins use a one-time state value.

## Environment variables (Vercel)

| Name | Used for |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | server routes (service role — never in `src/`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | texts |
| `RESEND_API_KEY` (or legacy `REACT_APP_RESEND_KEY`) | email |
| `STRIPE_SECRET_KEY`, `REACT_APP_STRIPE_PUBLISHABLE_KEY` | deposits |
| `QB_CLIENT_ID`, `QB_CLIENT_SECRET` | QuickBooks (production keys). Optional `QB_ENVIRONMENT=sandbox`, `QB_ITEM_ID` |
| `HOVER_CLIENT_ID`, `HOVER_CLIENT_SECRET` | Hover |
| `HOVER_INTERNAL_API_KEY` | lets the separate bid-estimator app read Hover measurements through this CRM's existing connection (`api/hover.js?action=measurements`, via an `x-internal-api-key` header) instead of doing its own Hover OAuth login — the token stays owned in one place. Optional; only needed if that integration is in use. |
| `ANTHROPIC_API_KEY` | scope review |
| `GOOGLE_SOLAR_API_KEY` | roof size lookup |
| `CRON_SECRET` | reminder cron |
| `REACT_APP_GOOGLE_REVIEW_URL` | review link in the "job complete" text (optional) |
| `APP_ORIGIN` | optional, defaults to https://freedom-exteriors.vercel.app |

Anything starting with `REACT_APP_` can end up in the browser bundle, so never
give a secret that prefix unless it's meant to be public.

## Adding a staff member

1. Supabase → Authentication → Add user (email + temporary password).
2. Add a row to the `staff` table with their email, name (must match the
   "Assigned To" name on their jobs) and role `rep` or `admin`.

`admin` unlocks Scope Review, New Estimate, and New Invoice (plus every job,
not just their own assigned ones). A second column, `is_owner` (boolean,
default `false`), gates the smaller set of things that stay Nick-only even
for other admins: Pricing settings, Materials Catalog editing, QuickBooks
connect, and Delete Job. These are enforced in two places, not just the UI
button — set `is_owner = true` on the `staff` row for anyone who should
genuinely have them:
- Postgres RLS on `jobs`: `is_owner()` gates the DELETE policy entirely, and
  the UPDATE policy for the two reserved config rows (`job_id` -1 Pricing,
  -2 Materials Catalog — `job_id` -3, the Scope Review reference library,
  stays admin-level since Scope Review itself is meant to be used fully).
- `api/quickbooks.js`: every staff-facing action (`start`/`status`/`invoice`/
  `disconnect`) checks `staff.is_owner` after `requireStaff`.

## Local development

```
npm install
npm start          # front end only; /api routes run on Vercel
npm test
```

## HailTrace CSV import (bid mailer)

`scripts/import-hailtrace-csv.mjs` loads a HailTrace export into
`mail_campaigns` / `mail_targets` (both have row-level security on; the script
uses the service role key from your local `.env`).

### a. Sanity-check the parser (no DB, no network, no risk)
```
node test-fixtures/run-parser-test.mjs
```
You should see 9/9 "PASS" lines. If anything fails, stop and paste the output
back to me before going further.

### b. Dry-run against a REAL HailTrace export
Export a storm event's addresses from HailTrace (Company Settings → Export
Data), then:
```
node scripts/import-hailtrace-csv.mjs --file=./path/to/real_export.csv --campaign="Storm Name" --dry-run
```
Check the "Header map" it prints — confirm `address` (and ideally city/state/
zip/homeowner name) all matched real columns. If `address` didn't match,
open `lib/csv-import/parseHailTraceCsv.js`, find `HEADER_ALIASES`, and add
your CSV's actual header text to the `address` array.

### c. Set your Supabase credentials
Add to your `.env` (or Vercel project env vars):
```
SUPABASE_URL=https://klfrqwplazjryeppamtk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<get this from Supabase dashboard → Project Settings → API → service_role key>
```
The service role key is secret — never expose it in frontend code, only in
server-side scripts/env.

### d. Real import (writes to your database)
Drop `--dry-run` once step b looks correct:
```
node scripts/import-hailtrace-csv.mjs --file=./path/to/real_export.csv --campaign="Storm Name"
```
It will create the campaign (or reuse one with that exact name), skip
anything already imported for that campaign, and write a
`*.skipped-report.csv` next to your source file listing anything it couldn't
import and why.
