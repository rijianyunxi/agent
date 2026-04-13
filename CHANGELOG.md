# 工作日志

## 2026-04-14 — 项目初始化 & Agent 核心实现

### 目标

用原生 TypeScript 从零实现一个智慧工地 AI Agent，不使用 LangChain/LangGraph，深入理解 Agent 的核心原理。

### 完成内容

#### 1. 项目搭建

- 初始化 TypeScript 项目（pnpm + tsx）
- 安装依赖：`openai`（SDK）、`tsx`（TS 运行器）
- 配置严格的 tsconfig（ESNext、noEmit、bundler 模式）

#### 2. Agent 核心实现（`src/agent.ts`）

实现了完整的 Agent Loop：

```
用户输入 → 构造 messages → 调用 LLM（带 tools）
  → finish_reason === "tool_calls" ? 执行工具，结果追加，再调 LLM : 输出回复
```

关键学习点：
- Agent 的本质就是一个 **while 循环**，不断在 LLM 和工具之间来回
- OpenAI 的 tool_calls 参数是 JSON 字符串，需要 `JSON.parse`
- 工具结果用 `role: "tool"` 返回，必须带 `tool_call_id` 对应
- 图片通过 `image_url` + data URL 格式传入（Vision 多模态）

#### 3. 工具层实现（`src/tools/`）

| 工具 | 文件 | 说明 |
|------|------|------|
| `query_attendance` | `attendance.ts` | 考勤查询，15 条 mock 数据，支持按日期查询 |
| `query_inspection` | `inspection.ts` | 巡检查询，5 条 mock 数据，支持按日期/状态过滤 |
| `analyze_image` | `image.ts` | 图片加载，读取本地文件转 base64 data URL |

工具注册表（`tools/index.ts`）：
- `toolDefinitions` — 传给 API 的 schema 数组
- `executeTool()` — 根据工具名分发执行

#### 4. CLI 交互入口（`src/main.ts`）

- readline 命令行交互
- 支持纯文本 / `图片:路径 问题` 两种输入格式
- `reset` 重置对话、`exit` 退出

### 架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 不用 LangChain | 原生 SDK | 学习 Agent 底层原理，理解框架在封装什么 |
| OpenAI 格式 | openai SDK | 兼容性好，DeepSeek/通义千问等都兼容此格式 |
| Mock 数据 | 内存中的静态数据 | 聚焦 Agent 逻辑，不引入数据库复杂度 |
| 工具注册表模式 | Map + 统一接口 | 新增工具只需创建文件 + 注册，不改核心逻辑 |

### 版本历程

1. **v1** — 最初使用 Anthropic SDK（`@anthropic-ai/sdk`）实现
2. **v2** — 切换为 OpenAI SDK 格式，兼容更多模型服务商

### 下一步计划

- [ ] 接入真实 API Key 测试完整流程
- [ ] 尝试接入 DeepSeek / 通义千问等国产模型（改 baseURL 即可）
- [ ] 增加更多工具：天气查询、设备状态、预警通知等
- [ ] 加入 streaming 流式输出
- [ ] 对比学习 LangChain 的 AgentExecutor 源码，看它如何封装同样的逻辑
