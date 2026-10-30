# ops/

Local development stack for FilsPay: Postgres plus the three services that
talk to it directly (apps/api, apps/settlement, apps/reporting). The hosted
demo instance uses the same compose file with its own `ops/.env.docker`.

## Quick start

```
cp ops/.env.docker.example ops/.env.docker   # once; then set SETTLEMENT_INTERNAL_TOKEN
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml run --rm seed
docker compose -f ops/docker-compose.yml up api settlement reporting
```

apps/web and apps/admin aren't part of this compose file — they're plain
Vite dev servers that talk to apps/api over HTTP (`npm run dev` inside
each package), not services with their own database connection.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | the stack |
| `.env.docker.example` | template for `.env.docker` (committed, no secrets) |
| `.env.docker` | secrets and `NODE_ENV`, loaded by api, settlement, reporting and seed via `env_file:` (gitignored) |
| `Dockerfile.node` | image for api, reporting, migrate and seed (`node:22-slim`, dev dependencies included because services run through `tsx`) |
| `Dockerfile.go` | multi-stage build of `apps/settlement`; final image is the static binary on distroless (~20 MB) |
| `../.dockerignore` | keeps `.git`, `node_modules`, `.env*` and `ops/.env.docker` out of every image |

## Database

Every service, plus the one-off `migrate`/`seed` jobs, connects with the
same `filspay` role and the same `DATABASE_URL`
(`postgres://filspay:filspay_dev_password@postgres:5432/filspay?sslmode=disable`).
One role keeps local setup to a single password instead of hand-rolling
per-service grants for a stack this size. `sslmode=disable` is safe here:
Postgres and every service run on the same Docker Compose bridge network,
which never carries traffic outside the host, so there's no untrusted hop
for a connection to cross.

The settlement worker can be given a second connection string,
`PGCONN_SETTLEMENT`. When set, it overrides `DATABASE_URL` for that service.

To reset the local database to a clean, freshly-seeded state, re-run the
`seed` job above. `db/seed/index.ts` truncates its fixture tables with
`CASCADE` (which also empties every table that references them) and
regenerates them. It only runs against `localhost` or the compose `postgres`
host, and never with `NODE_ENV=production`; `SEED_ALLOW_RESET=1` overrides
the host check for a database you are sure is disposable.

## Required settings per service

| Service | Needs | Where it comes from in compose |
|---|---|---|
| api | `DATABASE_URL`, `SETTLEMENT_INTERNAL_URL` | `environment:` |
| api, seed | `WEBHOOK_SECRET_ENCRYPTION_KEY` | `.env.docker`; optional in development (a fixed dev key is used) |
| api | `ACQUIRER_CALLBACK_SIGNING_SECRET`, `NODE_ENV` | `.env.docker` |
| api | `CHECKOUT_BASE_URL` (https, required in production) | `.env.docker` |
| api, settlement | `SETTLEMENT_INTERNAL_TOKEN` (same value on both) | `.env.docker`; settlement exits at boot without it |
| settlement | `DATABASE_URL` | `environment:` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

With `NODE_ENV=production` the api won't boot without
`WEBHOOK_SECRET_ENCRYPTION_KEY`. Generate one per environment with
`openssl rand -base64 32` and keep it: changing it makes every stored webhook
secret undecryptable.

## Resource sizing

The hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk; the API container is
limited to 512 MB. Postgres defaults are fine at this size. The settlement
image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try
