import assert from 'node:assert/strict';
import test from 'node:test';

import { SlidingWindow } from '../src/sliding-window.ts';

test('trim does not keep orphaned tool messages at window start', () => {
  const window = new SlidingWindow({ maxMessages: 4 });

  window.initialize([
    { role: 'system', content: 'system' },
  ]);
  window.append({ role: 'user', content: 'u1' });
  window.append({
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'query_attendance', arguments: '{}' },
      },
    ],
  });
  window.append({ role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' });
  window.append({ role: 'assistant', content: 'done' });

  const messages = window.getMessages();

  assert.deepEqual(messages.map((message) => message.role), ['system', 'assistant', 'tool', 'assistant']);
});

test('trim skips incomplete tool call transaction at window start', () => {
  const window = new SlidingWindow({ maxMessages: 3 });

  window.initialize([
    { role: 'system', content: 'system' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'query_attendance', arguments: '{}' },
        },
        {
          id: 'call-2',
          type: 'function',
          function: { name: 'query_inspection', arguments: '{}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call-2', content: '{"ok":true}' },
    { role: 'assistant', content: 'done' },
  ]);

  const messages = window.getMessages();

  assert.deepEqual(messages.map((message) => message.role), ['system', 'assistant']);
  assert.equal(messages[1]?.content, 'done');
});
