import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import type { Tool } from '@agent/shared';

const MEDIA_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export async function loadImageAsDataURL(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const mediaType = MEDIA_TYPE_MAP[ext];

  if (!mediaType) {
    throw new Error(`不支持的图片格式: ${ext}，支持: ${Object.keys(MEDIA_TYPE_MAP).join(', ')}`);
  }

  const buffer = await readFile(filePath);
  const base64 = buffer.toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

export const imageTool: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: '分析工地现场照片，识别安全隐患和风险点。包括但不限于：人员是否佩戴安全帽、高处作业防护、机械设备安全、消防隐患等。',
      parameters: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            description: '重点关注的方面，如：人员防护、高处作业、机械安全、消防安全等。不传则全面分析。',
          },
        },
        required: [],
      },
    },
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const focus = input['focus'] as string | undefined;
    const prompt = focus
      ? `请重点从「${focus}」角度分析图片中的工地安全隐患。`
      : '请全面分析图片中的工地安全隐患，包括人员防护、设备安全、环境风险等。';

    return JSON.stringify({
      status: '图片已加载，请根据图片内容进行分析',
      instruction: prompt,
    });
  },
};
