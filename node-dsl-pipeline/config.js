'use strict';

const path = require('path');

module.exports = {
  HOST:                     'localhost',
  PORT:                     3204,
  ARTIFACTS_DIR:            path.resolve(__dirname, '../artifacts'),
  ICON_AGENT_WORKER:        path.resolve(__dirname, '../../workers/icon-agent/worker.js'),
  COMPONENT_SERVICE_WORKER: path.resolve(__dirname, '../../workers/component-service/worker.js'),
  DSL_TO_HEX_WORKER:        path.resolve(__dirname, '../../workers/dsl-to-hex/worker.js'),
};
