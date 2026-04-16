# 智慧工地 AI Agent

一个用原生 TypeScript 实现的 Agent 示例项目，当前包含：

- 基础 Agent loop
- 本地工具调用
- 长期记忆
- 可选的 Ollama 前置检索
- 基于 MCP 的动态工具接入
- MCP 配置热插拔

## 当前能力

- 考勤查询
- 巡检查询
- 图片分析
- 长期记忆读写
- 前置检索上下文注入
- MCP 外部工具动态加载

## 快速开始

```bash
pnpm install
pnpm dev:agent
```

如果安装后出现 `better-sqlite3` 或 `esbuild` 的原生构建被忽略，需要先批准构建脚本，再重新安装：

```bash
pnpm approve-builds
pnpm install --force
```

启动前至少需要设置：

```bash
OPENAI_API_KEY=your-api-key
```

可选环境变量：

```bash
AGENT_USER_ID=u001
AGENT_USER_SYMBOL=zhangsan
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=bge-m3
MCP_CONFIG_PATH=./mcp.servers.json
MEMORY_DB_PATH=./memory.db
SESSION_IDLE_TTL_MS=1800000
SESSION_MAX_LIFETIME_MS=7200000
SESSION_CLEANUP_INTERVAL_MS=60000
```

session 相关变量说明：

- `SESSION_IDLE_TTL_MS`：session 空闲多久后销毁，默认 30 分钟
- `SESSION_MAX_LIFETIME_MS`：session 最长保留时长，默认 2 小时
- `SESSION_CLEANUP_INTERVAL_MS`：后台定时清理周期，默认 60 秒

## 前置检索

前置检索实现位于 `src/retrieval/ollama-retriever.ts`。

行为规则：

- 如果本地 Ollama 不可用，则自动关闭检索。
- 如果 Ollama 可用但没有 `bge-m3` 或 `bge-m3:*` 这类模型，也会自动关闭检索。
- 只有在可用时，才会把记忆和历史对话做向量召回，并将结果作为额外 system context 注入。

这意味着你不需要为“没装模型”的环境额外改代码，直接跑即可。

## MCP 接入与热插拔

MCP 管理器位于 `packages/mcp/src/manager.ts`，当前通过 stdio 启动 MCP server，并在每轮对话开始前刷新配置。

注意：当前本地 attendance / inspection / memory tools 也已经改成通过本地 MCP server 暴露。
也就是说，Agent 侧已经统一为一条 MCP tool call 路径，本地工具和外部工具走的是同一套协议流转。

使用方式：

1. 复制 `mcp.servers.example.json` 为 `mcp.servers.json`
2. 填入你的 MCP server 启动命令
3. 下一轮对话时 agent 会自动重载配置

示例：

```json
{
  servers: {
    example: {
      command: node,
      args: [./path/to/mcp-server.js],
      cwd: .,
      enabled: true
    }
  }
}
```

热插拔当前的语义是：

- 修改 `mcp.servers.json`
- 不需要重启进程
- 下一次 `agent.run()` 前会刷新配置、重建动态工具集

## CLI 使用

直接运行：

```bash
pnpm dev:agent
```

输入格式：

- 普通对话：直接输入文本
- 图片分析：`image:./site.jpg 这张图有什么风险`
- 重置会话：`reset`
- 退出：`exit`

如果需要启动 HTTP 服务：

```bash
pnpm dev:server
```

## 关键文件

- `src/agent.ts`: Agent 主循环、检索上下文注入、MCP 刷新
- `src/tools/index.ts`: 本地工具和动态工具合并注册
- `src/retrieval/ollama-retriever.ts`: Ollama 检索实现
- `packages/mcp/src/manager.ts`: MCP stdio client 与热插拔管理
- `src/memory/memory-store.ts`: 长期记忆和对话日志存储
- `src/memory/sliding-window.ts`: 带 pinned system messages 的窗口管理

## 验证

```bash
pnpm exec tsc --noEmit
```
