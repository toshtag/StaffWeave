import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createDatabase } from '@staffweave/db';
import { createApp } from './app.js';
import { loadApiConfig } from './config.js';

const config = loadApiConfig();
const db = createDatabase({ connectionString: config.databaseUrl });
const app = createApp({
  db,
  defaultWorkspaceSlug: config.defaultWorkspaceSlug,
  useSecureCookie: config.environment === 'production',
  cardFingerprintKey: config.cardFingerprintKey,
  webhookNetworkPolicy: config.webhookNetworkPolicy,
});

// セルフホストでは、ビルド済みの Web を同じプロセスから配信できるようにする。
// 別の配信先へ置きたい場合は WEB_DIST_PATH を設定しなければよい。
if (config.webDistPath !== null) {
  const root = config.webDistPath;
  app.use('/assets/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

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
