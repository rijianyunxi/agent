import type OpenAI from 'openai';

interface SlidingWindowOptions {
  maxMessages?: number;
}

export class SlidingWindow {
  private readonly maxMessages: number;
  private messages: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(options: SlidingWindowOptions = {}) {
    this.maxMessages = options.maxMessages ?? 40;
  }

  initialize(messages: OpenAI.ChatCompletionMessageParam[]): void {
    this.messages = [...messages];
    this.trim();
  }

  replacePinned(messages: OpenAI.ChatCompletionMessageParam[]): void {
    const dynamicMessages = this.messages.slice(this.getPinnedCount());
    this.messages = [...messages, ...dynamicMessages];
    this.trim();
  }

  append(message: OpenAI.ChatCompletionMessageParam): void {
    this.messages.push(message);
    this.trim();
  }

  getMessages(): OpenAI.ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  private trim(): void {
    const pinnedCount = this.getPinnedCount();
    if (this.messages.length <= pinnedCount) {
      return;
    }

    const pinned = this.messages.slice(0, pinnedCount);
    const dynamic = this.messages.slice(pinnedCount);
    const allowedDynamicCount = Math.max(this.maxMessages - pinnedCount, 0);

    if (dynamic.length <= allowedDynamicCount) {
      return;
    }

    const trimmedDynamic = dynamic.slice(-allowedDynamicCount);
    const startIndex = findValidDynamicStartIndex(trimmedDynamic);
    this.messages = [...pinned, ...trimmedDynamic.slice(startIndex)];
  }

  private getPinnedCount(): number {
    let pinnedCount = 0;

    for (const message of this.messages) {
      if (message.role !== 'system') {
        break;
      }

      pinnedCount += 1;
    }

    return pinnedCount;
  }
}

function findValidDynamicStartIndex(messages: OpenAI.ChatCompletionMessageParam[]): number {
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!message) {
      return index;
    }

    if (message.role === 'tool') {
      index += 1;
      continue;
    }

    if (isAssistantToolCallMessage(message) && !hasCompleteToolTransaction(messages, index)) {
      index = findNextNonToolIndex(messages, index + 1);
      continue;
    }

    return index;
  }

  return index;
}

function isAssistantToolCallMessage(
  message: OpenAI.ChatCompletionMessageParam,
): message is OpenAI.ChatCompletionAssistantMessageParam & {
  tool_calls: OpenAI.ChatCompletionMessageToolCall[];
} {
  return message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function hasCompleteToolTransaction(messages: OpenAI.ChatCompletionMessageParam[], startIndex: number): boolean {
  const message = messages[startIndex];
  if (!message || !isAssistantToolCallMessage(message)) {
    return true;
  }

  const expectedToolIds = new Set(message.tool_calls.map((toolCall) => toolCall.id));
  if (expectedToolIds.size === 0) {
    return true;
  }

  let cursor = startIndex + 1;
  while (cursor < messages.length) {
    const current = messages[cursor];
    if (!current || current.role !== 'tool') {
      break;
    }

    if (typeof current.tool_call_id === 'string') {
      expectedToolIds.delete(current.tool_call_id);
    }
    cursor += 1;
  }

  return expectedToolIds.size === 0;
}

function findNextNonToolIndex(messages: OpenAI.ChatCompletionMessageParam[], startIndex: number): number {
  let index = startIndex;

  while (index < messages.length && messages[index]?.role === 'tool') {
    index += 1;
  }

  return index;
}
