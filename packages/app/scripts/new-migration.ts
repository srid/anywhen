// Scaffolds a new migration file under src/storage/migrations/. Stand-in
// for `kysely-ctl migrate make` — we don't pull kysely-ctl because the
// runtime Migrator + this 30-line scaffolder is already the full feature.
// Invoke via `just new-migration <short_name>`.

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2];
if (!name) {
  console.error("usage: new-migration <short_name>   (e.g. add_tags_column)");
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error("name must be snake_case ([a-z][a-z0-9_]*), got:", name);
  process.exit(1);
}

const ts = new Date()
  .toISOString()
  .replace(/[-:T.Z]/g, "")
  .slice(0, 14);
const filename = `${ts}_${name}.ts`;
const migrationsDir = join(import.meta.dirname, "..", "src", "storage", "migrations");
const target = join(migrationsDir, filename);

if (existsSync(target)) {
  console.error("already exists:", target);
  process.exit(1);
}

const template = `// See ../README.md for the migration convention — db.schema.* + bounded
// backfill only; no network, no app imports, no external state.

import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // TODO: schema change for ${name}
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // TODO: inverse of up — keep accurate even though runtime never calls it
}
`;

writeFileSync(target, template);
console.log("created", target);
