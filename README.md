# 研序 Research Desk

面向个人研究的 Windows 桌面工作台：创建研究项目，检索文献元数据，调用自己配置的模型，通过来源卡片核对回答，批准后保存研究笔记。

首版参考 [ClawsGO Science](https://clawsgo.ai/) 公开产品的桌面、任务与事件分层设计。产品代码、Agent 循环、界面和本地数据存储由本项目独立实现；本项目与 ClawsGO Science 没有隶属关系。

## 使用

当前公开源码，版本为 0.2.0。安装 Node.js 后，可按下方“开发与验证”说明构建并启动。运行 `npm run dist` 可在本机生成 Windows 便携程序 `release/Research-Desk-0.2.0-x64.exe`；此构建没有代码签名。

1. 新建研究项目，填写研究方向。
2. 在“文献库”检索并保存文献；这一步不需要模型密钥。
3. 打开右上角模型设置，填写兼容 Chat Completions 的接口、模型名称和 API Key。接口须支持工具调用；可以使用不需要密钥的本机模型服务。HTTPS 为默认要求，本机 loopback 接口允许 HTTP。没有可用模型时，接口地址填 `mock://replay` 可离线体验完整任务流程（输出为本地模拟，明确标记，不混入真实资料）。
4. 在“研究助理”选择文献综述、研究方案或自由研究并发送问题。回答以流式增量呈现；推理过程默认折叠；工具卡显示检索词或笔记标题与执行状态；`[S1]` 等标识对应右侧来源卡片，点击可定位。
5. 任务进行中可停止、把下一条问题排队（当前任务结束后自动发出）或“打断并发送”。失败或已停止的任务可以一键重发原文。订阅中断时按 1/2/5/10/30 秒退避重连，用尽后可在右侧栏手动重连。
6. Agent 申请保存笔记时，检查完整标题与正文后允许或拒绝。未批准、过期或已停止的请求不能继续写入。

窄窗口通过“资料栏”按钮查看来源。“研究笔记”支持导入 UTF-8 `.md` / `.txt`（不超过 2 MiB）及导出 Markdown。重启后保留项目、会话、文献、笔记及已收到的输出；未结束任务标为已中断，可继续发起新任务。

模型请求会发送当前项目的研究方向、会话及工具返回的资料，并可能产生所选服务商的费用。首次配置后由用户主动发送研究问题；程序不自动运行付费任务。

## 数据与边界

数据位于 Electron 用户数据目录下的 `research-data`：

- `workspace/state.json`：项目、会话、来源、笔记和任务快照。
- `workspace/events/*.ndjson`：按序号追加的任务事件。
- `model-settings.json`：模型配置及操作系统 `safeStorage` 加密的密钥；不向页面返回密钥。若操作系统加密不可用，密钥仅保留在当前进程内。

单项目同时执行一个任务，全局最多两个；其余排队。默认最多 8 轮模型请求，可设置为 1–20 轮；每个任务最多 16 次工具调用，网络超时 60 秒，写入审批 10 分钟过期。JSON 快照适用于个人规模文献库；大规模频繁写入时应迁移 SQLite。

文献检索来自 [Crossref 公开元数据接口](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)。标题、作者、DOI、期刊、年份和部分摘要可用于查证线索，元数据不代表已阅读全文。首版没有 PDF 全文解析、任意终端执行、云同步或自动多 Agent 协作。模型回答仍需研究者核对原始文献。

## 开发与验证

桌面端使用 Electron 44.7.2 和 electron-builder 26.15.3；前端使用 Vite 7、React 19 和 react-router 7，打包为静态资源。服务端使用 Node 标准库，模型适配使用 `@earendil-works/pi-ai`；具体依赖版本见 `package-lock.json`。

```powershell
npm ci
npm run build   # 前端产物到 renderer/dist；test / desktop-smoke / dist 会自动构建
npm start
npm test
npm run desktop-smoke
npm run dist
npm run packaged-smoke
```

如果首次运行时 Electron 下载停滞，可执行 `node scripts/bootstrap-electron.cjs --mirror` 后重试。该脚本使用官方文档推荐的镜像，并验证 npm 包携带的官方校验值；不改环境变量。打包复用 `node_modules/electron/dist`。

核心测试使用 Node 子进程和本机 HTTP 模拟端点；桌面测试使用真实 Electron `utilityProcess`。模拟端点只存在于 `test/`，不进入产品包。桌面导入导出检查替换文件对话框，但运行真实 IPC 和文件读写。便携版验收使用独立用户数据目录，验证启动、项目保存、页面沙箱和关闭后的服务清理。所有模型验证均不消耗真实模型额度。

本地验收记录、截图、构建产物和用户数据不随源码提交。本次公开仓库整理没有重新运行测试或构建。

## 源码

| 目录 | 职责 |
| --- | --- |
| `electron/` | 窗口、受限 IPC、密钥加密、文件对话框和子进程生命周期 |
| `service/` | 仅 loopback 的认证接口、队列、审批、事件回放和原子快照 |
| `agent/` | 有轮次上限的模型循环、Crossref 检索及固定工具 |
| `shared/` | 前后端共享的流式 SSE 解析 |
| `renderer/` | React 工作台：`src/` 源码（路由、parts 归约、退避订阅、组件），`dist/` 构建产物 |

## 许可与致谢

项目源代码按 [MIT 许可证](LICENSE) 发布，作者为 Xin Wang（王鑫）。第三方依赖遵循各自许可证。产品设计参考 ClawsGO Science 的公开功能与交互；ClawsGO Science 的代码、品牌及服务不属于本项目。
