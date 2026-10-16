const http = require('node:http');
async function mockServer() {
  const requests = [];
  const connections = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/works')) {
      res.setHeader('Content-Type', 'application/json');
      const item = { DOI: '10.1234/research.2026', title: ['A study of human–AI trust'], author: [{ given: 'Example', family: 'Researcher' }], published: { 'date-parts': [[2026]] }, abstract: '<jats:p>Evidence from a controlled study.</jats:p>', 'container-title': ['Local Mock Research'] };
      res.end(JSON.stringify({ message: { items: [item, item] } })); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw); requests.push(data);
    const question = data.messages.findLast(m => m.role === 'user')?.content || '';
    if (question.includes('[failure]')) { res.writeHead(401); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const packet = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
    if (question.includes('[stop]')) { res.write(packet({ content: '正在等待本地模拟模型…' })); return; }
    if (question.includes('[broken]')) { res.end(packet({ content: '断开前的内容' })); return; }
    if (question.includes('[empty]')) { res.end(packet({}, 'stop') + 'data: [DONE]\n\n'); return; }
    const results = data.messages.filter(m => m.role === 'tool');
    let output = packet({ reasoning_content: '先梳理问题边界与可用证据。' });
    if (results.length < 2) {
      const name = !results.length && question.includes('[unknown-tool]') ? 'run_shell' : results.length ? 'save_research_note' : 'search_papers';
      const args = !results.length && question.includes('[invalid-json]') ? '{invalid' : JSON.stringify(results.length ? { title: '信任校准研究笔记', content: '# 研究线索\n\n这是本地模拟测试笔记，来源为 [S1]。' } : { query: 'human AI trust', limit: 3 });
      const midpoint = Math.floor(args.length / 2);
      output += packet({ tool_calls: [{ index: 0, id: `call-${results.length}`, type: 'function', function: { name, arguments: args.slice(0, midpoint) } }] }) + packet({ tool_calls: [{ index: 0, function: { arguments: args.slice(midpoint) } }] }, 'tool_calls');
    } else {
      const saved = JSON.parse(results.at(-1).content).allowed;
      output += packet({ content: '基于公开元数据 [S1]，可从信任校准入手。' }) + packet({ content: ' ' }) + packet({ content: saved ? '笔记已获准保存。' : '保存被拒绝，未写入笔记。' }) + packet({ content: '\n<img src=x onerror=alert(1)>\n以上为本地模拟验证输出，尚未阅读全文。' }, 'stop');
    }
    output += 'data: [DONE]\n\n';
    const bytes = Buffer.from(output);
    for (let index = 0; index < bytes.length; index += 37) { if (res.destroyed) return; res.write(bytes.subarray(index, index + 37)); await new Promise(resolve => setImmediate(resolve)); }
    res.end();
  });
  server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, endpoint: `${origin}/v1/chat/completions`, paperEndpoint: `${origin}/works`, requests, close: async () => { for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { mockServer };
