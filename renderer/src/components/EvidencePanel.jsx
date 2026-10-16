import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDesk } from '../store.jsx';

export function EvidencePanel() {
  const { state, projectId, panel, setPanel, focusSourceId, setFocusSourceId, suspendedTasks, reconnect } = useDesk();
  const location = useLocation();
  const navigate = useNavigate();
  const conversationId = location.pathname.match(/^\/chat\/([^/]+)/)?.[1];
  const projectSources = (state?.sources || []).filter(s => s.projectId === projectId);
  const projectNotes = (state?.notes || []).filter(n => n.projectId === projectId);
  const task = state?.tasks.findLast(t => t.conversationId === conversationId);
  const sources = task?.sources?.length ? task.sources : projectSources;
  const suspended = Object.entries(suspendedTasks).find(([taskId, on]) => on && state?.tasks.some(t => t.id === taskId));

  useEffect(() => {
    if (!focusSourceId) return;
    const target = document.getElementById(`evidence-${focusSourceId}`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus();
    setFocusSourceId(null);
  }, [focusSourceId, setFocusSourceId, state]);

  return (
    <aside id="evidence-panel" className="evidence-panel">
      <div className="evidence-heading">
        <div><span className="panel-kicker">研究资料</span><h2>证据与线索</h2></div>
        <span className="evidence-symbol" aria-hidden="true">⌕</span>
      </div>
      <div className="panel-tabs">
        <button id="panel-sources" className={panel === 'sources' ? 'active' : ''} onClick={() => setPanel('sources')}>来源</button>
        <button id="panel-notes" className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel('notes')}>笔记</button>
      </div>
      {suspended && (
        <div className="reconnect-banner" role="alert">
          <span>任务订阅已中断</span>
          <button type="button" className="text-button" onClick={() => reconnect(suspended[0])}>重新连接</button>
        </div>
      )}
      <div id="evidence-content">
        {panel === 'sources' ? <SourceList sources={sources} /> : <NoteList notes={projectNotes} onManage={() => navigate('/notes')} />}
      </div>
      <div className="evidence-footer">来源卡保留检索信息与获取时间。<br />元数据不等于论文全文。</div>
    </aside>
  );
}

function SourceList({ sources }) {
  const navigate = useNavigate();
  if (!sources.length) {
    return (
      <div className="panel-empty">
        <span className="empty-symbol">▤</span>
        <h3>让每个结论找到出处</h3>
        <p>研究中检索到的文献会出现在这里。也可以先在文献库积累线索。</p>
        <button className="text-button" onClick={() => navigate('/library')}>检索文献</button>
      </div>
    );
  }
  return sources.map(source => (
    <article className="source-card" id={`evidence-${source.id}`} tabIndex={-1} key={source.id}>
      <div className="source-meta">
        <span className="source-citation">{source.citation ? `[${source.citation}]` : '文献'}</span>
        <span>{source.year || '年份未提供'}</span>
      </div>
      <h3 className="paper-title">{source.title}</h3>
      <p className="source-authors">{source.authors || '作者未提供'}</p>
      <details className="source-detail">
        <summary>{source.abstract ? '查看摘要与检索信息' : '查看检索信息'}</summary>
        <p>{source.abstract || '该条元数据未提供摘要，尚未读取论文全文。'}</p>
        <p className="source-query">{`检索：${source.query || '项目已有来源'}\n获取：${new Date(source.retrievedAt).toLocaleString('zh-CN')}`}</p>
      </details>
      {source.url && <button className="source-link" onClick={() => window.desk.openSource(source.url)}>打开原始来源 ↗</button>}
    </article>
  ));
}

function NoteList({ notes, onManage }) {
  const navigate = useNavigate();
  return (
    <>
      {!notes.length && <p className="panel-empty">尚无笔记。可导入已有资料，或在研究中批准保存新笔记。</p>}
      {notes.toReversed().map(note => (
        <button key={note.id} className="panel-note" onClick={() => navigate(`/notes?note=${note.id}`)}>{note.title}</button>
      ))}
      <button className="text-button panel-manage" onClick={onManage}>管理研究笔记</button>
    </>
  );
}
