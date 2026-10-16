import path from 'node:path';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function text(value, label, max = 20000, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label}不能为空且不能超过 ${max} 字符`);
  return value.trim();
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw new AppError('无效的资料 ID');
  return value;
}
export function httpsUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export const PROVIDER_IDS = ['openai', 'anthropic', 'google', 'openai-compatible', 'mock'];
export function modelSettings(input, current = {}) {
  const provider = input.provider || (String(input.endpoint || '').startsWith('mock://') ? 'mock' : 'openai-compatible');
  if (!PROVIDER_IDS.includes(provider)) throw new AppError('无效的模型供应商');
  const maxRounds = Number(input.maxRounds ?? 8);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) throw new AppError('模型轮次须为 1–20');
  const effort = input.effort || '';
  if (!['', 'low', 'medium', 'high'].includes(effort)) throw new AppError('无效的推理强度');
  const model = text(input.model, '模型名称', 200);
  if (provider === 'mock') {
    const raw = String(input.endpoint || 'mock://replay');
    if (!/^mock:\/\/[a-z-]{1,40}$/.test(raw)) throw new AppError('无效的本地回放地址');
    return { provider, endpoint: raw, model, maxRounds, effort, configured: current.configured || false };
  }
  if (provider !== 'openai-compatible') {
    // 预设供应商：endpoint 可选，留空使用 pi-ai 内置默认地址；显式提供时按兼容端点同规则校验
    const endpoint = input.endpoint ? compatibleEndpoint(input.endpoint) : '';
    return { provider, endpoint, model, maxRounds, effort, configured: current.configured || false };
  }
  return { provider, endpoint: compatibleEndpoint(text(input.endpoint, '模型地址', 500)), model, maxRounds, effort, configured: current.configured || false };
}
function compatibleEndpoint(raw) {
  if (raw.startsWith('mock://')) {
    if (!/^mock:\/\/[a-z-]{1,40}$/.test(raw)) throw new AppError('无效的本地回放地址');
    return raw;
  }
  const u = new URL(raw);
  if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new AppError('模型地址须使用 HTTPS；本机服务可使用 loopback HTTP');
  let path = u.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  u.pathname = path;
  return u.href;
}
export function noteInput(input) { return { title: text(input.title, '笔记标题', 200), content: text(input.content, '笔记内容', 200000) }; }
export function projectInput(input) {
  const clean = { name: text(input.name, '项目名称', 100), direction: text(input.direction, '研究方向', 1000, true) };
  // workdir 缺省不改动既有值；显式空串清除绑定；显式值须为绝对路径
  if (input.workdir !== undefined) {
    const workdir = String(input.workdir);
    if (workdir && (workdir.length > 300 || /[\0]/.test(workdir) || !/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(workdir))) throw new AppError('工作目录须为绝对路径');
    clean.workdir = workdir;
  }
  return clean;
}
// 凭据/密钥类文件名，读取与导入一律拒绝（与 importName 同一边界）
export const SENSITIVE_NAME = /(^\.|\.env|credential|secret|private.?key|id_rsa|id_ed25519|token|password|\.pem$|\.key$)/i;
export const WORKSPACE_TEXT_EXT = /^\.(md|markdown|txt|csv|json)$/i;
export function workspacePath(workdir, relative) {
  const base = path.resolve(workdir);
  const resolved = path.resolve(base, String(relative || '.'));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new AppError('路径超出项目工作目录');
  return resolved;
}
export function importName(value) {
  if (!/\.(md|txt)$/i.test(value) || /(^\.|\.env|credential|secret|private.?key|id_rsa|token|password)/i.test(value)) throw new AppError('仅导入普通 Markdown 或文本笔记，不能导入凭据文件');
  return value;
}
export function publicError(error) {
  const message = String(error?.message || '操作失败');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').replace(/\bsk-[\w-]+/g, '[已隐藏]').slice(0, 500);
}
