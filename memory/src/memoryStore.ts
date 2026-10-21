import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema.ts';

export type CoreCategory = 'identity' | 'preference' | 'relationship' | 'project' | 'fact';
export type RecallCategory = 'episode' | 'conversation';

const CORE_CATEGORIES: CoreCategory[] = ['identity', 'preference', 'relationship', 'project', 'fact'];
const RECALL_CATEGORIES: RecallCategory[] = ['episode', 'conversation'];

export interface CoreMemory {
  id: number;
  category: CoreCategory;
  subject: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecallMemory {
  id: number;
  category: RecallCategory;
  content: string;
  occurredAt: string;
  createdAt: string;
}

interface CoreMemoryRow {
  id: number;
  category: CoreCategory;
  subject: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

interface RecallMemoryRow {
  id: number;
  category: RecallCategory;
  content: string;
  occurred_at: string;
  created_at: string;
}

// Words that say nothing about which memory is meant. Left in, a question like
// "what does he like" would match every row that happens to contain "he".
const FILLER_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'did', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i', 'in', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'she', 'so', 'that', 'the', 'their', 'them', 'they', 'this', 'to',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

// Each meaningful word becomes its own quoted FTS5 phrase, OR-ed together, and
// bm25 rank puts the rows sharing the most (and rarest) words first. Quoting
// the whole query as one phrase instead meant a natural question ("what games
// does he play") only matched a row containing that exact word sequence, so
// recall came back empty for facts that were plainly there.
//
// Quoting each word still matters: callers include FTS5 query-syntax
// characters (-, :, *, parens) that aren't meant as operators — an unquoted
// "self-driving" throws "no such column: driving" because FTS5 parses the
// bare `-` as its NOT operator. Returns null when nothing meaningful is left.
function toMatchQuery(query: string): string | null {
  const words = query
    .split(/\s+/)
    .filter((word) => {
      const bare = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      return bare !== '' && !FILLER_WORDS.has(bare);
    });
  if (words.length === 0) return null;
  return words.map((word) => `"${word.replace(/"/g, '""')}"`).join(' OR ');
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToCoreMemory(row: CoreMemoryRow): CoreMemory {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRecallMemory(row: RecallMemoryRow): RecallMemory {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function openMemoryStore(path: string = ':memory:'): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function addCoreMemory(
  db: DatabaseSync,
  input: { category: CoreCategory; content: string; subject?: string | null },
): CoreMemory {
  if (!CORE_CATEGORIES.includes(input.category)) {
    throw new Error(`Unknown core category "${input.category}". Known: ${CORE_CATEGORIES.join(', ')}.`);
  }
  const now = nowIso();
  const subject = input.subject ?? null;
  const result = db
    .prepare('INSERT INTO core_memories (category, subject, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.category, subject, input.content, now, now);
  return {
    id: Number(result.lastInsertRowid),
    category: input.category,
    subject,
    content: input.content,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateCoreMemory(db: DatabaseSync, id: number, input: { content: string }): void {
  const now = nowIso();
  const result = db
    .prepare('UPDATE core_memories SET content = ?, updated_at = ? WHERE id = ?')
    .run(input.content, now, id);
  if (result.changes === 0) throw new Error(`No core memory with id ${id}.`);
}

export function deleteCoreMemory(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM core_memories WHERE id = ?').run(id);
}

export function listCoreMemory(db: DatabaseSync, category?: CoreCategory): CoreMemory[] {
  const rows = (
    category
      ? db.prepare('SELECT * FROM core_memories WHERE category = ? ORDER BY id').all(category)
      : db.prepare('SELECT * FROM core_memories ORDER BY id').all()
  ) as unknown as CoreMemoryRow[];
  return rows.map(rowToCoreMemory);
}

export function searchCoreMemory(db: DatabaseSync, query: string, limit = 20): CoreMemory[] {
  // The MATCH operand has to be the fts5 table's real name, not an alias —
  // aliasing it (even `AS f`) makes SQLite report "no such column: f" here.
  // The subquery keeps the real name in scope for MATCH and hands back a
  // plain result the outer join can alias normally.
  const match = toMatchQuery(query);
  if (!match) return [];
  const rows = db
    .prepare(
      `SELECT c.* FROM core_memories c
       JOIN (SELECT rowid, rank FROM core_memories_fts WHERE core_memories_fts MATCH ?) f ON f.rowid = c.id
       ORDER BY f.rank LIMIT ?`,
    )
    .all(match, limit) as unknown as CoreMemoryRow[];
  return rows.map(rowToCoreMemory);
}

export function addRecallMemory(
  db: DatabaseSync,
  input: { category: RecallCategory; content: string; occurredAt?: string },
): RecallMemory {
  if (!RECALL_CATEGORIES.includes(input.category)) {
    throw new Error(`Unknown recall category "${input.category}". Known: ${RECALL_CATEGORIES.join(', ')}.`);
  }
  const now = nowIso();
  const occurredAt = input.occurredAt ?? now;
  const result = db
    .prepare('INSERT INTO recall_memories (category, content, occurred_at, created_at) VALUES (?, ?, ?, ?)')
    .run(input.category, input.content, occurredAt, now);
  return {
    id: Number(result.lastInsertRowid),
    category: input.category,
    content: input.content,
    occurredAt,
    createdAt: now,
  };
}

export function getRecallMemory(db: DatabaseSync, id: number): RecallMemory | null {
  const row = db.prepare('SELECT * FROM recall_memories WHERE id = ?').get(id) as unknown as
    | RecallMemoryRow
    | undefined;
  return row ? rowToRecallMemory(row) : null;
}

export function searchRecallMemory(db: DatabaseSync, query: string, limit = 20): RecallMemory[] {
  const match = toMatchQuery(query);
  if (!match) return [];
  const rows = db
    .prepare(
      `SELECT r.* FROM recall_memories r
       JOIN (SELECT rowid, rank FROM recall_memories_fts WHERE recall_memories_fts MATCH ?) f ON f.rowid = r.id
       ORDER BY f.rank LIMIT ?`,
    )
    .all(match, limit) as unknown as RecallMemoryRow[];
  return rows.map(rowToRecallMemory);
}
