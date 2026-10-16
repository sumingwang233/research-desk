import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { id } from './validation.mjs';

const empty = () => ({ version: 1, projects: [], conversations: [], sources: [], notes: [], tasks: [] });
export const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted']);
export function applyEvent(task, event) {
  task.sequence = event.sequence;
  task.updatedAt = event.timestamp;
  if (event.type === 'token') task.output += event.payload.text;
  if (event.type === 'part') task.parts[event.payload.index] = event.payload.part;
  if (event.type === 'part-delta') {
    const part = task.parts[event.payload.index];
    if (part && (part.type === 'text' || part.type === 'reasoning')) {
      part.text += event.payload.text;
      if (part.type === 'text') task.output += event.payload.text;
    }
  }
  if (event.type === 'status') task.status = event.payload.status;
  if (event.type === 'permission') task.permission = event.payload;
  if (event.type === 'permission-answered') task.permission = null;
  if (event.type === 'sources') task.sources.push(...event.payload.sources);
  if (event.type === 'tool') {
    const old = task.tools.find(t => t.callId === event.payload.callId);
    if (old) Object.assign(old, event.payload); else task.tools.push(event.payload);
  }
  if (event.type === 'done') { task.status = event.payload.status; task.error = event.payload.error || ''; task.permission = null; }
}
export async function openStore(directory) {
  await fs.mkdir(path.join(directory, 'events'), { recursive: true });
  const file = path.join(directory, 'state.json');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('本地资料无法读取；原文件已保留，请先备份 state.json 后修复'); state = empty(); }
  if (state.version !== 1 || !['projects','conversations','sources','notes','tasks'].every(k => Array.isArray(state[k]))) throw new Error('本地资料格式无效；原文件已保留');
  const eventPath = taskId => path.join(directory, 'events', `${id(taskId)}.ndjson`);
  async function history(taskId) {
    try {
      const raw = await fs.readFile(eventPath(taskId), 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('任务事件记录损坏；原文件已保留'); }
  }
  for (const task of state.tasks) {
    task.parts ||= [];
    for (const event of await history(task.id)) if (event.sequence > task.sequence) applyEvent(task, event);
    if (!terminal.has(task.status)) { task.status = 'interrupted'; task.permission = null; task.error = '应用已重启，请作为新任务继续'; }
    const conversation = state.conversations.find(c => c.id === task.conversationId);
    if (task.output && conversation && !conversation.messages.some(m => m.taskId === task.id && m.role === 'assistant')) conversation.messages.push({ id: randomUUID(), role: 'assistant', content: task.output, taskId: task.id, createdAt: task.updatedAt || task.createdAt });
  }
  // ponytail: personal workspaces rewrite one JSON snapshot; use SQLite when large libraries make writes slow.
  let chain = Promise.resolve();
  let failure;
  const serialize = fn => {
    const operation = chain.then(() => { if (failure) throw failure; return fn(); });
    chain = operation.catch(error => { if (error.code) failure = error; });
    return operation;
  };
  async function persist(next) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, file);
    state = next;
  }
  await persist(state);
  return {
    get: () => structuredClone(state),
    history,
    idle: () => chain,
    update: fn => serialize(async () => { const next = structuredClone(state); const result = fn(next); await persist(next); return result; }),
    record: (taskId, type, payload) => serialize(async () => {
      const next = structuredClone(state);
      const task = next.tasks.find(t => t.id === taskId);
      if (!task || terminal.has(task.status)) return null;
      const event = { taskId, sequence: task.sequence + 1, type, timestamp: new Date().toISOString(), payload };
      await fs.appendFile(eventPath(taskId), `${JSON.stringify(event)}\n`, { mode: 0o600 });
      applyEvent(task, event);
      await persist(next);
      return event;
    })
  };
}
