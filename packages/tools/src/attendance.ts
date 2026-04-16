import type { AttendanceRecord, AttendanceSummary, Tool } from '@agent/shared';

export function getTodayInLocalTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env['TZ'],
  }).format(new Date());
}

const mockRecords: AttendanceRecord[] = [
  { name: '张伟', team: '钢筋班', status: '出勤', checkInTime: '07:32' },
  { name: '李强', team: '钢筋班', status: '出勤', checkInTime: '07:28' },
  { name: '王磊', team: '钢筋班', status: '迟到', checkInTime: '08:15' },
  { name: '赵刚', team: '木工班', status: '出勤', checkInTime: '07:45' },
  { name: '刘洋', team: '木工班', status: '出勤', checkInTime: '07:30' },
  { name: '陈明', team: '木工班', status: '请假', reason: '家中有事' },
  { name: '杨帆', team: '混凝土班', status: '出勤', checkInTime: '07:35' },
  { name: '周涛', team: '混凝土班', status: '出勤', checkInTime: '07:40' },
  { name: '吴昊', team: '混凝土班', status: '出勤', checkInTime: '07:38' },
  { name: '孙鹏', team: '电工班', status: '出勤', checkInTime: '07:25' },
  { name: '马超', team: '电工班', status: '缺勤', reason: '未知原因' },
  { name: '胡斌', team: '电工班', status: '出勤', checkInTime: '07:50' },
  { name: '郭亮', team: '架子班', status: '出勤', checkInTime: '07:33' },
  { name: '林峰', team: '架子班', status: '出勤', checkInTime: '07:29' },
  { name: '何勇', team: '架子班', status: '请假', reason: '身体不适' },
];

function queryAttendance(date?: string): AttendanceSummary {
  const queryDate = date ?? getTodayInLocalTimezone();
  const records = mockRecords;

  return {
    date: queryDate,
    totalExpected: records.length,
    actualPresent: records.filter((record) => record.status === '出勤' || record.status === '迟到').length,
    leave: records.filter((record) => record.status === '请假').length,
    absent: records.filter((record) => record.status === '缺勤').length,
    late: records.filter((record) => record.status === '迟到').length,
    records,
  };
}

export const attendanceTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'query_attendance',
      description: '查询工地考勤数据，包括出勤人数、请假人数、缺勤人数、迟到人数及详细记录。可按日期查询。',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: '查询日期，格式 YYYY-MM-DD，不传则默认今天',
          },
        },
        required: [],
      },
    },
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const date = input['date'] as string | undefined;
    const summary = queryAttendance(date);
    return JSON.stringify(summary, null, 2);
  },
};
