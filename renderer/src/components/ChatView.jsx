import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';
import { finished } from '../parts.js';
import { MessageItem } from './MessageItem.jsx';
import { Composer } from './Composer.jsx';
import { ArrowDownIcon, ComposeIcon, FolderIcon, LibraryIcon, NoteIcon } from './ui/icons.jsx';

export function ChatView() {
  const { state, projectId, report, reload, setDialog } = useDesk();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [queued, setQueued] = useState(null); // {text, mode}
  const [showJump, setShowJump] = useState(false);
  const threadRef = useRef(null);
  const nearBottom = useRef(true);

  const conversation = state?.conversations.find(c => c.id === conversationId);
  const activeTask = state?.tasks.findLast(t => t.conversationId === conversationId && !finished(t));

  /* 项目概览的计量：来源 / 笔记 / 会话都属于项目层，不属于单条线程 */
  const project = state?.projects.find(p => p.id === projectId);
  const counts = {
    sources: state?.sources.filter(s => s.projectId === projectId).length ?? 0,
    notes: state?.notes.filter(n => n.projectId === projectId).length ?? 0,
    sessions: state?.conversations.filter(c => c.projectId === projectId).length ?? 0
  };

  const scrollToBottom = (smooth = false) => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  };

  const send = async (text, mode, clientMessageId) => {
    const task = await api('/api/tasks', { projectId, conversationId, text, mode, clientMessageId: clientMessageId || crypto.randomUUID() });
    await reload();
    if (!conversationId) navigate(`/chat/${task.conversationId}`);
    requestAnimationFrame(() => { nearBottom.current = true; scrollToBottom(); });
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
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = distance < 100;
    setShowJump(distance > 320);
  };
  useEffect(() => {
    const el = threadRef.current;
    if (el && nearBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
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
          ? <ProjectOverview project={project} counts={counts} />
          : conversation.messages.filter(m => m.role === 'user').map(message => {
              const task = state.tasks.find(t => t.id === message.taskId);
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  task={task}
                  onResend={() => submit(message.content, task?.mode || 'review', message.clientMessageId).catch(report)}
                />
              );
            })}
      </div>
      {showJump && (
        <button type="button" className="scroll-bottom" aria-label="回到最新" title="回到最新" onClick={() => { nearBottom.current = true; scrollToBottom(true); }}>
          <ArrowDownIcon />
        </button>
      )}
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

function ProjectOverview({ project, counts }) {
  const { setDialog, reload, toast, report } = useDesk();
  const navigate = useNavigate();

  if (!project) {
    return (
      <div className="research-empty">
        <div className="research-glyph">研</div>
        <p className="welcome-kicker">你的科研工作台</p>
        <h1>先建一个研究项目。</h1>
        <p className="welcome-description">{'来源、笔记和会话都挂在项目下，\n所以第一步是划定一个研究边界。'}</p>
        <button className="text-button" onClick={() => setDialog({ kind: 'project', edit: false })}>创建第一个研究项目</button>
      </div>
    );
  }

  const askQuestion = () => {
    const input = document.getElementById('question');
    if (!input) return;
    input.focus();
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const importNote = async () => {
    const created = await window.desk.importNote(project.id).catch(() => null);
    if (!created) return;
    await reload();
    toast('笔记已导入');
  };

  return (
    <div className="overview">
      <p className="overview-kicker">研究项目</p>
      <h1 className="overview-title">{project.name}</h1>
      <p className="overview-direction">
        {project.direction || '还没写研究方向。补上一句，检索和结论都会更聚焦。'}
      </p>

      <div className="overview-stats">
        <span><strong>{counts.sources}</strong>来源</span>
        <span><strong>{counts.notes}</strong>笔记</span>
        <span><strong>{counts.sessions}</strong>会话</span>
      </div>

      <p className="overview-workdir">
        <FolderIcon size={12} />
        <span>{project.workdir || '未绑定资料目录'}</span>
      </p>

      <div className="overview-actions">
        <button className="overview-action" onClick={askQuestion}>
          <ComposeIcon size={14} />
          <span className="overview-action-body">
            <strong>提出研究问题</strong>
            <span>描述问题、线索或假设，研究助理会先检索再回答</span>
          </span>
        </button>
        <button className="overview-action" onClick={() => navigate('/library')}>
          <LibraryIcon size={14} />
          <span className="overview-action-body">
            <strong>检索文献</strong>
            <span>从 Crossref 拉取可追溯的学术元数据</span>
          </span>
        </button>
        <button className="overview-action" onClick={() => importNote().catch(report)}>
          <NoteIcon size={14} />
          <span className="overview-action-body">
            <strong>导入已有笔记</strong>
            <span>Markdown 或纯文本，作为这一轮研究的起点</span>
          </span>
        </button>
      </div>

      <p className="overview-hint">资料目录以只读方式挂载，研究助理不会改动其中的文件。</p>
    </div>
  );
}
