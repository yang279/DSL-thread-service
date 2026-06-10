'use strict';

const fs   = require('fs');
const path = require('path');
const { convert, getWasm } = require('./converter');

const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, v] = line.split('=');
    if (k && v && !process.env[k.trim()]) process.env[k.trim()] = v.trim();
  });
}

if (!process.send) {
  console.error('[dsl-to-hex worker] 未在子进程环境中运行（process.send 不存在）');
  process.exit(1);
}

async function init() {
  console.log('[dsl-to-hex worker] 预热 WASM...');
  try {
    await getWasm();
    console.log('[dsl-to-hex worker] WASM 加载成功');
  } catch (e) {
    console.error('[dsl-to-hex worker] WASM 加载失败:', e.message);
    process.send({ type: 'error', id: 'init', error: e.message });
    process.exit(1);
  }
}

function handleMessage(msg) {
  if (msg.type !== 'request' || !msg.id || !msg.method) {
    process.send({ type: 'error', id: msg.id || 'unknown', error: 'invalid message format' });
    return;
  }

  const { id, method, data } = msg;

  (async () => {
    try {
      let result;
      switch (method) {
        case 'convert':
          result = await convert(data);
          if (result.error) {
            process.send({ type: 'response', id, data: { error: result.error } });
          } else {
            process.send({ type: 'response', id, data: result });
          }
          break;

        case 'health':
          process.send({ type: 'response', id, data: { status: 'ok' } });
          break;

        default:
          process.send({ type: 'error', id, error: `unknown method: ${method}` });
      }
    } catch (err) {
      console.error('[dsl-to-hex worker] 处理失败:', err.message);
      process.send({ type: 'error', id, error: err.message });
    }
  })();
}

init().then(() => {
  console.log('[dsl-to-hex worker] 初始化完成，开始监听 IPC 消息');
  process.on('message', handleMessage);
  process.send({ type: 'ready' });
}).catch(err => {
  console.error('[dsl-to-hex worker] 初始化失败:', err);
  process.exit(1);
});