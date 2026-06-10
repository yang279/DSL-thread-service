# node-dsl-pipeline HTTP 服务

接收 node-dsl schema JSON，经过节点补全、DSL 转换、hex 导出三步流水线，输出 Pixso 可导入的 hex 文件。

- 默认端口：**3204**
- 启动时自动 fork 三个 IPC 子进程（icon-agent、component-service、dsl-to-hex）
- 子进程路径通过 `.env` 配置，支持绝对路径

## 快速启动

```bash
cd node-dsl-pipeline

# 安装依赖
npm install

# 启动服务
npm run server

# 自定义端口
PORT=3300 npm run server
```

## 配置（.env）

```env
# 子进程 worker 路径（绝对路径或相对于 node-dsl-pipeline/ 的路径）
ICON_AGENT_WORKER=../workers/icon-agent/worker.js
COMPONENT_SERVICE_WORKER=/绝对路径/component-service/worker.js
DSL_TO_HEX_WORKER=/绝对路径/dsl-to-hex/worker.js

# 服务端口
PORT=3204

# 产物存储目录
ARTIFACTS_DIR=../artifacts
```

## API 接口

### GET /health

健康检查。

```bash
curl http://localhost:3204/health
```

```json
{ "status": "ok", "initialized": true, "port": 3204 }
```

---

### POST /init

手动初始化子进程。服务启动时自动执行，失败时可手动重试。

```bash
curl -X POST http://localhost:3204/init
```

```json
{ "status": "initialized" }
```

---

### POST /pipeline

完整流程：node-dsl → 补全图标/组件 → design-dsl → hex。

```bash
curl -X POST http://localhost:3204/pipeline \
  -F "file=@input.json" \
  -F "page_name=登录页"
```

**参数**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | multipart | 是 | node-dsl JSON 文件 |
| `page_name` | string | 否 | 页面名称，默认取 `meta.file_name` 或 `Page 1` |
| `skip_enrich` | boolean | 否 | 跳过节点补全，输入须已含 `iconSvg` 和 `component` 字段 |

**响应**

```json
{
  "success": true,
  "artifact_id": "1749558000000-ab3f2",
  "stats": {
    "enrich": { "icons": 1, "components": 3 },
    "layers": { "total": 10, "frames": 2, "texts": 5, "instances": 3, "placeholders": 1 },
    "missing_keys": 0
  },
  "zip": "<base64 编码的 zip>",
  "missing_keys": []
}
```

zip 解压后含 `output.hex` 及 svg/png 资源。产物同时存储于 `artifacts/<artifact_id>/` 目录。

---

### POST /shutdown

关闭服务并终止所有子进程。

```bash
curl -X POST http://localhost:3204/shutdown
```

---

## 错误响应

```json
{ "error": "错误信息" }
```

| 状态码 | 说明 |
|---|---|
| `400` | 请求参数错误（未上传文件等） |
| `500` | 处理失败 |
