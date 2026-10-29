/**
 * 内置供应商目录
 *
 * 唯一数据源是 pi-ai 自带的 provider 目录（`providers/all`），不在这里手写
 * baseUrl / 模型清单。照 pi-web 的做法：谁能出现在"添加供应商"里，由 SDK 声明
 * 的事实决定——有已知 baseUrl、支持 API key、并且确实列得出模型。
 *
 * 被过滤掉的几类（不是遗漏）：
 *   - amazon-bedrock / azure / google-vertex / cloudflare-* / opencode：需要
 *     额外凭据（区域、资源名、网关 ID），一个 baseUrl 填不出来，放进来只会
 *     让人配出一个跑不通的条目；
 *   - radius：动态 catalog，没有静态 baseUrl；
 *   - openai-codex：只支持 OAuth，本项目只做 API key；
 *   - typesafe：目录里 0 个模型。
 */

import { builtinProviders, getBuiltinModels } from '@earendil-works/pi-ai/providers/all';

let cache = null;

function buildCatalog() {
  const entries = [];
  for (const provider of builtinProviders()) {
    const auth = provider.auth && typeof provider.auth === 'object' ? Object.keys(provider.auth) : [];
    if (!provider.baseUrl || !auth.includes('apiKey')) continue;

    let models = [];
    try { models = getBuiltinModels(provider.id); } catch { models = []; }
    if (!models.length) continue;

    entries.push({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      api: models[0].api || '',
      modelCount: models.length,
      supportsOAuth: auth.includes('oauth'),
      // 供 UI 判断"这个供应商要不要额外填地址"；目录内的都是固定地址
      needsBaseUrl: false
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const models = new Map();
  for (const entry of entries) {
    models.set(entry.id, getBuiltinModels(entry.id)
      .map(model => ({
        id: model.id,
        name: model.name || model.id,
        api: model.api || '',
        contextWindow: model.contextWindow || 0,
        maxTokens: model.maxTokens || 0,
        reasoning: Boolean(model.reasoning)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en')));
  }

  return { entries, models };
}

function ensure() {
  if (!cache) cache = buildCatalog();
  return cache;
}

/** 目录里的供应商（已按可用性过滤）。 */
export function listProviders() {
  return ensure().entries;
}

/** 某个供应商的模型清单；未知供应商返回空数组。 */
export function listModels(providerId) {
  return ensure().models.get(providerId) || [];
}

/** provider 字段是否指向一个可用内置供应商。 */
export function isBuiltinProvider(providerId) {
  return ensure().models.has(providerId);
}

/** 取单个供应商的展示信息。 */
export function findProvider(providerId) {
  return ensure().entries.find(entry => entry.id === providerId) || null;
}
