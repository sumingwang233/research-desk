import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDesk } from '../store.jsx';
import { Sidebar } from './Sidebar.jsx';
import { EvidencePanel } from './EvidencePanel.jsx';
import { ProjectDialog, SettingsDialog } from './Dialogs.jsx';

export function Shell() {
  const { state, projectId, toastMessage, dialog, loadError } = useDesk();
  const location = useLocation();
  const navigate = useNavigate();
  const inChat = location.pathname.startsWith('/chat');
  const [showEvidence, setShowEvidence] = useState(false);
  const project = state?.projects.find(p => p.id === projectId);
  const sourceCount = state?.sources.filter(s => s.projectId === projectId).length ?? 0;
  const noteCount = state?.notes.filter(n => n.projectId === projectId).length ?? 0;

  useEffect(() => {
    document.body.classList.toggle('show-evidence', showEvidence);
    return () => document.body.classList.remove('show-evidence');
  }, [showEvidence]);
  useEffect(() => { setShowEvidence(false); }, [location.pathname]);

  const tab = (to, view, label, count) => (
    <NavLink to={to} role="tab" data-view={view} aria-selected={view === 'research' ? inChat : location.pathname === to} onClick={event => { if (view === 'research' && inChat) event.preventDefault(); }}>
      {label}{count !== undefined && <span>{count}</span>}
    </NavLink>
  );

  return (
    <>
      <Sidebar />
      <main className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">
            <span className="project-icon" aria-hidden="true">▱</span>
            <strong id="project-name">{project?.name || '我的研究空间'}</strong>
            {project && <EditProjectButton />}
          </div>
          <ModelStatus />
        </header>
        <div className="workspace-nav">
          <div className="tabs" role="tablist" aria-label="工作区">
            {tab('/chat', 'research', '研究助理')}
            {tab('/library', 'library', '文献库 ', sourceCount)}
            {tab('/notes', 'notes', '研究笔记 ', noteCount)}
          </div>
          <span className="direction" id="project-direction">{project?.direction || '从一个值得研究的问题开始'}</span>
          {inChat && (
            <button id="toggle-evidence" className="text-button evidence-toggle" aria-controls="evidence-content" aria-expanded={String(showEvidence)} onClick={() => setShowEvidence(v => !v)}>资料栏</button>
          )}
        </div>
        <div className="desk-body">
          {loadError
            ? <section className="main-view research-view"><div className="thread"><div className="large-empty">{`工作台加载失败：${loadError}。请重新启动应用。`}</div></div></section>
            : <Outlet context={{ inChat }} />}
          {inChat && !loadError && <EvidencePanel />}
        </div>
      </main>
      <div id="toast" className="toast" role="status" hidden={!toastMessage}>{toastMessage}</div>
      {dialog?.kind === 'project' && <ProjectDialog key={`${dialog.edit}-${projectId}`} edit={dialog.edit} />}
      {dialog?.kind === 'settings' && <SettingsDialog key="settings" />}
    </>
  );
}

function EditProjectButton() {
  const { setDialog } = useDesk();
  return <button id="edit-project" className="icon-button" aria-label="编辑项目" title="编辑项目" onClick={() => setDialog({ kind: 'project', edit: true })}>✎</button>;
}

export function ModelStatus() {
  const { state, setDialog } = useDesk();
  const configured = state?.settings?.configured;
  return (
    <button id="model-status" className={`model-button${configured ? ' configured' : ''}`} onClick={() => setDialog({ kind: 'settings' })}>
      <span className="status-dot"></span>
      <span>{configured ? state.settings.model : '配置研究模型'}</span>
    </button>
  );
}
