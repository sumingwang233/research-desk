import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from './ui/icons.jsx';

/**
 * 添加供应商面板
 *
 * 结构对齐 pi-web 的 Add provider picker：一个搜索框 + 分组卡片，
 * 而不是一个把所有选项压平的 <select>。分组顺序是刻意的——
 * 自定义端点排在最前（最常见），内置供应商按目录顺序，本地回放最后（仅验证用）。
 *
 * 内置供应商清单由本地服务从 pi-ai 目录读出，这里不写死任何厂商。
 */
const SPECIAL = [
  { id: 'custom', name: '自定义端点', note: 'OpenAI 兼容接口，自填地址', mark: '＋' },
  { id: 'mock', name: '本地回放', note: '离线验证，不联网', mark: '◌' }
];

function monogram(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase();
}

export function ProviderPicker({ providers, current, onPick }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, []);

  const query = search.trim().toLowerCase();
  const special = useMemo(
    () => SPECIAL.filter(item => !query || item.name.includes(query) || item.id.includes(query) || (item.note || '').toLowerCase().includes(query)),
    [query]
  );
  const builtin = useMemo(
    () => (providers || []).filter(entry => !query || entry.name.toLowerCase().includes(query) || entry.id.includes(query)),
    [providers, query]
  );
  const total = special.length + builtin.length;

  const card = entry => (
    <button
      type="button"
      key={entry.id}
      className={`provider-card${entry.id === current ? ' is-current' : ''}`}
      onClick={() => onPick(entry.id)}
    >
      <span className="provider-mark" aria-hidden="true">{entry.mark || monogram(entry.name)}</span>
      <span className="provider-body">
        <strong>{entry.name}</strong>
        <span>{entry.note || `${entry.modelCount} 个模型`}</span>
      </span>
      {entry.id === current && <span className="provider-flag">当前</span>}
    </button>
  );

  return (
    <div className="picker-shell">
      <div className="picker-search">
        <SearchIcon size={13} />
        <input
          ref={inputRef}
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="搜索供应商（Anthropic、DeepSeek、OpenRouter…）"
          aria-label="搜索供应商"
        />
      </div>
      <div className="picker-scroll">
        {total === 0 && <p className="picker-empty">没有匹配的供应商</p>}
        {special.length > 0 && (
          <section className="picker-group">
            <h3>自定义</h3>
            <div className="picker-grid">{special.map(card)}</div>
          </section>
        )}
        {builtin.length > 0 && (
          <section className="picker-group">
            <h3>内置供应商</h3>
            <div className="picker-grid">{builtin.map(card)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
