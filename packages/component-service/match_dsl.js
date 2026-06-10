#!/usr/bin/env node
'use strict';

const { matchVariantsTogether } = require('./match_variant');
const { matchVariants }         = require('./batch_match');

// 参与匹配的 semantic 类型
const MATCHABLE = new Set(['button', 'input', 'navbar', 'tabbar', 'switch', 'badge', 'avatar']);

// semantic → 中文提示，拼入 query 帮助本地过滤和 LLM 理解
const SEMANTIC_HINT = {
  button: '按钮',
  input:  '输入框',
  navbar: '导航栏',
  tabbar: '标签栏',
  switch: '开关',
  badge:  '角标',
  avatar: '头像',
};

// 递归收集所有需要匹配的节点
function collectNodes(nodeOrArray, result = []) {
  if (Array.isArray(nodeOrArray)) {
    nodeOrArray.forEach(n => collectNodes(n, result));
    return result;
  }
  const node = nodeOrArray;
  if (!node || typeof node !== 'object') return result;

  if (MATCHABLE.has(node.semantic)) {
    result.push({ nid: node.nid, semantic: node.semantic, label: node.label });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => collectNodes(child, result));
  }
  return result;
}

// 把 label + semantic hint 拼成更精准的查询词
function buildQuery(label, semantic) {
  const hint = SEMANTIC_HINT[semantic] || '';
  // 如果 label 里已经包含 hint，就不重复添加
  if (hint && !label.includes(hint)) {
    return `${label} ${hint}`;
  }
  return label;
}

function buildMatchResult(nodes, matches) {
  return nodes.map((n, i) => ({
    nid:      n.nid,
    semantic: n.semantic,
    label:    n.label,
    match:    matches[i] || null,
  }));
}

// 整页统一匹配：本页所有实例合并成一次 LLM 裁决（见 matchVariantsTogether），
// 让模型看到全局上下文后统一选择，避免同语义的多个实例（如多个"确定按钮"）
// 被分别选到不一致的组件集/变体——/match-dsl 走这个
async function matchDsl(nodeOrArray) {
  const nodes = collectNodes(nodeOrArray);
  console.log(`[match_dsl] matchDsl（整页统一匹配）→ 提取到 ${nodes.length} 个可匹配节点`);
  if (nodes.length === 0) return [];

  const queries = nodes.map(n => buildQuery(n.label, n.semantic));
  console.log(`[match_dsl] matchDsl → 查询词：${JSON.stringify(queries)}`);
  const matches = await matchVariantsTogether(queries);
  const hit = matches.filter(Boolean).length;
  console.log(`[match_dsl] matchDsl ✓ 完成：${nodes.length} 个节点中命中 ${hit} 个`);
  return buildMatchResult(nodes, matches);
}

// 逐节点独立匹配：每个实例各自跑一遍完整的三步流程（语义提取→选组件集→选变体），
// 互不知情，可能导致同语义的多个实例被分别选到不一致的结果——保留给
// /match-dsl-single，供需要对照旧行为或排查问题时使用
async function matchDslSingle(nodeOrArray) {
  const nodes = collectNodes(nodeOrArray);
  console.log(`[match_dsl] matchDslSingle（逐节点独立匹配）→ 提取到 ${nodes.length} 个可匹配节点`);
  if (nodes.length === 0) return [];

  const queries = nodes.map(n => buildQuery(n.label, n.semantic));
  console.log(`[match_dsl] matchDslSingle → 查询词：${JSON.stringify(queries)}`);
  const matches = await matchVariants(queries);
  const hit = matches.filter(m => m && !m.error).length;
  console.log(`[match_dsl] matchDslSingle ✓ 完成：${nodes.length} 个节点中命中 ${hit} 个`);
  return buildMatchResult(nodes, matches);
}

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

// CLI：node match_dsl.js < node.json
if (require.main === module) {
  readStdin()
    .then(raw => matchDsl(JSON.parse(raw)))
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { matchDsl, matchDslSingle };
