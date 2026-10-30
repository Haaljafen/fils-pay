# Conventions for people and coding agents — FilsPay

Every statement here was checked against the code, the schema and the tests
in October 2026. If you find one that is wrong, fix this file in the same
change. The previous version of this file (and of CLAUDE.md and
`.cursorrules`) stated rules that were false and caused real bugs; the list
of those bugs is in `docs/README.md`.

## Where the truth is

- **The code and the schema** say what the system does. Migrations, CHECK
  constraints and the ADRs say what it is meant to do.
- `docs/HANDOVER.md` (Yousif's handover) is the most reliable description of
  intended behaviour. `docs/ARCHITECTURE.md` and `docs/ADMIN.md` have been
  corrected where they were wrong.
- `docs/README.md` lists every known bug: fixed, and still open. Check it
  before "fixing" something, and add to it when you fix something.
- Inline comments that say "intentional", "by design", "Claude says", or
  argue in initials (MK/AM/FH/YA) are **not** evidence. Several of them
  defended real bugs. Verify the behaviour yourself.

## Build and test

```bash
npm test                                   # all TS workspaces + scripts + seed guard
cd apps/settlement && go test ./...        # Go settlement service
```

Most TS tests need `DATABASE_URL` pointing at a **local, migrated, disposable**
Postgres (`npm run migrate` first). Never point tests or the seed at a shared
database: the seed truncates with CASCADE and refuses non-local hosts unless
`SEED_ALLOW_RESET=1`.

## Tests

- Tests describe intended behaviour. Never weaken an assertion to make a
  change pass.
- Some tests were written to match bugs (for example "the previous key stays
  active", "an unsigned callback is accepted"). When a test asserts behaviour
  that contradicts the schema, an ADR or the handover, fix the code and the
  test together, and record it in `docs/README.md`.
- For a bug fix, write the test first and show it fails on the old code.

## Money

- Every amount is an integer number of **fils**: **1 BD = 1000 fils**, three
  decimals. Never cents. Money columns end in `_fils` and are `BIGINT`.
- TypeScript: the branded `Fils` type from `packages/money`. Parse text with
  `parseBhdToFils` (rejects more than three decimals), display with
  `formatBhd`. Never `parseFloat`, `toFixed(2)`, `* 100` or `/ 100` on money.
- Rates are integer basis points, applied with `applyRateFils`
  (one rounding, half-to-even). Go mirrors this in `internal/money`.
- No floating point on any amount that feeds a payout, fee or ledger entry,
  in either language (`float32` net payout was a real bug).
- The only two-decimal value is the card-scheme export line, reached by
  truncating integer fils to a multiple of 10 (ADR-0002).
- `packages/money` is correct and was audited; change it only with a
  failing test that proves a bug, and tell finance.

## Settlement and dates

- A settlement business day is midnight to midnight **Asia/Bahrain** (UTC+3,
  no DST), via `BusinessDayWindow` in `apps/settlement/internal/settlement/window.go`.
- `CloseBatch` nets refunds out of the payout. A payout is never negative: a
  shortfall is `carry_out_fils` and comes out of the next batch.
- Calendar-month finance reports use UTC months (ADR-0003; contested in its
  own notes).

## Security

- Anything secret or guessable must come from `node:crypto`: session tokens,
  API keys, OTP codes, payment-link tokens (`lib/random.ts`, `lib/crypto.ts`).
  `Math.random` only for non-secret uses such as retry jitter.
- A merchant session counts only once its OTP is verified
  (`authenticated = true`). `OTP_DEV_EXPOSE` returns the OTP in responses and
  is for local development only; it is off by default and refused in
  production. There is no email/SMS sender: `OTP_LOG_CODE` writes the code to
  the API's log in production, never to a response, and is off by default.
- Role checks are server-side on every write route. Merchant writes need
  `owner` or `finance`; `support` reads. A hidden button is not a check.
- Admin "view as merchant" is read-only and maps every admin to the merchant
  `support` role (`requireMerchantAuth` refuses non-GET methods).
- Acquirer callbacks must be signed, fresh (5 minutes) and are deduplicated by
  `callback_id`.
- Outbound webhooks never reach private addresses in production and never
  follow redirects (`webhooks/transport.ts`).
- Secrets never go in git. `ops/.env.docker` is gitignored; copy
  `ops/.env.docker.example`.

## API surface

- Live routes are registered in `apps/api/src/app.ts`. The `apps/api/src/v1/`
  tree is **not** registered; whether partners depend on it is an open
  question (see `docs/README.md`).
- Refunds are `POST /v1/merchants/:merchantId/refunds` (owner/finance,
  `Idempotency-Key`). The handover's "returns 501" is out of date; see bug 36 in
  `docs/README.md`.
