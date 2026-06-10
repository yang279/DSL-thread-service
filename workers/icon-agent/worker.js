'use strict';

// ── 环境变量 ──────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

// ── 前置校验 ──────────────────────────────────────────────────────────────────
if (!process.send) {
  console.error('[icon-agent] 必须通过 child_process.fork 启动');
  process.exit(1);
}

const core = require('./core');

if (typeof core.init !== 'function') {
  const msg = '[icon-agent] core 必须导出 init() 方法';
  console.error(msg);
  process.send({ type: 'error', id: 'init', error: msg });
  process.exit(1);
}

// ── 消息处理 ──────────────────────────────────────────────────────────────────
async function handleMessage(msg) {
  if (msg.type !== 'request' || !msg.id || !msg.method) {
    process.send({ type: 'error', id: msg.id || 'unknown', error: 'invalid message format' });
    return;
  }

  const { id, method, data } = msg;

  try {
    let result;
    switch (method) {
      case 'resolve':
        result = await core.resolve(data);
        process.send({ type: 'response', id, data: { success: true, content: result } });
        break;

      case 'health':
        result = typeof core.getStats === 'function' ? core.getStats() : {};
        process.send({ type: 'response', id, data: { status: 'ok', ...result } });
        break;

      default:
        process.send({ type: 'error', id, error: `unknown method: ${method}` });
    }
  } catch (err) {
    console.error(`[icon-agent] ${method} 失败:`, err.message);
    process.send({ type: 'error', id, error: err.message });
  }
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
Promise.resolve(core.init()).then(() => {
  process.on('message', handleMessage);
  process.send({ type: 'ready' });
  console.log('[icon-agent] 就绪');
}).catch(err => {
  console.error('[icon-agent] 初始化失败:', err.message);
  process.send({ type: 'error', id: 'init', error: err.message });
  process.exit(1);
});
