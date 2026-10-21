import type { DatabaseSync } from 'node:sqlite';
import { liveBusConfig, type AgentBusConfig } from '../../bridge/src/agentBusClient.ts';
import { runtimePath } from '../../bridge/src/runtime.ts';
import { openMemoryStore } from '../../memory/src/memoryStore.ts';
import { DB_PATH } from '../../memory/src/paths.ts';
import { loadConfigFromEnv as loadVoiceConfigFromEnv, type VoicevoxConfig } from '../../voice/src/voicevoxClient.ts';
import { CAPTURES_DIR, NO_LOOK_PATH } from '../../vision/src/paths.ts';

export interface EngineContext {
  bus: AgentBusConfig;
  db: DatabaseSync;
  voice: VoicevoxConfig;
  vision: { dir: string; settingsPath: string; noLookPath?: string };
  /** The last line she said and when — see speak's repeat check in tools.ts. */
  lastSpoken?: { text: string; at: number };
}

export function createEngineContext(): EngineContext {
  return {
    // Resolved per command from the app's runtime file: the engine may start
    // before the app does, and outlives a token rotation.
    bus: liveBusConfig(),
    db: openMemoryStore(DB_PATH),
    voice: loadVoiceConfigFromEnv(),
    vision: { dir: CAPTURES_DIR, settingsPath: runtimePath(), noLookPath: NO_LOOK_PATH },
  };
}
