import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createService } from '../service/server.mjs';
import { openStore } from '../service/store.mjs';
import { modelSettings, isConfigured, importName } from '../service/validation.mjs';
import { listProviders, listModels, isBuiltinProvider } from '../service/catalog.mjs';
import { resolveModelForSettings } from '../agent/provider.mjs';
import rendererProtocolModule from '../electron/renderer-protocol.cjs';

const { rendererProtocol } = rendererProtocolModule;
import { parseSSE } from '../shared/sse.mjs';
import { complete } from '../agent/provider.mjs';
import { runTurn } from '../agent/turn.mjs';
import { executeTool } from '../agent/tools.mjs';
import { mockServer } from './mock-server.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function waitFor(fn, timeout = 8000) { const started = Date.now(); while (Date.now() - started < timeout) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out awaiting condition'); }

test('fragmented SSE preserves UTF-8, CRLF, multiline and cancellation', async () => {
  const bytes = new TextEncoder().encode(': ping\r\ndata: 第一行\r\ndata: 第二行\r\n\r\ndata: tail\n\n');
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close(); }, cancel() { cancelled = true; } });
  const values = []; for await (const value of parseSSE(body)) values.push(value);
  assert.deepEqual(values, ['第一行\n第二行', 'tail']);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: first\n\n')); }, cancel() { cancelled = true; } });
  for await (const _ of parseSSE(stream)) break;
  assert.equal(cancelled, true);
});

test('model settings and tool inputs reject unsafe boundaries', async () => {
  assert.equal(modelSettings({ endpoint: 'http://127.0.0.1:1234', model: 'local' }).endpoint, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.equal(modelSettings({ endpoint: 'mock://replay', model: '本地回放' }).endpoint, 'mock://replay');
  assert.throws(() => modelSettings({ endpoint: 'mock://Replay_1', model: 'x' }));
  for (const endpoint of ['http://example.com/v1','file:///tmp/model','https://a:b@example.com/v1','https://example.com/v1?key=secret']) assert.throws(() => modelSettings({ endpoint, model: 'x' }));
  for (const name of ['.env','credentials.txt','private-key.md','id_rsa.txt']) assert.throws(() => importName(name));
  assert.equal(importName('research-notes.md'), 'research-notes.md');
  await assert.rejects(executeTool('run_shell', {}, {}));
  await assert.rejects(executeTool('read_project_notes', { command: 'anything' }, {}));
});

test('built-in providers come from the pi-ai catalog instead of a hardcoded list', async () => {
  const providers = listProviders();
  assert.equal(providers.length > 20, true);
  assert.equal(providers.every(entry => entry.baseUrl && entry.modelCount > 0), true);
  const anthropic = providers.find(entry => entry.id === 'anthropic');
  assert.equal(anthropic.baseUrl, 'https://api.anthropic.com');
  assert.equal(anthropic.supportsOAuth, true);
  assert.equal(listModels('anthropic').length > 5, true);

  // 需要区域/资源名等额外凭据的供应商不应可选项，否则只会配出跑不通的条目
  assert.equal(isBuiltinProvider('azure'), false);
  assert.equal(isBuiltinProvider('amazon-bedrock'), false);
  assert.equal(isBuiltinProvider('google-vertex'), false);
  assert.equal(isBuiltinProvider('openai-codex'), false);

  // 内置供应商的地址由目录提供，不再往配置里写 endpoint
  const settings = modelSettings({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(settings, { provider: 'anthropic', endpoint: '', model: 'claude-haiku-4-5-20251001', maxRounds: 8, effort: '', configured: false });
  assert.equal(isConfigured(settings), true);
  assert.equal(isConfigured({ provider: 'custom', endpoint: '', model: 'x' }), false);
  assert.equal(isConfigured({ provider: 'custom', endpoint: 'http://127.0.0.1:1234/v1', model: 'x' }), true);

  // 旧配置里的 openai-compatible 归一为 custom，且地址保留
  const legacy = modelSettings({ provider: 'openai-compatible', endpoint: 'http://127.0.0.1:1234', model: 'local' });
  assert.equal(legacy.provider, 'custom');
  assert.equal(legacy.endpoint, 'http://127.0.0.1:1234/v1/chat/completions');
  assert.throws(() => modelSettings({ provider: 'not-a-provider', model: 'x' }));

  // 思考等级映射：三态（默认省略 / null 禁用 / 字符串自定义）
  const mapped = modelSettings({ provider: 'anthropic', model: 'x', effort: 'xhigh', thinkingLevelMap: { low: 'low', minimal: null, high: '' } });
  assert.deepEqual(mapped.thinkingLevelMap, { low: 'low', minimal: null });
  assert.equal(mapped.effort, 'xhigh');
  assert.throws(() => modelSettings({ provider: 'anthropic', model: 'x', effort: 'extreme' }));
  assert.throws(() => modelSettings({ provider: 'anthropic', model: 'x', thinkingLevelMap: { low: 42 } }));
  assert.throws(() => modelSettings({ provider: 'anthropic', model: 'x', thinkingLevelMap: { low: 'x'.repeat(41) } }));
  // 未知档位直接丢弃，不给后端传垃圾键
  assert.deepEqual(modelSettings({ provider: 'anthropic', model: 'x', thinkingLevelMap: { nope: 'x', low: 'l' } }).thinkingLevelMap, { low: 'l' });

  // 映射真的落到模型上：用户值覆盖、null 原样保留、未覆盖的保持目录默认
  const resolved = resolveModelForSettings({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', thinkingLevelMap: { low: 'low', minimal: null } });
  assert.equal(resolved.thinkingLevelMap.low, 'low');
  assert.equal(resolved.thinkingLevelMap.minimal, null);
  const plain = resolveModelForSettings({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
  assert.equal(plain.id, 'claude-haiku-4-5-20251001');
  assert.notEqual(plain.thinkingLevelMap?.low, 'low');
});

test('provider handles fragmented tools, HTTP errors, broken streams and abort', async () => {
  const mock = await mockServer();
  try {
    const reasoning = [];
    const run = question => complete({ settings: { endpoint: mock.endpoint, model: 'mock' }, messages: [{ role: 'user', content: question }], tools: [], signal: new AbortController().signal, onToken() {}, onReasoning: value => reasoning.push(value) });
    const answer = await run('research'); assert.equal(answer.tool_calls[0].function.name, 'search_papers'); assert.equal(JSON.parse(answer.tool_calls[0].function.arguments).limit, 3);
    assert.deepEqual(reasoning, ['先梳理问题边界与可用证据。']);
    await assert.rejects(run('[failure]'), /HTTP 401/);
    await assert.rejects(run('[broken]'), /意外断开/);
    await assert.rejects(run('[empty]'), /没有返回文本或工具调用/);
    const controller = new AbortController(); const stopped = complete({ settings: { endpoint: mock.endpoint, model: 'mock' }, messages: [{ role: 'user', content: '[stop]' }], tools: [], signal: controller.signal, onToken() { controller.abort(); } });
    await assert.rejects(stopped);
  } finally { await mock.close(); }
});

test('task flow isolates projects, gates writes, replays SSE, cancels and restores', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-core-'));
  const mock = await mockServer(), children = new Map();
  const settings = { ...modelSettings({ endpoint: mock.endpoint, model: 'local-test', maxRounds: 8 }), configured: true };
  const token = 'local-test-session-token';
  let service = await createService({ directory, staticDir: path.join(root, 'renderer'), token, settings, paperEndpoint: mock.paperEndpoint,
    onStart(task, input) { const child = fork(path.join(root, 'agent/turn.mjs'), [], { stdio: ['ignore','pipe','pipe','ipc'] }); children.set(task.id, child); child.on('message', message => { void service.workerMessage(message); }); child.on('exit', () => { children.delete(task.id); void service.workerMessage({ type: 'turn-exit', taskId: task.id }); }); child.send({ type: 'start-turn', task, input }); },
    onStop(taskId) { const c = children.get(taskId); if (c?.connected) try { c.send({ type: 'cancel-turn' }); } catch {} },
    onToolResult(message) { const c = children.get(message.taskId); if (c?.connected) try { c.send(message); } catch {} }
  });
  const call = async (route, data, overrides = {}) => { const response = await fetch(`${service.origin}${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: service.origin, 'Content-Type': 'application/json', ...overrides }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  const task = id => service.store.get().tasks.find(t => t.id === id);
  const launch = async (projectId, text = '研究信任校准') => { const result = await call('/api/tasks', { projectId, text, mode: 'review' }); assert.equal(result.status, 202); return result.data; };
  try {
    assert.ok(new URL(service.origin).port >= 49152);
    assert.equal((await call('/api/bootstrap', undefined, { Authorization: 'wrong' })).status, 401);
    assert.equal((await call('/api/projects', { name: 'bad' }, { Origin: 'https://untrusted.example' })).status, 403);
    const hostStatus = await new Promise(resolve => { http.get(`${service.origin}/api/bootstrap`, { headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, response => { response.resume(); resolve(response.statusCode); }); });
    assert.equal(hostStatus, 403);
    const a = (await call('/api/projects', { name: '信任校准', direction: '人机协作' })).data;
    const b = (await call('/api/projects', { name: '项目隔离', direction: '' })).data;
    assert.equal((await call(`/api/projects/${b.id}/import`, { title: '隔离笔记', content: '只应属于项目 B' })).status, 200);
    const first = await launch(a.id);
    const waiting = await waitFor(() => task(first.id).status === 'waiting_permission' && task(first.id));
    assert.equal(waiting.status, 'waiting_permission'); assert.equal(service.store.get().notes.filter(n => n.projectId === a.id).length, 0);
    assert.equal(waiting.sources.length, 1); assert.equal(waiting.sources[0].citation, 'S1'); assert.equal(waiting.sources[0].doi, '10.1234/research.2026');
    assert.equal((await call(`/api/tasks/${first.id}/permissions/${waiting.permission.requestId}`, { allow: false })).status, 200);
    assert.equal((await call(`/api/tasks/${first.id}/permissions/${waiting.permission.requestId}`, { allow: true })).status, 409);
    await waitFor(() => task(first.id).status === 'completed');
    assert.match(task(first.id).output, /保存被拒绝/); assert.match(task(first.id).output, /。 保存/);
    assert.equal(service.store.get().notes.filter(n => n.projectId === a.id).length, 0);
    const parts = task(first.id).parts;
    assert.equal(parts[0].type, 'reasoning');
    assert.ok(parts.some(p => p.type === 'tool' && p.name === 'search_papers' && p.status === 'completed'));
    assert.ok(parts.some(p => p.type === 'tool' && p.name === 'save_research_note'));
    assert.equal(parts.filter(p => p.type === 'text').map(p => p.text).join(''), task(first.id).output);
    const stream = await fetch(`${service.origin}/api/tasks/${first.id}/events?after=1`, { headers: { Authorization: `Bearer ${token}` } });
    const iterator = parseSSE(stream.body); const snapshot = JSON.parse((await iterator.next()).value); assert.equal(snapshot.type, 'snapshot'); assert.equal(snapshot.payload.output, task(first.id).output);
    const replay = JSON.parse((await iterator.next()).value); assert.ok(replay.sequence > 1); await iterator.return();
    const second = await launch(a.id, '允许保存的研究');
    const permission = await waitFor(() => task(second.id).permission);
    assert.equal((await call(`/api/tasks/${second.id}/permissions/${permission.requestId}`, { allow: true })).status, 200);
    await waitFor(() => task(second.id).status === 'completed');
    assert.equal(service.store.get().notes.filter(n => n.projectId === a.id).length, 1);
    const stopped = await launch(a.id, '[stop]'); await waitFor(() => task(stopped.id).output);
    assert.equal((await call('/api/tasks', { projectId: b.id, conversationId: stopped.conversationId, mode: 'free', text: 'wrong project' })).status, 400);
    const queued = await launch(a.id, '[stop] queued'); await waitFor(() => task(queued.id).status === 'queued');
    const parallel = await launch(b.id, '[stop] parallel'); await waitFor(() => task(parallel.id).output);
    assert.equal([...service.store.get().tasks].filter(t => t.status === 'running').length, 2);
    assert.equal((await call(`/api/tasks/${stopped.id}/stop`, {})).status, 200);
    await waitFor(() => task(queued.id).status === 'running');
    assert.equal(task(stopped.id).status, 'stopped');
    await call(`/api/tasks/${queued.id}/stop`, {}); await call(`/api/tasks/${parallel.id}/stop`, {});
    const pending = await launch(a.id, '停止待审批任务'); await waitFor(() => task(pending.id).permission);
    const pendingId = task(pending.id).permission.requestId; await call(`/api/tasks/${pending.id}/stop`, {});
    assert.equal((await call(`/api/tasks/${pending.id}/permissions/${pendingId}`, { allow: true })).status, 409);
    assert.equal(service.store.get().notes.filter(n => n.projectId === a.id).length, 1);
    const interrupted = await launch(a.id, '[stop] restart'); await waitFor(() => task(interrupted.id).output);
    await service.close(); await waitFor(() => children.size === 0);
    const restored = await openStore(directory);
    assert.equal(restored.get().tasks.find(t => t.id === interrupted.id).status, 'interrupted');
    assert.ok(restored.get().conversations.find(c => c.id === interrupted.conversationId).messages.some(m => m.role === 'assistant' && m.content.includes('正在等待本地模拟模型')));
    assert.equal(restored.get().notes.length, 2); assert.equal(restored.get().sources.length, 1);
    const crashTask = restored.get().tasks.find(t => t.id === interrupted.id); crashTask.status = 'running';
    await restored.update(s => { s.tasks.find(t => t.id === crashTask.id).status = 'running'; });
    const recovered = await openStore(directory); assert.equal(recovered.get().tasks.find(t => t.id === crashTask.id).status, 'interrupted');
    assert.ok(mock.requests.every(r => !JSON.stringify(r.messages).includes('只应属于项目 B')));
  } finally { for (const child of children.values()) child.kill(); await service.close(); await mock.close(); }
});

test('invalid tool JSON and unknown tools become bounded failures', async () => {
  const mock = await mockServer();
  try {
    for (const question of ['[invalid-json]', '[unknown-tool]']) {
      const events = [];
      await assert.rejects(runTurn({ settings: { endpoint: mock.endpoint, model: 'mock', maxRounds: 1 }, mode: 'review', messages: [{ role: 'user', content: question }], paperEndpoint: mock.paperEndpoint }, { event: (type, payload) => events.push({ type, ...payload }), request() { throw new Error('Invalid tools must never reach service'); }, signal: new AbortController().signal }), /轮次上限/);
      assert.ok(events.some(e => e.type === 'tool' && e.status === 'failed'));
    }
  } finally { await mock.close(); }
});

test('worker exit and permission timeout release pending writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-permission-'));
  const replies = [];
  const service = await createService({ directory, staticDir: path.join(root, 'renderer'), token: 'test-token', settings: { configured: true, maxRounds: 8 }, permissionMs: 100, onStart() {}, onToolResult: reply => replies.push(reply) });
  const call = async (route, data) => { const r = await fetch(`${service.origin}${route}`, { method: 'POST', headers: { Authorization: 'Bearer test-token', Origin: service.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: r.status, data: await r.json() }; };
  try {
    const project = (await call('/api/projects', { name: '审批生命周期' })).data;
    const launch = async () => { const task = (await call('/api/tasks', { projectId: project.id, text: '审批测试', mode: 'free' })).data; await waitFor(() => service.store.get().tasks.find(t => t.id === task.id)?.status === 'running'); return task; };
    const first = await launch();
    await Promise.all([
      service.workerMessage({ type: 'tool-request', taskId: first.id, requestId: 'request-crash', operation: 'save_research_note', payload: { title: '禁止保存', content: '执行器已退出' } }),
      service.workerMessage({ type: 'turn-exit', taskId: first.id })
    ]);
    assert.equal(service.store.get().tasks.find(t => t.id === first.id).status, 'failed');
    assert.equal((await call(`/api/tasks/${first.id}/permissions/request-crash`, { allow: true })).status, 409);
    const second = await launch();
    await service.workerMessage({ type: 'tool-request', taskId: second.id, requestId: 'request-timeout', operation: 'save_research_note', payload: { title: '过期请求', content: '不应保存' } });
    await waitFor(() => replies.find(r => r.requestId === 'request-timeout'));
    assert.equal(replies.find(r => r.requestId === 'request-timeout').result.allowed, false);
    assert.equal(service.store.get().tasks.find(t => t.id === second.id).permission, null);
    assert.equal(service.store.get().notes.length, 0);
    await service.workerMessage({ type: 'turn-finished', taskId: second.id, status: 'completed' });
  } finally { await service.close(); }
});

test('mock replay drives offline research flow without any network', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-replay-'));
  const children = new Map();
  const token = 'replay-test-token';
  const settings = { ...modelSettings({ endpoint: 'mock://replay', model: '本地回放', maxRounds: 8 }), configured: true };
  const service = await createService({ directory, staticDir: path.join(root, 'renderer'), token, settings,
    onStart(task, input) { const child = fork(path.join(root, 'agent/turn.mjs'), [], { stdio: ['ignore','pipe','pipe','ipc'] }); children.set(task.id, child); child.on('message', message => { void service.workerMessage(message); }); child.on('exit', () => { children.delete(task.id); void service.workerMessage({ type: 'turn-exit', taskId: task.id }); }); child.send({ type: 'start-turn', task, input }); },
    onStop(taskId) { const c = children.get(taskId); if (c?.connected) try { c.send({ type: 'cancel-turn' }); } catch {} },
    onToolResult(message) { const c = children.get(message.taskId); if (c?.connected) try { c.send(message); } catch {} }
  });
  const call = async (route, data) => { const response = await fetch(`${service.origin}${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: service.origin, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  const task = id => service.store.get().tasks.find(t => t.id === id);
  try {
    const project = (await call('/api/projects', { name: '回放验证', direction: '' })).data;
    const launched = (await call('/api/tasks', { projectId: project.id, text: '综述本地回放证据并保存为研究笔记', mode: 'review' })).data;
    const waiting = await waitFor(() => task(launched.id).status === 'waiting_permission' && task(launched.id));
    assert.ok(waiting.parts.some(p => p.type === 'reasoning' && p.text.includes('界定问题')));
    assert.deepEqual(waiting.parts.filter(p => p.type === 'tool').map(p => p.name), ['search_papers', 'save_research_note']);
    assert.equal(waiting.sources[0].citation, 'S1');
    assert.equal((await call(`/api/tasks/${launched.id}/permissions/${waiting.permission.requestId}`, { allow: true })).status, 200);
    await waitFor(() => task(launched.id).status === 'completed');
    assert.equal(service.store.get().notes.length, 1);
    assert.match(task(launched.id).output, /本地回放/);
    assert.match(task(launched.id).output, /笔记已获准保存/);
    const failed = (await call('/api/tasks', { projectId: project.id, text: '[错误] 触发故障分支', mode: 'free' })).data;
    await waitFor(() => task(failed.id).status === 'failed');
    assert.match(task(failed.id).error, /模拟模型接口故障/);
  } finally { for (const child of children.values()) child.kill(); await service.close(); }
});

test('renderer protocol blocks traversal and falls back to the SPA entry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-protocol-'));
  const staticDir = path.join(directory, 'dist');
  await fs.mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(staticDir, 'index.html'), '<html>spa</html>');
  await fs.writeFile(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  const handler = rendererProtocol(staticDir);
  const get = async url => {
    const response = await handler(new Request(url));
    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
  };
  assert.equal((await get('app://bundle/')).body, '<html>spa</html>');
  assert.equal((await get('app://bundle/chat/some-conversation')).body, '<html>spa</html>');
  assert.match((await get('app://bundle/assets/app.js')).type, /javascript/);
  assert.equal((await get('app://bundle/%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await get('app://other/')).status, 404);
});

test('local service no longer serves the renderer over HTTP', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-no-static-'));
  const service = await createService({ directory: path.join(directory, 'data'), token: 'no-static-token', settings: {}, onStart() {} });
  try {
    const response = await fetch(`${service.origin}/index.html`, { headers: { Authorization: 'Bearer no-static-token' } });
    assert.equal(response.status, 404);
  } finally { await service.close(); }
});

test('ask_user_question suspends and resumes with answers', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-question-'));
  const children = new Map();
  const token = 'question-test-token';
  const settings = { ...modelSettings({ endpoint: 'mock://replay', model: '本地回放', maxRounds: 8 }), configured: true };
  const service = await createService({ directory, staticDir: path.join(root, 'renderer'), token, settings,
    onStart(task, input) { const child = fork(path.join(root, 'agent/turn.mjs'), [], { stdio: ['ignore','pipe','pipe','ipc'] }); children.set(task.id, child); child.on('message', message => { void service.workerMessage(message); }); child.on('exit', () => { children.delete(task.id); void service.workerMessage({ type: 'turn-exit', taskId: task.id }); }); child.send({ type: 'start-turn', task, input }); },
    onStop(taskId) { const c = children.get(taskId); if (c?.connected) try { c.send({ type: 'cancel-turn' }); } catch {} },
    onToolResult(message) { const c = children.get(message.taskId); if (c?.connected) try { c.send(message); } catch {} }
  });
  const call = async (route, data) => { const response = await fetch(`${service.origin}${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: service.origin, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  const task = id => service.store.get().tasks.find(t => t.id === id);
  try {
    const project = (await call('/api/projects', { name: '提问验证', direction: '' })).data;
    const launched = (await call('/api/tasks', { projectId: project.id, text: '请先提问再研究', mode: 'free' })).data;
    const waiting = await waitFor(() => task(launched.id).status === 'waiting_permission' && task(launched.id));
    assert.equal(waiting.permission.kind, 'question');
    assert.equal(waiting.permission.options.length, 3);
    assert.equal((await call(`/api/tasks/${launched.id}/permissions/${waiting.permission.requestId}`, { allow: true, answers: '实证证据' })).status, 200);
    await waitFor(() => task(launched.id).status === 'completed');
    assert.match(task(launched.id).output, /实证证据/);
    const declined = (await call('/api/tasks', { projectId: project.id, text: '提问后拒绝回答', mode: 'free' })).data;
    const second = await waitFor(() => task(declined.id).permission?.kind === 'question' && task(declined.id));
    assert.equal((await call(`/api/tasks/${declined.id}/permissions/${second.permission.requestId}`, { allow: false })).status, 200);
    await waitFor(() => task(declined.id).status === 'completed');
    assert.match(task(declined.id).output, /补充更多背景/);
  } finally { for (const child of children.values()) child.kill(); await service.close(); }
});

test('clientMessageId dedupes retries and rebinds resend to the same message', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-idem-'));
  const token = 'idem-test-token';
  const service = await createService({ directory, staticDir: path.join(root, 'renderer'), token, settings: { configured: true, maxRounds: 8 }, onStart() {} });
  const call = async (route, data) => { const response = await fetch(`${service.origin}${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: service.origin, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  try {
    const project = (await call('/api/projects', { name: '幂等验证', direction: '' })).data;
    const first = await call('/api/tasks', { projectId: project.id, text: '同一个问题', mode: 'review', clientMessageId: 'msg-001' });
    assert.equal(first.status, 202);
    const conversationId = first.data.conversationId;
    const duplicate = await call('/api/tasks', { projectId: project.id, conversationId, text: '同一个问题', mode: 'review', clientMessageId: 'msg-001' });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.id, first.data.id);
    assert.equal(service.store.get().tasks.length, 1);
    assert.equal(service.store.get().conversations[0].messages.filter(m => m.role === 'user').length, 1);
    await call(`/api/tasks/${first.data.id}/stop`, {});
    const resent = await call('/api/tasks', { projectId: project.id, conversationId, text: '同一个问题', mode: 'review', clientMessageId: 'msg-001' });
    assert.equal(resent.status, 202);
    assert.notEqual(resent.data.id, first.data.id);
    const messages = service.store.get().conversations[0].messages.filter(m => m.role === 'user');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].taskId, resent.data.id);
  } finally { await service.close(); }
});

test('workspace tools enforce boundaries and note mirroring stays inside workdir', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-workspace-'));
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-workdir-'));
  await fs.writeFile(path.join(workdir, 'background.md'), '# 研究背景\n\n用户提供的本地资料。');
  await fs.writeFile(path.join(workdir, '.env'), 'SECRET=x');
  await fs.writeFile(path.join(workdir, 'binary.exe'), 'MZ');
  const token = 'workspace-test-token';
  const replies = [];
  const service = await createService({ directory, staticDir: path.join(root, 'renderer'), token, settings: { configured: true, maxRounds: 8 }, permissionMs: 600000, onStart() {}, onToolResult: reply => replies.push(reply) });
  const call = async (route, data) => { const response = await fetch(`${service.origin}${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: service.origin, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: response.status, data: await response.json() }; };
  const reply = id => replies.find(r => r.requestId === id);
  try {
    assert.equal((await call('/api/projects', { name: '坏目录', workdir: path.join(workdir, 'not-exist') })).status, 400);
    const project = (await call('/api/projects', { name: '工作区验证', workdir })).data;
    const launched = (await call('/api/tasks', { projectId: project.id, text: '读取本地资料', mode: 'free' })).data;
    await waitFor(() => service.store.get().tasks.find(t => t.id === launched.id)?.status === 'running');
    for (const [requestId, operation, payload] of [
      ['req-list', 'list_workspace_files', {}],
      ['req-escape', 'read_workspace_file', { path: '../../outside.md' }],
      ['req-secret', 'read_workspace_file', { path: '.env' }],
      ['req-ext', 'read_workspace_file', { path: 'binary.exe' }],
      ['req-ok', 'read_workspace_file', { path: 'background.md' }]
    ]) {
      await service.workerMessage({ type: 'tool-request', taskId: launched.id, requestId, operation, payload });
    }
    assert.deepEqual(reply('req-list').result.files.map(f => f.path), ['background.md']);
    assert.match(reply('req-escape').error, /超出项目工作目录/);
    assert.match(reply('req-secret').error, /凭据/);
    assert.match(reply('req-ext').error, /仅支持/);
    assert.match(reply('req-ok').result.content, /用户提供的本地资料/);
    // 笔记镜像：发起保存并批准
    await service.workerMessage({ type: 'tool-request', taskId: launched.id, requestId: 'req-save', operation: 'save_research_note', payload: { title: '镜像验证笔记', content: '# 镜像内容' } });
    const permission = await waitFor(() => service.store.get().tasks.find(t => t.id === launched.id)?.permission);
    const answered = (await call(`/api/tasks/${launched.id}/permissions/${permission.requestId}`, { allow: true })).data;
    assert.equal(answered.allowed, true);
    assert.ok(answered.mirrored?.includes('research-notes'));
    const mirrored = await fs.readFile(path.join(workdir, 'research-notes', path.basename(answered.mirrored)), 'utf8');
    assert.equal(mirrored, '# 镜像内容');
  } finally { await service.close(); }
});

test('corrupt snapshots are preserved instead of silently replaced', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-corrupt-')); await fs.writeFile(path.join(directory, 'state.json'), '{bad');
  await assert.rejects(openStore(directory), /原文件已保留/); assert.equal(await fs.readFile(path.join(directory, 'state.json'), 'utf8'), '{bad');
});
