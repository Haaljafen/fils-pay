# FilsPay submission: Shecure

Working notes for the submission document (`Shecure_FilsPay_Submission.pdf`).
Facts are taken from the repo; items marked **TODO** are not yet known.

## Cover page

- **Team name:** Shecure
- **Team members and ownership:** TODO (roster and who owned what)
- **Live deployment:** https://shecure-8npr-hajaraljafen29.dilmune.app
  - Checkout, merchant dashboard, admin console and public API paths under this domain: TODO
  - Status at last check (2026-10-30): HTTP 521 on `/`, `/healthz`, `/readyz`, `/v1/health`, so the origin server was not reachable.
- **Public fork:** https://github.com/Haaljafen/fils-pay (public, fork of `MJ5-byte/fils-pay`)
- **Last commit before the deadline:** TODO (update after the final push; the ID changes with each commit)

## 1. Summary

See `docs/FINDINGS.md` (sections A–F) and `docs/README.md` (bugs 1–92).

## 2. Architecture and deployment

- Services: `apps/api` (Fastify, TypeScript), `apps/settlement` (Go), `apps/reporting` (TypeScript), Postgres 16, and the `apps/web` and `apps/admin` Vite apps. See `docs/ARCHITECTURE.md`.
- Compose: `ops/docker-compose.yml` (local) and `ops/docker-compose.prod.yml` (hosted). TODO: confirm the prod services, ports and redeploy command.
- Secrets: `ops/.env.docker`, gitignored, created from `ops/.env.docker.example`.
- Health checks: `GET /healthz` (process up) and `GET /readyz` (checked at boot only). See `docs/RUNBOOK.md`.
- Restart policy: `restart: unless-stopped`.
- Redeploy without interrupting settlement: TODO. `settlement run-batch` is safe to repeat.

## 3. Capacity

- Estimate: about 8–10 concurrent shoppers under ~1.5 s p95; saturates near 20 checkouts/s (~40 requests/s). Source: `docs/FINDINGS.md` section E.
- Load test: k6, `loadtest/k6/checkout.js` (localhost by default; needs `OTP_DEV_EXPOSE=true`).
- Other measurements: `docs/perf/fp-209-loadtest-2026-09.md`.
- Bottleneck: DB pool size of 5 with connections held through the acquirer call; `PG_POOL_MAX=30` doubled throughput.
- Overload: nginx caps concurrent `/v1` requests (503 with `Retry-After`) and rate-limits logins per IP.
- TODO: fresh measurement against the hosted domain.

## 4. Findings report

- Entries: `docs/FINDINGS.md`. TODO: add "how found and reproduced", "how verified" and "effect on existing data" to each entry.
- Open risks:
  - Bug 55: no real OTP sender (`OTP_LOG_CODE` workaround).
  - Bug 90: sweep only partly finished.
  - Balance adjustments are lost on rebuild (meeting 2026-09-17, option A).
  - Bug 7: the old sandbox signing secret remains in git history.
  - `apps/api/src/v1/` partner API is unregistered.

## 5. UI and UX changes

Commits 6a64c44, 6fb7dfc, ed18190. TODO: before/after screenshots and any recording.

## 6. AI usage

- Setup in the repo: `CLAUDE.md` (imports `AGENTS.md`), `AGENTS.md`, `.cursorrules`, `loadtest/k6/checkout.js`, `e2e/`, `playwright.config.ts`. TODO: confirm and add the `.claude` settings and permission rules.
- Transcript excerpts: TODO (three, one where the AI was wrong). Candidate: the old CLAUDE.md claims recorded in `docs/FINDINGS.md` section D.
