import assert from 'node:assert/strict';
import test from 'node:test';

import { parseInput } from '../src/main.ts';

test('parseInput supports quoted image paths with spaces', () => {
  assert.deepEqual(
    parseInput('image:"./site photos/a.jpg" 这张图有什么风险'),
    {
      imageUrl: './site photos/a.jpg',
      text: '这张图有什么风险',
    },
  );
});

test('parseInput keeps unquoted URL behavior', () => {
  assert.deepEqual(
    parseInput('image:https://example.com/site.jpg 请分析风险'),
    {
      imageUrl: 'https://example.com/site.jpg',
      text: '请分析风险',
    },
  );
});
