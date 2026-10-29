import { useEffect, useRef, useState } from 'react';

/**
 * PDF 预览
 *
 * 用 pdf.js 把每一页画到 canvas。worker 走 pdfjs 自带的 .mjs，
 * 由 Vite 作为静态资源发出，主进程按 app:// 同源提供。
 *
 * 一页一个 canvas、整篇连续滚动：研究场景下更习惯通读而不是翻页器。
 */
export default function PdfPane({ bytes, name }) {
  const hostRef = useRef(null);
  const docRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [pages, setPages] = useState(0);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1.2);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      /* slice 一份：pdf.js 会把 buffer 转移给 worker，原引用会被 detach。
         cMapUrl 指向随包发出的 cmaps/，中文论文的非嵌入字体靠它解码。 */
      const doc = await pdfjs.getDocument({
        data: bytes.slice(),
        cMapUrl: new URL('/cmaps/', location.href).href,
        cMapPacked: true
      }).promise;
      if (cancelled) { doc.destroy(); return; }
      docRef.current = doc;
      setPages(doc.numPages);
      setStatus('ready');
    })().catch(cause => { if (!cancelled) { setError(cause.message || '无法解析这份 PDF'); setStatus('error'); } });
    return () => { cancelled = true; docRef.current?.destroy?.(); docRef.current = null; };
  }, [bytes]);

  useEffect(() => {
    if (status !== 'ready' || !docRef.current || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    host.textContent = '';
    (async () => {
      const doc = docRef.current;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let index = 1; index <= doc.numPages; index += 1) {
        if (cancelled) return;
        const page = await doc.getPage(index);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const label = document.createElement('span');
        label.className = 'pdf-page-number';
        label.textContent = `${index} / ${doc.numPages}`;
        host.append(canvas, label);
        const context = canvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: context, canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      }
    })().catch(cause => { if (!cancelled) setError(cause.message || '渲染失败'); });
    return () => { cancelled = true; };
  }, [status, scale]);

  if (status === 'error') return <div className="viewer-note">PDF 打开失败：{error}</div>;

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span className="pdf-name" title={name}>{name}</span>
        <span className="pdf-pages">{status === 'ready' ? `${pages} 页` : '解析中…'}</span>
        <div className="pdf-zoom">
          <button type="button" className="text-button" onClick={() => setScale(value => Math.max(0.6, Number((value - 0.2).toFixed(2))))}>缩小</button>
          <span className="pdf-scale">{Math.round(scale * 100)}%</span>
          <button type="button" className="text-button" onClick={() => setScale(value => Math.min(3, Number((value + 0.2).toFixed(2))))}>放大</button>
        </div>
      </div>
      <div className="pdf-scroll" ref={hostRef} data-status={status} />
    </div>
  );
}
