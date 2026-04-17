import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type OpenAI from 'openai';

import type { Logger, McpConfigFile, McpServerConfig, RuntimeMcpServer, Tool } from '@agent/shared';

interface McpManagerOptions {
  configPath?: string;
  logger?: Logger;
  runtimeServers?: RuntimeMcpServer[];
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T> {
  id?: number;
  result?: T;
  error?: JsonRpcError;
}

interface McpInitializeResult {
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpListToolsResult {
  tools?: McpToolDescriptor[];
}

interface McpToolCallResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

interface McpPromptDescriptor {
  name: string;
  description?: string;
}

interface McpListResourcesResult {
  resources?: McpResourceDescriptor[];
}

interface McpReadResourceResult {
  contents?: unknown[];
}

interface McpListPromptsResult {
  prompts?: McpPromptDescriptor[];
}

interface McpGetPromptResult {
  description?: string;
  messages?: unknown[];
}

export class McpManager {
  private static readonly defaultConfigPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mcp.servers.json');
  private readonly configPath: string;
  private readonly logger: Logger;
  private readonly runtimeServers: RuntimeMcpServer[];
  private configSignature: string | null = null;
  private tools: Tool[] = [];
  private clients: McpServerClient[] = [];

  constructor(options: McpManagerOptions = {}) {
    this.configPath = options.configPath ?? process.env['MCP_CONFIG_PATH'] ?? McpManager.defaultConfigPath;
    this.logger = options.logger ?? console;
    this.runtimeServers = options.runtimeServers ?? [];
  }

  async refresh(): Promise<void> {
    const nextConfig = await this.loadConfig();
    const nextSignature = JSON.stringify({
      file: nextConfig,
      runtime: this.runtimeServers,
    });

    if (nextSignature === this.configSignature) {
      return;
    }

    await this.close();

    const enabledServers = [
      ...Object.entries(nextConfig.servers ?? {}),
      ...this.runtimeServers.map((server) => [server.name, server.config] as const),
    ].filter(([, server]) => server.enabled !== false);

    let hadFailures = false;
    const clients = await Promise.all(
      enabledServers.map(async ([name, server]) => {
        const client = new McpServerClient(name, server, this.logger);
        try {
          await client.connect();
          return client;
        } catch (error) {
          hadFailures = true;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`  [mcp:error] ${name}`, message);
          await client.close();
          return null;
        }
      }),
    );

    this.clients = clients.filter((client): client is McpServerClient => client !== null);
    this.tools = this.clients.flatMap((client) => client.getTools());
    this.configSignature = hadFailures ? null : nextSignature;

    if (enabledServers.length > 0) {
      this.logger.log(`  [mcp] Config refreshed, ${enabledServers.length} server(s), ${this.tools.length} tool(s)`);
    }
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  async listResources(): Promise<Array<McpResourceDescriptor & { server: string }>> {
    const resources = await Promise.all(this.clients.map((client) => client.listResources()));
    return resources.flat();
  }

  async readResource(server: string, uri: string): Promise<McpReadResourceResult | null> {
    const client = this.clients.find((item) => item.serverName === server);
    if (!client) {
      return null;
    }

    return client.readResource(uri);
  }

  async listPrompts(): Promise<Array<McpPromptDescriptor & { server: string }>> {
    const prompts = await Promise.all(this.clients.map((client) => client.listPrompts()));
    return prompts.flat();
  }

  async getPrompt(server: string, name: string, args: Record<string, unknown> = {}): Promise<McpGetPromptResult | null> {
    const client = this.clients.find((item) => item.serverName === server);
    if (!client) {
      return null;
    }

    return client.getPrompt(name, args);
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.close()));
    this.clients = [];
    this.tools = [];
  }

  private async loadConfig(): Promise<McpConfigFile> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      return JSON.parse(raw) as McpConfigFile;
    } catch {
      return { servers: {} };
    }
  }
}

class McpServerClient {
  readonly serverName: string;
  private readonly config: McpServerConfig;
  private readonly logger: Logger;
  private readonly requestTimeoutMs = 20000;
  private reconnectPromise: Promise<void> | null = null;
  private closed = false;
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private tools: Tool[] = [];

  constructor(serverName: string, config: McpServerConfig, logger: Logger) {
    this.serverName = serverName;
    this.config = config;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.process = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...(this.config.env ?? {}),
      },
      stdio: 'pipe',
      shell: false,
    });

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk);
    });
    this.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        this.logger.log(`  [mcp:${this.serverName}:stderr] ${text}`);
      }
    });
    this.process.on('exit', (code) => {
      const error = new Error(`MCP server exited with code ${code ?? 'unknown'}`);
      this.rejectAll(error);
      this.process = null;
    });
    this.process.on('error', (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.process = null;
    });

    await this.request<McpInitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'agent',
        version: '1.0.0',
      },
    });
    this.notify('notifications/initialized', {});

    const toolsResult = await this.request<McpListToolsResult>('tools/list', {});
    this.tools = (toolsResult.tools ?? []).map((tool) => this.wrapTool(tool));
  }

  getTools(): Tool[] {
    return [...this.tools];
  }

  async listResources(): Promise<Array<McpResourceDescriptor & { server: string }>> {
    const result = await this.request<McpListResourcesResult>('resources/list', {}, true);
    return (result.resources ?? []).map((resource) => ({
      ...resource,
      server: this.serverName,
    }));
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    return await this.request<McpReadResourceResult>('resources/read', { uri }, true);
  }

  async listPrompts(): Promise<Array<McpPromptDescriptor & { server: string }>> {
    const result = await this.request<McpListPromptsResult>('prompts/list', {}, true);
    return (result.prompts ?? []).map((prompt) => ({
      ...prompt,
      server: this.serverName,
    }));
  }

  async getPrompt(name: string, args: Record<string, unknown>): Promise<McpGetPromptResult> {
    return await this.request<McpGetPromptResult>('prompts/get', {
      name,
      arguments: args,
    }, true);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.rejectAll(new Error(`MCP server ${this.serverName} closed`));

    if (!this.process) {
      return;
    }

    this.process.kill();
    this.process = null;
  }

  private wrapTool(tool: McpToolDescriptor): Tool {
    const functionName = sanitizeToolName(`mcp_${this.serverName}_${tool.name}`);
    const parameters = isJsonSchemaObject(tool.inputSchema)
      ? tool.inputSchema
      : {
          type: 'object',
          properties: {},
          required: [],
        };

    return {
      definition: {
        type: 'function',
        function: {
          name: functionName,
          description: tool.description ?? `MCP tool ${tool.name} from server ${this.serverName}`,
          parameters: parameters as OpenAI.FunctionParameters,
        },
      },
      execute: async (input: Record<string, unknown>): Promise<string> => {
        const result = await this.request<McpToolCallResult>('tools/call', {
          name: tool.name,
          arguments: input,
        }, true);
        return formatMcpToolCallResult(result);
      },
    };
  }

  private async request<T>(method: string, params: Record<string, unknown>, reconnectOnFailure = false): Promise<T> {
    if (!this.process && reconnectOnFailure) {
      await this.reconnect();
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    const payload = `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`;

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);

        if (reconnectOnFailure) {
          void this.reconnect().catch((reconnectError) => {
            const message = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
            this.logger.error(`  [mcp:${this.serverName}:reconnect] ${message}`);
          });
        }

        reject(new Error(`MCP request timeout: ${this.serverName} ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      const processRef = this.process;
      if (!processRef) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(new Error(`MCP server unavailable: ${this.serverName}`));
        return;
      }

      try {
        processRef.stdin.write(payload, 'utf8', (error) => {
          if (!error) {
            return;
          }

          const pending = this.pending.get(id);
          if (!pending) {
            return;
          }

          this.pending.delete(id);
          clearTimeout(timeout);
          if (reconnectOnFailure) {
            void this.reconnect().catch((reconnectError) => {
              const message = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
              this.logger.error(`  [mcp:${this.serverName}:reconnect] ${message}`);
            });
          }
          pending.reject(error instanceof Error ? error : new Error(String(error)));
        });
      } catch (error) {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }

        this.pending.delete(id);
        clearTimeout(timeout);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    const payload = `Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`;
    this.process?.stdin.write(payload, 'utf8');
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      try {
        const message = JSON.parse(body) as JsonRpcResponse<unknown>;
        this.handleMessage(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`  [mcp:${this.serverName}:protocol] ${message}`);
        this.buffer = Buffer.alloc(0);
        this.rejectAll(new Error(`MCP protocol error: ${this.serverName}`));
        void this.reconnect().catch((reconnectError) => {
          const reconnectMessage = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
          this.logger.error(`  [mcp:${this.serverName}:reconnect] ${reconnectMessage}`);
        });
        return;
      }
    }
  }

  private handleMessage(message: JsonRpcResponse<unknown>): void {
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }

  private async reconnect(): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.reconnectPromise) {
      await this.reconnectPromise;
      return;
    }

    this.reconnectPromise = (async () => {
      await this.close();
      await sleep(300);
      await this.connect();
    })();

    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = null;
    }
  }
}

function sanitizeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatMcpToolCallResult(result: McpToolCallResult): string {
  const extractedText = Array.isArray(result.content)
    ? result.content
      .map((item) => extractMcpContentText(item))
      .filter((value): value is string => Boolean(value))
      .join('\n')
    : '';

  if (result.isError) {
    if (extractedText) {
      return JSON.stringify({ error: extractedText });
    }

    if (result.structuredContent !== undefined) {
      return JSON.stringify({ error: result.structuredContent });
    }

    return JSON.stringify({ error: result });
  }

  if (Array.isArray(result.content)) {
    if (extractedText) {
      return extractedText;
    }
  }

  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }

  return JSON.stringify(result);
}

function extractMcpContentText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return typeof value === 'string' ? value : null;
  }

  const item = value as Record<string, unknown>;
  if (item['type'] === 'text' && typeof item['text'] === 'string') {
    return item['text'];
  }

  return JSON.stringify(item);
}
