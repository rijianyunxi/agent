import 'dotenv/config';

import { createServerApp } from './app.ts';

const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const { app, sessionManager } = createServerApp();
const server = app.listen(port, () => {
  console.log(`koa server listening on http://127.0.0.1:${port}`);
});

const cleanup = async (): Promise<void> => {
  await sessionManager.shutdown();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

process.once('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.once('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});
