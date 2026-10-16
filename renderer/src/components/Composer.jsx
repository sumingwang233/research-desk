import { useRef, useState } from 'react';

export function Composer({ activeTask, onSubmit, onStop, onInterrupt, reportError }) {
  const inputRef = useRef(null);
  const modeRef = useRef(null);
  const [sending, setSending] = useState(false);

  const submit = event => {
    event.preventDefault();
    const text = inputRef.current.value.trim();
    if (!text || sending) return;
    const mode = modeRef.current.value;
    setSending(true);
    Promise.resolve()
      .then(() => onSubmit(text, mode))
      .then(() => { if (inputRef.current) inputRef.current.value = ''; })
      .catch(reportError)
      .finally(() => setSending(false));
  };
  const interrupt = () => {
    const text = inputRef.current.value.trim();
    if (!text) return;
    inputRef.current.value = '';
    Promise.resolve().then(() => onInterrupt(text, modeRef.current.value)).catch(reportError);
  };

  return (
    <form id="composer" className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="question">研究问题</label>
      <textarea id="question" ref={inputRef} rows="3" maxLength="20000"
        placeholder={activeTask ? '研究进行中；提交将排队，或用「打断并发送」' : '描述你的研究问题、已有线索或希望验证的假设…'}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.closest('form').requestSubmit();
          }
        }} />
      <div className="composer-footer">
        <label className="mode-control">
          <span>研究方式</span>
          <select id="mode" ref={modeRef} defaultValue="review">
            <option value="review">文献综述</option>
            <option value="plan">研究方案</option>
            <option value="free">自由研究</option>
          </select>
        </label>
        <div className="composer-actions">
          <span className="keyboard-hint">Enter 发送</span>
          {activeTask && <button id="interrupt-task" type="button" className="stop-button" onClick={interrupt}>打断并发送</button>}
          <button id="stop-task" type="button" className="stop-button" hidden={!activeTask}
            onClick={() => Promise.resolve().then(onStop).catch(reportError)}>
            停止任务
          </button>
          <button id="send-task" type="submit" className="primary" disabled={sending}>
            {activeTask ? '排队发送' : '开始研究'} <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
    </form>
  );
}
