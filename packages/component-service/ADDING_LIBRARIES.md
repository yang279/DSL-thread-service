# 新增组件库：全程在 `component-service` 内完成

当有一个新的 `.pix` 组件库需要接入时，**全部步骤都在本服务内完成**，无需借助任何外部脚本或手动复制文件。仅 `LIB_OUT_DIR` 指向的 hex 静态资源（`lib-out/{source}/component/*.txt`）允许放在服务外的指定目录，其余（组件库注册表 `sources.json`、索引生成逻辑 `rebuild_index.js`、`search_index.json`）都内置在本服务里、随服务一起维护。

完整链路：

```
① POST /split (source=xxx)   ② POST /sources              ③ POST /rebuild-index
拆解 .pix 落盘到                登记 {key,label} 到            读取各 source 的 component_index.json
LIB_OUT_DIR/{source}/           本服务的 sources.json          → 合并 → 重写 search_index.json
component/                                                    → 热重载 hexPathMap + 匹配缓存
                                                                  ↓
                                                            无需重启，立即生效
```

## 第 ① 步：拆解组件库，产出 `component/` 目录

直接调用本服务自带的 [`POST /split`](./API.md#post-split)，传 `source` 参数让拆解结果直接落盘到 `LIB_OUT_DIR/{source}/component/`，免去手动解压挪动：

```bash
curl -s -X POST http://localhost:3102/split \
  -F "file=@<新组件库>.pix" \
  -F "publishFile=<publish-id>" \
  -F "source=<新库目录名>"
```

产出的目录结构：

```
{LIB_OUT_DIR}/<新库目录名>/
└── component/
    ├── component_index.json   # 必须：记录该库所有组件集/独立组件及其 hexFile 路径
    ├── {componentKey 或 sessionId_localId}.txt
    └── ...
```

> **`<新库目录名>` 即后续的 `source` key，建议直接用新库名的 kebab-case**——它既是 `LIB_OUT_DIR/` 下的子目录名，也是 `sources.json` 里的 `key`，还是 `search_index.json` 里每条 entry 的 `source` 字段。三者必须完全一致，否则拼出来的路径会找不到文件。
>
> 没有 shell 访问权限跑 CLI 也没关系——`/split` 走 HTTP 即可完成这一步；CLI 方式（`pix-split/bin/split_compset build_index ...`）仍然可用，但产物落到 `LIB_OUT_DIR` 后，下面 ②③ 两步同样要走本服务的接口才能接入。

## 第 ② 步：登记到 `sources.json`

调用 [`POST /sources`](./API.md#post-sources) 把新库注册进本服务的组件库列表（持久化在 `nodejs/component-service/sources.json`，服务重启后依然有效）：

```bash
curl -s -X POST http://localhost:3102/sources \
  -H "Content-Type: application/json" \
  -d '{ "key": "<新库目录名>", "label": "<展示用中文名>" }'
```

- `key`：必须与 `LIB_OUT_DIR/` 下的子目录名**完全一致**（决定运行时路径拼接是否正确），格式同 `/split` 的 `source`（字母/数字/`-`/`_`，不允许路径分隔符）
- `label`：展示用的中文名，会出现在 `/match` 等接口返回结果的 `sourceLabel` 字段里
- 重复注册同一个 `key` 会返回 409

> 用 [`GET /sources`](./API.md#get-sources) 随时查看当前已注册的组件库列表。

## 第 ③ 步：重新生成索引并热重载

调用 [`POST /rebuild-index`](./API.md#post-rebuild-index)，一步完成「读取 `sources.json` 中每个库的 `component_index.json` → 合并打标 → 重写 `search_index.json` → 重建 `hexPathMap` → 清空匹配缓存」，**无需重启服务**：

```bash
curl -s -X POST http://localhost:3102/rebuild-index
```

返回结果里 `sources` 数组按 `sources.json` 顺序列出每个库贡献的 `componentSets`/`standaloneComponents` 数量（找不到 `component_index.json` 的库会标 `skipped: true` 并附原因），`entries`/`hex_keys` 是合并后的总数，可与接入前的 `/health` 做对比确认增量符合预期。

## 第 ④ 步：验证

```bash
# 1. 确认 hex_keys 总数比接入前增加了（增量应等于新库贡献的 entry 数）
curl -s http://localhost:3102/health

# 2. 抽取新库 component_index.json 里的某个 hexFile，验证能查到
curl -s http://localhost:3102/hex/<新库里的某个key>

# 3. 用新库特有的组件描述跑一次语义匹配，确认能命中且 source/sourceLabel 正确
curl -s -X POST http://localhost:3102/match -H "Content-Type: application/json" \
  -d '{ "description": "<新库中某组件的典型描述>" }'
```

## 刷新已有组件库（库内容有更新但 `source` 不变）

重新走第①步把新的 `component/` 落到同一个 `source` 目录下（注意 `/split` 不会覆盖已存在目录，需先清理旧数据），`sources.json` 无需改动，直接调用 `POST /rebuild-index` 重新生成索引并热重载即可。

## 跨机器部署时的 hex 静态资源同步

`LIB_OUT_DIR` 是本服务里**唯一**允许指向外部路径的部分（其余如 `sources.json`、`search_index.json` 都在服务目录内、随服务一起部署）。跨机器部署时（参见 [MIGRATION.md](../MIGRATION.md)），需要把新增的 `LIB_OUT_DIR/{新库目录名}/` 一并同步到目标机器上 `LIB_OUT_DIR` 指向的路径下；本地/同机部署默认 `LIB_OUT_DIR` 指向 `pixso-parse/pix-split/lib-out`，第①步的产物已经落在这里，无需额外操作。

## 排错提示

| 现象 | 原因 |
|---|---|
| `/rebuild-index` 返回的 `sources` 里某库 `skipped: true` | 该 `key` 对应的 `LIB_OUT_DIR/{key}/component/component_index.json` 不存在——检查 `/split` 的 `source` 是否与 `sources.json` 里的 `key` 完全一致，或新库数据是否已落到 `LIB_OUT_DIR` |
| `/health` 的 `hex_keys` 没有增加 | 没有调用 `POST /rebuild-index`，或调用后 `sources` 里对应库被 `skipped` |
| `/hex/:key` 对新库的 key 返回 404 | `sources.json` 里的 `key` 与 `LIB_OUT_DIR/` 下实际目录名不一致，导致拼出的路径错误 |
| `/match` 匹配结果里出现新库但 `sourceLabel` 显示异常/缺失 | `POST /sources` 注册时 `label` 字段写错或漏写——可重新 `POST /sources` 用正确的 `label`（先在 `sources.json` 里删掉旧条目）后再 `rebuild-index` |
| `key 冲突` / 同一个 key 映射到了错误的文件 | 极小概率事件（新库与已有库的 hex 文件名恰好相同），需要检查 `hexPathMap` 构建逻辑（[server.js](./server.js)）按何种顺序覆盖，必要时改用 `source:key` 复合 key |
