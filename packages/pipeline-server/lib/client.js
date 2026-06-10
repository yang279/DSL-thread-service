'use strict';

const fs = require('fs');
const os = require('os');
const { postJson, postFile } = require('./http-client');
const { IPCManager } = require('./ipc-manager');

class ServiceClient {
  constructor(mode = 'http', baseDir = __dirname) {
    this.mode = mode;
    this.baseDir = baseDir;
    this.ipcManager = null;

    if (mode === 'ipc') {
      this.ipcManager = new IPCManager();
    }
  }

  async init() {
    if (this.mode === 'ipc' && this.ipcManager) {
      await this.ipcManager.startAll(this.baseDir);
    }
  }

  async callIconAgentResolve(inputPath) {
    if (this.mode === 'ipc') {
      const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const result = await this.ipcManager.call('iconAgent', 'resolve', data);
      return result;
    } else {
      const url = process.env.ICON_SERVICE_URL || 'http://localhost:3103';
      return await postFile(`${url}/resolve`, inputPath);
    }
  }

  async callIconAgentResolveFromData(data) {
    if (this.mode === 'ipc') {
      return await this.ipcManager.call('iconAgent', 'resolve', data);
    } else {
      const url = process.env.ICON_SERVICE_URL || 'http://localhost:3103';
      const tmpPath = `${os.tmpdir()}/icon-input-${Date.now()}.json`;
      fs.writeFileSync(tmpPath, JSON.stringify(data));
      try {
        return await postFile(`${url}/resolve`, tmpPath);
      } finally {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  async callComponentMatchDsl(inputPath) {
    if (this.mode === 'ipc') {
      const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const result = await this.ipcManager.call('componentService', 'match-dsl', data);
      return result;
    } else {
      const url = process.env.COMPONENT_SERVICE_URL || 'http://localhost:3102';
      return await postFile(`${url}/match-dsl`, inputPath);
    }
  }

  async callComponentMatchDslFromData(data) {
    if (this.mode === 'ipc') {
      return await this.ipcManager.call('componentService', 'match-dsl', data);
    } else {
      const url = process.env.COMPONENT_SERVICE_URL || 'http://localhost:3102';
      const tmpPath = `${os.tmpdir()}/component-input-${Date.now()}.json`;
      fs.writeFileSync(tmpPath, JSON.stringify(data));
      try {
        return await postFile(`${url}/match-dsl`, tmpPath);
      } finally {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  async callDslToHexConvert(dsl) {
    if (this.mode === 'ipc') {
      const result = await this.ipcManager.call('dslToHex', 'convert', dsl);
      return result;
    } else {
      const url = process.env.HEX_SERVICE_URL || 'http://localhost:3101';
      return await postJson(`${url}/convert`, { dsl });
    }
  }

  async callComponentMatch(description) {
    if (this.mode === 'ipc') {
      return await this.ipcManager.call('componentService', 'match', { description });
    } else {
      const url = process.env.COMPONENT_SERVICE_URL || 'http://localhost:3102';
      return await postJson(`${url}/match`, { description });
    }
  }

  async callIconAgentSearch(keyword) {
    if (this.mode === 'ipc') {
      return await this.ipcManager.call('iconAgent', 'search', { keyword });
    } else {
      const url = process.env.ICON_SERVICE_URL || 'http://localhost:3103';
      return await postJson(`${url}/search`, { keyword });
    }
  }

  stop() {
    if (this.ipcManager) {
      this.ipcManager.stopAll();
    }
  }
}

module.exports = { ServiceClient };