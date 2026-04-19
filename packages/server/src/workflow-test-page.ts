export const BUSINESS_TEST_PAGE_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>智慧工地业务测试台</title>
  <style>
    :root {
      --bg: #f4efe7;
      --bg-accent: #dde8e3;
      --panel: rgba(255, 252, 247, 0.88);
      --panel-strong: rgba(255, 248, 236, 0.98);
      --line: rgba(19, 39, 40, 0.12);
      --ink: #152629;
      --muted: #516366;
      --accent: #c7682f;
      --accent-deep: #8e3c0c;
      --teal: #1d6d73;
      --teal-soft: #d7ecec;
      --success: #156f52;
      --warn: #9f5712;
      --danger: #ab302d;
      --code-bg: #132124;
      --code-ink: #d7eee8;
      --shadow: 0 24px 60px rgba(25, 43, 44, 0.12);
      --radius-xl: 28px;
      --radius-lg: 20px;
      --radius-md: 14px;
      --radius-sm: 10px;
      --mono: "IBM Plex Mono", "SFMono-Regular", "Consolas", monospace;
      --sans: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      --display: "Avenir Next Condensed", "Arial Narrow", "Helvetica Neue", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html {
      color-scheme: light;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--sans);
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(199, 104, 47, 0.18), transparent 28%),
        radial-gradient(circle at top right, rgba(29, 109, 115, 0.16), transparent 24%),
        linear-gradient(160deg, var(--bg) 0%, #eef4f1 48%, #f7f2e8 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.12)),
        repeating-linear-gradient(
          90deg,
          transparent 0,
          transparent 92px,
          rgba(21, 38, 41, 0.03) 92px,
          rgba(21, 38, 41, 0.03) 93px
        );
      opacity: 0.8;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    button,
    input,
    select,
    textarea {
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      min-height: 44px;
    }

    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 3px solid rgba(199, 104, 47, 0.28);
      outline-offset: 2px;
    }

    button {
      cursor: pointer;
      padding: 0 16px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-deep) 100%);
      color: #fff9f3;
      border: none;
      box-shadow: 0 12px 20px rgba(143, 60, 12, 0.18);
      transition: transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease;
    }

    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 24px rgba(143, 60, 12, 0.22);
    }

    button:active {
      transform: translateY(0);
    }

    button.secondary {
      background: linear-gradient(135deg, var(--teal) 0%, #174d57 100%);
      box-shadow: 0 12px 20px rgba(23, 77, 87, 0.18);
    }

    button.ghost {
      background: rgba(21, 38, 41, 0.06);
      color: var(--ink);
      border: 1px solid rgba(21, 38, 41, 0.1);
      box-shadow: none;
    }

    button.danger {
      background: linear-gradient(135deg, #d55f48 0%, var(--danger) 100%);
      box-shadow: 0 12px 20px rgba(171, 48, 45, 0.18);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    input,
    select,
    textarea {
      width: 100%;
      padding: 12px 14px;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.72);
    }

    textarea {
      min-height: 144px;
      resize: vertical;
    }

    code,
    pre {
      font-family: var(--mono);
    }

    pre {
      margin: 0;
      padding: 16px;
      min-height: 160px;
      border-radius: var(--radius-md);
      background: linear-gradient(180deg, rgba(14, 29, 32, 0.96) 0%, var(--code-bg) 100%);
      color: var(--code-ink);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .shell {
      position: relative;
      z-index: 1;
      width: min(1540px, calc(100vw - 32px));
      margin: 24px auto 40px;
    }

    .hero {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 18px;
    }

    .hero-card,
    .card,
    .panel {
      background: var(--panel);
      border: 1px solid rgba(255, 255, 255, 0.5);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }

    .hero-card {
      border-radius: calc(var(--radius-xl) + 8px);
      padding: 28px 28px 24px;
      overflow: hidden;
      position: relative;
    }

    .hero-card::after {
      content: "";
      position: absolute;
      right: -70px;
      top: -50px;
      width: 220px;
      height: 220px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(29, 109, 115, 0.22) 0%, rgba(29, 109, 115, 0) 72%);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(29, 109, 115, 0.1);
      color: var(--teal);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    h1,
    h2,
    h3 {
      margin: 0;
      font-family: var(--display);
      letter-spacing: 0.01em;
    }

    h1 {
      margin-top: 16px;
      font-size: clamp(34px, 4vw, 56px);
      line-height: 0.95;
      max-width: 10ch;
    }

    .hero-copy {
      max-width: 68ch;
      margin-top: 14px;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.65;
    }

    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 22px;
    }

    .metric {
      padding: 14px 16px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.56);
      border: 1px solid rgba(21, 38, 41, 0.08);
    }

    .metric-label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .metric strong {
      display: block;
      margin-top: 6px;
      font-size: 18px;
    }

    .status-grid {
      display: grid;
      gap: 12px;
    }

    .status-tile {
      padding: 18px;
      border-radius: var(--radius-lg);
      background: linear-gradient(180deg, rgba(255, 248, 236, 0.95) 0%, rgba(255, 255, 255, 0.75) 100%);
      border: 1px solid rgba(21, 38, 41, 0.08);
    }

    .status-tile h2 {
      font-size: 22px;
      margin-bottom: 8px;
    }

    .status-message {
      color: var(--muted);
      min-height: 48px;
      line-height: 1.55;
    }

    .badge-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      color: var(--ink);
      background: rgba(21, 38, 41, 0.08);
    }

    .badge::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.75;
    }

    .badge.success {
      color: var(--success);
      background: rgba(21, 111, 82, 0.12);
    }

    .badge.warn {
      color: var(--warn);
      background: rgba(159, 87, 18, 0.12);
    }

    .badge.danger {
      color: var(--danger);
      background: rgba(171, 48, 45, 0.12);
    }

    .layout {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .sidebar {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 18px;
    }

    .card,
    .panel {
      border-radius: var(--radius-xl);
      padding: 20px;
    }

    .card h2,
    .panel h2 {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .subtle {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .field-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .field-grid.full {
      grid-template-columns: 1fr;
    }

    .label {
      display: grid;
      gap: 6px;
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
      letter-spacing: 0.02em;
    }

    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .button-row button {
      flex: 1 1 140px;
    }

    .content {
      display: grid;
      gap: 18px;
    }

    .route-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .route-chip {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(21, 38, 41, 0.08);
    }

    .route-chip strong {
      display: block;
      font-size: 13px;
      color: var(--teal);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .route-chip span {
      display: block;
      margin-top: 6px;
      font-family: var(--mono);
      font-size: 13px;
      word-break: break-word;
    }

    .two-col,
    .three-col {
      display: grid;
      gap: 16px;
    }

    .two-col {
      grid-template-columns: 1.1fr 0.9fr;
    }

    .three-col {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .pill-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .pill {
      padding: 10px 12px;
      border-radius: 999px;
      border: 1px solid rgba(21, 38, 41, 0.1);
      background: rgba(255, 255, 255, 0.62);
      color: var(--ink);
      font-size: 13px;
      cursor: pointer;
      transition: transform 180ms ease, background 180ms ease;
    }

    .pill:hover {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.9);
    }

    .terminal {
      min-height: 220px;
    }

    .log-list {
      display: grid;
      gap: 12px;
      max-height: 420px;
      overflow: auto;
      padding-right: 4px;
    }

    .log-item {
      border-radius: var(--radius-md);
      border: 1px solid rgba(21, 38, 41, 0.08);
      background: rgba(255, 255, 255, 0.64);
      overflow: hidden;
    }

    .log-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      background: rgba(21, 38, 41, 0.05);
      font-size: 13px;
      font-weight: 700;
    }

    .log-kind {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--teal);
    }

    .log-kind.error {
      color: var(--danger);
    }

    .log-kind.success {
      color: var(--success);
    }

    .log-kind.stream {
      color: var(--warn);
    }

    .log-body {
      padding: 0 14px 14px;
    }

    .log-body pre {
      min-height: 0;
      background: rgba(19, 33, 36, 0.96);
    }

    .checkbox-line {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
    }

    .checkbox-line input {
      width: 18px;
      height: 18px;
      min-height: 18px;
      margin: 0;
    }

    .muted-box {
      border-radius: var(--radius-md);
      padding: 14px;
      background: rgba(29, 109, 115, 0.08);
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .panel {
      animation: rise 420ms ease both;
    }

    .content > .panel:nth-child(1) { animation-delay: 40ms; }
    .content > .panel:nth-child(2) { animation-delay: 100ms; }
    .content > .panel:nth-child(3) { animation-delay: 160ms; }
    .content > .panel:nth-child(4) { animation-delay: 220ms; }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 1180px) {
      .hero,
      .layout,
      .two-col,
      .three-col {
        grid-template-columns: 1fr;
      }

      .route-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .sidebar {
        position: static;
      }
    }

    @media (max-width: 720px) {
      .shell {
        width: min(100vw - 20px, 100%);
        margin: 10px auto 24px;
      }

      .hero-card,
      .card,
      .panel {
        padding: 16px;
      }

      .hero-metrics,
      .field-grid,
      .route-grid {
        grid-template-columns: 1fr;
      }

      .button-row button {
        flex-basis: 100%;
      }

      h1 {
        max-width: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <article class="hero-card">
        <div class="eyebrow">Unified Test Console</div>
        <h1>智慧工地业务测试台</h1>
        <p class="hero-copy">
          一个单页入口，直接覆盖当前服务里的主要业务接口：健康检查、普通聊天、流式聊天、会话重置与关闭、工作流启动、审批恢复、快照查询。
          页面上的 <code>sessionId</code>、<code>instanceId</code> 和 <code>approvalRequestId</code> 会在操作后自动联动更新。
        </p>
        <div class="hero-metrics">
          <div class="metric">
            <span class="metric-label">Page Route</span>
            <strong>/test</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Compat Route</span>
            <strong>/workflow-test</strong>
          </div>
          <div class="metric">
            <span class="metric-label">Shared Context</span>
            <strong>Session + Workflow</strong>
          </div>
        </div>
      </article>
      <article class="hero-card status-grid">
        <div class="status-tile">
          <h2>运行状态</h2>
          <div class="status-message" id="statusMessage">等待操作。建议先做一次健康检查，然后再发起聊天或工作流。</div>
          <div class="badge-row">
            <span class="badge warn" id="healthBadge">Health unknown</span>
            <span class="badge warn" id="streamBadge">Stream idle</span>
            <span class="badge warn" id="sessionBadge">Session empty</span>
          </div>
        </div>
        <div class="status-tile">
          <h2>当前入口</h2>
          <div class="subtle">当前页面基于服务端返回的单文件 HTML 渲染，不需要单独前端构建。</div>
          <div class="route-grid">
            <div class="route-chip"><strong>GET</strong><span>/health</span></div>
            <div class="route-chip"><strong>POST</strong><span>/chat</span></div>
            <div class="route-chip"><strong>POST</strong><span>/chat/stream</span></div>
            <div class="route-chip"><strong>POST</strong><span>/reset</span></div>
            <div class="route-chip"><strong>POST</strong><span>/session/close</span></div>
            <div class="route-chip"><strong>POST</strong><span>/workflows/start</span></div>
            <div class="route-chip"><strong>POST</strong><span>/workflows/approval/resume</span></div>
            <div class="route-chip"><strong>GET</strong><span>/workflows/:id</span></div>
          </div>
        </div>
      </article>
    </section>

    <section class="layout">
      <aside class="sidebar">
        <article class="card">
          <h2>共享上下文</h2>
          <p class="subtle">这些字段会被聊天、流式聊天、重置、关闭会话等操作复用。聊天成功后，新的 <code>sessionId</code> 会自动写回这里。</p>
          <div class="stack">
            <label class="label">sessionId
              <input id="sessionId" placeholder="留空时由服务端自动生成">
            </label>
            <div class="field-grid">
              <label class="label">userId
                <input id="userId" placeholder="如：u001">
              </label>
              <label class="label">userSymbol
                <input id="userSymbol" placeholder="如：zhangsan">
              </label>
            </div>
            <label class="label">imageUrl
              <input id="imageUrl" placeholder="可填 http(s) 或 data:image/...">
            </label>
            <label class="label">chat reset 标记
              <span class="checkbox-line">
                <input id="chatReset" type="checkbox">
                <span>发送聊天请求时带上 <code>reset: true</code></span>
              </span>
            </label>
            <div class="button-row">
              <button id="healthBtn" class="secondary" type="button">健康检查</button>
              <button id="clearOutputsBtn" class="ghost" type="button">清空输出区</button>
            </div>
            <div class="button-row">
              <button id="resetSessionBtn" class="ghost" type="button">重置会话</button>
              <button id="closeSessionBtn" class="danger" type="button">关闭会话</button>
            </div>
          </div>
        </article>

        <article class="card">
          <h2>快捷消息</h2>
          <p class="subtle">点击后会把示例文案写入聊天输入框，适合快速回归常见场景。</p>
          <div class="pill-row" id="promptPills">
            <button class="pill" data-prompt="今天工地考勤人数是多少？" type="button">考勤查询</button>
            <button class="pill" data-prompt="今天有哪些巡检不合格记录？" type="button">巡检查询</button>
            <button class="pill" data-prompt="帮我总结一下当前会话里提到的长期偏好。" type="button">记忆检索</button>
            <button class="pill" data-prompt="如果这张图片是工地现场照，请指出可能的安全隐患。" type="button">图片分析</button>
          </div>
        </article>

        <article class="card">
          <h2>工作流模板</h2>
          <p class="subtle">加载后会覆盖“工作流启动 JSON”编辑框，适合验证成功路径和失败补偿路径。</p>
          <div class="stack">
            <label class="label">模板选择
              <select id="workflowTemplate">
                <option value="inspection-default">整改流程：正常执行</option>
                <option value="inspection-failure">整改流程：通知失败回滚</option>
                <option value="demo-approval">演示流程：审批后执行</option>
              </select>
            </label>
            <div class="button-row">
              <button id="loadTemplateBtn" class="secondary" type="button">加载模板</button>
              <button id="clearWorkflowIdsBtn" class="ghost" type="button">清空流程 ID</button>
            </div>
          </div>
        </article>
      </aside>

      <main class="content">
        <article class="panel">
          <h2>聊天测试</h2>
          <p class="subtle">同一输入框可以走同步聊天和流式聊天。流式接口会解析 SSE 事件并把原始事件轨迹展示出来。</p>
          <div class="stack">
            <label class="label">message
              <textarea id="chatMessage" placeholder="输入你要测试的用户消息"></textarea>
            </label>
            <div class="button-row">
              <button id="chatBtn" type="button">发送同步聊天</button>
              <button id="streamBtn" class="secondary" type="button">发送流式聊天</button>
              <button id="stopStreamBtn" class="ghost" type="button" disabled>停止流式请求</button>
            </div>
            <div class="two-col">
              <div class="stack">
                <h3>最终回复</h3>
                <pre id="chatOutput" class="terminal">尚未收到聊天结果。</pre>
              </div>
              <div class="stack">
                <h3>流式事件</h3>
                <pre id="streamOutput" class="terminal">尚未启动流式聊天。</pre>
              </div>
            </div>
          </div>
        </article>

        <article class="panel">
          <h2>工作流测试</h2>
          <p class="subtle">支持启动流程、刷新快照、审批通过、审批驳回。启动或审批之后，页面会自动同步 <code>instanceId</code> 和待处理的 <code>approvalRequestId</code>。</p>
          <div class="stack">
            <label class="label">工作流启动 JSON
              <textarea id="startPayload"></textarea>
            </label>
            <div class="field-grid">
              <label class="label">instanceId
                <input id="instanceId" placeholder="启动成功后自动回填">
              </label>
              <label class="label">approvalRequestId
                <input id="approvalRequestId" placeholder="有 pending approval 时自动回填">
              </label>
            </div>
            <div class="field-grid">
              <label class="label">actor
                <input id="actor" value="site-manager">
              </label>
              <label class="label">comment
                <input id="comment" value="同意整改，立即执行">
              </label>
            </div>
            <div class="button-row">
              <button id="startWorkflowBtn" type="button">启动流程</button>
              <button id="refreshWorkflowBtn" class="secondary" type="button">刷新快照</button>
              <button id="approveWorkflowBtn" class="ghost" type="button">审批通过</button>
              <button id="rejectWorkflowBtn" class="danger" type="button">审批驳回</button>
            </div>
            <pre id="workflowOutput" class="terminal">尚未获取流程快照。</pre>
          </div>
        </article>

        <article class="panel">
          <h2>最近一次响应</h2>
          <p class="subtle">这里始终展示最近一次接口调用的解析结果，便于你核对返回结构和字段变化。</p>
          <pre id="latestResponse" class="terminal">暂无响应。</pre>
        </article>

        <article class="panel">
          <div class="button-row" style="margin-bottom: 12px;">
            <h2 style="flex: 1 1 auto; margin: 0;">调用日志</h2>
            <button id="clearLogsBtn" class="ghost" type="button" style="flex: 0 0 auto;">清空日志</button>
          </div>
          <p class="subtle">每一次请求、响应、流式事件都会记录在这里，便于排查参数、返回码和耗时。</p>
          <div id="logList" class="log-list"></div>
        </article>
      </main>
    </section>
  </div>

  <script>
    const templates = {
      "inspection-default": {
        workflowName: "inspection-rectification",
        input: {
          inspectionId: "INS-2024-005",
          area: "临时用电区域",
          assignee: "赵工",
          deadline: "2026-04-20 12:00",
          severity: "high",
          issues: ["配电箱门未关闭", "电缆拖地未架空"],
          simulateNotificationFailure: false
        }
      },
      "inspection-failure": {
        workflowName: "inspection-rectification",
        input: {
          inspectionId: "INS-2024-005",
          area: "临时用电区域",
          assignee: "赵工",
          deadline: "2026-04-20 12:00",
          severity: "high",
          issues: ["配电箱门未关闭"],
          simulateNotificationFailure: true
        }
      },
      "demo-approval": {
        workflowName: "demo-approval",
        input: {
          request: "deploy release",
          simulateFailure: false
        }
      }
    };

    const state = {
      logs: [],
      streamController: null
    };

    function $(id) {
      return document.getElementById(id);
    }

    const refs = {
      sessionId: $("sessionId"),
      userId: $("userId"),
      userSymbol: $("userSymbol"),
      imageUrl: $("imageUrl"),
      chatReset: $("chatReset"),
      chatMessage: $("chatMessage"),
      chatOutput: $("chatOutput"),
      streamOutput: $("streamOutput"),
      workflowOutput: $("workflowOutput"),
      latestResponse: $("latestResponse"),
      startPayload: $("startPayload"),
      workflowTemplate: $("workflowTemplate"),
      instanceId: $("instanceId"),
      approvalRequestId: $("approvalRequestId"),
      actor: $("actor"),
      comment: $("comment"),
      logList: $("logList"),
      statusMessage: $("statusMessage"),
      healthBadge: $("healthBadge"),
      streamBadge: $("streamBadge"),
      sessionBadge: $("sessionBadge")
    };

    function pretty(value) {
      if (typeof value === "string") {
        return value;
      }

      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    }

    function nowLabel() {
      const date = new Date();
      return date.toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    function setBadge(element, text, tone) {
      element.textContent = text;
      element.className = "badge" + (tone ? " " + tone : "");
    }

    function setStatus(message, tone) {
      refs.statusMessage.textContent = message;
      if (tone === "success") {
        setBadge(refs.healthBadge, refs.healthBadge.textContent, "success");
      }
    }

    function updateSessionBadge() {
      const hasSession = refs.sessionId.value.trim().length > 0;
      setBadge(
        refs.sessionBadge,
        hasSession ? "Session ready" : "Session empty",
        hasSession ? "success" : "warn"
      );
    }

    function setLatestResponse(label, payload) {
      refs.latestResponse.textContent = label + "\n\n" + pretty(payload);
    }

    function appendLog(kind, title, payload) {
      state.logs.unshift({
        id: Date.now() + Math.random(),
        kind: kind,
        title: title,
        payload: payload,
        time: nowLabel()
      });

      if (state.logs.length > 40) {
        state.logs.length = 40;
      }

      renderLogs();
    }

    function renderLogs() {
      refs.logList.innerHTML = "";

      if (state.logs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted-box";
        empty.textContent = "还没有日志。先执行一个接口请求。";
        refs.logList.appendChild(empty);
        return;
      }

      state.logs.forEach(function(entry) {
        const item = document.createElement("article");
        item.className = "log-item";

        const head = document.createElement("div");
        head.className = "log-head";

        const kind = document.createElement("div");
        kind.className = "log-kind" + (entry.kind ? " " + entry.kind : "");
        kind.textContent = entry.kind.toUpperCase() + " · " + entry.title;

        const time = document.createElement("div");
        time.textContent = entry.time;

        const body = document.createElement("div");
        body.className = "log-body";

        const pre = document.createElement("pre");
        pre.textContent = pretty(entry.payload);

        head.appendChild(kind);
        head.appendChild(time);
        body.appendChild(pre);
        item.appendChild(head);
        item.appendChild(body);
        refs.logList.appendChild(item);
      });
    }

    function syncSessionId(sessionId) {
      if (!sessionId) {
        return;
      }

      refs.sessionId.value = sessionId;
      updateSessionBadge();
    }

    function syncWorkflowSnapshot(snapshot) {
      refs.workflowOutput.textContent = pretty(snapshot);

      if (snapshot && snapshot.instance && snapshot.instance.id) {
        refs.instanceId.value = snapshot.instance.id;
      }

      if (snapshot && Array.isArray(snapshot.approvals)) {
        const pending = snapshot.approvals.find(function(item) {
          return item && item.status === "pending";
        });

        refs.approvalRequestId.value = pending && pending.id ? pending.id : "";
      }
    }

    function getSharedPayload() {
      const payload = {};
      const sessionId = refs.sessionId.value.trim();
      const userId = refs.userId.value.trim();
      const userSymbol = refs.userSymbol.value.trim();
      const imageUrl = refs.imageUrl.value.trim();

      if (sessionId) {
        payload.sessionId = sessionId;
      }
      if (userId) {
        payload.userId = userId;
      }
      if (userSymbol) {
        payload.userSymbol = userSymbol;
      }
      if (imageUrl) {
        payload.imageUrl = imageUrl;
      }

      return payload;
    }

    function requireSessionId() {
      const sessionId = refs.sessionId.value.trim();
      if (!sessionId) {
        throw new Error("请先填写或先通过聊天生成 sessionId");
      }
      return sessionId;
    }

    async function requestJson(url, options) {
      const method = options && options.method ? options.method : "GET";
      const body = options && Object.prototype.hasOwnProperty.call(options, "body") ? options.body : undefined;
      const startedAt = performance.now();
      appendLog("request", method + " " + url, body === undefined ? { body: null } : body);

      const init = {
        method: method,
        headers: {}
      };

      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      const response = await fetch(url, init);
      const text = await response.text();
      let data = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_error) {
          data = text;
        }
      }

      const result = {
        ok: response.ok,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        body: data
      };

      appendLog(response.ok ? "success" : "error", method + " " + url, result);
      setLatestResponse(method + " " + url, result);

      if (!response.ok) {
        const message = data && typeof data === "object" && typeof data.error === "string"
          ? data.error
          : "HTTP " + response.status;
        throw new Error(message);
      }

      return data;
    }

    function loadTemplate() {
      const key = refs.workflowTemplate.value;
      refs.startPayload.value = JSON.stringify(templates[key], null, 2);
    }

    async function runHealthCheck() {
      try {
        setStatus("正在检查 /health ...");
        const data = await requestJson("/health");
        setBadge(refs.healthBadge, "Health ok", "success");
        setStatus("健康检查通过。服务返回 ok=" + String(data && data.ok), "success");
      } catch (error) {
        setBadge(refs.healthBadge, "Health failed", "danger");
        setStatus("健康检查失败: " + error.message, "error");
      }
    }

    async function sendChat() {
      try {
        const message = refs.chatMessage.value.trim();
        if (!message) {
          throw new Error("message 不能为空");
        }

        setStatus("正在发送同步聊天 ...");
        const payload = Object.assign(getSharedPayload(), {
          message: message
        });

        if (refs.chatReset.checked) {
          payload.reset = true;
        }

        const data = await requestJson("/chat", {
          method: "POST",
          body: payload
        });

        syncSessionId(data && data.sessionId);
        refs.chatOutput.textContent = data && data.reply ? String(data.reply) : pretty(data);
        setStatus("同步聊天完成。", "success");
      } catch (error) {
        refs.chatOutput.textContent = "请求失败: " + error.message;
        setStatus("同步聊天失败: " + error.message, "error");
      }
    }

    async function streamChat() {
      if (state.streamController) {
        state.streamController.abort();
      }

      const message = refs.chatMessage.value.trim();
      if (!message) {
        setStatus("流式聊天失败: message 不能为空", "error");
        return;
      }

      const payload = Object.assign(getSharedPayload(), {
        message: message
      });

      if (refs.chatReset.checked) {
        payload.reset = true;
      }

      const controller = new AbortController();
      state.streamController = controller;
      refs.stopStreamBtn.disabled = false;
      refs.streamOutput.textContent = "连接中 ...";
      refs.chatOutput.textContent = "等待流式 reply 事件 ...";
      setBadge(refs.streamBadge, "Streaming", "warn");
      setStatus("正在建立流式连接 ...");
      appendLog("request", "POST /chat/stream", payload);

      try {
        const response = await fetch("/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          throw new Error("HTTP " + response.status);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const streamEvents = [];

        function flushEvent(rawEvent) {
          const lines = rawEvent.replace(/\r/g, "").split("\n");
          let eventName = "message";
          const dataLines = [];

          lines.forEach(function(line) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          });

          let data = dataLines.join("\n");
          try {
            data = data ? JSON.parse(data) : null;
          } catch (_error) {
            data = data || null;
          }

          streamEvents.push({
            event: eventName,
            data: data
          });

          refs.streamOutput.textContent = pretty(streamEvents);
          appendLog("stream", eventName, data);

          if (eventName === "session" && data && data.sessionId) {
            syncSessionId(data.sessionId);
          }

          if (eventName === "reply" && data && data.reply) {
            refs.chatOutput.textContent = String(data.reply);
          }

          if (eventName === "error") {
            setStatus("流式聊天失败: " + (data && data.error ? String(data.error) : "unknown error"), "error");
            setBadge(refs.streamBadge, "Stream error", "danger");
          }

          if (eventName === "done") {
            setStatus("流式聊天完成。", "success");
            setBadge(refs.streamBadge, "Stream done", "success");
          }
        }

        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });

          while (buffer.indexOf("\n\n") !== -1) {
            const boundary = buffer.indexOf("\n\n");
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (rawEvent.trim()) {
              flushEvent(rawEvent);
            }
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          flushEvent(buffer);
        }

        setLatestResponse("POST /chat/stream", streamEvents);
      } catch (error) {
        if (error.name === "AbortError") {
          setStatus("流式聊天已手动停止。", "warn");
          setBadge(refs.streamBadge, "Stream stopped", "warn");
        } else {
          refs.streamOutput.textContent = "流式请求失败: " + error.message;
          appendLog("error", "POST /chat/stream", { error: error.message });
          setStatus("流式聊天失败: " + error.message, "error");
          setBadge(refs.streamBadge, "Stream error", "danger");
        }
      } finally {
        refs.stopStreamBtn.disabled = true;
        state.streamController = null;
      }
    }

    function stopStream() {
      if (state.streamController) {
        state.streamController.abort();
      }
    }

    async function resetSession() {
      try {
        const sessionId = requireSessionId();
        setStatus("正在重置会话 ...");
        const payload = Object.assign(getSharedPayload(), { sessionId: sessionId });
        const data = await requestJson("/reset", {
          method: "POST",
          body: payload
        });
        setLatestResponse("POST /reset", data);
        refs.chatOutput.textContent = pretty(data);
        setStatus("会话已重置。", "success");
      } catch (error) {
        setStatus("重置会话失败: " + error.message, "error");
      }
    }

    async function closeSession() {
      try {
        const sessionId = requireSessionId();
        setStatus("正在关闭会话 ...");
        const payload = Object.assign(getSharedPayload(), { sessionId: sessionId });
        const data = await requestJson("/session/close", {
          method: "POST",
          body: payload
        });
        refs.chatOutput.textContent = pretty(data);
        setStatus("会话已关闭。", "success");
      } catch (error) {
        setStatus("关闭会话失败: " + error.message, "error");
      }
    }

    async function startWorkflow() {
      try {
        const payload = JSON.parse(refs.startPayload.value);
        setStatus("正在启动流程 ...");
        const snapshot = await requestJson("/workflows/start", {
          method: "POST",
          body: payload
        });
        syncWorkflowSnapshot(snapshot);
        setStatus("流程已启动，当前状态: " + String(snapshot && snapshot.instance ? snapshot.instance.status : "unknown"), "success");
      } catch (error) {
        refs.workflowOutput.textContent = "启动失败: " + error.message;
        setStatus("启动流程失败: " + error.message, "error");
      }
    }

    async function refreshWorkflow() {
      try {
        const instanceId = refs.instanceId.value.trim();
        if (!instanceId) {
          throw new Error("instanceId 不能为空");
        }
        setStatus("正在刷新流程快照 ...");
        const snapshot = await requestJson("/workflows/" + encodeURIComponent(instanceId));
        syncWorkflowSnapshot(snapshot);
        setStatus("流程快照已刷新。", "success");
      } catch (error) {
        refs.workflowOutput.textContent = "刷新失败: " + error.message;
        setStatus("刷新流程失败: " + error.message, "error");
      }
    }

    async function resumeWorkflow(approved) {
      try {
        const approvalRequestId = refs.approvalRequestId.value.trim();
        if (!approvalRequestId) {
          throw new Error("approvalRequestId 不能为空");
        }
        setStatus("正在提交审批 ...");
        const payload = {
          approvalRequestId: approvalRequestId,
          approved: approved,
          actor: refs.actor.value.trim(),
          comment: refs.comment.value.trim()
        };
        const snapshot = await requestJson("/workflows/approval/resume", {
          method: "POST",
          body: payload
        });
        syncWorkflowSnapshot(snapshot);
        setStatus("审批已提交，当前状态: " + String(snapshot && snapshot.instance ? snapshot.instance.status : "unknown"), "success");
      } catch (error) {
        refs.workflowOutput.textContent = "审批失败: " + error.message;
        setStatus("审批操作失败: " + error.message, "error");
      }
    }

    function clearOutputs() {
      refs.chatOutput.textContent = "尚未收到聊天结果。";
      refs.streamOutput.textContent = "尚未启动流式聊天。";
      refs.workflowOutput.textContent = "尚未获取流程快照。";
      refs.latestResponse.textContent = "暂无响应。";
      setStatus("输出区已清空。");
    }

    function clearWorkflowIds() {
      refs.instanceId.value = "";
      refs.approvalRequestId.value = "";
      setStatus("流程 ID 已清空。");
    }

    function wireEvents() {
      $("healthBtn").addEventListener("click", runHealthCheck);
      $("clearOutputsBtn").addEventListener("click", clearOutputs);
      $("chatBtn").addEventListener("click", sendChat);
      $("streamBtn").addEventListener("click", streamChat);
      $("stopStreamBtn").addEventListener("click", stopStream);
      $("resetSessionBtn").addEventListener("click", resetSession);
      $("closeSessionBtn").addEventListener("click", closeSession);
      $("loadTemplateBtn").addEventListener("click", loadTemplate);
      $("clearWorkflowIdsBtn").addEventListener("click", clearWorkflowIds);
      $("startWorkflowBtn").addEventListener("click", startWorkflow);
      $("refreshWorkflowBtn").addEventListener("click", refreshWorkflow);
      $("approveWorkflowBtn").addEventListener("click", function() {
        resumeWorkflow(true);
      });
      $("rejectWorkflowBtn").addEventListener("click", function() {
        resumeWorkflow(false);
      });
      $("clearLogsBtn").addEventListener("click", function() {
        state.logs = [];
        renderLogs();
        setStatus("日志已清空。");
      });
      refs.sessionId.addEventListener("input", updateSessionBadge);

      document.querySelectorAll("[data-prompt]").forEach(function(button) {
        button.addEventListener("click", function() {
          refs.chatMessage.value = button.getAttribute("data-prompt") || "";
        });
      });
    }

    function boot() {
      loadTemplate();
      updateSessionBadge();
      renderLogs();
      wireEvents();
      refs.chatMessage.value = "今天工地考勤人数是多少？";
    }

    boot();
  </script>
</body>
</html>`;
