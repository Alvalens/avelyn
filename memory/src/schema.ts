// External-content FTS5 tables (content='core_memories' etc.) so the indexed
// text isn't duplicated on disk — triggers below keep the index in sync on
// every write, so callers never have to remember to update it separately.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS core_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('identity','preference','relationship','project','fact')),
  subject TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS core_memories_fts USING fts5(
  subject, content, content='core_memories', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS core_memories_ai AFTER INSERT ON core_memories BEGIN
  INSERT INTO core_memories_fts(rowid, subject, content) VALUES (new.id, new.subject, new.content);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_ad AFTER DELETE ON core_memories BEGIN
  INSERT INTO core_memories_fts(core_memories_fts, rowid, subject, content) VALUES ('delete', old.id, old.subject, old.content);
END;

CREATE TRIGGER IF NOT EXISTS core_memories_au AFTER UPDATE ON core_memories BEGIN
  INSERT INTO core_memories_fts(core_memories_fts, rowid, subject, content) VALUES ('delete', old.id, old.subject, old.content);
  INSERT INTO core_memories_fts(rowid, subject, content) VALUES (new.id, new.subject, new.content);
END;

CREATE TABLE IF NOT EXISTS recall_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('episode','conversation')),
  content TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS recall_memories_fts USING fts5(
  content, content='recall_memories', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS recall_memories_ai AFTER INSERT ON recall_memories BEGIN
  INSERT INTO recall_memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS recall_memories_ad AFTER DELETE ON recall_memories BEGIN
  INSERT INTO recall_memories_fts(recall_memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS recall_memories_au AFTER UPDATE ON recall_memories BEGIN
  INSERT INTO recall_memories_fts(recall_memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO recall_memories_fts(rowid, content) VALUES (new.id, new.content);
END;
`;
