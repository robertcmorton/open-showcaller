import { defineConfig } from "drizzle-kit";

/**
 * Migration generation only (`pnpm --filter @opencall/db generate`): diffs
 * src/schema.ts against the snapshots in ./drizzle and writes a numbered SQL
 * migration. Migrations are APPLIED at boot by src/migrate.ts — there is no
 * separate migrate command for operators.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
