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

const app          = express();
const PORT         = Number(process.env.PORT) || 3204;
const ARTIFACTS_DIR = path.resolve(process.env.ARTIFACTS_DIR || path.join(__dirname, '../artifacts'));
const upload       = multer({ storage: multer.memoryStorage() });

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

let globalClient = null;

async function getClient() {
  if (!globalClient) {
    globalClient = new ServiceClient(__dirname);
    await globalClient.init();
  }
  return globalClient;
}

function saveArtifact(id, { pageName, stats, missingKeys, hexPath, zipPath }) {
  const dir = path.join(ARTIFACTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(hexPath, path.join(dir, 'output.hex'));
  fs.copyFileSync(zipPath, path.join(dir, 'output.zip'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    id,
    page_name:    pageName,
    created_at:   new Date().toISOString(),
    stats,
    missing_keys: missingKeys,
  }, null, 2));
}

app.use(express.json({ limit: '50mb' }));

// ── 健康检查 ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', initialized: !!globalClient, port: PORT });
});

// ── 初始化子进程 ──────────────────────────────────────────────────────────────
app.post('/init', async (req, res) => {
  try {
    await getClient();
    res.json({ status: 'initialized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 完整流水线 ────────────────────────────────────────────────────────────────
app.post('/pipeline', upload.single('file'), async (req, res) => {
  const tmpPath = req.file ? path.join(os.tmpdir(), `pipeline-input-${Date.now()}.json`) : null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: '请通过 -F "file=@input.json" 上传文件' });
    }

    const { page_name, skip_enrich } = req.body || {};

    fs.writeFileSync(tmpPath, req.file.buffer);
    const inputData = JSON.parse(req.file.buffer.toString('utf8'));

    const client = await getClient();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-output-'));

    let finalSchema = inputData;
    let enrichStats = { icons: 0, components: 0 };

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
    const layers   = countLayers(dsl.pages[0].layers);
    const stats    = { enrich: enrichStats, layers, missing_keys: 0 };

    const { hexPath, missingKeys, zipPath } = await exportHex(dsl, tmpDir, client);
    stats.missing_keys = missingKeys.length;

    // 存储产物
    const artifactId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    saveArtifact(artifactId, { pageName, stats, missingKeys, hexPath, zipPath });
    console.log(`[pipeline] 产物已存储: ${artifactId}`);

    res.json({
      success:      true,
      artifact_id:  artifactId,
      stats,
      zip:          fs.readFileSync(zipPath).toString('base64'),
      missing_keys: missingKeys,
    });

  } catch (err) {
    console.error('[pipeline] 处理失败:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ── 关闭服务 ──────────────────────────────────────────────────────────────────
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
  console.log('  GET  /health              健康检查');
  console.log('  POST /init                初始化子进程');
  console.log('  POST /pipeline            完整流程（补全 + 转 DSL + 导出 hex）');
  console.log('  POST /shutdown  关闭服务');
  console.log(`  产物目录: ${ARTIFACTS_DIR}`);

  try {
    await getClient();
    console.log('[node-dsl-pipeline] 子进程已就绪');
  } catch (err) {
    console.error(`[node-dsl-pipeline] 子进程启动失败: ${err.message}`);
    console.log('提示：可手动调用 POST /init 重试');
  }
});
