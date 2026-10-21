import { loadConfigFromEnv } from './agentBusClient.ts';
import { personalityActions } from './actions.ts';
import { runAction } from './runAction.ts';

const [, , command] = process.argv;

async function main() {
  if (!command || command === 'list') {
    for (const action of personalityActions) {
      console.log(`${action.id.padEnd(20)} ${action.description}`);
    }
    return;
  }

  const config = loadConfigFromEnv();
  const result = await runAction(config, command);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
