/**
 * 项目文件夹的受控读写
 *
 * 编辑器的能力边界全在这里：路径必须落在绑定的项目目录内（连符号链接解析后也要在），
 * 文本上限、二进制上限、可读扩展名都在这一层卡住，渲染层拿不到越界的能力。
 *
 * 写盘会先在旁边留一份 `<文件名>.bak`：编辑器第一次覆盖别人的原稿时，
 * 至少还有一步可退。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.jsonl', '.py', '.r', '.jl', '.m', '.js', '.mjs', '.ts', '.sql', '.yaml', '.yml', '.toml', '.ini', '.tex', '.bib', '.log', '.sh', '.ps1', '.html', '.css', '.xml']);
const BINARY_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.DS_Store', 'dist', 'build', '.cache']);
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_BINARY = 48 * 1024 * 1024;
const MAX_ENTRIES = 600;
const MAX_DEPTH = 4;

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const extOf = name => path.extname(name).toLowerCase();

/** 解析一个相对路径，并确认它在目录内（含符号链接逃逸检查）。 */
async function locate(root, relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('缺少文件路径');
  if (relative.includes('\0')) throw new Error('文件路径无效');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('文件不在项目文件夹内');
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) throw new Error('项目文件夹不可访问');
  const real = await fs.realpath(target).catch(() => null);
  if (!real) throw new Error('文件不存在');
  if (!inside(realRoot, real)) throw new Error('文件不在项目文件夹内');
  return { real, realRoot };
}

async function walk(root, dir, prefix, depth, output, state) {
  if (depth > MAX_DEPTH || state.truncated) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'zh') : a.isDirectory() ? -1 : 1));
  for (const entry of entries) {
    if (state.truncated) return;
    if (entry.name.startsWith('.') || entry.name.endsWith('.bak')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      output.push({ path: relative, name: entry.name, kind: 'dir' });
      if (output.length >= MAX_ENTRIES) { state.truncated = true; return; }
      await walk(root, path.join(dir, entry.name), relative, depth + 1, output, state);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extOf(entry.name);
    if (!TEXT_EXT.has(ext) && !BINARY_EXT.has(ext)) continue;
    let size = 0;
    try { size = (await fs.stat(path.join(dir, entry.name))).size; } catch { continue; }
    output.push({ path: relative, name: entry.name, kind: 'file', size, ext, editable: TEXT_EXT.has(ext) });
    if (output.length >= MAX_ENTRIES) { state.truncated = true; return; }
  }
}

/** 目录树：扁平返回，由渲染层按路径拼层级。 */
async function list(root) {
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) throw new Error('项目文件夹不可访问');
  const output = [];
  const state = { truncated: false };
  await walk(realRoot, realRoot, '', 0, output, state);
  return { root: realRoot, entries: output, truncated: state.truncated };
}

async function readText(root, relative) {
  const { real } = await locate(root, relative);
  if (!TEXT_EXT.has(extOf(real))) throw new Error('这个文件类型不能作为文本打开');
  const stat = await fs.stat(real);
  if (stat.size > MAX_TEXT) throw new Error('文件超过 2 MiB，编辑器不打开');
  return { text: await fs.readFile(real, 'utf8'), size: stat.size, mtime: stat.mtimeMs, name: path.basename(real) };
}

async function readBinary(root, relative) {
  const { real } = await locate(root, relative);
  const ext = extOf(real);
  if (!BINARY_EXT.has(ext)) throw new Error('这个文件类型不支持预览');
  const stat = await fs.stat(real);
  if (stat.size > MAX_BINARY) throw new Error('文件超过 48 MiB，暂不预览');
  return { bytes: new Uint8Array(await fs.readFile(real)), size: stat.size, name: path.basename(real), ext };
}

async function writeText(root, relative, text) {
  if (typeof text !== 'string') throw new Error('写入内容无效');
  const { real } = await locate(root, relative);
  if (!TEXT_EXT.has(extOf(real))) throw new Error('这个文件类型不能保存');
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT) throw new Error('内容超过 2 MiB，未保存');
  const previous = await fs.readFile(real, 'utf8');
  if (previous === text) return { unchanged: true, mtime: (await fs.stat(real)).mtimeMs };
  await fs.writeFile(`${real}.bak`, previous, 'utf8');
  await fs.writeFile(real, text, 'utf8');
  const stat = await fs.stat(real);
  return { saved: true, mtime: stat.mtimeMs, backup: `${path.basename(real)}.bak` };
}

module.exports = { list, readText, readBinary, writeText, TEXT_EXT, BINARY_EXT, MAX_TEXT, MAX_BINARY };
