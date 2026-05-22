-- PR 1 schema. New columns widen this in later PRs; `position` is gap-
-- allocated (initial 100, 200, 300…) so sibling reorder is a one-row update.
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('todo', 'done')),
  position   REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks (parent_id, position);
