import { fileURLToPath } from 'node:url';

// Absolute by construction, so it does not matter what cwd an MCP host or the
// pipeline was started with. VISION_DIR overrides it for tests.
export const VISION_DIR =
  process.env.VISION_DIR ?? fileURLToPath(new URL('..', import.meta.url));
export const CAPTURES_DIR = `${VISION_DIR.replace(/[\\/]+$/, '')}\\captures`;
export const NO_LOOK_PATH = `${VISION_DIR.replace(/[\\/]+$/, '')}\\no-look.flag`;
