# node-dsl-pipeline 接口文档

接收 node-dsl schema JSON，经过节点补全、DSL 转换、hex 导出三步流水线，输出 Pixso 可导入的 hex 文件。

- 默认端口：`3104`（可通过环境变量 `PORT` 修改）
- 服务启动时自动拉起三个 IPC 子进程（icon-agent、component-service、dsl-to-hex）

---

## GET /health

健康检查。

**响应**

```json
{
  "status": "ok",
  "initialized": true,
  "port": 3104
}
```

| 字段 | 说明 |
|---|---|
| `initialized` | 子进程是否已就绪 |

---

## POST /init

手动初始化子进程。服务启动时会自动执行，仅在自动初始化失败时需要手动调用。

**响应（成功）**

```json
{ "status": "initialized" }
```

**响应（失败）**

```json
{ "error": "<错误信息>" }
```

---

## POST /pipeline

完整流程：node-dsl → 补全图标/组件 → design-dsl → hex。

**请求（multipart/form-data）**

```bash
curl -X POST http://localhost:3104/pipeline \
  -F "file=@input.json" \
  -F "page_name=登录页"
```

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | multipart | 是 | node-dsl JSON 文件 |
| `page_name` | string | 否 | 页面名称，默认取 `meta.file_name` 或 `Page 1` |
| `skip_enrich` | boolean | 否 | 跳过补全步骤，输入须已包含 `iconSvg` 和 `component` 字段 |

**响应（成功）**

```json
{
  "success": true,
  "stats": {
    "enrich": {
      "icons": 3,
      "components": 5
    },
    "layers": {
      "total": 42,
      "frames": 18,
      "texts": 12,
      "instances": 8,
      "placeholders": 4
    },
    "missing_keys": 0
  },
  "hex": "<hex文件内容字符串>",
  "zip": "<base64编码的zip文件>",
  "missing_keys": []
}
```

| 字段 | 说明 |
|---|---|
| `stats.enrich.icons` | 成功注入 SVG 的图标数（0 或 1，表示整体是否成功） |
| `stats.enrich.components` | 成功匹配到组件的节点数 |
| `stats.layers` | 图层统计 |
| `stats.missing_keys` | 缺失组件数量 |
| `hex` | output.hex 文件内容，可直接写入 `.hex` 文件 |
| `zip` | base64 编码的 zip 包，包含 hex 及 svg/png 资源 |
| `missing_keys` | 未能解析的组件 key 列表，zip 仍有效但对应组件在 Pixso 中缺失 |

**响应（失败）**

```json
{ "error": "<错误信息>" }
```

---

## POST /shutdown

关闭服务并终止所有子进程。

**响应**

```json
{ "status": "shutting down" }
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3104` | 服务监听端口 |
| `ICON_AGENT_WORKER` | `./workers/icon-agent/src/worker.js` | icon-agent worker 路径 |
| `COMPONENT_SERVICE_WORKER` | `./workers/component-service/worker.js` | component-service worker 路径 |
| `DSL_TO_HEX_WORKER` | `./workers/dsl-to-hex/worker.js` | dsl-to-hex worker 路径 |
