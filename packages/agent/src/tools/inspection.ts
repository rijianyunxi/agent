/**
 * 巡检查询工具
 *
 * 提供 mock 巡检数据，模拟真实的智慧工地巡检系统
 * 在实际项目中，这里会调用后端 API 或数据库
 */

import type { InspectionRecord, InspectionSummary, Tool } from "../types.ts";

// ============================================================
// Mock 数据
// ============================================================

const today = new Date().toISOString().split("T")[0]!;

const mockRecords: InspectionRecord[] = [
  {
    id: "INS-2024-001",
    area: "A栋基坑",
    inspector: "安全员-李明",
    time: "08:30",
    status: "合格",
    issues: [],
  },
  {
    id: "INS-2024-002",
    area: "B栋脚手架",
    inspector: "安全员-王华",
    time: "09:15",
    status: "不合格",
    issues: [
      "3层脚手架连墙件缺失2处",
      "安全网有破损未及时更换",
      "作业人员未系安全带",
    ],
  },
  {
    id: "INS-2024-003",
    area: "材料堆放区",
    inspector: "安全员-李明",
    time: "10:00",
    status: "待整改",
    issues: ["钢管堆放超高，存在倒塌风险", "消防通道被部分占用"],
  },
  {
    id: "INS-2024-004",
    area: "塔吊作业区",
    inspector: "安全员-赵强",
    time: "10:45",
    status: "合格",
    issues: [],
  },
  {
    id: "INS-2024-005",
    area: "临时用电区域",
    inspector: "安全员-赵强",
    time: "14:00",
    status: "不合格",
    issues: ["配电箱门未关闭", "电缆拖地未做架空处理", "漏电保护器失灵"],
  },
];

// ============================================================
// 工具实现
// ============================================================

function queryInspection(date?: string, status?: string): InspectionSummary {
  const queryDate = date ?? today;

  let records = [...mockRecords];

  // 按状态过滤
  if (status) {
    records = records.filter((r) => r.status === status);
  }

  return {
    date: queryDate,
    totalInspections: records.length,
    passed: records.filter((r) => r.status === "合格").length,
    failed: records.filter((r) => r.status === "不合格").length,
    pending: records.filter((r) => r.status === "待整改").length,
    records,
  };
}

// ============================================================
// 导出 Tool 定义
// ============================================================

export const inspectionTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "query_inspection",
      description:
        "查询工地安全巡检记录，包括各区域巡检结果、发现的问题等。可按日期和状态过滤。",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "查询日期，格式 YYYY-MM-DD，不传则默认今天",
          },
          status: {
            type: "string",
            description: "按状态过滤：合格、不合格、待整改",
            enum: ["合格", "不合格", "待整改"],
          },
        },
        required: [],
      },
    },
  },

  async execute(input: Record<string, unknown>): Promise<string> {
    const date = input["date"] as string | undefined;
    const status = input["status"] as string | undefined;
    const summary = queryInspection(date, status);
    return JSON.stringify(summary, null, 2);
  },
};
