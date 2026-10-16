import { useEffect, useRef, useState } from 'react';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';

function useDialog() {
  const ref = useRef(null);
  const { setDialog } = useDesk();
  useEffect(() => { ref.current?.showModal(); }, []);
  const close = () => { ref.current?.close(); setDialog(null); };
  return { ref, close };
}

export function ProjectDialog({ edit }) {
  const { state, projectId, setProjectId, reload, report, setDialog } = useDesk();
  const { ref, close } = useDialog();
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
      setProjectId(saved.id);
      close();
      await reload();
    } catch (error) { report(error); }
  };

  return (
    <dialog id="project-dialog" ref={ref} onClose={() => setDialog(null)}>
      <form id="project-form" onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="project-dialog-title">{edit ? '编辑研究项目' : '新建研究项目'}</h2>
          <button type="button" className="icon-button close-dialog" aria-label="关闭" onClick={close}>×</button>
        </div>
        <label>项目名称<input id="project-input" name="project-input" maxLength="100" placeholder="例如：人机协作中的信任校准" defaultValue={edit ? project?.name : ''} required /></label>
        <label>研究方向 <span className="optional">选填</span><textarea id="direction-input" name="direction-input" rows="3" maxLength="1000" placeholder="研究领域、对象和已有背景" defaultValue={edit ? project?.direction : ''}></textarea></label>
        <label>本地文件夹 <span className="optional">选填</span>
          <div className="workdir-row">
            <input name="workdir-input" value={workdir} readOnly placeholder="研究资料所在目录；研究助理只读访问" />
            <button type="button" className="secondary" onClick={pick}>选择…</button>
            {workdir && <button type="button" className="icon-button" aria-label="清除文件夹" onClick={() => setWorkdir('')}>×</button>}
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

export function SettingsDialog() {
  const { state, reload, report, toast, setDialog } = useDesk();
  const { ref, close } = useDialog();
  const [storage, setStorage] = useState('');
  const config = state?.settings || {};

  useEffect(() => {
    window.desk.settings().then(fresh => {
      setStorage(fresh.encryptedStorage
        ? `密钥使用系统加密后保存在本机。${fresh.apiKeyConfigured ? '已配置 key；留空可保留。' : '尚未配置 key。'}`
        : '系统加密不可用，key 仅在本次应用运行期间保留。');
    }).catch(() => {});
  }, []);

  const [provider, setProvider] = useState(config.provider || 'openai-compatible');

  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget.elements;
    try {
      await window.desk.saveSettings({
        provider: form['provider-input'].value,
        endpoint: form['provider-input'].value === 'mock' ? 'mock://replay' : form['endpoint-input']?.value || '',
        model: form['model-input'].value,
        apiKey: form['key-input'].value,
        clearKey: form['clear-key'].checked,
        maxRounds: Number(form['rounds-input'].value),
        effort: form['effort-input'].value
      });
      close();
      await reload();
      toast('模型设置已保存');
    } catch (error) { report(error); }
  };

  return (
    <dialog id="settings-dialog" ref={ref} onClose={() => setDialog(null)}>
      <form id="settings-form" onSubmit={submit}>
        <div className="dialog-heading">
          <div><h2>模型设置</h2><p>连接兼容 Chat Completions 的模型服务；离线验证可填 mock://replay</p></div>
          <button type="button" className="icon-button close-dialog" aria-label="关闭" onClick={close}>×</button>
        </div>
        <label>供应商<select id="provider-input" name="provider-input" defaultValue={config.provider || 'openai-compatible'} onChange={event => setProvider(event.target.value)}>
          <option value="openai-compatible">OpenAI 兼容端点（自定义地址）</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
          <option value="mock">本地回放（离线验证，不联网）</option>
        </select></label>
        {provider === 'openai-compatible' && (
          <label>接口地址<input id="endpoint-input" name="endpoint-input" placeholder="https://your-provider.example/v1" required maxLength="500" defaultValue={config.endpoint || ''} /></label>
        )}
        {provider !== 'openai-compatible' && provider !== 'mock' && (
          <p className="dialog-help">使用 {provider} 官方默认地址；模型 ID 按供应商目录手填。</p>
        )}
        {provider === 'mock' && <p className="dialog-help">本地回放产出确定性的模拟研究流程，用于离线验证界面；输出明确标记为本地模拟。</p>}
        <label>模型名称<input id="model-input" name="model-input" placeholder="填写服务商提供的模型 ID" required maxLength="200" defaultValue={config.model || ''} /></label>
        {provider !== 'mock' && (
          <label>API key<input id="key-input" name="key-input" type="password" autoComplete="off" placeholder="留空保留当前 key" maxLength="4096" /></label>
        )}
        <label className="checkbox-row"><input id="clear-key" name="clear-key" type="checkbox" />清除已保存 key（本地模型可不需要）</label>
        <div className="form-row">
          <label>最多模型轮次<input id="rounds-input" name="rounds-input" type="number" min="1" max="20" defaultValue={config.maxRounds || 8} required /></label>
          <label>推理强度<select id="effort-input" name="effort-input" defaultValue={config.effort || ''}>
            <option value="">由模型决定</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select></label>
        </div>
        <p id="key-storage" className="dialog-help">{storage}</p>
        <p className="dialog-help">保存设置不会调用模型。实际运行可能产生服务商费用；本机 HTTP 模型与 mock:// 本地回放也受支持。</p>
        <div className="dialog-actions">
          <button type="button" className="secondary close-dialog" onClick={close}>取消</button>
          <button className="primary">保存设置</button>
        </div>
      </form>
    </dialog>
  );
}
