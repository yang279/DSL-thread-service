'use strict';

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { pipeline, env } = require('@huggingface/transformers');
const VectorStore = require('./vectorStore');
const modifySvg = require('../iconFunction');

if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
}

const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
const ICONS_PATH = path.resolve(__dirname, '../iconJson/icons.json');
const INDEX_PATH = path.resolve(__dirname, '../iconJson/index.bin');
const EMBED_MODEL = 'Xenova/bge-large-zh-v1.5';
const BGE_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
const LLM_MODEL = 'deepseek-chat';

const llm = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
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

let iconsData;
let iconMap;
let vectorStore;
let embedder;

async function init() {
  console.log('[iconAgent] 加载嵌入模型...');
  embedder = await pipeline('feature-extraction', EMBED_MODEL);

  iconsData = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf-8'));
  iconMap = new Map(iconsData.map(i => [i.id, i]));

  vectorStore = new VectorStore(INDEX_PATH).load();
  console.log(`[iconAgent] 已加载 ${iconsData.length} 个图标，HNSW 索引就绪`);

  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function traverseAndResolve(obj, results) {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      traverseAndResolve(item, results);
    }
  } else if (obj && typeof obj === 'object') {
    if (obj.semantic === 'icon' && obj.label) {
      results.push(obj);
    }
    for (const key of Object.keys(obj)) {
      traverseAndResolve(obj[key], results);
    }
  }
}

async function parseLabel(label) {
  const response = await llm.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: label },
    ],
    temperature: 0.1,
    max_tokens: 100,
  });
  const raw = response.choices[0].message.content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[^}]+\}/);
    if (match) return JSON.parse(match[0]);
    return { name: raw, color: '', size: '', borderSize: '', styled: '' };
  }
}

async function resolveIcon(iconObj) {
  const label = iconObj.label;
  const parsed = await parseLabel(label);
  console.log(`[iconAgent] label: "${label}" → 解析:`, parsed);

  const searchKeyword = BGE_QUERY_PREFIX + parsed.name;
  const output = await embedder(searchKeyword, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data);
  const candidates = vectorStore.search(queryVec, 1);
  const best = candidates[0];
  const icon = iconMap.get(best.id);

  const finalSvg = modifySvg(icon.svg, parsed.size, parsed.color, parsed.borderSize, parsed.styled);
  iconObj.iconSvg = finalSvg;
}

async function resolve(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON 内容必须为对象或数组');
  }

  const iconNodes = [];
  traverseAndResolve(data, iconNodes);

  for (const node of iconNodes) {
    await resolveIcon(node);
  }

  return data;
}

async function search(keyword) {
  if (!keyword) {
    throw new Error('缺少 keyword 参数');
  }

  const parsed = await parseLabel(keyword);
  const queryText = BGE_QUERY_PREFIX + parsed.name;

  const output = await embedder(queryText, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data);
  const candidates = vectorStore.search(queryVec, 5);
  const best = candidates[0];
  const icon = iconMap.get(best.id);

  const finalSvg = modifySvg(icon.svg, parsed.size, parsed.color, parsed.borderSize, parsed.styled);

  return {
    match: { id: icon.id, name: icon.name, description: icon.description, svg: finalSvg, score: best.score },
    candidates: candidates.slice(1, 5).map(c => {
      const ci = iconMap.get(c.id);
      return { id: c.id, name: ci.name, description: ci.description, score: c.score };
    }),
  };
}

function getStats() {
  return { icons: iconsData.length };
}

module.exports = {
  init,
  resolve,
  search,
  getStats,
};