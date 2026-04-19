import { randomUUID } from 'node:crypto';

import Koa from 'koa';

import {
  ApprovalRequestNotFoundError,
  ApprovalRequestResolvedError,
  WorkflowDefinitionNotFoundError,
  WorkflowInstanceNotFoundError,
  WorkflowManager,
  WorkflowStateError,
} from '@agent/workflow';

import { AgentSessionManager } from './session-manager.ts';
import { BUSINESS_TEST_PAGE_HTML } from './workflow-test-page.ts';

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
  workflowManager?: WorkflowManager;
}

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_IMAGE_URL_LENGTH = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 4000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

interface StreamEvent {
  event: 'session' | 'reply' | 'done' | 'error';
  data: Record<string, unknown>;
}

export function createServerApp(options: ServerAppOptions = {}): { app: Koa; sessionManager: AgentSessionManager; workflowManager?: WorkflowManager } {
  const sessionManager = options.sessionManager ?? new AgentSessionManager();
  const workflowManager = options.workflowManager;
  const app = new Koa();

  app.use(async (ctx) => {
    try {
      if (ctx.method === 'GET' && ctx.path === '/health') {
        ctx.body = { ok: true };
        return;
      }

      if (ctx.method === 'GET' && (ctx.path === '/test' || ctx.path === '/workflow-test')) {
        ctx.type = 'html';
        ctx.body = BUSINESS_TEST_PAGE_HTML;
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
        const userId = isRecord(payload)
          ? normalizeIdentifier(payload['userId'], 'userId')
          : null;
        const userSymbol = isRecord(payload)
          ? normalizeIdentifier(payload['userSymbol'], 'userSymbol')
          : null;

        if (!sessionId) {
          ctx.status = 400;
          ctx.body = { error: 'sessionId is required' };
          return;
        }

        const reset = await sessionManager.resetSession(sessionId, {
          ...(userId ? { userId } : {}),
          ...(userSymbol ? { userSymbol } : {}),
        });
        ctx.body = { sessionId, reset };
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/chat/stream') {
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

        prepareSseResponse(ctx);
        writeSseEvent(ctx, { event: 'session', data: { sessionId } });

        try {
          const reply = await sessionManager.runTurn({
            sessionId,
            message: body.message,
            ...(imageUrl ? { imageUrl } : {}),
            ...(userId ? { userId } : {}),
            ...(userSymbol ? { userSymbol } : {}),
            ...(typeof body.reset === 'boolean' ? { reset: body.reset } : {}),
          });

          writeSseEvent(ctx, { event: 'reply', data: { sessionId, reply } });
          writeSseEvent(ctx, { event: 'done', data: { sessionId } });
        } catch (error) {
          const mapped = mapAppError(error);
          writeSseEvent(ctx, {
            event: 'error',
            data: { sessionId, error: mapped.body.error, status: mapped.status },
          });
        } finally {
          ctx.res.end();
        }
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/session/close') {
        const payload = await readJsonBody(ctx);
        const sessionId = isRecord(payload)
          ? normalizeIdentifier(payload['sessionId'], 'sessionId')
          : null;
        const userId = isRecord(payload)
          ? normalizeIdentifier(payload['userId'], 'userId')
          : null;
        const userSymbol = isRecord(payload)
          ? normalizeIdentifier(payload['userSymbol'], 'userSymbol')
          : null;

        if (!sessionId) {
          ctx.status = 400;
          ctx.body = { error: 'sessionId is required' };
          return;
        }

        const closed = await sessionManager.disposeSession(sessionId, {
          ...(userId ? { userId } : {}),
          ...(userSymbol ? { userSymbol } : {}),
        });
        ctx.body = { sessionId, closed };
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/workflows/start') {
        if (!workflowManager) {
          ctx.status = 503;
          ctx.body = { error: 'workflow manager unavailable' };
          return;
        }

        const payload = await readJsonBody(ctx);
        if (!isRecord(payload) || typeof payload['workflowName'] !== 'string' || !payload['workflowName'].trim()) {
          ctx.status = 400;
          ctx.body = { error: 'workflowName is required' };
          return;
        }

        const workflowName = payload['workflowName'].trim();
        const input = isRecord(payload['input']) ? payload['input'] : undefined;
        const context = isRecord(payload['context']) ? payload['context'] : undefined;
        const snapshot = await workflowManager.startWorkflow({
          workflowName,
          ...(input ? { input } : {}),
          ...(context ? { context } : {}),
        });
        ctx.body = snapshot;
        return;
      }

      if (ctx.method === 'POST' && ctx.path === '/workflows/approval/resume') {
        if (!workflowManager) {
          ctx.status = 503;
          ctx.body = { error: 'workflow manager unavailable' };
          return;
        }

        const payload = await readJsonBody(ctx);
        if (!isRecord(payload)) {
          ctx.status = 400;
          ctx.body = { error: 'approvalRequestId is required' };
          return;
        }

        const approvalRequestId = normalizeIdentifier(payload['approvalRequestId'], 'approvalRequestId');
        if (!approvalRequestId) {
          ctx.status = 400;
          ctx.body = { error: 'approvalRequestId is required' };
          return;
        }

        if (typeof payload['approved'] !== 'boolean') {
          ctx.status = 400;
          ctx.body = { error: 'approved must be boolean' };
          return;
        }

        const actor = normalizeOptionalString(payload['actor']);
        const comment = normalizeOptionalString(payload['comment']);
        const snapshot = await workflowManager.resumeApproval({
          approvalRequestId,
          approved: payload['approved'],
          ...(actor ? { actor } : {}),
          ...(comment ? { comment } : {}),
        });
        ctx.body = snapshot;
        return;
      }

      if (ctx.method === 'GET' && ctx.path.startsWith('/workflows/')) {
        if (!workflowManager) {
          ctx.status = 503;
          ctx.body = { error: 'workflow manager unavailable' };
          return;
        }

        const instanceId = normalizeIdentifier(decodeURIComponent(ctx.path.slice('/workflows/'.length)), 'instanceId');
        if (!instanceId) {
          ctx.status = 400;
          ctx.body = { error: 'instanceId is required' };
          return;
        }

        const snapshot = workflowManager.getWorkflow(instanceId);
        ctx.body = snapshot;
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

  return { app, sessionManager, ...(workflowManager ? { workflowManager } : {}) };
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

  if (error instanceof WorkflowDefinitionNotFoundError || error instanceof WorkflowInstanceNotFoundError || error instanceof ApprovalRequestNotFoundError) {
    return {
      status: 404,
      body: { error: error.message },
    };
  }

  if (error instanceof ApprovalRequestResolvedError || error instanceof WorkflowStateError) {
    return {
      status: 409,
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

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new InvalidInputError('invalid string field');
  }

  const trimmed = value.trim();
  return trimmed || null;
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

export function prepareSseResponse(ctx: Koa.Context): void {
  ctx.req.setTimeout(0);
  ctx.respond = false;
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  ctx.res.setHeader('Cache-Control', 'no-cache, no-transform');
  ctx.res.setHeader('Connection', 'keep-alive');
  ctx.res.setHeader('X-Accel-Buffering', 'no');
  ctx.res.flushHeaders?.();
}

export function writeSseEvent(ctx: Koa.Context, payload: StreamEvent): void {
  ctx.res.write(`event: ${payload.event}\n`);
  ctx.res.write(`data: ${JSON.stringify(payload.data)}\n\n`);
}
