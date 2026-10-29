# Research Desk 代码图

当前开发 checkout 为 `E:\REA-Lab\ClawsGO_REA\research-desk`，origin 为 `sumingwang233/research-desk`。其他 checkout 使用各自的仓库根目录，不能沿用旧文档中的 D 盘 daemon 路径。

复用已安装的 code-review-graph MCP 或 CLI。数据库为本目录的 `graph.db`，忽略规则为根目录 `.code-review-graphignore`。`languages.toml` 用内置 JavaScript 语法补充 `.cjs`，覆盖 Electron 主进程、preload 和桌面验收入口；React `.jsx`、`.js` 与后端 `.mjs` 也应进入索引。无需重复安装 MCP 或启用付费嵌入。

## 操作

调用工具时始终显式传入上述 `repo_root`：

1. 开始代码任务时调用 `get_minimal_context_tool(task="任务描述", changed_files=["相对文件路径"])`。本项目已有 Git 历史，可用 HEAD 或明确提交作为增量基准。
2. 初始化、目录迁移或需要完整刷新时调用 `build_or_update_graph_tool(full_rebuild=true)`。
3. 用 `query_graph_tool` 查询具体函数、文件及其调用者；默认使用 `detail_level="minimal"`。
4. 修改完成后更新代码图；不将更新图等同于运行测试。

也可使用已安装的 CLI：

```powershell
$rdRepo = git rev-parse --show-toplevel
code-review-graph build --repo $rdRepo
code-review-graph status --repo $rdRepo
```

上述 CLI 示例在当前仓库目录运行。源码目录迁移或模块增加后完整刷新；本目录只提交 README 与 languages.toml，graph.db、WAL、SHM 和其他缓存留在本机。当前任务不启动后台 watch，不安装嵌入模型、不占 GPU，也不因更新图而运行测试。

图只提供静态导航线索。Electron IPC、utilityProcess 消息、HTTP/SSE 路由及 DOM 事件的跨进程连接仍须对照源码。备份源码时可以省略 `graph.db`，重新完整构建即可恢复。

历史索引结果见 `../acceptance/verification.md`；旧统计不能代替当前覆盖范围。
