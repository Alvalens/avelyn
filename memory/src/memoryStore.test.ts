import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openMemoryStore,
  addCoreMemory,
  updateCoreMemory,
  deleteCoreMemory,
  listCoreMemory,
  searchCoreMemory,
  addRecallMemory,
  getRecallMemory,
  searchRecallMemory,
} from './memoryStore.ts';

test('addCoreMemory + listCoreMemory round-trips a memory', () => {
  const db = openMemoryStore();
  const created = addCoreMemory(db, { category: 'preference', content: 'likes dark mode UIs' });

  const all = listCoreMemory(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, created.id);
  assert.equal(all[0].content, 'likes dark mode UIs');
  assert.equal(all[0].subject, null);
});

test('addCoreMemory rejects an unknown category', () => {
  const db = openMemoryStore();
  assert.throws(
    () => addCoreMemory(db, { category: 'nonsense' as never, content: 'x' }),
    /Unknown core category/,
  );
});

test('listCoreMemory filters by category', () => {
  const db = openMemoryStore();
  addCoreMemory(db, { category: 'preference', content: 'likes tea' });
  addCoreMemory(db, { category: 'fact', content: 'lives in a timezone' });

  const preferences = listCoreMemory(db, 'preference');
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0].content, 'likes tea');
});

test('updateCoreMemory changes content and updatedAt, throws for an unknown id', () => {
  const db = openMemoryStore();
  const created = addCoreMemory(db, { category: 'fact', content: 'original' });

  updateCoreMemory(db, created.id, { content: 'revised' });
  const [updated] = listCoreMemory(db);
  assert.equal(updated.content, 'revised');

  assert.throws(() => updateCoreMemory(db, 9999, { content: 'x' }), /No core memory with id 9999/);
});

test('deleteCoreMemory removes it from listCoreMemory and search', () => {
  const db = openMemoryStore();
  const created = addCoreMemory(db, { category: 'fact', content: 'temporary note' });

  deleteCoreMemory(db, created.id);

  assert.equal(listCoreMemory(db).length, 0);
  assert.equal(searchCoreMemory(db, 'temporary').length, 0);
});

test('searchCoreMemory finds by content and by subject, and reflects updates', () => {
  const db = openMemoryStore();
  addCoreMemory(db, { category: 'relationship', subject: 'Mira', content: 'coworker, met at a conference' });

  assert.equal(searchCoreMemory(db, 'coworker').length, 1);
  assert.equal(searchCoreMemory(db, 'Mira').length, 1);
  assert.equal(searchCoreMemory(db, 'nonexistent-term').length, 0);

  const [found] = searchCoreMemory(db, 'coworker');
  updateCoreMemory(db, found.id, { content: 'former colleague, now a friend' });

  assert.equal(searchCoreMemory(db, 'coworker').length, 0);
  assert.equal(searchCoreMemory(db, 'friend').length, 1);
});

test('addRecallMemory + getRecallMemory round-trips, defaulting occurredAt to now', () => {
  const db = openMemoryStore();
  const created = addRecallMemory(db, { category: 'episode', content: 'user seemed frustrated about a bug' });

  const fetched = getRecallMemory(db, created.id);
  assert.equal(fetched?.content, 'user seemed frustrated about a bug');
  assert.equal(fetched?.occurredAt, created.createdAt);
});

test('addRecallMemory rejects an unknown category', () => {
  const db = openMemoryStore();
  assert.throws(
    () => addRecallMemory(db, { category: 'nonsense' as never, content: 'x' }),
    /Unknown recall category/,
  );
});

test('searchRecallMemory finds matching episodes and conversations', () => {
  const db = openMemoryStore();
  addRecallMemory(db, { category: 'episode', content: 'celebrated finishing the bridge module' });
  addRecallMemory(db, { category: 'conversation', content: 'discussed weekend plans' });

  const results = searchRecallMemory(db, 'bridge');
  assert.equal(results.length, 1);
  assert.equal(results[0].category, 'episode');
});

test('getRecallMemory returns null for an unknown id', () => {
  const db = openMemoryStore();
  assert.equal(getRecallMemory(db, 9999), null);
});

test('a natural-language query finds a fact sharing any meaningful word with it', () => {
  const db = openMemoryStore();
  addCoreMemory(db, { category: 'preference', content: 'Plays Minecraft and other games for downtime.' });
  addRecallMemory(db, { category: 'episode', content: 'Turned down a marriage proposal, deadpan.' });

  assert.equal(searchCoreMemory(db, 'what games does he like').length, 1);
  assert.equal(searchRecallMemory(db, 'that time he proposed marriage').length, 1);
});

test('a query made only of filler words finds nothing rather than everything', () => {
  const db = openMemoryStore();
  addCoreMemory(db, { category: 'fact', content: 'What he does is build things.' });

  assert.equal(searchCoreMemory(db, 'what does he').length, 0);
  assert.equal(searchCoreMemory(db, '   ').length, 0);
});

test('search queries with FTS5 operator characters are treated as literal text, not syntax', () => {
  const db = openMemoryStore();
  addCoreMemory(db, { category: 'fact', content: 'self-driving cars are a topic sometimes' });

  // A raw "-" would otherwise be FTS5's NOT operator and throw a syntax error.
  assert.doesNotThrow(() => searchCoreMemory(db, 'self-driving'));
  assert.equal(searchCoreMemory(db, 'self-driving').length, 1);
});
