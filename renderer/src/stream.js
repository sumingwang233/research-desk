import { parseSSE } from '../../shared/sse.mjs';
import { getSession } from './api.js';
import { finished } from './parts.js';

// 对齐 ClawsGO useConversationStream：1/2/5/10/30 秒基准退避 ×0.7–1.3 抖动；用尽后挂起，由 focus/online 或手动重连复活。
// 事件 40ms 合帧批处理；55s 无事件视为停滞，中断当前连接并按退避重连。
const BACKOFF = [1000, 2000, 5000, 10000, 30000];
const MAX_RETRIES = 6;
const BATCH_MS = 40;
const WATCHDOG_MS = 55000;
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});

export async function watchTask({ taskId, getTask, onEvent, onSettled, onSuspended, signal }) {
  let retries = 0;
  // 40ms 合帧：高频 part-delta 合并为一次渲染提交；拉取下一段前强制同步冲刷，避免 sequence 竞态
  let queue = [], flushTimer = null;
  const flush = () => { clearTimeout(flushTimer); flushTimer = null; const batch = queue; queue = []; if (batch.length) onEvent(batch); };
  const enqueue = event => { queue.push(event); if (!flushTimer) flushTimer = setTimeout(flush, BATCH_MS); };
  while (!signal.aborted) {
    flush();
    const current = getTask();
    if (!current || finished(current)) { onSettled?.(); return; }
    // 55s 看门狗：每段连接独立计时；超时中断当前连接并按退避重连
    const leg = new AbortController();
    let watchdog = null;
    const resetWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => leg.abort(new Error('任务连接停滞')), WATCHDOG_MS); };
    try {
      const session = getSession();
      const response = await fetch(`${session.origin}/api/tasks/${taskId}/events?after=${current.sequence}`, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.any([signal, leg.signal]) });
      if (!response.ok) throw new Error('任务连接暂时中断');
      resetWatchdog();
      for await (const raw of parseSSE(response.body)) {
        resetWatchdog();
        enqueue(JSON.parse(raw));
        retries = 0;
      }
    } catch (error) {
      clearTimeout(watchdog);
      if (signal.aborted) { flush(); return; }
      if (++retries > MAX_RETRIES) { flush(); onSuspended?.(); return; }
      try { await sleep(BACKOFF[Math.min(retries - 1, BACKOFF.length - 1)] * (0.7 + Math.random() * 0.6), signal); }
      catch { flush(); return; }
    } finally { clearTimeout(watchdog); }
  }
  flush();
}
