import Database from 'better-sqlite3';

import type { ConversationLogRecord, MemoryRecord, MemoryScope } from '@agent/shared';

interface MemoryStoreOptions {
  dbPath?: string;
}

export interface MemoryIdentity {
  userId: string | null;
  userSymbol: string | null;
}

interface MemoryRow {
  id: number;
  session_id: string;
  user_id: string | null;
  user_symbol: string | null;
  scope: MemoryScope;
  key: string;
  value: string;
  created_at: number;
  updated_at: number;
}

interface ConversationLogRow {
  id: number;
  session_id: string;
  user_id: string | null;
  user_symbol: string | null;
  role: string;
  content: string;
  timestamp: number;
}

interface EmbeddingCacheRow {
  model: string;
  content_hash: string;
  content: string;
  embedding_json: string | null;
  status: EmbeddingCacheStatus;
  error: string | null;
  failure_count: number;
  retry_after: number | null;
  created_at: number;
  updated_at: number;
  last_used_at: number;
}

const DEFAULT_MEMORY_IDENTITY: MemoryIdentity = { userId: null, userSymbol: null };
export type EmbeddingCacheStatus = 'ready' | 'failed';

export interface EmbeddingCacheRecord {
  model: string;
  contentHash: string;
  content: string;
  embedding: number[] | null;
  status: EmbeddingCacheStatus;
  error: string | null;
  failureCount: number;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

export class MemoryStore {
  private readonly dbPath: string;
  private db: Database.Database | null = null;

  constructor(options: MemoryStoreOptions = {}) {
    this.dbPath = options.dbPath ?? process.env['MEMORY_DB_PATH'] ?? 'memory.db';
  }

  initialize(): void {
    if (this.db) {
      return;
    }

    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        user_symbol TEXT,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        user_symbol TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embedding_cache (
        model TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        retry_after INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        PRIMARY KEY (model, content_hash)
      );
    `);

    const memoryColumns = this.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
    const logColumns = this.db.prepare('PRAGMA table_info(conversation_log)').all() as Array<{ name: string }>;

    if (!memoryColumns.some((column) => column.name === 'user_id')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN user_id TEXT');
    }
    if (!memoryColumns.some((column) => column.name === 'user_symbol')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN user_symbol TEXT');
    }
    if (!logColumns.some((column) => column.name === 'user_id')) {
      this.db.exec('ALTER TABLE conversation_log ADD COLUMN user_id TEXT');
    }
    if (!logColumns.some((column) => column.name === 'user_symbol')) {
      this.db.exec('ALTER TABLE conversation_log ADD COLUMN user_symbol TEXT');
    }

    dedupeMemories(this.db);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_identity_scope_key
      ON memories(user_id, user_symbol, scope, key);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_scope_key_identity_normalized
      ON memories(scope, key, COALESCE(user_id, ''), COALESCE(user_symbol, ''));
    `);
  }

  getEmbeddingCache(model: string, contentHash: string): EmbeddingCacheRecord | null {
    const db = this.getDb();
    const row = db.prepare(
      `SELECT * FROM embedding_cache
       WHERE model = ? AND content_hash = ?`,
    ).get(model, contentHash) as EmbeddingCacheRow | undefined;

    if (!row) {
      return null;
    }

    const now = Date.now();
    db.prepare(
      `UPDATE embedding_cache
       SET last_used_at = ?
       WHERE model = ? AND content_hash = ?`,
    ).run(now, model, contentHash);

    return mapEmbeddingCacheRow({
      ...row,
      last_used_at: now,
    });
  }

  upsertReadyEmbedding(model: string, contentHash: string, content: string, embedding: number[]): void {
    const db = this.getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO embedding_cache (
        model, content_hash, content, embedding_json, status, error, failure_count, retry_after,
        created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, 'ready', NULL, 0, NULL, ?, ?, ?)
      ON CONFLICT(model, content_hash) DO UPDATE SET
        content = excluded.content,
        embedding_json = excluded.embedding_json,
        status = 'ready',
        error = NULL,
        failure_count = 0,
        retry_after = NULL,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at`,
    ).run(model, contentHash, content, JSON.stringify(embedding), now, now, now);
  }

  upsertFailedEmbedding(
    model: string,
    contentHash: string,
    content: string,
    error: string,
    failureCount: number,
    retryAfter: number,
  ): void {
    const db = this.getDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO embedding_cache (
        model, content_hash, content, embedding_json, status, error, failure_count, retry_after,
        created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, NULL, 'failed', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model, content_hash) DO UPDATE SET
        content = excluded.content,
        embedding_json = NULL,
        status = 'failed',
        error = excluded.error,
        failure_count = excluded.failure_count,
        retry_after = excluded.retry_after,
        updated_at = excluded.updated_at,
        last_used_at = excluded.last_used_at`,
    ).run(model, contentHash, content, error, failureCount, retryAfter, now, now, now);
  }

  upsertMemory(
    scope: MemoryScope,
    key: string,
    value: string,
    sessionId: string,
    identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
  ): void {
    const db = this.getDb();
    const effectiveIdentity = resolveMemoryIdentity(scope, identity);
    const timestamp = Date.now();

    db.prepare(
      `INSERT INTO memories (session_id, user_id, user_symbol, scope, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET
         session_id = excluded.session_id,
         value = excluded.value,
         updated_at = excluded.updated_at`,
    ).run(
      sessionId,
      effectiveIdentity.userId,
      effectiveIdentity.userSymbol,
      scope,
      key,
      value,
      timestamp,
      timestamp,
    );
  }

  deleteMemory(
    scope: MemoryScope,
    key: string,
    identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
  ): boolean {
    const db = this.getDb();
    const effectiveIdentity = resolveMemoryIdentity(scope, identity);
    const result = db.prepare(
      `DELETE FROM memories
       WHERE scope = ? AND key = ?
         AND user_id IS ? AND user_symbol IS ?`,
    ).run(scope, key, effectiveIdentity.userId, effectiveIdentity.userSymbol);

    return result.changes > 0;
  }

  getMemory(
    scope: MemoryScope,
    key: string,
    identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
  ): MemoryRecord | null {
    const db = this.getDb();
    const effectiveIdentity = resolveMemoryIdentity(scope, identity);
    const row = db.prepare(
      `SELECT * FROM memories
       WHERE scope = ? AND key = ?
         AND user_id IS ? AND user_symbol IS ?`,
    ).get(scope, key, effectiveIdentity.userId, effectiveIdentity.userSymbol) as MemoryRow | undefined;

    return row ? mapMemoryRow(row) : null;
  }

  listMemories(
    scope?: MemoryScope,
    identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
  ): MemoryRecord[] {
    const db = this.getDb();
    const scopedIdentity = scope ? resolveMemoryIdentity(scope, identity) : null;
    const rows = scope
      ? (db.prepare(
          `SELECT * FROM memories
           WHERE scope = ? AND user_id IS ? AND user_symbol IS ?
           ORDER BY updated_at DESC, id DESC`,
        ).all(scope, scopedIdentity!.userId, scopedIdentity!.userSymbol) as MemoryRow[])
      : (db.prepare(
          `SELECT * FROM memories
           WHERE (scope = 'global' AND user_id IS NULL AND user_symbol IS NULL)
              OR (scope != 'global' AND user_id IS ? AND user_symbol IS ?)
           ORDER BY updated_at DESC, id DESC`,
        ).all(identity.userId, identity.userSymbol) as MemoryRow[]);

    return rows.map(mapMemoryRow);
  }

  appendConversationLog(
    sessionId: string,
    role: string,
    content: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): number {
    const db = this.getDb();
    const result = db.prepare(
      `INSERT INTO conversation_log (session_id, user_id, user_symbol, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sessionId, identity.userId, identity.userSymbol, role, content, Date.now());

    return Number(result.lastInsertRowid);
  }

  listConversationLogs(
    sessionId?: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): ConversationLogRecord[] {
    const db = this.getDb();
    const rows = sessionId
      ? (db.prepare(
          `SELECT * FROM conversation_log
           WHERE session_id = ? AND user_id IS ? AND user_symbol IS ?
           ORDER BY id ASC`,
        ).all(sessionId, identity.userId, identity.userSymbol) as ConversationLogRow[])
      : (db.prepare(
          `SELECT * FROM conversation_log
           WHERE user_id IS ? AND user_symbol IS ?
           ORDER BY id ASC`,
        ).all(identity.userId, identity.userSymbol) as ConversationLogRow[]);

    return rows.map(mapConversationLogRow);
  }

  getLatestConversationLogId(
    sessionId: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): number | null {
    const db = this.getDb();
    const row = db.prepare(
      `SELECT id FROM conversation_log
       WHERE session_id = ? AND user_id IS ? AND user_symbol IS ?
       ORDER BY id DESC
       LIMIT 1`,
    ).get(sessionId, identity.userId, identity.userSymbol) as { id: number } | undefined;

    return row?.id ?? null;
  }

  deleteConversationLogsAfter(
    sessionId: string,
    afterId: number | null,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): void {
    const db = this.getDb();

    if (afterId === null) {
      db.prepare(
        `DELETE FROM conversation_log
         WHERE session_id = ? AND user_id IS ? AND user_symbol IS ?`,
      ).run(sessionId, identity.userId, identity.userSymbol);
      return;
    }

    db.prepare(
      `DELETE FROM conversation_log
       WHERE session_id = ? AND user_id IS ? AND user_symbol IS ?
         AND id > ?`,
    ).run(sessionId, identity.userId, identity.userSymbol, afterId);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  formatMemoryContext(
    scopes: MemoryScope[] = ['global', 'user', 'site'],
    identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
  ): string | null {
    const memories = scopes.flatMap((scope) => this.listMemories(scope, identity));

    if (memories.length === 0) {
      return null;
    }

    const lines = memories.map((memory) => `- [${memory.scope}] ${memory.key}: ${memory.value}`);
    return ['[MEMORY_CONTEXT]', 'Saved long-term memory:', ...lines].join('\n');
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('MemoryStore is not initialized');
    }

    return this.db;
  }
}

export function resolveMemoryIdentity(
  scope: MemoryScope,
  identity: MemoryIdentity = DEFAULT_MEMORY_IDENTITY,
): MemoryIdentity {
  if (scope === 'global') {
    return DEFAULT_MEMORY_IDENTITY;
  }

  return identity;
}

function dedupeMemories(db: Database.Database): void {
  db.exec(`
    DELETE FROM memories
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY scope, key, COALESCE(user_id, ''), COALESCE(user_symbol, '')
                 ORDER BY updated_at DESC, id DESC
               ) AS row_num
        FROM memories
      ) ranked
      WHERE ranked.row_num > 1
    );
  `);
}

function mapMemoryRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    userSymbol: row.user_symbol,
    scope: row.scope,
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationLogRow(row: ConversationLogRow): ConversationLogRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    userSymbol: row.user_symbol,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  };
}

function mapEmbeddingCacheRow(row: EmbeddingCacheRow): EmbeddingCacheRecord {
  return {
    model: row.model,
    contentHash: row.content_hash,
    content: row.content,
    embedding: parseEmbeddingJson(row.embedding_json),
    status: row.status,
    error: row.error,
    failureCount: row.failure_count,
    retryAfter: row.retry_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

function parseEmbeddingJson(raw: string | null): number[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'number')) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
