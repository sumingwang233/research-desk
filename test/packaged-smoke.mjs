import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const artifact = `Research-Desk-${version}-x64.exe`;
assert.ok((await fs.stat(path.join(root, 'release', artifact)).catch(() => null))?.isFile(), `release 目录中没有 ${artifact}，请先运行 npm run dist`);
const executable = path.join(root, 'release', artifact);
const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-packaged-'));
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
let socket, child, origin;
async function waitFor(fn, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await fn(); if (value) return value; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Packaged smoke condition timed out'); }
try {
  child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${dataDirectory}`], { stdio: 'ignore', windowsHide: true });
  let exited = false; child.on('exit', () => { exited = true; });
  /* 渲染层已改成 app:// 自定义协议装载，CDP 里看到的是 app://bundle；
     本地服务地址需要从 preload 拿，不能再从页面 URL 推。 */
  const page = await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) }); return (await r.json()).find(p => p.type === 'page' && (p.url.startsWith('app://bundle') || p.url.startsWith('http://127.0.0.1:'))); }, 45000);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0; const requests = new Map();
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); const request = requests.get(message.id); if (request) { requests.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  await waitFor(() => evaluate('document.body.dataset.ready === "true"'));
  const session = await evaluate('window.desk.session()');
  origin = session.origin;
  assert.ok(origin.startsWith('http://127.0.0.1:'), '本地服务应监听 loopback');
  assert.equal(await evaluate('location.protocol'), 'app:');
  assert.equal(await evaluate('typeof require'), 'undefined');
  assert.equal(await evaluate('document.querySelector("#project-name").textContent'), '我的研究空间');
  const unauthorized = await fetch(`${origin}/api/bootstrap`); assert.equal(unauthorized.status, 401);
  await evaluate('document.querySelector("#new-project").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector("#project-input"))'));
  await evaluate('document.querySelector("#project-input").value="便携版验收项目"; document.querySelector("#project-form").requestSubmit()');
  await waitFor(() => evaluate('document.querySelector("#project-name").textContent === "便携版验收项目"'));
  await fs.mkdir(path.join(root, 'acceptance'), { recursive: true });
  const capture = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(root, 'acceptance/packaged-desktop.png'), Buffer.from(capture.data, 'base64'));
  const stateFile = path.join(dataDirectory, 'research-data/workspace/state.json');
  assert.ok(JSON.parse(await fs.readFile(stateFile, 'utf8')).projects.some(project => project.name === '便携版验收项目'));
  await evaluate('setTimeout(() => window.close(), 20); true');
  await waitFor(() => exited);
  socket.close(); socket = null;
  await waitFor(async () => { try { await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(300) }); return false; } catch { return true; } });
  const result = { passed: true, artifact: executable, bytes: (await fs.stat(executable)).size, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex'), dataDirectory, checks: ['portable executable launch', 'app:// renderer protocol', 'isolated user-data directory', 'sandbox renderer', 'protected local service', 'project persistence', 'window close exits portable process', 'local service port closed'] };
  await fs.writeFile(path.join(root, 'acceptance/packaged-smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { socket?.close(); child?.kill(); }
