'use strict';

const fs = require('fs');
const { ServiceClient } = require('./client');

function load(p)        { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function save(p, data)  { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8'); }

function errMessage(e) {
  return e.message || e.code || (e.errors || []).map(x => x.message).filter(Boolean).join('; ') || String(e);
}

function findByNid(node, nid) {
  if (!node || typeof node !== 'object') return null;
  if (node.nid === nid) return node;
  for (const child of node.children || []) {
    const found = findByNid(child, nid);
    if (found) return found;
  }
  return null;
}

async function enrich(inputPath, outDir, client) {
  const original = load(inputPath);
  const rawIconsPath      = `${outDir}/raw-icons.json`;
  const rawComponentsPath = `${outDir}/raw-components.json`;

  const [iconResult, componentResult] = await Promise.all([
    client.callIconAgentResolve(inputPath)
      .then(r => ({ ok: true,  data: r }))
      .catch(e => ({ ok: false, error: errMessage(e) })),
    client.callComponentMatchDsl(inputPath)
      .then(r => ({ ok: true,  data: r }))
      .catch(e => ({ ok: false, error: errMessage(e) })),
  ]);

  save(rawIconsPath,      iconResult.ok      ? iconResult.data      : { error: iconResult.error });
  save(rawComponentsPath, componentResult.ok ? componentResult.data : { error: componentResult.error });

  let base = original;
  let iconInjected = false;
  if (iconResult.ok && iconResult.data && iconResult.data.success && iconResult.data.content) {
    base = iconResult.data.content;
    iconInjected = true;
  } else {
    console.warn(`⚠ iconAgent 注入失败或无结果，使用原始 schema 继续：${iconResult.ok ? (iconResult.data && iconResult.data.errorMessage) : iconResult.error}`);
  }

  let componentInjected = 0;
  if (componentResult.ok && Array.isArray(componentResult.data)) {
    for (const item of componentResult.data) {
      if (!item || item.match == null) continue;
      const node = findByNid(base, item.nid);
      if (node) {
        node.component = item.match;
        componentInjected++;
      }
    }
  } else {
    console.warn(`⚠ Component Match 注入失败或无结果，跳过：${componentResult.ok ? JSON.stringify(componentResult.data) : componentResult.error}`);
  }

  const finalPath = `${outDir}/final.json`;
  save(finalPath, base);
  console.log(`✓ Step3/C 完成：iconSvg ${iconInjected ? '已注入' : '跳过'}，component 注入 ${componentInjected} 个节点 → ${finalPath}`);
  return base;
}

module.exports = { enrich, findByNid };