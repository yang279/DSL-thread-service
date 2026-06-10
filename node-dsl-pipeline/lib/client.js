'use strict';

const fs = require('fs');
const { IPCManager } = require('./ipc-manager');

class ServiceClient {
  constructor(baseDir = __dirname) {
    this.ipcManager = new IPCManager();
    this.baseDir = baseDir;
  }

  async init() {
    await this.ipcManager.startAll(this.baseDir);
  }

  async callIconAgentResolve(inputPath) {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    return await this.ipcManager.call('iconAgent', 'resolve', data);
  }

  async callIconAgentResolveFromData(data) {
    return await this.ipcManager.call('iconAgent', 'resolve', data);
  }

  async callComponentMatchDsl(inputPath) {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    return await this.ipcManager.call('componentService', 'match-dsl', data);
  }

  async callComponentMatchDslFromData(data) {
    return await this.ipcManager.call('componentService', 'match-dsl', data);
  }

  async callDslToHexConvert(dsl) {
    return await this.ipcManager.call('dslToHex', 'convert', dsl);
  }

  stop() {
    this.ipcManager.stopAll();
  }
}

module.exports = { ServiceClient };
