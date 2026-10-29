/**
 * 研究产物的渲染管线
 *
 * 助手输出的是「报告」，不是聊天句子：标题、列表、表格、公式、代码都是常态。
 * 之前正文按纯文本显示，`## 结论` 和 `| 指标 | 值 |` 会原样变成符号，
 * 读者只能自己去脑补结构。这里补上这一层。
 *
 * 约束（与 Electron 侧的安全边界一致）：
 * - html:false，不让模型输出注入标记
 * - 图片不外链，避免 app:// 页面去拉远端资源
 * - 链接不外跳，点击改为复制地址（主进程的 will-navigate 只放行 app://）
 */
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import 'katex/dist/katex.min.css';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('r', r);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

/* ── 行内公式 $...$ ──
   放在 backticks 之后：代码段先被吃掉，`$PATH` 里的美元符不会被误判。
   两侧紧贴空白就放弃，避免「价格 $5 到 $10」被当成公式。 */
md.inline.ruler.after('backticks', 'math_inline', (state, silent) => {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24) return false;
  if (src.charCodeAt(start + 1) === 0x24) return false;
  let end = start + 1;
  for (;;) {
    end = src.indexOf('$', end);
    if (end < 0) return false;
    if (src.charCodeAt(end - 1) !== 0x5c) break;
    end += 1;
  }
  const content = src.slice(start + 1, end);
  if (!content || /^\s/.test(content) || /\s$/.test(content)) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    token.markup = '$';
  }
  state.pos = end + 1;
  return true;
});

md.renderer.rules.math_inline = (tokens, idx) =>
  katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: false });

/* ── 独立公式 $$...$$（单行与多行都收） ── */
md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
  const lineStart = state.bMarks[startLine] + state.tShift[startLine];
  const lineEnd = state.eMarks[startLine];
  const first = state.src.slice(lineStart, lineEnd).trim();
  if (!first.startsWith('$$')) return false;

  if (first.length > 4 && first.endsWith('$$')) {
    if (silent) return true;
    const token = state.push('math_block', 'math', 0);
    token.content = first.slice(2, -2).trim();
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  let body = first.slice(2);
  let next = startLine + 1;
  let closed = false;
  for (; next < endLine; next += 1) {
    const s = state.bMarks[next] + state.tShift[next];
    const e = state.eMarks[next];
    const text = state.src.slice(s, e);
    const hit = text.indexOf('$$');
    if (hit >= 0) {
      body += `\n${text.slice(0, hit)}`;
      closed = true;
      next += 1;
      break;
    }
    body += `\n${text}`;
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.content = body.trim();
  token.map = [startLine, next];
  state.line = next;
  return true;
});

md.renderer.rules.math_block = (tokens, idx) =>
  `<div class="md-math">${katex.renderToString(tokens[idx].content, { throwOnError: false, displayMode: true })}</div>`;

/* ── 引用锚点 [S1] ──
   解析成按钮而不是纯文本：点一下就能把右侧证据抽屉里对应的那条调出来。 */
md.inline.ruler.before('link', 'citation', (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x5b) return false;
  const hit = /^\[S(\d+)\]/.exec(src.slice(pos));
  if (!hit) return false;
  if (!silent) {
    const token = state.push('citation', 'span', 0);
    token.content = `S${hit[1]}`;
    token.markup = '[';
  }
  state.pos = pos + hit[0].length;
  return true;
});

md.renderer.rules.citation = (tokens, idx, options, env) => {
  const id = tokens[idx].content;
  const known = Boolean(env?.citations?.has?.(id));
  const label = `[${id}]`;
  return known
    ? `<button type="button" class="citation" data-cite="${id}">${label}</button>`
    : `<button type="button" class="citation unverified" data-cite="${id}">${label} 来源未核验</button>`;
};

/* ── 代码块：语言标签 + 复制 ── */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const info = token.info.trim().split(/\s+/)[0] || '';
  const lang = info.toLowerCase();
  const body = lang && hljs.getLanguage(lang)
    ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
    : md.utils.escapeHtml(token.content);
  const label = info ? md.utils.escapeHtml(info) : '文本';
  return `<figure class="md-code"><figcaption><span class="md-code-lang">${label}</span>`
    + `<button class="md-code-copy" type="button" data-copy>复制</button></figcaption>`
    + `<pre><code class="hljs">${body}</code></pre></figure>`;
};

/* ── 图片：不外链，只留说明 ── */
md.renderer.rules.image = (tokens, idx) => {
  const alt = tokens[idx].content || '';
  return `<span class="md-image-note">〔图片：${md.utils.escapeHtml(alt || '未命名')}〕</span>`;
};

/* ── 链接：不外跳，点击复制地址 ── */
const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);
const defaultLinkOpen = md.renderer.rules.link_open || renderToken;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  tokens[idx].attrSet('data-href', href);
  tokens[idx].attrSet('title', href);
  tokens[idx].attrSet('href', '#');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** 渲染一段研究产物；citations 是已核验的来源编号集合（S1、S2…）。 */
export function renderMarkdown(content, { citations } = {}) {
  return md.render(String(content || ''), { citations });
}
