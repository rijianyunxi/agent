export type WorkflowInstanceStatus =
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'rolled_back';

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'compensated';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected';

export type WorkflowFailureMode = 'fail' | 'compensate';

export interface ApprovalPayload {
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalDecision {
  approved: boolean;
  actor?: string;
  comment?: string;
}

export interface WorkflowInstanceRecord {
  id: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStepId: string | null;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface WorkflowStepRecord {
  instanceId: string;
  stepId: string;
  status: WorkflowStepStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  compensatedAt: number | null;
}

export interface WorkflowEventRecord {
  id: number;
  instanceId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface ApprovalRequestRecord {
  id: string;
  instanceId: string;
  stepId: string;
  status: ApprovalRequestStatus;
  payload: ApprovalPayload;
  decision: ApprovalDecision | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface WorkflowSnapshot {
  instance: WorkflowInstanceRecord;
  steps: WorkflowStepRecord[];
  approvals: ApprovalRequestRecord[];
  events: WorkflowEventRecord[];
}

export interface WorkflowStepContext {
  instance: WorkflowInstanceRecord;
  step: WorkflowStepRecord;
  workflowInput: Record<string, unknown>;
  context: Record<string, unknown>;
  stepOutputs: Record<string, Record<string, unknown>>;
}

export interface WorkflowCompensationResult {
  contextPatch?: Record<string, unknown>;
}

export type WorkflowStepRunResult =
  | {
      type: 'completed';
      output?: Record<string, unknown>;
      contextPatch?: Record<string, unknown>;
    }
  | {
      type: 'await_approval';
      payload: ApprovalPayload;
    }
  | {
      type: 'failed';
      error: string;
    };

export type WorkflowStepResumeResult =
  | {
      type: 'completed';
      output?: Record<string, unknown>;
      contextPatch?: Record<string, unknown>;
    }
  | {
      type: 'failed';
      error: string;
    };

export interface WorkflowStepDefinition {
  id: string;
  run: (context: WorkflowStepContext) => Promise<WorkflowStepRunResult>;
  resume?: (
    context: WorkflowStepContext,
    decision: ApprovalDecision,
  ) => Promise<WorkflowStepResumeResult>;
  compensate?: (context: WorkflowStepContext) => Promise<WorkflowCompensationResult | void>;
}

export interface WorkflowDefinition {
  name: string;
  failureMode?: WorkflowFailureMode;
  steps: WorkflowStepDefinition[];
}

export interface StartWorkflowInput {
  workflowName: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface ResumeApprovalInput extends ApprovalDecision {
  approvalRequestId: string;
}
