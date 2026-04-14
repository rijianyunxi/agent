/**
 * ============================================================
 * Agent 核心 —— 这是整个项目最重要的文件
 * ============================================================
 *
 * 一个 Agent 的本质就是一个循环：
 *
 *   1. 把用户消息 + 工具定义 发给 LLM
 *   2. LLM 返回：
 *      - 如果没有 tool_calls → 直接输出文本回复，结束
 *      - 如果有 tool_calls  → 执行工具，把结果追加到消息列表
 *   3. 带着工具结果再次调用 LLM（回到步骤 2）
 *   4. 循环直到 LLM 返回普通文本
 *
 * 就这么简单。LangChain/LangGraph 封装的也是这个逻辑。
 *
 * ============================================================
 * Anthropic vs OpenAI 格式对比（方便学习）
 * ============================================================
 *
 * | 概念           | Anthropic                    | OpenAI                           |
 * |---------------|------------------------------|----------------------------------|
 * | 消息角色       | user / assistant             | system / user / assistant / tool |
 * | 系统提示       | 单独的 system 参数            | role: "system" 的消息             |
 * | 工具定义       | { name, input_schema }       | { type:"function", function:{} } |
 * | LLM 要调工具   | stop_reason: "tool_use"      | finish_reason: "tool_calls"      |
 * | 工具调用信息    | content 中的 tool_use block  | message.tool_calls 数组           |
 * | 工具结果返回    | role:"user" + tool_result    | role:"tool" + tool_call_id       |
 * | 图片传入       | image content block (base64) | image_url content (data URL)     |
 */

import OpenAI from "openai";

import { executeTool, toolDefinitions } from "./tools/index.ts";
import { loadImageAsDataURL } from "./tools/image.ts";

// ============================================================
// 类型别名（方便阅读）
// ============================================================

type ChatMessage = OpenAI.ChatCompletionMessageParam;
type FunctionToolCall = OpenAI.ChatCompletionMessageFunctionToolCall;

// ============================================================
// Agent 类
// ============================================================

export class SmartSiteAgent {
  private client: OpenAI;
  private messages: ChatMessage[] = [];
  private model = "gpt-5.4";

  /** 系统提示词：定义 Agent 的角色和行为 */
  private systemPrompt = `你是一个智慧工地 AI 助手，负责帮助工地管理人员查询和分析工地相关信息。
你的能力包括但不限于：
1. 查询考勤数据（出勤、请假、缺勤、迟到情况）
2. 查询安全巡检记录（各区域巡检结果、发现的问题）
3. 分析工地现场照片，识别安全隐患

回答要求：
- 不回答任何与智慧工地无关的问题
- 用简洁清晰的中文回答
- 数据查询时先调用工具获取数据，再基于数据回答
- 没有数据时禁止编造回复，可告知用户暂不支持该功能
- 分析图片时要具体指出风险点和整改建议
- 如果用户的问题涉及多个方面，可以同时调用多个工具`;

  constructor() {
    /**
     * OpenAI SDK 会自动读取环境变量 OPENAI_API_KEY
     * 如果你用的是兼容 OpenAI 格式的其他服务（如 DeepSeek、通义千问等），
     * 可以通过 baseURL 参数指定：
     *   new OpenAI({ baseURL: "https://api.deepseek.com/v1" })
     */
    this.client = new OpenAI({
      baseURL: "https://ai.letus.lol/v1",
      apiKey: process.env["OPENAI_API_KEY"],
    });
  }

  /**
   * 处理用户输入，返回 Agent 的回复
   * 这是 Agent 的主入口
   *
   * @param userText - 用户输入的文本
   * @param imagePath - 可选的图片路径
   */
  async run(userText: string, imagePath?: string): Promise<string> {
    // ----------------------------------------------------------
    // 第 1 步：构造用户消息
    // ----------------------------------------------------------

    // OpenAI 格式：如果有图片，content 是数组；纯文本则直接是字符串
    if (imagePath) {
      try {
        const dataURL = await loadImageAsDataURL(imagePath);
        // OpenAI Vision 格式：content 是 array，包含 text 和 image_url
        this.messages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataURL },
            },
            {
              type: "text",
              text: userText,
            },
          ],
        });
        console.log(`  📷 已加载图片: ${imagePath}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `图片加载失败: ${msg}`;
      }
    } else {
      // 纯文本消息
      this.messages.push({ role: "user", content: userText });
    }

    // ----------------------------------------------------------
    // 第 2 步：Agent Loop —— 核心循环
    // ----------------------------------------------------------
    const MAX_ITERATIONS = 10; // 防止无限循环的安全阀

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      console.log(`\n  🤖 第 ${i + 1} 轮调用 LLM...`);

      // 调用 OpenAI API
      const response = await this.client.chat.completions.create({
        model: this.model,
        tools: toolDefinitions,
        messages: [
          // OpenAI 的 system prompt 是作为第一条消息传入的（不像 Anthropic 有单独参数）
          { role: "system", content: this.systemPrompt },
          ...this.messages,
        ],
      });

      const choice = response.choices[0]!;
      const message = choice.message;

      // ----------------------------------------------------------
      // 第 3 步：判断返回类型
      // ----------------------------------------------------------

      if (
        choice.finish_reason !== "tool_calls" ||
        !message.tool_calls?.length
      ) {
        // ✅ LLM 给出了最终回复（finish_reason 是 "stop"），循环结束
        const textContent = message.content ?? "";

        // 把 assistant 的回复加入对话历史（保持上下文连续）
        this.messages.push({ role: "assistant", content: textContent });

        console.log(`  💬 Agent 回复完成\n`);
        return textContent;
      }

      // 🔧 LLM 想调用工具（finish_reason === "tool_calls"）

      // 把 assistant 的回复（包含 tool_calls）加入历史
      // 注意：OpenAI 要求 tool_calls 的 assistant 消息必须完整保留
      this.messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });

      // 只处理 function 类型的 tool_calls
      const toolCalls = message.tool_calls.filter(
        (tc): tc is FunctionToolCall => tc.type === "function",
      );

      console.log(
        `  🔧 LLM 要调用 ${toolCalls.length} 个工具:`,
        toolCalls.map((t) => t.function.name).join(", "),
      );

      // ----------------------------------------------------------
      // 第 4 步：执行所有工具，收集结果
      // ----------------------------------------------------------
      for (const toolCall of toolCalls) {
        // OpenAI 的参数是 JSON 字符串，需要 parse
        const args = JSON.parse(toolCall.function.arguments) as Record<
          string,
          unknown
        >;

        const result = await executeTool(toolCall.function.name, args);

        // OpenAI 格式：工具结果用 role: "tool"，附带 tool_call_id
        // （Anthropic 是 role: "user" + type: "tool_result"）
        this.messages.push({
          role: "tool",
          tool_call_id: toolCall.id, // 必须对应 tool_call 的 id
          content: result,
        });
      }

      // 继续循环 → 带着工具结果再次调用 LLM
    }

    return "抱歉，处理轮次过多，请简化您的问题。";
  }

  /**
   * 清空对话历史（开始新对话）
   */
  reset(): void {
    this.messages = [];
    console.log("  🔄 对话已重置\n");
  }
}
