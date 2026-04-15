# @agent/server

## 职责

- 存放 HTTP 服务、session 生命周期管理和对外 API。
- 负责把 `@agent/core` 包装成 Koa 服务，不承载 agent 内部实现细节。

## 允许依赖

- `@agent/core`
- `@agent/shared`
- 与 HTTP 服务直接相关的依赖，例如 `koa`

## 禁止依赖

- `@agent/memory`
- `@agent/tools`
- `@agent/mcp`
- 直接操作底层 MCP client 或内置工具实现

## 对外入口

- `src/app.ts`
- `src/main.ts`
- `src/session-manager.ts`

