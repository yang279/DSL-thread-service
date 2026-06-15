# node-dsl-pipeline 接口文档

接收 node-dsl schema JSON，经过节点补全、DSL 转换、hex 导出三步流水线，输出 Pixso 可导入的 hex 文件。

- 默认端口：`3204`（可通过环境变量 `PORT` 修改）
- 服务启动时自动拉起三个 IPC 子进程（icon-agent、component-service、dsl-to-hex）

---

## GET /health

健康检查。

**响应**

```json
{
  "status": "ok",
  "initialized": true,
  "port": 3204
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
curl -X POST http://localhost:3204/pipeline \
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
  "artifact_id": "1749558000000-ab3f2",
  "stats": {
    "enrich": { "icons": 3, "components": 5 },
    "layers": { "total": 42, "frames": 18, "texts": 12, "instances": 8, "placeholders": 4 },
    "missing_keys": 0
  },
  "zip": "<base64 编码的 zip>",
  "missing_keys": []
}
```

| 字段 | 说明 |
|---|---|
| `artifact_id` | 本次产物 ID，产物同时存储于服务器 `artifacts/` 目录 |
| `stats.enrich.icons` | 图标注入是否成功（0/1） |
| `stats.enrich.components` | 成功匹配到组件的节点数 |
| `stats.layers` | 图层统计 |
| `stats.missing_keys` | 缺失组件数量 |
| `zip` | base64 编码的 zip，解压后含 `output.hex` 及 svg/png 资源 |
| `missing_keys` | 未能解析的组件 key 列表，zip 仍有效但对应组件在 Pixso 中缺失 |

**响应（失败）**

```json
{ "error": "<错误信息>", "step": "enrich | design-dsl | export-hex" }
```

| 字段 | 说明 |
|---|---|
| `step` | 失败发生在哪个步骤，便于定位问题 |

---

## POST /icon-agent/resolve

直接调用 icon-agent 子进程，对节点树中所有图标节点注入 SVG 内容。

**请求（application/json）**

```bash
curl -X POST http://localhost:3204/icon-agent/resolve \
  -H "Content-Type: application/json" \
  -d @node-dsl.json
```

请求 body 为 node-dsl 节点树 JSON。

**响应（成功）**

```json
{
  "success": true,
  "content": { "<注入 iconSvg 后的节点树>" }
}
```

**响应（失败）**

```json
{ "error": "<错误信息>" }
```

---

## POST /component-service/match-dsl

直接调用 component-service 子进程，对节点树中的组件节点批量匹配设计系统组件。

**请求（application/json）**

```bash
curl -X POST http://localhost:3204/component-service/match-dsl \
  -H "Content-Type: application/json" \
  -d @node-dsl.json
```

请求 body 为 node-dsl 节点树 JSON。

**响应（成功）**

```json
[
  { "nid": 11, "match": { "componentKey": "...", "path": "...", "variant": { ... } } },
  { "nid": 20, "match": null }
]
```

每个元素对应一个可匹配节点，`match` 为 `null` 表示未找到对应组件。

**响应（失败）**

```json
{ "error": "<错误信息>" }
```

---

## POST /dsl-to-hex/convert

直接调用 dsl-to-hex 子进程，将 design-dsl JSON 转换为 Pixso 可导入的 hex 文件。

**请求（application/json）**

```bash
curl -X POST http://localhost:3204/dsl-to-hex/convert \
  -H "Content-Type: application/json" \
  -d @design-dsl.json
```

请求 body 为 design-dsl JSON，需包含 `meta` 和 `pages` 字段（格式见 `设计dsl.md`）。

**响应（成功）**

```json
{
  "zip": "<base64 编码的 zip>",
  "missing_keys": ["<缺失组件key>"]
}
```

| 字段 | 说明 |
|---|---|
| `zip` | base64 编码的 zip，解压后含 `output.hex` 及 svg/png 资源 |
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
| `PORT` | `3204` | 服务监听端口 |
| `ARTIFACTS_DIR` | `../artifacts` | 产物存储目录 |
| `ICON_AGENT_WORKER` | `../workers/icon-agent/worker.js` | icon-agent worker 路径 |
| `COMPONENT_SERVICE_WORKER` | `../workers/component-service/worker.js` | component-service worker 路径 |
| `DSL_TO_HEX_WORKER` | `../workers/dsl-to-hex/worker.js` | dsl-to-hex worker 路径 |
