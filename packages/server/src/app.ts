import { randomUUID } from 'node:crypto';

import Koa from 'koa';

import { AgentSessionManager } from './session-manager.ts';

interface ChatBody {
  sessionId?: string;
  userId?: string;
  userSymbol?: string;
  message?: string;
  imageUrl?: string;
  reset?: boolean;
}

export interface ServerAppOptions {
  sessionManager?: AgentSessionManager;
}

export function createServerApp(options: ServerAppOptions = {}): { app: Koa; sessionManager: AgentSessionManager } {
  const sessionManager = options.sessionManager ?? new AgentSessionManager();
  const app = new Koa();

  app.use(async (ctx) => {
    try {
      if (ctx.method === 'GET' && ctx.path === '/health') {
        ctx.body = { ok: true };
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/chat') {
        const payload = await readJsonBody(ctx);
        const body = isChatBody(payload) ? payload : {};

        if (!body.message?.trim()) {
          ctx.status = 400;
          ctx.body = { error: 'message is required' };
          return;
        }

        const sessionId = body.sessionId?.trim() || randomUUID();
        const reply = await sessionManager.runTurn({
          sessionId,
          message: body.message,
          ...(body.imageUrl ? { imageUrl: body.imageUrl } : {}),
          ...(body.userId ? { userId: body.userId } : {}),
          ...(body.userSymbol ? { userSymbol: body.userSymbol } : {}),
          ...(typeof body.reset === 'boolean' ? { reset: body.reset } : {}),
        });

        ctx.body = {
          sessionId,
          reply,
        };
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/reset') {
        const payload = await readJsonBody(ctx);
        const sessionId = isRecord(payload) && typeof payload['sessionId'] === 'string'
          ? payload['sessionId']
          : null;

        if (!sessionId) {
          ctx.status = 400;
          ctx.body = { error: 'sessionId is required' };
          return;
        }

        const reset = await sessionManager.resetSession(sessionId);
        ctx.body = { sessionId, reset };
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/session/close') {
        const payload = await readJsonBody(ctx);
        const sessionId = isRecord(payload) && typeof payload['sessionId'] === 'string'
          ? payload['sessionId']
          : null;

        if (!sessionId) {
          ctx.status = 400;
          ctx.body = { error: 'sessionId is required' };
          return;
        }

        const closed = await sessionManager.disposeSession(sessionId);
        ctx.body = { sessionId, closed };
        return;
      }

      ctx.status = 404;
      ctx.body = { error: 'Not Found' };
    } catch (error) {
      ctx.status = 500;
      ctx.body = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return { app, sessionManager };
}

async function readJsonBody(ctx: Koa.Context): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of ctx.req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function isChatBody(value: unknown): value is ChatBody {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
