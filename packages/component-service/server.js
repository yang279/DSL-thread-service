#!/usr/bin/env node
'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const multer  = require('multer');
const core    = require('./core');

const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [k, v] = trimmed.split('=');
    if (k && v && !process.env[k.trim()]) process.env[k.trim()] = v.trim();
  });
}

const app    = express();
const PORT   = Number(process.env.PORT) || 3102;
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

function logRouteError(label, err, extra) {
  const extraStr = extra ? ` (${extra})` : '';
  console.error(`[${new Date().toISOString()}] ${label}${extraStr} 失败：${err.message}`);
}

const MAX_DESCRIPTION_LENGTH = 200;

function checkDescription(desc) {
  if (desc === undefined || desc === null || desc === '') {
    return 'description is required';
  }
  if (typeof desc !== 'string') {
    return 'description must be a string';
  }
  const trimmed = desc.trim();
  if (!trimmed) {
    return 'description is required';
  }
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return `description too long (max ${MAX_DESCRIPTION_LENGTH} chars) — pass a short natural-language description, not a serialized object`;
  }
  if (/^[{\[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'description must be a short natural-language text, not a serialized JSON object/array — extract a field like label/name first';
    } catch {}
  }
  return null;
}

const SOURCE_DIR_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

app.get('/health', (req, res) => {
  const stats = core.getStats();
  res.json({ status: 'ok', hex_keys: stats.hex_keys });
});

app.get('/sources', (req, res) => {
  res.json({ sources: core.getSources() });
});

app.post('/sources', (req, res) => {
  const key   = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';

  try {
    const sources = core.addSource(key, label);
    res.json({ sources });
  } catch (err) {
    if (err.message.includes('already registered')) {
      res.status(409).json({ error: err.message });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

app.post('/rebuild-index', (req, res) => {
  try {
    const result = core.rebuild();
    res.json(result);
  } catch (err) {
    logRouteError('POST /rebuild-index', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/match', async (req, res) => {
  const { description } = req.body || {};
  const descErr = checkDescription(description);
  if (descErr) {
    return res.status(400).json({ error: descErr });
  }
  try {
    const result = await core.match(description);
    if (!result) return res.status(404).json({ error: 'no match found' });
    res.json(result);
  } catch (err) {
    logRouteError('POST /match', err, `description="${description.trim()}"`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/batch', async (req, res) => {
  const body = req.body;
  let descriptions;

  if (Array.isArray(body)) {
    descriptions = body.map(x => (typeof x === 'string' ? x : x.description));
  } else if (Array.isArray(body?.descriptions)) {
    descriptions = body.descriptions;
  } else {
    return res.status(400).json({ error: 'body must be an array or { descriptions: [] }' });
  }

  if (descriptions.length === 0) {
    return res.status(400).json({ error: 'descriptions array is empty' });
  }
  if (descriptions.length > 100) {
    return res.status(400).json({ error: 'max 100 descriptions per request' });
  }

  const invalid = [];
  descriptions.forEach((d, i) => {
    const err = checkDescription(d);
    if (err) invalid.push({ index: i, error: err });
  });
  if (invalid.length > 0) {
    return res.status(400).json({ error: 'invalid descriptions', details: invalid });
  }

  try {
    const results = await core.batch(descriptions);
    res.json(results);
  } catch (err) {
    logRouteError('POST /batch', err, `${descriptions.length} 条描述`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/match-dsl', upload.single('file'), async (req, res) => {
  let nodeData;

  if (req.file) {
    try {
      nodeData = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'uploaded file is not valid JSON' });
    }
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    nodeData = req.body;
  } else {
    return res.status(400).json({ error: 'send a file via -F "file=@page.json" or a JSON body' });
  }

  try {
    const results = await core.matchDslNodes(nodeData);
    res.json(results);
  } catch (err) {
    logRouteError('POST /match-dsl', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/match-dsl-single', upload.single('file'), async (req, res) => {
  let nodeData;

  if (req.file) {
    try {
      nodeData = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'uploaded file is not valid JSON' });
    }
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    nodeData = req.body;
  } else {
    return res.status(400).json({ error: 'send a file via -F "file=@page.json" or a JSON body' });
  }

  try {
    const results = await core.matchDslNodesSingle(nodeData);
    res.json(results);
  } catch (err) {
    logRouteError('POST /match-dsl-single', err);
    res.status(500).json({ error: err.message });
  }
});

const SPLIT_UPLOAD_LIMIT = 200 * 1024 * 1024;
const splitUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SPLIT_UPLOAD_LIMIT } });

app.post('/split', splitUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'send a .pix file via -F "file=@library.pix"' });
  }

  const publishFile = typeof req.body?.publishFile === 'string' ? req.body.publishFile.trim() : '';
  const source      = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
  if (source && !SOURCE_DIR_RE.test(source)) {
    return res.status(400).json({ error: 'source must be a simple directory name (letters/digits/-/_, no path separators)' });
  }

  try {
    const opts = { originalName: req.file.originalname, publishFile };
    if (source) {
      opts.source  = source;
      opts.saveDir = path.join(process.env.LIB_OUT_DIR || path.resolve(__dirname, '../../pixso-parse/pix-split/lib-out'), source);
    }

    const result = await core.split(req.file.buffer, opts);
    if (result.error) return res.status(500).json({ error: result.error });
    res.json(result);
  } catch (err) {
    logRouteError('POST /split', err, req.file.originalname);
    res.status(500).json({ error: err.message });
  }
});

const KEY_RE = /^([a-f0-9]{40}|\d+_\d+)$/;

app.get('/hex/:key', (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) {
    return res.status(400).json({ error: 'key must be a 40-char lowercase hex string or {sessionId}_{localId}' });
  }

  try {
    const content = core.getHex(key);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

core.init();

app.listen(PORT, () => {
  console.log(`[component-service HTTP] 已启动: http://localhost:${PORT}`);
  console.log(`LIB_OUT_DIR: ${process.env.LIB_OUT_DIR || path.resolve(__dirname, '../../pixso-parse/pix-split/lib-out')}`);
});