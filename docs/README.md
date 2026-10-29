# Known bugs (October 2026)

Bugs found while getting FilsPay running locally. For each one: what's
wrong, why it happens, and what it breaks.

| # | Bug | Status |
|---|---|---|
| 1 | Migration 0054 uses a table that doesn't exist | ✅ Fixed |
| 2 | Migration 0055 uses columns that don't exist | ✅ Fixed |
| 3 | The websites can't reach the API ("Failed to fetch") | ✅ Fixed for local dev |
| 4 | The built-in dev webhook key has the wrong length | ❌ Open, worked around |
| 5 | The Dockerfiles are missing | ❌ Open |
| 6 | Settlement has no dev token, despite what the comments say | ❌ Open |
| 7 | A secret is committed to git | ❌ Open |

---

## 1. Migration 0054 uses a table that doesn't exist ✅ Fixed

**File:** `db/migrations/0054_views.sql`

**What's wrong:** The view `v_unbatched_capture_events` looks up a table
called `settlement_batch_events`. No migration ever creates that table.

**Why:** The database doesn't track batched payments in a separate table.
It marks each one with a `settlement_batch_id` column on `transaction_events`
(added in migration 0023). The view was written for a design that was never
built.

**What it breaks:** `npm run migrate` stops at 0054 with
`relation "settlement_batch_events" does not exist`. Every migration after it
(0055–0072) never runs, so the seed fails and nobody can log in on a fresh
database.

**Fix:** The view now checks `te.settlement_batch_id IS NULL` instead.

---

## 2. Migration 0055 uses columns that don't exist ✅ Fixed

**File:** `db/migrations/0055_chart_of_accounts_suspense.sql`

**What's wrong:** It inserts into `chart_of_accounts (code, account_type,
description)` and uses the account type `'suspense'`.

**Why:** The real table (created in migration 0007) has the columns
`(id, name, kind)`, and `kind` only allows `'asset'`, `'liability'` or
`'revenue'`. The migration was written against a different version of the
table.

**What it breaks:** Once 0054 was fixed, `npm run migrate` stopped here
with `column "code" of relation "chart_of_accounts" does not exist`. This
blocks the remaining migrations and the seed, the same as bug 1.

**Fix:** Rewritten to use `(id, name, kind)` with `kind = 'asset'`, the same
kind the existing suspense account (`scheme_rounding_residue`) uses.

> Bugs 1 and 2 change shared migration files. If staging-2 ran different
> versions of 0054/0055, its database may not match a fresh one. Check with
> MK or AM.

---

## 3. The websites can't reach the API ("Failed to fetch") ✅ Fixed for local dev

**Files:** `apps/admin/vite.config.ts`, `apps/web/vite.config.ts`

**What's wrong:** The admin console (port 5174) and the merchant dashboard
(port 5173) call the API directly at `localhost:3000`, but the API has no
CORS support.

**Why:** Browsers block a website from calling a server on a different
port unless that server explicitly allows it (this is called CORS). Before
the real request, the browser sends an `OPTIONS` check. The API answers
`404`, so the browser cancels the request.

**What it breaks:** Every request from the websites fails, including login.
The page only says "Failed to fetch".

**Fix:** Both Vite configs now forward `/v1` requests to the API, so the
browser only ever talks to its own port. Each app also needs a local
`.env.local` file with an empty API URL (`VITE_ADMIN_API_BASE_URL=` for
admin, `VITE_API_BASE_URL=` for web). This only fixes local development.
Any hosted setup that serves the websites and the API from different
addresses still needs real CORS support in the API.

---

## 4. The built-in dev webhook key has the wrong length ❌ Open

**File:** `apps/api/src/config.ts`, line 153 (`DEV_FALLBACK_WEBHOOK_KEY_B64`)

**What's wrong:** When `WEBHOOK_SECRET_ENCRYPTION_KEY` isn't set, the API
falls back to a built-in dev key. That key decodes to 34 bytes, but the code
requires exactly 32.

**Why:** The key is the text `test-key-for-dev-only-not-for-prod` encoded
in base64. That text is 34 characters long. Nobody checked it against the
32-byte rule.

**What it breaks:** The fallback can never work. Without your own key, the
API and `npm run seed` both crash at startup with
`WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34`.

**Workaround:** Set your own key:
`WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)`.
**To fix:** Replace the fallback with a valid 32-byte key.

---

## 5. The Dockerfiles are missing ❌ Open

**Files:** `ops/Dockerfile.node`, `ops/Dockerfile.go` (don't exist)

**What's wrong:** `ops/docker-compose.yml` builds the api, settlement,
reporting, migrate and seed services from these two files, but they aren't
in the repo.

**Why:** Unknown. The comments in `ops/README.md` say they were in the
first ops commit. AM hit the same problem in July and wrote their own.

**What it breaks:** The Docker setup in `ops/README.md` doesn't work. Only
the database can run in Docker. Everything else has to run directly on your
computer.

**To fix:** Add both Dockerfiles to the repo.

---

## 6. Settlement has no dev token, despite what the comments say ❌ Open

**Files:** `ops/docker-compose.yml` (comment), `apps/settlement/cmd/settlement/main.go` (lines 79–82)

**What's wrong:** The compose file says the settlement daemon falls back to
`SETTLEMENT_INTERNAL_TOKEN=dev-token` when it isn't set. The code has no
such fallback.

**Why:** The daemon calls `cfg.RequireInternalToken()` at startup, which
exits if the token is empty. The comment describes behaviour that doesn't
exist.

**What it breaks:** Settlement exits right after starting unless you set
the token yourself. FH reported this in a comment in the same file.

**To fix:** Either add the default to the code or correct the comment and
set the token in `docker-compose.yml`.

---

## 7. A secret is committed to git ❌ Open

**File:** `ops/.env.docker`

**What's wrong:** This file is tracked by git and contains
`ACQUIRER_CALLBACK_SIGNING_SECRET`.

**Why:** A comment in the file says it's gitignored "like `.env`". It
isn't: `.gitignore` lists `.env`, which only matches a file named exactly
`.env`, not `.env.docker`.

**What it breaks:** Anyone with access to the repo can read the secret. It
stays in git history even if the file is deleted now, so removing the file
isn't enough. The secret needs to be rotated.

**To fix:** Rotate the secret, add `ops/.env.docker` to `.gitignore`, and
remove it from the repo with `git rm --cached ops/.env.docker`.
