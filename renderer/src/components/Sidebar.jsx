import { useNavigate, useParams } from 'react-router-dom';
import { useDesk } from '../store.jsx';

export function Sidebar() {
  const { state, projectId, setProjectId, setDialog } = useDesk();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const projects = state?.projects || [];
  const conversations = (state?.conversations || []).filter(c => c.projectId === projectId).toReversed();

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">研</span>
        <div><strong>研序</strong><span>Research Desk</span></div>
        <span className="version">0.2</span>
      </div>
      <button id="new-project" className="new-project" onClick={() => setDialog({ kind: 'project', edit: false })}>
        <span aria-hidden="true">＋</span> 新建研究项目
      </button>
      <div className="sidebar-label">研究项目</div>
      <nav id="projects" aria-label="研究项目">
        {projects.map(p => (
          <button key={p.id} className={`project-item${p.id === projectId ? ' selected' : ''}`}
            onClick={() => { setProjectId(p.id); navigate('/chat'); }}>
            {p.name}
          </button>
        ))}
        {!projects.length && <p className="sidebar-empty">为你的研究建立一个项目</p>}
      </nav>
      <div className="sidebar-label history-label">
        <span>项目会话</span>
        <button id="new-conversation" className="icon-button" aria-label="新建会话" title="新建会话" onClick={() => navigate('/chat')}>＋</button>
      </div>
      <nav id="conversations" aria-label="项目会话">
        {conversations.map(c => (
          <button key={c.id} className={`conversation-item${c.id === conversationId ? ' selected' : ''}`}
            onClick={() => navigate(`/chat/${c.id}`)}>
            {c.title}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="local-dot"></span><span>资料保存在本机</span>
        <button id="open-settings" className="icon-button" aria-label="模型设置" title="模型设置" onClick={() => setDialog({ kind: 'settings' })}>⚙</button>
      </div>
    </aside>
  );
}
