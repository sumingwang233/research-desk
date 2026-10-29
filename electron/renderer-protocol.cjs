/**
 * 渲染进程资源协议
 *
 * 对齐 ClawsGO 的 `app://bundle` 做法：UI 文件由主进程直接发出，
 * 本地服务只承担 API，页面不再经 loopback HTTP 暴露。
 *
 * 单独成模块是为了能脱离 Electron 测：越界拒绝与 SPA 回退属于安全边界，
 * 放在 main.cjs 里就只能靠整机冒烟间接验证。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const RENDERER_SCHEME = 'app';
const RENDERER_HOST = 'bundle';
const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;
const RENDERER_URL = `${RENDERER_ORIGIN}/`;
/* connect-src 必须放行本机 loopback：页面在 app:// 下，API 在 127.0.0.1 上 */
/* style-src 必须放 unsafe-inline：Monaco 会往 <style> 里写生成的样式表，
   用哈希又随内容变化；脚本侧仍然只允许 'self'，注入面没有被放宽。
   font-src 放 data:：Monaco 的 codicon 是内联 woff2。 */
const RENDERER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const MEDIA_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream',
  '.json': 'application/json'
};

/** 越界路径直接拒绝；未知路径回退到 SPA 入口（前端是单页路由）。 */
function rendererProtocol(rendererRoot) {
  const rootDir = path.resolve(rendererRoot);
  return async request => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) return new Response('未找到', { status: 404 });
    let relative;
    try { relative = decodeURIComponent(url.pathname); } catch { return new Response('未找到', { status: 404 }); }
    let file = path.resolve(rootDir, relative.replace(/^\/+/, ''));
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return new Response('未找到', { status: 404 });
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || !MEDIA_TYPES[path.extname(file)]) file = path.join(rootDir, 'index.html');
    return new Response(await fs.readFile(file), {
      headers: {
        'Content-Type': `${MEDIA_TYPES[path.extname(file)]}; charset=utf-8`,
        'Content-Security-Policy': RENDERER_CSP,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  };
}

module.exports = { RENDERER_SCHEME, RENDERER_HOST, RENDERER_ORIGIN, RENDERER_URL, RENDERER_CSP, rendererProtocol };
