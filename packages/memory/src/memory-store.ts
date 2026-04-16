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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_identity_scope_key
      ON memories(user_id, user_symbol, scope, key);

      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        user_symbol TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
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

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_identity_scope_key
      ON memories(user_id, user_symbol, scope, key);
    `);
  }

  upsertMemory(
    scope: MemoryScope,
    key: string,
    value: string,
    sessionId: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): void {
    const db = this.getDb();
    const timestamp = Date.now();
    const existingRows = db.prepare(
      `SELECT id FROM memories
       WHERE scope = ? AND key = ?
         AND user_id IS ? AND user_symbol IS ?
       ORDER BY id DESC`,
    ).all(scope, key, identity.userId, identity.userSymbol) as Array<{ id: number }>;

    const writeMemory = db.transaction(() => {
      if (existingRows.length > 0) {
        const [latest, ...duplicates] = existingRows;

        db.prepare(
          `UPDATE memories
           SET session_id = ?, value = ?, updated_at = ?
           WHERE id = ?`,
        ).run(sessionId, value, timestamp, latest!.id);

        if (duplicates.length > 0) {
          const duplicateIds = duplicates.map((row) => row.id);
          const placeholders = duplicateIds.map(() => '?').join(', ');
          db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...duplicateIds);
        }

        return;
      }

      db.prepare(
        `INSERT INTO memories (session_id, user_id, user_symbol, scope, key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(sessionId, identity.userId, identity.userSymbol, scope, key, value, timestamp, timestamp);
    });

    writeMemory();
  }

  deleteMemory(
    scope: MemoryScope,
    key: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): boolean {
    const db = this.getDb();
    const result = db.prepare(
      `DELETE FROM memories
       WHERE scope = ? AND key = ?
         AND user_id IS ? AND user_symbol IS ?`,
    ).run(scope, key, identity.userId, identity.userSymbol);

    return result.changes > 0;
  }

  getMemory(
    scope: MemoryScope,
    key: string,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): MemoryRecord | null {
    const db = this.getDb();
    const row = db.prepare(
      `SELECT * FROM memories
       WHERE scope = ? AND key = ?
         AND user_id IS ? AND user_symbol IS ?`,
    ).get(scope, key, identity.userId, identity.userSymbol) as MemoryRow | undefined;

    return row ? mapMemoryRow(row) : null;
  }

  listMemories(
    scope?: MemoryScope,
    identity: MemoryIdentity = { userId: null, userSymbol: null },
  ): MemoryRecord[] {
    const db = this.getDb();
    const rows = scope
      ? (db.prepare(
          `SELECT * FROM memories
           WHERE scope = ? AND user_id IS ? AND user_symbol IS ?
           ORDER BY updated_at DESC, id DESC`,
        ).all(scope, identity.userId, identity.userSymbol) as MemoryRow[])
      : (db.prepare(
          `SELECT * FROM memories
           WHERE user_id IS ? AND user_symbol IS ?
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
    identity: MemoryIdentity = { userId: null, userSymbol: null },
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
