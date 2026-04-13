/**
 * 考勤查询工具
 *
 * 提供 mock 考勤数据，模拟真实的智慧工地考勤系统
 * 在实际项目中，这里会调用后端 API 或数据库
 */

import type { AttendanceRecord, AttendanceSummary, Tool } from "../types.ts";

// ============================================================
// Mock 数据
// ============================================================

const today = new Date().toISOString().split("T")[0]!;

const mockRecords: AttendanceRecord[] = [
  { name: "张伟", team: "钢筋班", status: "出勤", checkInTime: "07:32" },
  { name: "李强", team: "钢筋班", status: "出勤", checkInTime: "07:28" },
  { name: "王磊", team: "钢筋班", status: "迟到", checkInTime: "08:15" },
  { name: "赵刚", team: "木工班", status: "出勤", checkInTime: "07:45" },
  { name: "刘洋", team: "木工班", status: "出勤", checkInTime: "07:30" },
  { name: "陈明", team: "木工班", status: "请假", reason: "家中有事" },
  { name: "杨帆", team: "混凝土班", status: "出勤", checkInTime: "07:35" },
  { name: "周涛", team: "混凝土班", status: "出勤", checkInTime: "07:40" },
  { name: "吴昊", team: "混凝土班", status: "出勤", checkInTime: "07:38" },
  { name: "孙鹏", team: "电工班", status: "出勤", checkInTime: "07:25" },
  { name: "马超", team: "电工班", status: "缺勤", reason: "未知原因" },
  { name: "胡斌", team: "电工班", status: "出勤", checkInTime: "07:50" },
  { name: "郭亮", team: "架子班", status: "出勤", checkInTime: "07:33" },
  { name: "林峰", team: "架子班", status: "出勤", checkInTime: "07:29" },
  { name: "何勇", team: "架子班", status: "请假", reason: "身体不适" },
];

// ============================================================
// 工具实现
// ============================================================

function queryAttendance(date?: string): AttendanceSummary {
  const queryDate = date ?? today;

  // 实际项目中这里会查数据库，这里直接用 mock 数据
  const records = mockRecords;

  return {
    date: queryDate,
    totalExpected: records.length,
    actualPresent: records.filter(
      (r) => r.status === "出勤" || r.status === "迟到"
    ).length,
    leave: records.filter((r) => r.status === "请假").length,
    absent: records.filter((r) => r.status === "缺勤").length,
    late: records.filter((r) => r.status === "迟到").length,
    records,
  };
}

// ============================================================
// 导出 Tool 定义
// ============================================================

export const attendanceTool: Tool = {
  /**
   * OpenAI 格式的工具定义
   * 注意和 Anthropic 的区别：
   *   Anthropic: { name, description, input_schema }
   *   OpenAI:    { type: "function", function: { name, description, parameters } }
   */
  definition: {
    type: "function",
    function: {
      name: "query_attendance",
      description:
        "查询工地考勤数据，包括出勤人数、请假人数、缺勤人数、迟到人数及详细记录。可按日期查询。",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "查询日期，格式 YYYY-MM-DD，不传则默认今天",
          },
        },
        required: [],
      },
    },
  },

  /**
   * 工具的执行函数
   * 当 LLM 决定调用这个工具时，Agent 会调用这个函数
   * @param input - LLM 传来的参数
   * @returns JSON 字符串，会作为 tool message 返回给 LLM
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const date = input["date"] as string | undefined;
    const summary = queryAttendance(date);
    return JSON.stringify(summary, null, 2);
  },
};
