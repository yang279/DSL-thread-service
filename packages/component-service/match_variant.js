#!/usr/bin/env node
'use strict';

const fs     = require('fs');
const path   = require('path');
const OpenAI = require('openai');

// 自动加载同目录 .env
const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [k, v] = trimmed.split('=');
    if (k && v && !process.env[k.trim()]) process.env[k.trim()] = v.trim();
  });
}

// LLM 相关配置全部可在 .env 中覆盖：
//   DASHSCOPE_API_KEY  调用密钥（必填）
//   LLM_BASE_URL       接口地址，默认指向 DeepSeek
//   MODEL              模型名，默认 deepseek-v4-flash
//   LLM_TIMEOUT_MS     单次请求超时（毫秒），默认 60000；命中超时时 err.message 形如
//                      "Request timed out." / "Connection error."，会被下面的 callLLM 打到日志里
//   LLM_LOG_IO         打印每次 LLM 调用的完整输入（messages）/输出（message + tool_calls），
//                      默认关闭。排查"为什么选了这个变体/选错了"时打开能直接看到模型看到的
//                      prompt 和原始回复；prompt 可能很长，单条会截断到 LLM_LOG_IO_MAX_LEN
const BASE_URL   = process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL      = process.env.MODEL || 'deepseek-v4-flash';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;
const LOG_LLM_IO = /^(1|true|yes|on)$/i.test((process.env.LLM_LOG_IO || '').trim());
const LOG_LLM_IO_MAX_LEN = Number(process.env.LLM_LOG_IO_MAX_LEN) || 4000;

const client = new OpenAI({
  apiKey:  process.env.DASHSCOPE_API_KEY,
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
});

const SEARCH_INDEX    = path.resolve(__dirname, 'search_index.json');
const CANONICAL_MAP_PATH = path.resolve(__dirname, 'canonical_map.json');

// 把要打日志的对象序列化成字符串并截断，避免一条几万 token 的 prompt 把日志刷屏
function formatForLog(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= LOG_LLM_IO_MAX_LEN) return text;
  return `${text.slice(0, LOG_LLM_IO_MAX_LEN)}\n…(共 ${text.length} 字符，已截断；调大 LLM_LOG_IO_MAX_LEN 可看完整内容)`;
}

// 包一层日志：记录每次 LLM 调用的发起/耗时/失败原因——
// /match 等接口报错只会把 err.message 透传给调用方，本身不打印任何东西，
// 出现 "timeout" 时单看接口响应不知道是哪一步、卡了多久，必须靠这里的日志定位。
// LOG_LLM_IO 打开时额外打印完整的输入 messages 和输出 message/tool_calls，
// 用于排查"为什么模型选了这个结果"——默认关闭，避免大 prompt 刷屏
async function callLLM(label, params) {
  const start = Date.now();
  console.log(`[match_variant] ${label} → 调用 ${BASE_URL} (model=${MODEL}, timeout=${TIMEOUT_MS}ms)`);
  if (LOG_LLM_IO) {
    console.log(`[match_variant] ${label} → 输入 messages：\n${formatForLog(params.messages)}`);
  }
  try {
    const response = await client.chat.completions.create(params);
    console.log(`[match_variant] ${label} ✓ 完成，耗时 ${Date.now() - start}ms`);
    if (LOG_LLM_IO) {
      console.log(`[match_variant] ${label} → 输出 message：\n${formatForLog(response.choices[0]?.message)}`);
    }
    return response;
  } catch (err) {
    console.error(`[match_variant] ${label} ✗ 失败，耗时 ${Date.now() - start}ms：${err.message}`);
    throw err;
  }
}

let _index = null;
let _canonicalMap = null;
let _mapWriteLock = Promise.resolve();

function loadIndex() {
  if (!_index) _index = JSON.parse(fs.readFileSync(SEARCH_INDEX, 'utf8'));
  return _index;
}

// rebuild_index 重新生成 search_index.json 后调用，使下次匹配重新读盘而非用旧缓存
function clearIndexCache() {
  _index = null;
  _canonicalMap = null; // 下次读 canonical map 时重校指纹
}

// ── 规范映射表（canonical map）───────────────────────────────────────────────
// 持久化到 canonical_map.json，key = canonicalKey(query)，value = { componentKey, variantKey }
// 顶层字段 _indexFingerprint 记录绑定的索引版本（search_index.json 的 mtime）；
// 索引重建后 mtime 变化，整张表自动失效并重新积累——无需逐条校验。

function getIndexFingerprint() {
  try { return fs.statSync(SEARCH_INDEX).mtime.toISOString(); } catch { return 'unknown'; }
}

function loadCanonicalMap() {
  if (_canonicalMap) return _canonicalMap;
  const fingerprint = getIndexFingerprint();
  if (fs.existsSync(CANONICAL_MAP_PATH)) {
    try {
      const stored = JSON.parse(fs.readFileSync(CANONICAL_MAP_PATH, 'utf8'));
      if (stored._indexFingerprint === fingerprint) {
        _canonicalMap = stored;
        return _canonicalMap;
      }
      console.log(`[match_variant] 规范映射表指纹不匹配（索引已更新），重置映射表`);
    } catch {}
  }
  _canonicalMap = { _indexFingerprint: fingerprint };
  return _canonicalMap;
}

// 串行化写入，避免并发覆写丢失条目（merge-on-write：每次写前重读文件再合并）
function updateCanonicalMap(newEntries) {
  _mapWriteLock = _mapWriteLock.then(() => {
    const fingerprint = getIndexFingerprint();
    let current = { _indexFingerprint: fingerprint };
    if (fs.existsSync(CANONICAL_MAP_PATH)) {
      try {
        const stored = JSON.parse(fs.readFileSync(CANONICAL_MAP_PATH, 'utf8'));
        if (stored._indexFingerprint === fingerprint) current = stored;
      } catch {}
    }
    for (const { key, componentKey, variantKey } of newEntries) {
      current[key] = { componentKey, variantKey };
    }
    fs.writeFileSync(CANONICAL_MAP_PATH, JSON.stringify(current, null, 2), 'utf8');
    _canonicalMap = current;
    console.log(`[match_variant] 规范映射表写入 ${newEntries.length} 条，当前共 ${Object.keys(current).length - 1} 条`);
  }).catch(err => console.error(`[match_variant] 规范映射表写入失败：${err.message}`));
  return _mapWriteLock;
}

function canonicalKey(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── 第一步：LLM 语义提取 → 中文搜索关键词 ────────────────────────────────────

async function normalizeQuery(description) {
  const response = await callLLM('normalizeQuery（语义提取）', {
    model: MODEL,
    max_tokens: 512,
    thinking: { type: 'disabled' },
    messages: [
      {
        role: 'system',
        content: '你是 UI 组件库搜索助手。将用户描述转换为 2~5 个中文搜索关键词，用于在组件库中检索。只输出关键词，空格分隔，不要任何解释。',
      },
      {
        role: 'user',
        content: description,
      },
    ],
  });
  return response.choices[0]?.message?.content?.trim() || description;
}

// ── 第二步：本地关键词过滤（无 LLM，瞬间完成）────────────────────────────────

function tokenize(text) {
  const words = text.split(/[\s=,\/\-_.()（）【】]+/).filter(t => t.length >= 1);
  const bigrams = [];
  const chars = [...text.replace(/[\s=,\/\-_.()（）【】]+/g, '')];
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
  }
  return [...new Set([...words, ...bigrams])].filter(t => t.length >= 2);
}

function localFilter(query, entries, topK = 10) {
  const tokens = tokenize(query);
  return entries
    .map(entry => {
      let score = 0;
      for (const tok of tokens) {
        if (entry.searchText.includes(tok)) score += tok.length;
      }
      return { entry, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(x => x.entry);
}

// ── 第三步 A：LLM 选组件集（轻量 prompt：仅名称 + 变体数量，不展开变体）────────
//
// 候选集的全部变体名 token 量很大（少数组件集变体数上百），一次性塞给模型会让
// prompt 膨胀到上万 token。先用极小的 prompt 让模型按"组件集语义"判断该选哪个集合，
// 这一步本身不需要看变体细节也能判断准确。

async function selectComponentSet(description, candidates) {
  const list = candidates.map(cs =>
    `  [${cs.guid || cs.componentKey}] 【${cs.name}】(${cs.sourceLabel}) | ${(cs.variants || []).length} 个变体`
  ).join('\n');

  const response = await callLLM('selectComponentSet（选组件集）', {
    model: MODEL,
    max_tokens: 256,
    thinking: { type: 'disabled' },
    tools: [{
      type: 'function',
      function: {
        name: 'select_component_set',
        description: '选出与描述最匹配的组件集，返回其 guid',
        parameters: {
          type: 'object',
          properties: {
            guid: { type: 'string', description: '所选组件集的 guid' },
          },
          required: ['guid'],
        },
      },
    }],
    tool_choice: 'auto',
    messages: [{
      role: 'user',
      content: `从以下候选组件集中，选出与描述最匹配的一个，返回其 guid。\n\n描述：${description}\n\n候选：\n${list}`,
    }],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  const { guid } = JSON.parse(toolCall.function.arguments);
  return candidates.find(c => (c.guid || c.componentKey) === guid) || null;
}

// ── 第三步 B：LLM 在选定组件集内精选变体（仅展开这一个集合的变体）────────────
//
// 缩小到单一组件集后，prompt 只包含它自己的变体列表，既比"10 个集合的全部变体"
// 小得多，又因为去掉了其他候选集的干扰信息，模型更容易聚焦比对变体差异。

async function selectVariant(description, entry) {
  const variants = entry.variants || [];
  if (variants.length === 0) {
    return { variantKey: null, reason: '该组件为 standalone，无变体' };
  }

  const variantLines = variants
    .map(v => `  [${v.guid || v.variantKey}] ${v.name}`)
    .join('\n');

  const response = await callLLM('selectVariant（精选变体）', {
    model: MODEL,
    max_tokens: 512,
    thinking: { type: 'disabled' },
    tools: [{
      type: 'function',
      function: {
        name: 'select_variant',
        description: '从指定组件集的变体中选出与描述最匹配的一个，返回其 guid',
        parameters: {
          type: 'object',
          properties: {
            variantGuid: { type: 'string', description: '所选变体的 guid' },
            reason:      { type: 'string', description: '一句话说明匹配理由' },
          },
          required: ['variantGuid'],
        },
      },
    }],
    tool_choice: 'auto',
    messages: [{
      role: 'user',
      content: `组件集【${entry.name}】(${entry.sourceLabel}) 有以下变体，选出与描述最匹配的一个，返回其 guid。\n\n描述：${description}\n\n变体：\n${variantLines}`,
    }],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  const { variantGuid, reason } = JSON.parse(toolCall.function.arguments);
  const variant = variants.find(v => (v.guid || v.variantKey) === variantGuid);
  if (!variant) return null;
  return { variantKey: variant.variantKey || variant.guid, reason };
}

// ── 整页统一匹配：同一棵 DSL 里的所有实例合并成一次 LLM 裁决 ──────────────────
//
// matchVariant 是"一条描述独立跑一遍三步"，多个实例之间互不知情：同一页面里
// 几个本该用同一组件集/同一变体的"确定按钮"，很容易被分别选到不同的结果。
// 整页匹配时改为：本地过滤仍按各自的 query 单独做（够快，不需要 LLM），
// 但"选组件集"和"选变体"两步把同批次的所有实例一次性丢给 LLM，让它在看到
// 全局上下文后统一裁决，结果天然保持一致，调用次数也从 3*N 降到 1 + 分组数。

// 输出格式：等长数组 + guid（fallback 到 componentKey/variantKey），LLM 复制字符串返回，
// 代码按 guid||componentKey 做 find 查找——避免序号 0/1 混淆，同时不在 prompt 里暴露完整 key。

function buildItemList(items) {
  return items.map((it, i) => `  ${i + 1}. ${it.query}`).join('\n');
}

async function selectComponentSetsTogether(items, anchorNote = '') {
  // 候选池按 componentKey/guid 去重合并，所有实例共享同一份候选池
  const poolMap = new Map();
  for (const item of items) {
    for (const cs of item.candidates) {
      const key = cs.componentKey || cs.guid;
      if (!poolMap.has(key)) poolMap.set(key, cs);
    }
  }
  const pool = [...poolMap.values()];
  console.log(`[match_variant] selectComponentSetsTogether → ${items.length} 个元素，去重合并候选池 ${pool.length} 个组件集`);
  if (pool.length === 0) {
    console.log('[match_variant] selectComponentSetsTogether → 候选池为空，全部跳过（本地过滤未命中任何组件集）');
    return items.map(() => null);
  }

  // 展示 guid + 名称：guid 比 componentKey 短，LLM 复制字符串返回（避免序号 0/1 混淆）
  const poolList = pool
    .map(cs => `  [${cs.guid || cs.componentKey}] 【${cs.name}】(${cs.sourceLabel}) | ${(cs.variants || []).length} 个变体`)
    .join('\n');

  const response = await callLLM('selectComponentSetsTogether（整页选组件集）', {
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    tools: [{
      type: 'function',
      function: {
        name: 'select_component_sets',
        description: '按输入顺序为每一个 UI 元素分别选出最匹配的组件集',
        parameters: {
          type: 'object',
          properties: {
            guids: {
              type: 'array',
              description: '选择结果数组，长度必须与输入元素数量完全相同，第 N 项为第 N 个元素对应的组件集 guid；找不到合适的填空字符串',
              items: { type: 'string' },
            },
          },
          required: ['guids'],
        },
      },
    }],
    tool_choice: 'auto',
    messages: [{
      role: 'user',
      content: `${anchorNote}下面是同一个页面里的多个 UI 元素，请按顺序从候选组件集中为每个元素选出最匹配的一个，返回其 guid。注意：\n1. 描述相近或语义相同的元素（如同样是"确定按钮"）应给出一致的选择，不要在它们之间随意切换不同的组件集；\n2. 返回的数组长度必须与元素数量（${items.length} 个）完全一致，按顺序一一对应。\n\n元素列表（共 ${items.length} 个）：\n${buildItemList(items)}\n\n候选组件集（所有元素共享同一份候选池）：\n${poolList}`,
    }],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  const guids = toolCall ? (JSON.parse(toolCall.function.arguments).guids || []) : [];
  if (guids.length !== items.length) {
    console.warn(`[match_variant] selectComponentSetsTogether ⚠ 模型返回 ${guids.length} 项，与输入 ${items.length} 个元素数量不一致，多余/缺失的位置会按 null 处理`);
  }

  const picked = items.map((_, i) => pool.find(c => (c.guid || c.componentKey) === guids[i]) || null);
  console.log(`[match_variant] selectComponentSetsTogether ✓ 完成：${picked.filter(Boolean).length}/${items.length} 个元素选到了组件集，去重后涉及 ${new Set(picked.filter(Boolean)).size} 个不同组件集`);
  return picked;
}

async function selectVariantsTogether(entry, items, anchorNote = '') {
  const variants = entry.variants || [];
  console.log(`[match_variant] selectVariantsTogether → 组件集「${entry.name}」(${entry.sourceLabel})，本组 ${items.length} 个元素，候选 ${variants.length} 个变体`);
  if (variants.length === 0) {
    console.log(`[match_variant] selectVariantsTogether → 「${entry.name}」是 standalone 组件，无变体可选，本组 ${items.length} 个元素直接返回`);
    return items.map(() => ({ variantKey: null, reason: '该组件为 standalone，无变体' }));
  }

  // 展示 guid + 名称，LLM 复制 guid 返回
  const variantLines = variants
    .map(v => `  [${v.guid || v.variantKey}] ${v.name}`)
    .join('\n');

  const response = await callLLM('selectVariantsTogether（整页选变体）', {
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    tools: [{
      type: 'function',
      function: {
        name: 'select_variants',
        description: '按输入顺序为每一个 UI 元素分别选出最匹配的变体',
        parameters: {
          type: 'object',
          properties: {
            picks: {
              type: 'array',
              description: '选择结果数组，长度必须与输入元素数量完全相同，第 N 项对应第 N 个元素',
              items: {
                type: 'object',
                properties: {
                  variantGuid: { type: 'string', description: '所选变体的 guid' },
                  reason:      { type: 'string', description: '一句话说明匹配理由' },
                },
                required: ['variantGuid'],
              },
            },
          },
          required: ['picks'],
        },
      },
    }],
    tool_choice: 'auto',
    messages: [{
      role: 'user',
      content: `${anchorNote}组件集【${entry.name}】(${entry.sourceLabel}) 有以下变体，下面这些 UI 元素都已被归到这个组件集，请按顺序为每个元素选出最匹配的变体，返回其 guid。注意：\n1. 描述相近或语义相同的元素应给出一致的选择；\n2. 返回的数组长度必须与元素数量（${items.length} 个）完全一致，按顺序一一对应。\n\n元素列表（共 ${items.length} 个）：\n${buildItemList(items)}\n\n变体：\n${variantLines}`,
    }],
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  const rawPicks = toolCall ? (JSON.parse(toolCall.function.arguments).picks || []) : [];
  if (rawPicks.length !== items.length) {
    console.warn(`[match_variant] selectVariantsTogether ⚠ 「${entry.name}」模型返回 ${rawPicks.length} 项，与本组 ${items.length} 个元素数量不一致，多余/缺失的位置会按 null 处理`);
  }

  const result = items.map((_, i) => {
    const p = rawPicks[i];
    if (!p) return null;
    const variant = variants.find(v => (v.guid || v.variantKey) === p.variantGuid);
    if (!variant) return null;
    return { variantKey: variant.variantKey || variant.guid, reason: p.reason };
  });
  console.log(`[match_variant] selectVariantsTogether ✓ 「${entry.name}」完成：${result.filter(Boolean).length}/${items.length} 个元素选到了变体`);
  return result;
}

function toMatchResult(entry, picked) {
  if (!entry || !picked) return null;
  const { variantKey, reason } = picked;
  const variant = (entry.variants || []).find(v => v.variantKey === variantKey || v.guid === variantKey);

  return {
    source:           entry.source,
    sourceLabel:      entry.sourceLabel,
    componentSetName: entry.name,
    componentKey:     entry.componentKey || entry.guid,
    hexFile:          entry.hexFile,
    path:             entry.source && entry.hexFile ? `${entry.source}/${entry.hexFile}` : null,
    variant:          variant
      ? { name: variant.name, variantKey: variant.variantKey || variant.guid, guid: variant.guid }
      : null,
    reason:           reason || '',
  };
}

// queries: 字符串数组，按顺序对应每个待匹配实例；返回结果数组与输入一一对应（未匹配为 null）
async function matchVariantsTogether(queries) {
  const { entries } = loadIndex();
  const canonicalMap = loadCanonicalMap();
  console.log(`[match_variant] matchVariantsTogether（整页统一匹配）开始：共 ${queries.length} 条查询`);
  if (queries.length === 0) return [];

  // Step 0: 按归一化文本聚类，相同 query 只解析一次，结果广播给全簇
  const clusterMap = new Map(); // normalizedKey -> { representativeQuery, indices[] }
  queries.forEach((query, i) => {
    const key = canonicalKey(query);
    if (!clusterMap.has(key)) clusterMap.set(key, { representativeQuery: query, indices: [] });
    clusterMap.get(key).indices.push(i);
  });
  console.log(`[match_variant] Step 0 聚类：${queries.length} 条 → ${clusterMap.size} 个独立簇`);

  // Step 1: 查规范映射表，整簇命中的直接采用（不进 LLM）
  const confirmedByIndex = new Map(); // originalIndex -> matchResult
  const pendingKeys = [];

  for (const [key, cluster] of clusterMap) {
    const mapped = canonicalMap[key];
    if (mapped) {
      const comp = entries.find(e => (e.componentKey || e.guid) === mapped.componentKey);
      const variant = comp && mapped.variantKey
        ? (comp.variants || []).find(v => (v.variantKey || v.guid) === mapped.variantKey)
        : null;
      if (comp && (mapped.variantKey == null || variant)) {
        console.log(`[match_variant] 规范映射表命中「${key}」(${cluster.indices.length} 个实例)`);
        const result = toMatchResult(comp, { variantKey: mapped.variantKey, reason: '' });
        cluster.indices.forEach(i => confirmedByIndex.set(i, result));
        continue;
      }
      console.log(`[match_variant] 规范映射表条目「${key}」已失效（组件或变体不存在），重新裁决`);
      delete canonicalMap[key];
    }
    pendingKeys.push(key);
  }
  console.log(`[match_variant] Step 1 规范映射表：${clusterMap.size - pendingKeys.length} 簇命中，${pendingKeys.length} 簇待 LLM`);

  // 对齐基准：把已确认的结果注入到 LLM prompt，让模型参照保持一致
  let anchorNote = '';
  if (confirmedByIndex.size > 0) {
    const seen = new Set();
    const lines = [];
    for (const result of confirmedByIndex.values()) {
      if (!result) continue;
      const sig = `${result.componentKey}/${result.variant?.variantKey}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      lines.push(`  - 【${result.componentSetName}】→ ${result.variant ? result.variant.name : '无变体'}`);
    }
    if (lines.length > 0) {
      anchorNote = `参考（以下元素已由规范映射表确认，请让语义相近的元素与之对齐）：\n${lines.join('\n')}\n\n`;
    }
  }

  if (pendingKeys.length === 0) {
    const final = queries.map((_, i) => confirmedByIndex.get(i) || null);
    console.log(`[match_variant] matchVariantsTogether ✓ 全部命中映射表：${final.filter(Boolean).length}/${queries.length}`);
    return final;
  }

  // Step 2: 本地过滤，每簇只跑一次代表 query
  const clusterItems = pendingKeys.map(key => {
    const cluster = clusterMap.get(key);
    return {
      clusterKey:    key,
      clusterIndices: cluster.indices,
      query:         cluster.representativeQuery,
      candidates:    localFilter(cluster.representativeQuery, entries, 10),
    };
  });
  const matchable = clusterItems.filter(ci => ci.candidates.length > 0);
  console.log(`[match_variant] Step 2 本地过滤：${matchable.length}/${pendingKeys.length} 个待处理簇有候选，${pendingKeys.length - matchable.length} 个未命中（直接判 null）`);

  if (matchable.length === 0) {
    const final = queries.map((_, i) => confirmedByIndex.get(i) || null);
    console.log(`[match_variant] matchVariantsTogether ✓ 完成：${final.filter(Boolean).length}/${queries.length}`);
    return final;
  }

  // Step 3: 一次性选组件集，每个簇一个代表（而非每条实例一个）
  console.log(`[match_variant] Step 3：${matchable.length} 个簇一次性交给 LLM 选组件集`);
  const pickedEntries = await selectComponentSetsTogether(matchable, anchorNote);

  // Step 4: 按组件集分组，每组一次性选变体，picks 广播给簇内所有原始索引
  const groups = new Map();
  matchable.forEach((ci, i) => {
    const entry = pickedEntries[i];
    if (!entry) return;
    if (!groups.has(entry)) groups.set(entry, []);
    groups.get(entry).push(ci);
  });
  console.log(`[match_variant] Step 4：按组件集分成 ${groups.size} 组（${[...groups.entries()].map(([e, g]) => `${e.name}×${g.length}`).join('、') || '(无)'}）`);

  const resultByIndex = new Map(confirmedByIndex);
  const newMapEntries = [];

  for (const [entry, groupItems] of groups) {
    const picks = await selectVariantsTogether(entry, groupItems, anchorNote);
    groupItems.forEach((ci, j) => {
      const pick = picks[j];
      const result = toMatchResult(entry, pick);
      ci.clusterIndices.forEach(i => resultByIndex.set(i, result));
      if (pick && (pick.variantKey != null || (entry.variants || []).length === 0)) {
        newMapEntries.push({ key: ci.clusterKey, componentKey: entry.componentKey || entry.guid, variantKey: pick.variantKey || null });
      }
    });
  }

  // Step 5: 沉淀新结果到规范映射表
  if (newMapEntries.length > 0) {
    await updateCanonicalMap(newMapEntries);
  }

  const final = queries.map((_, i) => resultByIndex.get(i) || null);
  console.log(`[match_variant] matchVariantsTogether ✓ 完成：${final.filter(Boolean).length}/${queries.length}`);
  return final;
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

async function matchVariant(description) {
  const { entries } = loadIndex();
  const canonicalMap = loadCanonicalMap();
  console.log(`[match_variant] matchVariant 开始：「${description}」`);

  // 查规范映射表（0 次 LLM 快速返回）
  const cKey = canonicalKey(description);
  const mapped = canonicalMap[cKey];
  if (mapped) {
    const comp = entries.find(e => (e.componentKey || e.guid) === mapped.componentKey);
    const variant = comp && mapped.variantKey
      ? (comp.variants || []).find(v => (v.variantKey || v.guid) === mapped.variantKey)
      : null;
    if (comp && (mapped.variantKey == null || variant)) {
      console.log(`[match_variant] matchVariant → 规范映射表命中，跳过 LLM`);
      return toMatchResult(comp, { variantKey: mapped.variantKey, reason: '' });
    }
    console.log(`[match_variant] matchVariant → 规范映射表条目已失效（组件或变体不存在），重新裁决`);
    delete canonicalMap[cKey];
  }

  // Step 1: 若描述已含充足中文（非空白占比 ≥ 30%），跳过语义提取
  const nonSpace = description.replace(/\s/g, '');
  const chineseCount = (nonSpace.match(/[一-鿿]/g) || []).length;
  let searchQuery;
  if (nonSpace.length > 0 && chineseCount / nonSpace.length >= 0.3) {
    console.log(`[match_variant] matchVariant → 描述已含中文（${Math.round(chineseCount / nonSpace.length * 100)}%），跳过语义提取`);
    searchQuery = description;
  } else {
    searchQuery = await normalizeQuery(description);
  }

  // Step 2: 本地过滤
  const candidates = localFilter(searchQuery, entries, 10);
  if (candidates.length === 0) return null;

  // Step 3a: LLM 选组件集（轻量 prompt，不含变体明细）
  const entry = await selectComponentSet(description, candidates);
  if (!entry) return null;

  // Step 3b: LLM 在选定组件集内精选变体（仅传该集合自己的变体）
  const picked = await selectVariant(description, entry);
  if (!picked) return null;

  const result = toMatchResult(entry, picked);

  // 沉淀到规范映射表
  await updateCanonicalMap([{ key: cKey, componentKey: result.componentKey, variantKey: picked.variantKey || null }]);
  return result;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

// 跨平台读取 stdin：/dev/stdin 是 Unix 专属特殊文件，Windows 上不存在
// （会抛 ENOENT），用 process.stdin 流读取在三大平台上行为一致
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

if (require.main === module) {
  (async () => {
    let description;
    if (process.argv[2]) {
      description = process.argv[2];
    } else {
      description = JSON.parse(await readStdin()).description;
    }
    return matchVariant(description);
  })()
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { matchVariant, matchVariantsTogether, clearIndexCache };
