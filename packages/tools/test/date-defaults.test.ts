import assert from 'node:assert/strict';
import test from 'node:test';

import { attendanceTool } from '../src/attendance.ts';
import { inspectionTool } from '../src/inspection.ts';

const RealDate = Date;

function mockDate(isoString: string): void {
  const fixed = new RealDate(isoString);

  globalThis.Date = class extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? fixed);
    }

    static override now(): number {
      return fixed.getTime();
    }
  } as DateConstructor;
}

function restoreDate(): void {
  globalThis.Date = RealDate;
}

test('attendance default date uses local timezone instead of UTC day', async () => {
  const previousTz = process.env['TZ'];
  process.env['TZ'] = 'Asia/Shanghai';
  mockDate('2026-04-15T16:30:00.000Z');

  try {
    const result = JSON.parse(await attendanceTool.execute({})) as { date: string };
    assert.equal(result.date, '2026-04-16');
  } finally {
    restoreDate();
    process.env['TZ'] = previousTz;
  }
});

test('inspection default date uses local timezone instead of UTC day', async () => {
  const previousTz = process.env['TZ'];
  process.env['TZ'] = 'Asia/Shanghai';
  mockDate('2026-04-15T16:30:00.000Z');

  try {
    const result = JSON.parse(await inspectionTool.execute({})) as { date: string };
    assert.equal(result.date, '2026-04-16');
  } finally {
    restoreDate();
    process.env['TZ'] = previousTz;
  }
});
