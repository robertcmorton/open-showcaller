import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
}

/**
 * DATABASE_URL set → node-postgres; otherwise an embedded PGlite database in
 * `.pglite/` at the repo root (dev convenience — no Docker required).
 */
export async function createDb(databaseUrl = process.env.DATABASE_URL, pgliteDir = ".pglite"): Promise<DbHandle> {
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    return {
      db: drizzlePg(pool, { schema }),
      driver: "postgres",
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite(pgliteDir);
  return {
    db: drizzlePglite(pglite, { schema }),
    driver: "pglite",
    close: () => pglite.close(),
  };
}

export { schema };
