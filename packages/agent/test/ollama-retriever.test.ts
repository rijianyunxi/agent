import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MemoryStore } from '@agent/memory';

import { buildToolProgressSignature, requiresTooling, resolveFinalReply, sanitizeConversationLogContent } from '../src/agent.ts';
import { getRetrievalCandidates, OllamaRetriever } from '../src/retrieval/ollama-retriever.ts';

const realFetch = globalThis.fetch;

test('retriever retries availability checks after cooldown', async () => {
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;

    if (callCount === 1) {
      throw new Error('offline');
    }

    return new Response(JSON.stringify({
      models: [{ name: 'bge-m3:latest' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const retriever = new OllamaRetriever({
    availabilityRetryMs: 0,
    logger: { log() {}, error() {} },
  });

  try {
    assert.equal(await retriever.isEnabled(), false);
    assert.equal(await retriever.isEnabled(), true);
    assert.equal(retriever.getModelName(), 'bge-m3:latest');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('getRetrievalCandidates only includes current session conversation logs', () => {
  const candidates = getRetrievalCandidates({
    listMemories() {
      return [{
        id: 1,
        sessionId: 'other',
        userId: 'u1',
        userSymbol: 'alice',
        scope: 'user',
        key: 'user.name',
        value: 'Alice',
        createdAt: 1,
        updatedAt: 1,
      }];
    },
    listConversationLogs(sessionId) {
      assert.equal(sessionId, 's1');
      return [{
        id: 7,
        sessionId: 's1',
        userId: 'u1',
        userSymbol: 'alice',
        role: 'user',
        content: 'current session only',
        timestamp: 1,
      }];
    },
  }, { userId: 'u1', userSymbol: 'alice' }, 's1');

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.source, 'memory/user/user.name');
  assert.equal(candidates[1]?.source, 'conversation/user');
  assert.match(candidates[1]?.content ?? '', /current session only/);
});

test('retriever persists ready embeddings in memory store', async () => {
  const { dir, store } = await createTempMemoryStore();
  const identity = { userId: 'u1', userSymbol: 'alice' };
  let embeddingCalls = 0;

  store.upsertMemory('user', 'user.name', 'Alice', 's1', identity);
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'bge-m3:latest' }] });
    }

    if (url.endsWith('/api/embeddings')) {
      embeddingCalls += 1;
      readEmbeddingPrompt(init);
      return jsonResponse({ embedding: [1, 0] });
    }

    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    const firstRetriever = new OllamaRetriever({
      availabilityRetryMs: 0,
      logger: { log() {}, error() {} },
    });
    const secondRetriever = new OllamaRetriever({
      availabilityRetryMs: 0,
      logger: { log() {}, error() {} },
    });

    assert.equal((await firstRetriever.retrieve('Alice', store, identity, 's1')).length, 1);
    assert.equal(embeddingCalls, 2);
    assert.equal((await secondRetriever.retrieve('Alice', store, identity, 's1')).length, 1);
    assert.equal(embeddingCalls, 2);
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('retriever embeds candidates concurrently', async () => {
  const { dir, store } = await createTempMemoryStore();
  const identity = { userId: 'u1', userSymbol: 'alice' };
  let inFlight = 0;
  let maxInFlight = 0;

  store.upsertMemory('user', 'user.a', 'A', 's1', identity);
  store.upsertMemory('user', 'user.b', 'B', 's1', identity);
  store.upsertMemory('user', 'user.c', 'C', 's1', identity);
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'bge-m3:latest' }] });
    }

    if (url.endsWith('/api/embeddings')) {
      readEmbeddingPrompt(init);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(20);
      inFlight -= 1;
      return jsonResponse({ embedding: [1, 0] });
    }

    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    const retriever = new OllamaRetriever({
      embeddingConcurrency: 2,
      topK: 10,
      availabilityRetryMs: 0,
      logger: { log() {}, error() {} },
    });

    const results = await retriever.retrieve('query', store, identity, 's1');
    assert.equal(results.length, 3);
    assert.equal(maxInFlight, 2);
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('retriever retries failed embeddings only after retry delay', async () => {
  const { dir, store } = await createTempMemoryStore();
  const identity = { userId: 'u1', userSymbol: 'alice' };
  let now = 1_000;
  let candidateCalls = 0;

  store.upsertMemory('user', 'user.preference', 'prefers morning reports', 's1', identity);
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      return jsonResponse({ models: [{ name: 'bge-m3:latest' }] });
    }

    if (url.endsWith('/api/embeddings')) {
      const prompt = readEmbeddingPrompt(init);
      if (prompt === 'query') {
        return jsonResponse({ embedding: [1, 0] });
      }

      candidateCalls += 1;
      if (candidateCalls === 1) {
        return new Response(null, { status: 500 });
      }

      return jsonResponse({ embedding: [1, 0] });
    }

    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    const retriever = new OllamaRetriever({
      embeddingFailureRetryMs: 1_000,
      availabilityRetryMs: 0,
      logger: { log() {}, error() {} },
      now: () => now,
    });

    assert.equal((await retriever.retrieve('query', store, identity, 's1')).length, 0);
    assert.equal(candidateCalls, 1);

    now = 1_500;
    assert.equal((await retriever.retrieve('query', store, identity, 's1')).length, 0);
    assert.equal(candidateCalls, 1);

    now = 2_000;
    assert.equal((await retriever.retrieve('query', store, identity, 's1')).length, 1);
    assert.equal(candidateCalls, 2);
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildToolProgressSignature is stable for repeated tool progress', () => {
  const toolCalls = [{
    id: 'call-1',
    type: 'function',
    function: { name: 'query_attendance', arguments: '{"date":"2026-04-17"}' },
  }] as const;
  const toolResults = [{
    tool_call_id: 'call-1',
    content: '{"date":"2026-04-17","actualPresent":12}',
  }];

  assert.equal(
    buildToolProgressSignature([...toolCalls], [...toolResults]),
    buildToolProgressSignature([...toolCalls], [...toolResults]),
  );
});

test('requiresTooling only blocks tool-dependent questions', () => {
  assert.equal(requiresTooling('今天工地考勤人数是多少'), true);
  assert.equal(requiresTooling('你是谁'), false);
});

test('resolveFinalReply handles abnormal finish reasons', () => {
  assert.equal(resolveFinalReply('length', '半截内容'), '抱歉，回复长度超限，请缩小问题范围后重试。');
  assert.equal(resolveFinalReply('content_filter', ''), '抱歉，该请求触发了内容限制，无法完整回答。');
  assert.equal(resolveFinalReply('stop', '正常回复'), '正常回复');
  assert.equal(resolveFinalReply('stop', ''), '抱歉，本次没有生成有效回复。');
});

test('sanitizeConversationLogContent redacts sensitive content and data URLs', () => {
  const sanitized = sanitizeConversationLogContent('联系电话 13800138000 data:image/png;base64,abcd sk-test-secret-token');
  assert.match(sanitized, /\[redacted-phone\]/);
  assert.match(sanitized, /\[image-data\]/);
  assert.match(sanitized, /\[redacted-secret\]/);
});

async function createTempMemoryStore(): Promise<{ dir: string; store: MemoryStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-retrieval-test-'));
  const store = new MemoryStore({ dbPath: path.join(dir, 'memory.db') });
  store.initialize();
  return { dir, store };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readEmbeddingPrompt(init: RequestInit | undefined): string {
  const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: unknown };
  return typeof body.prompt === 'string' ? body.prompt : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
