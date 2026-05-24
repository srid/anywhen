// The Kysely instance returned here is private to storage/. Outside this
// directory, depend on store factories (`taskStore`, future ones) — not on
// the Kysely handle directly. This keeps the storage seam at the store
// interface (which `router.ts` consumes), so swapping driver, dialect, or
// query layer stays a within-`storage/` change.

import { Database as BunDatabase } from "bun:sqlite";
import { mkdirSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BunSqliteDialect } from "@meck93/kysely-bun-sqlite";
import { FileMigrationProvider, Kysely, Migrator } from "kysely";
import type { Database } from "./schema";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// The SQLite filename inside `stateDir`. Private to this module — callers
// that need the absolute path receive it from `openDb`'s return value, so
// no other site reconstructs `<stateDir>/anywhen.db`.
const DB_FILENAME = "anywhen.db";

/**
 * Open the app DB at `<stateDir>/anywhen.db` and apply any pending
 * migrations before returning. Returns the Kysely handle alongside the
 * resolved DB path so callers (e.g. the runtime-info footer) don't
 * independently reconstruct the same join.
 */
export async function openDb(stateDir: string): Promise<{ db: Kysely<Database>; dbPath: string }> {
  mkdirSync(stateDir, { recursive: true });
  const dbPath = join(stateDir, DB_FILENAME);
  const sqlite = new BunDatabase(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");

  // FKs off across the migration window per SQLite's prescribed table-
  // rebuild procedure (sqlite.org/lang_altertable.html#otheralter, step 1).
  // The hazard the wrapper closes: a migration that does
  //   CREATE TABLE tasks_new (... parent_id REFERENCES tasks(id) ON DELETE CASCADE ...);
  //   DROP TABLE tasks;
  // with FKs on triggers an implicit DELETE FROM tasks during the drop,
  // and that delete cascades through the brand-new FK to wipe every child
  // row in tasks_new. We hit this exact bug once (see the data-loss
  // postmortem PR); centralizing the toggle here makes every future
  // table-rebuild migration safe by construction.
  //
  // `PRAGMA foreign_keys` cannot toggle inside a transaction, and Kysely
  // wraps each migration in one, so the toggle has to straddle the
  // migrator call rather than live inside any migration body.
  sqlite.exec("PRAGMA foreign_keys = OFF;");

  const db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: sqlite }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path: { join },
      migrationFolder: MIGRATIONS_DIR,
    }),
  });

  try {
    const { error } = await migrator.migrateToLatest();
    if (error) {
      // Migrator returns the error rather than throwing; surface it so a
      // bad migration on startup fails loudly rather than producing a Kysely
      // instance pointing at a half-migrated DB.
      throw error instanceof Error ? error : new Error(String(error));
    }

    // After the migration window closes, ask SQLite to enumerate any
    // dangling references the relaxed FK enforcement let through. An
    // empty result is the all-clear. A non-empty result is a migration
    // bug — fail loudly rather than start serving with a corrupt graph.
    const violations = sqlite.query("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`Foreign-key violations after migration: ${JSON.stringify(violations)}`);
    }
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON;");
  }

  return { db, dbPath };
}

/** Resolve `ANYWHEN_STATE_DIR` from the environment and ensure it exists. */
export function resolveStateDir(): string {
  const fromEnv = process.env.ANYWHEN_STATE_DIR;
  if (!fromEnv) {
    throw new Error(
      "ANYWHEN_STATE_DIR is not set. The dev shell exports it; under nix run it's set by the wrapper.",
    );
  }
  mkdirSync(fromEnv, { recursive: true });
  return fromEnv;
}
