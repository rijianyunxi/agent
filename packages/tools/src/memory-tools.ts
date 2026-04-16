import type { MemoryIdentity, MemoryStore } from '@agent/memory';
import type { MemoryScope, Tool } from '@agent/shared';

interface MemoryToolsDeps {
  memoryStore: MemoryStore;
  sessionId: string;
  userId?: string;
  userSymbol?: string;
}

const SCOPE_ENUM = ['user', 'site', 'global'] as const;
const MAX_MEMORY_KEY_LENGTH = 64;
const MAX_MEMORY_VALUE_LENGTH = 500;
const MEMORY_KEY_PATTERN = /^(user|site|global)\.[a-z0-9_.-]+$/;

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
        const key = validateMemoryKey(input['key']);
        const value = validateMemoryValue(input['value']);

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
        const key = validateMemoryKey(input['key']);
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

export function validateMemoryKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('记忆键名必须是字符串');
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MEMORY_KEY_LENGTH || !MEMORY_KEY_PATTERN.test(trimmed)) {
    throw new Error('记忆键名不合法');
  }

  return trimmed;
}

export function validateMemoryValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('记忆内容必须是字符串');
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MEMORY_VALUE_LENGTH) {
    throw new Error('记忆内容过长或为空');
  }

  if (containsSensitivePattern(trimmed)) {
    throw new Error('记忆内容疑似包含敏感信息');
  }

  return trimmed;
}

function containsSensitivePattern(value: string): boolean {
  const patterns = [
    /\b1\d{10}\b/,
    /\b\d{15,18}[0-9Xx]\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/,
  ];

  return patterns.some((pattern) => pattern.test(value));
}
