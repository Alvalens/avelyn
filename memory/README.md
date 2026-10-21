# memory

Local-first memory for Avelyn: SQLite + FTS5, zero dependencies (`node:sqlite`, `node:test` — same
style as `bridge/`, plain TypeScript run directly by Node, no build step).

Split into two tiers, following how Letta/MemGPT and Claude/ChatGPT's own memory features do it —
the research behind this: MemGPT's core/recall/archival tiering,
mem0's extract-then-reconcile pipeline, Claude/ChatGPT splitting discrete facts from retrieved
conversation snippets):

- **Core memory** (`identity` / `preference` / `relationship` / `project` / `fact`) — small,
  structured, meant to be loaded in full every time. This is what a future AI would inject wholesale
  as context.
- **Recall memory** (`episode` / `conversation`) — larger, only ever touched through search, never
  bulk-loaded.

**This round is storage + API only.** There's no AI layer yet to decide *what's* worth remembering
or *whether* a new fact conflicts with an existing one — that judgment call is deliberately left for
when an AI layer wants to reconcile facts itself. `searchCoreMemory` exists so a
future caller can check "does something like this already exist" before adding, but the decision
stays with the caller.

## Setup

Nothing to install. The DB file is created (with schema applied) on first use, at
`memory/data/avelyn.db` — gitignored, like `bridge/.env`.

## Use

    node --no-warnings src/cli.ts add-core preference "likes dark mode UIs"
    node --no-warnings src/cli.ts add-core relationship "coworker, met at a conference" Mira
    node --no-warnings src/cli.ts list-core
    node --no-warnings src/cli.ts list-core preference
    node --no-warnings src/cli.ts search-core dark
    node --no-warnings src/cli.ts update-core 1 "revised content"
    node --no-warnings src/cli.ts delete-core 1

    node --no-warnings src/cli.ts add-recall episode "celebrated finishing the bridge module"
    node --no-warnings src/cli.ts search-recall bridge

`--no-warnings` just silences Node's `node:sqlite` experimental-feature banner; the module itself
works fine as-is.

## API

`src/memoryStore.ts` — plain functions taking a `DatabaseSync` handle as the first argument (same
shape as `bridge/`'s `postCommand(config, ...)`), so any caller opens its own handle via
`openMemoryStore(path)`:

- `addCoreMemory` / `updateCoreMemory` / `deleteCoreMemory` / `listCoreMemory(category?)` /
  `searchCoreMemory(query)`
- `addRecallMemory` / `getRecallMemory` / `searchRecallMemory(query)`

Both search functions treat the query as a literal phrase (quoted internally) rather than raw FTS5
query syntax — a search for `"self-driving"` would otherwise throw, since FTS5 parses a bare `-` as
its NOT operator. Free-form callers (an AI searching on whatever words it extracted) shouldn't have
to know FTS5's query grammar to avoid a syntax error.

## Tests

    node --no-warnings --test src/*.test.ts

Every test opens its own `:memory:` database — no file I/O, no cross-test state.
