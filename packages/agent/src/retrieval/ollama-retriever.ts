import { createHash } from 'node:crypto';

import type { MemoryIdentity, MemoryStore } from '@agent/memory';
import type { Logger, RetrievalCandidate, RetrievalResult } from '@agent/shared';

interface OllamaEmbeddingsResponse {
  embedding?: number[];
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

interface OllamaRetrieverOptions {
  baseUrl?: string;
  model?: string;
  topK?: number;
  minScore?: number;
  embeddingCacheSize?: number;
  embeddingConcurrency?: number;
  embeddingFailureRetryMs?: number;
  embeddingFailureRetryMaxMs?: number;
  availabilityRetryMs?: number;
  logger?: Logger;
  now?: () => number;
}

type EmbeddingCacheEntry =
  | {
    status: 'ready';
    embedding: number[];
  }
  | {
    status: 'failed';
    failureCount: number;
    retryAfter: number;
  };

export class OllamaRetriever {
  private readonly baseUrl: string;
  private readonly preferredModel: string;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly embeddingCacheSize: number;
  private readonly embeddingConcurrency: number;
  private readonly embeddingFailureRetryMs: number;
  private readonly embeddingFailureRetryMaxMs: number;
  private readonly availabilityRetryMs: number;
  private readonly logger: Logger;
  private readonly now: () => number;
  private enabled = false;
  private resolvedModel: string | null = null;
  private nextAvailabilityCheckAt = 0;
  private readonly embeddingCache = new Map<string, EmbeddingCacheEntry>();

  constructor(options: OllamaRetrieverOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.preferredModel = options.model ?? process.env['OLLAMA_EMBED_MODEL'] ?? 'bge-m3';
    this.topK = options.topK ?? parsePositiveInteger(process.env['RETRIEVAL_TOP_K'], 5);
    this.minScore = options.minScore ?? parseNumber(process.env['RETRIEVAL_MIN_SCORE'], 0.35);
    this.embeddingCacheSize = options.embeddingCacheSize ?? 512;
    this.embeddingConcurrency = options.embeddingConcurrency
      ?? parsePositiveInteger(process.env['RETRIEVAL_EMBED_CONCURRENCY'], 4);
    this.embeddingFailureRetryMs = options.embeddingFailureRetryMs ?? 30_000;
    this.embeddingFailureRetryMaxMs = options.embeddingFailureRetryMaxMs ?? 10 * 60_000;
    this.availabilityRetryMs = options.availabilityRetryMs ?? 30_000;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
  }

  async isEnabled(): Promise<boolean> {
    return this.ensureAvailability();
  }

  async retrieve(
    query: string,
    memoryStore: MemoryStore,
    identity: MemoryIdentity,
    sessionId?: string,
  ): Promise<RetrievalResult[]> {
    const available = await this.ensureAvailability();
    if (!available) {
      return [];
    }

    const queryEmbedding = await this.embed(query, memoryStore);
    if (!queryEmbedding) {
      return [];
    }

    const candidates = getRetrievalCandidates(memoryStore, identity, sessionId);
    const scored = await mapWithConcurrency(candidates, this.embeddingConcurrency, async (candidate) => {
      const candidateEmbedding = await this.embed(candidate.content, memoryStore);
      if (!candidateEmbedding) {
        return null;
      }

      const score = cosineSimilarity(queryEmbedding, candidateEmbedding);
      if (score >= this.minScore) {
        return { candidate, score };
      }

      return null;
    });

    return scored
      .filter((result): result is RetrievalResult => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, this.topK);
  }

  getModelName(): string | null {
    return this.resolvedModel;
  }

  private async ensureAvailability(): Promise<boolean> {
    if (this.enabled) {
      return true;
    }

    if (this.now() < this.nextAvailabilityCheckAt) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        this.scheduleAvailabilityRetry();
        this.logger.log('  [retrieval] Ollama probe failed, retrieval disabled');
        return false;
      }

      const payload = (await response.json()) as OllamaTagsResponse;
      const modelNames = (payload.models ?? [])
        .flatMap((model) => [model.name, model.model])
        .filter((name): name is string => Boolean(name));
      const matchedModel = modelNames.find((name) => name === this.preferredModel)
        ?? modelNames.find((name) => name.startsWith(`${this.preferredModel}:`))
        ?? modelNames.find((name) => name.includes('bge-m3'));

      if (!matchedModel) {
        this.scheduleAvailabilityRetry();
        this.logger.log('  [retrieval] No local bge-m3-like model found, retrieval disabled');
        return false;
      }

      this.resolvedModel = matchedModel;
      this.enabled = true;
      this.nextAvailabilityCheckAt = 0;
      this.logger.log(`  [retrieval] Enabled with model ${matchedModel}`);
      return true;
    } catch {
      this.scheduleAvailabilityRetry();
      this.logger.log('  [retrieval] Ollama unavailable, retrieval disabled');
      return false;
    }
  }

  private scheduleAvailabilityRetry(): void {
    this.enabled = false;
    this.resolvedModel = null;
    this.nextAvailabilityCheckAt = this.now() + this.availabilityRetryMs;
  }

  private async embed(text: string, memoryStore: MemoryStore): Promise<number[] | null> {
    if (!this.resolvedModel) {
      return null;
    }

    const contentHash = hashText(text);
    const cacheKey = `${this.resolvedModel}:${contentHash}`;
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      this.touchEmbeddingCache(cacheKey, cached);
      if (cached.status === 'ready') {
        return cached.embedding;
      }

      if (this.now() < cached.retryAfter) {
        return null;
      }
    }

    const persisted = memoryStore.getEmbeddingCache(this.resolvedModel, contentHash);
    if (persisted?.status === 'ready' && persisted.embedding) {
      this.storeEmbeddingCache(cacheKey, { status: 'ready', embedding: persisted.embedding });
      return persisted.embedding;
    }

    if (persisted?.status === 'failed' && persisted.retryAfter && this.now() < persisted.retryAfter) {
      this.storeEmbeddingCache(cacheKey, {
        status: 'failed',
        failureCount: persisted.failureCount,
        retryAfter: persisted.retryAfter,
      });
      return null;
    }

    const previousFailureCount = cached?.status === 'failed'
      ? cached.failureCount
      : persisted?.failureCount ?? 0;

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.resolvedModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        this.storeFailedEmbedding(memoryStore, cacheKey, this.resolvedModel, contentHash, text, `HTTP ${response.status}`, previousFailureCount);
        return null;
      }

      const payload = (await response.json()) as OllamaEmbeddingsResponse;
      const embedding = isNumberArray(payload.embedding) ? payload.embedding : null;
      if (!embedding) {
        this.storeFailedEmbedding(memoryStore, cacheKey, this.resolvedModel, contentHash, text, 'Invalid embedding payload', previousFailureCount);
        return null;
      }

      this.storeEmbeddingCache(cacheKey, { status: 'ready', embedding });
      memoryStore.upsertReadyEmbedding(this.resolvedModel, contentHash, text, embedding);
      return embedding;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.storeFailedEmbedding(memoryStore, cacheKey, this.resolvedModel, contentHash, text, message, previousFailureCount);
      return null;
    }
  }

  private touchEmbeddingCache(key: string, value: EmbeddingCacheEntry): void {
    this.embeddingCache.delete(key);
    this.embeddingCache.set(key, value);
  }

  private storeEmbeddingCache(key: string, value: EmbeddingCacheEntry): void {
    this.embeddingCache.set(key, value);

    if (this.embeddingCache.size <= this.embeddingCacheSize) {
      return;
    }

    const oldestKey = this.embeddingCache.keys().next().value;
    if (oldestKey) {
      this.embeddingCache.delete(oldestKey);
    }
  }

  private storeFailedEmbedding(
    memoryStore: MemoryStore,
    cacheKey: string,
    model: string,
    contentHash: string,
    text: string,
    error: string,
    previousFailureCount: number,
  ): void {
    const failureCount = previousFailureCount + 1;
    const retryAfter = this.now() + Math.min(
      this.embeddingFailureRetryMs * (2 ** (failureCount - 1)),
      this.embeddingFailureRetryMaxMs,
    );

    this.storeEmbeddingCache(cacheKey, { status: 'failed', failureCount, retryAfter });
    memoryStore.upsertFailedEmbedding(model, contentHash, text, error, failureCount, retryAfter);
  }
}

export function formatRetrievalContext(results: RetrievalResult[]): string | null {
  if (results.length === 0) {
    return null;
  }

  const lines = results.map(
    ({ candidate, score }) => `- (${score.toFixed(3)}) [${candidate.source}] ${candidate.content}`,
  );

  return ['[RETRIEVAL_CONTEXT]', 'Relevant retrieved context:', ...lines].join('\n');
}

export function getRetrievalCandidates(
  memoryStore: Pick<MemoryStore, 'listMemories' | 'listConversationLogs'>,
  identity: MemoryIdentity,
  sessionId?: string,
): RetrievalCandidate[] {
  const memories = memoryStore.listMemories(undefined, identity).map((memory) => ({
    id: `memory:${memory.id}:${memory.updatedAt}`,
    source: `memory/${memory.scope}/${memory.key}`,
    content: `[${memory.scope}] ${memory.key}: ${memory.value}`,
  }));
  const logs = memoryStore.listConversationLogs(sessionId, identity)
    .filter((log) => log.role === 'user' || log.role === 'assistant')
    .slice(-120)
    .map((log) => ({
      id: `conversation:${log.id}`,
      source: `conversation/${log.role}`,
      content: `[${log.role}] ${truncateForRetrieval(log.content, 500)}`,
    }));

  return [...memories, ...logs];
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function truncateForRetrieval(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      const item = items[index];
      if (item === undefined) {
        return;
      }

      results[index] = await mapper(item);
    }
  });

  await Promise.all(workers);
  return results;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
