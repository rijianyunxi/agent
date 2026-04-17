import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStore, resolveMemoryIdentity } from '../src/memory-store.ts';

function createStoreWithFakeDb(): {
  store: MemoryStore;
  state: {
    runs: Array<{ sql: string; args: unknown[] }>;
  };
} {
  const state = {
    runs: [] as Array<{ sql: string; args: unknown[] }>,
  };

  const fakeDb = {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO memories') || sql.includes('DELETE FROM memories')) {
        return {
          run(...args: unknown[]) {
            state.runs.push({ sql, args });
            return { changes: 1 };
          },
        };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  const store = new MemoryStore({ dbPath: ':memory:' });
  (store as unknown as { db: unknown }).db = fakeDb;

  return { store, state };
}

test('upsertMemory uses ON CONFLICT for shared global memories', () => {
  const { store, state } = createStoreWithFakeDb();

  store.upsertMemory('global', 'site.project_name', 'phase-1', 's1', {
    userId: 'u1',
    userSymbol: 'alice',
  });

  assert.equal(state.runs.length, 1);
  assert.match(state.runs[0]!.sql, /ON CONFLICT DO UPDATE/);
  assert.deepEqual(state.runs[0]!.args.slice(0, 6), [
    's1',
    null,
    null,
    'global',
    'site.project_name',
    'phase-1',
  ]);
});

test('upsertMemory keeps user identity for non-global scopes', () => {
  const { store, state } = createStoreWithFakeDb();

  store.upsertMemory('user', 'user.name', 'Alice', 's2', {
    userId: 'u1',
    userSymbol: 'alice',
  });

  assert.equal(state.runs.length, 1);
  assert.deepEqual(state.runs[0]!.args.slice(0, 6), [
    's2',
    'u1',
    'alice',
    'user',
    'user.name',
    'Alice',
  ]);
});

test('resolveMemoryIdentity normalizes global scope to shared identity', () => {
  assert.deepEqual(resolveMemoryIdentity('global', { userId: 'u1', userSymbol: 'alice' }), {
    userId: null,
    userSymbol: null,
  });
  assert.deepEqual(resolveMemoryIdentity('site', { userId: 'u1', userSymbol: 'alice' }), {
    userId: 'u1',
    userSymbol: 'alice',
  });
});
