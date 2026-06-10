'use strict';

const http      = require('http');
const path      = require('path');
const fs        = require('fs');
const { convert, getWasm, HEX_LIB_DIR } = require('./converter');

const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, v] = line.split('=');
    if (k && v && !process.env[k.trim()]) process.env[k.trim()] = v.trim();
  });
}

const PORT = Number(process.env.PORT) || 3101;

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJSON(res, 200, { status: 'ok' });
  }

  if (req.method === 'POST' && url.pathname === '/convert') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJSON(res, 400, { error: 'invalid JSON body' });
    }

    const { dsl } = body;
    if (!dsl || typeof dsl !== 'object') {
      return sendJSON(res, 400, { error: 'dsl (object) is required' });
    }
    if (!Array.isArray(dsl.pages)) {
      return sendJSON(res, 400, { error: 'dsl.pages must be an array' });
    }

    const result = await convert(dsl);

    if (result.error) return sendJSON(res, 500, result);
    return sendJSON(res, 200, result);
  }

  sendJSON(res, 404, { error: 'not found' });
}

async function main() {
  console.log('[dsl-to-hex HTTP] 预热 WASM...');
  try {
    await getWasm();
    console.log('[dsl-to-hex HTTP] WASM 加载成功');
  } catch (e) {
    console.error('[dsl-to-hex HTTP] WASM 加载失败:', e.message);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error('[dsl-to-hex HTTP] 请求处理异常:', err);
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal server error' });
    });
  });

  server.listen(PORT, () => {
    console.log(`\n[dsl-to-hex HTTP] DSL转hex服务已启动: http://localhost:${PORT}`);
    console.log(`HEX_LIB_DIR: ${HEX_LIB_DIR}\n`);
  });
}

main();