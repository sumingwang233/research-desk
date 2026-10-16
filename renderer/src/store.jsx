import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { initSession, api, getSession } from './api.js';
import { applyStreamEvent, finished } from './parts.js';
import { watchTask } from './stream.js';

const DeskContext = createContext(null);
export const useDesk = () => useContext(DeskContext);

export function DeskProvider({ children }) {
  const [state, setState] = useState(null);
  const [projectId, setProjectId] = useState();
  const [toastMessage, setToastMessage] = useState('');
  const [panel, setPanel] = useState('sources');
  const [focusSourceId, setFocusSourceId] = useState(null);
  const [suspendedTasks, setSuspendedTasks] = useState({});
  const [dialog, setDialog] = useState(null); // {kind:'project',edit} | {kind:'settings'} | null
  const [loadError, setLoadError] = useState('');
  const streams = useRef(new Map());
  const toastTimer = useRef();
  const stateRef = useRef(null);
  stateRef.current = state;

  const toast = useCallback(message => {
    setToastMessage(String(message));
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(''), 5000);
  }, []);
  const report = useCallback(error => toast(error?.message || String(error)), [toast]);

  const updateTask = useCallback((taskId, fn) => {
    setState(prev => {
      if (!prev) return prev;
      const next = { ...prev, tasks: prev.tasks.map(t => (t.id === taskId ? { ...t, parts: t.parts.map(p => ({ ...p })), sources: [...t.sources] } : t)) };
      const task = next.tasks.find(t => t.id === taskId);
      if (task) fn(task);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const data = await api('/api/bootstrap');
    const settings = await window.desk.settings();
    setState({ ...data, settings });
    setProjectId(prev => (data.projects.some(p => p.id === prev) ? prev : data.projects[0]?.id));
  }, []);

  const watch = useCallback(taskId => {
    if (streams.current.has(taskId)) return;
    const controller = new AbortController();
    streams.current.set(taskId, controller);
    setSuspendedTasks(prev => (prev[taskId] ? { ...prev, [taskId]: false } : prev));
    void watchTask({
      taskId,
      signal: controller.signal,
      getTask: () => stateRef.current?.tasks.find(t => t.id === taskId),
      onEvent: events => updateTask(taskId, task => { for (const event of events) applyStreamEvent(task, event); }),
      onSettled: () => { streams.current.delete(taskId); void reload().catch(report); },
      onSuspended: () => { streams.current.delete(taskId); setSuspendedTasks(prev => ({ ...prev, [taskId]: true })); toast('任务订阅中断，可手动重新连接'); }
    });
  }, [reload, report, toast, updateTask]);

  const reconnect = useCallback(taskId => {
    streams.current.get(taskId)?.abort();
    streams.current.delete(taskId);
    void reload().catch(report).then(() => watch(taskId));
  }, [reload, report, watch]);

  // focus / 网络恢复时复活挂起的订阅（对齐 ClawsGO revive 行为）。
  useEffect(() => {
    const revive = () => {
      for (const [taskId, suspended] of Object.entries(suspendedTasks)) {
        if (!suspended) continue;
        const task = stateRef.current?.tasks.find(t => t.id === taskId);
        if (task && !finished(task)) reconnect(taskId);
      }
    };
    window.addEventListener('focus', revive);
    window.addEventListener('online', revive);
    return () => { window.removeEventListener('focus', revive); window.removeEventListener('online', revive); };
  }, [suspendedTasks, reconnect]);

  // 启动：初始化会话并订阅所有未结束任务。
  useEffect(() => {
    (async () => {
      await initSession();
      await reload();
      document.body.dataset.ready = 'true';
      for (const task of stateRef.current?.tasks.filter(t => !finished(t)) || []) watch(task.id);
      if (stateRef.current?.settings?.warning) toast(stateRef.current.settings.warning);
    })().catch(error => setLoadError(error?.message || String(error)));
    const controllers = streams.current;
    return () => { for (const c of controllers.values()) c.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reload 后新出现的未结束任务（例如刚提交）也要订阅。
  useEffect(() => {
    for (const task of state?.tasks.filter(t => !finished(t)) || []) watch(task.id);
  }, [state, watch]);

  const focusSource = useCallback(id => { setPanel('sources'); setFocusSourceId(id); }, []);
  const value = {
    state, projectId, setProjectId, reload, report, toast, toastMessage,
    panel, setPanel, focusSource, focusSourceId, setFocusSourceId,
    suspendedTasks, reconnect, watch,
    dialog, setDialog, loadError, api, getSession
  };
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
