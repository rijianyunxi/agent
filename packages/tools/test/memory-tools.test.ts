import assert from 'node:assert/strict';
import test from 'node:test';

import { validateMemoryKey, validateMemoryValue } from '../src/memory-tools.ts';

test('validateMemoryKey enforces namespace and format', () => {
  assert.equal(validateMemoryKey('site.project_name'), 'site.project_name');
  assert.throws(() => validateMemoryKey('project_name'), /记忆键名不合法/);
  assert.throws(() => validateMemoryKey('site.ProjectName'), /记忆键名不合法/);
});

test('validateMemoryValue rejects sensitive or oversized content', () => {
  assert.equal(validateMemoryValue('项目名称为智慧工地一期'), '项目名称为智慧工地一期');
  assert.throws(() => validateMemoryValue('联系电话 13800138000'), /敏感信息/);
  assert.throws(() => validateMemoryValue('x'.repeat(501)), /过长或为空/);
});
