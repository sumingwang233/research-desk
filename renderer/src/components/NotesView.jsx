import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDesk } from '../store.jsx';

export function NotesView() {
  const { state, projectId, reload, report, toast, setDialog } = useDesk();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get('note'));
  const notes = (state?.notes || []).filter(n => n.projectId === projectId).toReversed();
  const note = notes.find(n => n.id === selected) || notes[0];

  const importNote = async () => {
    if (!projectId) { setDialog({ kind: 'project', edit: false }); return; }
    const created = await window.desk.importNote(projectId);
    if (created) { setSelected(created.id); await reload(); toast('笔记已导入'); }
  };
  const exportNote = async () => {
    if (await window.desk.exportNote(note.id)) toast('笔记已导出');
  };

  return (
    <section id="notes-view" className="main-view notes-view">
      <div className="view-heading">
        <div><h1>研究笔记</h1><p>保留研究脉络，让证据和想法接得上。</p></div>
        <button id="import-note" className="secondary" onClick={() => importNote().catch(report)}>导入笔记</button>
      </div>
      <div className="note-layout">
        <div id="notes-list" className="notes-list">
          {notes.map(n => (
            <button key={n.id} className={`note-item${n.id === note?.id ? ' selected' : ''}`} onClick={() => setSelected(n.id)}>{n.title}</button>
          ))}
        </div>
        <article id="note-reader" className="note-reader">
          {!note
            ? <div className="large-empty">导入已有的 Markdown / 文本笔记，或让研究助理整理一份新笔记。</div>
            : (
              <>
                <div className="note-heading">
                  <h2>{note.title}</h2>
                  <button className="secondary" onClick={() => exportNote().catch(report)}>导出 Markdown</button>
                </div>
                <p className="note-date">{new Date(note.createdAt).toLocaleString('zh-CN')}</p>
                <pre className="note-content">{note.content}</pre>
              </>
            )}
        </article>
      </div>
    </section>
  );
}
