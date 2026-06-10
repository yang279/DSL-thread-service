'use strict';

const { ServiceClient } = require('./client');
const { enrich }         = require('./enrich');
const { buildDesignDsl } = require('./design-dsl');
const { exportHex }      = require('./export-hex');

async function runPipeline(inputData, options = {}) {
  const { pageName = 'Page 1', skipEnrich = false, outDir = null } = options;

  const client = new ServiceClient();
  await client.init();

  try {
    let finalSchema = inputData;
    if (!skipEnrich) {
      finalSchema = await enrichFromData(inputData, client);
    }

    const dsl    = buildDesignDsl(finalSchema, pageName);
    const result = await exportHex(dsl, outDir, client);
    return result;
  } finally {
    client.stop();
  }
}

async function enrichFromData(inputData, client) {
  const [iconResult, componentResult] = await Promise.all([
    client.callIconAgentResolveFromData(inputData),
    client.callComponentMatchDslFromData(inputData),
  ]);

  let base = inputData;
  if (iconResult?.success && iconResult.content) {
    base = iconResult.content;
  }

  if (Array.isArray(componentResult)) {
    for (const item of componentResult) {
      if (!item?.match) continue;
      const node = findByNid(base, item.nid);
      if (node) node.component = item.match;
    }
  }

  return base;
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

module.exports = { runPipeline, ServiceClient };
