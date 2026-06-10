'use strict';
require('./lib/load-env');

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const multer  = require('multer');
const os      = require('os');

const { ServiceClient }               = require('./lib/client');
const { enrich }                      = require('./lib/enrich');
const { buildDesignDsl, countLayers } = require('./lib/design-dsl');
const { exportHex }                   = require('./lib/export-hex');

const app    = express();
const PORT   = Number(process.env.PORT) || 3104;
const upload = multer({ storage: multer.memoryStorage() });

let globalClient = null;

async function getClient() {
  if (!globalClient) {
    globalClient = new ServiceClient(__dirname);
    await globalClient.init();
  }
  return globalClient;
}

app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', initialized: !!globalClient, port: PORT });
});

app.post('/init', async (req, res) => {
  try {
    await getClient();
    res.json({ status: 'initialized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/pipeline', upload.single('file'), async (req, res) => {
  const tmpPath = req.file ? path.join(os.tmpdir(), `pipeline-input-${Date.now()}.json`) : null;

  try {
    const { page_name, skip_enrich } = req.body || {};

    if (!req.file) {
      return res.status(400).json({ error: '请通过 -F "file=@input.json" 上传文件' });
    }

    fs.writeFileSync(tmpPath, req.file.buffer);
    const inputData = JSON.parse(req.file.buffer.toString('utf8'));

    const client  = await getClient();
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-output-'));

    let finalSchema  = inputData;
    let enrichStats  = { icons: 0, components: 0 };

    if (!skip_enrich) {
      finalSchema = await enrich(tmpPath, tmpDir, client);

      const rawIconsPath = path.join(tmpDir, 'raw-icons.json');
      const rawCompsPath = path.join(tmpDir, 'raw-components.json');
      if (fs.existsSync(rawIconsPath)) {
        const ri = JSON.parse(fs.readFileSync(rawIconsPath, 'utf8'));
        enrichStats.icons = ri?.success ? 1 : 0;
      }
      if (fs.existsSync(rawCompsPath)) {
        const rc = JSON.parse(fs.readFileSync(rawCompsPath, 'utf8'));
        enrichStats.components = Array.isArray(rc) ? rc.filter(r => r?.match).length : 0;
      }
    }

    const pageName = page_name || inputData.meta?.file_name || 'Page 1';
    const dsl      = buildDesignDsl(finalSchema, pageName);
    const stats    = countLayers(dsl.pages[0].layers);

    const { hexPath, missingKeys, zipPath } = await exportHex(dsl, tmpDir, client);

    res.json({
      success: true,
      stats: { enrich: enrichStats, layers: stats, missing_keys: missingKeys.length },
      hex:         fs.readFileSync(hexPath, 'utf8'),
      zip:         fs.readFileSync(zipPath).toString('base64'),
      missing_keys: missingKeys,
    });

  } catch (err) {
    console.error('[pipeline] 处理失败:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
  }
});

app.post('/shutdown', (req, res) => {
  res.json({ status: 'shutting down' });
  if (globalClient) globalClient.stop();
  process.exit(0);
});

const gracefulShutdown = () => {
  console.log('\n[node-dsl-pipeline] 收到关闭信号，正在清理...');
  if (globalClient) globalClient.stop();
  process.exit(0);
};
process.on('SIGINT',  gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

app.listen(PORT, async () => {
  console.log(`[node-dsl-pipeline] 服务已启动: http://localhost:${PORT}`);
  console.log('  GET  /health    健康检查');
  console.log('  POST /init      初始化子进程');
  console.log('  POST /pipeline  完整流程（补全 + 转 DSL + 导出 hex）');
  console.log('  POST /shutdown  关闭服务');

  try {
    await getClient();
    console.log('[node-dsl-pipeline] 子进程已就绪');
  } catch (err) {
    console.error(`[node-dsl-pipeline] 子进程启动失败: ${err.message}`);
    console.log('提示：可手动调用 POST /init 重试');
  }
});
