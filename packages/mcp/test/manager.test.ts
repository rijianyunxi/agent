import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMcpToolCallResult } from '../src/manager.ts';

test('formatMcpToolCallResult prefers text content', () => {
  const result = formatMcpToolCallResult({
    content: [
      { type: 'text', text: '{"date":"2026-04-16"}' },
    ],
    structuredContent: { ignored: true },
    isError: false,
  });

  assert.equal(result, '{"date":"2026-04-16"}');
});

test('formatMcpToolCallResult falls back to structured content', () => {
  const result = formatMcpToolCallResult({
    structuredContent: { ok: true, count: 2 },
    isError: false,
  });

  assert.equal(result, '{"ok":true,"count":2}');
});

test('formatMcpToolCallResult preserves error semantics', () => {
  const result = formatMcpToolCallResult({
    content: [
      { type: 'text', text: 'remote server unavailable' },
    ],
    isError: true,
  });

  assert.equal(result, '{"error":"remote server unavailable"}');
});
