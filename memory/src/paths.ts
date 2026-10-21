import { fileURLToPath } from 'node:url';

// Absolute by construction, so it doesn't matter what cwd a host (an MCP
// client, the avatar app) spawns a process with. MEMORY_DB_PATH overrides it.
export const DB_PATH =
  process.env.MEMORY_DB_PATH ?? fileURLToPath(new URL('../data/avelyn.db', import.meta.url));
