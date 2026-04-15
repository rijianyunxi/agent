import { fileURLToPath } from 'node:url';
import path from 'node:path';

import OpenAI from 'openai';

import type { MemoryIdentity } from './memory/memory-store.ts';
import { McpManager } from './mcp/manager.ts';
import { MemoryStore, SlidingWindow } from './memory/index.ts';
import { formatRetrievalContext, OllamaRetriever } from './retrieval/ollama-retriever.ts';
import { createToolRegistry } from './tools/index.ts';
import type { AgentUserContentPart, Logger } from './types.ts';

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type FunctionToolCall = OpenAI.ChatCompletionMessageFunctionToolCall;
type ChatCompletionResponse = Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;

export interface SmartSiteAgentOptions {
  maxIterations?: number;
  logger?: Logger;
  memoryDbPath?: string;
  maxWindowMessages?: number;
  userId?: string;
  userSymbol?: string;
  modelTimeoutMs?: number;
  modelMaxRetries?: number;
}

interface ToolRegistry {
  toolDefinitions: OpenAI.ChatCompletionFunctionTool[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export class SmartSiteAgent {
  private client: OpenAI;
  private model = 'gpt-5.4';
  private maxIterations: number;
  private readonly modelTimeoutMs: number;
  private readonly modelMaxRetries: number;
  private logger: Logger;
  private readonly memoryStore: MemoryStore;
  private readonly window: SlidingWindow;
  private readonly retriever: OllamaRetriever;
  private readonly mcpManager: McpManager;
  private readonly systemPrompt = [
    '你是一个智慧工地 AI 助手，负责帮助工地管理人员查询和分析工地相关信息。',
    '你可以调用本地 MCP 工具、外部 MCP 工具、长期记忆，以及在可用时使用前置检索上下文。',
    '回答要求：',
    '- 用简洁清晰的中文回答。',
    '- 数据类问题先调用工具获取事实，再基于结果回答。',
    '- 没有数据时明确说明，不要编造。',
    '- 识别到稳定偏好或长期事实时，可以写入长期记忆。',
  ].join('\n');
  private sessionId = crypto.randomUUID();
  private readonly packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  private readonly userId: string | null;
  private readonly userSymbol: string | null;
  private memoryContext: string | null = null;
  private retrievalContext: string | null = null;
  private toolRegistry: ToolRegistry | null = null;

  constructor(options: SmartSiteAgentOptions = {}) {
    this.maxIterations = options.maxIterations ?? 10;
    this.modelTimeoutMs = options.modelTimeoutMs ?? 30000;
    this.modelMaxRetries = options.modelMaxRetries ?? 2;
    this.logger = options.logger ?? console;
    this.userId = options.userId ?? null;
    this.userSymbol = options.userSymbol ?? null;
    this.memoryStore = options.memoryDbPath
      ? new MemoryStore({ dbPath: options.memoryDbPath })
      : new MemoryStore();
    this.window = new SlidingWindow({
      maxMessages: options.maxWindowMessages ?? 40,
    });
    this.retriever = new OllamaRetriever({ logger: this.logger });
    this.mcpManager = new McpManager({
      logger: this.logger,
      runtimeServers: [
        {
          name: 'local',
          config: {
            command: 'tsx',
            args: ['src/mcp/local-server.ts'],
            cwd: this.packageRoot,
            env: {
              ...(process.env['MEMORY_DB_PATH'] ? { MEMORY_DB_PATH: process.env['MEMORY_DB_PATH'] } : {}),
              ...(this.userId ? { AGENT_USER_ID: this.userId } : {}),
              ...(this.userSymbol ? { AGENT_USER_SYMBOL: this.userSymbol } : {}),
              LOCAL_MCP_SESSION_ID: this.sessionId,
            },
            enabled: true,
          },
        },
      ],
    });
    this.client = new OpenAI({
      baseURL: 'https://ai.letus.lol/v1',
      apiKey: process.env['OPENAI_API_KEY'],
    });
  }

  async initialize(): Promise<void> {
    this.memoryStore.initialize();
    this.memoryContext = this.memoryStore.formatMemoryContext(['global', 'user', 'site'], this.getIdentity());
    await this.mcpManager.refresh();
    this.toolRegistry = createToolRegistry({
      logger: this.logger,
      dynamicTools: this.mcpManager.getTools(),
    });
    this.reset();
  }

  async run(userText: string, image?: string | AgentUserContentPart[]): Promise<string> {
    if (!this.toolRegistry) {
      throw new Error('Agent is not initialized. Call initialize() first.');
    }

    await this.mcpManager.refresh();
    this.toolRegistry = createToolRegistry({
      logger: this.logger,
      dynamicTools: this.mcpManager.getTools(),
    });
    await this.refreshRetrievalContext(userText);

    if (Array.isArray(image) && image.length > 0) {
      this.appendMessage({
        role: 'user',
        content: normalizeUserContent(userText, image),
      });
    } else if (typeof image === 'string' && image.length > 0) {
      this.appendMessage({
        role: 'user',
        content: normalizeUserContent(userText, [
          {
            type: 'image_url',
            image_url: { url: image },
          },
        ]),
      });
    } else {
      this.appendMessage({ role: 'user', content: userText });
    }

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      this.logger.log(`\n  [agent] Iteration ${iteration + 1}`);

      const response = await this.callModelWithRetry({
        model: this.model,
        tools: this.toolRegistry.toolDefinitions,
        messages: this.window.getMessages(),
      });

      const choice = response.choices[0];
      if (!choice) {
        return '抱歉，当前没有拿到模型返回结果。';
      }

      const message = choice.message;
      if (choice.finish_reason !== 'tool_calls' || !message.tool_calls?.length) {
        const textContent = message.content ?? '';
        this.appendMessage({ role: 'assistant', content: textContent });
        return textContent;
      }

      this.appendMessage({
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      });

      const toolCalls = message.tool_calls.filter(
        (toolCall): toolCall is FunctionToolCall => toolCall.type === 'function',
      );

      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall: FunctionToolCall) => {
          try {
            const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            const result = await this.toolRegistry!.executeTool(toolCall.function.name, args);
            return { tool_call_id: toolCall.id, content: result };
          } catch {
            return {
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: '工具参数解析失败，请重试' }),
            };
          }
        }),
      );

      toolResults.forEach(({ tool_call_id, content }: { tool_call_id: string; content: string }) => {
        this.appendMessage({ role: 'tool', tool_call_id, content });
      });

      const latestMemoryContext = this.memoryStore.formatMemoryContext(['global', 'user', 'site'], this.getIdentity());
      if (latestMemoryContext !== this.memoryContext) {
        this.memoryContext = latestMemoryContext;
        this.rebuildWindow();
      }
    }

    return '抱歉，处理轮次过多，请简化您的问题。';
  }

  reset(): void {
    this.retrievalContext = null;
    this.rebuildWindow();
    this.logger.log('  [agent] Conversation reset');
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.close();
    this.memoryStore.close();
  }

  private getIdentity(): MemoryIdentity {
    return {
      userId: this.userId,
      userSymbol: this.userSymbol,
    };
  }

  private async refreshRetrievalContext(userText: string): Promise<void> {
    const results = await this.retriever.retrieve(userText, this.memoryStore, this.getIdentity());
    this.retrievalContext = formatRetrievalContext(results);
    this.rebuildWindow();
  }

  private async callModelWithRetry(params: ChatCompletionCreateParams): Promise<Extract<ChatCompletionResponse, { choices: unknown }>> {
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.modelTimeoutMs);

      try {
        return await this.client.chat.completions.create(
          params,
          { signal: controller.signal },
        ) as Extract<ChatCompletionResponse, { choices: unknown }>;
      } catch (error) {
        attempt += 1;

        if (attempt > this.modelMaxRetries || !isRetryableModelError(error)) {
          throw error;
        }

        const backoffMs = Math.min(1000 * (2 ** (attempt - 1)), 4000);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.log(`  [model:retry] attempt=${attempt} backoff=${backoffMs}ms reason=${message}`);
        await sleep(backoffMs);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private rebuildWindow(): void {
    const pinnedMessages: ChatMessage[] = [
      {
        role: 'system',
        content: this.systemPrompt,
      },
    ];

    if (this.memoryContext) {
      pinnedMessages.push({
        role: 'system',
        content: this.memoryContext,
      });
    }

    if (this.retrievalContext) {
      pinnedMessages.push({
        role: 'system',
        content: this.retrievalContext,
      });
    }

    if (this.window.getMessages().length === 0) {
      this.window.initialize(pinnedMessages);
      return;
    }

    this.window.replacePinned(pinnedMessages);
  }

  private appendMessage(message: ChatMessage): void {
    this.memoryStore.appendConversationLog(
      this.sessionId,
      message.role,
      serializeMessageContent(message),
      this.getIdentity(),
    );
    this.window.append(message);
  }
}

type ChatCompletionCreateParams = Parameters<OpenAI['chat']['completions']['create']>[0];

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeStatus = (error as Error & { status?: number }).status;
  if (maybeStatus === 408 || maybeStatus === 429) {
    return true;
  }

  if (typeof maybeStatus === 'number' && maybeStatus >= 500) {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes('timeout')
    || message.includes('timed out')
    || message.includes('network')
    || message.includes('socket')
    || message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('fetch failed');
}

function serializeMessageContent(message: ChatMessage): string {
  if (message.role === 'tool') {
    return typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return JSON.stringify(message.content);
  }

  return JSON.stringify(message);
}

function normalizeUserContent(
  userText: string,
  parts: AgentUserContentPart[],
): Array<OpenAI.ChatCompletionContentPartText | OpenAI.ChatCompletionContentPartImage> {
  const normalizedParts: Array<OpenAI.ChatCompletionContentPartText | OpenAI.ChatCompletionContentPartImage> = [];

  parts.forEach((part) => {
    if (part.type === 'text') {
      normalizedParts.push({ type: 'text', text: part.text });
      return;
    }

    normalizedParts.push({
      type: 'image_url',
      image_url: {
        url: part.image_url.url,
      },
    });
  });

  if (!normalizedParts.some((part) => part.type === 'text')) {
    normalizedParts.push({ type: 'text', text: userText });
  }

  return normalizedParts;
}
