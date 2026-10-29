import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

/* pdf.js 读中文论文要靠 CMap（非嵌入 CJK 字体的编码表）。
   它们是数据文件不是模块，Vite 不会自动带上，构建后直接拷进 dist。 */
function copyPdfCMaps() {
  return {
    name: 'copy-pdf-cmaps',
    apply: 'build',
    closeBundle() {
      const from = path.join(here, 'node_modules/pdfjs-dist/cmaps');
      const to = path.join(here, 'renderer/dist/cmaps');
      if (existsSync(from)) cpSync(from, to, { recursive: true });
    }
  };
}

export default defineConfig({
  root: 'renderer',
  plugins: [react(), copyPdfCMaps()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 900
  }
});
