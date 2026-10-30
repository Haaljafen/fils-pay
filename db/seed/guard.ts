/**
 * The seed starts with `TRUNCATE ... RESTART IDENTITY CASCADE`, which empties
 * every seed table and, through CASCADE, every table that references one of
 * them. That is only ever acceptable on a disposable local database, so the
 * seed refuses to run anywhere else unless the operator opts in explicitly.
 */

/** localhost variants, plus `postgres`, the database service name in ops/docker-compose.yml. */
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export interface SeedTarget {
  connectionString: string | undefined;
  host: string | undefined;
}

/** Throws unless resetting the database at `target` is safe. */
export function assertSeedTargetIsResettable(target: SeedTarget, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === "production") {
    throw new Error("seed: refusing to reset the database while NODE_ENV=production");
  }

  const host = databaseHost(target, env);
  if (LOCAL_DATABASE_HOSTS.has(host) || env.SEED_ALLOW_RESET === "1") {
    return;
  }

  throw new Error(
    `seed: refusing to reset the database on host "${host}". The seed truncates every seed table ` +
      "(and, via CASCADE, every table that references them). Set SEED_ALLOW_RESET=1 only if this " +
      "database is disposable.",
  );
}

/** Resolves the host the same way `pg` does: connection string first, then explicit host, then PGHOST. */
function databaseHost(target: SeedTarget, env: NodeJS.ProcessEnv): string {
  if (target.connectionString) {
    return new URL(target.connectionString).hostname || "localhost";
  }
  return target.host ?? env.PGHOST ?? "localhost";
}
