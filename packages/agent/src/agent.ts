import { fileURLToPath } from 'node:url';
import path from 'node:path';

import OpenAI from 'openai';

import { McpManager } from '@agent/mcp';
import { MemoryStore, SlidingWindow, type MemoryIdentity } from '@agent/memory';
import { createToolRegistry } from '@agent/tools';
import type { AgentUserContentPart, Logger } from '@agent/shared';

import { formatRetrievalContext, OllamaRetriever } from './retrieval/ollama-retriever.ts';

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type FunctionToolCall = OpenAI.ChatCompletionMessageFunctionToolCall;
type ChatCompletionResponse = Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;

const LOCAL_MCP_SERVER_ENTRY = new URL('../../tools/src/local-server.ts', import.meta.url);

export interface SmartSiteAgentOptions {
  maxIterations?: number;
  logger?: Logger;
  memoryDbPath?: string;
  maxWindowMessages?: number;
  userId?: string;
  userSymbol?: string;
  model?: string;
  openaiBaseUrl?: string;
  modelTimeoutMs?: number;
  modelMaxRetries?: number;
}

interface ToolRegistry {
  toolDefinitions: OpenAI.ChatCompletionFunctionTool[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}

export class SmartSiteAgent {
  private client: OpenAI;
  private readonly model: string;
  private maxIterations: number;
  private readonly modelTimeoutMs: number;
  private readonly modelMaxRetries: number;
  private readonly memoryDbPath: string;
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
  private readonly sessionId = crypto.randomUUID();
  private readonly userId: string | null;
  private readonly userSymbol: string | null;
  private memoryContext: string | null = null;
  private retrievalContext: string | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private lastToolProgressSignature: string | null = null;
  private repeatedToolProgressCount = 0;

  constructor(options: SmartSiteAgentOptions = {}) {
    this.maxIterations = options.maxIterations ?? 10;
    this.modelTimeoutMs = options.modelTimeoutMs ?? 30000;
    this.modelMaxRetries = options.modelMaxRetries ?? 2;
    this.model = options.model ?? process.env['AGENT_MODEL'] ?? 'gpt-5.4';
    this.memoryDbPath = path.resolve(options.memoryDbPath ?? process.env['MEMORY_DB_PATH'] ?? 'memory.db');
    this.logger = options.logger ?? console;
    this.userId = options.userId ?? null;
    this.userSymbol = options.userSymbol ?? null;
    this.memoryStore = new MemoryStore({ dbPath: this.memoryDbPath });
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
            args: [fileURLToPath(LOCAL_MCP_SERVER_ENTRY)],
            cwd: path.dirname(fileURLToPath(LOCAL_MCP_SERVER_ENTRY)),
            env: {
              MEMORY_DB_PATH: this.memoryDbPath,
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
      baseURL: options.openaiBaseUrl ?? process.env['OPENAI_BASE_URL'] ?? 'https://ai.letus.lol/v1',
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
    if (this.toolRegistry.toolDefinitions.length === 0 && requiresTooling(userText)) {
      return '当前数据工具暂不可用，请稍后重试。';
    }

    await this.refreshRetrievalContext(userText);
    const windowSnapshot = this.window.getMessages();
    const conversationLogMarker = this.memoryStore.getLatestConversationLogId(this.sessionId, this.getIdentity());

    try {
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
          this.lastToolProgressSignature = null;
          this.repeatedToolProgressCount = 0;
          const finalReply = resolveFinalReply(choice.finish_reason, message.content);
          this.appendMessage({ role: 'assistant', content: finalReply });
          return finalReply;
        }

        if (choice.finish_reason !== 'tool_calls') {
          this.lastToolProgressSignature = null;
          this.repeatedToolProgressCount = 0;
          const finalReply = resolveFinalReply(choice.finish_reason, message.content);
          this.appendMessage({ role: 'assistant', content: finalReply });
          return finalReply;
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
            let args: Record<string, unknown>;

            try {
              args = parseToolArguments(toolCall.function.arguments);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.error(`  [tool:args:error] ${toolCall.function.name}`, message);
              return {
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: '工具参数解析失败，请检查输入后重试',
                  detail: message,
                }),
              };
            }

            try {
              const result = await this.toolRegistry!.executeTool(toolCall.function.name, args);
              return { tool_call_id: toolCall.id, content: result };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.error(`  [tool:execute:error] ${toolCall.function.name}`, message);
              return {
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: '工具执行失败，请稍后重试',
                  detail: message,
                }),
              };
            }
          }),
        );

        toolResults.forEach(({ tool_call_id, content }: { tool_call_id: string; content: string }) => {
          this.appendMessage({ role: 'tool', tool_call_id, content });
        });

        if (toolResults.every(({ content }) => isToolErrorContent(content))) {
          this.lastToolProgressSignature = null;
          this.repeatedToolProgressCount = 0;
          const reply = '抱歉，当前数据工具执行失败，请稍后重试。';
          this.appendMessage({ role: 'assistant', content: reply });
          return reply;
        }

        const progressSignature = buildToolProgressSignature(toolCalls, toolResults);
        if (progressSignature === this.lastToolProgressSignature) {
          this.repeatedToolProgressCount += 1;
        } else {
          this.lastToolProgressSignature = progressSignature;
          this.repeatedToolProgressCount = 0;
        }

        if (this.repeatedToolProgressCount >= 1) {
          this.lastToolProgressSignature = null;
          this.repeatedToolProgressCount = 0;
          const reply = '抱歉，工具调用结果重复且没有新的进展，请稍后重试或换个问法。';
          this.appendMessage({ role: 'assistant', content: reply });
          return reply;
        }

        const latestMemoryContext = this.memoryStore.formatMemoryContext(['global', 'user', 'site'], this.getIdentity());
        if (latestMemoryContext !== this.memoryContext) {
          this.memoryContext = latestMemoryContext;
          this.rebuildWindow();
        }
      }

      this.lastToolProgressSignature = null;
      this.repeatedToolProgressCount = 0;
      return '抱歉，处理轮次过多，请简化您的问题。';
    } catch (error) {
      this.lastToolProgressSignature = null;
      this.repeatedToolProgressCount = 0;
      this.window.initialize(windowSnapshot);
      this.memoryStore.deleteConversationLogsAfter(this.sessionId, conversationLogMarker, this.getIdentity());
      throw error;
    }
  }

  reset(): void {
    this.memoryStore.deleteConversationLogsAfter(this.sessionId, null, this.getIdentity());
    this.retrievalContext = null;
    this.lastToolProgressSignature = null;
    this.repeatedToolProgressCount = 0;
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
    const results = await this.retriever.retrieve(userText, this.memoryStore, this.getIdentity(), this.sessionId);
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

export function buildToolProgressSignature(
  toolCalls: FunctionToolCall[],
  toolResults: Array<{ tool_call_id: string; content: string }>,
): string {
  return JSON.stringify({
    toolCalls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })),
    toolResults: toolResults.map((toolResult) => ({
      tool_call_id: toolResult.tool_call_id,
      content: toolResult.content,
    })),
  });
}

export function resolveFinalReply(
  finishReason: string | null,
  content: string | null,
): string {
  if (finishReason === 'length') {
    return '抱歉，回复长度超限，请缩小问题范围后重试。';
  }

  if (finishReason === 'content_filter') {
    return '抱歉，该请求触发了内容限制，无法完整回答。';
  }

  if (finishReason === 'tool_calls') {
    return content ?? '';
  }

  const text = content?.trim();
  if (text) {
    return text;
  }

  return '抱歉，本次没有生成有效回复。';
}

export function requiresTooling(userText: string): boolean {
  const text = userText.trim().toLowerCase();
  if (!text) {
    return false;
  }

  const toolKeywords = [
    '考勤',
    '巡检',
    '人数',
    '出勤',
    '缺勤',
    '请假',
    '迟到',
    '隐患',
    '整改',
    '工地',
    '现场',
    '查询',
    '统计',
    '数据',
    '记录',
    'attendance',
    'inspection',
    'report',
    'count',
    'site',
  ];

  return toolKeywords.some((keyword) => text.includes(keyword));
}

function isToolErrorContent(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) && typeof parsed['error'] === 'string' && parsed['error'].length > 0;
  } catch {
    return false;
  }
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

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeMessageContent(message: ChatMessage): string {
  if (message.role === 'tool') {
    return sanitizeConversationLogContent(
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    );
  }

  if (typeof message.content === 'string') {
    return sanitizeConversationLogContent(message.content);
  }

  if (Array.isArray(message.content)) {
    return sanitizeConversationLogContent(JSON.stringify(message.content));
  }

  return sanitizeConversationLogContent(JSON.stringify(message));
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

export function sanitizeConversationLogContent(value: string): string {
  const withoutDataUrls = value.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, '[image-data]');
  const masked = withoutDataUrls
    .replace(/\b1\d{10}\b/g, '[redacted-phone]')
    .replace(/\b\d{15,18}[0-9Xx]\b/g, '[redacted-id]')
    .replace(/\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[redacted-secret]');

  if (masked.length <= 2000) {
    return masked;
  }

  return `${masked.slice(0, 2000)}...`;
}
