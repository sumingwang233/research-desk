export const terminal = ['completed', 'failed', 'stopped', 'interrupted'];
export const finished = task => task && terminal.includes(task.status);
export const statusNames = { queued: '排队中', running: '研究中', waiting_permission: '等待你的许可', completed: '已完成', failed: '未完成', stopped: '已停止', interrupted: '等待续接' };
export const toolNames = { search_papers: '检索文献', read_project_notes: '读取项目笔记', list_project_sources: '整理已有来源', save_research_note: '申请保存笔记' };

// 与服务端 store.applyEvent 同语义的事件归约；task 原地修改后由调用方触发渲染。
export function applyStreamEvent(task, event) {
  if (event.type === 'snapshot') {
    if (event.payload.sequence >= task.sequence) Object.assign(task, event.payload);
    return;
  }
  if (!event.sequence || event.sequence <= task.sequence) return;
  task.sequence = event.sequence;
  const p = event.payload;
  switch (event.type) {
    case 'part': task.parts[p.index] = p.part; break;
    case 'part-delta': {
      const part = task.parts[p.index];
      if (part && (part.type === 'text' || part.type === 'reasoning')) {
        part.text += p.text;
        if (part.type === 'text') task.output += p.text;
      }
      break;
    }
    case 'status': task.status = p.status; break;
    case 'permission': task.permission = p; break;
    case 'permission-answered': task.permission = null; break;
    case 'sources': task.sources.push(...p.sources); break;
    case 'done': task.status = p.status; task.error = p.error || ''; task.permission = null; break;
  }
}
