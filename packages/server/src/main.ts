import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

import { demoApprovalWorkflow, inspectionRectificationWorkflow, WorkflowManager } from '@agent/workflow';

import { createServerApp } from './app.ts';
import { AgentSessionManager } from './session-manager.ts';

loadEnv({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
});

const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const sessionIdleTtlMs = Number.parseInt(process.env['SESSION_IDLE_TTL_MS'] ?? `${30 * 60 * 1000}`, 10);
const sessionMaxLifetimeMs = Number.parseInt(process.env['SESSION_MAX_LIFETIME_MS'] ?? `${2 * 60 * 60 * 1000}`, 10);
const sessionCleanupIntervalMs = Number.parseInt(process.env['SESSION_CLEANUP_INTERVAL_MS'] ?? '60000', 10);

const workflowManager = new WorkflowManager({
  definitions: [demoApprovalWorkflow, inspectionRectificationWorkflow],
});

const { app, sessionManager } = createServerApp({
  sessionManager: new AgentSessionManager({
    idleTtlMs: sessionIdleTtlMs,
    maxLifetimeMs: sessionMaxLifetimeMs,
  }),
  workflowManager,
});

const server = app.listen(port, () => {
  console.log(`koa server listening on http://127.0.0.1:${port}`);
});

const cleanupTimer = setInterval(() => {
  void sessionManager.disposeIdleSessions().catch((error) => {
    console.error('[session:cleanup]', error instanceof Error ? error.message : String(error));
  });
}, sessionCleanupIntervalMs);

if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

const cleanup = async (): Promise<void> => {
  clearInterval(cleanupTimer);
  await sessionManager.shutdown();
  workflowManager.close();

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
