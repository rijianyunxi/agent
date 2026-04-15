# @agent/mcp

## 职责

- 存放 MCP client/runtime 实现。
- 负责 stdio 子进程管理、JSON-RPC 请求响应、工具拉取和工具调用封装。

## 允许依赖

- `@agent/shared`
- 与 MCP 通信实现直接相关的基础库，例如 `openai` 类型

## 禁止依赖

- `@agent/memory`
- `@agent/tools`
- `@agent/core`
- `@agent/server`
- 任何业务工具实现、数据库存储或 HTTP 会话逻辑

## 对外入口

- `src/index.ts`

