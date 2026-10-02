# Invoice Project (Freedom Exteriors LLC)

An internal web tool to **generate** branded .docx invoices, **upload and catalog** old invoices
(read by Claude, checked by a person before saving), and **export** the catalog as a
QuickBooks-style CSV.

- Next.js (App Router, TypeScript), deployed on Vercel from the `invoice-project/` folder of this repo
- Supabase project **invoice-project** (Postgres + one private storage bucket)
- Anthropic API (`claude-sonnet-5-5`) for reading uploaded invoices
- One shared password for the whole site

It is separate from the CRM in the rest of this repo: its own Vercel project, its own
Supabase project, and no shared code or data.

## What's where

| Area | Files |
| --- | --- |
| Company name, address, licenses, colors | `src/lib/company.ts` (the only place to change them) |
| Letterhead layout (.docx) | `src/lib/docx/buildInvoiceDocx.ts`. `LAYOUT` holds every measurement, taken from `reference/Freedom_Exteriors_Estimate_Pearson.docx`; deviations are marked `DEVIATION` |
| Logo | `src/lib/docx/logo.ts`, taken from the reference .docx by `npm run logo` |
| License numbers (must print on every invoice) | `MN_LICENSE` / `WI_LICENSE` in `src/lib/company.ts`; `test/docx.test.ts` fails if either is missing |
| Money math (integer cents) | `src/lib/money.ts` |
| Server-side validation and totals | `src/lib/invoice.ts` |
| Claude extraction | `src/lib/extract.ts`, `src/lib/review.ts` |
| CSV export | `src/lib/csv.ts`, see `docs/field-mapping.md` |
| Login and session cookie | `src/lib/session.ts`, `src/proxy.ts`, `src/app/api/login` |
| Database | `supabase/migrations/` |

## How it's protected

- **Password:** every page and API route is behind `src/proxy.ts` (Next.js 16's name for middleware).
  Logging in sets an httpOnly, `SameSite=Strict`, signed cookie that lasts 14 days.
- **Login rate limit:** 5 wrong passwords from one IP blocks that IP for 15 minutes (tracked in the
  `login_attempts` table, so it works across Vercel's servers).
- **Database:** Row Level Security is on for every table with **no** policies, so the public "anon"
  key can read nothing. Only server code, using the service-role key, touches data. The service-role
  key lives only in server environment variables, never in a `NEXT_PUBLIC_` variable, and
  `src/lib/supabaseAdmin.ts` imports `server-only`, so the build fails if browser code tries to use it.
- **Files:** the `invoice-files` bucket is private. Downloads use signed links that expire after
  2 minutes. Uploads go straight from the browser to storage through a one-time signed upload link
  (this avoids Vercel's 4.5 MB request limit).
- **Money:** amounts are integer cents. The server recalculates every total; numbers the browser
  calculates are display-only.
- **Invoice numbers:** `next_invoice_number(year)` uses one atomic `INSERT … ON CONFLICT DO UPDATE …
  RETURNING`, so simultaneous requests can't get the same number, repeat or skip. Tested with 200
  parallel calls. `invoice_number` is also `UNIQUE`. Invoices can't be deleted (a trigger blocks it);
  use **Void** instead, which keeps the number used.
- **CSV:** cells starting with `= + - @` are prefixed with `'` so spreadsheets don't run them as formulas.

## Environment variables

Set these in **Vercel → invoice-project → Settings → Environment Variables** (Production), and in
`invoice-project/.env.local` for local development. `.env.local` is git-ignored: never commit it.

| Name | What it is, in plain English |
| --- | --- |
| `ANTHROPIC_API_KEY` | The key that lets this app use Claude to read uploaded invoices. Create it at console.anthropic.com → API Keys. Usage is billed to your Anthropic account. |
| `SUPABASE_URL` | The web address of the invoice-project database, like `https://abcd1234.supabase.co`. Not secret. |
| `SUPABASE_SERVICE_ROLE_KEY` | The master key to the invoice database. It bypasses all security rules, so it's server-only and must never be shared, pasted in chat, or put in a `NEXT_PUBLIC_` variable. Supabase → Project Settings → API Keys → `service_role` / secret key. |
| `APP_PASSWORD` | The password you type to get into the site. At least 8 characters; use 4+ random words. |
| `SESSION_SECRET` | A long random string the server uses to sign the login cookie so nobody can forge one. Nobody ever types it. At least 32 characters. Generate one with `openssl rand -hex 32`. |

## Rotating (changing) the password

1. Vercel → **invoice-project** → **Settings** → **Environment Variables**.
2. Find `APP_PASSWORD` → **⋯** → **Edit** → type the new password → **Save**.
3. **Deployments** → newest deployment → **⋯** → **Redeploy**. The new password takes effect when that finishes.

Everyone who was logged in is logged out automatically, because the cookie signature includes the
password. To force everyone out without changing the password, change `SESSION_SECRET` the same way.

## Setting up from scratch

1. Create a Supabase project, then run both files in `supabase/migrations/` in order (SQL editor, or
   the Supabase MCP `apply_migration`).
2. Create a Vercel project from this repo with **Root Directory** = `invoice-project`, and add the five
   environment variables above.
3. Deploy.

## Local development

```bash
cd invoice-project
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                   # http://localhost:3000
npm test                      # unit tests (money, CSV, session, validation)
npm run typecheck
npm run sample-docx           # writes test-output/sample-invoice.docx
npm run logo                  # re-extracts the logo from ../reference/*.docx
npm run compare-reference     # builds test-output/pearson-invoice.docx (the reference's content as an invoice)
```

## Known limits

- An upload that's read by Claude but never saved leaves its file in storage under `originals/`
  (harmless; nothing in the catalog points to it).
- Numbers printed on uploaded documents in our `FE-INV-YYYY-###` format move the counter past that
  number, so a later generated invoice never collides. That can leave a gap in the sequence, which is on purpose.
- Extraction handles PDFs up to 100 pages and 20 MB.
