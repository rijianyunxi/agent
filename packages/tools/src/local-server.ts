import { MemoryStore } from '@agent/memory';
import type { Tool } from '@agent/shared';

import { attendanceTool } from './attendance.ts';
import { inspectionTool } from './inspection.ts';
import { createMemoryTools } from './memory-tools.ts';

interface JsonRpcRequest {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface LocalServerOptions {
  memoryStore: MemoryStore;
  sessionId: string;
  userId?: string;
  userSymbol?: string;
}

export function createLocalMcpToolMap(options: LocalServerOptions): Map<string, Tool> {
  const tools: Tool[] = [
    attendanceTool,
    inspectionTool,
    ...createMemoryTools({
      memoryStore: options.memoryStore,
      sessionId: options.sessionId,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.userSymbol ? { userSymbol: options.userSymbol } : {}),
    }),
  ];

  return new Map(tools.map((tool) => [tool.definition.function.name, tool] as const));
}

async function main(): Promise<void> {
  const memoryStore = new MemoryStore({
    ...(process.env['MEMORY_DB_PATH'] ? { dbPath: process.env['MEMORY_DB_PATH'] } : {}),
  });
  memoryStore.initialize();

  const toolMap = createLocalMcpToolMap({
    memoryStore,
    sessionId: process.env['LOCAL_MCP_SESSION_ID'] ?? crypto.randomUUID(),
    ...(process.env['AGENT_USER_ID'] ? { userId: process.env['AGENT_USER_ID'] } : {}),
    ...(process.env['AGENT_USER_SYMBOL'] ? { userSymbol: process.env['AGENT_USER_SYMBOL'] } : {}),
  });

  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  process.stdin.on('data', async (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    try {
      while (true) {
        const parsedMessage = readNextMessage(buffer);
        if (!parsedMessage) {
          break;
        }

        buffer = parsedMessage.rest;

        try {
          const request = parseRequestBody(parsedMessage.body);
          await handleRequest(request, toolMap);
        } catch (error) {
          const rpcError = toJsonRpcError(error, -32700, 'Invalid JSON-RPC request');
          const requestId = getRequestIdFromBody(parsedMessage.body);
          writeError(requestId, rpcError.code, rpcError.message);
        }
      }
    } catch (error) {
      const rpcError = toJsonRpcError(error, -32600, 'Malformed stdio frame');
      buffer = Buffer.alloc(0);
      writeError(undefined, rpcError.code, rpcError.message);
    }
  });

  process.stdin.on('error', (error) => {
    const rpcError = toJsonRpcError(error, -32001, 'stdin stream error');
    writeError(undefined, rpcError.code, rpcError.message);
  });

  process.stdout.on('error', (error) => {
    console.error('[local-mcp:stdout]', error instanceof Error ? error.message : String(error));
  });

  process.once('SIGINT', () => {
    memoryStore.close();
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    memoryStore.close();
    process.exit(0);
  });
}

async function handleRequest(request: JsonRpcRequest, toolMap: Map<string, Tool>): Promise<void> {
  if (request.method === 'initialize') {
    writeResponse(request.id, {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'local-tools',
        version: '1.0.0',
      },
      capabilities: {
        tools: {},
      },
    });
    return;
  }

  if (request.method === 'notifications/initialized') {
    return;
  }

  if (request.method === 'tools/list') {
    writeResponse(request.id, {
      tools: [...toolMap.values()].map((tool) => ({
        name: tool.definition.function.name,
        description: tool.definition.function.description,
        inputSchema: tool.definition.function.parameters,
      })),
    });
    return;
  }

  if (request.method === 'tools/call') {
    const toolName = request.params?.['name'];
    const args = request.params?.['arguments'];

    if (typeof toolName !== 'string') {
      writeError(request.id, -32602, 'Missing tool name');
      return;
    }

    const tool = toolMap.get(toolName);
    if (!tool) {
      writeError(request.id, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    try {
      const result = await tool.execute(isObject(args) ? args : {});
      writeResponse(request.id, {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
        structuredContent: safeJsonParse(result),
        isError: false,
      });
    } catch (error) {
      const rpcError = toJsonRpcError(error, -32000, `Tool execution failed: ${toolName}`);
      writeError(request.id, rpcError.code, rpcError.message);
    }
    return;
  }

  writeError(request.id, -32601, `Unsupported method: ${request.method ?? 'unknown'}`);
}

function writeResponse(id: number | undefined, result: unknown): void {
  const message = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result,
  });
  writeMessage(message);
}

function writeError(id: number | undefined, code: number, message: string): void {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  writeMessage(payload);
}

function writeMessage(message: string): void {
  const payload = `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`;
  process.stdout.write(payload, 'utf8');
}

function readNextMessage(buffer: Buffer): { body: string; rest: Buffer<ArrayBufferLike> } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return null;
  }

  const headerText = buffer.subarray(0, headerEnd).toString('utf8');
  const match = headerText.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error('Missing Content-Length header');
  }

  const contentLength = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('Invalid Content-Length header');
  }

  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) {
    return null;
  }

  return {
    body: buffer.subarray(bodyStart, bodyEnd).toString('utf8'),
    rest: buffer.subarray(bodyEnd),
  };
}

function parseRequestBody(body: string): JsonRpcRequest {
  const parsed = JSON.parse(body) as unknown;
  if (!isObject(parsed)) {
    throw new Error('JSON-RPC payload must be an object');
  }

  return parsed as JsonRpcRequest;
}

function getRequestIdFromBody(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isObject(parsed) && typeof parsed['id'] === 'number' ? parsed['id'] : undefined;
  } catch {
    return undefined;
  }
}

function toJsonRpcError(error: unknown, fallbackCode: number, fallbackMessage: string): JsonRpcError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: fallbackCode,
    message: message || fallbackMessage,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { text: value }; 
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main();
