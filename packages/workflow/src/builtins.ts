import type { WorkflowDefinition } from './types.ts';

export const demoApprovalWorkflow: WorkflowDefinition = {
  name: 'demo-approval',
  failureMode: 'compensate',
  steps: [
    {
      id: 'prepare',
      async run(context) {
        const request = typeof context.workflowInput['request'] === 'string'
          ? context.workflowInput['request']
          : 'unknown request';
        return {
          type: 'completed' as const,
          output: { prepared: true, request },
          contextPatch: {
            prepared: true,
            request,
          },
        };
      },
      async compensate() {
        return {
          contextPatch: {
            prepared: false,
            prepareCompensated: true,
          },
        };
      },
    },
    {
      id: 'approval',
      async run(context) {
        const request = typeof context.context['request'] === 'string'
          ? context.context['request']
          : 'unknown request';
        return {
          type: 'await_approval' as const,
          payload: {
            title: 'Approval Required',
            message: `Please approve workflow request: ${request}`,
            metadata: {
              request,
            },
          },
        };
      },
      async resume(_context, decision) {
        if (!decision.approved) {
          return {
            type: 'failed' as const,
            error: decision.comment?.trim() || 'approval rejected',
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
      id: 'execute',
      async run(context) {
        if (context.workflowInput['simulateFailure'] === true) {
          return {
            type: 'failed' as const,
            error: 'simulated execution failure',
          };
        }

        return {
          type: 'completed' as const,
          output: { executed: true },
          contextPatch: {
            executed: true,
          },
        };
      },
    },
  ],
};
