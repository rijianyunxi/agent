/**
 * 图片分析工具
 *
 * 读取本地图片文件，转为 base64 编码
 * 图片的实际分析由 LLM 的多模态 Vision 能力完成
 * 这个工具的作用是：把图片数据加载好，供 Agent 传给 LLM
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { Tool } from "../types.ts";

// ============================================================
// 支持的图片格式映射
// ============================================================

const MEDIA_TYPE_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * 读取图片文件并转为 base64 data URL
 * OpenAI Vision 使用 data URL 格式：data:image/jpeg;base64,xxxxx
 */
export async function loadImageAsDataURL(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const mediaType = MEDIA_TYPE_MAP[ext];

  if (!mediaType) {
    throw new Error(
      `不支持的图片格式: ${ext}，支持: ${Object.keys(MEDIA_TYPE_MAP).join(", ")}`
    );
  }

  const buffer = await readFile(filePath);
  const base64 = buffer.toString("base64");

  // OpenAI 格式：data URL
  return `data:${mediaType};base64,${base64}`;
}

// ============================================================
// 导出 Tool 定义
// ============================================================

export const imageTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "analyze_image",
      description:
        "分析工地现场照片，识别安全隐患和风险点。包括但不限于：人员是否佩戴安全帽、高处作业防护、机械设备安全、消防隐患等。",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description:
              "重点关注的方面，如：人员防护、高处作业、机械安全、消防安全等。不传则全面分析。",
          },
        },
        required: [],
      },
    },
  },

  /**
   * 注意：图片分析比较特殊
   * 实际的图片内容是在 agent.ts 中通过 vision content 传给 LLM 的
   * 这个 execute 只是返回一个提示，告诉 LLM 去分析已经传入的图片
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const focus = input["focus"] as string | undefined;
    const prompt = focus
      ? `请重点从「${focus}」角度分析图片中的工地安全隐患。`
      : "请全面分析图片中的工地安全隐患，包括人员防护、设备安全、环境风险等。";

    return JSON.stringify({
      status: "图片已加载，请根据图片内容进行分析",
      instruction: prompt,
    });
  },
};
