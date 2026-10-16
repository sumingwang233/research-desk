const { app, BrowserWindow, ipcMain, utilityProcess, safeStorage, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

async function startDesktop(options = {}) {
  await app.whenReady();
  const root = path.resolve(__dirname, '..');
  const { modelSettings, importName, publicError, httpsUrl } = await import(pathToFileURL(path.join(root, 'service/validation.mjs')).href);
  const dataDir = options.dataDir || path.join(app.getPath('userData'), 'research-data');
  await fs.mkdir(dataDir, { recursive: true });
  const settingsFile = path.join(dataDir, 'model-settings.json');
  let settings = { provider: 'openai-compatible', endpoint: '', model: '', maxRounds: 8, effort: '', configured: false };
  let apiKey = '', origin = '', quitting = false;
  if (options.settings) { settings = modelSettings(options.settings); settings.configured = true; apiKey = options.settings.apiKey || ''; }
  else {
    try {
      const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
      settings = modelSettings(saved);
      if (saved.encryptedKey && safeStorage.isEncryptionAvailable()) apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64'));
      settings.configured = Boolean(settings.endpoint && settings.model);
    } catch (error) { if (error.code !== 'ENOENT') settings.warning = '模型配置无法恢复，请重新配置；原文件已保留'; }
  }
  const publicSettings = () => ({ ...settings, apiKeyConfigured: Boolean(apiKey), encryptedStorage: safeStorage.isEncryptionAvailable() });
  const token = randomBytes(32).toString('hex');
  const workers = new Map();
  const window = new BrowserWindow({ width: 1440, height: 930, minWidth: 960, minHeight: 680, title: '研序 Research Desk', backgroundColor: '#F5F7FA', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!origin || new URL(url).origin !== origin) event.preventDefault(); });
  const service = utilityProcess.fork(path.join(root, 'service/server.mjs'), [], { serviceName: 'Research Desk Local Service', stdio: 'pipe' });
  const fail = error => { if (!quitting) { dialog.showErrorBox('研序启动失败', publicError(error)); app.quit(); } };
  service.on('exit', () => { if (!quitting) fail(new Error('本地服务已退出。请重新启动研序；已保存资料仍在本机。')); });
  const stopWorker = taskId => {
    const child = workers.get(taskId);
    if (!child) return;
    try { child.postMessage({ type: 'cancel-turn' }); } catch {}
    setTimeout(() => { if (workers.get(taskId) === child) child.kill(); }, 500).unref();
  };
  service.on('message', message => {
    if (quitting && message.type !== 'shutdown-complete') return;
    if (message.type === 'start-turn') {
      const taskId = message.task.id;
      if (workers.has(taskId)) return;
      const child = utilityProcess.fork(path.join(root, 'agent/turn.mjs'), [], { serviceName: 'Research Desk Research Turn', stdio: 'pipe' });
      workers.set(taskId, child);
      child.on('spawn', () => child.postMessage({ type: 'start-turn', task: message.task, input: { ...message.input, settings: { ...settings, apiKey } } }));
      child.on('message', event => {
        if (workers.get(taskId) !== child || event.taskId !== taskId) return;
        if (['turn-event','tool-request','turn-finished'].includes(event.type)) service.postMessage(event);
      });
      child.on('exit', () => { if (workers.get(taskId) === child) workers.delete(taskId); if (!quitting) service.postMessage({ type: 'turn-exit', taskId }); });
    } else if (message.type === 'cancel-turn') stopWorker(message.taskId);
    else if (message.type === 'tool-result') { try { workers.get(message.taskId)?.postMessage(message); } catch {} }
    else if (message.type === 'service-error') fail(new Error(message.error));
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('本地服务启动超时')), 15000);
    service.on('message', message => {
      if (message.type === 'service-ready') { clearTimeout(timeout); origin = message.origin; resolve(); }
      if (message.type === 'service-error') { clearTimeout(timeout); reject(new Error(message.error)); }
    });
    service.once('exit', () => { clearTimeout(timeout); reject(new Error('本地服务无法启动')); });
  });
  service.once('spawn', () => service.postMessage({ type: 'initialize', options: { directory: path.join(dataDir, 'workspace'), staticDir: path.join(root, 'renderer/dist'), token, settings: publicSettings(), ...(options.paperEndpoint ? { paperEndpoint: options.paperEndpoint } : {}) } }));
  const guard = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.origin !== origin) throw new Error('不允许来自此页面的桌面请求');
  };
  const local = async (route, body) => {
    const response = await fetch(`${origin}${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  };
  const handlers = {
    session: async () => ({ token, origin }),
    settings: async () => publicSettings(),
    saveSettings: async input => {
      const next = modelSettings(input);
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new Error('无效的 API key');
      const nextKey = input.clearKey ? '' : input.apiKey.trim() || apiKey;
      const encryptedStorage = safeStorage.isEncryptionAvailable();
      const saved = { ...next, encryptedKey: nextKey && encryptedStorage ? safeStorage.encryptString(nextKey).toString('base64') : '' };
      await fs.writeFile(`${settingsFile}.tmp`, JSON.stringify(saved), { mode: 0o600 }); await fs.rename(`${settingsFile}.tmp`, settingsFile);
      apiKey = nextKey; settings = { ...next, configured: true };
      service.postMessage({ type: 'settings', settings: publicSettings() });
      return publicSettings();
    },
    importNote: async projectId => {
      if (typeof projectId !== 'string' || !/^[\w-]{1,80}$/.test(projectId)) throw new Error('无效项目');
      const result = await dialog.showOpenDialog(window, { title: '导入研究笔记', properties: ['openFile'], filters: [{ name: 'Markdown / 文本笔记', extensions: ['md','txt'] }] });
      if (result.canceled) return null;
      const file = result.filePaths[0]; importName(path.basename(file));
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('笔记须小于 2 MiB');
      const content = await fs.readFile(file, 'utf8');
      return local(`/api/projects/${projectId}/import`, { title: path.basename(file, path.extname(file)), content });
    },
    exportNote: async noteId => {
      if (typeof noteId !== 'string' || !/^[\w-]{1,80}$/.test(noteId)) throw new Error('无效笔记');
      const note = await local(`/api/notes/${noteId}`);
      const result = await dialog.showSaveDialog(window, { title: '导出研究笔记', defaultPath: `${note.title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 100)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, note.content, 'utf8'); return true;
    },
    openSource: async url => { if (typeof url !== 'string' || !httpsUrl(url)) throw new Error('来源须为有效 HTTPS 地址'); await shell.openExternal(url); return true; },
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog(window, { title: '选择研究项目的本地文件夹', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`desk:${name}`, async (event, ...args) => { guard(event); try { return await handler(...args); } catch (error) { throw new Error(publicError(error)); } });
  let closePromise;
  const shutdown = () => closePromise ||= new Promise(resolve => {
    quitting = true;
    for (const taskId of workers.keys()) stopWorker(taskId);
    service.postMessage({ type: 'shutdown' });
    const done = () => { for (const child of workers.values()) child.kill(); service.kill(); resolve(); };
    const timeout = setTimeout(done, 3000);
    service.once('exit', () => { clearTimeout(timeout); done(); });
  });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void shutdown().then(() => app.quit()); } });
  window.on('closed', () => { if (!quitting) app.quit(); });
  try { await ready; await window.loadURL(origin); }
  catch (error) { await shutdown(); window.destroy(); throw error; }
  window.show();
  return { window, service, workers, origin, token, dataDir, shutdown };
}
module.exports = { startDesktop };
if (require.main === module) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else startDesktop().then(({ window }) => app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); })).catch(error => { dialog.showErrorBox('研序启动失败', String(error.message)); app.quit(); });
}
