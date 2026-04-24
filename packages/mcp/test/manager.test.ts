import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { formatMcpToolCallResult, McpManager } from '../src/manager.ts';

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

test('invalid MCP config JSON is logged and treated as empty config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-mcp-test-'));
  const configPath = path.join(dir, 'mcp.servers.json');
  await writeFile(configPath, '{ invalid json', 'utf8');
  const errors: unknown[][] = [];
  const manager = new McpManager({
    configPath,
    logger: {
      log() {},
      error(...args: unknown[]) {
        errors.push(args);
      },
    },
  });

  try {
    await manager.refresh();
    assert.equal(manager.getTools().length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[0]), /\[mcp:config:error\]/);
  } finally {
    await manager.close();
    await rm(dir, { recursive: true, force: true });
  }
});
