import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { openStore, terminal } from './store.mjs';
import { AppError, id, text, projectInput, noteInput, publicError, httpsUrl, SENSITIVE_NAME, WORKSPACE_TEXT_EXT, workspacePath } from './validation.mjs';
import { searchPapers, questionInput } from '../agent/tools.mjs';
import { listProviders, listModels, findProvider } from './catalog.mjs';

const timestamp = () => new Date().toISOString();
export async function createService({ directory, rendererOrigin, token, settings, onStart, onStop, onToolResult, paperEndpoint, permissionMs = 600000 }) {
  const store = await openStore(directory);
  const active = new Map(), listeners = new Map(), workerChains = new Map();
  let config = settings, pumping = false, closing = false;
  let origin;
  const find = (collection, key) => { const item = store.get()[collection].find(v => v.id === id(key)); if (!item) throw new AppError('资料不存在', 404); return item; };
  const emit = event => {
    for (const res of listeners.get(event.taskId) || []) {
      if (res.writableLength > 1048576) { res.end(); continue; }
      res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  };
  const record = async (taskId, type, payload) => { const event = await store.record(taskId, type, payload); if (event) emit(event); return event; };
  async function finish(taskId, status, error = '') {
    const runtime = active.get(taskId);
    const task = find('tasks', taskId);
    if (terminal.has(task.status)) return;
    if (runtime) {
      runtime.cancelled = true;
      for (const pending of runtime.permissions.values()) { clearTimeout(pending.timer); pending.resolve({ allowed: false, error: '任务已结束' }); }
      runtime.permissions.clear();
    }
    await record(taskId, 'done', { status, error });
    await store.update(state => {
      const conversation = state.conversations.find(c => c.id === task.conversationId);
      if (conversation && !conversation.messages.some(m => m.taskId === taskId && m.role === 'assistant')) conversation.messages.push({ id: randomUUID(), role: 'assistant', content: find('tasks', taskId).output, taskId, createdAt: timestamp() });
    });
    active.delete(taskId);
    if (status !== 'completed') onStop?.(taskId);
    void pump();
  }
  async function pump() {
    if (pumping || closing) return;
    pumping = true;
    try {
      while (active.size < 2) {
        const busy = new Set([...active.values()].map(v => v.projectId));
        const task = store.get().tasks.find(t => t.status === 'queued' && !busy.has(t.projectId));
        if (!task) break;
        active.set(task.id, { projectId: task.projectId, cancelled: false, permissions: new Map() });
        await record(task.id, 'status', { status: 'running' });
        if (active.get(task.id)?.cancelled || terminal.has(find('tasks', task.id).status)) continue;
        try {
          const project = find('projects', task.projectId);
          const conversation = find('conversations', task.conversationId);
          const messages = conversation.messages.filter(m => m.content).slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 40000) }));
          await onStart?.(task, { mode: task.mode, direction: project.direction, messages, settings: config, paperEndpoint });
        } catch (error) { await finish(task.id, 'failed', publicError(error)); }
      }
    } finally { pumping = false; }
  }
  async function registerSources(projectId, sources) {
    if (!Array.isArray(sources) || sources.length > 10) throw new AppError('无效的来源列表');
    return store.update(state => sources.map(source => {
      const clean = { title: text(source.title, '文献题名', 1000), authors: String(source.authors || '').slice(0, 1000), year: String(source.year || '').slice(0, 10), doi: String(source.doi || '').slice(0, 300), url: httpsUrl(source.url) || '', abstract: String(source.abstract || '').slice(0, 16000), journal: String(source.journal || '').slice(0, 500), query: String(source.query || '').slice(0, 500), retrievedAt: timestamp() };
      let existing = state.sources.find(s => s.projectId === projectId && (clean.doi ? s.doi === clean.doi : s.title === clean.title));
      if (!existing) { existing = { id: randomUUID(), projectId, ...clean }; state.sources.push(existing); }
      return structuredClone(existing);
    }));
  }
  const projectWorkdir = projectId => {
    const project = store.get().projects.find(p => p.id === projectId);
    if (!project?.workdir) throw new AppError('项目未绑定本地文件夹，请先在项目设置中选择');
    return project.workdir;
  };
  async function listWorkspace(workdir) {
    const base = path.resolve(workdir);
    const files = [];
    let truncated = false;
    const walk = async (dir, depth) => {
      if (depth > 3 || files.length >= 200) { if (depth <= 3) truncated = true; return; }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (files.length >= 200) { truncated = true; return; }
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile() && WORKSPACE_TEXT_EXT.test(path.extname(entry.name)) && !SENSITIVE_NAME.test(entry.name)) {
          const stat = await fs.stat(full).catch(() => null);
          if (stat) files.push({ path: path.relative(base, full), size: stat.size, modified: stat.mtime.toISOString() });
        }
      }
    };
    await walk(base, 1);
    return { files, truncated };
  }
  async function handleTool(message) {
    const { taskId, requestId, operation, payload } = message;
    const task = find('tasks', taskId), runtime = active.get(taskId);
    if (!runtime || runtime.cancelled) throw new AppError('任务已停止', 409);
    id(requestId);
    if (operation === 'register_sources') {
      const saved = await registerSources(task.projectId, payload.sources);
      const current = find('tasks', taskId);
      const mapped = saved.map(source => ({ ...source, citation: current.sources.find(s => s.id === source.id)?.citation || '' }));
      let number = current.sources.length;
      for (const source of mapped) if (!source.citation) source.citation = `S${++number}`;
      const fresh = mapped.filter(source => !current.sources.some(s => s.id === source.id));
      if (fresh.length) await record(taskId, 'sources', { sources: fresh });
      return { sources: mapped, scope: '学术元数据及可取得摘要；不代表已读全文' };
    }
    if (operation === 'read_project_notes') return { notes: store.get().notes.filter(n => n.projectId === task.projectId).slice(-10).map(n => ({ title: n.title, content: n.content.slice(0, 12000) })) };
    if (operation === 'list_project_sources') {
      const saved = store.get().sources.filter(s => s.projectId === task.projectId).slice(-20);
      return handleTool({ ...message, operation: 'register_sources', payload: { sources: saved.slice(0, 10) } });
    }
    if (operation === 'list_workspace_files') return listWorkspace(projectWorkdir(task.projectId));
    if (operation === 'read_workspace_file') {
      const workdir = projectWorkdir(task.projectId);
      const relative = text(payload.path, '文件路径', 300);
      if (SENSITIVE_NAME.test(path.basename(relative))) throw new AppError('该文件名疑似凭据，不能读取');
      if (!WORKSPACE_TEXT_EXT.test(path.extname(relative))) throw new AppError('仅支持 Markdown / 文本 / CSV / JSON 文件');
      const full = workspacePath(workdir, relative);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat?.isFile()) throw new AppError('文件不存在');
      if (stat.size > 256 * 1024) throw new AppError('文件超过 256 KiB 上限');
      return { path: relative, content: await fs.readFile(full, 'utf8') };
    }
    const freeze = operation === 'save_research_note' ? p => ({ kind: 'note', ...noteInput(p) })
      : operation === 'ask_user_question' ? p => ({ kind: 'question', ...questionInput(p) })
      : null;
    if (!freeze) throw new AppError('执行器请求了未知工具操作');
    if (runtime.permissions.has(requestId)) throw new AppError('重复权限请求', 409);
    const frozen = freeze(payload);
    let resolve;
    const answer = new Promise(r => { resolve = r; });
    const timer = setTimeout(() => { void answerPermission(taskId, requestId, false).catch(() => {}); }, permissionMs);
    runtime.permissions.set(requestId, { ...frozen, resolve, timer, claimed: false });
    await record(taskId, 'permission', { requestId, ...frozen, expiresAt: new Date(Date.now() + permissionMs).toISOString() });
    await record(taskId, 'status', { status: 'waiting_permission' });
    return { deferred: answer };
  }
  async function answerPermission(taskId, requestId, allow, answers = '') {
    const runtime = active.get(taskId), pending = runtime?.permissions.get(requestId);
    if (!pending || pending.claimed || runtime.cancelled) throw new AppError('权限请求已结束或已答复', 409);
    pending.claimed = true; clearTimeout(pending.timer);
    let result = { allowed: false, reason: pending.kind === 'question' ? '用户拒绝回答' : '用户未批准写入' };
    try {
      if (allow && pending.kind === 'question') {
        result = { allowed: true, answers: text(answers, '澄清答复', 2000) };
      } else if (allow) {
        const task = find('tasks', taskId);
        const note = await store.update(state => {
          if (runtime.cancelled || terminal.has(state.tasks.find(t => t.id === taskId).status)) throw new AppError('任务已停止，未写入笔记', 409);
          const created = { id: randomUUID(), projectId: task.projectId, title: pending.title, content: pending.content, createdAt: timestamp(), taskId };
          state.notes.push(created); return created;
        });
        result = { allowed: true, noteId: note.id, title: note.title };
        // 项目绑定工作区时，批准的笔记镜像写入 <workdir>/research-notes/（不复盖已有文件）
        const workdir = store.get().projects.find(p => p.id === task.projectId)?.workdir;
        if (workdir) {
          try {
            const dir = workspacePath(workdir, 'research-notes');
            await fs.mkdir(dir, { recursive: true });
            const safe = note.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60) || 'note';
            const file = workspacePath(workdir, path.join('research-notes', `${safe}-${note.id.slice(0, 8)}.md`));
            await fs.writeFile(file, note.content, { encoding: 'utf8', flag: 'wx' });
            result.mirrored = file;
          } catch (error) { result.mirrorError = publicError(error); }
        }
      }
      await record(taskId, 'permission-answered', { requestId, allowed: result.allowed });
      await record(taskId, 'status', { status: 'running' });
      return result;
    } catch (error) { result = { allowed: false, error: publicError(error) }; throw error; }
    finally { runtime.permissions.delete(requestId); pending.resolve(result); }
  }
  async function appendDelta(taskId, kind, chunk) {
    const task = find('tasks', taskId);
    const last = task.parts[task.parts.length - 1];
    const index = last && last.type === kind ? task.parts.length - 1 : task.parts.length;
    if (index === task.parts.length) await record(taskId, 'part', { index, part: { type: kind, text: '' } });
    await record(taskId, 'part-delta', { index, text: chunk });
  }
  async function workerMessage(message) {
    const taskId = message.taskId;
    const job = (workerChains.get(taskId) || Promise.resolve()).then(async () => {
      const task = store.get().tasks.find(t => t.id === taskId);
      if (!task || terminal.has(task.status)) return;
      if (message.type === 'turn-event') {
        if (!['token','reasoning','tool','round'].includes(message.eventType)) throw new AppError('未知执行器事件');
        if ((message.eventType === 'token' || message.eventType === 'reasoning') && (typeof message.payload.text !== 'string' || message.payload.text.length > 100000)) throw new AppError('无效模型增量');
        if (message.eventType === 'token') await appendDelta(taskId, 'text', message.payload.text);
        else if (message.eventType === 'reasoning') await appendDelta(taskId, 'reasoning', message.payload.text);
        else if (message.eventType === 'tool') {
          const payload = message.payload;
          const current = find('tasks', taskId);
          const existing = current.parts.findIndex(p => p.type === 'tool' && p.callId === payload.callId);
          if (existing === -1) await record(taskId, 'part', { index: current.parts.length, part: { type: 'tool', ...payload } });
          else await record(taskId, 'part', { index: existing, part: { ...current.parts[existing], ...payload } });
          await record(taskId, 'tool', payload);
        }
        else await record(taskId, message.eventType, message.payload);
      } else if (message.type === 'tool-request') {
        try {
          const result = await handleTool(message);
          const reply = value => onToolResult?.({ type: 'tool-result', taskId, requestId: message.requestId, result: value });
          if (result.deferred) void result.deferred.then(reply); else reply(result);
        }
        catch (error) { onToolResult?.({ type: 'tool-result', taskId, requestId: message.requestId, error: publicError(error) }); }
      } else if (message.type === 'turn-finished') await finish(taskId, ['completed','stopped','failed'].includes(message.status) ? message.status : 'failed', String(message.error || '').slice(0, 500));
      else if (message.type === 'turn-exit') await finish(taskId, 'failed', '任务执行器已退出，已有结果已保留');
    }).catch(async error => { await finish(taskId, 'failed', publicError(error)).catch(() => {}); });
    workerChains.set(taskId, job);
    return job;
  }
  async function body(req, maximum = 1048576) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new AppError('请求超出大小限制', 413); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
    catch { throw new AppError('请求须为 JSON 对象'); }
  }
  /* 允许两个来源：本地服务自己的 origin（主进程代唤），以及渲染进程的自定义协议来源。
     渲染进程不再由本地服务发页面，UI 文件不通过 loopback HTTP 暴露。 */
  const allowedOrigin = value => value === origin || (rendererOrigin && value === rendererOrigin);
  function authenticate(req) {
    if (req.headers.host !== new URL(origin).host) throw new AppError('请求 Host 无效', 403);
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AppError('本地会话未授权', 401);
    if (req.headers.origin && !allowedOrigin(req.headers.origin)) throw new AppError('请求来源无效', 403);
    if (req.method !== 'GET' && !allowedOrigin(req.headers.origin)) throw new AppError('请求缺少有效来源', 403);
  }
  const cors = res => {
    if (!rendererOrigin) return;
    res.setHeader('Access-Control-Allow-Origin', rendererOrigin);
    res.setHeader('Vary', 'Origin');
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    cors(res);
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      /* 自定义协议来源的写入请求会先发预检，这里必须回应，否则 POST 一律失败 */
      if (req.method === 'OPTIONS' && rendererOrigin && req.headers.origin === rendererOrigin) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': rendererOrigin,
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'authorization,content-type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin'
        });
        res.end(); return;
      }
      const url = new URL(req.url, origin), p = url.pathname;
      if (!p.startsWith('/api/')) throw new AppError('接口不存在', 404);
      authenticate(req);
      const data = req.method === 'POST' ? await body(req, /^\/api\/projects\/[\w-]+\/import$/.test(p) ? 13 * 1048576 : 1048576) : {};
      if (req.method === 'GET' && p === '/api/bootstrap') { json({ ...store.get(), settings: config }); return; }
      // 内置供应商目录：设置面板的"添加供应商"从这里取，不在前端写死清单
      if (req.method === 'GET' && p === '/api/providers') { json({ providers: listProviders() }); return; }
      const catalogModels = p.match(/^\/api\/providers\/([a-z0-9-]{1,40})\/models$/);
      if (req.method === 'GET' && catalogModels) {
        if (!findProvider(catalogModels[1])) throw new AppError('未知的模型供应商', 404);
        json({ models: listModels(catalogModels[1]) }); return;
      }
      if (req.method === 'POST' && p === '/api/projects') {
        const clean = projectInput(data);
        if (clean.workdir) { const stat = await fs.stat(clean.workdir).catch(() => null); if (!stat?.isDirectory()) throw new AppError('工作目录不存在或不是文件夹'); }
        if (data.id) find('projects', data.id);
        const project = await store.update(state => {
          let item = state.projects.find(v => v.id === data.id);
          if (item) Object.assign(item, clean, { updatedAt: timestamp() });
          else { item = { id: randomUUID(), ...clean, createdAt: timestamp(), updatedAt: timestamp() }; state.projects.push(item); }
          return item;
        }); json(project); return;
      }
      const match = p.match(/^\/api\/(conversations|notes)\/([\w-]+)$/);
      if (req.method === 'GET' && match) { json(find(match[1], match[2])); return; }
      if (req.method === 'POST' && p === '/api/papers/search') {
        find('projects', data.projectId);
        const controller = new AbortController(); res.on('close', () => controller.abort());
        json({ sources: await searchPapers(text(data.query, '检索词', 500), data.limit ?? 8, controller.signal, paperEndpoint) }); return;
      }
      if (req.method === 'POST' && p === '/api/papers/save') { find('projects', data.projectId); json({ sources: await registerSources(data.projectId, data.sources) }); return; }
      const imported = p.match(/^\/api\/projects\/([\w-]+)\/import$/);
      if (req.method === 'POST' && imported) {
        find('projects', imported[1]); const clean = { title: text(data.title, '笔记标题', 200), content: text(data.content, '笔记内容', 2 * 1048576) };
        const note = { id: randomUUID(), projectId: imported[1], ...clean, createdAt: timestamp() };
        await store.update(state => { state.notes.push(note); }); json(note); return;
      }
      if (req.method === 'POST' && p === '/api/tasks') {
        const project = find('projects', data.projectId);
        if (!config.configured) throw new AppError('请先在模型设置中配置接口和模型', 409);
        if (!['review','plan','free'].includes(data.mode)) throw new AppError('无效研究模式');
        const content = text(data.text, '研究问题', 20000);
        const clientMessageId = data.clientMessageId === undefined ? '' : id(data.clientMessageId);
        let conversation = data.conversationId ? find('conversations', data.conversationId) : null;
        if (conversation && conversation.projectId !== project.id) throw new AppError('会话不属于该项目');
        // 同一 clientMessageId 的未结束任务视为重复提交（双击/重试安全），返回既有任务
        if (conversation && clientMessageId) {
          const duplicate = store.get().tasks.find(t => t.conversationId === conversation.id && t.clientMessageId === clientMessageId && !terminal.has(t.status));
          if (duplicate) { json(duplicate, 200); return; }
        }
        if (conversation && store.get().tasks.some(t => t.conversationId === conversation.id && !terminal.has(t.status))) throw new AppError('请先完成或停止此会话的任务', 409);
        const taskId = randomUUID();
        const task = await store.update(state => {
          if (conversation && state.tasks.some(t => t.conversationId === conversation.id && !terminal.has(t.status))) throw new AppError('请先完成或停止此会话的任务', 409);
          if (!conversation) { conversation = { id: randomUUID(), projectId: project.id, title: content.slice(0, 40), messages: [], createdAt: timestamp() }; state.conversations.push(conversation); }
          const current = state.conversations.find(c => c.id === conversation.id);
          // 重发：复用同 clientMessageId 的既有用户消息，新任务替换旧尝试的展示位置
          const existing = clientMessageId ? current.messages.find(m => m.clientMessageId === clientMessageId) : null;
          if (existing) existing.taskId = taskId;
          else current.messages.push({ id: randomUUID(), ...(clientMessageId ? { clientMessageId } : {}), role: 'user', content, taskId, createdAt: timestamp() });
          const item = { id: taskId, clientMessageId, projectId: project.id, conversationId: current.id, mode: data.mode, status: 'queued', output: '', parts: [], sources: [], tools: [], sequence: 0, permission: null, error: '', createdAt: timestamp() };
          state.tasks.push(item); return item;
        }); json(task, 202); void pump(); return;
      }
      const action = p.match(/^\/api\/tasks\/([\w-]+)\/(events|stop|permissions)(?:\/([\w-]+))?$/);
      if (action) {
        const task = find('tasks', action[1]);
        if (req.method === 'GET' && action[2] === 'events') {
          const after = Number(url.searchParams.get('after') || 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new AppError('无效事件游标');
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
          // Register before awaiting history; sequence deduplication removes overlapping events.
          const set = listeners.get(task.id) || new Set(); set.add(res); listeners.set(task.id, set);
          const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 20000);
          res.on('close', () => { clearInterval(heartbeat); set.delete(res); if (!set.size) listeners.delete(task.id); });
          res.write(`data: ${JSON.stringify({ type: 'snapshot', taskId: task.id, payload: find('tasks', task.id) })}\n\n`);
          for (const event of await store.history(task.id)) if (event.sequence > after && !res.destroyed) res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
          return;
        }
        if (req.method === 'POST' && action[2] === 'stop') {
          const runtime = active.get(task.id); if (runtime) runtime.cancelled = true;
          await finish(task.id, 'stopped'); json({ stopped: true }); return;
        }
        if (req.method === 'POST' && action[2] === 'permissions' && action[3]) {
          if (typeof data.allow !== 'boolean') throw new AppError('授权答复须为 allow 布尔值');
          if (data.answers !== undefined && typeof data.answers !== 'string') throw new AppError('澄清答复须为文本');
          json(await answerPermission(task.id, action[3], data.allow, data.answers || '')); return;
        }
      }
      throw new AppError('接口不存在', 404);
    } catch (error) {
      if (res.headersSent) res.end(); else json({ error: publicError(error) }, error.status || 500);
    }
  });
  // Some Windows hosts allocate port 0 within Chromium's blocked-port range.
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(randomInt(49152, 65536), '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      break;
    } catch (error) { if (error.code !== 'EADDRINUSE' || attempt === 19) throw error; }
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, store, workerMessage,
    setSettings: value => { config = value; },
    close: async () => {
      closing = true;
      for (const task of store.get().tasks.filter(t => !terminal.has(t.status))) await finish(task.id, 'interrupted', '应用已关闭');
      for (const set of listeners.values()) for (const res of set) res.end();
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.idle();
    }
  };
}

if (process.parentPort) {
  let service;
  const port = process.parentPort;
  port.on('message', async ({ data }) => {
    try {
      if (data.type === 'initialize') {
        service = await createService({ ...data.options, onStart: (task, input) => port.postMessage({ type: 'start-turn', task, input }), onStop: taskId => port.postMessage({ type: 'cancel-turn', taskId }), onToolResult: message => port.postMessage(message) });
        port.postMessage({ type: 'service-ready', origin: service.origin });
      } else if (data.type === 'settings') service?.setSettings(data.settings);
      else if (data.type === 'shutdown') { await service?.close(); port.postMessage({ type: 'shutdown-complete' }); process.exit(0); }
      else await service?.workerMessage(data);
    } catch (error) { port.postMessage({ type: 'service-error', error: publicError(error) }); }
  });
}
