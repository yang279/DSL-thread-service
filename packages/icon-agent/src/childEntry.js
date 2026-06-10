'use strict';
const path = require('path');
const fs   = require('fs');

// 显式指向 wonderfulj-main 根目录的 .env，避免 CWD 不同时 dotenv 默认路径失效
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { pipeline, env } = require('@huggingface/transformers');
const OpenAI    = require('openai');
const VectorStore = require('./vectorStore');
const modifySvg = require('../iconFunction');

if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
}

const ICONS_PATH       = path.resolve(__dirname, '../iconJson/icons.json');
const INDEX_PATH       = path.resolve(__dirname, '../iconJson/index.bin');
const EMBED_MODEL      = 'Xenova/bge-large-zh-v1.5';
const BGE_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
const LLM_MODEL        = 'deepseek-chat';

const llm = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const LLM_SYSTEM_PROMPT = `你是一个图标描述分析器。用户会给你一段描述图标的文字（可能是中文或英文），你需要从中提取出图标名称和样式属性信息，输出为JSON对象。

规则：
1. name字段：提取简洁的中文关键词（2-4个字），用于图标库搜索。英文要翻译成中文，描述要提取核心含义
2. size字段：提取图标大小（数字部分），如"24×24"提取"24"，如"16px"提取"16"
3. color字段：提取颜色信息，如"红色"提取"红色"，如"#ff0000"提取"#ff0000"
4. borderSize字段：提取线条粗细描述，如"粗线"提取"粗"，如"细线"提取"细"，如"2px线"提取"2"
5. styled字段：提取线条风格，"线性/细线/描边"输出"border"，"面性/填充/实心"输出"filled"
6. 无法识别的属性取空字符串""
7. 只输出JSON对象，不要输出任何其他内容

示例：
输入：download → 输出：{"name":"下载","color":"","size":"","borderSize":"","styled":""}
输入：下载图标 24×24 细线 → 输出：{"name":"下载","color":"","size":"24","borderSize":"细","styled":"border"}
输入：红色搜索图标 32px 填充 → 输出：{"name":"搜索","color":"红色","size":"32","borderSize":"","styled":"filled"}
输入：箭头 → 输出：{"name":"箭头","color":"","size":"","borderSize":"","styled":""}`;

let iconsData, iconMap, vectorStore, embedder;

async function init() {
  console.log('[icon-agent] 加载嵌入模型...');
  embedder    = await pipeline('feature-extraction', EMBED_MODEL);
  iconsData   = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf-8'));
  iconMap     = new Map(iconsData.map(i => [i.id, i]));
  vectorStore = new VectorStore(INDEX_PATH).load();
  console.log(`[icon-agent] 已加载 ${iconsData.length} 个图标，HNSW 索引就绪`);
}

function traverseAndResolve(obj, results) {
  if (Array.isArray(obj)) {
    for (const item of obj) traverseAndResolve(item, results);
  } else if (obj && typeof obj === 'object') {
    if (obj.semantic === 'icon' && obj.label) results.push(obj);
    for (const key of Object.keys(obj)) traverseAndResolve(obj[key], results);
  }
}

async function parseLabel(label) {
  const response = await llm.chat.completions.create({
    model:       LLM_MODEL,
    messages:    [{ role: 'system', content: LLM_SYSTEM_PROMPT }, { role: 'user', content: label }],
    temperature: 0.1,
    max_tokens:  100,
  });
  const raw = response.choices[0].message.content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[^}]+\}/);
    if (m) return JSON.parse(m[0]);
    return { name: raw, color: '', size: '', borderSize: '', styled: '' };
  }
}

async function resolveIcon(iconObj) {
  const parsed      = await parseLabel(iconObj.label);
  const queryVec    = Array.from(
    (await embedder(BGE_QUERY_PREFIX + parsed.name, { pooling: 'mean', normalize: true })).data
  );
  const best        = vectorStore.search(queryVec, 1)[0];
  const icon        = iconMap.get(best.id);
  iconObj.iconSvg   = modifySvg(icon.svg, parsed.size, parsed.color, parsed.borderSize, parsed.styled);
}

// ── 请求处理 ──────────────────────────────────────────────────────────────────

async function handleResolve(payload) {
  if (!payload || typeof payload !== 'object') {
    return { content: null, errorCode: 400, errorMessage: 'payload 必须为对象', success: false };
  }
  try {
    // 深拷贝避免修改调用方原始对象
    const data = JSON.parse(JSON.stringify(payload));
    const iconNodes = [];
    traverseAndResolve(data, iconNodes);
    for (const node of iconNodes) {
      await resolveIcon(node);
    }
    return { content: data, errorCode: 200, errorMessage: '', success: true };
  } catch (err) {
    console.error('[icon-agent] resolve 失败:', err.message);
    return { content: null, errorCode: 500, errorMessage: err.message, success: false };
  }
}

async function handleSearch(payload) {
  const keyword = payload?.keyword;
  if (!keyword) return { content: null, errorCode: 400, errorMessage: '缺少 keyword 参数', success: false };
  try {
    const parsed   = await parseLabel(keyword);
    const queryVec = Array.from(
      (await embedder(BGE_QUERY_PREFIX + parsed.name, { pooling: 'mean', normalize: true })).data
    );
    const candidates = vectorStore.search(queryVec, 5);
    const best       = candidates[0];
    const icon       = iconMap.get(best.id);
    const finalSvg   = modifySvg(icon.svg, parsed.size, parsed.color, parsed.borderSize, parsed.styled);
    return {
      content: {
        match:      { id: icon.id, name: icon.name, description: icon.description, svg: finalSvg, score: best.score },
        candidates: candidates.slice(1).map(c => {
          const ci = iconMap.get(c.id);
          return { id: c.id, name: ci.name, description: ci.description, score: c.score };
        }),
      },
      errorCode: 200, errorMessage: '', success: true,
    };
  } catch (err) {
    return { content: null, errorCode: 500, errorMessage: err.message, success: false };
  }
}

// ── IPC 消息分发 ──────────────────────────────────────────────────────────────

process.on('message', async (msg) => {
  if (!msg || msg.id === undefined) return;
  const { id, method, payload } = msg;
  try {
    let result;
    switch (method) {
      case 'resolve': result = await handleResolve(payload); break;
      case 'search':  result = await handleSearch(payload);  break;
      case 'health':  result = { status: 'ok', icons: iconsData?.length || 0 }; break;
      default: throw new Error(`未知 method: ${method}`);
    }
    process.send({ id, ok: true, result });
  } catch (err) {
    process.send({ id, ok: false, error: { message: err.message, code: err.code || 500 } });
  }
});

// ── 启动 ──────────────────────────────────────────────────────────────────────

init()
  .then(() => {
    process.send({ type: 'ready' });
    console.log('[icon-agent] IPC 子进程就绪');
  })
  .catch(err => {
    console.error('[icon-agent] 初始化失败:', err.message);
    process.exit(1);
  });
