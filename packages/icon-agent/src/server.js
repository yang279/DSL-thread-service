require('dotenv').config();
const fs = require('fs');
const express = require('express');
const path = require('path');
const multer = require('multer');
const core = require('./core');

const app = express();

const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
const upload = multer({ dest: UPLOAD_DIR });

function successResponse(content) {
  return { content, errorCode: 200, errorMessage: '', success: true };
}

function errorResponse(errorCode, errorMessage) {
  return { content: null, errorCode, errorMessage, success: false };
}

app.post('/resolve', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    let data;
    if (req.file) {
      const raw = fs.readFileSync(tmpPath, 'utf-8');
      data = JSON.parse(raw);
    } else {
      return res.json(errorResponse(400, '请上传 JSON 文件（field: file）'));
    }

    const result = await core.resolve(data);
    res.json(successResponse(result));
  } catch (err) {
    console.error('[iconAgent HTTP] 处理失败:', err.message);
    res.json(errorResponse(500, err.message));
  } finally {
    if (tmpPath) {
      fs.unlink(tmpPath, () => {});
    }
  }
});

app.post('/search', upload.none(), async (req, res) => {
  try {
    const keyword = req.body.keyword;
    const result = await core.search(keyword);
    res.json(successResponse(result));
  } catch (err) {
    console.error('[iconAgent HTTP] 搜索失败:', err.message);
    res.json(errorResponse(500, err.message));
  }
});

app.get('/health', (req, res) => {
  const stats = core.getStats();
  res.json(successResponse({ status: 'ok', icons: stats.icons }));
});

const PORT = process.env.PORT || 3103;

core.init().then(() => {
  app.listen(PORT, () => {
    console.log(`[iconAgent HTTP] 服务已启动: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('[iconAgent HTTP] 初始化失败:', err);
  process.exit(1);
});