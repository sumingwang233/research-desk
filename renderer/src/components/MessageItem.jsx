import { useEffect, useState } from 'react';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';
import { finished, statusNames, toolNames } from '../parts.js';

export function CitationText({ content, sources = [] }) {
  const { focusSource } = useDesk();
  const parts = String(content || '').split(/(\[S\d+\])/g);
  return (
    <div className="message-text">
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
    </div>
  );
}

function ReasoningPart({ text, streaming }) {
  return (
    <details className="reasoning-part" open={streaming}>
      <summary>推理过程{streaming ? '（进行中）' : ''}</summary>
      <div className="reasoning-text">{text}</div>
    </details>
  );
}

function ToolRow({ tool, waiting }) {
  const pending = waiting && tool.status === 'running';
  return (
    <div className={`tool-row ${tool.status}`}>
      <span className="tool-indicator">{tool.status === 'completed' ? '✓' : tool.status === 'failed' ? '!' : '◌'}</span>
      <span className="tool-label">{toolNames[tool.name] || tool.name}{tool.input && <span className="tool-input">{tool.input}</span>}</span>
      <span className="tool-result">{tool.error || (pending ? '等待你的决定' : { running: '执行中', completed: '已完成', failed: '失败' }[tool.status])}</span>
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
      <strong>允许保存这份研究笔记？</strong>
      <Countdown expiresAt={permission.expiresAt} />
      <p className="permission-title">{permission.title}</p>
      <pre className="permission-preview">{permission.content}</pre>
      <div className="permission-actions">
        <button type="button" className="secondary" disabled={answering} onClick={() => answer(false)}>拒绝写入</button>
        <button type="button" className="primary" disabled={answering} onClick={() => answer(true)}>允许并保存</button>
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
      <strong>{permission.question}</strong>
      <Countdown expiresAt={permission.expiresAt} />
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
        <button type="button" className="secondary" disabled={answering} onClick={() => answer(false)}>拒绝回答</button>
        <button type="button" className="primary" disabled={answering || !answers} onClick={() => answer(true, answers)}>提交答复</button>
      </div>
    </div>
  );
}

// 将连续 tool parts 归入一条时间线；text/reasoning 各自成块。
function PartList({ task }) {
  const blocks = [];
  const streamingNow = !finished(task);
  task.parts.forEach((part, index) => {
    const last = blocks[blocks.length - 1];
    if (part.type === 'tool' && last?.type === 'tools') last.tools.push(part);
    else if (part.type === 'tool') blocks.push({ type: 'tools', tools: [part], key: index });
    else blocks.push({ type: part.type, part, key: index });
  });
  const streaming = streamingNow;
  return blocks.map(block => {
    if (block.type === 'tools') {
      return (
        <div className="tool-timeline" key={block.key}>
          {block.tools.map(tool => <ToolRow key={tool.callId} tool={tool} waiting={Boolean(task.permission)} />)}
        </div>
      );
    }
    if (block.type === 'reasoning') return <ReasoningPart key={block.key} text={block.part.text} streaming={streaming && block.key === task.parts.length - 1} />;
    return <CitationText key={block.key} content={block.part.text} sources={task.sources} />;
  });
}

export function MessageItem({ message, task, onResend }) {
  return (
    <>
      <article className="message user-message">
        <div className="message-label">研究问题</div>
        <CitationText content={message.content} />
      </article>
      {task && (
        <article className="message assistant-message">
          <div className="assistant-heading">
            <span className="assistant-mark">研</span><strong>研究助理</strong>
            <span className={`task-status ${task.status}`}>{statusNames[task.status]}</span>
          </div>
          <PartList task={task} />
          {!task.output && !finished(task) && !task.permission && (
            <p className="working-text">{task.status === 'queued' ? '等待其他研究任务完成…' : '正在梳理问题与可用资料…'}</p>
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
    </>
  );
}

function ContinueButton() {
  return (
    <button type="button" className="text-button"
      onClick={() => {
        const input = document.getElementById('question');
        input.value = '请基于以上研究问题和已有结果继续，补充证据并完成分析。';
        input.focus();
      }}>
      基于现有进展继续研究
    </button>
  );
}
