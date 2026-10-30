# Findings report (team Shecure)

For each problem: **what** is wrong, **why** (root cause), **impact**, **fix**. The partner's list of
bugs found while getting the stack running is in `README.md` (47 items, same format). This report
covers the rest, plus the notes that were wrong and the capacity numbers.

## A. Security

| # | What / root cause | Impact | Fix |
|---|---|---|---|
| S1 | **2FA bypass.** The session created at the password step was accepted as authenticated by `lookupSession`, which never checked the OTP had been verified. | Anyone with a password skips the second factor. | Session lookup requires `authenticated = true`. |
| S2 | **Predictable OTPs / invite codes / link tokens.** `Math.random` (not a CSPRNG) produced bearer secrets. | Codes can be predicted from a few outputs. | `crypto.randomInt` helpers in `lib/random.ts`. |
| S3 | **Cross-tenant login.** After the password step the verify step re-looked the user up by email only, so two merchants sharing an email swapped sessions. | A login to merchant B returned a session for merchant A. | Use the user from the password step. |
| S4 | **OTP attempt cap raced.** Attempts were counted read-then-write, so parallel guesses all passed; "resend" reset the budget. | Brute-forcing a 6-digit code. | Atomic `UPDATE ... attempt_count < max_attempts RETURNING`; resend carries the count. |
| S5 | **Reporting IDOR.** `resolveReportMerchantId` allowed any merchant that is a split child of *anyone*. | Any merchant reads any marketplace sub-merchant's transactions. | Require `parent = caller AND child = requested`. |
| S6 | **Payment link cancel IDOR.** `cancelPaymentLink` took only the link id. | A merchant cancels another merchant's links. | Scope by `merchant_id`. |
| S7 | **`/v1/reporting/export-summary` had no auth hook.** | Crashed with 500 and, if reached, read without identity. | `requireMerchantAuth`. |
| S8 | **CSV formula injection.** Customer-controlled `reference` written raw into the export. | `=HYPERLINK(...)` runs when finance opens the file. | Prefix cells starting `= + - @ tab CR` with `'`. |
| S9 | **Committed secret.** `ops/.env.docker` is tracked; `.gitignore` listed only `.env`. A comment claimed it matched. | Signing secret in git history. | Ignore `.env.*`; secret must be rotated. |
| S10 | **Secrets baked into images.** `COPY . .` with a dockerignore that only excluded `.git`/`node_modules`. | Anyone with the image has the prod secrets. | Dockerignores exclude all `.env*` and `ops/.env.prod`; verified no image contains the file. |
| S11 | **Postgres published on 0.0.0.0** with the dev password. | Database reachable from the internet on a hosted box. | Bound to `127.0.0.1` (dev compose); not published at all in prod. |
| S12 | `PGCONN_SETTLEMENT` **overrode** `DATABASE_URL` although docs say it only applies when `DATABASE_URL` is unset. | A stray variable points the payout worker at the wrong database. | `DATABASE_URL` wins. |

Also fixed by the partner and re-verified: SSRF, impersonation role and write access, callback
signatures, key rotation, KYC PDF check, webhook signing bytes (README #11-#14, #28, #33).

## B. Money and settlement

| # | What / root cause | Impact | Fix |
|---|---|---|---|
| M1 | **Duplicate `settlement.paid`.** The enqueue relied on a `NOT EXISTS` guard and a comment claiming a unique index that never existed. | Two scans (daemon + CLI) enqueue twice. | Unique index (migration 0075) + `ON CONFLICT DO NOTHING`. |
| M2 | **Duplicate payout instructions.** `settlement_payout_disbursements` was written as a pre-delivery effect of every webhook delivery: once per endpoint, again on retry. | A batch can be instructed to the payout rail several times. | Unique per batch + idempotent insert. |
| M3 | **MDR recalculation rewrote paid batches** (`status <> 'open'`) and used today's flat rate, ignoring fee schedules. | Batch no longer matches what was paid; the adjustment is never netted. | Only `closed` batches; rate resolved per event from `fee_schedules`. |
| M4 | **One merchant failing aborted the whole daily run** (`return` on first error). | Every merchant sorted after it is never settled; daemon retries forever. | Collect errors, continue, return the joined error. |
| M5 | **Credits backdated.** The ledger rows were stamped at the operator-chosen effective date. | Money booked into a closed reconciliation period. | Ledger at `now()`; effective date is metadata. |
| M6 | **Adjustment CSV could be applied twice** (`original_filename` was not unique). | A double click moves real money twice. | SHA-256 of normalised rows, unique index (0078), 409 `duplicate_import`. |
| M7 | **"Adjust balance" edited only the cache.** | The next rebuild erases it; no double-entry trail. | Route calls the journaled variant. |
| M8 | **Webhook deliveries not claimed.** Two replicas selected the same due rows. | Duplicate deliveries and duplicate payout effects. | `FOR UPDATE SKIP LOCKED` + lease on `next_attempt_at`. |
| M9 | **Transaction helper masked errors.** A failed `ROLLBACK` replaced the real error and returned a broken connection to the pool. | Wrong error reported, poisoned pool. | Original error rethrown, client destroyed. |
| M10 | **Reporting consumer read its cursor without a lock.** | Second worker / catch-up CLI double-counts every rollup. | `SELECT ... FOR UPDATE` on the cursor row. |
| M11 | **Lifetime payout estimate was a `REAL`** (float32). | Drops fils above 16,777.216 BD. | `BIGINT` (migration 0077). |

Money bugs fixed by the partner and re-verified (README #21-#26, #31, #44, #51-#54): float32 net payout,
32-bit volume counter, balance rebuild from the wrong source, scheme residue and rounding, CSV 10x,
discount skipped on payment links, split payouts, reconciliation float estimate.

## C. Admin and UI

| # | What / root cause | Impact | Fix |
|---|---|---|---|
| A1 | **Bulk KYC approve had no status filter** and bypassed `recordKycReviewInTx`. | Rejected merchants re-approved; no review trail. | Only `under_review`, through the one allowed writer. |
| A2 | **"Recompute statuses" also cleared `test_mode`.** | A sandbox merchant became live (and settled) with no review. | Side effect removed. |
| A3 | **Scheduled key revocation (`revoke_after`) was never enforced** and no job existed. | Keys meant to expire stay valid. | Checked at verification time. |
| A4 | **Dashboard `bhd()` threw on negatives.** | Pages with a negative gap/refund blank. | `allowNegative: true`. |
| A5 | Dashboard times in browser zone; settlement days are Bahrain. | Times disagree with batches by up to 3 h. | Rendered in `Asia/Bahrain`. |
| A6 | Settlement batch page "progress bar" = gross fils / 10000 (float, meaningless). | Misleading UI. | Removed. |
| A7 | `/` had no route: the site's front door was a router 404. | First impression is an error page. | Redirect to `/dashboard`. |

## D. Notes that were wrong (checked, not trusted)

| Claim | What we found |
|---|---|
| CLAUDE.md: "1 BD = 100 cents", `Math.random` fine for OTPs, never edit tests, Go/docs always right | False. ADR-0001 and `packages/money` say 1000 fils; OTPs are bearer secrets; tests that pin a bug must change; docs and Go disagreed with each other. File rewritten to point at AGENTS.md. |
| "Go is the reference for fees" | Capture (TS) and settlement (Go) disagreed (14 vs 15 fils on the same input, discount ignored on payment links). Aligned to one formula. |
| `.env` in `.gitignore` "matches `.env.docker`" | It does not. |
| ADR-0004: the console rebuild can read "settled data" instead of the ledger | The view summed scheme gross: it replaced every balance with lifetime gross. |
| "outbox has a unique index on (event_type, aggregate_id)" | No such index existed. |
| "re-upload is blocked by the unique original_filename" | Not unique. |
| "admin rotation revokes the old key (line 47)" | It did not. |
| "`INTEGER` is 64-bit" (platform volume) | int4: wraps at 2,147,483,647 fils; the tier threshold is 2,000,000,000. |
| "0054-0056 are unmerged" | They exist; 0054/0055 reference tables/columns that do not. Fixed. |
| Checked and left alone: 403 on another merchant's API-key path; 3-byte JPEG magic; `analytics.ts` Bahrain date; `withTransaction` isolation. | Not bugs. |

## E. Capacity (measured on the hosted Shecure server, 1 vCPU / 2 GB, API 0.5 vCPU / 512 MB)

Scenario: authorize + capture with an API key, from a laptop in Bahrain (about 30 ms away).

| Concurrent shoppers | Checkouts/s | p95 latency |
|---|---|---|
| 8 | ~8 | ~1.5 s |
| 24 | ~17 | ~2.3 s |
| 48 | ~21 | ~3.0 s |

**Estimate: about 8-10 concurrent shoppers stay under ~1.5 s p95; the server saturates near 20 checkouts/s
(~40 requests/s).** Bottleneck found: the API's DB pool was 5 and a capture holds a connection through the
acquirer call (100-400 ms), capping it near 10/s with the CPU ~90% idle; raising `PG_POOL_MAX` to 30 doubled
throughput. Overload: nginx caps concurrent `/v1` requests (503 with `Retry-After`), containers restart
automatically (`restart: unless-stopped`), Postgres data lives in a named volume. Known limit: a self-signed
certificate on the IP; production mode never shows OTP codes (no email/SMS delivery exists).
