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

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_IMAGE_URL_LENGTH = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

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

        if (body.message.length > MAX_MESSAGE_LENGTH) {
          ctx.status = 400;
          ctx.body = { error: 'message too long' };
          return;
        }

        const sessionId = normalizeIdentifier(body.sessionId, 'sessionId') ?? randomUUID();
        const userId = normalizeIdentifier(body.userId, 'userId');
        const userSymbol = normalizeIdentifier(body.userSymbol, 'userSymbol');
        const imageUrl = normalizeImageUrl(body.imageUrl);

        const reply = await sessionManager.runTurn({
          sessionId,
          message: body.message,
          ...(imageUrl ? { imageUrl } : {}),
          ...(userId ? { userId } : {}),
          ...(userSymbol ? { userSymbol } : {}),
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
        const sessionId = isRecord(payload)
          ? normalizeIdentifier(payload['sessionId'], 'sessionId')
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
        const sessionId = isRecord(payload)
          ? normalizeIdentifier(payload['sessionId'], 'sessionId')
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
      const mapped = mapAppError(error);
      ctx.status = mapped.status;
      ctx.body = mapped.body;
    }
  });

  return { app, sessionManager };
}

async function readJsonBody(ctx: Koa.Context): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of ctx.req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  return parseJsonBody(raw);
}

function isChatBody(value: unknown): value is ChatBody {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export function mapAppError(error: unknown): {
  status: number;
  body: { error: string };
} {
  if (error instanceof PayloadTooLargeError) {
    return {
      status: 413,
      body: { error: 'json body too large' },
    };
  }

  if (error instanceof InvalidJsonBodyError) {
    return {
      status: 400,
      body: { error: 'invalid json body' },
    };
  }

  if (error instanceof InvalidInputError) {
    return {
      status: 400,
      body: { error: error.message },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message === 'session identity mismatch') {
    return {
      status: 409,
      body: { error: message },
    };
  }

  return {
    status: 500,
    body: { error: message },
  };
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super('invalid json body');
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('json body too large');
  }
}

class InvalidInputError extends Error {}

export function normalizeIdentifier(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidInputError(`invalid ${fieldName}`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_ID_LENGTH || !SAFE_ID_PATTERN.test(trimmed)) {
    throw new InvalidInputError(`invalid ${fieldName}`);
  }

  return trimmed;
}

export function normalizeImageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidInputError('invalid imageUrl');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_IMAGE_URL_LENGTH) {
    throw new InvalidInputError('invalid imageUrl');
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    // fall through
  }

  throw new InvalidInputError('invalid imageUrl');
}
