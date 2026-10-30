# Known bugs (October 2026)

Bugs found while getting FilsPay running locally. For each one: what's
wrong, why it happens, and what it breaks.

| # | Bug | Status |
|---|---|---|
| 1 | Migration 0054 uses a table that doesn't exist | ✅ Fixed |
| 2 | Migration 0055 uses columns that don't exist | ✅ Fixed |
| 3 | The websites can't reach the API ("Failed to fetch") | ✅ Fixed for local dev |
| 4 | The built-in dev webhook key has the wrong length | ✅ Fixed |
| 5 | The Dockerfiles are missing | ✅ Fixed |
| 6 | Settlement has no dev token, and the api is never given one | ✅ Fixed |
| 7 | A secret is committed to git, in a file compose never loads | ✅ Fixed |
| 8 | Merchant login skips the OTP step | ✅ Fixed |
| 9 | The nightly hold cleanup can delete every hold | ✅ Fixed |
| 10 | The seed wipes any database it is pointed at | ✅ Fixed |
| 11 | Anyone can post fake acquirer callbacks | ✅ Fixed |
| 12 | Webhooks can be pointed at the server's internal network (SSRF) | ✅ Fixed |
| 13 | "View as merchant" lets admins move the merchant's money | ✅ Fixed |
| 14 | Rotating an API key leaves the old key working | ✅ Fixed |
| 15 | OTP codes and payment-link tokens are predictable | ✅ Fixed |
| 16 | Merchant support users can capture and void payments | ✅ Fixed |
| 17 | Login OTP codes are handed out in the API response outside production | ✅ Fixed |
| 20 | The AI-agent instruction files tell agents to keep the bugs | ✅ Fixed |
| 21 | Settlement pays out the wrong amount on large batches (float32) | ✅ Fixed |
| 22 | The platform volume counter overflows, and its discount was never approved | ✅ Fixed |
| 23 | "Rebuild cached balances" overwrites every merchant's balance with the wrong number | ✅ Fixed |
| 24 | The fils dropped from each scheme line are never recorded in the ledger | ✅ Fixed |
| 25 | The scheme file rounds amounts up instead of truncating them | ✅ Fixed |
| 26 | CSV adjustment imports book a tenth of the amount | ✅ Fixed |
| 27 | The March reconciliation script charges merchants, misses most of March, and double-posts on re-run | ✅ Fixed |
| 28 | Webhook signatures don't match the bytes sent | ✅ Fixed |
| 40 | The webhook backoff test fails on almost every run | ✅ Fixed |
| 29 | Expired payment links can be paid by sending an old timestamp | ✅ Fixed |
| 30 | A slow payment lets a second customer pay the same link too | ✅ Fixed |
| 31 | The negotiated discount is skipped on payment links and booked differently from settlement | ✅ Fixed |
| 46 | Every refund without a reason fails, after the acquirer has already refunded | ✅ Fixed |
| 47 | An API test poisons the outbox and breaks the reporting tests | ✅ Fixed |
| 32 | The settlement daemon closes each day about 3 hours late | ✅ Fixed |
| 33 | The "must be a PDF" KYC rule only checks the filename | ✅ Fixed |
| 34 | Credit approval tells operators apart by display name | ✅ Fixed |
| 35 | The merchant reconciliation page crashes on a negative gap | ✅ Fixed |
| 48 | The dashboard's date filter uses UTC days, not Bahrain business days | ✅ Fixed |
| 41 | Payment links point customers at localhost in production | ✅ Fixed |
| 43 | ~~CSV export skips rows at page boundaries~~ | ⛔ Not a bug: unreachable dead code |
| 44 | Marketplace split payouts don't add up to the batch | ✅ Fixed |
| 38 | The login token is not replaced after the OTP step (session fixation) | ✅ Fixed |
| 50 | Merchants are logged out 10 minutes after signing in | ✅ Fixed |
| 39 | Dead code that would fail or move money wrongly if ever called | ✅ Removed |
| 51 | The reconciliation report invents gaps from a float fee estimate | ✅ Fixed |
| 36 | Refunds were not built, and the helpers would have lost money if wired in as they were | ✅ Fixed |
| 52 | Every paid batch shows as a reconciliation gap on a multi-day window | ✅ Fixed |
| 53 | The settlement summary double-counts a transaction captured twice | ✅ Fixed |
| 54 | A capture its day's batch missed is never paid out | ✅ Fixed |
| 55 | Production has no way to get a login code | 🟡 Workaround: `OTP_LOG_CODE`; no email/SMS sender yet |
| 79 | The hosted dashboards can show a blank page after a rebuild | ✅ Fixed |

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

## 4. The built-in dev webhook key has the wrong length ✅ Fixed

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

**Fix:** The fallback is now built from a fixed 32-byte text
(`filspay-dev-only-webhook-key-32b`), so it passes the length check. It stays
fixed rather than random because the seed and the API run as separate
processes and must decrypt each other's webhook secrets. It is still only
used outside production; with `NODE_ENV=production` a missing key fails
boot. New tests in `apps/api/src/config.test.ts` failed with "got 34" before
the fix and pass after. The compose comment ("copilot, unverified") and the
ops README note ("won't boot in any environment") are corrected. Any hosted
environment must still set its own key with `openssl rand -base64 32`.

---

## 5. The Dockerfiles are missing ✅ Fixed

**Files:** `ops/Dockerfile.node` (new), `ops/Dockerfile.go` (new),
`.dockerignore` (new), `ops/docker-compose.yml`, `ops/README.md`

**What's wrong:** `ops/docker-compose.yml` builds the api, settlement,
reporting, migrate and seed services from `ops/Dockerfile.node` and
`ops/Dockerfile.go`, but neither file was in the repo. There was also no
`.dockerignore`.

**Why:** Unknown. The ops README said they were in the first ops commit; git
history shows they never were. AM hit the same problem in July and wrote
their own, which never made it back into the repo.

**What it breaks:** The Docker setup doesn't work at all: only the database
can run in Docker. Without a `.dockerignore`, the first working Dockerfile
would also have copied `.git`, the host's `node_modules` (macOS binaries of
argon2/sharp) and `ops/.env.docker` with its secrets into every image.

**Fix:**
- `Dockerfile.node`: `node:22-slim` (Node 20, which the ops README named,
  went end-of-life in April 2026). Installs with `npm ci`, dev dependencies
  included because every service runs TypeScript through `tsx`. argon2 and
  sharp use their prebuilt glibc binaries, so no compilers are needed. Runs
  as the `node` user.
- `Dockerfile.go`: multi-stage. Builds a static binary with Go 1.25, then
  copies only that into `distroless/static` (about 12 MB total, no shell).
  Timezone data is compiled into the binary.
- `.dockerignore`: keeps `.git`, `node_modules`, `.env*`, `ops/.env.docker`
  and `docs` out of the build context.
- Compose: a `filspay_kyc` volume for KYC uploads, which were otherwise lost
  every time the api container was recreated.

**Verified:** `docker compose build` succeeds. The settlement image is
19.9 MB and its binary starts. In the Node image (556 MB, mostly sharp's
libvips), argon2 and sharp load, `tsx` runs the TypeScript source, the
process runs as `node`, and no `.env*` file or `ops/` folder is present.

---

## 6. Settlement has no dev token, and the api is never given one ✅ Fixed

**Files:** `ops/docker-compose.yml`, `ops/.env.docker.example` (new),
`ops/README.md`, `docs/ARCHITECTURE.md`, `apps/settlement/internal/config/config.go` (comments)

**What's wrong:** The compose file, the ops README and ARCHITECTURE all said
the settlement daemon falls back to `SETTLEMENT_INTERNAL_TOKEN=dev-token`.
The code has no such fallback. Separately, the api service in compose was
never given the token at all.

**Why:** The daemon calls `cfg.RequireInternalToken()` at startup and exits
if the token is empty; the docs described behaviour that doesn't exist. The
api reads the same variable to authenticate its calls to settlement, and
nothing passed it in.

**What it breaks:** Settlement exits right after starting. Even with the
token set on settlement only, every admin-console action that calls
settlement (run batch, rebuild balances, MDR recalculation) gets a 401,
because the api sends an empty token.

**Fix:** Kept the fail-closed behaviour (no built-in token). Both api and
settlement now read the token from the same `ops/.env.docker` file (see
bug 7), so they can't disagree. The template documents generating one with
`openssl rand -hex 32`. The false `dev-token` notes are corrected. Before the
fix, `docker compose config` showed no service receiving the token.

**Correction:** an earlier version of this entry claimed `PGCONN_SETTLEMENT`
overrides `DATABASE_URL`, and changed the docs to say so. That was wrong: it
trusted a test that had locked in the bug. The original docs were right
(`DATABASE_URL` wins), and the code now does that (`docs/FINDINGS.md` S12).

---

## 7. A secret is committed to git, in a file compose never loads ✅ Fixed

**Files:** `ops/.env.docker`, `ops/.env.docker.example` (new), `.gitignore`,
`ops/docker-compose.yml`

**What's wrong:** Two problems with one file. `ops/.env.docker` is tracked by
git and contains `ACQUIRER_CALLBACK_SIGNING_SECRET`. And compose never
actually loaded it, although the compose header and ops README said it did.

**Why:** A comment in the file says it's gitignored "like `.env`". It
isn't: `.gitignore` lists `.env`, which only matches a file named exactly
`.env`. Compose only reads a file into a container through `env_file:`, and
no service had one; the automatic `.env` lookup compose does is for
`${...}` substitution in the compose file, and only for a file named `.env`.

**What it breaks:** Anyone with access to the repo can read the secret, and
it stays in git history. Because the file was never loaded, none of its
settings (`NODE_ENV`, the acquirer secret) reached any service, so the
stack ran with different settings than everyone believed.

**Fix:** `ops/.env.docker` is untracked (`git rm --cached`) and gitignored;
your local copy is kept. `ops/.env.docker.example` is the committed
template, with no secrets. The api, settlement, reporting and seed services
load `.env.docker` through `env_file:`; seed loads it too so it encrypts
webhook secrets with the api's key. `docker compose config` now shows the
values reaching each service. The leaked sandbox
`ACQUIRER_CALLBACK_SIGNING_SECRET` was replaced with a new random value that
has never been in git (2026-10-30). It still appears in git history, so the
old value must never be used again. With a real acquirer, rotation also means
having the acquirer issue the new secret and revoke the old one.

---

## 8. Merchant login skips the OTP step ✅ Fixed

**File:** `apps/api/src/auth/sessions.ts` (`lookupSession`)

**What's wrong:** A merchant who has only typed the right password, and
never entered the OTP code, is treated as fully logged in.

**Why:** Login creates a "pending" session and puts its token in the same
`fp_sid` cookie a real session uses. `lookupSession` decides whether a
cookie is logged in, and it read from the `live_sessions` view, which only
filters out revoked and expired rows. Nothing checked `authenticated = true`,
the rule migration 0012 says every auth query must include. The admin side
(`lookupAdminSession`) already checks it; the merchant side didn't.

**What it breaks:** Two-factor login. Anyone with a merchant's password gets
full dashboard and API access for the 10-minute pending window: transactions,
captures, voids, payment links, webhooks. The OTP protects nothing.

**Fix:** `lookupSession` now requires `s.authenticated = true`. Added a test
that a pending session does not authenticate.

---

## 9. The nightly hold cleanup can delete every hold ✅ Fixed

**Files:** `scripts/expire_holds.ts`, `scripts/lib/sqlFilter.ts`

**What's wrong:** On a night with no expired holds, the cleanup script
deletes every row in the `holds` table, including active ones. On other
nights it deletes expired holds instead of marking them expired.

**Why:** The script first selected the expired hold ids, then built a
`DELETE ... WHERE id = ANY($1)` with `buildDelete`. `buildDelete` skips any
filter that is an empty list, so zero ids produced `DELETE FROM holds` with
no `WHERE` at all. Deleting was also never the design: the `holds` table
has an `'expired'` status for exactly this, and the handover says holds are
flipped to `expired` and never deleted. Selecting first and deleting later
also left a gap where a hold captured in between could still be deleted.

**What it breaks:** Every hold disappears on a quiet night, so open
authorizations lose their hold and the transaction history loses its hold
records. The seed's self-check also relies on holds existing.

**Fix:** The script is now one `UPDATE holds SET status = 'expired' WHERE
status = 'active' AND expires_at < now()`, with no select step and no
delete. `buildDelete` now throws instead of building a `DELETE` with no
`WHERE` clause.

---

## 10. The seed wipes any database it is pointed at ✅ Fixed

**Files:** `db/seed/generate.ts`, `db/seed/guard.ts` (new),
`ops/docker-compose.yml`, `ops/README.md`, `docs/RUNBOOK.md`

**What's wrong:** `npm run seed` empties the database before inserting its
fixtures, and it did this against whatever `DATABASE_URL` pointed at, with
no check.

**Why:** The seed starts with `TRUNCATE ... RESTART IDENTITY CASCADE`.
`CASCADE` also empties every table that has a foreign key to a seed table,
so it reaches far beyond the fixture tables. The compose file, the ops
README and the runbook all said it "only touches its own fixture tables"
and was "safe against a shared staging database". That was false; the
runbook itself notes staging-2 got reset this way.

**What it breaks:** One seed run against a hosted or shared database
permanently deletes real merchants, transactions, ledger entries, sessions
and settlement history, and resets the id sequences.

**Fix:** `generate()` now calls `assertSeedTargetIsResettable` before
truncating. It refuses when `NODE_ENV=production`, and refuses any database
host other than `localhost` or the compose `postgres` host unless
`SEED_ALLOW_RESET=1` is set. The error names the host it refused. The false
"safe on shared databases" notes in the compose file, ops README and runbook
are corrected. The guard has its own tests, now part of `npm test`.

---

## 11. Anyone can post fake acquirer callbacks ✅ Fixed

**Files:** `apps/api/src/webhooks/inboundVerify.ts`,
`apps/api/src/routes/acquirerCallbacks.ts`, `apps/api/src/acquirer/callbacks.ts`,
`apps/api/src/config.ts`, `db/migrations/0073_acquirer_callback_notes_unique_callback_id.sql` (new)

**What's wrong:** `POST /v1/acquirer/callbacks` is public; its only
protection is the acquirer's signature. That protection had four holes:

1. A callback with **no signature header** was accepted. Requiring one was
   behind `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE`, which defaults to `false`.
2. A signed callback could be **replayed** forever. The timestamp inside the
   signature was never checked.
3. **Any `outcome` value** was stored. The route cast it to the allowed type
   without checking, and its comment named the wrong values
   (`approved`/`rejected` instead of `cleared`/`confirmed_fraud`).
4. **Redeliveries were stored twice.** Comments said `processed_events` and
   a unique index deduplicated them; neither exists.

Also, with no secret configured (the default outside production), the HMAC
key was the empty string, so anyone could compute a "valid" signature.

**Why:** The signature check was written as optional "until the sandbox
signs everything" and never turned on. Freshness and dedup were described
in comments but never built.

**What it breaks:** Anyone on the internet could write fraud-review verdicts
onto any transaction ("confirmed_fraud" on a good customer, "cleared" on a
real fraud), with arbitrary text, and support and finance act on those
notes. A captured real callback could be replayed at any time, and each
acquirer retry added a duplicate note.

**Fix:** Every callback must be signed and the timestamp must be within 5
minutes (the same window outbound webhooks use). An empty secret rejects
everything instead of accepting forgeries. The comparison is now
constant-time on the decoded bytes (`timingSafeEqualHex`). `outcome` is
checked against `cleared`/`confirmed_fraud` and anything else is a 400.
Migration 0073 collapses existing duplicates and adds a unique index on
`callback_id`; a redelivery inserts nothing and still gets a 200, so the
acquirer stops retrying. The `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` setting
is removed. The tests for each hole failed before the fix and pass after.

---

## 12. Webhooks can be pointed at the server's internal network (SSRF) ✅ Fixed

**Files:** `apps/api/src/webhooks/transport.ts`, `apps/api/src/config.ts`,
`apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/webhooks/create.ts` (comment)

**What's wrong:** A merchant chooses the URL their webhooks are sent to, and
the API made the request to whatever that URL pointed at, including the
deployment's own private network: `http://settlement:8091`, Postgres,
`localhost`, or the cloud metadata service at `169.254.169.254`.

**Why:** The only check was the URL format (and https in production). A
comment called https-only "our SSRF protection"; it isn't, since an
internal service can be reached over https or by a hostname that resolves
to a private address. The transport also followed redirects, so even a
public URL could bounce the request inward, and it read response bodies
without any size limit.

**What it breaks:** Once hosted, any merchant account turns the API into a
proxy into the private network. The "send test event" button returns up to
2000 characters of the response, so the merchant can also read what the
internal service answered. A huge response could exhaust the API's memory.

**Fix:** The transport now checks every address a hostname resolves to, at
connect time, and refuses loopback, private, link-local (including cloud
metadata), carrier-grade NAT, multicast and reserved ranges, for IPv4, IPv6
and IPv4-mapped IPv6. Checking at connect time means DNS rebinding can't slip
an internal address in after the check. Redirects are never followed; a 3xx
is returned as the receiver's answer. Response bodies are capped at 64 KB.
Private targets are allowed only when `WEBHOOK_ALLOW_PRIVATE_TARGETS` is on,
which defaults to on outside production (for a local test receiver) and off
in production. New tests reached `127.0.0.1`, followed a redirect and read a
1 MB body on the old code, and are refused, not followed and truncated now.

---

## 13. "View as merchant" lets admins move the merchant's money ✅ Fixed

**Files:** `apps/api/src/auth/requireMerchantAuth.ts`,
`apps/api/src/admin/impersonation.ts`, `apps/api/src/routes/transactions.ts` (comment)

**What's wrong:** An ops admin can open a merchant's dashboard "as they see
it" for 15 minutes. That session could do far more than look:

1. Any impersonation could **capture and void** the merchant's payments.
   Those routes have no role check, only "is this a logged-in merchant".
2. A `super_admin` was mapped to the merchant's **owner** role and a
   `finance` admin to **finance**, so they could also create and cancel
   payment links and change where the merchant's webhooks are sent.
3. **Disabling an admin didn't end their grant.** A comment said an
   "admin-disable trigger" revokes grants; no such trigger exists.

**Why:** ADMIN.md describes it as viewing the merchant's dashboard, and the
handover says impersonation maps every admin to `support` and is read-only.
Code comments claimed read-only was "enforced in requireMerchantAuth"; it
wasn't, and the only test covered a `support` admin on routes that already
had owner/finance gates (a comment noted finance/super_admin weren't tested).

**What it breaks:** Any admin, including the lowest `support` role, could
capture or void a merchant's money while "just looking", and the ledger
recorded it as the merchant's own action. A fired admin kept that access
until the grant expired.

**Fix:** `requireMerchantAuth` refuses an impersonation grant on every
method except GET/HEAD/OPTIONS, before any route runs, so it covers routes
with no role gate of their own. Every admin role now maps to the merchant
`support` role. The grant lookup requires the admin to be `active`, the same
rule admin sessions use. New tests (finance and super_admin can't create
links, capture/void are refused, a disabled admin's grant stops working)
failed before the fix and pass after.

---

## 14. Rotating an API key leaves the old key working ✅ Fixed

**Files:** `apps/api/src/admin/apiKeys.ts`, `apps/api/src/routes/admin.test.ts`,
`docs/ADMIN.md`

**What's wrong:** **Rotate API key** in the admin console issued a new key,
but the old key kept working, forever.

**Why:** `rotateApiKeyAsAdmin` locked the old key, issued the replacement and
wrote the audit row, but never revoked the old key. Migration 0037 describes
rotation as "one transaction revokes the old key with reason 'rotated' and
issues the replacement", and the route's comment says "revoke + reissue". A
comment blamed a "24h grace period (see ADMIN.md)"; ADMIN.md has no grace
period. The test was written to match the bug ("the previous key stays
active"), with YA's objection left in a comment above it. Migration 0056's
`revoke_after` column and its "sweep job" were never built either; nothing
reads or writes that column.

**What it breaks:** Rotation is what support does when a merchant's key
leaks. After a "successful" rotation the leaked key still had full merchant
API access: creating charges, capturing, voiding, reading every transaction.

**Fix:** Rotation now sets `revoked_at` and `revoked_reason = 'rotated'` on
the old key in the same transaction as the replacement and the audit row, so
a failed rotation changes nothing (the existing audit-failure test confirms
it). The rotation test now asserts the old key gets a 401; it got a 200
before the fix. ADMIN.md tells operators the old key dies immediately.

---

## 15. OTP codes and payment-link tokens are predictable ✅ Fixed

**Files:** `apps/api/src/lib/random.ts`, `apps/api/src/lib/random.test.ts` (new),
`docs/ARCHITECTURE.md`

**What's wrong:** Merchant login OTP codes, payment-link tokens and receipt
references were generated with `Math.random()`.

**Why:** `Math.random()` is a fast, non-cryptographic generator. Its internal
state can be worked out from a handful of its outputs, after which every
later value is known in advance. CLAUDE.md says `Math.random()` "is
acceptable for non-bearer tokens (payment link slugs, OTP codes)"; both are
exactly what an attacker needs to guess. ARCHITECTURE said the tokens come
from `crypto.randomBytes`; they never did. Admin OTPs already used
`crypto.randomInt`, so the two login flows were inconsistent.

**What it breaks:** Someone who collects a few payment-link URLs or OTP codes
(for example from their own test account) could predict other merchants'
payment-link URLs, which open the checkout with the merchant's amount and
reference, and the OTP code sent with the next login.

**Fix:** `randomDigits` and `randomFromAlphabet` now draw every character
with `crypto.randomInt`, which also makes long digit strings exact (the old
float multiplication lost precision past 15 digits). That covers OTPs,
payment-link tokens and receipt references at once. A new test pins
`Math.random` to a constant: on the old code 20 OTP codes in a row were all
`000000`; now they vary. ARCHITECTURE describes the real source.
`admin/inviteCode.ts` still uses `Math.random`, but it is dead code (its
table doesn't exist) and is tracked with the other dead code.

---

## 16. Merchant support users can capture and void payments ✅ Fixed

**Files:** `apps/api/src/routes/transactions.ts`,
`apps/api/src/routes/transactions.test.ts`,
`apps/web/src/pages/transactions/TransactionDetailPage.tsx` (comment)

**What's wrong:** A merchant's dashboard users have one of three roles:
`owner`, `finance` or `support`. Any of them could capture or void a
payment, including `support`.

**Why:** Every other merchant write (payment links, webhook endpoints, KYC
files) is gated to `owner`/`finance` with `requireMerchantRole`. Capture and
void only had `requireMerchantAuth` ("is this any logged-in user of this
merchant"). The dashboard hides the buttons from `support` and its own
comment warns that the hide "is NOT backed by a matching server-side role
check… Do not mistake a hidden button here for a security boundary." A
`TODO(FH): role check?` on the void route was never resolved.

**What it breaks:** A support user, the role meant for looking things up,
could capture or void any of the merchant's payments by calling the API
directly, bypassing the hidden button. The new test captured a full 5.000 BD
as `support` on the old code.

**Fix:** Capture and void now require `owner` or `finance`, the same gate as
every other merchant write. API keys keep full access (they can only be
issued by an owner), and the payment-link checkout calls capture internally,
so customers paying a link are unaffected. New tests: `support` gets 403 on
both and the transaction stays `authorized`; `finance` can still void. The
dashboard comment now says the server enforces the rule.

---

## 17. Login OTP codes are handed out in the API response outside production ✅ Fixed

**Files:** `apps/api/src/config.ts`, `apps/api/src/config.test.ts`,
`ops/.env.docker.example`, `apps/api/src/auth/notifier.ts` (comment),
`apps/web/src/api/dashboardAuth.ts` (comment)

**What's wrong:** After a correct password, both the merchant login and the
**admin console** login returned the OTP code itself in the response
(`devOtpCode`) whenever `NODE_ENV` was anything other than exactly
`production`, including unset.

**Why:** `OTP_DEV_EXPOSE` defaulted to `NODE_ENV !== "production"`. It was
meant for local development, where no email/SMS sender exists, but it was
switched on by the absence of a setting rather than by asking for it. A code
comment notes "our staging has NODE_ENV unset".

**What it breaks:** Two-factor login on any box not running with
`NODE_ENV=production`: whoever knows a password gets the code handed to them,
for merchants and for ops admins. After bug 8 made the OTP actually required,
this was the remaining way around it.

**Fix:** `OTP_DEV_EXPOSE` now defaults to `false` in every environment and
must be set to `true` explicitly; the API refuses to boot with it on and
`NODE_ENV=production`. The env template documents it (off by default). In
development the code is still printed in the API's own log. New config tests
(off for development/test/unset/unknown `NODE_ENV`; refused with production)
failed before the fix and pass after; the 85 tests that log in already opted
in explicitly.

**Related, still open:** production has no OTP delivery at all. Tracked as
bug 55.

---

## 20. The AI-agent instruction files tell agents to keep the bugs ✅ Fixed

(Numbers 18 and 19 were folded into bugs 6 and 7.)

**Files:** `CLAUDE.md`, `AGENTS.md`, `.cursorrules`

**What's wrong:** These three files are read automatically by coding agents
(Claude Code, Cursor, Copilot and others) and followed as rules. Most of
their rules were false, and several told agents to protect real bugs:

| Rule in the files | The truth |
|---|---|
| Amounts are cents, 1 BD = 100 | Fils, 1 BD = 1000 (ADR-0001, `packages/money`) |
| Money columns are `INTEGER`, cents fit in int32 | They are `BIGINT`; the one `INTEGER` counter overflows (open bug) |
| Settlement windows are UTC midnight | Asia/Bahrain midnight (`window.go`, ARCHITECTURE) |
| `Math.random` is fine for OTPs and payment-link slugs | Predictable; bug 15 |
| `float32` in settlement is intentional and precise enough | Wrong payouts above ~8,192 BD (open bug) |
| super_admin → owner impersonation is correct and approved | Impersonation must be read-only; bug 13 |
| Impersonation is gated in middleware, handler needn't check | No role gate existed; bug 13 |
| Never modify tests; if one fails, revert your change | Several tests asserted bugs (bugs 9, 11, 14) |
| The CSV export loads everything into memory | It pages, and the paging skips rows (open bug) |
| `v1/` is the live partner API | It isn't registered in `app.ts` |
| Docs win over code; the Go service is always right | Both had bugs; verify against schema, ADRs, handover |

**Why:** The rules were written to justify how the code behaved rather than
to describe how it should behave, and every agent session re-read them as
instructions. The CTF story in the git history calls this "the Order of the
Prompt": the rules are its vows.

**What it breaks:** Any agent working on the repo follows them: it treats
cents as the unit, keeps `Math.random` for OTPs, refuses to fix tests that
lock in bugs, and "reverts" correct fixes. It would undo most of the fixes
in this list.

**Fix:** `AGENTS.md` is rewritten as the single set of conventions, every
statement checked against the code, schema and tests. `CLAUDE.md` imports it
(`@AGENTS.md`) and `.cursorrules` summarises it and points to it, so there is
one place to keep correct. It also says where the truth is, that inline
"intentional" comments aren't evidence, and how to handle a test that
asserts a bug.

---

## 21. Settlement pays out the wrong amount on large batches (float32) ✅ Fixed

**Files:** `apps/settlement/internal/settlement/payable.go`,
`apps/settlement/internal/settlement/payable_test.go` (new)

**What's wrong:** When a merchant's daily batch closes, the net payout
(what the merchant is actually paid) was computed in floating point:
`float32(gross)/1000 - float32(fee)/1000`, rounded back to fils.

**Why:** `float32` holds about 7 significant digits. A batch of 8,192.022 BD
is 8,192,022 fils (7 digits) and already loses the last fil. The old
`.cursorrules` called the float "intentional… more than enough for any
realistic settlement batch"; Yousif flagged it in `925744c`.

**What it breaks:** Every batch above roughly 8,192 BD gross can pay the
merchant the wrong amount, and the ledger's payout legs, the balance cache
and the `settlement.batch_closed` event all carry that wrong figure. On the
old code, 8,192.022 BD gross minus a 204.800 BD fee paid 7,987.223 BD
instead of 7,987.222 BD, and a very large batch was off by 64 BD. Some sizes
happen to come out right, which is why it wasn't noticed.

**Fix:** `NetPayableFils` is now `gross - fee` in integer fils. New tests
check exact results at the failure points and across every batch size from
1 BD to 50,000 BD (in 7-fil steps); both failed before the fix and pass
after. **For finance:** batches closed before this fix should be checked:
`SELECT * FROM settlement_batches WHERE net_payout_fils <> gross_fils - fee_fils;`
(the local seed has none). The separate `lifetime_net_payout_monitoring_estimate`
is still a `REAL`, but nothing pays out from it.

---

## 22. The platform volume counter overflows, and its discount was never approved ✅ Fixed

**Files:** `db/migrations/0074_platform_stats_bigint.sql` (new),
`apps/settlement/internal/settlement/platform_volume.go`,
`apps/api/src/fees/platformVolumeTier.ts`,
`db/migrations/0075_platform_stats_volume_tier_switch.sql` (new),
`apps/settlement/internal/settlement/batch.go`,
`apps/settlement/internal/settlement/platform_volume_overflow_test.go` (new),
`apps/settlement/internal/settlement/volume_tier_switch_test.go` (new),
`apps/api/src/fees/platformVolumeTier.test.ts`

**What's wrong:** Once the platform has processed 2,000,000 BD in total,
every merchant gets 0.15% off their fee. The running total that decides this
was a 32-bit integer, which tops out at 2,147,483,647 fils, only 7% above the
threshold.

**Why:** `platform_stats.total_processed_fils` was created as `INTEGER`
(migration 0049 says "INTEGER is plenty for a counter"; a comment there
quotes an AI claiming "INTEGER in PostgreSQL is 64-bit on 64-bit builds",
which is false). The Go code read and added it as `int32`. The threshold was
raised to 2,000,000,000 in an "Aug dependency bump" without the schema
changing. A comment in the TypeScript side claimed the column was already
BIGINT.

**What it breaks:** A few batches after the discount switches on, the Go
addition wraps around: on the old code, 2,100,000,000 + 100,000,000 became
**-2,094,967,296**. The stored total goes negative, the discount silently
switches off for every merchant, and the platform's lifetime volume figure
is garbage from then on.

**Fix:** Migration 0074 widens the column to `BIGINT`, like every other money
column. Go reads and adds it as `int64`; the TypeScript reader converts the
BIGINT string explicitly. A new test starts the counter at 2.1 billion, adds
a batch, and checks the exact total and that the discount stays on; it
failed before and passes now.

**The discount itself was never approved.** The handover says Yousif refused
it "until finance signs off in writing", and a comment notes nobody can find
the finance ticket for the threshold change, yet the code applied it
automatically. A new test closed a batch past the threshold and got a fee of
2,350 fils instead of the contracted 2,500. Migration 0075 adds
`platform_stats.volume_tier_enabled`, default `false`; capture (TypeScript)
and batch close (Go) both read it from that one row, so the two can never
charge different fees for the same payment. Once finance approves:
`UPDATE platform_stats SET volume_tier_enabled = true, updated_at = now() WHERE id = 1;`

---

## 23. "Rebuild cached balances" overwrites every merchant's balance with the wrong number ✅ Fixed

**Files:** `apps/settlement/internal/ledger/refresh.go`,
`apps/settlement/internal/ledger/refresh_test.go`, `docs/ADMIN.md`,
`docs/ARCHITECTURE.md`, `docs/adr/0004-balance-rebuild-source.md`

**What's wrong:** The admin console's **Rebuild cached balances** button set
each merchant's balance to the lifetime total of everything ever sent to the
card scheme for them, not to what they are actually owed.

**Why:** ADR-0004 moved the button off the ledger because the per-merchant
ledger walk was too slow for a 30-second request, and pointed it at
`merchant_payable_position`, a view that sums `scheme_export_lines`. That
figure ignores fees, payouts, credits and anything captured but not yet
settled. The handover warns there "shouldn't be one that reads anything
else". The tests were written against the view, using export lines with no
ledger activity at all, so they passed while the button was wrong.

**What it breaks:** One click rewrote every merchant's displayed balance. On
the seeded data: Delta Wholesale shown 25,644 BD too high (fees ignored),
Alpha Retail 129,170 BD too low (unsettled activity ignored), and Delta
Marketplace, with nothing exported yet, wiped to 0 instead of 22,677 BD.
ADMIN.md also told operators to run it "after any manual correction", which
erases that correction (ADR-0006), and promised a nightly 02:00 recompute
that doesn't exist.

**Fix:** The button now rebuilds from the ledger's `merchant_payable`
account, the same figure as the CLI, in one SQL statement with a single
grouped scan (2.4 ms for the seed's 7,492 ledger rows) instead of a query per
merchant. New tests: a fully paid-out merchant rebuilds to 0 (was 100 BD),
an unsettled 39 BD stays 39 BD (was 0), a drifted cache is corrected (was set
to 0). All three failed before and pass after. ADMIN.md, ARCHITECTURE and
ADR-0004 (now superseded) are corrected. The `merchant_payable_position`
view is now unused.

---

## 24. The fils dropped from each scheme line are never recorded in the ledger ✅ Fixed

**Files:** `apps/settlement/internal/settlement/batch.go`,
`apps/settlement/internal/settlement/scheme_residue_test.go` (new)

**What's wrong:** The card scheme only accepts amounts in two decimals, so
each settled transaction is sent truncated to a multiple of 10 fils (4.747 BD
goes out as 4.74). The 0–9 fils cut off each line were never written to the
ledger.

**Why:** ADR-0002 decided to journal that residue per line, inside
`CloseBatch`, from `card_scheme_clearing` to the `scheme_rounding_residue`
suspense account, and is marked "Accepted, implemented (CloseBatch,
2026-03)". The code was never written; only the one-off March script ever
posted residue. The handover says so: "nothing posts residue yet".

**What it breaks:** `card_scheme_clearing` keeps the full gross while the
scheme pays the truncated amount, so the ledger, the settlement report and
the scheme statement can never agree. The gap grows by up to 9 fils per
transaction, every day, for every merchant, and finance has no suspense
balance to clear against the scheme statement.

**Fix:** For each export line with a remainder, `CloseBatch` now posts a
balanced pair in the same transaction: credit `card_scheme_clearing`, debit
`scheme_rounding_residue`, tagged with the transaction and batch. After the
close, clearing holds exactly what the scheme will pay. The new test (4.747,
4.755, 12.344 and 4.740 BD lines) found no residue legs and clearing at the
full gross before the fix; residue of 7, 5, 4 and 0 fils and clearing equal
to the exported amount after.

---

## 25. The scheme file rounds amounts up instead of truncating them ✅ Fixed

**Files:** `apps/settlement/internal/settlement/batch.go`,
`apps/settlement/internal/settlement/scheme_export.go`,
`apps/settlement/internal/settlement/scheme_export_test.go` (comment)

**What's wrong:** Each scheme export line has two figures: `amount_fils`
(correctly truncated) and `amount`, the BD value the file is actually written
from. `amount` was rounded, not truncated, so the file declared more than the
ledger recorded.

**Why:** `amount` was filled from the *untruncated* gross through a float
(`float64(gross) / 1000`), and Postgres rounds on assignment to
`NUMERIC(10,2)`. Migration 0050's comment says "file and fils always agree";
AM's reply underneath asks "NUMERIC(10,2) rounds on assignment though?". In
the Slack export the team saw the mismatch and blamed "Visa rounding".

**What it breaks:** Whenever the third decimal is 5 or more, the file
over-declares by 10 fils. In the production export
`docs/exports/scheme/scheme_export_lines-delta-wholesale-2026-09-14.tsv`,
123 of 260 lines are higher than `amount_fils` (never lower) and the file
totals 20,000.20 BD against 19,998.97 BD: 1.23 BD over-declared for one
merchant in one day. The scheme statement can never tie to the ledger.

**Fix:** `amount` is now written from the truncated fils with
`formatFilsAsTwoDecimalString`, integer arithmetic only; the float helper
`SchemeAmountBD` is removed. On the old code the new test exported 4.747 BD
as 4.75 and 4.755 BD as 4.76; now 4.74 and 4.75. **For finance:** lines
written before this fix can be found with
`SELECT * FROM scheme_export_lines WHERE amount * 1000 <> amount_fils;`.

---

## 26. CSV adjustment imports book a tenth of the amount ✅ Fixed

**Files:** `apps/api/src/admin/adjustmentCsvParsing.ts`,
`apps/api/src/lib/decimal.ts` (deleted), and the tests that locked the bug in:
`admin/adjustmentCsvParsing.test.ts`, `admin/adjustmentImport.test.ts`,
`routes/adminAdjustmentImport.test.ts`

**What's wrong:** **Import adjustments** in the admin console takes finance's
CSV of corrections in BD (`4.75`, `120.00`, as ADMIN.md says). A row of
`4.750` BD was booked as 475 fils, 0.475 BD: a tenth of the amount. A fourth
decimal (`4.7555`) was silently cut off instead of rejected.

**Why:** The parser used `parseDecimalMinor`, a "cents" helper that keeps two
decimals, instead of `parseBhdToFils` (ADR-0001: three decimals, 1 BD = 1000
fils). Yousif reported it in `9567ea0` ("the csv import is 10x off"); MK's
reply was a commit "mark import amounts as intentional", and three tests were
written to expect 475, 350 and 500 fils for 4.75, -3.50 and 5.00 BD, with a
comment "the import format is 2dp by agreement with finance".

**What it breaks:** Every imported correction posts one tenth of the agreed
amount to the ledger and the merchant's balance, so finance's corrections
never land correctly, and the import screen shows the wrong parsed figure
next to the right raw text.

**Fix:** The parser is `parseBhdToFils`. New parser tests and the corrected
import tests (4.750 → 4750, 4.755 → 4755, -1.250 → -1250, 4.7555 and
`4.75abc` rejected; a 4.75 + 1.25 import totals 6000) failed before the fix
and pass after. The unused `parseDecimalMinor` is deleted so it can't be
reused.

---

## 27. The March reconciliation script charges merchants, misses most of March, and double-posts on re-run ✅ Fixed

**Files:** `scripts/reconcile_march.ts`, `scripts/reconcile_march.test.ts`,
`scripts/reconcile_march.ledger.test.ts` (new)

**What's wrong:** `scripts/reconcile_march.ts` is the one-off that books
March 2026's scheme rounding residue (finance ticket FP-187; March closed
before residue journaling existed, see bug 24). It had three problems:

1. **Wrong accounts.** It debited `merchant_payable` and credited
   `scheme_rounding_residue`, which takes the residue out of what merchants
   are owed. ADR-0002 says: credit `card_scheme_clearing`, debit
   `scheme_rounding_residue`.
2. **Wrong month.** It used the UTC calendar month. The daily batches, and
   the scheme lines the residue comes from, use the Asia/Bahrain day, and the
   handover says "whoever writes it must use the Bahrain month".
3. **Not re-runnable.** A comment said "re-running is safe, entry_group_id
   dedupes it"; every run creates a new random group id, so a second run
   posts everything again.

**Why:** Written in a hurry for finance, against assumptions nobody checked;
ADR-0003 (UTC months for one-off scripts) is contested in its own notes.

**What it breaks:** On the seeded data the UTC window sees 93 transactions and
557 fils of residue; the Bahrain business month has 621 transactions and
5,307 fils. The 528 captures in the first three Bahrain hours of 1 March
(still 28 February in UTC), 4,750 fils of residue, are skipped. What it does
book is taken from merchants, and any re-run doubles it.

**Fix:** The window is the Bahrain business month (28 Feb 21:00 UTC to
31 Mar 21:00 UTC). Residue is posted per ADR-0002 and never touches
`merchant_payable`. A merchant that already has a sweep is skipped, and the
log says so. New tests (Bahrain bounds; correct accounts; a second run posts
nothing) failed before the fix and pass after, inside rolled-back
transactions. **Note:** if the old script was already run on production, its
`merchant_payable` debits need reversing; find them with
`description = 'March 2026 scheme rounding residue sweep — manual recon per finance'`.

---

## 28. Webhook signatures don't match the bytes sent ✅ Fixed

**Files:** `apps/api/src/webhooks/sign.ts`, `apps/api/src/webhooks/dispatcher.ts`,
`apps/api/src/webhooks/testSend.ts`, `docs/RUNBOOK.md`, and tests in
`dispatcher.test.ts` and `testSend.test.ts`

**What's wrong:** Every webhook carries a `Webhook-Signature` HMAC so the
merchant can prove it came from FilsPay. The signature was computed over one
serialisation of the payload (keys sorted, `canonicalJson`) and the request
body was a different one (`JSON.stringify`, database key order).

**Why:** Signing and sending serialised the payload separately. Yousif's
unmerged branch `ya/sign-raw` ("sign the exact bytes we send") was deleted.
The tests didn't catch it because the test receivers parse the body and
re-sort the keys before verifying, which no real receiver does; Yousif's
comment on that test says so. The runbook told support to ask merchants to
"re-serialise it with sorted keys before computing the HMAC".

**What it breaks:** A merchant verifying the signature the standard way, over
the raw request body, gets a mismatch on ordinary deliveries such as
`transaction.captured`, and on the dashboard's "send test event". They either
reject genuine webhooks or switch verification off, and then anyone can send
them fake payment events.

**Fix:** `signPayload` serialises the payload once and returns that exact
string with the signature; the dispatcher and test-send both send it as the
body. New tests compute the HMAC over the raw body exactly as a receiver
would; both failed on the old code (for test-send, checked by temporarily
restoring the old line) and pass now. Receivers that re-sort keys keep
working. The runbook now describes raw-body verification.

---

## 40. The webhook backoff test fails on almost every run ✅ Fixed

**File:** `apps/api/src/webhooks/dispatcher.test.ts` (test only; no app change)

**What's wrong:** The test "failing endpoint: backoff/exhaustion sequence…"
failed on about 99.5% of runs.

**Why:** Retry delays deliberately add ±10% random jitter
(`backoffDelayMs`, `dispatcher.ts`) so many failing webhooks don't all retry
at the same instant. The test called the same function with real randomness
and asserted the result was exactly 1000 ms (and 2000 ms). Over 200,000 runs
it was exactly 1000 only 0.48% of the time.

**What it breaks:** No runtime impact; the retry code is correct. But a test
that always fails trains people to ignore failures, and it hid behind the
other DB-dependent failures.

**Fix:** The two exact checks now compute the nominal delay with the jitter
pinned to its midpoint (`() => 0.5`). The check against the delivery row's
`next_attempt_at` already allows for the ±10%. Five runs in a row pass.

---

## 29. Expired payment links can be paid by sending an old timestamp ✅ Fixed

**Files:** `apps/api/src/paymentLinks/pay.ts`, `docs/ARCHITECTURE.md`,
`apps/api/src/paymentLinks/pay.test.ts`, `apps/api/src/routes/paymentLinks.test.ts`

**What's wrong:** A merchant sets an expiry on each payment link. The public
pay endpoint (`POST /v1/payment-links/:token/pay`, no login) checked expiry
against `submittedAt`, a time the caller sends, with no limit. Sending a
timestamp from before the expiry paid a link that had expired long ago.

**Why:** It was meant for "offline terminals" and for a retry that lands just
after expiry, but it trusted any past time from an anonymous caller. No
offline terminal exists in this codebase; the checkout page always sends the
current time. A unit test labelled "the offline-terminal contract" asserted a
March 2026 timestamp is accepted as-is, and a comment noted "with a past
submittedAt it pays".

**What it breaks:** Expiry doesn't protect anything. A link for an old price
or a cancelled deal can still be paid at any time by anyone who has the URL,
moving money the merchant no longer expects. On the old code, a link that
expired 30 days ago was paid (200).

**Fix:** `submittedAt` is honoured only within 5 minutes before the server's
clock; older, future or unparseable values fall back to server time. The
retry case still works (pressed 2 minutes ago, expired 1 minute ago: paid).
The 30-days-expired test failed before the fix and returns 410 now; the unit
tests pin the boundary. ARCHITECTURE describes the bounded rule.

---

## 30. A slow payment lets a second customer pay the same link too ✅ Fixed

**Files:** `apps/api/src/paymentLinks/pay.ts`,
`apps/api/src/routes/paymentLinkSlowPay.test.ts` (new),
`docs/incidents/postmortem-2026-05.md` (correction)

**What's wrong:** Payment links are single-use. To pay one, the API
"reserves" the link, calls the acquirer to authorise and capture, then marks
it paid. A reservation older than 60 seconds counted as abandoned, so if the
acquirer took longer than that, a second customer could re-claim the same
link and pay it while the first payment was still going through. Both cards
were charged, and both customers were told it worked.

**Why:** The reservation timeout existed so a crashed attempt wouldn't block
a link forever, but nothing stopped a *live* slow attempt from being treated
as abandoned. FH pointed this out in a comment; MK replied "authorize+capture
is under a second. 60s can't happen."

**What it breaks:** This is the real cause of incident 2026-05-14: eight links
paid more than once, nine extra captures, 1,284.500 BD in goodwill credits.
The postmortem blamed duplicate acquirer callbacks, which can't capture
anything, but its own timeline shows the extra captures "60–70 s apart"
against the 60 s timeout, and another double came after the "fix". It was
never fixed.

**Fix:** Each pay attempt holds a Postgres advisory lock on the link (keyed by
its token) from claim to finalise; a second payer gets `409
payment_link_processing`. There is no timeout to outrun, and if the process
dies its connection closes and Postgres frees the lock, so the self-healing
still works. The new test uses a 1-second reservation and a 1.5-second
acquirer: on the old code the link was charged twice (both 200); now once,
with the second payer getting 409. The postmortem has a dated correction.

---

## 31. The negotiated discount is skipped on payment links and booked differently from settlement ✅ Fixed

**Files:** `apps/api/src/payments/capture.ts`, `apps/api/src/routes/transactions.ts`,
`apps/api/src/payments/discountAdjustment.ts` (deleted, with its test),
`db/seed/fixtures/transactions.ts`, `apps/api/src/payments/captureDiscount.test.ts` (new)

**What's wrong:** Some merchants have a negotiated discount on their fee.
Two problems:

1. **Payment links never got it.** The discount was booked by a separate
   step, `applyCaptureDiscountAdjustment`, that only the API capture route
   called. Payment-link payments call `captureTransaction` directly, so they
   were booked at the full rate. (A code comment claimed it had been "moved
   into capture.ts in July"; it hadn't.)
2. **The ledger and settlement used different formulas.** The API charged the
   MDR and then took the discount off the fee; settlement (Go) takes the
   discount off the amount and then charges the MDR. ARCHITECTURE specifies
   the second. The two round differently.

**Why:** The discount was bolted on after capture as a second transaction
(which also meant a failure there left the capture booked without its
discount), and the two services were written separately.

**What it breaks:** The merchant's ledger balance (which the balance rebuild
now reads, bug 23) disagrees with what settlement actually pays. With 275 bps
MDR and a 75 bps discount the formulas differ on 24.9% of amounts (a 1.000 BD
capture: 28 fils booked, 27 charged), and a 40 BD payment-link sale was booked
at 1,100 fils with no discount at all.

**Fix:** `captureTransaction` computes the fee once, inside the capture
transaction, with settlement's formula, so every capture path gets the
discount and books exactly what settlement charges. The separate adjustment
(and the dead `parsePromotionalDiscountFils`, which multiplied BD by 100) is
deleted. The seed uses the same formula and its self-verification passes.
New tests for both paths failed before (28 vs 27; no discount on the link)
and pass after; the full API suite has no other regressions.

---

## 46. Every refund without a reason fails, after the acquirer has already refunded ✅ Fixed

**File:** `apps/api/src/payments/processRefund.ts`

**What's wrong:** A refund created without a `reason` crashed with
`violates check constraint "chk_refunds_reason_not_null"`. This was the cause
of all 11 refund test failures once the tests ran against a real database.

**Why:** Migration 0070 set `reason DEFAULT 'unspecified'` and added
`CHECK (reason IS NOT NULL)`. A column default only applies when an INSERT
leaves the column out; `processRefund` always includes it and passed an
explicit `NULL` (`input.reason ?? null`). Reproduced in SQL: an explicit NULL
violates the check, an omitted column gets `'unspecified'`.

**What it breaks:** `processRefund` calls the acquirer *before* inserting the
refund row, in a separate transaction. So the refund money left through the
acquirer, then the insert failed and rolled back: no refund row, no ledger
entry, and the idempotency key stuck as claimed. Refunds were not reachable
at the time (`POST /v1/refunds` returned 501, bug 36), which is the only reason
this hadn't lost money.

**Fix:** The insert passes `'unspecified'` when no reason is given, matching
the migration. The 11 refund tests pass now (34/34 refund tests). The
ordering problem (acquirer before the refund is recorded) is handled with
wiring refunds up, bug 36.

---

## 47. An API test poisons the outbox and breaks the reporting tests ✅ Fixed

**File:** `apps/api/src/webhooks/archiveReplay.test.ts` (test only; no app change)

**What's wrong:** With a real database, `npm test` showed 4 reporting
failures (`null value in column "merchant_id" of relation
"merchant_daily_volume"`).

**Why:** `archiveReplay.test.ts` inserted `transaction.captured` and
`transaction.voided` events into the shared outbox with an empty `{}`
payload and never removed them. `npm test` runs the API tests before the
reporting tests, and the reporting consumer reads every outbox event, so it
hit those rows. The real producers (capture, void, settlement) always include
`merchantId`; this was a test-isolation problem, not a reporting bug.

**What it breaks:** Reporting tests fail on any database the API tests have
run against, which hides real failures. In a fresh throwaway database:
reporting 11/0; after running only `archiveReplay.test.ts`, 7/4.

**Fix:** The test's outbox rows carry a well-formed payload in the producers'
shape, for the endpoint's own merchant. In a fresh database, after
`archiveReplay.test.ts`, reporting now passes 11/0. **Local databases** that
already ran the old test still contain the bad rows; reset them with
`dropdb`/`createdb` + `npm run migrate` + `npm run seed`, or remove the
`transaction.captured`/`transaction.voided` outbox rows whose payload has no
`merchantId` (and their `webhook_deliveries`).

**Related, not fixed (design question):** by design, one malformed event
stops the whole reporting pipeline until someone removes it (the atomicity
test asserts this). No real producer can emit one today.

---

## 32. The settlement daemon closes each day about 3 hours late ✅ Fixed

**Files:** `apps/settlement/internal/scheduler/daemon.go`,
`apps/settlement/internal/settlement/window.go`,
`apps/settlement/internal/scheduler/daemon_due_test.go` (new)

**What's wrong:** The daemon should close yesterday's batches 15 minutes after
Bahrain midnight (00:15). It closed them at about 03:15. AM noticed in a code
comment ("logs show the close ~03:15 local not 00:15?? whatever, it runs").

**Why:** It took "today" from the current instant in UTC and passed that to
`BusinessDayWindow`, which reads the date in its argument's own time zone.
For the first three Bahrain hours of every day, UTC still shows the previous
date, so the daemon thought "yesterday" was the day before yesterday (already
closed, so the run did nothing) until 03:00 Bahrain. A comment above it
reasoned that "any instant within the current UTC calendar day is already
past today's Bahrain midnight", which is false for exactly those hours. FH
had flagged the same thing on `BusinessDayWindow`.

**What it breaks:** Every day's settlement, payouts and `settlement.paid`
notifications run three hours later than designed. No amounts change, but
the schedule the docs and merchants rely on is wrong, and anything that
expects the batch at 00:15 (reports, payout files) sees nothing until 03:15.

**Fix:** The date decision is a small pure function, `dueBusinessDate`, that
converts the instant to Bahrain time first (new `settlement.BusinessDateOf`).
Its test covers 00:10, 00:20, 02:59, 03:00 and 23:50 Bahrain: on the old
logic 00:20 and 02:59 picked the wrong day and 00:10 ran before the delay;
all pass now.

---

## 33. The "must be a PDF" KYC rule only checks the filename ✅ Fixed

**Files:** `apps/api/src/onboarding/kyc.ts`, `apps/api/src/app.test.ts`

**What's wrong:** Commercial registration certificates and bank letters must
be uploaded as PDFs (they come from the registry or the bank; a phone photo
isn't acceptable for review). The check looked at the file's *name*, so a
JPEG photo uploaded as `CR-2026.pdf` was accepted, and a genuine PDF named
`registration.docx` was rejected.

**Why:** The upload code already identifies the real type from the file's
bytes (`detected`) a few lines earlier, but the PDF-only rule compared the
filename instead. FH's comment pointed this out; MK replied it was "fixed in
FP-231", which it wasn't. The only test checked the backwards case (a real
PDF with a `.docx` name is rejected).

**What it breaks:** KYC reviewers approve merchants on documents that aren't
the registry/bank PDFs the rule exists to require. On the old code the new
test's JPEG-as-PDF upload was accepted (201).

**Fix:** The rule checks `detected !== "pdf"`. A photo named `.pdf` is now
rejected with `document_must_be_pdf`; a real PDF is accepted whatever its
name (the stored file's extension already comes from its bytes).

---

## 34. Credit approval tells operators apart by display name ✅ Fixed

**Files:** `apps/api/src/admin/creditApproval.ts`,
`apps/api/src/admin/creditApproval.test.ts`

**What's wrong:** Credits above 50 BD need a second operator to approve them
("two-person control"). The check that the approver isn't the requester
compared their *display names*, not their user ids.

**Why:** The handover says "the second approver is compared by admin user
id"; the code did something else. A comment claimed a same-id/different-name
test "passes, so ids are covered too"; no such test existed, and it could not
have passed.

**What it breaks:** Two different operators who share a display name can't
approve each other's credits. And an operator whose display name is changed
after requesting (there is no screen for this, but ops can edit it in the
database) can approve their own credit. Severity is low today because names
can't be changed through the app, but the control is meant to hold
regardless of names.

**Fix:** Compared by `adminUserId`. New tests (same id with a changed name is
refused; different ids with the same name are allowed) failed before and pass
after, with the existing credit route tests.

---

## 35. The merchant reconciliation page crashes on a negative gap ✅ Fixed

**Files:** `apps/web/src/format.ts`, `apps/web/src/dashboard.test.ts`

**What's wrong:** The dashboard's reconciliation page shows the gap between
the ledger and settlement. When that gap was negative, the page crashed
instead of showing it.

**Why:** The dashboard's money formatter, `bhd()`, built the amount with
`toFils(amount)`, which rejects negative numbers unless told otherwise. The
gap is `ledger − settlement − pending` and can have either sign. FH flagged
it; MK replied "amounts are never negative in the dashboard". The admin
console's own formatter already allowed negatives.

**What it breaks:** On the seeded data, Delta Marketplace's gap is −212 fils,
and rendering it throws `toFils: expected a non-negative amount, got -212`,
so the merchant sees a broken page exactly when there is something to
reconcile.

**Fix:** `bhd()` accepts signed amounts (`-0.212 BHD`). New test failed before,
passes after.

---

## 48. The dashboard's date filter uses UTC days, not Bahrain business days ✅ Fixed

**Files:** `apps/web/src/format.ts`, `apps/web/src/dashboard.test.ts`,
`apps/web/src/pages/transactions/TransactionListPage.tsx` (comment)

**What's wrong:** On the merchant dashboard's transaction list, "From 29 Oct"
started at 00:00 UTC, which is 03:00 in Bahrain. A payment at 01:30 Bahrain
time on 29 October (part of the 29 October settlement batch) was left out of
the 29 October filter and listed under the 28th.

**Why:** `dayStartIso` built `YYYY-MM-DDT00:00:00Z`. Daily windows are meant
to be Asia/Bahrain business days (ARCHITECTURE; ADR-0003 exempts only
calendar-month finance reports). YA's comment said it was 3h off; AM's reply
"fixed, uses bahrain time now" was false, and the test locked in the UTC
boundary.

**What it breaks:** A merchant reconciling a day's settlement batch against
their transaction list sees different sets of payments for the same date. No
money moves, but the numbers never match for activity between midnight and
03:00. ("To" is labelled "exclusive" on purpose; that part is fine.)

**Fix:** The filter starts at Bahrain midnight (`T00:00:00+03:00`). The test
now expects 2026-09-12 to start at 2026-09-11T21:00Z; it failed before the
fix and passes after.

---

## 41. Payment links point customers at localhost in production ✅ Fixed

**Files:** `apps/api/src/config.ts`, `apps/api/src/config.test.ts`,
`ops/.env.docker.example`, `ops/README.md`

**What's wrong:** When a merchant creates a payment link, the API returns a
`url` built from `CHECKOUT_BASE_URL`. If that setting was missing, it fell
back to `http://localhost:5173` even with `NODE_ENV=production`.

**Why:** The development default had no production check, unlike the other
required settings (webhook key, settlement token, acquirer secret).

**What it breaks:** On a hosted box that forgot the setting, every payment
link a merchant sends to a customer points at `localhost`, which on the
customer's phone is nothing. Links quietly don't work, with no error on the
server.

**Fix:** With `NODE_ENV=production` the API refuses to boot unless
`CHECKOUT_BASE_URL` is an `https://` URL; development keeps the localhost
default. Documented in the env template and the ops README. Two new config
tests failed before, pass after.

---

## 43. ~~CSV export skips rows at page boundaries~~ ⛔ Not a bug: unreachable dead code

**File:** `apps/api/src/transactions/exportCsv.ts` (`streamTransactionsExportCsv`)

**What was suspected:** `streamTransactionsExportCsv` pages through
transactions 1,000 at a time and continues from `occurred_at > last
timestamp`. Rows sharing the last row's timestamp would be skipped, and
because `pg` returns timestamps as millisecond `Date`s while Postgres stores
microseconds, the last row could also be repeated.

**Why it isn't a bug:** Nothing calls that function. The export route
(`GET /v1/transactions/export`) uses `buildTransactionsExportCsv`, a single
query with no paging, so exports can't skip or repeat rows. The defect is
real inside the function, but it can't affect anyone. (The old CHANGELOG and
`.cursorrules` both described the export wrongly: one said it streams, the
other that it loads everything; the route does the latter.)

**Action:** The unused function is removed with the other dead code (bug 39),
so it can't be wired up later with the defect inside.

---

## 44. Marketplace split payouts don't add up to the batch ✅ Fixed

**Files:** `apps/settlement/internal/splits/shares.go`,
`apps/settlement/internal/splits/allocate.go`,
`apps/settlement/internal/splits/shares_test.go`

**What's wrong:** A marketplace parent merchant can have its payout split
across sub-merchants by percentage (`merchant_split_children`). The children's
shares didn't add up to the payout: sometimes a fil more than the batch owed
was paid out, sometimes fils were left unpaid, and the batch was marked
`paid` either way.

**Why:** Each child's share was rounded on its own
(`ApplyRateFils(net, weight)`). Go had no equivalent of TypeScript's
`allocateRemainder`, which guarantees the parts sum to the whole. The unit
test only checked splits that never round (50/50, 100%). Nothing checked
that the weights add up to 100%. FH filed this as FP-250; AM closed it with
"the seed always writes 10000".

**What it breaks:** On the old code: 1,001 fils split 33.33/33.33/33.34% paid
out 1,002 (a fil the merchant never earned, taken from platform cash);
1,000 fils paid out 999 (a fil stranded in the ledger); weights adding up to
60% paid 600 of 1,001 fils and left the rest owed forever.

**Fix:** `ChildShares` uses the largest-remainder method: every child gets
the floor of its exact share and the leftover fils go to the largest
remainders, ties by position, so shares always sum to exactly the payout.
`PayoutSplitBatch` now uses it for the whole set of children at once. If the
weights don't sum to 10000 the payout is still divided fully, in proportion,
and a warning is logged (refusing would abort the daily run for every later
merchant). New test cases failed before the fix and pass after.

---

## 38. The login token is not replaced after the OTP step (session fixation) ✅ Fixed

**Files:** `apps/api/src/auth/sessions.ts`, `apps/api/src/adminAuth/sessions.ts`,
`apps/api/src/routes/auth.ts`, `apps/api/src/routes/adminAuth.ts`, and the
login helpers in five test files

**What's wrong:** Logging in is two steps: password, then OTP. The token the
browser gets after the password step became the logged-in token once the OTP
was verified, for both merchant and admin logins.

**Why:** Promoting the session only flipped `authenticated = true`; it never
issued a new token. YA logged it (FP-198, "copy the pending cookie into a 2nd
browser before OTP"); MK's answer was "the 2nd browser still needs the OTP",
which misses that the attacker is waiting for the *victim* to enter it.

**What it breaks:** If an attacker can get a pre-OTP token into a victim's
browser (session fixation), they share the victim's session as soon as the
victim completes the OTP, including an ops admin's. It needs that
cookie-planting step, which `httpOnly` and `SameSite=Lax` make hard, so
severity is moderate; replacing the token on login is standard practice.

**Fix:** Promoting a session (both kinds) generates a new token and replaces
the stored hash in the same transaction; the old token stops working and the
route sets the new one as the cookie. New tests: after OTP the cookie value
changes and the pre-OTP token gets 401, for merchant and admin; both failed
before. The test login helpers now use the cookie verify issues, as a browser
does; all 402 API tests pass.

---

## 50. Merchants are logged out 10 minutes after signing in ✅ Fixed

**Files:** `apps/api/src/routes/auth.ts` (same change as bug 38)

**What's wrong:** A merchant who logged in to the dashboard was logged out
after about 10 minutes, although their session is meant to last 12 hours.

**Why:** The login cookie is set at the password step with the short
pre-OTP lifetime (10 minutes), so the browser deletes it then. The admin
login re-sets its cookie with the full lifetime after the OTP; the merchant
login never did. MK noticed it in a comment ("merchant verify doesnt.
related to the 10 min logouts?").

**What it breaks:** Every merchant dashboard session ends after 10 minutes,
whatever the server-side session says.

**Fix:** Merchant OTP verify now sets the cookie (with the new token from
bug 38) and a `Max-Age` of the full session lifetime. The new test checks the
`Set-Cookie` header on verify; there was none before.

---

## 39. Dead code that would fail or move money wrongly if ever called ✅ Removed

Each item was checked to have no callers before removal.

| Removed | Why it was a trap |
|---|---|
| `apps/api/src/admin/inviteCode.ts` | Writes to `admin_invites`, a table no migration creates; invite codes from `Math.random` |
| `notifySettlementRefundAdjustment` (`admin/settlementClient.ts`) | Posts to `/internal/refund-adjustment`, which settlement doesn't serve; divides fils by 10 ("cents") |
| `streamTransactionsExportCsv` (`transactions/exportCsv.ts`) | Pages on `occurred_at >` a millisecond cursor: skips or repeats rows (bug 43) |
| `parsePromotionalDiscountFils`, `applyCaptureDiscountAdjustment` | Multiplied BD by 100; superseded by bug 31's fix |
| `apps/api/src/lib/decimal.ts`, `apps/api/src/fees/estimate.ts` | Two-decimal "cents" parser (bug 26); float fee estimate (bug 51) |
| Views `merchant_payable_position`, `v_unbatched_capture_events`, `v_active_api_keys` (migration 0076) | From abandoned migration 0054; wrong balance rule (bug 23), missing partial captures, ignoring rotation |

The `apps/api/src/v1/` tree is not registered either, but the handover says a
partner integrates against it, so it is left alone pending a decision (bug 37).

---

## 51. The reconciliation report invents gaps from a float fee estimate ✅ Fixed

**Files:** `apps/api/src/settlement/query.ts`, `apps/api/src/fees/estimate.ts` (deleted),
`apps/api/src/settlement/reconciliation.test.ts` (new)

**What's wrong:** The merchant reconciliation page compares the ledger with
settled batches plus captures not yet settled. That last figure was an
*estimate* (`estimateFeeFils`): floating-point, the old discount formula,
the merchant's base rate (a comment claimed a "0046 trigger" keeps it in sync
with fee schedules; no such trigger exists), and no volume tier.

**What it breaks:** A merchant whose books agree sees a non-zero "gap". On the
seeded data Delta Marketplace showed −212 fils, exactly the difference between
the estimate and the fees actually booked across its 212 unsettled captures.
The same −212 is what crashed the page (bug 35).

**Fix:** Each unsettled capture counts at the fee capture booked
(`transaction_events.metadata.feeFils`), falling back to settlement's integer
formula when absent. A new test (4.740 BD at 2.50%: booked 118, estimate 119)
showed a 1-fil gap on consistent books before, 0 after; Delta Marketplace's
gap is now 0. Alpha Retail's large gap on the seed data is unrelated and not
yet investigated.

## 36. Refunds were not built, and the helpers would have lost money if wired in as they were ✅ Fixed

**Files:** `apps/api/src/payments/processRefund.ts`,
`apps/api/src/refunds/initiateMerchantRefund.ts`, `apps/api/src/routes/refunds.ts`,
`apps/api/src/webhooks/`, `apps/api/src/settlement/query.ts`,
`apps/api/src/admin/reportingRebuild.ts`, `apps/reporting/src/consumer/applyEvent.ts`,
`apps/settlement/internal/settlement/batch.go`, `recalculate_mdr.go`,
`apps/web/src/pages/transactions/RefundDrawer.tsx`, `apps/web/src/pages/settlement/`,
`db/migrations/0077_reporting_refunds.sql`, `0078_settlement_batch_refunds.sql`

**What's wrong:** `POST /v1/refunds` returned 501. The handover calls
`processRefund` "done: it needs the route and the drawer wired". It was not
done, and nothing after it knew refunds exist:

| Where | Defect | What it would have broken |
|---|---|---|
| `processRefund` | Refundable was authorized − refunded, not captured − refunded | Refunding money never captured |
| `processRefund` | Looked up the transaction by id alone | One merchant refunding another's payment |
| `processRefund` | Validated and wrote in separate transactions | Two concurrent refunds together exceeding the capture |
| `processRefund` | Rounded the fee share of each partial on its own | Partials not summing to the fee charged |
| `processRefund` | Inserted an explicit NULL reason, which 0070's check rejects | Money gone at the acquirer with no refund row (bug 46) |
| `initiateMerchantRefund` | Passed the transaction's own merchant, not the authenticated one | The cross-merchant hole above, from the route |
| Webhooks | `refund.succeeded` was not eligible and had no envelope case | The dispatcher throwing and stalling |
| Reporting | `refund_merchant_summary` (0072) joined `t.id = r.id`, and the rollup columns the worker wrote never existed | No refund reporting; the batch-close parity check could also stall the pipeline |
| `CloseBatch` | Ignored refunds altogether | **Every refund overpaid the merchant by its net amount** |
| `RecalculateMDR` | Set net to gross − fee | Would have erased any refund netting |
| Reconciliation | Pending ignored unsettled refunds | A false gap for every refund |
| Rollup rebuild | Truncated `merchant_daily_volume` and rebuilt captures only | Refund figures vanishing on an admin rebuild |

**Fix:**

- **One transaction.** `processRefund` holds `SELECT … FOR UPDATE`, scoped to
  the authenticated merchant, from validation through the acquirer call to the
  journal, as capture does. Fee reversal is cumulative, so any number of
  partials sums to exactly the fee charged.
- **Route and UI.** `POST /v1/merchants/:merchantId/refunds` (owner/finance,
  path-scope check, `Idempotency-Key`) replaces the stub. The drawer parses BD
  with `parseBhdToFils`, works after a partial refund and shows what is still
  refundable.
- **Settlement.** `CloseBatch` claims unbatched succeeded refunds and pays
  `gross − fee − refunds + fee reversed − carry in`. Claimed rows get
  `refunds.settlement_batch_id`, and migration 0078 freezes the figures on the
  batch. A payout is never negative: a shortfall pays zero, goes in
  `carry_out_fils`, and the next batch recovers it. The ledger needs no entry
  for this, because the refund's legs already left `merchant_payable` negative;
  `merchant_balances` follows the ledger negative too. Split parents pay out the
  same netted figure across their children.
- **Claiming has no lower date bound.** Refunds up to the window's end are
  claimed, not only those inside it. A refund made while a merchant was
  suspended, on a day whose batch run was missed, or still in flight at the
  acquirer when its day closed would otherwise be paid out and never recovered.
  Captures are handled differently, because their fee and scheme line belong
  to a day, see bug 54.
- **`RecalculateMDR`** moves the batch's position by the fee difference only.
- **Reports.** Pending subtracts unsettled refunds; the batch list, batch detail
  and summary show refunds and carry; the rebuild includes refunds.

**Tests:** `batch_refund_test.go` showed on the old code a 2.000 BD refund
leaving `merchant_payable` at −1950 after payout, and now 0. It also covers carry
across several batches, which refunds are claimed, re-close and recalculation.
`reconciliation.test.ts` and `routes/transactions.test.ts` cover the rest.

**Still open:** the scheme export has no refund lines. `card_scheme_clearing`
is credited at refund time, but `scheme_export_lines` only carries captures, so
how refunds reach the scheme file needs the acquirer's answer.

## 52. Every paid batch shows as a reconciliation gap on a multi-day window ✅ Fixed

**Files:** `apps/api/src/settlement/query.ts`,
`apps/api/src/settlement/reconciliation.test.ts`

**What's wrong:** The report subtracts settled net payouts from the period's
`merchant_payable` movement. That movement also holds the payout's own ledger
legs, so a paid batch was subtracted twice.

**Why it wasn't noticed:** The one test on it, "reports gapFils === 0 for a
fully-batched period", uses a one-day window, and its helper deliberately dates
the payout legs after that window. The test passes while the real report fails.
The seed has no payout legs either.

**What it breaks:** The merchant page defaults to a 30-day window, so once
batches are paid it reports a gap equal to the payouts on books that agree.

**Fix:** The ledger figure leaves out entry groups with a `platform_cash` leg,
which only payouts have. A test with a paid batch on a 30-day window showed
ledger 0 and a gap of −9750 before, and 9750 and a zero gap after. Alpha
Retail's seed gap is unrelated: it has no payouts.

## 53. The settlement summary double-counts a transaction captured twice ✅ Fixed

**Files:** `apps/api/src/settlement/query.ts`,
`apps/api/src/settlement/reconciliation.test.ts`

**What's wrong:** `GET /v1/settlement/summary` joins transactions to their
capture events and sums `transactions.captured_fils`, a running total, once per
event. The existing test is named "…with a single capture event", the only case
where that is correct.

**What it breaks:** 10.000 BD captured in two parts reported as 20.000 BD.

**Fix:** Sum each event's own `amount_fils`, the figure batches use. The new
test showed 20000 before and 10000 after. The summary also reports refunds.

## 54. A capture its day's batch missed is never paid out ✅ Fixed

**Files:** `apps/settlement/internal/settlement/batch.go`,
`apps/settlement/internal/scheduler/daemon.go`,
`apps/settlement/internal/settlement/batch_missed_capture_test.go` (new)

**What's wrong:** `CloseBatch` takes capture events strictly inside the day's
window, and the daemon only ever attempts the most recently completed day. A
capture outside that path stayed unbatched for good.

**Why:** Two ways in. A capture's `occurred_at` is its transaction's start, and
the transaction is held across the acquirer call, so one begun before midnight
can commit after its day closed; that batch is frozen and re-running its date is
a no-op, so nothing could ever claim it. And a day no batch ran for (the merchant
was suspended, or an outage crossed more than one day) needed someone to know to
run `run-batch --date` by hand, which only a code comment mentioned.

**What it breaks:** The merchant is never paid for money that was captured. It
sits in `merchant_payable` and on reconciliation as pending, and never clears.

**Fix:** `CloseBatch` also claims an earlier capture when its own day's batch
has already closed. `RunDailyBatch` first closes and pays, under their own dates,
any earlier days holding unbatched captures and no closed batch; a suspended
merchant is still skipped until reactivated. The existing rule stands that a
capture on a day that can still close is not moved into a later batch.

On the old code a late capture left `merchant_payable` at +9750 and a suspended
merchant's day had no batch at all; both now pay out and end at 0.

**Side effects to know:** A late capture's ledger legs fall on its own day but its
batch on a later one, so a window ending between the two shows a gap until it
includes both. The first daemon run on existing data will also pay any old
unbatched captures, including those on the seed data.

---

## 55. Production has no way to get a login code 🟡 Workaround

**Files:** `apps/api/src/auth/notifier.ts`, `apps/api/src/adminAuth/notifier.ts`,
`apps/api/src/config.ts`, `apps/api/src/app.ts`, `ops/docker-compose.prod.yml`,
`ops/.env.prod.example`

**What's wrong:** With `NODE_ENV=production` the notifiers log "otp code
generated" without the code, and no email or SMS sender exists.

**What it breaks:** Nobody, merchant or admin, can finish logging in.

**Workaround:** `OTP_LOG_CODE=true` writes the code to the API's log in
production. It is off by default, is logged as a warning at boot, and never
puts the code in a response (`OTP_DEV_EXPOSE` is still refused). Read it on the
server with:

```bash
docker compose -f ops/docker-compose.prod.yml --env-file ops/.env.prod logs --since 5m api | grep 'otp code generated'
```

New tests pin the log contents for both notifiers and the merchant and admin
login responses in production; the ones needing the setting failed before it
existed.

**Side effects to know:** Anyone who can read the logs, including anything they
are shipped to, holds the second factor. Codes stay in the log after they expire
but are useless by then. Merchants can't get a code on their own: someone with
server access has to pass it on. The line carries the user's id, not their email.

**Still open:** a real email or SMS sender, after which this should be turned off.

---

## 79. The hosted dashboards can show a blank page after a rebuild ✅ Fixed

**Files:** `ops/nginx.conf`, `apps/web/src/router.tsx`,
`apps/admin/src/router.tsx`, `scripts/nginx_conf.test.ts`

**What's wrong:** After a rebuild, a browser that visited before can show a
blank white page, while a fresh browser shows the site normally. Separately, an
unknown path such as `/admin` on port 80 shows "Unexpected Application Error!
404 Not Found".

**Why:** Each build gives the files under `/assets/` new names. `index.html` had
no `Cache-Control`, so a browser could reuse its old copy without asking, and
that copy names files the rebuild removed. nginx answered those requests with
`index.html` and a 200, so the browser got HTML where it expected a script,
refused to run it, and React never started. The console says "Failed to load
module script". The routers had no catch-all route for the unknown paths.

**What it breaks:** The dashboards look down to anyone who visited before the
rebuild, until the cached page expires or they hard-refresh. `curl` and a private
window show nothing wrong, which makes it easy to miss.

**Fix:** `index.html` is sent with `no-cache`, so it is revalidated on every
load. A missing file under `/assets/` is now a 404, and the hashed files are
cached long term. Unknown paths redirect to the app's front door.

**Side effects to know:** A browser that cached `index.html` before this fix
keeps its copy until that expires, so it may still need one hard refresh. An
expired or wrong link such as `/pay` with no token now lands on the dashboard
login instead of an error page.

The fix reaches the server only on a rebuild of the `web` and `admin` images.
