import { useRef, useState } from 'react';
import { useDesk } from '../store.jsx';
import { api } from '../api.js';

export function LibraryView() {
  const { state, projectId, reload, report, setDialog } = useDesk();
  const [searchResults, setSearchResults] = useState(null);
  const [status, setStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const queryRef = useRef(null);
  const projectSources = (state?.sources || []).filter(s => s.projectId === projectId);
  const papers = searchResults || projectSources;

  const search = async event => {
    event.preventDefault();
    if (!projectId) { setDialog({ kind: 'project', edit: false }); return; }
    setSearching(true); setStatus('正在检索…');
    try {
      const data = await api('/api/papers/search', { projectId, query: queryRef.current.value, limit: 8 });
      setSearchResults(data.sources);
      setStatus(`找到 ${data.sources.length} 条元数据`);
    } catch (error) { setStatus('检索未完成'); report(error); }
    finally { setSearching(false); }
  };
  const save = async paper => {
    await api('/api/papers/save', { projectId, sources: [paper] });
    await reload();
  };

  return (
    <section id="library-view" className="main-view library-view">
      <div className="view-heading">
        <div><h1>文献库</h1><p>检索公开学术元数据，为研究积累可追溯的来源。</p></div>
        <span className="subtle-tag">Crossref</span>
      </div>
      <form id="search-form" className="search-form" onSubmit={search}>
        <label className="sr-only" htmlFor="search-query">文献关键词</label>
        <input id="search-query" ref={queryRef} placeholder="论文标题、主题或研究关键词" maxLength="500" required />
        <button className="primary" id="search-button" disabled={searching}>检索文献</button>
      </form>
      <div className="library-subhead">
        <h2 id="library-heading">{searchResults ? '检索结果' : '项目文献'}</h2>
        <span id="search-status" role="status">{status}</span>
      </div>
      <div id="papers" className="papers">
        {searchResults && <button className="text-button" onClick={() => { setSearchResults(null); setStatus(''); }}>返回项目文献</button>}
        {!papers.length && <div className="large-empty">{searchResults ? '没有找到相关元数据。试试英文关键词或更具体的主题。' : '文献库还是空的。输入关键词，开始积累你的研究证据。'}</div>}
        {papers.map((paper, index) => {
          const saved = projectSources.some(s => (paper.doi ? s.doi === paper.doi : s.title === paper.title));
          return (
            <article className="paper-row" key={paper.id || paper.doi || index}>
              <div className="paper-year">{paper.year || '—'}</div>
              <div className="paper-info">
                <h3 className="paper-title">{paper.title}</h3>
                <p className="source-authors">{paper.authors || '作者未提供'}</p>
                <p className="paper-journal">{paper.journal || '公开学术元数据'}</p>
                {paper.abstract && <details><summary>摘要</summary><p className="abstract">{paper.abstract}</p></details>}
              </div>
              <div className="paper-actions">
                {searchResults && (
                  <button className="secondary" disabled={saved} onClick={() => save(paper).then(() => undefined).catch(report)}>
                    {saved ? '已保存' : '保存文献'}
                  </button>
                )}
                {paper.url && <button className="text-button" onClick={() => window.desk.openSource(paper.url)}>打开来源 ↗</button>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
