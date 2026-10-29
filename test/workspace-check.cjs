/**
 * 工作区验收：真实绑定一个目录，走一遍「打开 → 编辑 → 保存 → 读 PDF」。
 *
 * 断言落盘结果而不是只看界面：保存后要能从磁盘读回新内容，
 * 并且原文件确实被备份成 .bak。
 */
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startDesktop } = require('../electron/main.cjs');
const { mockServer } = require('./mock-server.cjs');

/** 生成一份最小但结构完整的 PDF，避免依赖外部样本文件。 */
function makePdf(text) {
  const escape = value => value.replace(/([()\\])/g, '\\$1');
  const content = `BT /F1 24 Tf 40 120 Td (${escape(text)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

async function waitFor(fn, timeout = 25000, label = '条件') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const value = await fn(); if (value) return value; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`${label} 超时`);
}

const errors = [];

(async () => {
  await app.whenReady();
  const output = path.resolve(__dirname, '../acceptance');
  await fs.mkdir(output, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-workspace-'));
  const studyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-study-'));

  await fs.mkdir(path.join(studyDir, 'notes'), { recursive: true });
  const markdown = ['# 研究计划', '', '## 目标', '', '- 校准信任与依赖的关系', '- 复核效应量', '', '公式 $\\hat{R}_t$ 用于主观估计。'].join('\n');
  await fs.writeFile(path.join(studyDir, 'notes', 'plan.md'), markdown, 'utf8');
  await fs.writeFile(path.join(studyDir, 'analysis.py'), 'def calibration_gap(reliability, estimate):\n    return [e - r for r, e in zip(reliability, estimate)]\n', 'utf8');
  await fs.writeFile(path.join(studyDir, 'paper.pdf'), makePdf('Trust calibration in human-AI collaboration'));

  const mock = await mockServer();
  const desktop = await startDesktop({
    dataDir,
    settings: { endpoint: mock.endpoint, model: '本地模拟模型', maxRounds: 4, apiKey: 'workspace-check-key' },
    paperEndpoint: mock.paperEndpoint
  });
  desktop.window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const evaluate = code => desktop.window.webContents.executeJavaScript(code, true);
  const shot = async name => fs.writeFile(path.join(output, name), (await desktop.window.webContents.capturePage()).toPNG());
  const local = async (route, body) => {
    const response = await fetch(`${desktop.origin}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${desktop.token}`, Origin: desktop.origin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败');
    return data;
  };

  await waitFor(() => evaluate('document.body.dataset.ready === "true"'), 25000, '页面就绪');
  const project = await local('/api/projects', { name: '工作区验收', direction: '编辑与阅读', workdir: studyDir });
  await local('/api/bootstrap');

  /* 项目是通过 API 建的，渲染层需要重新拉一次快照并选中它 */
  await evaluate('location.reload()');
  await new Promise(resolve => setTimeout(resolve, 400));
  await waitFor(() => evaluate('document.body.dataset.ready === "true"'), 25000, '重新就绪');
  await evaluate('document.querySelector(".project-item")?.click()');
  await new Promise(resolve => setTimeout(resolve, 150));

  await evaluate('document.querySelector("[data-view=workspace]").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".tree-pane"))'), 20000, '工作区视图');
  await waitFor(() => evaluate('document.querySelectorAll(".tree-row.file").length >= 3'), 20000, '目录树');

  /* 打开 Markdown：编辑器要起来，且内容就是磁盘上的那份 */
  await evaluate('[...document.querySelectorAll(".tree-row.file")].find(el => el.textContent.includes("plan.md")).click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".monaco-host .monaco-editor"))'), 30000, 'Monaco 挂载');
  await waitFor(() => evaluate('document.querySelector(".editor-path")?.textContent.includes("plan.md")'), 10000, '标题');
  const loaded = await evaluate(`(() => ({
    editor: Boolean(document.querySelector('.monaco-host .monaco-editor')),
    lineCount: document.querySelectorAll('.monaco-host .view-line').length,
    text: document.querySelector('.monaco-host .view-lines')?.textContent || ''
  }))()`);
  assert.equal(loaded.editor, true);
  assert.ok(loaded.lineCount >= 5, 'Markdown 应显示多行');
  assert.ok(loaded.text.includes('研究计划'), '编辑器应已加载文件内容');
  await shot('workspace-editor.png');

  /* 真鼠标键盘：点进编辑区再敲字，走 EditContext 的真实路径 */
  const point = await evaluate(`(() => {
    const rect = document.querySelector('.monaco-host .monaco-editor').getBoundingClientRect();
    return { x: Math.round(rect.x + 80), y: Math.round(rect.y + 24) };
  })()`);
  desktop.window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  desktop.window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 250));
  for (const character of 'XYZ') {
    desktop.window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  await waitFor(() => evaluate('Boolean(document.querySelector(".editor-dirty"))'), 10000, '脏标记');
  await evaluate('document.querySelector(".editor-actions .primary").click()');
  await waitFor(async () => {
    const onDisk = await fs.readFile(path.join(studyDir, 'notes', 'plan.md'), 'utf8');
    return onDisk.includes('XYZ');
  }, 15000, '落盘');
  const backup = await fs.readFile(path.join(studyDir, 'notes', 'plan.md.bak'), 'utf8');
  assert.equal(backup.startsWith('# 研究计划'), true, '原文件应备份为 .bak');

  /* 语法着色与语言识别 */
  const tokens = await evaluate('document.querySelectorAll(".monaco-host .mtk1, .monaco-host span[class^=mtk]").length');
  assert.ok(tokens > 0, '编辑器应有着色 token');

  /* 打开 PDF：canvas 真的画出来，尺寸非零 */
  await evaluate('[...document.querySelectorAll(".tree-row.file")].find(el => el.textContent.includes("paper.pdf")).click()');
  await waitFor(() => evaluate('document.querySelectorAll(".pdf-scroll canvas").length >= 1'), 30000, 'PDF 画布');
  const pdf = await evaluate(`(() => {
    const canvas = document.querySelector('.pdf-scroll canvas');
    return { width: canvas.width, height: canvas.height, pages: document.querySelector('.pdf-pages')?.textContent || '' };
  })()`);
  assert.ok(pdf.width > 300, 'PDF 画布应有实际宽度');
  assert.equal(pdf.pages.includes('1'), true);
  await new Promise(resolve => setTimeout(resolve, 200));
  await shot('workspace-pdf.png');

  const csp = errors.filter(message => /Content Security Policy|Refused to/i.test(message));
  console.log(JSON.stringify({
    ok: true,
    loaded,
    pdf,
    cspErrors: csp,
    consoleErrorCount: errors.length,
    savedBytes: (await fs.stat(path.join(studyDir, 'notes', 'plan.md'))).size
  }, null, 1));

  await mock.close();
  app.exit(0);
})().catch(async error => {
  const report = { message: String(error && error.message || error) };
  try {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      report.dump = await w.webContents.executeJavaScript(`(() => ({
        treePane: Boolean(document.querySelector('.tree-pane')),
        workspaceView: Boolean(document.querySelector('.workspace-view')),
        bodyText: document.body.innerText.slice(0, 400),
        path: location.pathname
      }))()`, true).catch(cause => ({ probeError: cause.message }));
      report.errors = errors.slice(0, 8);
    }
  } catch (cause) { report.probeError = String(cause.message); }
  require('node:fs').writeFileSync(path.resolve(__dirname, '../_ws-diag.json'), JSON.stringify(report, null, 1));
  console.error(JSON.stringify(report, null, 1));
  app.exit(1);
});
