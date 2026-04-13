/**
 * 工具注册表
 *
 * 集中管理所有工具，提供：
 * 1. toolDefinitions - 传给 OpenAI API 的工具 schema 列表
 * 2. executeTool()   - 根据工具名分发执行
 */

import type { Tool } from "../types.ts";
import { attendanceTool } from "./attendance.ts";
import { imageTool } from "./image.ts";
import { inspectionTool } from "./inspection.ts";

// ============================================================
// 工具注册表：所有工具在这里注册
// 新增工具只需：1. 创建工具文件  2. 在这里 import 并加入 map
// ============================================================

const toolMap = new Map<string, Tool>([
  [attendanceTool.definition.function.name, attendanceTool],
  [inspectionTool.definition.function.name, inspectionTool],
  [imageTool.definition.function.name, imageTool],
]);

/**
 * 所有工具的 schema 定义，直接传给 OpenAI API 的 tools 参数
 */
export const toolDefinitions = [...toolMap.values()].map((t) => t.definition);

/**
 * 根据工具名执行对应的工具
 * 这是 Agent Loop 中的关键一步：LLM 说要调哪个工具，我们就执行哪个
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const tool = toolMap.get(name);

  if (!tool) {
    return JSON.stringify({ error: `未知工具: ${name}` });
  }

  try {
    console.log(`  🔧 调用工具: ${name}`, JSON.stringify(input));
    const result = await tool.execute(input);
    console.log(`  ✅ 工具返回: ${result.slice(0, 100)}...`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ 工具执行失败: ${name}`, message);
    return JSON.stringify({ error: message });
  }
}
