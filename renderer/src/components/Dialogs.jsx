import { useEffect, useRef, useState } from 'react';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';
import { CloseIcon, ChevronRightIcon, FolderIcon } from './ui/icons.jsx';
import { ProviderPicker } from './ProviderPicker.jsx';

function useDialog() {
  const ref = useRef(null);
  const { setDialog } = useDesk();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    /* showModal 会把焦点交给第一个可聚焦元素（往往是关闭键），这里改投给第一个输入字段 */
    const first = el.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select');
    first?.focus();
  }, []);

  /* 退场：先挂 data-closing 跑 150ms 动画，再真正 close，避免弹窗硬消失。
     旧实例的 finish 可能晚于新实例挂载（保存后立刻重开），此时节点已从文档移除，
     不能再调 setDialog(null)，否则会把新开的弹窗一并清掉。 */
  const close = () => {
    const el = ref.current;
    if (!el || !el.open) { setDialog(null); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (!el.isConnected) return;
      el.close();
      setDialog(null);
    };
    el.dataset.closing = 'true';
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 200);
  };

  /* 点遮罩关闭（只认落在 dialog 本体上的点击） */
  const onPointerDown = event => { if (event.target === ref.current) close(); };

  return { ref, close, onPointerDown };
}

export function ProjectDialog({ edit }) {
  const { state, projectId, setProjectId, reload, report, setDialog } = useDesk();
  const { ref, close, onPointerDown } = useDialog();
  const project = state?.projects.find(p => p.id === projectId);
  const [workdir, setWorkdir] = useState(edit ? project?.workdir || '' : '');

  const pick = async () => {
    const dir = await window.desk.pickDirectory().catch(() => null);
    if (dir) setWorkdir(dir);
  };
  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget.elements;
    try {
      const saved = await api('/api/projects', {
        ...(edit ? { id: projectId } : {}),
        name: form['project-input'].value,
        direction: form['direction-input'].value,
        workdir
      });
      /* 先关再换选中项目：key 里只留 dialog.nonce，但项目切换仍会触发重渲染，
         先走关闭动画能保证退场不被新一轮渲染打断。 */
      close();
      setProjectId(saved.id);
      await reload();
    } catch (error) { report(error); }
  };

  return (
    <dialog id="project-dialog" ref={ref} onClose={() => setDialog(null)} onCancel={event => { event.preventDefault(); close(); }} onPointerDown={onPointerDown}>
      <form id="project-form" onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="project-dialog-title">{edit ? '编辑研究项目' : '新建研究项目'}</h2>
          <button type="button" className="icon-button close-dialog" aria-label="关闭" onClick={close}><CloseIcon size={14} /></button>
        </div>
        <label>项目名称<input id="project-input" name="project-input" maxLength="100" placeholder="例如：人机协作中的信任校准" defaultValue={edit ? project?.name : ''} autoFocus required /></label>
        <label>研究方向 <span className="optional">选填</span><textarea id="direction-input" name="direction-input" rows="3" maxLength="1000" placeholder="研究领域、对象和已有背景" defaultValue={edit ? project?.direction : ''}></textarea></label>
        <label>本地文件夹 <span className="optional">选填</span>
          <div className="workdir-row">
            <input id="workdir-input" name="workdir-input" value={workdir} readOnly placeholder="研究资料所在目录；研究助理只读访问" />
            <button type="button" id="pick-workdir" className="secondary" onClick={pick}>
              <FolderIcon size={12} />
              <span>选择…</span>
            </button>
            {workdir && <button type="button" className="icon-button" aria-label="清除文件夹" data-tip="清除" onClick={() => setWorkdir('')}><CloseIcon size={13} /></button>}
          </div>
        </label>
        <p className="dialog-help">每个项目独立整理会话、文献和笔记。绑定文件夹后，研究助理可列出并读取其中的 Markdown / 文本 / CSV / JSON 资料；批准保存的笔记会同步一份到该目录的 research-notes/。</p>
        <div className="dialog-actions">
          <button type="button" className="secondary close-dialog" onClick={close}>取消</button>
          <button className="primary">保存项目</button>
        </div>
      </form>
    </dialog>
  );
}

const THINKING_LEVELS = [
  ['off', '关闭'],
  ['minimal', '极简'],
  ['low', '低'],
  ['medium', '中'],
  ['high', '高'],
  ['xhigh', '很高'],
  ['max', '最高']
];

/**
 * 思考等级映射
 *
 * 三态照 pi-web：默认（不写键，用供应商/目录默认）、禁用（null，不让这一档生效）、
 * 自定义（写一个该供应商认的字符串）。映射是「模型」级属性，不是请求参数。
 */
function ThinkingMap({ value, onChange }) {
  const touched = Object.keys(value).length;
  // 默认收起：展开后表单会超出弹窗可视高度，折叠时用计数角标提示已改动
  const [open, setOpen] = useState(false);
  const modeOf = level => {
    const entry = value[level];
    if (entry === undefined) return 'default';
    if (entry === null) return 'disabled';
    return 'custom';
  };

  const setMode = (level, mode) => {
    const next = { ...value };
    if (mode === 'default') delete next[level];
    else if (mode === 'disabled') next[level] = null;
    else next[level] = typeof next[level] === 'string' ? next[level] : '';
    onChange(next);
  };

  return (
    <section className="thinking-map">
      <div className="thinking-map-head">
        <button
          type="button"
          className="thinking-toggle"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          <ChevronRightIcon className={`fold-chev${open ? ' is-open' : ''}`} size={11} />
          <span>思考等级映射</span>
          {touched > 0 && <span className="thinking-count">{touched} 项自定义</span>}
        </button>
        {touched > 0 && open && (
          <button type="button" className="text-button" onClick={() => onChange({})}>全部恢复默认</button>
        )}
      </div>
      {open && (
        <>
          <p className="dialog-help">把内部档位映射到该供应商认的取值；「禁用」表示不让这一档生效。</p>
          <div className="thinking-rows">
            {THINKING_LEVELS.map(([level, label]) => {
              const mode = modeOf(level);
              return (
                <div className="thinking-row" key={level}>
                  <span className="thinking-label">{label}<code>{level}</code></span>
                  <select
                    className="thinking-mode"
                    aria-label={`${label}档映射`}
                    data-level={level}
                    value={mode}
                    onChange={event => setMode(level, event.target.value)}
                  >
                    <option value="default">默认</option>
                    <option value="disabled">禁用</option>
                    <option value="custom">自定义</option>
                  </select>
                  {mode === 'custom'
                    ? (
                      <input
                        className="thinking-value"
                        aria-label={`${label}档自定义值`}
                        value={typeof value[level] === 'string' ? value[level] : ''}
                        maxLength={40}
                        placeholder="如 high"
                        onChange={event => onChange({ ...value, [level]: event.target.value })}
                      />
                    )
                    : <span className="thinking-slot" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function SettingsDialog() {
  const { state, reload, report, toast, setDialog } = useDesk();
  const { ref, close, onPointerDown } = useDialog();
  const config = state?.settings || {};

  const [storage, setStorage] = useState('');
  const [provider, setProvider] = useState(config.provider || 'custom');
  const [endpoint, setEndpoint] = useState(config.endpoint || '');
  const [model, setModel] = useState(config.model || '');
  const [effort, setEffort] = useState(config.effort || '');
  const [thinkingMap, setThinkingMap] = useState(config.thinkingLevelMap || {});
  const [picking, setPicking] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [models, setModels] = useState([]);
  const pickerRef = useRef(null);

  /* 供应商选择器用独立 <dialog>：原生 dialog 处于 top layer，普通浮层会被它遮住；
     而 dialog 自身的 transform 动画又会把 fixed 子元素当成容器裁剪。 */
  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    if (picking && !el.open) el.showModal();
    if (!picking && el.open) el.close();
  }, [picking]);

  useEffect(() => {
    window.desk.settings().then(fresh => {
      setStorage(fresh.encryptedStorage
        ? `密钥使用系统加密后保存在本机。${fresh.apiKeyConfigured ? '已配置 key；留空可保留。' : '尚未配置 key。'}`
        : '系统加密不可用，key 仅在本次应用运行期间保留。');
    }).catch(() => {});
    // 内置供应商清单来自本地服务的 pi-ai 目录，不在前端写死
    api('/api/providers').then(data => setCatalog(data.providers || [])).catch(() => setCatalog([]));
  }, []);

  const builtin = provider !== 'custom' && provider !== 'mock';
  const entry = (catalog || []).find(item => item.id === provider);

  useEffect(() => {
    if (!builtin) { setModels([]); return undefined; }
    let alive = true;
    api(`/api/providers/${provider}/models`)
      .then(data => { if (alive) setModels(data.models || []); })
      .catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider, builtin]);

  // 换供应商时，旧模型若不在新目录里就落到第一个；首次打开则保留已存的值
  const lastProvider = useRef(provider);
  useEffect(() => {
    if (!builtin || !models.length) return;
    const switched = lastProvider.current !== provider;
    lastProvider.current = provider;
    if (!switched) return;
    setModel(previous => (models.some(item => item.id === previous) ? previous : models[0].id));
  }, [models, builtin, provider]);

  const pick = id => {
    setPicking(false);
    setProvider(id);
    if (id === 'custom' || id === 'mock') setModels([]);
    // 本地回放没有目录，给一个可提交的默认模型名
    if (id === 'mock') setModel('本地回放');
  };

  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget.elements;
    try {
      await window.desk.saveSettings({
        provider,
        endpoint: provider === 'mock' ? 'mock://replay' : provider === 'custom' ? endpoint : '',
        model,
        apiKey: form['key-input']?.value || '',
        clearKey: form['clear-key']?.checked || provider === 'mock',
        maxRounds: Number(form['rounds-input'].value),
        effort,
        thinkingLevelMap: thinkingMap
      });
      close();
      await reload();
      toast('模型设置已保存');
    } catch (error) { report(error); }
  };

  const selectedModel = models.find(item => item.id === model);
  const providerLabel = provider === 'custom' ? '自定义端点'
    : provider === 'mock' ? '本地回放'
      : entry?.name || provider;

  return (
    <>
      <dialog id="settings-dialog" ref={ref} onClose={() => setDialog(null)} onCancel={event => { event.preventDefault(); close(); }} onPointerDown={onPointerDown}>
        <form id="settings-form" onSubmit={submit}>          <div className="dialog-heading">
            <div><h2>模型设置</h2><p>选择一个内置供应商，或用自定义端点接入兼容服务。</p></div>
            <button type="button" className="icon-button close-dialog" aria-label="关闭" onClick={close}><CloseIcon size={14} /></button>
          </div>

          <input id="provider-input" type="hidden" value={provider} readOnly />

          <div className="provider-row">
            <div className="provider-row-main">
              <span className="provider-row-kicker">供应商</span>
              <strong>{providerLabel}</strong>
              <span className="provider-row-note">
                {provider === 'custom' ? '自填地址 · OpenAI 兼容'
                  : provider === 'mock' ? '离线验证 · 不联网'
                    : `${entry?.baseUrl || '正在读取目录…'}${entry ? ` · ${entry.modelCount} 个模型` : ''}`}
              </span>
            </div>
            <button type="button" id="pick-provider" className="secondary" onClick={() => setPicking(true)}>更换</button>
          </div>

          {provider === 'custom' && (
            <label>接口地址
              <input id="endpoint-input" name="endpoint-input" placeholder="https://your-provider.example/v1" required maxLength="500"
                value={endpoint} onChange={event => setEndpoint(event.target.value)} />
            </label>
          )}

          {provider === 'mock' && (
            <p className="dialog-help">本地回放产出确定性的模拟研究流程，用于离线验证界面；输出明确标记为本地模拟。</p>
          )}

          <label>{builtin ? '模型' : '模型名称'}
            <input id="model-input" name="model-input" list={builtin ? 'model-options' : undefined}
              placeholder={builtin ? '从目录中选择，或手填模型 ID' : '填写服务商提供的模型 ID'}
              required maxLength="200" value={model} onChange={event => setModel(event.target.value)} />
          </label>
          {builtin && (
            <datalist id="model-options">
              {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </datalist>
          )}
          {builtin && selectedModel && (
            <p className="dialog-help model-meta">
              {selectedModel.name}
              {selectedModel.contextWindow ? ` · 上下文 ${Math.round(selectedModel.contextWindow / 1000)}k` : ''}
              {selectedModel.maxTokens ? ` · 最大输出 ${Math.round(selectedModel.maxTokens / 1000)}k` : ''}
              {selectedModel.reasoning ? ' · 支持推理' : ''}
            </p>
          )}

          {provider !== 'mock' && (
            <label>API key<input id="key-input" name="key-input" type="password" autoComplete="off" placeholder="留空保留当前 key" maxLength="4096" /></label>
          )}
          <label className="checkbox-row"><input id="clear-key" name="clear-key" type="checkbox" />清除已保存 key（本机无鉴权服务可不需要）</label>

          <div className="form-row">
            <label>最多模型轮次<input id="rounds-input" name="rounds-input" type="number" min="1" max="20" defaultValue={config.maxRounds || 8} required /></label>
            <label>推理强度
              <select id="effort-input" name="effort-input" value={effort} onChange={event => setEffort(event.target.value)}>
                <option value="">不干预（由模型决定）</option>
                <option value="minimal">极简</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="xhigh">很高</option>
                <option value="max">最高</option>
              </select>
            </label>
          </div>

          <ThinkingMap value={thinkingMap} onChange={setThinkingMap} />

          <p id="key-storage" className="dialog-help">{storage}</p>
          <p className="dialog-help">保存设置不会调用模型。实际运行可能产生服务商费用；本机 HTTP 模型与本地回放也受支持。</p>
          <div className="dialog-actions">
            <button type="button" className="secondary close-dialog" onClick={close}>取消</button>
            <button className="primary">保存设置</button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={pickerRef}
        className="picker-dialog"
        aria-label="选择模型供应商"
        onClose={() => setPicking(false)}
        onCancel={event => { event.preventDefault(); setPicking(false); }}
        onClick={event => { if (event.target === pickerRef.current) setPicking(false); }}
      >
        <ProviderPicker
          providers={catalog || []}
          current={provider}
          onPick={pick}
        />
      </dialog>
    </>
  );
}
