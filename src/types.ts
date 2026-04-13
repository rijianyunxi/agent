/**
 * 类型定义文件
 * 定义 Agent 中使用的核心类型
 */

import type OpenAI from "openai";

// ============================================================
// Tool 相关类型
// ============================================================

/**
 * 工具定义：每个工具需要提供给 LLM 的 schema + 本地执行函数
 *
 * OpenAI 格式的 function tool 定义结构：
 * {
 *   type: "function",
 *   function: { name, description, parameters }
 * }
 */
export interface Tool {
  /** 工具的 schema 定义，传给 OpenAI API 的 tools 参数 */
  definition: OpenAI.ChatCompletionFunctionTool;
  /** 工具的本地执行函数，接收 LLM 传来的参数，返回字符串结果 */
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// ============================================================
// 业务数据类型
// ============================================================

/** 考勤记录 */
export interface AttendanceRecord {
  name: string; // 姓名
  team: string; // 班组
  status: "出勤" | "请假" | "缺勤" | "迟到"; // 状态
  checkInTime?: string; // 打卡时间
  reason?: string; // 请假/缺勤原因
}

/** 考勤汇总 */
export interface AttendanceSummary {
  date: string;
  totalExpected: number; // 应到人数
  actualPresent: number; // 实到人数
  leave: number; // 请假人数
  absent: number; // 缺勤人数
  late: number; // 迟到人数
  records: AttendanceRecord[];
}

/** 巡检记录 */
export interface InspectionRecord {
  id: string; // 巡检编号
  area: string; // 巡检区域
  inspector: string; // 检查人
  time: string; // 巡检时间
  status: "合格" | "不合格" | "待整改"; // 状态
  issues: string[]; // 发现的问题
  images?: string[]; // 现场照片
}

/** 巡检汇总 */
export interface InspectionSummary {
  date: string;
  totalInspections: number;
  passed: number;
  failed: number;
  pending: number;
  records: InspectionRecord[];
}
