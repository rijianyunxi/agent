# @agent/tools

## 职责

- 存放内置工具定义、tool registry、本地 MCP tool server 入口。
- 负责把具体工具实现组织成统一的 `Tool` 接口。

## 允许依赖

- `@agent/shared`
- `@agent/memory`

## 禁止依赖

- `@agent/mcp`
- `@agent/core`
- `@agent/server`
- 任何直接的模型主循环或 HTTP session 管理逻辑

## 对外入口

- `src/index.ts`
- `src/local-server.ts`

