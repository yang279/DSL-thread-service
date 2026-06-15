'use strict';

const config = require('../config');

for (const [key, val] of Object.entries(config)) {
  if (val != null) process.env[key] = String(val);
}

console.log('[config] 已加载');
