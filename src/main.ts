/**
 * 入口文件 —— 命令行交互
 *
 * 使用 Node.js readline 实现简单的 CLI 交互
 * 支持：
 *   - 直接输入文本提问
 *   - 输入 "图片:/path/to/image.jpg 你的问题" 来分析图片
 *   - 输入 "reset" 重置对话
 *   - 输入 "exit" 退出
 */
import "dotenv/config"
import { createInterface } from "node:readline";

import { SmartSiteAgent } from "./agent.ts";

// ============================================================
// 解析用户输入：提取图片路径和文本
// ============================================================

interface ParsedInput {
  text: string;
  imagePath?: string | undefined;
}

/**
 * 解析用户输入
 * 格式：图片:/path/to/image.jpg 这里是问题文本
 * 或者：直接输入文本
 */
function parseInput(raw: string): ParsedInput {
  const imageMatch = raw.match(/^图片:(\S+)\s*(.*)/s);

  if (imageMatch) {
    return {
      imagePath: imageMatch[1],
      text: imageMatch[2] || "请分析这张工地照片中的安全隐患和风险点。",
    };
  }

  return { text: raw };
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  // 检查 API Key
  if (!process.env["OPENAI_API_KEY"]) {
    console.error("❌ 请设置环境变量 OPENAI_API_KEY");
    console.error("   export OPENAI_API_KEY=your-api-key");
    process.exit(1);
  }

  const agent = new SmartSiteAgent();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       🏗️  智慧工地 AI 助手              ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║  直接输入问题即可对话                      ║");
  console.log("║  图片分析: 图片:/路径/图片.jpg 你的问题     ║");
  console.log("║  输入 reset 重置对话                      ║");
  console.log("║  输入 exit  退出程序                      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  const prompt = (): void => {
    rl.question("👷 你: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "exit") {
        console.log("👋 再见！");
        rl.close();
        process.exit(0);
      }

      if (trimmed === "reset") {
        agent.reset();
        prompt();
        return;
      }

      try {
        const { text, imagePath } = parseInput(trimmed);
        const reply = await agent.run(text, imagePath);
        console.log(`\n🤖 助手: ${reply}\n`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ 出错了: ${msg}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
