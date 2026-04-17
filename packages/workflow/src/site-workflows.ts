import type { WorkflowDefinition } from './types.ts';

function getString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function getStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSeverity(value: string | null): 'low' | 'medium' | 'high' {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }

  return 'medium';
}

function summarizeIssues(issues: string[]): string {
  if (issues.length === 0) {
    return '未填写问题项';
  }

  return issues.join('；');
}

export const inspectionRectificationWorkflow: WorkflowDefinition = {
  name: 'inspection-rectification',
  failureMode: 'compensate',
  steps: [
    {
      id: 'prepare_rectification',
      async run(context) {
        const inspectionId = getString(context.workflowInput, 'inspectionId');
        const area = getString(context.workflowInput, 'area');
        const assignee = getString(context.workflowInput, 'assignee');
        const deadline = getString(context.workflowInput, 'deadline');
        const issues = getStringArray(context.workflowInput, 'issues');

        if (!inspectionId) {
          return {
            type: 'failed' as const,
            error: 'inspectionId is required',
          };
        }

        if (!area) {
          return {
            type: 'failed' as const,
            error: 'area is required',
          };
        }

        if (!assignee) {
          return {
            type: 'failed' as const,
            error: 'assignee is required',
          };
        }

        if (!deadline) {
          return {
            type: 'failed' as const,
            error: 'deadline is required',
          };
        }

        if (issues.length === 0) {
          return {
            type: 'failed' as const,
            error: 'issues must contain at least one item',
          };
        }

        const severity = normalizeSeverity(getString(context.workflowInput, 'severity'));
        const title = `隐患整改 ${inspectionId}`;
        const issueSummary = summarizeIssues(issues);

        return {
          type: 'completed' as const,
          output: {
            inspectionId,
            title,
            severity,
          },
          contextPatch: {
            inspectionId,
            area,
            assignee,
            deadline,
            severity,
            issues,
            issueSummary,
            title,
          },
        };
      },
    },
    {
      id: 'manager_approval',
      async run(context) {
        const title = typeof context.context['title'] === 'string'
          ? context.context['title']
          : '隐患整改审批';
        const area = typeof context.context['area'] === 'string'
          ? context.context['area']
          : '未知区域';
        const assignee = typeof context.context['assignee'] === 'string'
          ? context.context['assignee']
          : '未指定';
        const deadline = typeof context.context['deadline'] === 'string'
          ? context.context['deadline']
          : '未指定';
        const issueSummary = typeof context.context['issueSummary'] === 'string'
          ? context.context['issueSummary']
          : '未填写问题项';

        return {
          type: 'await_approval' as const,
          payload: {
            title,
            message: `请审批整改任务。区域：${area}；责任人：${assignee}；期限：${deadline}；问题：${issueSummary}`,
            metadata: {
              inspectionId: context.context['inspectionId'],
              area,
              assignee,
              deadline,
              issueSummary,
              severity: context.context['severity'],
            },
          },
        };
      },
      async resume(_context, decision) {
        if (!decision.approved) {
          return {
            type: 'failed' as const,
            error: decision.comment?.trim() || 'manager rejected rectification task',
          };
        }

        return {
          type: 'completed' as const,
          output: {
            approved: true,
          },
          contextPatch: {
            approvedBy: decision.actor ?? 'unknown',
            approvalComment: decision.comment ?? '',
          },
        };
      },
    },
    {
      id: 'create_rectification_task',
      async run(context) {
        const inspectionId = typeof context.context['inspectionId'] === 'string'
          ? context.context['inspectionId']
          : 'unknown-inspection';
        const assignee = typeof context.context['assignee'] === 'string'
          ? context.context['assignee']
          : 'unknown-assignee';
        const taskId = `RECT-${inspectionId}-${Date.now()}`;

        return {
          type: 'completed' as const,
          output: {
            taskId,
            status: 'created',
          },
          contextPatch: {
            taskId,
            taskStatus: 'created',
            taskAssignee: assignee,
          },
        };
      },
      async compensate(context) {
        return {
          contextPatch: {
            taskStatus: 'cancelled',
            cancelledTaskId: context.context['taskId'],
          },
        };
      },
    },
    {
      id: 'notify_execution',
      async run(context) {
        if (context.workflowInput['simulateNotificationFailure'] === true) {
          return {
            type: 'failed' as const,
            error: 'failed to notify assignee',
          };
        }

        return {
          type: 'completed' as const,
          output: {
            notified: true,
          },
          contextPatch: {
            notificationStatus: 'sent',
          },
        };
      },
      async compensate() {
        return {
          contextPatch: {
            notificationStatus: 'recalled',
          },
        };
      },
    },
  ],
};
