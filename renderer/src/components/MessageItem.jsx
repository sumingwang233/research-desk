import { useEffect, useState } from 'react';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';
import { finished, statusNames, toolNames } from '../parts.js';
import { Button } from './ui/Button.jsx';
import { Markdown } from './Markdown.jsx';
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon } from './ui/icons.jsx';

export function CitationText({ content, sources = [], streaming = false }) {
  const { focusSource } = useDesk();
  const parts = String(content || '').split(/(\[S\d+\])/g);
  return (
    <div className={`message-text${streaming ? ' is-streaming' : ''}`}>
      {parts.map((part, i) => {
        if (!/^\[S\d+\]$/.test(part)) return <span key={i}>{part}</span>;
        const source = sources.find(s => s.citation === part.slice(1, -1));
        return (
          <button key={i} type="button" className={`citation${source ? '' : ' unverified'}`}
            onClick={() => source && focusSource(source.id)}>
            {source ? part : `${part} 来源未核验`}
          </button>
        );
      })}
      {streaming && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
}

/* ── 推理过程：折叠 + 箭头旋转（对齐 HanaAgent ThinkingBlock）── */
function ReasoningPart({ text, streaming }) {
  return (
    <details className="reasoning-part" open={Boolean(streaming)}>
      <summary>
        <ChevronRightIcon className="fold-chev" size={11} />
        <span>{streaming ? '正在推理' : '推理过程'}</span>
      </summary>
      <div className="reasoning-text">{text}</div>
    </details>
  );
}

/* ── 工具调用组：按工具名聚合计数，默认展开 ── */
function summarize(tools) {
  const counts = new Map();
  for (const tool of tools) {
    const label = toolNames[tool.name] || tool.name;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(' · ');
}

function ToolGroup({ tools, waiting }) {
  const [open, setOpen] = useState(true);
  const running = tools.some(tool => tool.status === 'running');
  const failed = tools.filter(tool => tool.status === 'failed').length;
  const multi = tools.length > 1;

  const title = running
    ? `执行中 · ${summarize(tools)}`
    : failed > 0
      ? `${summarize(tools)}（${failed} 项未完成）`
      : summarize(tools);

  const rows = tools.map(tool => <ToolRow key={tool.callId} tool={tool} waiting={waiting} />);

  if (!multi) {
    return <div className="tool-timeline">{rows}</div>;
  }

  return (
    <div className="tool-timeline">
      <button
        type="button"
        className="tool-group-summary"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="tool-group-title">{title}</span>
        <ChevronDownIcon className="tool-group-arrow" size={12} />
      </button>
      <div className="collapse" data-open={open}>
        <div>{rows}</div>
      </div>
    </div>
  );
}

function ToolRow({ tool, waiting }) {
  const pending = waiting && tool.status === 'running';
  const label = toolNames[tool.name] || tool.name;
  return (
    <div className={`tool-row ${tool.status}`}>
      <span className="tool-indicator" aria-hidden="true">
        {tool.status === 'completed' && <CheckIcon size={11} />}
        {tool.status === 'failed' && <AlertIcon size={11} />}
      </span>
      <span className="tool-label">
        {label}
        {tool.input && <span className="tool-input">{tool.input}</span>}
      </span>
      <span className="tool-result">
        {tool.error || (pending ? '等待你的决定' : { running: '', completed: '已完成', failed: '失败' }[tool.status])}
      </span>
    </div>
  );
}

function Countdown({ expiresAt }) {
  const { reload } = useDesk();
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt) - Date.now()));
  useEffect(() => {
    const timer = setInterval(() => {
      const rest = new Date(expiresAt) - Date.now();
      setLeft(Math.max(0, rest));
      if (rest <= 0) { clearInterval(timer); void reload().catch(() => {}); }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, reload]);
  const mm = String(Math.floor(left / 60000));
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  return <span className="permission-countdown">{left > 0 ? `${mm}:${ss} 后自动拒绝` : '已过期'}</span>;
}

function PermissionCard({ task }) {
  const { reload, report } = useDesk();
  const [answering, setAnswering] = useState(false);
  const permission = task.permission;
  const answer = async (allow, answers = '') => {
    setAnswering(true);
    try { await api(`/api/tasks/${task.id}/permissions/${permission.requestId}`, { allow, answers }); await reload(); }
    catch (error) { await reload(); report(error); }
  };
  if (permission.kind === 'question') return <QuestionCard permission={permission} answering={answering} answer={answer} />;
  return (
    <div className="permission">
      <div className="permission-head">
        <strong>允许保存这份研究笔记？</strong>
        <Countdown expiresAt={permission.expiresAt} />
      </div>
      <p className="permission-title">{permission.title}</p>
      <pre className="permission-preview">{permission.content}</pre>
      <div className="permission-actions">
        <Button disabled={answering} onClick={() => answer(false)}>拒绝写入</Button>
        <Button variant="primary" disabled={answering} onClick={() => answer(true)}>允许并保存</Button>
      </div>
    </div>
  );
}

function QuestionCard({ permission, answering, answer }) {
  const [selected, setSelected] = useState(0);
  const [custom, setCustom] = useState('');
  const useCustom = selected === -1;
  const answers = useCustom ? custom.trim() : permission.options[selected]?.label || '';
  return (
    <div className="permission question-card">
      <div className="permission-head">
        <strong>{permission.question}</strong>
        <Countdown expiresAt={permission.expiresAt} />
      </div>
      <div className="question-options" role="radiogroup" aria-label="候选方向">
        {permission.options.map((option, index) => (
          <label key={index} className={`question-option${selected === index ? ' selected' : ''}`}>
            <input type="radio" name="question-option" checked={selected === index} onChange={() => setSelected(index)} />
            <span className="option-label">{option.label}</span>
            {option.description && <span className="option-description">{option.description}</span>}
          </label>
        ))}
        <label className={`question-option${useCustom ? ' selected' : ''}`}>
          <input type="radio" name="question-option" checked={useCustom} onChange={() => setSelected(-1)} />
          <span className="option-label">其他</span>
        </label>
      </div>
      {useCustom && <input className="question-custom" value={custom} maxLength="500" placeholder="用一句话说明你的方向" onChange={event => setCustom(event.target.value)} />}
      <div className="permission-actions">
        <Button disabled={answering} onClick={() => answer(false)}>拒绝回答</Button>
        <Button variant="primary" disabled={answering} onClick={() => answer(true, answers || '按你的推荐方向继续')}>提交答复</Button>
      </div>
    </div>
  );
}

/* ── 研究过程：把推理与工具调用收成一条折叠块（参照 HanaAgent ProcessFoldBlock）── */
function ProcessFold({ blocks, waiting, live }) {
  const [open, setOpen] = useState(false);
  const toolCount = blocks.reduce((n, b) => n + (b.type === 'tools' ? b.tools.length : 0), 0);
  const reasoningCount = blocks.filter(b => b.type === 'reasoning').length;
  const failed = blocks.reduce((n, b) => n + (b.type === 'tools' ? b.tools.filter(t => t.status === 'failed').length : 0), 0);
  const running = blocks.some(b => b.type === 'tools' && b.tools.some(t => t.status === 'running'));

  const parts = [];
  if (toolCount) parts.push(`工具 ${toolCount} 次`);
  if (reasoningCount) parts.push(`推理 ${reasoningCount} 段`);
  const summary = running ? `进行中 · ${parts.join(' · ')}` : parts.join(' · ');

  return (
    <div className={`process-fold${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="process-fold-summary"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="process-fold-title">
          研究过程{failed > 0 ? `（${failed} 项未完成）` : ''}
          <span className="process-fold-meta">{summary}</span>
        </span>
        {running
          ? <span className="process-fold-dots" aria-hidden="true" />
          : <ChevronRightIcon className="process-fold-arrow" size={12} />}
      </button>
      <div className="collapse" data-open={open}>
        <div className="process-fold-body">
          {blocks.map(block => (block.type === 'tools'
            ? <ToolGroup key={block.key} tools={block.tools} waiting={waiting} />
            : <ReasoningPart key={block.key} text={block.part.text} streaming={live && block.key === blocks[blocks.length - 1].key} />))}
        </div>
      </div>
    </div>
  );
}

// 渲染：正文独立成段，连续的推理/工具收进一条过程折叠块。
function PartList({ task }) {
  const blocks = [];
  task.parts.forEach((part, index) => {
    const last = blocks[blocks.length - 1];
    if (part.type === 'tool' && last?.type === 'tools') last.tools.push(part);
    else if (part.type === 'tool') blocks.push({ type: 'tools', tools: [part], key: index });
    else blocks.push({ type: part.type, part, key: index });
  });

  const groups = [];
  for (const block of blocks) {
    const isProcess = block.type === 'reasoning' || block.type === 'tools';
    if (isProcess && block.type === 'reasoning' && !String(block.part.text || '').trim()) continue;
    const last = groups[groups.length - 1];
    if (isProcess && last?.kind === 'process') last.blocks.push(block);
    else if (isProcess) groups.push({ kind: 'process', blocks: [block], key: `p${block.key}` });
    else if (String(block.part.text || '').trim()) groups.push({ kind: 'text', block, key: `t${block.key}` });
  }

  const streaming = !finished(task);
  return groups.map((group, index) => {
    if (group.kind === 'process') {
      return (
        <ProcessFold
          key={group.key}
          blocks={group.blocks}
          waiting={Boolean(task.permission)}
          live={streaming && index === groups.length - 1}
        />
      );
    }
    return <Markdown key={group.key} content={group.block.part.text} sources={task.sources} streaming={streaming && index === groups.length - 1} />;
  });
}

export function MessageItem({ message, task, onResend }) {
  /* 时间戳做一次容错：服务端历史数据可能是数字、ISO 字符串或缺字段 */
  const started = task?.createdAt ? new Date(task.createdAt) : null;
  const validStart = started && !Number.isNaN(started.getTime()) ? started : null;
  return (
    <div className="turn">
      <article className="message user-message">
        <div className="message-label">研究问题</div>
        <CitationText content={message.content} />
        <div className="msg-actions">
          <CopyAction text={message.content} />
        </div>
      </article>
      {task && (
        <article className="message assistant-message">
          <div className="assistant-heading">
            <span className="assistant-mark">研</span><strong>研究助理</strong>
            <span className={`task-status ${task.status}`}>{statusNames[task.status]}</span>
            {validStart && (
              <time className="assistant-time" dateTime={validStart.toISOString()}>
                {validStart.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </time>
            )}
          </div>
          <PartList task={task} />
          {!task.output && !finished(task) && !task.permission && (
            <p className="working-text">{task.status === 'queued' ? '等待其他研究任务完成' : '正在梳理问题与可用资料'}</p>
          )}
          {task.permission && <PermissionCard task={task} />}
          {task.error && <p className="task-error">{task.error}</p>}
          {finished(task) && task.status !== 'completed' && (
            <div className="task-recovery">
              <button type="button" className="text-button" onClick={() => onResend()}>重发这条研究问题</button>
              <ContinueButton />
            </div>
          )}
        </article>
      )}
    </div>
  );
}

function CopyAction({ text }) {
  const { toast } = useDesk();
  return (
    <button
      type="button"
      className="msg-action"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => toast('已复制这条研究问题')).catch(() => toast('复制失败'));
      }}
    >
      <CopyIcon size={11} />
      <span>复制</span>
    </button>
  );
}

function ContinueButton() {
  return (
    <button type="button" className="text-button"
      onClick={() => {
        const input = document.getElementById('question');
        input.value = '请基于以上研究问题和已有结果继续，补充证据并完成分析。';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }}>
      基于现有进展继续研究
    </button>
  );
}
