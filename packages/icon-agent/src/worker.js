'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const core = require('./core');

if (!process.send) {
  console.error('[iconAgent worker] 未在子进程环境中运行（process.send 不存在）');
  process.exit(1);
}

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
        process.send({ type: 'response', id, data: { content: result, errorCode: 200, errorMessage: '', success: true } });
        break;
      case 'search':
        result = await core.search(data.keyword);
        process.send({ type: 'response', id, data: { content: result, errorCode: 200, errorMessage: '', success: true } });
        break;
      case 'health':
        const stats = core.getStats();
        process.send({ type: 'response', id, data: { content: { status: 'ok', icons: stats.icons }, errorCode: 200, errorMessage: '', success: true } });
        break;
      default:
        process.send({ type: 'error', id, error: `unknown method: ${method}` });
    }
  } catch (err) {
    console.error('[iconAgent worker] 处理失败:', err.message);
    process.send({ type: 'error', id, error: err.message });
  }
}

core.init().then(() => {
  console.log('[iconAgent worker] 初始化完成，开始监听 IPC 消息');
  process.on('message', handleMessage);
  process.send({ type: 'ready' });
}).catch(err => {
  console.error('[iconAgent worker] 初始化失败:', err);
  process.send({ type: 'error', id: 'init', error: err.message });
  process.exit(1);
});