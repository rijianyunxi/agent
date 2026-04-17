import assert from 'node:assert/strict';
import test from 'node:test';

import { mapAppError, normalizeIdentifier, normalizeImageUrl, parseJsonBody, writeSseEvent } from '../src/app.ts';

test('invalid JSON request body returns 400', async () => {
  let invalidJsonError: unknown;
  try {
    parseJsonBody('{"message":');
  } catch (error) {
    invalidJsonError = error;
  }

  assert.match(String(invalidJsonError), /invalid json body/);
  assert.deepEqual(mapAppError(new Error('session identity mismatch')), {
    status: 409,
    body: { error: 'session identity mismatch' },
  });
  assert.deepEqual(mapAppError(invalidJsonError), {
    status: 400,
    body: { error: 'invalid json body' },
  });
});

test('normalizeIdentifier validates session and user identifiers', () => {
  assert.equal(normalizeIdentifier('session-01', 'sessionId'), 'session-01');
  assert.equal(normalizeIdentifier('  ', 'sessionId'), null);
  assert.throws(() => normalizeIdentifier('bad value!', 'sessionId'), /invalid sessionId/);
});

test('normalizeImageUrl only accepts http(s) and image data URLs', () => {
  assert.equal(normalizeImageUrl('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(normalizeImageUrl('data:image/png;base64,abcd'), 'data:image/png;base64,abcd');
  assert.equal(normalizeImageUrl(undefined), null);
  assert.throws(() => normalizeImageUrl('file:///tmp/a.jpg'), /invalid imageUrl/);
});

test('mapAppError keeps explicit 400 payload too large and input errors', () => {
  assert.deepEqual(mapAppError(new Error('message too long')), {
    status: 500,
    body: { error: 'message too long' },
  });
});

test('mapAppError keeps session identity mismatch mapped to 409', () => {
  assert.deepEqual(mapAppError(new Error('session identity mismatch')), {
    status: 409,
    body: { error: 'session identity mismatch' },
  });
});

test('writeSseEvent writes event-stream formatted payload', () => {
  const chunks: string[] = [];
  writeSseEvent({
    res: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
  } as never, {
    event: 'reply',
    data: { sessionId: 's1', reply: 'ok' },
  });

  assert.deepEqual(chunks, [
    'event: reply\n',
    `data: ${JSON.stringify({ sessionId: 's1', reply: 'ok' })}\n\n`,
  ]);
});
