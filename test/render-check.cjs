/**
 * 产物渲染检查：给一段真实形态的研究报告，确认 markdown / 公式 / 代码 / 表格 / 引用
 * 在 app:// + CSP 下都能正确渲染，并把截图落到 acceptance/。
 *
 * 这是一个一次性的验收脚本，不参与 npm test。
 */
const { app } = require('electron');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { startDesktop } = require('../electron/main.cjs');

const ANSWER = [
  '## 结论',
  '',
  '现有证据支持「**信任校准**先于协作收益」这一判断 [S1]，但样本量偏小，效应量仍需复核。',
  '',
  '### 三条要点',
  '',
  '1. **校准度**：主观信任与系统可靠性的偏差，是解释协作表现差异的主要中介。',
  '2. **任务类型**：开放式任务的校准误差普遍更大。',
  '3. **时间尺度**：重复交互会收窄偏差，但存在 3–5 轮的滞后。',
  '',
  '| 研究 | 样本 | 校准指标 | 主要发现 |',
  '| --- | --- | --- | --- |',
  '| Researcher 2026 [S1] | n=120 | 偏差指数 | 校准误差预测协作收益下降 |',
  '| 早期重复实验 | n=48 | 主观评分 | 效应方向一致，量级偏小 |',
  '',
  '可写成一个简单的一阶校准模型：',
  '',
  '$$',
  '\\Delta_t = \\alpha\\,(R_t - \\hat{R}_t) + \\varepsilon_t, \\quad \\varepsilon_t \\sim \\mathcal{N}(0, \\sigma^2)',
  '$$',
  '',
  '其中 $R_t$ 为实际可靠性，$\\hat{R}_t$ 为主观估计，$\\alpha$ 是校准强度。',
  '',
  '> 跨任务外推前需要重新校准，不能直接沿用上一任务的系数。',
  '',
  '```python',
  'def calibration_gap(reliability, estimate):',
  '    """主客观可靠性之差；正值表示过度信任。"""',
  '    return [est - rel for rel, est in zip(reliability, estimate)]',
  '```',
  '',
  '结论仍是**有限支持**，尚不足以给出操作建议。'
].join('\n');

function answerServer(answer) {
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/works')) {
      res.setHeader('Content-Type', 'application/json');
      const item = {
        DOI: '10.1234/research.2026',
        title: ['A study of human–AI trust'],
        author: [{ given: 'Example', family: 'Researcher' }],
        published: { 'date-parts': [[2026]] },
        abstract: '<jats:p>Evidence from a controlled study.</jats:p>',
        'container-title': ['Local Mock Research']
      };
      res.end(JSON.stringify({ message: { items: [item] } }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const toolResults = (body.messages || []).filter(message => message.role === 'tool');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const packet = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
    let payload = packet({ reasoning_content: '先确认可用的证据，再组织结论。' });
    if (!toolResults.length) {
      // 第一轮先检索：这样 task.sources 才会有已核验的来源，[S1] 才是实引用
      const args = JSON.stringify({ query: 'human AI trust', limit: 3 });
      payload += packet({ tool_calls: [{ index: 0, id: 'call-0', type: 'function', function: { name: 'search_papers', arguments: args } }] }, 'tool_calls');
    } else {
      for (let i = 0; i < answer.length; i += 40) payload += packet({ content: answer.slice(i, i + 40) });
      payload += packet({}, 'stop');
    }
    payload += 'data: [DONE]\n\n';
    const bytes = Buffer.from(payload);
    for (let i = 0; i < bytes.length; i += 41) { if (res.destroyed) return; res.write(bytes.subarray(i, i + 41)); await new Promise(r => setImmediate(r)); }
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    resolve({ origin, endpoint: `${origin}/v1/chat/completions`, paperEndpoint: `${origin}/works`, close: () => new Promise(r => server.close(r)) });
  }));
}

async function waitFor(fn, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const value = await fn(); if (value) return value; } catch {}
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error('渲染检查超时');
}

(async () => {
  await app.whenReady();
  const output = path.resolve(__dirname, '../acceptance');
  await fs.mkdir(output, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-desk-render-'));
  const mock = await answerServer(ANSWER);
  const desktop = await startDesktop({
    dataDir,
    settings: { endpoint: mock.endpoint, model: '本地模拟模型', maxRounds: 4, apiKey: 'render-check-key' },
    paperEndpoint: mock.paperEndpoint
  });
  const consoleErrors = [];
  desktop.window.webContents.on('console-message', event => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });
  const evaluate = code => desktop.window.webContents.executeJavaScript(code, true);
  const shot = async name => fs.writeFile(path.join(output, name), (await desktop.window.webContents.capturePage()).toPNG());
  const dialogOpen = () => evaluate('Boolean(document.querySelector("#project-dialog")?.open)');
  const states = {};

  await waitFor(() => evaluate('document.body.dataset.ready === "true"'));
  await evaluate('document.querySelector("#new-project").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector("#project-input"))'));
  states.dialogOpened = await dialogOpen();
  await evaluate('document.querySelector("#project-input").value="产物渲染检查"; document.querySelector("#direction-input").value="确认报告类输出的可读性"; document.querySelector("#project-form").requestSubmit();');
  await waitFor(() => evaluate('Boolean(document.querySelector(".overview"))'));
  states.dialogAfterCreate = await dialogOpen();

  // 先存一条来源，让 [S1] 是已核验状态
  await evaluate('document.querySelector("[data-view=library]").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector("#search-query"))'));
  await evaluate('document.querySelector("#search-query").value="human AI trust"; document.querySelector("#search-form").requestSubmit();');
  await waitFor(() => evaluate('document.querySelectorAll(".paper-row").length === 1'));
  await evaluate('document.querySelector(".paper-actions .secondary").click()');
  await waitFor(async () => (await (await fetch(`${desktop.origin}/api/bootstrap`, { headers: { Authorization: `Bearer ${desktop.token}` } })).json()).sources.length === 1);
  states.dialogAfterLibrary = await dialogOpen();

  await evaluate('document.querySelector("[data-view=research]").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector("#question"))'));
  await evaluate('document.querySelector("#question").value="请综述信任校准的证据并给出模型。"; document.querySelector("#composer").requestSubmit();');
  await waitFor(() => evaluate('document.querySelector(".task-status")?.textContent === "已完成"'), 30000);
  await new Promise(r => setTimeout(r, 250));
  states.dialogAfterTask = await dialogOpen();
  states.dialogAtEnd = await dialogOpen();

  const probe = await evaluate(`(() => {
    const q = s => document.querySelector(s);
    return {
      headings: document.querySelectorAll('.md h2, .md h3').length,
      tables: document.querySelectorAll('.md table').length,
      tableCells: document.querySelectorAll('.md td').length,
      codeBlocks: document.querySelectorAll('.md-code').length,
      highlighted: document.querySelectorAll('.md-code .hljs-keyword, .md-code .hljs-string').length,
      displayMath: document.querySelectorAll('.md-math .katex-display').length,
      inlineMath: document.querySelectorAll('.md .katex:not(.katex-display .katex)').length,
      lists: document.querySelectorAll('.md ol li').length,
      quote: Boolean(q('.md blockquote')),
      citation: q('.md .citation')?.textContent || '',
      citationVerified: !q('.md .citation')?.classList.contains('unverified'),
      mathBox: (() => { const el = q('.md-math .katex'); return el ? Math.round(el.getBoundingClientRect().height) : 0; })(),
      injected: document.querySelectorAll('.md script, .md img').length
    };
  })()`);

  await evaluate('document.querySelector("#thread").scrollTop = 0');
  await new Promise(r => setTimeout(r, 260));
  await shot('desktop-report.png');
  await evaluate('document.querySelector(".md-code").scrollIntoView({ block: "center" })');
  await new Promise(r => setTimeout(r, 260));
  await shot('desktop-report-code.png');

  const cspErrors = consoleErrors.filter(message => /Content Security Policy/i.test(message));
  console.log(JSON.stringify({ probe, states, cspErrors, consoleErrorCount: consoleErrors.length }, null, 1));

  await mock.close();
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
