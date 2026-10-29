import { useNavigate, useParams } from 'react-router-dom';
import { useDesk } from '../store.jsx';
import { GearIcon, PlusIcon } from './ui/icons.jsx';

const DAY = 86400000;
const WEEKDAYS = '日一二三四五六';

/* 会话按最近活动分三段：今天 / 本周（周一起）/ 更早 */
function groupConversations(conversations, tasks) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - ((now.getDay() + 6) % 7) * DAY;

  const lastActivity = conversation => {
    let at = conversation.createdAt ? new Date(conversation.createdAt).getTime() : 0;
    for (const task of tasks) {
      if (task.conversationId !== conversation.id) continue;
      const stamp = new Date(task.updatedAt || task.createdAt || 0).getTime();
      if (Number.isFinite(stamp) && stamp > at) at = stamp;
    }
    return Number.isFinite(at) ? at : 0;
  };

  const buckets = [
    { key: 'today', label: '今天', items: [] },
    { key: 'week', label: '本周', items: [] },
    { key: 'earlier', label: '更早', items: [] }
  ];

  for (const conversation of conversations) {
    const at = lastActivity(conversation);
    const bucket = at >= todayStart ? buckets[0] : at >= weekStart ? buckets[1] : buckets[2];
    bucket.items.push({ conversation, at });
  }

  for (const bucket of buckets) bucket.items.sort((a, b) => b.at - a.at);

  const stamp = at => {
    if (!at) return '';
    const date = new Date(at);
    if (at >= todayStart) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (at >= weekStart) return `周${WEEKDAYS[date.getDay()]}`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return buckets.filter(bucket => bucket.items.length).map(bucket => ({ ...bucket, stamp }));
}

export function Sidebar() {
  const { state, projectId, setProjectId, setDialog } = useDesk();
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const projects = state?.projects || [];
  const tasks = state?.tasks || [];
  const conversations = (state?.conversations || []).filter(c => c.projectId === projectId);

  /* 项目项的副行计数：来源数与会话数，让侧栏一眼能比较项目体量 */
  const sourceCounts = new Map();
  for (const source of state?.sources || []) sourceCounts.set(source.projectId, (sourceCounts.get(source.projectId) || 0) + 1);
  const conversationCounts = new Map();
  for (const conversation of state?.conversations || []) conversationCounts.set(conversation.projectId, (conversationCounts.get(conversation.projectId) || 0) + 1);

  const groups = groupConversations(conversations, tasks);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">研</span>
        <div><strong>研序</strong><span>Research Desk</span></div>
        <span className="version">0.3</span>
      </div>
      <button id="new-project" className="new-project" onClick={() => setDialog({ kind: 'project', edit: false })}>
        <PlusIcon size={13} />
        <span>新建研究项目</span>
      </button>
      <div className="sidebar-label">研究项目</div>
      <nav id="projects" aria-label="研究项目">
        {projects.map(p => (
          <button key={p.id} className={`project-item${p.id === projectId ? ' selected' : ''}`}
            onClick={() => { setProjectId(p.id); navigate('/chat'); }}>
            <span className="item-title">{p.name}</span>
            <span className="item-meta">{sourceCounts.get(p.id) || 0} 源 · {conversationCounts.get(p.id) || 0} 会话</span>
          </button>
        ))}
        {!projects.length && <p className="sidebar-empty">为你的研究建立一个项目</p>}
      </nav>
      <div className="sidebar-label history-label">
        <span>项目会话</span>
        <button id="new-conversation" className="icon-button" aria-label="新建会话" data-tip="新建会话" onClick={() => navigate('/chat')}>
          <PlusIcon size={12} />
        </button>
      </div>
      <nav id="conversations" aria-label="项目会话">
        {groups.map(group => (
          <div className="sidebar-group" key={group.key}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(({ conversation, at }) => (
              <button key={conversation.id} className={`conversation-item${conversation.id === conversationId ? ' selected' : ''}`}
                onClick={() => navigate(`/chat/${conversation.id}`)}>
                <span className="item-title">{conversation.title}</span>
                <span className="conv-time">{group.stamp(at)}</span>
              </button>
            ))}
          </div>
        ))}
        {!conversations.length && <p className="sidebar-empty">还没有会话</p>}
      </nav>
      <div className="sidebar-bottom">
        <span className="local-dot"></span><span>资料保存在本机</span>
        <button id="open-settings" className="text-button sidebar-setting" aria-label="模型设置" data-tip="模型设置" onClick={() => setDialog({ kind: 'settings' })}>
          <GearIcon size={12} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
