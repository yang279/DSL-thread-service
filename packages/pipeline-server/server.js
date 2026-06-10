'use strict';

const fs       = require('fs');
const path     = require('path');
const express  = require('express');
const multer   = require('multer');
const os       = require('os');

const { ServiceClient } = require('./lib/client');
const { enrich }         = require('./lib/enrich');
const { buildDesignDsl, countLayers } = require('./lib/design-dsl');
const { exportHex, generateRequestId, ARTIFACTS_DIR } = require('./lib/export-hex');

const app     = express();
const PORT    = Number(process.env.PORT) || 3104;
const upload  = multer({ storage: multer.memoryStorage() });

let globalClient = null;

async function initClient(mode) {
  if (!globalClient) {
    globalClient = new ServiceClient(mode, __dirname);
    await globalClient.init();
  }
  return globalClient;
}

app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: globalClient?.mode || 'not initialized',
    port: PORT
  });
});

app.post('/init', async (req, res) => {
  try {
    const { mode = 'ipc' } = req.body || {};
    await initClient(mode);
    res.json({ status: 'initialized', mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/pipeline', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传 JSON 文件（使用 -F "file=@input.json"）' });
  }
  
  const requestId = generateRequestId();
  const tmpPath = path.join(os.tmpdir(), `pipeline-input-${requestId}.json`);
  
  try {
    const { mode = 'ipc', page_name, skip_enrich } = req.body || {};
    
    fs.writeFileSync(tmpPath, req.file.buffer);
    const inputData = JSON.parse(req.file.buffer.toString('utf8'));

    const client = await initClient(mode);
    
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pipeline-${requestId}-`));
    
    fs.writeFileSync(path.join(tmpDir, 'input.json'), JSON.stringify(inputData, null, 2), 'utf8');
    
    let finalSchema = inputData;
    let enrichStats = { icons: 0, components: 0 };
    
    if (!skip_enrich) {
      finalSchema = await enrich(tmpPath, tmpDir, client);
      
      const rawIcons = fs.existsSync(path.join(tmpDir, 'raw-icons.json')) 
        ? JSON.parse(fs.readFileSync(path.join(tmpDir, 'raw-icons.json'), 'utf8')) 
        : null;
      enrichStats.icons = rawIcons?.success ? 1 : 0;
      
      const rawComponents = fs.existsSync(path.join(tmpDir, 'raw-components.json'))
        ? JSON.parse(fs.readFileSync(path.join(tmpDir, 'raw-components.json'), 'utf8'))
        : [];
      enrichStats.components = Array.isArray(rawComponents) ? rawComponents.filter(r => r?.match).length : 0;
    }

    const pageName = page_name || inputData.meta?.file_name || 'Page 1';
    const dsl = buildDesignDsl(finalSchema, pageName);
    const stats = countLayers(dsl.pages[0].layers);

    const { hexPath, missingKeys, zipPath } = await exportHex(dsl, tmpDir, client, requestId);

    const hexContent = fs.readFileSync(hexPath, 'utf8');
    const zipBase64 = fs.readFileSync(zipPath).toString('base64');

    res.json({
      success: true,
      request_id: requestId,
      artifacts_dir: ARTIFACTS_DIR,
      stats: {
        enrich: enrichStats,
        layers: stats,
        missing_keys: missingKeys.length
      },
      hex: hexContent,
      zip: zipBase64,
      missing_keys: missingKeys
    });

  } catch (err) {
    console.error('[pipeline HTTP] 处理失败:', err.message);
    res.status(500).json({ error: err.message, request_id: requestId });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
});

app.post('/enrich', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传 JSON 文件（使用 -F "file=@input.json"）' });
  }
  
  const tmpPath = path.join(os.tmpdir(), `enrich-input-${Date.now()}.json`);
  
  try {
    const { mode = 'ipc' } = req.body || {};
    
    fs.writeFileSync(tmpPath, req.file.buffer);
    const inputData = JSON.parse(req.file.buffer.toString('utf8'));

    const client = await initClient(mode);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-output-'));

    await enrich(tmpPath, tmpDir, client);

    const finalPath = path.join(tmpDir, 'final.json');
    const rawIcons = JSON.parse(fs.readFileSync(path.join(tmpDir, 'raw-icons.json'), 'utf8'));
    const rawComponents = JSON.parse(fs.readFileSync(path.join(tmpDir, 'raw-components.json'), 'utf8'));

    res.json({
      success: true,
      final: JSON.parse(fs.readFileSync(finalPath, 'utf8')),
      raw_icons: rawIcons,
      raw_components: rawComponents
    });

  } catch (err) {
    console.error('[enrich HTTP] 处理失败:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
});

app.post('/convert', upload.single('file'), async (req, res) => {
  try {
    const { mode = 'ipc', page_name } = req.body || {};
    
    let dslInput;
    if (req.file) {
      dslInput = JSON.parse(req.file.buffer.toString('utf8'));
    } else if (req.body && req.body.dsl) {
      dslInput = req.body.dsl;
    } else {
      return res.status(400).json({ error: 'send a file or JSON body with "dsl" field' });
    }

    if (!dslInput.pages || !Array.isArray(dslInput.pages)) {
      return res.status(400).json({ error: 'dsl.pages must be an array' });
    }

    const client = await initClient(mode);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-output-'));

    const pageName = page_name || dslInput.meta?.file_name || 'Page 1';
    let dsl = dslInput;

    if (!dslInput.meta || !dslInput.pages[0]?.layers) {
      return res.status(400).json({ error: 'invalid DSL format: missing meta or pages[0].layers' });
    }

    const stats = countLayers(dsl.pages[0].layers);
    const { hexPath, missingKeys, zipPath } = await exportHex(dsl, tmpDir, client);

    const hexContent = fs.readFileSync(hexPath, 'utf8');
    const zipBase64 = fs.readFileSync(zipPath).toString('base64');

    res.json({
      success: true,
      stats: {
        layers: stats,
        missing_keys: missingKeys.length
      },
      hex: hexContent,
      zip: zipBase64,
      missing_keys: missingKeys
    });

  } catch (err) {
    console.error('[convert HTTP] 处理失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/shutdown', (req, res) => {
  res.json({ status: 'shutting down' });
  if (globalClient) {
    globalClient.stop();
  }
  process.exit(0);
});

app.get('/artifacts', (req, res) => {
  try {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      return res.json({ artifacts: [], total: 0 });
    }
    
    const dirs = fs.readdirSync(ARTIFACTS_DIR)
      .filter(f => fs.statSync(path.join(ARTIFACTS_DIR, f)).isDirectory())
      .sort((a, b) => b.localeCompare(a));
    
    const artifacts = dirs.slice(0, 50).map(dir => {
      const manifestPath = path.join(ARTIFACTS_DIR, dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        return {
          request_id: dir,
          created_at: manifest.created_at,
          files: Object.keys(manifest.artifacts || {})
        };
      }
      return { request_id: dir, created_at: null, files: [] };
    });
    
    res.json({ 
      artifacts_dir: ARTIFACTS_DIR,
      total: dirs.length,
      artifacts: artifacts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/artifacts/:requestId', (req, res) => {
  const { requestId } = req.params;
  const artifactDir = path.join(ARTIFACTS_DIR, requestId);
  
  if (!fs.existsSync(artifactDir)) {
    return res.status(404).json({ error: `artifacts not found: ${requestId}` });
  }
  
  try {
    const files = fs.readdirSync(artifactDir);
    const manifestPath = path.join(artifactDir, 'manifest.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    
    res.json({
      request_id: requestId,
      artifacts_dir: artifactDir,
      manifest: manifest,
      files: files
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/artifacts/:requestId/:filename', (req, res) => {
  const { requestId, filename } = req.params;
  const filePath = path.join(ARTIFACTS_DIR, requestId, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `file not found: ${filename}` });
  }
  
  try {
    if (filename.endsWith('.hex') || filename.endsWith('.txt')) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      fs.createReadStream(filePath).pipe(res);
    } else if (filename.endsWith('.json')) {
      res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else if (filename.endsWith('.zip')) {
      res.set('Content-Type', 'application/zip');
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.download(filePath);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const gracefulShutdown = () => {
  console.log('\n[node-dsl-pipeline HTTP] 收到关闭信号，正在清理...');
  if (globalClient) {
    globalClient.stop();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

app.listen(PORT, async () => {
  console.log(`[node-dsl-pipeline HTTP] 服务已启动: http://localhost:${PORT}`);
  console.log(`接口列表:`);
  console.log(`  GET  /health          - 健康检查`);
  console.log(`  POST /init            - 初始化服务模式 { mode: "ipc" | "http" }`);
  console.log(`  POST /pipeline        - 完整流程（补全 + 转 DSL + 导出 hex + 保存产物）`);
  console.log(`  POST /enrich          - 仅补全节点信息`);
  console.log(`  POST /convert         - 仅转换 DSL 为 hex`);
  console.log(`  GET  /artifacts       - 查看产物列表`);
  console.log(`  GET  /artifacts/:id   - 查看指定产物详情`);
  console.log(`  GET  /artifacts/:id/:file - 下载产物文件`);
  console.log(`  POST /shutdown        - 关闭服务`);
  console.log('');
  console.log(`产物存储目录: ${ARTIFACTS_DIR}`);
  console.log('');
  
  try {
    const mode = process.env.DEFAULT_MODE || 'ipc';
    await initClient(mode);
    console.log(`[node-dsl-pipeline HTTP] 已初始化 ${mode} 模式`);
  } catch (err) {
    console.error(`[node-dsl-pipeline HTTP] 初始化失败: ${err.message}`);
    console.log('提示：请手动调用 POST /init 或在请求中指定 mode 参数');
  }
});