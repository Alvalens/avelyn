import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfigFromEnv, type AgentBusConfig } from './agentBusClient.ts';
import { personalityActions } from './actions.ts';
import { runAction } from './runAction.ts';

const PORT = Number(process.env.BRIDGE_PORT ?? 4790);

export function createServer(config: AgentBusConfig) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(personalityActions));
      return;
    }

    const match = url.pathname.match(/^\/actions\/([\w-]+)$/);
    if (req.method === 'POST' && match) {
      const result = await runAction(config, match[1]);
      res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(loadConfigFromEnv());
  server.listen(PORT, () => {
    console.log(`Avelyn bridge listening on http://127.0.0.1:${PORT}`);
  });
}
