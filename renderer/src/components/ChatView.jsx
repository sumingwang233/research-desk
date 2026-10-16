import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';
import { finished } from '../parts.js';
import { MessageItem } from './MessageItem.jsx';
import { Composer } from './Composer.jsx';

export function ChatView() {
  const { state, projectId, report, reload, setDialog } = useDesk();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [queued, setQueued] = useState(null); // {text, mode}
  const threadRef = useRef(null);
  const nearBottom = useRef(true);

  const conversation = state?.conversations.find(c => c.id === conversationId);
  const activeTask = state?.tasks.findLast(t => t.conversationId === conversationId && !finished(t));

  const send = async (text, mode, clientMessageId) => {
    const task = await api('/api/tasks', { projectId, conversationId, text, mode, clientMessageId: clientMessageId || crypto.randomUUID() });
    await reload();
    if (!conversationId) navigate(`/chat/${task.conversationId}`);
    requestAnimationFrame(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; });
  };

  // 当前任务 settle 后自动发出排队输入（对齐 interruptAndSend 等 settle 再 dispatch）。
  useEffect(() => {
    if (!queued || activeTask || !state) return;
    const pending = queued;
    setQueued(null);
    send(pending.text, pending.mode, pending.clientMessageId).catch(report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, activeTask, state]);

  const onScroll = () => {
    const el = threadRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };
  useEffect(() => {
    const el = threadRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [state, conversationId]);

  const submit = async (text, mode, clientMessageId) => {
    if (!state?.projects.some(p => p.id === projectId)) { setDialog({ kind: 'project', edit: false }); return; }
    if (!state.settings.configured) { setDialog({ kind: 'settings' }); return; }
    if (activeTask) { setQueued({ text, mode, clientMessageId: clientMessageId || crypto.randomUUID() }); return; }
    await send(text, mode, clientMessageId);
  };
  const interruptAndSend = async (text, mode) => {
    if (activeTask) {
      setQueued({ text, mode, clientMessageId: crypto.randomUUID() });
      await api(`/api/tasks/${activeTask.id}/stop`, {});
      await reload();
    }
  };
  const stop = async () => {
    if (!activeTask) return;
    await api(`/api/tasks/${activeTask.id}/stop`, {});
    await reload();
  };

  return (
    <section id="research-view" className="main-view research-view" aria-label="研究助理">
      <div id="thread" className="thread" aria-live="polite" ref={threadRef} onScroll={onScroll}>
        {!conversation
          ? <EmptyThread hasProject={Boolean(state?.projects.some(p => p.id === projectId))} />
          : conversation.messages.filter(m => m.role === 'user').map(message => (
              <MessageItem key={message.id} message={message} task={state.tasks.find(t => t.id === message.taskId)} onResend={() => submit(message.content, task?.mode || 'review', message.clientMessageId).catch(report)} />
            ))}
      </div>
      {queued && (
        <div className="queued-chip" role="status">
          <span>已排队，当前研究结束后发送：{queued.text.slice(0, 40)}{queued.text.length > 40 ? '…' : ''}</span>
          <button type="button" className="text-button" onClick={() => setQueued(null)}>取消排队</button>
        </div>
      )}
      <Composer activeTask={activeTask} onSubmit={submit} onStop={stop} onInterrupt={interruptAndSend} reportError={report} />
      <p className="composer-note">回答需结合来源核验。保存笔记前会请求你的许可。</p>
    </section>
  );
}

function EmptyThread({ hasProject }) {
  const { setDialog } = useDesk();
  const navigate = useNavigate();
  return (
    <div className="research-empty">
      <div className="research-glyph">⌘</div>
      <p className="welcome-kicker">你的科研工作台</p>
      <h1>让研究问题有据可循。</h1>
      <p className="welcome-description">{'从一条线索出发，检索文献、梳理证据，\n把值得探索的想法变成可执行的研究方案。'}</p>
      <div className="research-path">
        {[['提出问题', '明确研究对象与边界'], ['寻找证据', '追溯文献与已有线索'], ['形成方案', '整理方法、指标与下一步']].map(([label, detail]) => (
          <div className="path-step" key={label}><span className="path-dot"></span><strong>{label}</strong><span>{detail}</span></div>
        ))}
      </div>
      <button className="text-button" onClick={() => (hasProject ? navigate('/library') : setDialog({ kind: 'project', edit: false }))}>
        {hasProject ? '先到文献库寻找线索' : '创建第一个研究项目'}
      </button>
    </div>
  );
}
