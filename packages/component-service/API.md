# component-service 接口文档

组件服务，对外统一暴露在 **3102 端口**，提供两类能力：
- **查询接口**（`/match`、`/batch`、`/match-dsl`、`/match-dsl-single`）—— 基于 LLM 的语义化组件变体匹配
- **hex 获取接口**（`/hex/:key`）—— 跨多组件库查找并返回组件的 hex 文件内容

供其他服务使用。

---

## 启动

```bash
cd nodejs/component-service

# 默认配置（需要 search_index.json 与 lib-out 目录已就绪）
node server.js

# 也可以临时用环境变量覆盖 .env 里的配置（优先级更高）
PORT=3102 LIB_OUT_DIR=/path/to/lib-out node server.js
```

启动时会先加载同目录下的 `.env`（不存在的变量才会被设置，不会覆盖已有的环境变量），再读取 `search_index.json` 构建 hex key → 文件路径的映射并打印加载到的 key 数量。

**配置项**（建议都写进 `.env`，避免每次启动靠记忆手动传环境变量；启动时用环境变量传入的值优先级更高，会覆盖 `.env`）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3102` | 监听端口 |
| `LIB_OUT_DIR` | `../../pixso-parse/pix-split/lib-out` | 多组件库根目录，`search_index.json` 中每条 entry 的 `hexFile` 相对此目录下的 `{source}/` 解析。仅当部署环境需要指向非默认路径时才需要配置 |
| `DASHSCOPE_API_KEY` | — | LLM 调用密钥（必填），`/match`、`/batch`、`/match-dsl`、`/match-dsl-single` 依赖 |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | LLM 接口地址 |
| `MODEL` | `deepseek-v4-flash` | LLM 模型名，可改为 `deepseek-v4-pro` |
| `LLM_TIMEOUT_MS` | `60000` | 单次 LLM 请求超时（毫秒）。排查 `/match` 报 `timeout` 时可调大此值 |

> `.env` 已预置好上述所有项（`LIB_OUT_DIR` 默认注释掉，走代码内置的相对路径；本地启动无需额外配置）。`LLM_*` 几项原本散落在代码默认值里，现在全部集中到 `.env`，改密钥/换模型/调超时都只需改这一个文件，无需碰代码或记环境变量。

---

## 数据来源说明

`search_index.json`（653 条 entry，由 [`POST /rebuild-index`](#post-rebuild-index) 基于 `sources.json` 生成）汇聚了三个组件库的索引：

| source | sourceLabel | entry 数 | hex 文件命名格式 |
|---|---|---|---|
| `ict-ui` | ICT UI 组件库 | 491 | 40 位小写 SHA1（如 `be1d28168c521684a3d888b60f9e8a645653b4b7.txt`） |
| `h-design-chart` | H Design 图表库 | 161 | `{sessionId}_{localId}`（如 `93_55829.txt`） |
| `h-design-light` | H Design 浅色样式库 | 1 | `{sessionId}_{localId}`（如 `1_7379.txt`） |

每条 entry 的 `hexFile` 字段是相对 `lib-out/{source}/` 的路径，例如 `h-design-chart` 的 `93:55829` 对应文件实际位于：

```
{LIB_OUT_DIR}/h-design-chart/component/93_55829.txt
```

服务启动时遍历所有 entry，以 `hexFile` 文件名（去掉扩展名）为 key 建立 `key → 绝对路径` 映射（实测 653 条 entry 无 key 冲突），从而让 `/hex/:key` 无需调用方关心组件来自哪个库。

`/match`、`/batch`、`/match-dsl`、`/match-dsl-single` 的匹配结果中额外带有拼好的 `path` 字段（`= source + '/' + hexFile`，如上例对应 `"h-design-chart/component/93_55829.txt"`），是相对 `LIB_OUT_DIR` 的完整路径。生成设计 DSL 时把它原样写进 instance 的 `path` 字段即可——使用方服务会用自己配置的 `HEX_LIB_DIR`（应指向同一份 `lib-out` 数据）拼接这个 `path` 直接读本地文件，不再调用本服务的 `/hex/:key` 接口。

---

## 新增组件库

新增 `.pix` 组件库的完整操作流程（拆解 → 注册 → 重建索引 → 验证，全程在本服务内通过 `/split`、`/sources`、`/rebuild-index` 完成，无需重启、无需外部脚本）见 [ADDING_LIBRARIES.md](./ADDING_LIBRARIES.md)。

---

## 接口列表

### GET /health

健康检查。

**响应 200：**
```json
{ "status": "ok", "hex_keys": 653 }
```

`hex_keys` 为已加载的 hex key 映射条数。

---

### GET /sources

查看当前已注册的组件库列表（即 `sources.json` 内容，决定 `/rebuild-index` 会处理哪些库）。

**响应 200：**
```json
{
  "sources": [
    { "key": "h-design-light", "label": "H Design 浅色样式库" },
    { "key": "h-design-chart", "label": "H Design 图表库" },
    { "key": "ict-ui",         "label": "ICT UI 组件库" }
  ]
}
```

---

### POST /sources

注册一个新组件库（持久化写入 `sources.json`，供 `/rebuild-index` 使用）。这是「[新增组件库全流程](#新增组件库)」的第②步。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `key` | string | 是 | 组件库目录名，须与 `LIB_OUT_DIR/{key}/component/` 实际目录名完全一致；只能包含字母/数字/`-`/`_`，不允许路径分隔符 |
| `label` | string | 是 | 展示用中文名，会出现在匹配结果的 `sourceLabel` 字段里 |

```json
{ "key": "h-design-dark", "label": "H Design 深色样式库" }
```

**响应 200：** 返回注册后的完整列表
```json
{ "sources": [ { "key": "...", "label": "..." }, ... ] }
```

**响应 400 — `key`/`label` 缺失或 `key` 格式不合法：**
```json
{ "error": "key must be a simple directory name (letters/digits/-/_, no path separators), matching the lib-out/ subdirectory" }
{ "error": "label is required" }
```

**响应 409 — `key` 已注册：**
```json
{ "error": "source already registered: ict-ui" }
```

> 仅登记到列表，**不会**触发索引重建——注册后还需调用 `POST /rebuild-index` 才能让新库真正可被 `/match`、`/hex` 用到。

---

### POST /rebuild-index

基于 `sources.json` 中登记的组件库列表，重新读取各自的 `component_index.json` 并合并生成 `search_index.json`，然后**热重载** `hexPathMap` 与匹配缓存——全程无需重启服务。这是「[新增组件库全流程](#新增组件库)」的第③步。

**请求体：** 无

**响应 200：**
```json
{
  "entries": 653,
  "sources": [
    { "key": "h-design-light", "label": "H Design 浅色样式库", "componentSets": 0,   "standaloneComponents": 1 },
    { "key": "h-design-chart", "label": "H Design 图表库",     "componentSets": 149, "standaloneComponents": 12 },
    { "key": "ict-ui",         "label": "ICT UI 组件库",        "componentSets": 319, "standaloneComponents": 172 },
    { "key": "h-design-dark",  "label": "H Design 深色样式库",  "skipped": true, "reason": "not found: .../lib-out/h-design-dark/component/component_index.json" }
  ],
  "hex_keys": 653
}
```

`entries`/`hex_keys` 为重建后 `search_index.json` 的总条目数与热重载后的 hex key 映射条数；`sources` 按 `sources.json` 顺序逐一报告每个库贡献的 `componentSets`/`standaloneComponents` 数量，找不到 `component_index.json` 的库会标 `skipped: true` 并附 `reason`（不会中断整个重建过程）。

**响应 500 — 重建失败**（如 `LIB_OUT_DIR` 不可读）：
```json
{ "error": "..." }
```

> 调用前后对比 `GET /health` 的 `hex_keys`，可确认新库是否成功接入及增量是否符合预期。

---

### POST /match

单条组件变体语义匹配（LLM 驱动）。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `description` | string | 是 | 组件描述，支持自然语言或结构化描述 |

```json
{ "description": "主按钮大号" }
```

**响应 200：**

```json
{
  "source": "ict-ui",
  "sourceLabel": "ICT UI 组件库",
  "componentSetName": "1.按钮",
  "componentKey": "9a9da828027b6bdc773731bb333817c0799c208d",
  "hexFile": "component/9a9da828027b6bdc773731bb333817c0799c208d.txt",
  "path": "ict-ui/component/9a9da828027b6bdc773731bb333817c0799c208d.txt",
  "variant": {
    "name": "status=primary, Interaction=default, size=large, disabled=false",
    "variantKey": "7f599a2db9d8ac901cf4c858825d1e04221d3021",
    "guid": "4280:102987"
  },
  "reason": "该变体为 status=primary（主按钮）、size=large（大号），且为默认交互状态，与“主按钮大号”完全匹配。"
}
```

**响应 400：** `{ "error": "description is required" }`

**响应 404：** `{ "error": "no match found" }`

> 实测单条匹配耗时约 5~6 秒（内部最多 3 次 LLM 调用：语义提取 → 选组件集 → 精选变体）。

> 报 400/404/500 或 timeout 时如何通过进程日志定位卡在哪一步、为什么——日志格式与排查方法见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。

---

### POST /batch

批量组件变体匹配，最多 100 条，内部 5 并发执行。

**请求体（两种格式均可）：**

```json
{ "descriptions": ["主按钮大号", "折线图缩放轴默认状态"] }
```
```json
["主按钮大号", "折线图缩放轴默认状态"]
```

**响应 200：** 按输入顺序返回结果数组，单条失败时该项为 `{ error, description }`。

**响应 400：**
```json
{ "error": "body must be an array or { descriptions: [] }" }
{ "error": "descriptions array is empty" }
{ "error": "max 100 descriptions per request" }
```

---

### POST /match-dsl

输入一棵 node-dsl 节点树，自动提取所有可匹配节点（`button` / `input` / `navbar` / `tabbar` / `switch` / `badge` / `avatar`），**整页统一匹配**：把本页所有实例合并成一次 LLM 裁决（先各自本地过滤候选，再统一选组件集、按所选组件集分组统一选变体），让模型看到全局上下文后再下结论，因此语义相同的多个实例（如同一页里的多个"确定按钮"）会被稳定地匹配到同一个组件集和变体。

> 想对照"逐节点独立匹配"的旧行为或排查问题，见下方 [`POST /match-dsl-single`](#post-match-dsl-single)。

**请求方式（二选一）：**

```bash
# multipart 文件上传
curl -X POST http://localhost:3102/match-dsl -F "file=@page.json"

# JSON body
curl -X POST http://localhost:3102/match-dsl -H "Content-Type: application/json" -d '{ ... }'
```

**响应 200：** 按深度优先顺序返回匹配结果数组（仅含参与匹配的节点）：

```json
[
  {
    "nid": 20,
    "semantic": "button",
    "label": "主登录按钮",
    "match": {
      "sourceLabel": "ICT UI 组件库",
      "componentSetName": "1.按钮",
      "componentKey": "...",
      "hexFile": "component/xxx.txt",
      "path": "ict-ui/component/xxx.txt",
      "variant": { "name": "...", "variantKey": "..." },
      "reason": "..."
    }
  }
]
```

**响应 400：**
```json
{ "error": "uploaded file is not valid JSON" }
{ "error": "send a file via -F \"file=@page.json\" or a JSON body" }
```

> 实测对最小节点树（仅 `container` 根节点，无可匹配子节点）返回 `[]`。

---

### POST /match-dsl-single

和 `/match-dsl` 接受同样的输入（multipart 文件 / JSON body 二选一），返回同样结构的结果数组，唯一区别是匹配方式：**逐节点独立匹配**——每个实例各自跑一遍完整的"语义提取 → 选组件集 → 选变体"三步流程（即 `/match` 单条匹配的逻辑，内部 5 并发执行），互不知情。

这是 `/match-dsl` 改为整页统一匹配之前的行为，保留下来供需要对照旧结果或排查"统一匹配"相关问题时使用；**新接入直接用 `/match-dsl` 即可**，它能让同语义的多个实例得到一致的匹配结果，调用次数也更少。

```bash
# multipart 文件上传
curl -X POST http://localhost:3102/match-dsl-single -F "file=@page.json"

# JSON body
curl -X POST http://localhost:3102/match-dsl-single -H "Content-Type: application/json" -d '{ ... }'
```

**响应 200 / 400：** 与 [`POST /match-dsl`](#post-match-dsl) 完全一致。

---

### POST /split

上传 `.pix` 组件库文件，调用 `split_compset` WASM（编译自 [pix-split/split_compset_wasm.cpp](../../pixso-parse/pix-split/split_compset_wasm.cpp)，与 CLI `split_compset build_index` 同源同逻辑）拆解为 `{componentKey 或 sessionId_localId}.txt` + `component_index.json`。

这是「[新增组件库全流程](#新增组件库)」的第①步——**拆解只是第一步，产物要真正可被 `/match`、`/hex` 用到，还需要继续走完注册 sources → 重新生成索引 → 验证（见下方全流程）**。

**请求方式：** `multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | file | 是 | `.pix` 组件库文件 |
| `publishFile` | string | 否 | 缺少 `componentKey` 时用于补写发布信息（同 CLI `--publish-file`），生成规则：`componentKey = SHA1(publishFile + sessionID:localID)` |
| `source` | string | 否 | 新库的目录名（即 `lib-out/` 下的 kebab-case 子目录名，只能包含字母/数字/`-`/`_`，不允许路径分隔符）。**传了此字段时跳过 zip 打包，直接把拆解结果写入 `LIB_OUT_DIR/{source}/component/`**，免去手动解压挪动；不传则维持原行为，返回 zip 由调用方自行解压放置 |

**方式 A — 不传 `source`：返回 zip，自行解压放置**

```bash
curl -X POST http://localhost:3102/split \
  -F "file=@library.pix" \
  -F "publishFile=QcO-1WDViGmGQ4IFU_p4FQ"
```

**响应 200：**

```json
{
  "stats": {
    "total": 1,
    "componentSets": 1,
    "standaloneComponents": 0,
    "compDir": "component",
    "indexFile": "component/component_index.json"
  },
  "zip": "UEsDBAoAAAAAAMh..."
}
```

`stats` 字段含义同 CLI `build_index` 的输出：`total` 为写出的文件总数，`componentSets`/`standaloneComponents` 分别是组件集与独立组件数量；`compDir`/`indexFile` 是相对 zip 根目录的路径（始终是 `component` / `component/component_index.json`）。

**zip 包结构**（解压后即可整体放进 `lib-out/{新库目录名}/`）：

```
component/
├── component_index.json
├── {componentKey 或 sessionId_localId}.txt
└── ...
```

**方式 B — 传 `source`：直接落盘到 `lib-out/{source}/`，跳过 zip**

```bash
curl -X POST http://localhost:3102/split \
  -F "file=@library.pix" \
  -F "publishFile=QcO-1WDViGmGQ4IFU_p4FQ" \
  -F "source=h-design-new"
```

**响应 200：**

```json
{
  "stats": {
    "total": 1,
    "componentSets": 1,
    "standaloneComponents": 0,
    "compDir": "component",
    "indexFile": "component/component_index.json"
  },
  "savedTo": "h-design-new/component"
}
```

`savedTo` 是相对 `LIB_OUT_DIR` 的路径，文件已直接写到 `{LIB_OUT_DIR}/h-design-new/component/` 下。**为避免覆盖已有数据，若该目录已存在会直接返回 500 报错**，需先手动清理或换一个 `source` 名再重试。

**响应 400 — 未上传文件 / source 格式错误：**
```json
{ "error": "send a .pix file via -F \"file=@library.pix\"" }
{ "error": "source must be a simple directory name (letters/digits/-/_, no path separators)" }
```

**响应 500 — 拆解失败**（文件不是合法 `.pix`、解析失败、没有可拆出的组件集，或 `source` 目录已存在）：
```json
{ "error": "parse failed: library.pix" }
{ "error": "no component sets found" }
{ "error": "目标目录已存在，为避免覆盖已有数据请先手动清理后重试: h-design-new/component" }
```

> 实测验证：上传一个含 1 个组件集（2 个变体）的真实 `.pix` 文件，不传 `source` 时返回 `{"total":1,"componentSets":1,"standaloneComponents":0,...}` + zip，解压得到 `component/component_index.json` + `component/2_105.txt`，内容与 CLI 拆解结果一致；上传非 `.pix` 文件返回 `{"error":"parse failed: <原始文件名>"}`（已对临时路径做了脱敏，不会泄露服务器目录结构）。

> ⚠️ 上传体积限制 200MB（`.pix` 库文件可能较大）；无论哪种方式，本接口只完成"拆解落盘"，**不会**自动更新 `search_index.json`，仍需按上方全流程继续 `POST /sources` 注册 → `POST /rebuild-index` 重建索引并热重载，避免未经检查就让新数据生效。

---

### GET /hex/:key

跨组件库查找并返回指定 key 对应的 hex 文件内容（供其他服务调用）。

**路径参数：** `key` —
- 40 位小写 hex 字符串（旧版 SHA1 componentKey，如 `ict-ui` 库）
- 或 `{sessionId}_{localId}` 格式（新版 guid 派生，如 `h-design-chart`、`h-design-light` 库）

**响应 200：** `Content-Type: text/plain`，hex 文件原始内容（已实测三个来源库的 key 均可正确解析定位）

**响应 404 — key 格式合法但未收录或文件缺失：**
```json
{ "error": "component not found: 0000000000000000000000000000000000000000" }
```

**响应 400 — key 格式不合法：**
```json
{ "error": "key must be a 40-char lowercase hex string or {sessionId}_{localId}" }
```

---

## 核心能力一览

| 能力 | 接口 | 说明 |
|---|---|---|
| 组件查询 | `/match`、`/batch`、`/match-dsl`、`/match-dsl-single` | LLM 语义匹配，支持单条 / 批量 / 从 DSL 节点树自动提取匹配（`/match-dsl` 整页统一裁决，`/match-dsl-single` 逐节点独立匹配） |
| hex 获取 | `/hex/:key` | 跨 `ict-ui` / `h-design-chart` / `h-design-light` 等多组件库统一查找，调用方无需关心组件来自哪个库 |
| 组件库拆解 | `/split` | 上传 `.pix` 直接拆解（基于 WASM），可选直接落盘到 `LIB_OUT_DIR/{source}/` |
| 组件库管理 | `/sources`、`/rebuild-index` | 注册新组件库、重建索引并热重载——见上方[「新增组件库」](#新增组件库)一节 |

---

## 调用示例

```bash
# 1. 语义匹配，拿到 variant.guid / componentKey
curl -s -X POST http://localhost:3102/match \
  -H "Content-Type: application/json" \
  -d '{ "description": "主按钮大号" }'

# 2. 用匹配结果中的 componentKey（或 hexFile 文件名）取 hex 内容
curl -s http://localhost:3102/hex/9a9da828027b6bdc773731bb333817c0799c208d
```
