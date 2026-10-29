// 本地回放替身：不发起任何网络请求，按会话状态确定性地产出推理增量、文本增量和工具调用。
// 仅用于离线演示与 UI 分支验证（模型设置中 endpoint 填 mock://replay），输出必须明确标记为本地模拟。
import { randomUUID } from 'node:crypto';

const chunk = (value, size = 12) => value.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) || [];
const toolCall = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `replay-${randomUUID()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

export async function replayComplete({ messages, signal, onToken, onReasoning }) {
  const question = messages.findLast(m => m.role === 'user')?.content || '';
  const results = messages.filter(m => m.role === 'tool');
  const beat = async () => { signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, question.includes('[慢]') ? 120 : 24)); };
  const speak = async (text, emit) => { for (const piece of chunk(text)) { await beat(); emit(piece); } };
  const think = text => speak(text, value => onReasoning?.(value));
  let spoken = '';
  const say = async text => { spoken += text; await speak(text, onToken); };

  if (question.includes('[错误]')) throw new Error('本地回放：模拟模型接口故障');

  if (!results.length) {
    if (question.includes('提问')) {
      await think('问题方向有多种可能，先请用户明确重点，再投入检索。');
      return toolCall('ask_user_question', { question: '这项研究你希望优先深入哪个方面？', options: [{ label: '理论机制', description: '梳理核心概念、模型与解释框架' }, { label: '实证证据', description: '检索已有实验、数据与案例研究' }, { label: '应用前景', description: '关注落地场景、工具与实践路径' }] });
    }
    if (question.includes('工作区')) {
      await think('先看项目本地文件夹里有哪些可读资料。');
      return toolCall('list_workspace_files', {});
    }
    await think(`先界定问题：「${question.slice(0, 40)}」。需要公开元数据作为证据，再组织结论。`);
    return toolCall('search_papers', { query: question.replace(/\[.*?\]/g, '').split(/[，。,.]/)[0].slice(0, 80) || 'research topic', limit: 5 });
  }
  const last = JSON.parse(results.at(-1).content);
  if (results.length === 1 && ('answers' in last || last.reason === '用户拒绝回答')) {
    await think('用户已明确方向，组织回应。');
    await say(last.allowed
      ? `明白，我们优先关注「${String(last.answers).slice(0, 60)}」。\n\n接下来可以围绕这个方向检索公开文献元数据；如果你准备好，告诉我「继续」，我就开始检索。\n\n（本回答由本地回放生成，仅用于界面验证。）`
      : '好的，不急于限定方向。你可以补充更多背景，我们再继续。\n\n（本地回放输出。）');
    return { role: 'assistant', content: spoken };
  }
  if (results.length === 1 && Array.isArray(last.files)) {
    if (last.files.length) {
      await think(`找到 ${last.files.length} 份本地资料，先读第一份。`);
      return toolCall('read_workspace_file', { path: last.files[0].path });
    }
    await say('项目文件夹里目前没有可读的 Markdown / 文本 / CSV / JSON 资料。放入资料后再试，或让我改为检索公开文献。\n\n（本地回放输出。）');
    return { role: 'assistant', content: spoken };
  }
  if (results.length === 2 && typeof last.content === 'string' && last.path) {
    await think('本地资料已读取，组织回应。');
    await say(`已读取工作区资料「${String(last.path).slice(0, 60)}」（${String(last.content).length} 字符）。\n\n前 200 字摘要：${String(last.content).replace(/\s+/g, ' ').slice(0, 200)}…\n\n可以基于这份资料继续提问，或让我把它与公开文献对照。\n\n（本地回放输出，不构成真实研究结论。）`);
    return { role: 'assistant', content: spoken };
  }
  if (results.length === 1) {
    if (/保存|笔记/.test(question)) {
      await think('已有来源元数据。整理为一份研究笔记草稿，保存前需要用户批准。');
      return toolCall('save_research_note', { title: `研究笔记：${question.replace(/\[.*?\]/g, '').slice(0, 24)}`, content: `# 研究笔记（本地模拟）\n\n围绕「${question.replace(/\[.*?\]/g, '').slice(0, 60)}」整理的线索，来源为 [S1]。\n\n## 证据边界\n\n仅取得公开元数据与摘要，尚未阅读论文全文。本笔记由本地回放生成，仅用于界面验证。` });
    }
    await think('来源元数据已到位，可以组织带引用的回答。');
    await say(`基于检索到的公开元数据 [S1]，可以先从核心概念与既有证据入手。\n\n需要强调：目前只有题名、作者、年份与可取得的摘要，尚未阅读论文全文，实验结论不能视为已核验。\n\n如果希望把以上线索沉淀下来，可以让我「保存为研究笔记」，写入前会请求你的许可。\n\n（本回答由本地回放生成，仅用于界面验证，不构成真实研究结论。）`);
    return { role: 'assistant', content: spoken };
  }
  await think('保存流程已有结果，向用户交代结局。');
  await say(last.allowed ? '笔记已获准保存，可以在「研究笔记」页查看。\n\n（本地回放输出。）' : '保存被拒绝，未写入任何笔记。内容仍留在对话中，你可以修改后再次尝试。\n\n（本地回放输出。）');
  return { role: 'assistant', content: spoken };
}
