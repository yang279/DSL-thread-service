'use strict';

const { fork } = require('child_process');
const path     = require('path');

class IPCManager {
  constructor() {
    this.workers = {};
    this.pending = {};
    this.requestId = 0;
  }

  async startService(serviceName, workerPath) {
    if (this.workers[serviceName]) {
      return this.workers[serviceName];
    }

    const absPath = path.resolve(workerPath);
    const worker = fork(absPath, [], { silent: false });

    this.workers[serviceName] = worker;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[IPCManager] ${serviceName} 启动超时`));
      }, 30000);

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          console.log(`[IPCManager] ${serviceName} 已启动`);
          resolve(worker);
        } else if (msg.type === 'error' && msg.id === 'init') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        } else {
          this.handleMessage(msg);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[IPCManager] ${serviceName} 异常退出 (code ${code})`);
          this.workers[serviceName] = null;
        }
      });
    });
  }

  handleMessage(msg) {
    const { id, type } = msg;
    if (this.pending[id]) {
      const { resolve, reject, timeout } = this.pending[id];
      clearTimeout(timeout);
      delete this.pending[id];

      if (type === 'response') {
        resolve(msg.data);
      } else if (type === 'error') {
        reject(new Error(msg.error));
      }
    }
  }

  async call(serviceName, method, data, timeoutMs = 60000) {
    const worker = this.workers[serviceName];
    if (!worker) {
      throw new Error(`[IPCManager] ${serviceName} 未启动`);
    }

    const id = `${serviceName}-${++this.requestId}`;
    const msg = { type: 'request', id, method, data };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        delete this.pending[id];
        reject(new Error(`[IPCManager] ${serviceName}.${method} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending[id] = { resolve, reject, timeout };
      worker.send(msg);
    });
  }

  async startAll(baseDir) {
    await Promise.all([
      this.startService('iconAgent',        path.join(baseDir, '../icon-agent/src/worker.js')),
      this.startService('componentService', path.join(baseDir, '../component-service/worker.js')),
      this.startService('dslToHex',         path.join(baseDir, '../dsl-to-hex/worker.js')),
    ]);
    console.log('[IPCManager] 所有服务已启动');
  }

  stopAll() {
    for (const [name, worker] of Object.entries(this.workers)) {
      if (worker) {
        worker.kill();
        console.log(`[IPCManager] ${name} 已停止`);
      }
    }
    this.workers = {};
  }
}

module.exports = { IPCManager };