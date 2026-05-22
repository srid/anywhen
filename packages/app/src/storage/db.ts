import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA = await Bun.file(new URL("./schema.sql", import.meta.url)).text();

export function openDb(stateDir: string): Database {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "anywhen.db");
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function resolveStateDir(): string {
  const fromEnv = process.env.ANYWHEN_STATE_DIR;
  if (!fromEnv) {
    throw new Error(
      "ANYWHEN_STATE_DIR is not set. The dev shell exports it; under nix run it's set by the wrapper.",
    );
  }
  // Touch the directory so any downstream path resolution sees it exists.
  mkdirSync(dirname(join(fromEnv, "anywhen.db")), { recursive: true });
  return fromEnv;
}
