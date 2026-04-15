import { createAgentCore, disposeAgentCore, type AgentCoreOptions, type SmartSiteAgent } from '@agent/core';

export interface SessionInit {
  sessionId: string;
  userId?: string;
  userSymbol?: string;
}

export interface ChatTurnInput extends SessionInit {
  message: string;
  imageUrl?: string;
  reset?: boolean;
}

interface SessionEntry {
  agent: SmartSiteAgent;
  lastAccessAt: number;
  pending: Promise<void>;
}

export interface AgentSessionManagerOptions {
  idleTtlMs?: number;
  buildAgentOptions?: (input: SessionInit) => AgentCoreOptions;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly idleTtlMs: number;
  private readonly buildAgentOptions: (input: SessionInit) => AgentCoreOptions;

  constructor(options: AgentSessionManagerOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000;
    this.buildAgentOptions = options.buildAgentOptions ?? ((input) => ({
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.userSymbol ? { userSymbol: input.userSymbol } : {}),
    }));
  }

  async runTurn(input: ChatTurnInput): Promise<string> {
    const entry = await this.getOrCreateSession(input);

    return await this.enqueue(entry, async () => {
      entry.lastAccessAt = Date.now();

      if (input.reset) {
        entry.agent.reset();
      }

      return await entry.agent.run(input.message, input.imageUrl);
    });
  }

  async resetSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }

    await this.enqueue(entry, async () => {
      entry.lastAccessAt = Date.now();
      entry.agent.reset();
    });
    return true;
  }

  async disposeSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }

    this.sessions.delete(sessionId);
    await this.enqueue(entry, async () => {
      await disposeAgentCore(entry.agent);
    });
    return true;
  }

  async disposeIdleSessions(now = Date.now()): Promise<number> {
    const expired = [...this.sessions.entries()]
      .filter(([, entry]) => now - entry.lastAccessAt >= this.idleTtlMs)
      .map(([sessionId]) => sessionId);

    await Promise.all(expired.map(async (sessionId) => {
      await this.disposeSession(sessionId);
    }));

    return expired.length;
  }

  async shutdown(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(sessionIds.map(async (sessionId) => {
      await this.disposeSession(sessionId);
    }));
  }

  private async getOrCreateSession(input: SessionInit): Promise<SessionEntry> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      existing.lastAccessAt = Date.now();
      return existing;
    }

    const agent = await createAgentCore(this.buildAgentOptions(input));
    const entry: SessionEntry = {
      agent,
      lastAccessAt: Date.now(),
      pending: Promise.resolve(),
    };
    this.sessions.set(input.sessionId, entry);
    return entry;
  }

  private async enqueue<T>(entry: SessionEntry, task: () => Promise<T>): Promise<T> {
    const previous = entry.pending;
    let release!: () => void;
    entry.pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await task();
    } finally {
      release();
    }
  }
}
