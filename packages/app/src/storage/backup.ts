// Rolling on-disk backup of the task tree. Runs server-side in the
// background — once per `BACKUP_INTERVAL_MS`, snapshots the live tasks into
// `<stateDir>/backups/anywhen-backup-<iso>.json`, then deletes any backup
// older than `BACKUP_RETENTION_MS`. The file shape is `BackupSchema` from
// shared/schemas.ts, byte-identical to what `api.export` returns, so any
// saved file can be fed back through `api.import` unchanged.
//
// Motivation: the explicit Export button is opt-in and easy to forget.
// A rolling on-disk copy turns "wtf, I just lost my Juspay subtree" into
// "restore the most recent file in `state/backups/`".

import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeBackup, type Task } from "../shared/schemas";

// Hourly cadence × 7-day retention ≈ 168 files at steady state. Each file
// is the full task set in JSON (a few KB for a typical tree, well under a
// MB for an extreme one), so the directory stays small enough that the
// per-tick `readdirSync` + `statSync` loop is fine without a manifest.
export const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
export const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const BACKUP_PREFIX = "anywhen-backup-";
const BACKUP_SUFFIX = ".json";

// Filesystem-safe ISO instant: replace `:` and `.` with `-` so the result
// is a single valid path component on every OS, and still lexicographically
// sortable in the same order as chronologically (the time fields keep their
// fixed widths).
const filenameFor = (now: Date): string =>
  `${BACKUP_PREFIX}${now.toISOString().replace(/[:.]/g, "-")}${BACKUP_SUFFIX}`;

/**
 * Snapshot the current task set into `<backupDir>/anywhen-backup-<iso>.json`.
 * Creates the directory if absent. Returns the absolute path written.
 */
export async function writeBackup(
  tasks: Task[],
  backupDir: string,
  now: Date = new Date(),
): Promise<string> {
  mkdirSync(backupDir, { recursive: true });
  const path = join(backupDir, filenameFor(now));
  await writeFile(path, JSON.stringify(makeBackup(tasks, now), null, 2), "utf8");
  return path;
}

/**
 * Delete backup files whose mtime is older than `retentionMs`. Ignores files
 * that don't match the backup naming convention so unrelated artifacts the
 * operator might drop next to the backups aren't collateral. Returns the
 * absolute paths deleted. A missing `backupDir` is a no-op; any other FS
 * error propagates so the scheduler's outer catch logs it (silently
 * swallowing permission/IO errors would let retention stall and disk
 * accumulate forever).
 */
export function pruneBackups(
  backupDir: string,
  retentionMs: number,
  now: Date = new Date(),
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(backupDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const cutoff = now.getTime() - retentionMs;
  const deleted: string[] = [];
  for (const name of entries) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(BACKUP_SUFFIX)) continue;
    const p = join(backupDir, name);
    // Guard stat/unlink against the entry-deleted-mid-iteration race — a
    // concurrent prune (e.g. an operator running cron alongside the
    // scheduler) can remove the file between readdir and stat. ENOENT here
    // is benign; anything else is a real I/O problem and propagates.
    try {
      if (statSync(p).mtimeMs < cutoff) {
        unlinkSync(p);
        deleted.push(p);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return deleted;
}

/**
 * Start the rolling-backup scheduler. Writes once immediately so a
 * container restart isn't N minutes away from any rollback target, then
 * sleeps `intervalMs` between ticks. The `async while` shape encodes
 * "ticks never overlap" structurally — the next iteration cannot start
 * until the previous tick's `await` chain completes — rather than via a
 * mutable `inFlight` flag. Failures are logged and the loop continues; a
 * transient disk-full shouldn't kill the loop.
 */
export function startBackupScheduler(
  snapshot: () => Promise<Task[]>,
  backupDir: string,
  opts: { intervalMs?: number; retentionMs?: number } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? BACKUP_INTERVAL_MS;
  const retentionMs = opts.retentionMs ?? BACKUP_RETENTION_MS;
  let stopped = false;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  void (async () => {
    while (!stopped) {
      try {
        const tasks = await snapshot();
        await writeBackup(tasks, backupDir);
        pruneBackups(backupDir, retentionMs);
      } catch (err) {
        console.error("[backup] tick failed:", err);
      }
      if (stopped) return;
      await sleep(intervalMs);
    }
  })();
  return () => {
    stopped = true;
  };
}
