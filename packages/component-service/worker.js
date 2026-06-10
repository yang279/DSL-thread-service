'use strict';

const core = require('./core');

if (!process.send) {
  console.error('[component-service worker] 未在子进程环境中运行（process.send 不存在）');
  process.exit(1);
}

core.init();

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
        case 'match':
          result = await core.match(data.description);
          if (!result) {
            process.send({ type: 'response', id, data: { error: 'no match found' } });
          } else {
            process.send({ type: 'response', id, data: result });
          }
          break;

        case 'batch':
          result = await core.batch(data.descriptions);
          process.send({ type: 'response', id, data: result });
          break;

        case 'match-dsl':
          result = await core.matchDslNodes(data);
          process.send({ type: 'response', id, data: result });
          break;

        case 'match-dsl-single':
          result = await core.matchDslNodesSingle(data);
          process.send({ type: 'response', id, data: result });
          break;

        case 'hex':
          result = core.getHex(data.key);
          process.send({ type: 'response', id, data: result });
          break;

        case 'split':
          const opts = { originalName: data.originalName, publishFile: data.publishFile };
          if (data.source) {
            opts.source = data.source;
            opts.saveDir = require('path').join(require('./core').LIB_OUT_DIR || process.env.LIB_OUT_DIR, data.source);
          }
          result = await core.split(Buffer.from(data.pixBuffer, 'base64'), opts);
          process.send({ type: 'response', id, data: result });
          break;

        case 'sources':
          result = core.getSources();
          process.send({ type: 'response', id, data: { sources: result } });
          break;

        case 'add-source':
          result = core.addSource(data.key, data.label);
          process.send({ type: 'response', id, data: { sources: result } });
          break;

        case 'rebuild-index':
          result = core.rebuild();
          process.send({ type: 'response', id, data: result });
          break;

        case 'health':
          const stats = core.getStats();
          process.send({ type: 'response', id, data: { status: 'ok', hex_keys: stats.hex_keys } });
          break;

        default:
          process.send({ type: 'error', id, error: `unknown method: ${method}` });
      }
    } catch (err) {
      console.error(`[component-service worker] ${method} 失败：${err.message}`);
      process.send({ type: 'error', id, error: err.message });
    }
  })();
}

process.on('message', handleMessage);
process.send({ type: 'ready' });
console.log('[component-service worker] 初始化完成，开始监听 IPC 消息');