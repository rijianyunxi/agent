import assert from 'node:assert/strict';
import test from 'node:test';

import { demoApprovalWorkflow, inspectionRectificationWorkflow, WorkflowManager } from '../src/index.ts';

test('workflow waits for approval and resumes to completion', async () => {
  const manager = new WorkflowManager({
    definitions: [demoApprovalWorkflow],
  });

  const started = await manager.startWorkflow({
    workflowName: 'demo-approval',
    input: { request: 'deploy release' },
  });

  assert.equal(started.instance.status, 'waiting_approval');
  assert.equal(started.approvals.length, 1);
  assert.equal(started.approvals[0]?.status, 'pending');

  const resumed = await manager.resumeApproval({
    approvalRequestId: started.approvals[0]!.id,
    approved: true,
    actor: 'alice',
    comment: 'ship it',
  });

  assert.equal(resumed.instance.status, 'completed');
  assert.equal(resumed.instance.context['approvedBy'], 'alice');
  assert.equal(resumed.instance.context['executed'], true);

  manager.close();
});

test('workflow rolls back completed steps when execution fails after approval', async () => {
  const manager = new WorkflowManager({
    definitions: [demoApprovalWorkflow],
  });

  const started = await manager.startWorkflow({
    workflowName: 'demo-approval',
    input: {
      request: 'deploy release',
      simulateFailure: true,
    },
  });

  const resumed = await manager.resumeApproval({
    approvalRequestId: started.approvals[0]!.id,
    approved: true,
    actor: 'bob',
  });

  assert.equal(resumed.instance.status, 'rolled_back');
  assert.equal(resumed.instance.error, 'simulated execution failure');
  assert.equal(resumed.instance.context['prepareCompensated'], true);

  const prepareStep = resumed.steps.find((step) => step.stepId === 'prepare');
  assert.equal(prepareStep?.status, 'compensated');

  manager.close();
});

test('inspection rectification workflow waits for approval and creates task after approval', async () => {
  const manager = new WorkflowManager({
    definitions: [inspectionRectificationWorkflow],
  });

  const started = await manager.startWorkflow({
    workflowName: 'inspection-rectification',
    input: {
      inspectionId: 'INS-2024-002',
      area: 'B栋脚手架',
      assignee: '王建国',
      deadline: '2026-04-20 18:00',
      severity: 'high',
      issues: ['连墙件缺失', '安全网破损'],
    },
  });

  assert.equal(started.instance.status, 'waiting_approval');
  assert.equal(started.approvals.length, 1);
  assert.equal(started.approvals[0]?.payload.metadata?.['inspectionId'], 'INS-2024-002');

  const resumed = await manager.resumeApproval({
    approvalRequestId: started.approvals[0]!.id,
    approved: true,
    actor: 'site-manager',
  });

  assert.equal(resumed.instance.status, 'completed');
  assert.equal(typeof resumed.instance.context['taskId'], 'string');
  assert.equal(resumed.instance.context['notificationStatus'], 'sent');

  manager.close();
});

test('inspection rectification workflow compensates created task when notification fails', async () => {
  const manager = new WorkflowManager({
    definitions: [inspectionRectificationWorkflow],
  });

  const started = await manager.startWorkflow({
    workflowName: 'inspection-rectification',
    input: {
      inspectionId: 'INS-2024-005',
      area: '临时用电区域',
      assignee: '赵工',
      deadline: '2026-04-20 12:00',
      severity: 'high',
      issues: ['配电箱门未关闭'],
      simulateNotificationFailure: true,
    },
  });

  const resumed = await manager.resumeApproval({
    approvalRequestId: started.approvals[0]!.id,
    approved: true,
    actor: 'site-manager',
  });

  assert.equal(resumed.instance.status, 'rolled_back');
  assert.equal(resumed.instance.context['taskStatus'], 'cancelled');
  assert.equal(resumed.instance.context['notificationStatus'], 'recalled');

  manager.close();
});
