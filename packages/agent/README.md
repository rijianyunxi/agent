# @agent/core

## 职责

- 存放 agent runtime、模型调用主循环、检索接入和 CLI 入口。
- 负责把 memory、tools、mcp 这些基础能力编排成一个可运行的 agent。

## 允许依赖

- `@agent/shared`
- `@agent/memory`
- `@agent/tools`
- `@agent/mcp`
- 与 agent runtime 直接相关的模型 SDK 和环境加载工具

## 禁止依赖

- `@agent/server`
- 直接内嵌 HTTP/Koa 会话层实现
- 重新定义已经在 `shared / memory / tools / mcp` 中存在的基础职责

## 对外入口

- `src/index.ts`
- `src/main.ts`

