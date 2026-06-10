'use strict';
const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

function libFor(url) {
  return new URL(url).protocol === 'https:' ? https : http;
}

function request(url, { method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = libFor(url);
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.pathname + parsed.search,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** POST application/json，返回解析后的 JSON */
async function postJson(url, payload) {
  const data = JSON.stringify(payload);
  const res  = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    body: data,
  });
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${res.body.toString('utf8')}`);
  return JSON.parse(res.body.toString('utf8'));
}

/** POST multipart/form-data 上传单个文件（字段名固定为 file），返回解析后的 JSON */
async function postFile(url, filePath, fieldName = 'file') {
  const boundary  = '----nodeDslPipeline' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const fileBuf   = fs.readFileSync(filePath);
  const fileName  = path.basename(filePath);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
    `Content-Type: application/json\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuf, tail]);

  const res = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type':   `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
  const text = res.body.toString('utf8');
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}: ${text}`);
  return JSON.parse(text);
}

module.exports = { postJson, postFile };
