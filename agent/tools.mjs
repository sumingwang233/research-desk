import { text, httpsUrl, noteInput } from '../service/validation.mjs';
const schema = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const definitions = [
  schema('search_papers', '检索 Crossref 论文元数据；返回可核验来源。不代表已阅读全文。', { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, ['query']),
  schema('read_project_notes', '读取当前研究项目已导入或保存的笔记', {}),
  schema('list_workspace_files', '列出项目本地文件夹中的 Markdown/文本/CSV/JSON 资料（不含凭据类文件）', {}),
  schema('read_workspace_file', '读取项目本地文件夹中的一个文本资料文件', { path: { type: 'string' } }, ['path']),
  schema('list_project_sources', '读取当前项目已保存的文献元数据', {}),
  schema('save_research_note', '申请保存 Markdown 研究笔记，必须由用户批准后写入', { title: { type: 'string' }, content: { type: 'string' } }, ['title', 'content']),
  schema('ask_user_question', '研究方向不明确时向用户提出一个澄清问题；提供 2–6 个候选方向，等用户选择后再继续', {
    question: { type: 'string' },
    options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'], additionalProperties: false } }
  }, ['question', 'options'])
];
export function questionInput(input) {
  if (!input || typeof input !== 'object') throw new Error('无效的澄清问题');
  const question = text(input.question, '澄清问题', 1000);
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 6) throw new Error('候选方向须为 2–6 个');
  const options = input.options.map(o => {
    if (!o || typeof o !== 'object') throw new Error('无效的候选方向');
    return { label: text(o.label, '候选方向', 80), description: String(o.description || '').slice(0, 300) };
  });
  return { question, options };
}
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export async function searchPapers(query, limit = 8, signal, endpoint = 'https://api.crossref.org/works') {
  text(query, '检索词', 500);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('每次检索须为 1–10 篇');
  const url = new URL(endpoint); url.searchParams.set('query.bibliographic', query); url.searchParams.set('rows', String(limit));
  const response = await fetch(url, { headers: { 'User-Agent': 'ResearchDesk/0.1 (scholarly metadata research)' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error(`文献检索返回 HTTP ${response.status}${response.status === 429 ? '，请稍后重试' : ''}`);
  const raw = await response.text(); if (raw.length > 4000000) throw new Error('文献响应超出大小限制');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.message?.items)) throw new Error('文献服务返回了不兼容的数据');
  const seen = new Set();
  return data.message.items.slice(0, limit).map(item => {
    const doi = String(item.DOI || '').slice(0, 300);
    return { title: plain(item.title?.[0]).slice(0, 1000) || '未提供题名', authors: (item.author || []).slice(0, 12).map(a => plain([a.given, a.family].filter(Boolean).join(' ') || a.name)).join(', ').slice(0, 1000), year: item['published-print']?.['date-parts']?.[0]?.[0] || item.published?.['date-parts']?.[0]?.[0] || '', doi, url: /^10\.\d{4,9}\//.test(doi) ? `https://doi.org/${encodeURI(doi)}` : httpsUrl(item.URL) || '', abstract: plain(item.abstract).slice(0, 16000), journal: plain(item['container-title']?.[0]).slice(0, 500), query, retrievedAt: new Date().toISOString() };
  }).filter(paper => { const key = paper.doi || paper.title; if (seen.has(key)) return false; seen.add(key); return true; });
}
export async function executeTool(name, args, { request, signal, paperEndpoint }) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须为对象');
  const definition = definitions.find(d => d.function.name === name);
  if (!definition || Object.keys(args).some(k => !(k in definition.function.parameters.properties))) throw new Error('未知工具或参数');
  if (name === 'search_papers') {
    const sources = await searchPapers(text(args.query, '检索词', 500), args.limit ?? 8, signal, paperEndpoint);
    return request('register_sources', { sources });
  }
  if (name === 'save_research_note') return request(name, noteInput(args));
  if (name === 'ask_user_question') return request(name, questionInput(args));
  if (name === 'read_workspace_file') return request(name, { path: text(args.path, '文件路径', 300) });
  return request(name, {});
}
