import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolProgressSignature, requiresTooling, resolveFinalReply, sanitizeConversationLogContent } from '../src/agent.ts';
import { OllamaRetriever } from '../src/retrieval/ollama-retriever.ts';

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
