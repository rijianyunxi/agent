import { randomUUID } from 'node:crypto';

import type { Logger } from '@agent/shared';

import { WorkflowStore } from './store.ts';
import type {
  ApprovalPayload,
  ResumeApprovalInput,
  StartWorkflowInput,
  WorkflowCompensationResult,
  WorkflowDefinition,
  WorkflowInstanceRecord,
  WorkflowSnapshot,
  WorkflowStepContext,
  WorkflowStepDefinition,
  WorkflowStepRecord,
  WorkflowStepResumeResult,
  WorkflowStepRunResult,
} from './types.ts';

interface WorkflowManagerOptions {
  definitions?: WorkflowDefinition[];
  store?: WorkflowStore;
  logger?: Logger;
}

export class WorkflowDefinitionNotFoundError extends Error {
  constructor(workflowName: string) {
    super(`workflow definition not found: ${workflowName}`);
  }
}

export class WorkflowInstanceNotFoundError extends Error {
  constructor(instanceId: string) {
    super(`workflow instance not found: ${instanceId}`);
  }
}

export class ApprovalRequestNotFoundError extends Error {
  constructor(approvalRequestId: string) {
    super(`approval request not found: ${approvalRequestId}`);
  }
}

export class ApprovalRequestResolvedError extends Error {
  constructor(approvalRequestId: string) {
    super(`approval request already resolved: ${approvalRequestId}`);
  }
}

export class WorkflowStateError extends Error {}

export class WorkflowManager {
  private readonly definitions: Map<string, WorkflowDefinition>;
  private readonly store: WorkflowStore;

  constructor(options: WorkflowManagerOptions = {}) {
    this.definitions = new Map((options.definitions ?? []).map((definition) => [definition.name, definition]));
    this.store = options.store ?? new WorkflowStore();
    const _logger = options.logger ?? console;
    this.store.initialize();
  }

  registerDefinition(definition: WorkflowDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  async startWorkflow(input: StartWorkflowInput): Promise<WorkflowSnapshot> {
    const definition = this.getDefinition(input.workflowName);
    const firstStepId = definition.steps[0]?.id ?? null;
    if (!firstStepId) {
      throw new WorkflowStateError(`workflow has no steps: ${definition.name}`);
    }

    const now = Date.now();
    const instance: WorkflowInstanceRecord = {
      id: randomUUID(),
      workflowName: definition.name,
      status: 'running',
      currentStepId: firstStepId,
      input: input.input ?? {},
      context: input.context ?? {},
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.store.createInstance(instance);
    this.store.appendEvent(instance.id, 'workflow.started', {
      workflowName: instance.workflowName,
      currentStepId: firstStepId,
    });

    await this.executeUntilPauseOrEnd(instance.id);
    return this.requireSnapshot(instance.id);
  }

  async resumeApproval(input: ResumeApprovalInput): Promise<WorkflowSnapshot> {
    const snapshot = this.getApprovalSnapshot(input.approvalRequestId);
    const { instance, approval, stepDefinition, stepRecord } = snapshot;
    const decision = {
      approved: input.approved,
      ...(input.actor ? { actor: input.actor } : {}),
      ...(input.comment ? { comment: input.comment } : {}),
    };

    const updatedApproval = {
      ...approval,
      status: (input.approved ? 'approved' : 'rejected') as const,
      decision,
      decidedAt: Date.now(),
    };
    this.store.updateApprovalRequest(updatedApproval);
    this.store.appendEvent(instance.id, 'approval.resolved', {
      approvalRequestId: approval.id,
      stepId: approval.stepId,
      approved: decision.approved,
      ...(decision.actor ? { actor: decision.actor } : {}),
    });

    const result = await this.resolveResumeResult(
      stepDefinition,
      this.buildStepContext(instance, stepRecord),
      input,
    );

    await this.handleStepResult(instance, stepDefinition, stepRecord, result);
    const nextInstance = this.requireInstance(instance.id);
    if (nextInstance.status === 'running') {
      await this.executeUntilPauseOrEnd(instance.id);
    }

    return this.requireSnapshot(instance.id);
  }

  getWorkflow(instanceId: string): WorkflowSnapshot {
    return this.requireSnapshot(instanceId);
  }

  close(): void {
    this.store.close();
  }

  private async executeUntilPauseOrEnd(instanceId: string): Promise<void> {
    while (true) {
      const instance = this.requireInstance(instanceId);
      if (instance.status !== 'running') {
        return;
      }

      const currentStepId = instance.currentStepId;
      if (!currentStepId) {
        this.completeInstance(instance);
        return;
      }

      const definition = this.getDefinition(instance.workflowName);
      const stepDefinition = this.getStepDefinition(definition, currentStepId);
      const stepRecord = this.beginStep(instance.id, currentStepId);
      const result = await stepDefinition.run(this.buildStepContext(instance, stepRecord));
      await this.handleStepResult(instance, stepDefinition, stepRecord, result);
    }
  }

  private async handleStepResult(
    instance: WorkflowInstanceRecord,
    stepDefinition: WorkflowStepDefinition,
    stepRecord: WorkflowStepRecord,
    result: WorkflowStepRunResult | WorkflowStepResumeResult,
  ): Promise<void> {
    if (result.type === 'await_approval') {
      this.transitionToWaitingApproval(instance, stepRecord, result.payload);
      return;
    }

    if (result.type === 'failed') {
      this.failStep(instance, stepRecord, result.error);
      await this.handleFailure(instance, stepDefinition, result.error);
      return;
    }

    this.completeStep(instance, stepDefinition, stepRecord, result.output ?? null, result.contextPatch ?? {});
  }

  private transitionToWaitingApproval(
    instance: WorkflowInstanceRecord,
    stepRecord: WorkflowStepRecord,
    payload: ApprovalPayload,
  ): void {
    const now = Date.now();
    this.store.upsertStep({
      ...stepRecord,
      status: 'waiting_approval',
      error: null,
    });
    this.store.updateInstance({
      ...instance,
      status: 'waiting_approval',
      updatedAt: now,
      error: null,
    });

    const approvalRequestId = randomUUID();
    this.store.createApprovalRequest({
      id: approvalRequestId,
      instanceId: instance.id,
      stepId: stepRecord.stepId,
      status: 'pending',
      payload,
      decision: null,
      createdAt: now,
      decidedAt: null,
    });
    this.store.appendEvent(instance.id, 'approval.requested', {
      approvalRequestId,
      stepId: stepRecord.stepId,
      title: payload.title,
    });
  }

  private failStep(instance: WorkflowInstanceRecord, stepRecord: WorkflowStepRecord, error: string): void {
    this.store.upsertStep({
      ...stepRecord,
      status: 'failed',
      error,
      finishedAt: Date.now(),
    });
    this.store.appendEvent(instance.id, 'step.failed', {
      stepId: stepRecord.stepId,
      error,
    });
  }

  private completeStep(
    instance: WorkflowInstanceRecord,
    stepDefinition: WorkflowStepDefinition,
    stepRecord: WorkflowStepRecord,
    output: Record<string, unknown> | null,
    contextPatch: Record<string, unknown>,
  ): void {
    const now = Date.now();
    this.store.upsertStep({
      ...stepRecord,
      status: 'completed',
      output,
      error: null,
      finishedAt: now,
    });

    const nextStepId = this.getNextStepId(instance.workflowName, stepDefinition.id);
    const completed = nextStepId === null;
    this.store.updateInstance({
      ...instance,
      status: completed ? 'completed' : 'running',
      currentStepId: nextStepId,
      context: {
        ...instance.context,
        ...contextPatch,
      },
      error: null,
      updatedAt: now,
      completedAt: completed ? now : null,
    });
    this.store.appendEvent(instance.id, 'step.completed', {
      stepId: stepRecord.stepId,
      ...(output ? { output } : {}),
      ...(nextStepId ? { nextStepId } : {}),
    });
    if (completed) {
      this.store.appendEvent(instance.id, 'workflow.completed', {
        workflowName: instance.workflowName,
      });
    }
  }

  private completeInstance(instance: WorkflowInstanceRecord): void {
    const now = Date.now();
    this.store.updateInstance({
      ...instance,
      status: 'completed',
      currentStepId: null,
      error: null,
      updatedAt: now,
      completedAt: now,
    });
    this.store.appendEvent(instance.id, 'workflow.completed', {
      workflowName: instance.workflowName,
    });
  }

  private async handleFailure(
    instance: WorkflowInstanceRecord,
    failedStepDefinition: WorkflowStepDefinition,
    error: string,
  ): Promise<void> {
    const definition = this.getDefinition(instance.workflowName);
    if ((definition.failureMode ?? 'fail') === 'compensate') {
      await this.compensate(instance, failedStepDefinition, error);
      return;
    }

    const now = Date.now();
    this.store.updateInstance({
      ...instance,
      status: 'failed',
      error,
      updatedAt: now,
      completedAt: now,
    });
    this.store.appendEvent(instance.id, 'workflow.failed', {
      stepId: failedStepDefinition.id,
      error,
    });
  }

  private async compensate(
    instance: WorkflowInstanceRecord,
    failedStepDefinition: WorkflowStepDefinition,
    error: string,
  ): Promise<void> {
    this.store.updateInstance({
      ...instance,
      status: 'compensating',
      error,
      updatedAt: Date.now(),
      completedAt: null,
    });
    this.store.appendEvent(instance.id, 'workflow.compensating', {
      stepId: failedStepDefinition.id,
      error,
    });

    const definition = this.getDefinition(instance.workflowName);
    const completedSteps = this.store.listSteps(instance.id)
      .filter((step) => step.status === 'completed')
      .reverse();

    let currentInstance = this.requireInstance(instance.id);

    for (const step of completedSteps) {
      const stepDefinition = this.getStepDefinition(definition, step.stepId);
      if (!stepDefinition.compensate) {
        continue;
      }

      const result = await stepDefinition.compensate(this.buildStepContext(currentInstance, step));
      const contextPatch = normalizeCompensationResult(result);
      this.store.upsertStep({
        ...step,
        status: 'compensated',
        compensatedAt: Date.now(),
      });

      currentInstance = {
        ...currentInstance,
        context: {
          ...currentInstance.context,
          ...contextPatch,
        },
        updatedAt: Date.now(),
      };
      this.store.updateInstance(currentInstance);
      this.store.appendEvent(instance.id, 'step.compensated', {
        stepId: step.stepId,
        ...(Object.keys(contextPatch).length > 0 ? { contextPatch } : {}),
      });
    }

    const finishedAt = Date.now();
    this.store.updateInstance({
      ...currentInstance,
      status: 'rolled_back',
      currentStepId: failedStepDefinition.id,
      error,
      updatedAt: finishedAt,
      completedAt: finishedAt,
    });
    this.store.appendEvent(instance.id, 'workflow.rolled_back', {
      stepId: failedStepDefinition.id,
      error,
    });
  }

  private beginStep(instanceId: string, stepId: string): WorkflowStepRecord {
    const existing = this.store.getStep(instanceId, stepId);
    const now = Date.now();
    const step: WorkflowStepRecord = existing ?? {
      instanceId,
      stepId,
      status: 'pending',
      output: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      compensatedAt: null,
    };

    const runningStep: WorkflowStepRecord = {
      ...step,
      status: 'running',
      startedAt: step.startedAt ?? now,
      error: null,
    };
    this.store.upsertStep(runningStep);
    this.store.appendEvent(instanceId, 'step.started', { stepId });
    return runningStep;
  }

  private buildStepContext(instance: WorkflowInstanceRecord, step: WorkflowStepRecord): WorkflowStepContext {
    const stepOutputs = Object.fromEntries(
      this.store.listSteps(instance.id)
        .filter((record) => record.output)
        .map((record) => [record.stepId, record.output ?? {}]),
    );

    return {
      instance,
      step,
      workflowInput: instance.input,
      context: instance.context,
      stepOutputs,
    };
  }

  private async resolveResumeResult(
    stepDefinition: WorkflowStepDefinition,
    context: WorkflowStepContext,
    input: ResumeApprovalInput,
  ): Promise<WorkflowStepResumeResult> {
    if (stepDefinition.resume) {
      return await stepDefinition.resume(context, input);
    }

    if (!input.approved) {
      return {
        type: 'failed',
        error: input.comment?.trim() || 'approval rejected',
      };
    }

    return {
      type: 'completed',
      contextPatch: {
        approvedBy: input.actor ?? 'unknown',
      },
    };
  }

  private getApprovalSnapshot(approvalRequestId: string): {
    instance: WorkflowInstanceRecord;
    approval: NonNullable<ReturnType<WorkflowStore['getApprovalRequest']>>;
    stepDefinition: WorkflowStepDefinition;
    stepRecord: WorkflowStepRecord;
  } {
    const approval = this.store.getApprovalRequest(approvalRequestId);
    if (!approval) {
      throw new ApprovalRequestNotFoundError(approvalRequestId);
    }
    if (approval.status !== 'pending') {
      throw new ApprovalRequestResolvedError(approvalRequestId);
    }

    const instance = this.requireInstance(approval.instanceId);
    if (instance.status !== 'waiting_approval') {
      throw new WorkflowStateError(`workflow instance is not waiting for approval: ${instance.id}`);
    }

    const definition = this.getDefinition(instance.workflowName);
    const stepDefinition = this.getStepDefinition(definition, approval.stepId);
    const stepRecord = this.requireStep(instance.id, approval.stepId);
    return { instance, approval, stepDefinition, stepRecord };
  }

  private getDefinition(workflowName: string): WorkflowDefinition {
    const definition = this.definitions.get(workflowName);
    if (!definition) {
      throw new WorkflowDefinitionNotFoundError(workflowName);
    }

    return definition;
  }

  private getStepDefinition(definition: WorkflowDefinition, stepId: string): WorkflowStepDefinition {
    const step = definition.steps.find((item) => item.id === stepId);
    if (!step) {
      throw new WorkflowStateError(`workflow step definition not found: ${definition.name}.${stepId}`);
    }

    return step;
  }

  private getNextStepId(workflowName: string, stepId: string): string | null {
    const definition = this.getDefinition(workflowName);
    const index = definition.steps.findIndex((item) => item.id === stepId);
    if (index === -1) {
      throw new WorkflowStateError(`workflow step definition not found: ${workflowName}.${stepId}`);
    }

    return definition.steps[index + 1]?.id ?? null;
  }

  private requireInstance(instanceId: string): WorkflowInstanceRecord {
    const instance = this.store.getInstance(instanceId);
    if (!instance) {
      throw new WorkflowInstanceNotFoundError(instanceId);
    }

    return instance;
  }

  private requireStep(instanceId: string, stepId: string): WorkflowStepRecord {
    const step = this.store.getStep(instanceId, stepId);
    if (!step) {
      throw new WorkflowStateError(`workflow step state not found: ${instanceId}.${stepId}`);
    }

    return step;
  }

  private requireSnapshot(instanceId: string): WorkflowSnapshot {
    const snapshot = this.store.getSnapshot(instanceId);
    if (!snapshot) {
      throw new WorkflowInstanceNotFoundError(instanceId);
    }

    return snapshot;
  }
}

function normalizeCompensationResult(result: WorkflowCompensationResult | void): Record<string, unknown> {
  return result?.contextPatch ?? {};
}
