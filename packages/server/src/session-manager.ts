import type { AgentCoreOptions, SmartSiteAgent } from '@agent/core';

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
  createdAt: number;
  lastAccessAt: number;
  activeRequests: number;
  pending: Promise<void>;
  userId?: string;
  userSymbol?: string;
}

export interface AgentSessionManagerOptions {
  idleTtlMs?: number;
  maxLifetimeMs?: number;
  buildAgentOptions?: (input: SessionInit) => AgentCoreOptions;
  createAgent?: (options: AgentCoreOptions) => Promise<SmartSiteAgent>;
  disposeAgent?: (agent: SmartSiteAgent) => Promise<void>;
}

export class AgentSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly creatingSessions = new Map<string, Promise<SessionEntry>>();
  private readonly idleTtlMs: number;
  private readonly maxLifetimeMs: number;
  private readonly buildAgentOptions: (input: SessionInit) => AgentCoreOptions;
  private readonly createAgent: (options: AgentCoreOptions) => Promise<SmartSiteAgent>;
  private readonly disposeAgent: (agent: SmartSiteAgent) => Promise<void>;

  constructor(options: AgentSessionManagerOptions = {}) {
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000;
    this.maxLifetimeMs = options.maxLifetimeMs ?? 2 * 60 * 60 * 1000;
    this.buildAgentOptions = options.buildAgentOptions ?? ((input) => ({
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.userSymbol ? { userSymbol: input.userSymbol } : {}),
    }));
    this.createAgent = options.createAgent ?? createDefaultAgent;
    this.disposeAgent = options.disposeAgent ?? disposeDefaultAgent;
  }

  async runTurn(input: ChatTurnInput): Promise<string> {
    const entry = await this.getOrCreateSession(input);

    return await this.enqueue(entry, async () => {
      entry.activeRequests += 1;
      entry.lastAccessAt = Date.now();

      try {
        if (input.reset) {
          entry.agent.reset();
        }

        return await entry.agent.run(input.message, input.imageUrl);
      } finally {
        entry.activeRequests = Math.max(entry.activeRequests - 1, 0);
      }
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
      await this.disposeAgent(entry.agent);
    });
    return true;
  }

  async disposeIdleSessions(now = Date.now()): Promise<number> {
    const expired = [...this.sessions.entries()]
      .filter(([, entry]) => this.shouldDisposeSession(entry, now))
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
      this.assertSessionIdentity(existing, input);
      existing.lastAccessAt = Date.now();
      return existing;
    }

    const creating = this.creatingSessions.get(input.sessionId);
    if (creating) {
      const entry = await creating;
      this.assertSessionIdentity(entry, input);
      entry.lastAccessAt = Date.now();
      return entry;
    }

    const createPromise = (async () => {
      const agent = await this.createAgent(this.buildAgentOptions(input));
      const now = Date.now();
      const entry: SessionEntry = {
        agent,
        createdAt: now,
        lastAccessAt: now,
        activeRequests: 0,
        pending: Promise.resolve(),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.userSymbol ? { userSymbol: input.userSymbol } : {}),
      };
      this.sessions.set(input.sessionId, entry);
      return entry;
    })();

    this.creatingSessions.set(input.sessionId, createPromise);

    try {
      return await createPromise;
    } finally {
      this.creatingSessions.delete(input.sessionId);
    }
  }

  private assertSessionIdentity(entry: SessionEntry, input: SessionInit): void {
    const entryUserId = entry.userId ?? null;
    const entryUserSymbol = entry.userSymbol ?? null;
    const inputUserId = input.userId ?? null;
    const inputUserSymbol = input.userSymbol ?? null;

    if (entryUserId !== inputUserId || entryUserSymbol !== inputUserSymbol) {
      throw new Error('session identity mismatch');
    }
  }

  private shouldDisposeSession(entry: SessionEntry, now: number): boolean {
    if (entry.activeRequests > 0) {
      return false;
    }

    const idleExpired = now - entry.lastAccessAt >= this.idleTtlMs;
    const lifetimeExpired = now - entry.createdAt >= this.maxLifetimeMs;
    return idleExpired || lifetimeExpired;
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

async function createDefaultAgent(options: AgentCoreOptions): Promise<SmartSiteAgent> {
  const { createAgentCore } = await import('@agent/core');
  return await createAgentCore(options);
}

async function disposeDefaultAgent(agent: SmartSiteAgent): Promise<void> {
  const { disposeAgentCore } = await import('@agent/core');
  await disposeAgentCore(agent);
}
