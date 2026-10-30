#!/usr/bin/env -S npx tsx
/**
 * Nightly janitor: a hold that's never captured or released stays 'active'
 * past its expires_at forever — authorize.ts inserts one, capture.ts/void.ts
 * release one, and nothing else ends one. This flips every such hold to
 * 'expired'. Holds are never deleted: they are part of the transaction's
 * history.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/expire_holds.ts
 */
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/** One statement, so a hold captured or released while this runs is either
 *  already non-'active' (and skipped) or still 'active' and genuinely
 *  expired — there is no SELECT-then-write window. */
export const EXPIRE_HOLDS_SQL = `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at < now()`;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("expire_holds: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(EXPIRE_HOLDS_SQL);
    console.log(`expire_holds: expired ${result.rowCount ?? 0} hold(s)`);
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
