import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/memory-store.ts';

function createStoreWithFakeDb(existingIds: number[] = []): {
  store: MemoryStore;
  state: {
    selectCalls: number;
    updates: Array<{ sessionId: string; value: string; id: number }>;
    inserts: Array<{ sessionId: string; scope: string; key: string; value: string }>;
    deletedIds: number[];
  };
} {
  const state = {
    selectCalls: 0,
    updates: [] as Array<{ sessionId: string; value: string; id: number }>,
    inserts: [] as Array<{ sessionId: string; scope: string; key: string; value: string }>,
    deletedIds: [] as number[],
  };

  const fakeDb = {
    transaction<T>(fn: () => T): () => T {
      return fn;
    },
    prepare(sql: string) {
      if (sql.includes('SELECT id FROM memories')) {
        return {
          all() {
            state.selectCalls += 1;
            return existingIds.map((id) => ({ id }));
          },
        };
      }

      if (sql.includes('UPDATE memories')) {
        return {
          run(sessionId: string, value: string, _timestamp: number, id: number) {
            state.updates.push({ sessionId, value, id });
          },
        };
      }

      if (sql.includes('DELETE FROM memories WHERE id IN')) {
        return {
          run(...ids: number[]) {
            state.deletedIds.push(...ids);
          },
        };
      }

      if (sql.includes('INSERT INTO memories')) {
        return {
          run(
            sessionId: string,
            _userId: string | null,
            _userSymbol: string | null,
            scope: string,
            key: string,
            value: string,
          ) {
            state.inserts.push({ sessionId, scope, key, value });
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

test('upsertMemory updates latest matching row and deletes duplicates for null identity', () => {
  const { store, state } = createStoreWithFakeDb([5, 4, 3]);

  store.upsertMemory('global', 'site.project_name', '二期工程', 's2');

  assert.equal(state.selectCalls, 1);
  assert.deepEqual(state.updates, [{ sessionId: 's2', value: '二期工程', id: 5 }]);
  assert.deepEqual(state.deletedIds, [4, 3]);
  assert.deepEqual(state.inserts, []);
});

test('upsertMemory inserts when no matching row exists', () => {
  const { store, state } = createStoreWithFakeDb();

  store.upsertMemory('global', 'site.project_name', '一期工程', 's1');

  assert.equal(state.selectCalls, 1);
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.deletedIds, []);
  assert.deepEqual(state.inserts, [{
    sessionId: 's1',
    scope: 'global',
    key: 'site.project_name',
    value: '一期工程',
  }]);
});
