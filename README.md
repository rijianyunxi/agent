# 智慧工地 AI Agent

用原生 TypeScript + OpenAI SDK 从零实现的 Agent，不依赖 LangChain / LangGraph，用于学习 Agent 核心原理。

## 核心概念

**Agent 的本质就是一个 while 循环：**

```
用户输入 → LLM（带 tools）→ 要调工具？
  ├─ 否 → 输出回复，结束
  └─ 是 → 执行工具 → 结果喂回 LLM → 再判断（循环）
```

LangChain / LangGraph 封装的核心逻辑就是这个。理解了这个循环，就理解了 Agent。

## 功能

| 功能 | 示例问题 | 对应工具 |
|------|---------|---------|
| 考勤查询 | "今天考勤如何" | `query_attendance` |
| 巡检查询 | "今日巡检情况" / "有哪些不合格项" | `query_inspection` |
| 图片风险识别 | "图片:./site.jpg 有什么安全隐患" | `analyze_image` + Vision |
| 多工具联动 | "请假几人，巡检有没有问题" | 自动调用多个工具 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 设置 API Key
export OPENAI_API_KEY=your-api-key

# 运行
pnpm dev
```

> 如果使用兼容 OpenAI 格式的其他服务（DeepSeek、通义千问等），修改 `src/agent.ts` 中的 `baseURL` 和 `model` 即可。

## 项目结构

```
src/
├── main.ts                 # 入口：readline CLI 交互
├── agent.ts                # ⭐ Agent 核心：agent loop（最值得学习的文件）
├── types.ts                # 类型定义
└── tools/
    ├── index.ts            # 工具注册表 + 分发执行
    ├── attendance.ts       # 考勤查询工具 + mock 数据
    ├── inspection.ts       # 巡检查询工具 + mock 数据
    └── image.ts            # 图片加载（base64 data URL）
```

## 关键文件说明

### `agent.ts` — Agent Loop（核心）

这是整个项目最重要的文件。核心逻辑不到 50 行：

1. **构造消息** — 把用户输入（文本/图片）组装成 OpenAI 格式的 message
2. **调用 LLM** — `chat.completions.create()` 带上 tools 定义
3. **判断返回** — `finish_reason === "tool_calls"` 还是 `"stop"`
4. **执行工具** — 解析 `tool_calls`，调用本地函数，收集结果
5. **循环** — 把工具结果作为 `role: "tool"` 消息追加，再次调用 LLM

### `tools/` — 工具层

每个工具包含两部分：
- **definition** — JSON Schema，告诉 LLM 这个工具能做什么、接受什么参数
- **execute()** — 本地执行函数，LLM 决定调用时由 Agent 执行

新增工具只需：
1. 在 `tools/` 下创建文件，导出 `Tool` 对象
2. 在 `tools/index.ts` 中注册

## 使用方式

```
👷 你: 今天考勤如何
  🤖 第 1 轮调用 LLM...
  🔧 LLM 要调用 1 个工具: query_attendance
  🔧 调用工具: query_attendance {}
  ✅ 工具返回: { "date": "2026-04-14", "totalExpected": 15, ...
  🤖 第 2 轮调用 LLM...
  💬 Agent 回复完成

🤖 助手: 今日考勤情况如下：应到15人，实到12人...

👷 你: 图片:./site.jpg 这个工地有什么安全隐患
  📷 已加载图片: ./site.jpg
  🤖 第 1 轮调用 LLM...
  💬 Agent 回复完成

🤖 助手: 从照片中识别到以下安全隐患：1. 有工人未佩戴安全帽...
```

## Anthropic vs OpenAI 格式对比

如果你想切换到 Anthropic Claude API，主要差异如下：

| 概念 | OpenAI | Anthropic |
|------|--------|-----------|
| SDK | `openai` | `@anthropic-ai/sdk` |
| 系统提示 | `role: "system"` 消息 | 单独的 `system` 参数 |
| 工具定义 | `{ type:"function", function:{ name, parameters } }` | `{ name, input_schema }` |
| LLM 要调工具 | `finish_reason: "tool_calls"` | `stop_reason: "tool_use"` |
| 工具调用信息 | `message.tool_calls` 数组 | content 中的 `tool_use` block |
| 工具参数 | JSON 字符串，需 `JSON.parse` | 已解析的对象 |
| 工具结果返回 | `role: "tool"` + `tool_call_id` | `role: "user"` + `type: "tool_result"` |
| 图片传入 | `image_url` + data URL | `image` block + base64 source |

## 技术栈

- **TypeScript** — 严格模式
- **OpenAI SDK** — `openai`
- **tsx** — 直接运行 TS，无需编译
- **pnpm** — 包管理
