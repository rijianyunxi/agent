import type { MemoryIdentity, MemoryStore } from '@agent/memory';
import type { MemoryScope, Tool } from '@agent/shared';

interface MemoryToolsDeps {
  memoryStore: MemoryStore;
  sessionId: string;
  userId?: string;
  userSymbol?: string;
}

const SCOPE_ENUM = ['user', 'site', 'global'] as const;

export function createMemoryTools({
  memoryStore,
  sessionId,
  userId,
  userSymbol,
}: MemoryToolsDeps): Tool[] {
  const identity: MemoryIdentity = {
    userId: userId ?? null,
    userSymbol: userSymbol ?? null,
  };

  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'remember_fact',
          description: '当你发现值得跨会话保留的稳定事实时，保存到长期记忆中。例如用户偏好、固定项目事实、长期约束。不要保存一次性的临时查询结果。',
          parameters: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                enum: [...SCOPE_ENUM],
                description: '记忆作用域：user、site、global',
              },
              key: {
                type: 'string',
                description: '记忆键名，例如 user.name、site.project_name',
              },
              value: {
                type: 'string',
                description: '要保存的记忆内容',
              },
            },
            required: ['scope', 'key', 'value'],
          },
        },
      },
      async execute(input: Record<string, unknown>): Promise<string> {
        const scope = input['scope'] as MemoryScope;
        const key = input['key'] as string;
        const value = input['value'] as string;

        memoryStore.upsertMemory(scope, key, value, sessionId, identity);
        return JSON.stringify({ status: 'ok', action: 'remembered', scope, key, value });
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'forget_fact',
          description: '当某条长期记忆已经过时或错误时，删除它。',
          parameters: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                enum: [...SCOPE_ENUM],
                description: '记忆作用域：user、site、global',
              },
              key: {
                type: 'string',
                description: '要删除的记忆键名',
              },
            },
            required: ['scope', 'key'],
          },
        },
      },
      async execute(input: Record<string, unknown>): Promise<string> {
        const scope = input['scope'] as MemoryScope;
        const key = input['key'] as string;
        const deleted = memoryStore.deleteMemory(scope, key, identity);

        return JSON.stringify({ status: 'ok', action: 'forgotten', scope, key, deleted });
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'recall_facts',
          description: '查看当前已保存的长期记忆，便于回答前自检。',
          parameters: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                enum: [...SCOPE_ENUM],
                description: '可选，按作用域过滤',
              },
            },
            required: [],
          },
        },
      },
      async execute(input: Record<string, unknown>): Promise<string> {
        const scope = input['scope'] as MemoryScope | undefined;
        const memories = memoryStore.listMemories(scope, identity);

        return JSON.stringify({ status: 'ok', action: 'recalled', memories });
      },
    },
  ];
}
