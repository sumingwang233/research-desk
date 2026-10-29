import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useDesk } from '../store.jsx';
import { Sidebar } from './Sidebar.jsx';
import { EvidencePanel } from './EvidencePanel.jsx';
import { ProjectDialog, SettingsDialog } from './Dialogs.jsx';
import { EditIcon, FolderIcon, PanelIcon } from './ui/icons.jsx';

export function Shell() {
  const { state, projectId, toastMessage, dialog, loadError, evidenceOpen, setEvidenceOpen } = useDesk();
  const location = useLocation();
  const inChat = location.pathname.startsWith('/chat');
  const project = state?.projects.find(p => p.id === projectId);
  const sourceCount = state?.sources.filter(s => s.projectId === projectId).length ?? 0;
  const noteCount = state?.notes.filter(n => n.projectId === projectId).length ?? 0;

  /* 当前会话真正引用到的来源数：资料栏按钮上的数字就是"这一轮有多少证据" */
  const conversationId = location.pathname.match(/^\/chat\/([^/]+)/)?.[1];
  const citedCount = state?.tasks.findLast(t => t.conversationId === conversationId)?.sources?.length ?? 0;

  /* 资料栏是浮层抽屉：开关记在 store，引用点击也能把它叫出来 */
  useEffect(() => {
    document.body.classList.toggle('show-evidence', inChat && evidenceOpen);
    return () => document.body.classList.remove('show-evidence');
  }, [inChat, evidenceOpen]);
  useEffect(() => { setEvidenceOpen(false); }, [location.pathname, setEvidenceOpen]);
  useEffect(() => {
    if (!evidenceOpen) return;
    const onKey = event => { if (event.key === 'Escape') setEvidenceOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [evidenceOpen, setEvidenceOpen]);

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
            <FolderIcon className="project-icon" size={15} />
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
            {tab('/workspace', 'workspace', '工作区')}
          </div>
          <div className="nav-meta">
            {project?.direction && <span className="direction" id="project-direction" title={project.direction}>{project.direction}</span>}
            {inChat && (
              <button
                id="toggle-evidence"
                className={`count-chip${evidenceOpen ? ' is-open' : ''}`}
                aria-controls="evidence-content"
                aria-expanded={String(evidenceOpen)}
                data-tip={evidenceOpen ? '收起资料' : '展开资料'}
                onClick={() => setEvidenceOpen(open => !open)}
              >
                <PanelIcon size={12} />
                <span>资料{citedCount ? ` ${citedCount}` : ''}</span>
              </button>
            )}
          </div>
        </div>
        <div className="desk-body">
          {loadError
            ? <section className="main-view research-view"><div className="thread"><div className="large-empty">{`工作台加载失败：${loadError}。请重新启动应用。`}</div></div></section>
            : <Outlet context={{ inChat }} />}
          {inChat && !loadError && <EvidencePanel />}
        </div>
      </main>
      <div id="toast" className="toast" role="status" hidden={!toastMessage}>{toastMessage}</div>
      {dialog?.kind === 'project' && <ProjectDialog key={`project-${dialog.edit}-${dialog.nonce}`} edit={dialog.edit} />}
      {dialog?.kind === 'settings' && <SettingsDialog key={`settings-${dialog.nonce}`} />}
    </>
  );
}

function EditProjectButton() {
  const { setDialog } = useDesk();
  return (
    <button id="edit-project" className="icon-button" aria-label="编辑项目" data-tip="编辑项目" onClick={() => setDialog({ kind: 'project', edit: true })}>
      <EditIcon size={13} />
    </button>
  );
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
