'use strict';

const fs   = require('fs');
const path = require('path');

const { matchVariant, clearIndexCache } = require('./match_variant');
const { matchVariants }                  = require('./batch_match');
const { matchDsl, matchDslSingle }       = require('./match_dsl');
const { splitLibrary }                   = require('./split_lib');
const { loadSources, saveSources, rebuildIndex, SEARCH_INDEX_PATH } = require('./rebuild_index');

const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [k, v] = trimmed.split('=');
    if (k && v && !process.env[k.trim()]) process.env[k.trim()] = v.trim();
  });
}

const LIB_OUT_DIR = process.env.LIB_OUT_DIR
  || path.resolve(__dirname, '../../pixso-parse/pix-split/lib-out');

const hexPathMap = new Map();

function init() {
  const loadedCount = buildHexPathMap();
  console.log(`[component-service core] hex 索引加载成功: ${loadedCount} 个 key（来源: ${SEARCH_INDEX_PATH}）`);
  return { hexKeys: loadedCount };
}

function buildHexPathMap() {
  if (!fs.existsSync(SEARCH_INDEX_PATH)) {
    console.warn('[component-service core] search_index.json 不存在');
    return 0;
  }
  const { entries } = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf8'));
  hexPathMap.clear();
  for (const entry of entries) {
    if (!entry.hexFile || !entry.source) continue;
    const key = path.basename(entry.hexFile, path.extname(entry.hexFile));
    hexPathMap.set(key, path.join(LIB_OUT_DIR, entry.source, entry.hexFile));
  }
  return hexPathMap.size;
}

const KEY_RE = /^([a-f0-9]{40}|\d+_\d+)$/;

async function match(description) {
  return await matchVariant(description.trim());
}

async function batch(descriptions) {
  return await matchVariants(descriptions.map(d => d?.trim?.() ?? d));
}

async function matchDslNodes(nodeData) {
  return await matchDsl(nodeData);
}

async function matchDslNodesSingle(nodeData) {
  return await matchDslSingle(nodeData);
}

function getHex(key) {
  if (!KEY_RE.test(key)) {
    throw new Error('key must be a 40-char lowercase hex string or {sessionId}_{localId}');
  }

  const filePath = hexPathMap.get(key);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`component not found: ${key}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

async function split(pixBuffer, opts) {
  return await splitLibrary(pixBuffer, opts);
}

function getSources() {
  return loadSources();
}

function addSource(key, label) {
  const SOURCE_DIR_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  if (!key || !SOURCE_DIR_RE.test(key)) {
    throw new Error('key must be a simple directory name (letters/digits/-/_, no path separators), matching the lib-out/ subdirectory');
  }
  if (!label) {
    throw new Error('label is required');
  }

  const sources = loadSources();
  if (sources.some(s => s.key === key)) {
    throw new Error(`source already registered: ${key}`);
  }

  sources.push({ key, label });
  saveSources(sources);
  return sources;
}

function rebuild() {
  const result = rebuildIndex(LIB_OUT_DIR);
  const hexKeys = buildHexPathMap();
  clearIndexCache();
  return { ...result, hex_keys: hexKeys };
}

function getStats() {
  return { hex_keys: hexPathMap.size };
}

module.exports = {
  init,
  match,
  batch,
  matchDslNodes,
  matchDslNodesSingle,
  getHex,
  split,
  getSources,
  addSource,
  rebuild,
  getStats,
};