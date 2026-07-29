import { serve } from '@hono/node-server';
import { createDatabase } from '@staffweave/db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = createDatabase({ connectionString: config.databaseUrl });
const app = createApp({
  db,
  defaultWorkspaceSlug: config.defaultWorkspaceSlug,
  useSecureCookie: config.environment === 'production',
  cardFingerprintKey: config.cardFingerprintKey,
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`staffweave API: http://${config.host}:${info.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} を受信しました。終了処理を行います。`);
  server.close();
  await db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
