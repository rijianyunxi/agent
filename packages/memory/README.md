# @agent/memory

## 职责

- 存放长期记忆存储、对话窗口管理等状态层实现。
- 对上层暴露 memory store 和 sliding window，不关心 HTTP、MCP 或模型调用。

## 允许依赖

- `@agent/shared`
- 与存储和窗口实现直接相关的基础库，例如 `better-sqlite3`、`openai` 类型

## 禁止依赖

- `@agent/tools`
- `@agent/mcp`
- `@agent/core`
- `@agent/server`
- 任何 Koa、MCP client/server、CLI 交互逻辑

## 对外入口

- `src/index.ts`

