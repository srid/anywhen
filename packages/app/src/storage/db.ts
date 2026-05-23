// The Kysely instance returned here is private to storage/. Outside this
// directory, depend on store factories (`taskStore`, future ones) — not on
// the Kysely handle directly. This keeps the storage seam at the store
// interface (which `router.ts` consumes), so swapping driver, dialect, or
// query layer stays a within-`storage/` change.

import { Database as BunDatabase } from "bun:sqlite";
import { promises as fs } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BunSqliteDialect } from "@meck93/kysely-bun-sqlite";
import { FileMigrationProvider, Kysely, Migrator } from "kysely";
import type { Database } from "./schema";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function openDb(stateDir: string): Promise<Kysely<Database>> {
  mkdirSync(stateDir, { recursive: true });
  const sqlite = new BunDatabase(join(stateDir, "anywhen.db"));
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

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

  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    // Migrator returns the error rather than throwing; surface it so a
    // bad migration on startup fails loudly rather than producing a Kysely
    // instance pointing at a half-migrated DB.
    throw error instanceof Error ? error : new Error(String(error));
  }
  // results is set whenever the migrator ran; treat the unset case as a
  // configuration bug (provider returned nothing) rather than silent success.
  if (!results)
    throw new Error("Kysely migrator returned no results — check FileMigrationProvider config");

  return db;
}

export function resolveStateDir(): string {
  const fromEnv = process.env.ANYWHEN_STATE_DIR;
  if (!fromEnv) {
    throw new Error(
      "ANYWHEN_STATE_DIR is not set. The dev shell exports it; under nix run it's set by the wrapper.",
    );
  }
  mkdirSync(dirname(join(fromEnv, "anywhen.db")), { recursive: true });
  return fromEnv;
}
