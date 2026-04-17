import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentSessionManager } from '../src/session-manager.ts';

interface FakeAgent {
  run: (message: string) => Promise<string>;
  reset: () => void;
  shutdown: () => Promise<void>;
}

function createFakeAgent(name: string): FakeAgent {
  return {
    async run(message: string): Promise<string> {
      return `${name}:${message}`;
    },
    reset(): void {},
    async shutdown(): Promise<void> {},
  };
}

test('concurrent first turns share a single session creation', async () => {
  let createCount = 0;

  const manager = new AgentSessionManager({
    async createAgent() {
      createCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return createFakeAgent(`agent-${createCount}`) as never;
    },
    async disposeAgent() {},
  });

  const [first, second] = await Promise.all([
    manager.runTurn({ sessionId: 's1', message: 'hello' }),
    manager.runTurn({ sessionId: 's1', message: 'world' }),
  ]);

  assert.equal(createCount, 1);
  assert.equal(first, 'agent-1:hello');
  assert.equal(second, 'agent-1:world');
});

test('session identity mismatch is rejected', async () => {
  const manager = new AgentSessionManager({
    async createAgent() {
      return createFakeAgent('agent') as never;
    },
    async disposeAgent() {},
  });

  await manager.runTurn({
    sessionId: 's1',
    userId: 'u1',
    userSymbol: 'alice',
    message: 'hello',
  });

  await assert.rejects(
    () => manager.runTurn({
      sessionId: 's1',
      userId: 'u2',
      userSymbol: 'bob',
      message: 'hello',
    }),
    /session identity mismatch/,
  );
});

test('resetSession and disposeSession enforce session identity', async () => {
  const manager = new AgentSessionManager({
    async createAgent() {
      return createFakeAgent('agent') as never;
    },
    async disposeAgent() {},
  });

  await manager.runTurn({
    sessionId: 's1',
    userId: 'u1',
    userSymbol: 'alice',
    message: 'hello',
  });

  await assert.rejects(
    () => manager.resetSession('s1', { userId: 'u2', userSymbol: 'bob' }),
    /session identity mismatch/,
  );

  await assert.rejects(
    () => manager.disposeSession('s1', { userId: 'u2', userSymbol: 'bob' }),
    /session identity mismatch/,
  );

  assert.equal(await manager.resetSession('s1', { userId: 'u1', userSymbol: 'alice' }), true);
  assert.equal(await manager.disposeSession('s1', { userId: 'u1', userSymbol: 'alice' }), true);
});
