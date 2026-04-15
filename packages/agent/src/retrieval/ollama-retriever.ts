import type { MemoryStore } from '../memory/index.ts';
import type { MemoryIdentity } from '../memory/memory-store.ts';
import type { Logger, RetrievalCandidate, RetrievalResult } from '../types.ts';

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
  logger?: Logger;
}

export class OllamaRetriever {
  private readonly baseUrl: string;
  private readonly preferredModel: string;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly logger: Logger;
  private availabilityChecked = false;
  private enabled = false;
  private resolvedModel: string | null = null;

  constructor(options: OllamaRetrieverOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.preferredModel = options.model ?? process.env['OLLAMA_EMBED_MODEL'] ?? 'bge-m3';
    this.topK = options.topK ?? 5;
    this.minScore = options.minScore ?? 0.35;
    this.logger = options.logger ?? console;
  }

  async isEnabled(): Promise<boolean> {
    return this.ensureAvailability();
  }

  async retrieve(
    query: string,
    memoryStore: MemoryStore,
    identity: MemoryIdentity,
  ): Promise<RetrievalResult[]> {
    const available = await this.ensureAvailability();
    if (!available) {
      return [];
    }

    const queryEmbedding = await this.embed(query);
    if (!queryEmbedding) {
      return [];
    }

    const candidates = getCandidates(memoryStore, identity);
    const scored: RetrievalResult[] = [];

    for (const candidate of candidates) {
      const candidateEmbedding = await this.embed(candidate.content);
      if (!candidateEmbedding) {
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, candidateEmbedding);
      if (score >= this.minScore) {
        scored.push({ candidate, score });
      }
    }

    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, this.topK);
  }

  getModelName(): string | null {
    return this.resolvedModel;
  }

  private async ensureAvailability(): Promise<boolean> {
    if (this.availabilityChecked) {
      return this.enabled;
    }

    this.availabilityChecked = true;

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
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
        this.logger.log('  [retrieval] No local bge-m3-like model found, retrieval disabled');
        return false;
      }

      this.resolvedModel = matchedModel;
      this.enabled = true;
      this.logger.log(`  [retrieval] Enabled with model ${matchedModel}`);
      return true;
    } catch {
      this.logger.log('  [retrieval] Ollama unavailable, retrieval disabled');
      return false;
    }
  }

  private async embed(text: string): Promise<number[] | null> {
    if (!this.resolvedModel) {
      return null;
    }

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
        return null;
      }

      const payload = (await response.json()) as OllamaEmbeddingsResponse;
      return Array.isArray(payload.embedding) ? payload.embedding : null;
    } catch {
      return null;
    }
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

function getCandidates(memoryStore: MemoryStore, identity: MemoryIdentity): RetrievalCandidate[] {
  const memories = memoryStore.listMemories(undefined, identity).map((memory) => ({
    id: `memory:${memory.id}`,
    source: `memory/${memory.scope}/${memory.key}`,
    content: `[${memory.scope}] ${memory.key}: ${memory.value}`,
  }));
  const logs = memoryStore.listConversationLogs(undefined, identity)
    .slice(-120)
    .map((log) => ({
      id: `conversation:${log.id}`,
      source: `conversation/${log.role}`,
      content: `[${log.role}] ${log.content}`,
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
