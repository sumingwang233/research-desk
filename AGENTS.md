# Research Desk

## 项目导航

先读 `README.md`，再沿 `electron/main.cjs` → `service/server.mjs` → `agent/turn.mjs` 理解进程和任务链路。界面为 React SPA：源码 `renderer/src/`（入口 `main.jsx`），`npm run build` 产出 `renderer/dist/` 由服务端托管。服务端与 Agent 用 Node 标准库；前端仅构建期依赖（Vite/React/react-router），不增加无必要依赖。

## Code Review Graph

如果环境提供 `code_review_graph` MCP，将 `repo_root` 设置为本仓库根目录。先调用 `get_minimal_context_tool`，再按需查询调用者与依赖。代码图缺失时可构建；测试仍须遵守当次授权。

忽略规则在 `.code-review-graphignore`，本地 `.code-review-graph/` 缓存不提交。IPC、HTTP、SSE 和 DOM 事件关系须结合源码确认，静态调用边不能完整表达运行时链路。

## 验证与边界

遵守用户当次测试授权；不因代码图更新而自动执行测试。获准时使用 `npm test`、`npm run desktop-smoke`、`npm run dist` 和 `npm run packaged-smoke`。模型层为 `@earendil-works/pi-ai` 适配器（`agent/provider.mjs`），模拟模型只在 `test/` 与 `agent/replay.mjs`（`mock://` 地址，不发网络请求）中；未经明确授权，不运行付费模型请求、不发起 OAuth 登录、不修改远端资源或读取现有凭据。
