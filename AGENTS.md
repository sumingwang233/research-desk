# Research Desk

## 项目导航

先读 `README.md`，再沿 `electron/main.cjs` → `service/server.mjs` → `agent/turn.mjs` 理解进程和任务链路。界面为 React SPA：源码 `renderer/src/`（入口 `main.jsx`），`npm run build` 产出 `renderer/dist/`，由主进程的 `app://bundle/` 协议提供；本地服务只承担认证 API。模型适配复用 pi-ai，编辑和预览复用现有前端依赖，不增加无必要依赖。

## Code Review Graph

如果环境提供 `code_review_graph` MCP，将 `repo_root` 设置为本仓库根目录。先调用 `get_minimal_context_tool`，再按需查询调用者与依赖。代码图缺失时可构建；测试仍须遵守当次授权。

忽略规则在 `.code-review-graphignore`。提交 `.code-review-graph/README.md` 和 `languages.toml`，数据库及缓存不提交。源码目录迁移或模块增加后完整刷新索引，并按第一方源码清单核对覆盖范围。IPC、HTTP、SSE 和 DOM 事件关系须结合源码确认，静态调用边不能完整表达运行时链路。

## 验证与边界

遵守用户当次测试授权；不因代码图更新而自动执行测试。获准时使用 `npm test`、`npm run desktop-smoke`、`npm run dist` 和 `npm run packaged-smoke`。模型层为 `@earendil-works/pi-ai` 适配器（`agent/provider.mjs`）；`agent/replay.mjs` 的模型回复不调用模型服务，但工具仍可能访问 Crossref。未经明确授权，不运行付费模型请求、不发起 OAuth 登录、不修改远端资源或读取现有凭据。
