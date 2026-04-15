import type { MemoryStore } from '../memory/index.ts';
import { MemoryStore as DefaultMemoryStore } from '../memory/index.ts';
import { attendanceTool } from '../tools/attendance.ts';
import { inspectionTool } from '../tools/inspection.ts';
import { createMemoryTools } from '../tools/memory-tools.ts';
import type { Tool } from '../types.ts';

interface JsonRpcRequest {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
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
  const memoryStore = new DefaultMemoryStore({
    ...(process.env['MEMORY_DB_PATH'] ? { dbPath: process.env['MEMORY_DB_PATH'] } : {}),
  });
  memoryStore.initialize();

  const toolMap = createLocalMcpToolMap({
    memoryStore,
    sessionId: process.env['LOCAL_MCP_SESSION_ID'] ?? crypto.randomUUID(),
    ...(process.env['AGENT_USER_ID'] ? { userId: process.env['AGENT_USER_ID'] } : {}),
    ...(process.env['AGENT_USER_SYMBOL'] ? { userSymbol: process.env['AGENT_USER_SYMBOL'] } : {}),
  });

  let buffer = Buffer.alloc(0);

  process.stdin.on('data', async (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const headerText = buffer.subarray(0, headerEnd).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = Buffer.alloc(0);
        break;
      }

      const contentLength = Number.parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        break;
      }

      const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.subarray(bodyEnd);

      const request = JSON.parse(body) as JsonRpcRequest;
      await handleRequest(request, toolMap);
    }
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
