import Database from 'better-sqlite3';

import type {
  ApprovalDecision,
  ApprovalPayload,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  WorkflowEventRecord,
  WorkflowInstanceRecord,
  WorkflowInstanceStatus,
  WorkflowSnapshot,
  WorkflowStepRecord,
  WorkflowStepStatus,
} from './types.ts';

interface WorkflowStoreOptions {
  dbPath?: string;
}

interface WorkflowInstanceRow {
  id: string;
  workflow_name: string;
  status: WorkflowInstanceStatus;
  current_step_id: string | null;
  input_json: string;
  context_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface WorkflowStepRow {
  instance_id: string;
  step_id: string;
  status: WorkflowStepStatus;
  output_json: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  compensated_at: number | null;
}

interface WorkflowEventRow {
  id: number;
  instance_id: string;
  type: string;
  payload_json: string;
  created_at: number;
}

interface ApprovalRequestRow {
  id: string;
  instance_id: string;
  step_id: string;
  status: ApprovalRequestStatus;
  payload_json: string;
  decision_json: string | null;
  created_at: number;
  decided_at: number | null;
}

export class WorkflowStore {
  private readonly dbPath: string;
  private db: Database.Database | null = null;

  constructor(options: WorkflowStoreOptions = {}) {
    this.dbPath = options.dbPath ?? process.env['WORKFLOW_DB_PATH'] ?? process.env['MEMORY_DB_PATH'] ?? 'workflow.db';
  }

  initialize(): void {
    if (this.db) {
      return;
    }

    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_instances (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step_id TEXT,
        input_json TEXT NOT NULL,
        context_json TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        instance_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        error TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        compensated_at INTEGER,
        PRIMARY KEY (instance_id, step_id)
      );

      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        decision_json TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
    `);
  }

  createInstance(instance: WorkflowInstanceRecord): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO workflow_instances (
        id, workflow_name, status, current_step_id, input_json, context_json, error, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      instance.id,
      instance.workflowName,
      instance.status,
      instance.currentStepId,
      JSON.stringify(instance.input),
      JSON.stringify(instance.context),
      instance.error,
      instance.createdAt,
      instance.updatedAt,
      instance.completedAt,
    );
  }

  updateInstance(instance: WorkflowInstanceRecord): void {
    const db = this.getDb();
    db.prepare(
      `UPDATE workflow_instances
       SET status = ?,
           current_step_id = ?,
           input_json = ?,
           context_json = ?,
           error = ?,
           updated_at = ?,
           completed_at = ?
       WHERE id = ?`
    ).run(
      instance.status,
      instance.currentStepId,
      JSON.stringify(instance.input),
      JSON.stringify(instance.context),
      instance.error,
      instance.updatedAt,
      instance.completedAt,
      instance.id,
    );
  }

  getInstance(id: string): WorkflowInstanceRecord | null {
    const row = this.getDb().prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id) as WorkflowInstanceRow | undefined;
    return row ? mapInstanceRow(row) : null;
  }

  upsertStep(step: WorkflowStepRecord): void {
    this.getDb().prepare(
      `INSERT INTO workflow_steps (
        instance_id, step_id, status, output_json, error, started_at, finished_at, compensated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, step_id) DO UPDATE SET
        status = excluded.status,
        output_json = excluded.output_json,
        error = excluded.error,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        compensated_at = excluded.compensated_at`
    ).run(
      step.instanceId,
      step.stepId,
      step.status,
      step.output ? JSON.stringify(step.output) : null,
      step.error,
      step.startedAt,
      step.finishedAt,
      step.compensatedAt,
    );
  }

  getStep(instanceId: string, stepId: string): WorkflowStepRecord | null {
    const row = this.getDb().prepare(
      'SELECT * FROM workflow_steps WHERE instance_id = ? AND step_id = ?'
    ).get(instanceId, stepId) as WorkflowStepRow | undefined;

    return row ? mapStepRow(row) : null;
  }

  listSteps(instanceId: string): WorkflowStepRecord[] {
    const rows = this.getDb().prepare(
      'SELECT * FROM workflow_steps WHERE instance_id = ? ORDER BY rowid ASC'
    ).all(instanceId) as WorkflowStepRow[];
    return rows.map(mapStepRow);
  }

  appendEvent(instanceId: string, type: string, payload: Record<string, unknown>): number {
    const result = this.getDb().prepare(
      'INSERT INTO workflow_events (instance_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(instanceId, type, JSON.stringify(payload), Date.now());

    return Number(result.lastInsertRowid);
  }

  listEvents(instanceId: string): WorkflowEventRecord[] {
    const rows = this.getDb().prepare(
      'SELECT * FROM workflow_events WHERE instance_id = ? ORDER BY id ASC'
    ).all(instanceId) as WorkflowEventRow[];
    return rows.map(mapEventRow);
  }

  createApprovalRequest(record: ApprovalRequestRecord): void {
    this.getDb().prepare(
      `INSERT INTO approval_requests (
        id, instance_id, step_id, status, payload_json, decision_json, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.instanceId,
      record.stepId,
      record.status,
      JSON.stringify(record.payload),
      record.decision ? JSON.stringify(record.decision) : null,
      record.createdAt,
      record.decidedAt,
    );
  }

  getApprovalRequest(id: string): ApprovalRequestRecord | null {
    const row = this.getDb().prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as ApprovalRequestRow | undefined;
    return row ? mapApprovalRow(row) : null;
  }

  updateApprovalRequest(record: ApprovalRequestRecord): void {
    this.getDb().prepare(
      `UPDATE approval_requests
       SET status = ?, payload_json = ?, decision_json = ?, decided_at = ?
       WHERE id = ?`
    ).run(
      record.status,
      JSON.stringify(record.payload),
      record.decision ? JSON.stringify(record.decision) : null,
      record.decidedAt,
      record.id,
    );
  }

  listApprovalRequests(instanceId: string): ApprovalRequestRecord[] {
    const rows = this.getDb().prepare(
      'SELECT * FROM approval_requests WHERE instance_id = ? ORDER BY created_at ASC, id ASC'
    ).all(instanceId) as ApprovalRequestRow[];
    return rows.map(mapApprovalRow);
  }

  getSnapshot(instanceId: string): WorkflowSnapshot | null {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      return null;
    }

    return {
      instance,
      steps: this.listSteps(instanceId),
      approvals: this.listApprovalRequests(instanceId),
      events: this.listEvents(instanceId),
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('WorkflowStore is not initialized');
    }

    return this.db;
  }
}

function mapInstanceRow(row: WorkflowInstanceRow): WorkflowInstanceRecord {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    status: row.status,
    currentStepId: row.current_step_id,
    input: parseJsonObject(row.input_json),
    context: parseJsonObject(row.context_json),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapStepRow(row: WorkflowStepRow): WorkflowStepRecord {
  return {
    instanceId: row.instance_id,
    stepId: row.step_id,
    status: row.status,
    output: row.output_json ? parseJsonObject(row.output_json) : null,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    compensatedAt: row.compensated_at,
  };
}

function mapEventRow(row: WorkflowEventRow): WorkflowEventRecord {
  return {
    id: row.id,
    instanceId: row.instance_id,
    type: row.type,
    payload: parseJsonObject(row.payload_json),
    createdAt: row.created_at,
  };
}

function mapApprovalRow(row: ApprovalRequestRow): ApprovalRequestRecord {
  return {
    id: row.id,
    instanceId: row.instance_id,
    stepId: row.step_id,
    status: row.status,
    payload: parseApprovalPayload(row.payload_json),
    decision: row.decision_json ? parseApprovalDecision(row.decision_json) : null,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function parseApprovalPayload(raw: string): ApprovalPayload {
  const parsed = parseJsonObject(raw);
  return {
    title: typeof parsed['title'] === 'string' ? parsed['title'] : 'Approval Required',
    message: typeof parsed['message'] === 'string' ? parsed['message'] : '',
    ...(isRecord(parsed['metadata']) ? { metadata: parsed['metadata'] } : {}),
  };
}

function parseApprovalDecision(raw: string): ApprovalDecision {
  const parsed = parseJsonObject(raw);
  return {
    approved: parsed['approved'] === true,
    ...(typeof parsed['actor'] === 'string' ? { actor: parsed['actor'] } : {}),
    ...(typeof parsed['comment'] === 'string' ? { comment: parsed['comment'] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
