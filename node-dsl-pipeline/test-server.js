#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3104;

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

const server = require('http').createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJSON(res, 200, { status: 'ok', port: PORT });
  } else {
    sendJSON(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, () => {
  console.log(`测试服务器已启动: http://localhost:${PORT}`);
  console.log('GET /health');
});