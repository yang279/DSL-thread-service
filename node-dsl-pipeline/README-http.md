# node-dsl-pipeline HTTP 服务

完整的 node-dsl 处理流程 HTTP API，监听端口 **3104**。

## 快速启动

```bash
cd node-dsl-pipeline

# 安装依赖
npm install

# 启动 HTTP 服务（默认 IPC 模式）
npm run server

# 或指定 HTTP 模式
DEFAULT_MODE=http npm run server

# 自定义端口
PORT=3200 npm run server
```

## API 接口

### GET /health

健康检查。

**响应：**
```json
{
  "status": "ok",
  "mode": "ipc",
  "port": 3104
}
```

---

### POST /init

初始化服务模式（IPC 或 HTTP）。

**请求体：**
```json
{
  "mode": "ipc"  // 或 "http"
}
```

**响应：**
```json
{
  "status": "initialized",
  "mode": "ipc"
}
```

---

### POST /pipeline

完整流程：补全节点信息 → 转 design-dsl → 导出 hex。

**请求方式（三种）：**

1. **文件上传**
```bash
curl -X POST http://localhost:3104/pipeline \
  -F "file=@input.json" \
  -F "mode=ipc" \
  -F "page_name=登录页"
```

2. **JSON body（带 data 字段）**
```bash
curl -X POST http://localhost:3104/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "ipc",
    "page_name": "登录页",
    "data": {
      "meta": { "file_name": "test" },
      "pages": [...]
    }
  }'
```

3. **跳过补全（直接转换已有的 final.json）**
```bash
curl -X POST http://localhost:3104/pipeline \
  -F "file=@final.json" \
  -F "skip_enrich=true"
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | string | `"ipc"` | 运行模式（ipc 或 http） |
| `page_name` | string | 文件名 | design-dsl 页面名称 |
| `skip_enrich` | boolean | `false` | 跳过补全节点信息 |

**响应：**
```json
{
  "success": true,
  "stats": {
    "enrich": {
      "icons": 1,
      "components": 3
    },
    "layers": {
      "total": 10,
      "frames": 2,
      "texts": 5,
      "instances": 3
    },
    "missing_keys": 0
  },
  "hex": "...pixso binary hex content...",
  "zip": "UEsDBAoAAAAAAMh...",
  "missing_keys": []
}
```

---

### POST /enrich

仅补全节点信息（icon + component）。

**请求：**
```bash
curl -X POST http://localhost:3104/enrich \
  -F "file=@input.json" \
  -F "mode=ipc"
```

**响应：**
```json
{
  "success": true,
  "final": {...补全后的完整 node-dsl},
  "raw_icons": {...iconAgent 原始响应},
  "raw_components": [...component-service 原始响应]
}
```

---

### POST /convert

仅转换 design-dsl 为 hex（不补全节点）。

**请求：**
```bash
curl -X POST http://localhost:3104/convert \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "ipc",
    "page_name": "登录页",
    "dsl": {
      "meta": {...},
      "pages": [...]
    }
  }'
```

**响应：**
```json
{
  "success": true,
  "stats": {
    "layers": {...},
    "missing_keys": 0
  },
  "hex": "...",
  "zip": "UEsDBAoAAAAAAMh...",
  "missing_keys": []
}
```

---

### POST /shutdown

关闭服务（优雅退出）。

**响应：**
```json
{
  "status": "shutting down"
}
```

---

## 运行模式

### IPC 模式（推荐）

- **无需启动额外服务**
- node-dsl-pipeline 自动 fork 子进程
- 性能更好（无 HTTP 序列化开销）
- 一键部署

```bash
npm run server  # 默认 IPC 模式
```

### HTTP 模式

- **需要先启动三个服务**
- 支持独立调试每个服务
- 适合开发环境

```bash
# 先启动三个子服务
node wonderfulj-main/src/server.js          # 端口 3103
node nodejs/component-service/server.js      # 端口 3102
node nodejs/dsl-to-hex/server.js             # 端口 3101

# 然后启动主服务
DEFAULT_MODE=http npm run server             # 端口 3104
```

---

## 部署建议

### 生产环境（推荐 IPC 模式）

```bash
# 直接启动，无需额外依赖服务
PORT=3104 npm run server
```

### Docker 部署示例

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY node-dsl-pipeline ./node-dsl-pipeline
COPY wonderfulj-main ./wonderfulj-main
COPY nodejs ./nodejs

RUN cd node-dsl-pipeline && npm install --production

EXPOSE 3104

CMD ["node", "node-dsl-pipeline/server.js"]
```

### PM2 部署

```bash
pm2 start server.js --name node-dsl-pipeline
```

---

## 错误处理

所有错误响应格式：
```json
{
  "error": "错误信息"
}
```

常见错误：
- `400` - 请求参数错误
- `500` - 处理失败（服务内部错误）

---

## 性能对比

| 指标 | IPC 模式 | HTTP 模式 |
|------|----------|-----------|
| 进程数 | 1 个（主进程 + 3 子进程） | 4 个独立进程 |
| 通信方式 | process.send/on | HTTP 请求 |
| 序列化开销 | 无 | JSON → HTTP |
| 启动时间 | ~10秒（初始化 WASM） | ~10秒 + 手动启动3服务 |
| 适用场景 | 生产部署 | 开发调试 |

---

## 示例调用

```bash
# 1. 健康检查
curl http://localhost:3104/health

# 2. 完整流程
curl -X POST http://localhost:3104/pipeline \
  -F "file=@login-node.json" \
  -F "page_name=登录页"

# 3. 获取结果（hex + zip）
curl -X POST http://localhost:3104/pipeline \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "data": {
    "meta": { "file_name": "test" },
    "pages": [{
      "id": "0:1",
      "name": "Page 1",
      "layers": [
        {
          "id": "1:1",
          "name": "Button",
          "type": "instance",
          "semantic": "button",
          "label": "确定按钮",
          "nid": 1
        }
      ]
    }]
  }
}
EOF
```

---

## 端口规划

| 服务 | 端口 | 说明 |
|------|------|------|
| node-dsl-pipeline (HTTP 服务) | **3104** | 主服务（本次新增） |
| iconAgent | 3103 | 图标解析服务 |
| component-service | 3102 | 组件匹配服务 |
| dsl-to-hex | 3101 | DSL 转 hex 服务 |

IPC 模式下，3101/3102/3103 不监听端口，仅在进程内通信。