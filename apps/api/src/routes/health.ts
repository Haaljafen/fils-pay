import type { FastifyInstance } from "fastify";
import { isReady } from "../health/state.js";

/**
 * Liveness/readiness. Built exactly per spec: liveness checks the process
 * only, readiness is checked once at boot and never re-verified against the
 * live database on subsequent polls. This is deliberate, documented base
 * platform behavior.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // GET /healthz — liveness. Never touches the database. Returns 200 as
  // long as the Node process is up and Fastify can handle a request.
  app.get("/healthz", async () => ({ status: "ok", uptimeSeconds: process.uptime() }));

  // GET /readyz — readiness. Reports whether the process ever successfully
  // connected to the database at startup. Does NOT re-check the connection
  // on every call; a database outage after a successful boot is invisible
  // here.
  // see incident 2026-05-14 — readyz flapping took the LB out. fixed by making it boot-only — MK
  // am: wasnt 05-14 the db failover one? or the paylink one. too many incidents on that date
  app.get("/readyz", async (_req, reply) => {
    if (!isReady()) {
      reply.code(503);
      return { status: "not_ready" };
    }
    return { status: "ready" };
  });

  // GET /healthz/db — deep check for a load balancer or an operator. Unlike
  // /readyz it asks the database now, bounded by a short timeout so a hung
  // connection answers 503 instead of hanging the probe. /readyz stays
  // boot-only on purpose (a flapping readiness probe once pulled every
  // instance out of rotation), so wire this one to alerting, or to the
  // balancer with a "N consecutive failures" threshold.
  app.get("/healthz/db", async (_req, reply) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        app.db.query("SELECT 1"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("db_probe_timeout")), 2_000);
        }),
      ]);
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "db_unavailable" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
