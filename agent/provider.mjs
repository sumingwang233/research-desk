// 模型层适配器：对外保持 complete() 契约（OpenAI 风格 messages/tools 进出），
// 内部统一走 pi-ai 的流式实现。
//
// 供应商不再在本文件里写死。内置供应商的 baseUrl、协议和模型清单都取自
// pi-ai 的 provider 目录（providers/all），与"添加供应商"面板同源；
// 只有「自定义端点」由用户填写地址，按 OpenAI 兼容协议接入。
// mock:// 地址仍走本地回放，不发任何网络请求。
import { createModels, createProvider } from '@earendil-works/pi-ai';
import { builtinProviders, getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { replayComplete } from './replay.mjs';

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** 自定义端点：用户自带 baseUrl 的 OpenAI 兼容服务（Ollama、vLLM、网关等）。 */
function customProvider(settings) {
  // 兼容端点的 settings.endpoint 可能被规范化为 …/chat/completions；pi-ai 需要的是 /v1 根
  const baseUrl = String(settings.endpoint || '').replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  const model = {
    id: settings.model, name: settings.model,
    api: 'openai-completions', provider: 'research-desk', baseUrl,
    reasoning: true, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000, maxTokens: 16384,
    ...(settings.thinkingLevelMap ? { thinkingLevelMap: settings.thinkingLevelMap } : {})
  };
  const provider = createProvider({
    id: 'research-desk', name: 'Research Desk', baseUrl,
    // 与 Ollama 等无密钥本地服务同形：空认证视为已配置；显式 apiKey 单次覆盖优先
    auth: { apiKey: { name: '模型 API key', resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: openAICompletionsApi()
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}

/** 内置供应商：直接使用 SDK 目录里的 provider 实例与模型对象。 */
function builtinProvider(settings) {
  const provider = builtinProviders().find(entry => entry.id === settings.provider);
  if (!provider) throw new Error(`未知的模型供应商：${settings.provider}`);
  const catalog = getBuiltinModels(settings.provider);
  const base = catalog.find(entry => entry.id === settings.model);
  if (!base) {
    throw new Error(`${provider.name} 下没有模型「${settings.model}」，请重新选择模型`);
  }
  /* 思考等级映射是模型级属性：用户设置覆盖目录默认值，null（禁用）必须原样保留 */
  const model = settings.thinkingLevelMap
    ? { ...base, thinkingLevelMap: { ...(base.thinkingLevelMap || {}), ...settings.thinkingLevelMap } }
    : base;
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}

function resolve(settings) {
  const provider = settings.provider || 'custom';
  if (provider === 'custom' || provider === 'openai-compatible') return customProvider(settings);
  return builtinProvider(settings);
}

/** 诊断用：返回实际会用的模型身份与生效的思考等级映射。 */
export function resolveModelForSettings(settings) {
  const { model } = resolve(settings);
  return {
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
    thinkingLevelMap: model.thinkingLevelMap || null
  };
}

function toContext(model, messages, tools) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') out.push({ role: 'user', content: String(m.content ?? ''), timestamp: Date.now() });
    else if (m.role === 'assistant') {
      const content = [];
      if (m.content) content.push({ type: 'text', text: String(m.content) });
      for (const call of m.tool_calls || []) content.push({ type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments || '{}') });
      out.push({ role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: ZERO_USAGE, stopReason: m.tool_calls?.length ? 'toolUse' : 'stop', timestamp: Date.now() });
    } else if (m.role === 'tool') {
      out.push({ role: 'toolResult', toolCallId: m.tool_call_id, toolName: m.name || 'tool', content: [{ type: 'text', text: String(m.content ?? '') }], isError: false, timestamp: Date.now() });
    }
  }
  return {
    ...(system ? { systemPrompt: system } : {}),
    messages: out,
    tools: (tools || []).map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters }))
  };
}

export async function complete({ settings, messages, tools, signal, onToken, onReasoning }) {
  if (settings.endpoint?.startsWith('mock://') || settings.provider === 'mock') return replayComplete({ settings, messages, tools, signal, onToken, onReasoning });
  const { models, model } = resolve(settings);
  const context = toContext(model, messages, tools);
  const abort = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let length = 0;
  const stream = models.stream(model, context, {
    // 无密钥的本机服务（Ollama 等）忽略占位 key；库要求每次请求携带 key 或 Authorization 头
    apiKey: settings.apiKey || 'research-desk-unconfigured-key',
    signal: abort,
    reasoning: settings.effort || undefined
  });
  let message;
  try {
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        length += event.delta.length;
        if (length > 200000) throw new Error('模型输出超出大小限制');
        onToken(event.delta);
      } else if (event.type === 'thinking_delta') {
        if (event.delta.length > 100000) throw new Error('模型推理输出超出大小限制');
        onReasoning?.(event.delta);
      }
    }
    message = await stream.result();
  } catch (error) {
    const status = String(error?.message || '').match(/\b([45]\d{2})\b/);
    if (status) throw new Error(`模型接口返回 HTTP ${status[1]}，请检查地址、模型和授权`);
    throw error;
  }
  signal.throwIfAborted();
  if (message.stopReason === 'error') {
    const raw = String(message.errorMessage || '模型调用失败').slice(0, 300);
    const status = raw.match(/\b([45]\d{2})\b/);
    if (status) throw new Error(`模型接口返回 HTTP ${status[1]}，请检查地址、模型和授权`);
    throw new Error(/finish_reason|ended without/i.test(raw) ? '模型流意外断开，已有结果已保留' : raw);
  }
  if (message.stopReason === 'aborted') throw new Error('模型调用已取消');
  if (message.stopReason === 'length') throw new Error('模型输出被截断或过滤，已有结果已保留');
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const calls = message.content.filter(b => b.type === 'toolCall').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.arguments ?? {}) } }));
  for (const call of calls) if (!call.id || !call.function.name) throw new Error('模型返回了不完整的工具调用');
  if (!text && !calls.length) throw new Error('模型没有返回文本或工具调用');
  return { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) };
}
