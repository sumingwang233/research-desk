import { useEffect, useRef, useState } from 'react';
import { SteerIcon, StopIcon, SubmitIcon } from './ui/icons.jsx';

/**
 * 输入区
 *
 * 发送键三态（对齐 HanaAgent desktop/src/react/components/input/SendButton）：
 *   空闲        → 发送（实心青蓝，向上箭头）
 *   研究中+有字  → 插话（描边青蓝，折返箭头）
 *   研究中+无字  → 停止（描边珊瑚，实心方）
 * 三态挂在同一个 keyed 容器里，切换时走 150ms 入场，而不是硬切。
 * 输入内容保持非受控（既有测试脚本直接写 textarea.value 后提交），
 * 只用一个长度标记驱动按钮态。
 */
export function Composer({ activeTask, onSubmit, onStop, onInterrupt, reportError }) {
  const inputRef = useRef(null);
  const modeRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [hasInput, setHasInput] = useState(false);

  const resize = el => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = event => {
    event.preventDefault();
    const text = inputRef.current.value.trim();
    if (!text || sending) return;
    const mode = modeRef.current.value;
    setSending(true);
    Promise.resolve()
      .then(() => onSubmit(text, mode))
      .then(() => {
        if (inputRef.current) {
          inputRef.current.value = '';
          inputRef.current.style.height = '';
        }
        setHasInput(false);
      })
      .catch(reportError)
      .finally(() => setSending(false));
  };
  const interrupt = () => {
    const text = inputRef.current.value.trim();
    if (!text) return;
    inputRef.current.value = '';
    inputRef.current.style.height = '';
    setHasInput(false);
    Promise.resolve().then(() => onInterrupt(text, modeRef.current.value)).catch(reportError);
  };
  const stop = () => Promise.resolve().then(onStop).catch(reportError);

  const mode = activeTask ? (hasInput ? 'steer' : 'stop') : 'send';

  /* 三态切换才做入场；首次挂载不淡化，避免主操作键在首帧看起来是禁用的 */
  const firstMode = useRef(true);
  const [modeTick, setModeTick] = useState(0);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    setModeTick(tick => tick + 1);
  }, [mode]);

  return (
    <form id="composer" className="composer" onSubmit={submit} data-mode={mode}>
      <label className="sr-only" htmlFor="question">研究问题</label>
      <textarea
        id="question"
        ref={inputRef}
        rows="1"
        maxLength="20000"
        placeholder={activeTask ? '研究进行中；提交将排队，或用「插话发送」打断当前研究' : '描述你的研究问题、已有线索或希望验证的假设…'}
        onInput={event => {
          resize(event.currentTarget);
          setHasInput(event.currentTarget.value.trim().length > 0);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.closest('form').requestSubmit();
          }
        }}
      />
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
          <span className="keyboard-hint">Enter 发送 · Shift+Enter 换行</span>
          <div className={`send-slot${modeTick ? ' is-switching' : ''}`} key={mode}>
            {mode === 'send' && (
              <button id="send-task" type="submit" className="send-btn" disabled={sending} aria-busy={sending || undefined}>
                <span className="send-label">
                  <SubmitIcon className="send-icon" size={13} />
                  <span>开始研究</span>
                </span>
              </button>
            )}
            {mode === 'steer' && (
              <>
                <button id="stop-task" type="button" className="send-btn stop-ghost" onClick={stop} aria-label="停止当前研究">停止</button>
                <button id="interrupt-task" type="button" className="send-btn is-steer" onClick={interrupt}>
                  <span className="send-label">
                    <SteerIcon className="send-icon" size={13} />
                    <span>插话发送</span>
                  </span>
                </button>
              </>
            )}
            {mode === 'stop' && (
              <button id="stop-task" type="button" className="send-btn is-streaming" onClick={stop}>
                <span className="send-label">
                  <StopIcon className="send-icon" size={12} />
                  <span>停止研究</span>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
