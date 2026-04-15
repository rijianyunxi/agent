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

    this.messages = [...pinned, ...dynamic.slice(-allowedDynamicCount)];
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
