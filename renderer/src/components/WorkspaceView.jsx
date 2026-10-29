import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDesk } from '../store.jsx';
import { Button } from './ui/Button.jsx';
import { Markdown } from './Markdown.jsx';
import { ChevronRightIcon, FileIcon, FolderIcon, SaveIcon } from './ui/icons.jsx';

const MonacoPane = lazy(() => import('./MonacoPane.jsx'));
const PdfPane = lazy(() => import('./PdfPane.jsx'));

const LANGUAGE = {
  '.md': 'markdown', '.markdown': 'markdown', '.py': 'python', '.r': 'r',
  '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'shell',
  '.js': 'javascript', '.mjs': 'javascript', '.json': 'javascript', '.jsonl': 'javascript', '.ts': 'javascript'
};
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function buildTree(entries) {
  const nodes = new Map();
  for (const entry of entries) nodes.set(entry.path, { ...entry, children: [] });
  const roots = [];
  for (const entry of entries) {
    const node = nodes.get(entry.path);
    const slash = entry.path.lastIndexOf('/');
    const parent = slash < 0 ? null : nodes.get(entry.path.slice(0, slash));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function TreeRow({ node, depth, selected, onPick, collapsed, onToggle }) {
  const indent = 8 + depth * 12;
  if (node.kind === 'dir') {
    const open = !collapsed.has(node.path);
    return (
      <>
        <button type="button" className="tree-row" style={{ paddingLeft: indent }} aria-expanded={open} onClick={() => onToggle(node.path)}>
          <ChevronRightIcon className="tree-chev" size={11} data-open={open} />
          <FolderIcon size={12} />
          <span className="tree-name">{node.name}</span>
        </button>
        {open && node.children.map(child => (
          <TreeRow key={child.path} node={child} depth={depth + 1} selected={selected} onPick={onPick} collapsed={collapsed} onToggle={onToggle} />
        ))}
      </>
    );
  }
  return (
    <button type="button" className={`tree-row file${selected === node.path ? ' selected' : ''}`} style={{ paddingLeft: indent + 15 }} onClick={() => onPick(node)}>
      <FileIcon size={12} />
      <span className="tree-name">{node.name}</span>
    </button>
  );
}

/**
 * 工作区：左侧目录树，右侧编辑器 / PDF
 *
 * 这里能做的最重的事是覆盖用户磁盘上的文件，所以写入口只有一个「保存」，
 * 快捷键同样是显式保存；保存成功后原文件已被主进程备份成 .bak。
 */
export function WorkspaceView() {
  const { state, projectId, setDialog, toast, report } = useDesk();
  const project = state?.projects.find(item => item.id === projectId);
  const workdir = project?.workdir || '';

  const [tree, setTree] = useState(null);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const imageUrlRef = useRef('');

  const refresh = useCallback(async () => {
    if (!workdir) { setTree(null); return; }
    try { setTree(await window.desk.listWorkspace(projectId)); setError(''); }
    catch (cause) { setError(cause.message || '无法读取项目文件夹'); setTree(null); }
  }, [projectId, workdir]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => () => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); }, []);

  const roots = useMemo(() => (tree ? buildTree(tree.entries) : []), [tree]);

  const openFile = async node => {
    setSelected(node.path);
    setDirty(false);
    setPreview(false);
    setFile(null);
    setLoadingFile(true);
    try {
      if (node.ext === '.pdf') {
        const data = await window.desk.readWorkspaceBinary(projectId, node.path);
        setFile({ kind: 'pdf', bytes: data.bytes, name: data.name });
      } else if (IMAGE.has(node.ext)) {
        const data = await window.desk.readWorkspaceBinary(projectId, node.path);
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = URL.createObjectURL(new Blob([data.bytes]));
        setFile({ kind: 'image', url: imageUrlRef.current, name: data.name });
      } else {
        const data = await window.desk.readWorkspaceFile(projectId, node.path);
        setFile({ kind: 'text', name: data.name, mtime: data.mtime });
        setDraft(data.text);
      }
    } catch (cause) { report(cause); setSelected(''); }
    finally { setLoadingFile(false); }
  };

  const save = async text => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await window.desk.saveWorkspaceFile(projectId, selected, text);
      setDirty(false);
      toast(result.unchanged ? '没有需要保存的改动' : `已保存，原文件备份为 ${result.backup}`);
      void refresh();
    } catch (cause) { report(cause); }
    finally { setSaving(false); }
  };

  if (!workdir) {
    return (
      <section className="main-view workspace-view">
        <div className="workspace-empty">
          <FolderIcon size={22} />
          <p>这个项目还没有绑定本地文件夹。</p>
          <p className="workspace-hint">绑定后可以在这里直接编辑 Markdown、代码与数据文件，也能整篇阅读 PDF。</p>
          <Button variant="primary" onClick={() => setDialog({ kind: 'project', edit: true })}>绑定文件夹</Button>
        </div>
      </section>
    );
  }

  const language = LANGUAGE[selected.slice(selected.lastIndexOf('.')).toLowerCase()] || 'plaintext';
  const isMarkdown = /\.(md|markdown)$/i.test(selected);

  return (
    <section className="main-view workspace-view">
      <aside className="tree-pane" aria-label="项目文件">
        <div className="tree-head">
          <span>项目文件</span>
          <button type="button" className="text-button" onClick={() => void refresh()}>刷新</button>
        </div>
        {error && <p className="tree-error">{error}</p>}
        {!error && !tree && <p className="tree-empty">读取中…</p>}
        {!error && tree && !tree.entries.length && <p className="tree-empty">这个文件夹里没有可打开的文件</p>}
        {!error && tree && tree.entries.length > 0 && roots.map(node => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            selected={selected}
            onPick={openFile}
            collapsed={collapsed}
            onToggle={path => setCollapsed(prev => {
              const next = new Set(prev);
              if (next.has(path)) next.delete(path); else next.add(path);
              return next;
            })}
          />
        ))}
        {tree?.truncated && <p className="tree-empty">文件较多，只列出前 600 项</p>}
      </aside>

      <div className="file-pane">
        {!selected && (
          <div className="workspace-empty inline">
            <FileIcon size={20} />
            <p>从左侧选一个文件</p>
            <p className="workspace-hint">Markdown 与代码可以直接编辑保存，PDF 在右侧整篇阅读。</p>
          </div>
        )}
        {selected && (
          <div className="editor-bar">
            <span className="editor-path" title={selected}>{selected}</span>
            {dirty && <span className="editor-dirty">未保存</span>}
            <div className="editor-actions">
              {file?.kind === 'text' && isMarkdown && (
                <button type="button" className="text-button" onClick={() => setPreview(value => !value)}>{preview ? '回到编辑' : '预览'}</button>
              )}
              {file?.kind === 'text' && (
                <Button variant="primary" disabled={!dirty || saving} onClick={() => void save(draft)}>
                  <SaveIcon size={12} />
                  <span>{saving ? '保存中' : '保存'}</span>
                </Button>
              )}
            </div>
          </div>
        )}
        {loadingFile && <div className="viewer-note">打开中…</div>}
        {file?.kind === 'text' && !preview && (
          <Suspense fallback={<div className="viewer-note">准备编辑器…</div>}>
            <MonacoPane
              path={selected}
              language={language}
              value={draft}
              onChange={next => { setDraft(next); setDirty(true); }}
              onSave={text => void save(text)}
            />
          </Suspense>
        )}
        {file?.kind === 'text' && preview && <div className="md-preview"><Markdown content={draft} /></div>}
        {file?.kind === 'pdf' && (
          <Suspense fallback={<div className="viewer-note">准备阅读器…</div>}>
            <PdfPane bytes={file.bytes} name={file.name} />
          </Suspense>
        )}
        {file?.kind === 'image' && <div className="image-preview"><img src={file.url} alt={file.name} /></div>}
      </div>
    </section>
  );
}
