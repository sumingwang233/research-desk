import { useMemo } from 'react';
import { renderMarkdown } from '../markdown.js';
import { useDesk } from '../store.jsx';

/**
 * 研究产物渲染
 *
 * 用 dangerouslySetInnerHTML 是因为 markdown-it 产出的是 HTML 字符串；
 * html:false 已经把模型输出里的标记当作纯文本转义，注入面只剩我们自己生成的
 * 按钮与代码块。事件全部走容器委托，避免每个引用/代码块各挂一个监听。
 */
export function Markdown({ content, sources = [], streaming = false }) {
  const { focusSource, toast } = useDesk();
  const citationIds = sources.map(source => source.citation).filter(Boolean).join(',');

  const html = useMemo(() => {
    const citations = new Set(citationIds ? citationIds.split(',') : []);
    const body = renderMarkdown(content, { citations });
    return streaming ? `${body}<span class="stream-caret" aria-hidden="true"></span>` : body;
  }, [content, citationIds, streaming]);

  const onClick = event => {
    const cite = event.target.closest('[data-cite]');
    if (cite) {
      const source = sources.find(item => item.citation === cite.dataset.cite);
      if (source) focusSource(source.id);
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const code = copy.closest('.md-code')?.querySelector('code');
      if (!code) return;
      navigator.clipboard?.writeText(code.textContent)
        .then(() => toast('已复制代码'))
        .catch(() => toast('复制失败'));
      return;
    }
    const link = event.target.closest('a[data-href]');
    if (link) {
      event.preventDefault();
      navigator.clipboard?.writeText(link.dataset.href)
        .then(() => toast('链接已复制'))
        .catch(() => toast('复制失败'));
    }
  };

  return (
    <div
      className={`message-text md${streaming ? ' is-streaming' : ''}`}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
