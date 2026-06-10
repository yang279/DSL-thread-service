# 组件查找全流程

> 代码入口：[match_variant.js](match_variant.js)、[match_dsl.js](match_dsl.js)

---

## 一、单个查找（`POST /match` → `matchVariant`）

**输入**：一段自然语言描述，如 `"主按钮大号"` 或 `"Confirm Button"`

### 流程图

```
输入 description
    │
    ├─ [规范映射表] canonicalKey(description) 命中？
    │     └─ 命中 → 校验组件+变体仍在索引中 → 直接返回（0 次 LLM）
    │
    ├─ [中文判断] 非空白字符中中文占比 ≥ 30%？
    │     ├─ 是 → searchQuery = description（跳过语义提取，省 1 次 LLM）
    │     └─ 否 → [LLM #1] normalizeQuery → searchQuery（中文关键词）
    │
    ├─ [本地过滤] localFilter(searchQuery) → Top-10 候选组件集（无 LLM）
    │     └─ 空 → 返回 null
    │
    ├─ [LLM #2] selectComponentSet → 选出 1 个组件集（返回 guid）
    │     └─ 未选中 → 返回 null
    │
    ├─ [LLM #3] selectVariant → 选出 1 个变体（返回 guid）
    │     └─ 未选中 → 返回 null
    │
    ├─ [规范映射表] 写入新结果（异步，不阻塞响应）
    └─ 返回结果
```

### LLM 调用详情

#### LLM #1：`normalizeQuery`（语义提取，仅英文/非中文输入触发）

| 项 | 内容 |
|---|---|
| 作用 | 将英文或混合语言描述转为中文关键词，供本地过滤使用 |
| System prompt | `你是 UI 组件库搜索助手。将用户描述转换为 2~5 个中文搜索关键词，用于在组件库中检索。只输出关键词，空格分隔，不要任何解释。` |
| User prompt | `{description}` |
| 输出 | 空格分隔的中文关键词，如 `确定 按钮 主要` |

#### LLM #2：`selectComponentSet`（选组件集）

| 项 | 内容 |
|---|---|
| 作用 | 从本地过滤出的 Top-10 候选中选出语义最匹配的组件集 |
| User prompt | `从以下候选组件集中，选出与描述最匹配的一个，返回其 guid。` |
| 候选列表格式 | `[{guid\|componentKey}] 【组件集名称】(库名) \| N 个变体` |
| Tool schema | `select_component_set` → `{ guid: string }` |
| 输出处理 | 用返回的 guid 在候选列表中 find，得到完整 entry 对象 |

**Prompt 示例：**
```
从以下候选组件集中，选出与描述最匹配的一个，返回其 guid。

描述：主按钮大号

候选：
  [7325:1024] 【Button/Primary】(设计规范库-A) | 12 个变体
  [7325:2048] 【Button/Secondary】(设计规范库-A) | 8 个变体
  [8801:512]  【ButtonGroup】(设计规范库-B) | 4 个变体
  ...
```

#### LLM #3：`selectVariant`（精选变体）

| 项 | 内容 |
|---|---|
| 作用 | 在选定的组件集内，选出与描述最匹配的变体 |
| User prompt | `组件集【{name}】({sourceLabel}) 有以下变体，选出与描述最匹配的一个，返回其 guid。` |
| 变体列表格式 | `[{guid\|variantKey}] {变体名称}` |
| Tool schema | `select_variant` → `{ variantGuid: string, reason: string }` |
| 输出处理 | 用返回的 guid 在变体列表中 find；`reason` 透传到结果里 |

**Prompt 示例：**
```
组件集【Button/Primary】(设计规范库-A) 有以下变体，选出与描述最匹配的一个，返回其 guid。

描述：主按钮大号

变体：
  [7325:1025] 大小=Large 状态=Default 类型=Primary
  [7325:1026] 大小=Large 状态=Hover 类型=Primary
  [7325:1027] 大小=Medium 状态=Default 类型=Primary
  [7325:1028] 大小=Small 状态=Default 类型=Primary
  ...
```

### LLM 调用次数

| 场景 | 次数 |
|---|---|
| 规范映射表命中 | 0 次 |
| 中文输入 + 首次查询 | 2 次（跳过语义提取） |
| 英文/混合输入 + 首次查询 | 3 次 |

---

## 二、DSL 整页查找（`POST /match-dsl` → `matchDsl` → `matchVariantsTogether`）

**输入**：一棵 DSL 节点树（JSON），包含 `semantic`、`label`、`nid`、`children` 等字段

### 前置：节点提取与 query 构建（`match_dsl.js`，无 LLM）

```javascript
// 1. 递归收集 semantic 属于可匹配类型的节点
MATCHABLE = { button, input, navbar, tabbar, switch, badge, avatar }

// 2. 用 SEMANTIC_HINT 把 label 拼成更精准的查询词
SEMANTIC_HINT = { button:'按钮', input:'输入框', navbar:'导航栏', ... }
buildQuery('确定', 'button') → '确定 按钮'
buildQuery('确定按钮', 'button') → '确定按钮'  // label 里已含 hint，不重复
```

这一步不调 LLM，`matchVariantsTogether` 也不再调 `normalizeQuery`——`buildQuery` 产生的 query 已经是中文结构化文本，本地过滤够用。

### 流程图

```
输入 queries[]（每个节点一条 buildQuery 结果）
    │
    ├─ Step 0 [聚类] 按 canonicalKey(query) 分簇
    │     相同 query 聚一簇，每簇只解析一次，结果广播给全部成员
    │
    ├─ Step 1 [规范映射表] 按簇查，整簇命中直接采用（不进 LLM）
    │     命中的簇 → 生成"对齐基准"anchorNote，注入后续 LLM prompt
    │     未命中的簇 → 进入 Step 2
    │
    ├─ Step 2 [本地过滤] 每簇只跑一次代表 query → Top-10 候选（无 LLM）
    │     未命中的簇 → 结果为 null
    │
    ├─ Step 3 [LLM #1] selectComponentSetsTogether
    │     所有待处理簇的代表 query 一次性提交，共用同一份候选池
    │     → 每簇返回 1 个 guid
    │
    ├─ Step 4 [LLM #G] selectVariantsTogether（每个不同组件集各 1 次）
    │     按 Step 3 选出的组件集分组，每组一次性选变体
    │     → picks 广播给簇内所有原始索引
    │
    ├─ Step 5 [规范映射表] 写入本次新裁决结果（异步）
    └─ 按原始顺序组装结果数组返回
```

### LLM 调用详情

#### LLM #1：`selectComponentSetsTogether`（整页选组件集）

| 项 | 内容 |
|---|---|
| 作用 | 让模型看到整页全部元素后，为每个簇统一裁决组件集（保证跨实例一致性） |
| 候选池 | 所有簇的 Top-10 候选去重合并，共享同一份池 |
| 元素列表格式 | `N. {query}` |
| 候选池格式 | `[{guid\|componentKey}] 【名称】(库名) \| N 个变体` |
| Tool schema | `select_component_sets` → `{ guids: string[] }` 等长数组 |
| 对齐基准 | 若有规范映射表命中的簇，在 prompt 头部注入已确认结果，引导模型与之对齐 |

**Prompt 示例：**
```
参考（以下元素已由规范映射表确认，请让语义相近的元素与之对齐）：
  - 【Button/Primary】→ 大小=Large 状态=Default

下面是同一个页面里的多个 UI 元素，请按顺序从候选组件集中为每个元素选出最匹配的一个，返回其 guid。注意：
1. 描述相近或语义相同的元素（如同样是"确定按钮"）应给出一致的选择，不要在它们之间随意切换不同的组件集；
2. 返回的数组长度必须与元素数量（3 个）完全一致，按顺序一一对应。

元素列表（共 3 个）：
  1. 确定 按钮
  2. 取消 按钮
  3. 用户名 输入框

候选组件集（所有元素共享同一份候选池）：
  [7325:1024] 【Button/Primary】(设计规范库-A) | 12 个变体
  [7325:2048] 【Button/Secondary】(设计规范库-A) | 8 个变体
  [9001:100]  【Input/Text】(设计规范库-A) | 6 个变体
  ...
```

#### LLM #G：`selectVariantsTogether`（整页选变体，每个组件集 1 次）

| 项 | 内容 |
|---|---|
| 作用 | 在同一组件集内，为本组所有元素统一选变体 |
| 元素列表格式 | `N. {query}` |
| 变体列表格式 | `[{guid\|variantKey}] {变体名称}` |
| Tool schema | `select_variants` → `{ picks: [{variantGuid, reason}] }` 等长数组 |
| 对齐基准 | 同上，注入 anchorNote |

**Prompt 示例：**
```
组件集【Button/Primary】(设计规范库-A) 有以下变体，下面这些 UI 元素都已被归到这个组件集，
请按顺序为每个元素选出最匹配的变体，返回其 guid。注意：
1. 描述相近或语义相同的元素应给出一致的选择；
2. 返回的数组长度必须与元素数量（2 个）完全一致，按顺序一一对应。

元素列表（共 2 个）：
  1. 确定 按钮
  2. 取消 按钮

变体：
  [7325:1025] 大小=Large 状态=Default 类型=Primary
  [7325:1026] 大小=Large 状态=Default 类型=Secondary
  [7325:1027] 大小=Medium 状态=Default 类型=Primary
  ...
```

### LLM 调用次数

| 场景 | 次数 |
|---|---|
| 全部命中规范映射表 | 0 次 |
| N 条查询，G 个不同组件集，全是新查询 | 1 + G 次 |
| 有重复 query（聚类后 M 簇，G' 个组件集） | 1 + G'（G' ≤ G，通常 G' ≪ G） |

---

## 三、规范映射表（`canonical_map.json`）

两条路径共用，随 LLM 裁决结果持续积累。

| 项 | 说明 |
|---|---|
| 存储位置 | `canonical_map.json`（同服务目录） |
| key 格式 | `canonicalKey(query)` = 小写 + 合并空白 |
| value 格式 | `{ componentKey, variantKey }` |
| 失效机制 | 顶层字段 `_indexFingerprint` 记录 `search_index.json` 的 mtime；索引重建后 mtime 变化，整表自动失效 |
| 并发安全 | 写入通过 Promise 串行锁（`_mapWriteLock`）+ merge-on-write 保证，避免并发覆写丢失条目 |
| 单条路径 | `matchVariant` 命中返回 0 次 LLM；未命中时首次裁决完写入，下次请求直接命中 |
| 批量路径 | `matchVariantsTogether` 按簇查，命中的簇跳过 LLM 且结果注入 prompt 作为对齐基准 |

---

## 四、本地过滤（`localFilter`，无 LLM）

```
tokenize(query)
  → 按分隔符拆词 + 中文 bigram（相邻两字）
  → 过滤长度 < 2 的 token

每个 entry.searchText 按 token 命中长度累加得分
  → 过滤 score=0
  → 按分降序取 Top-K（默认 10）
```

`searchText` 由离线脚本（`rebuild_index.js`）从组件集名称、变体名称等字段拼接生成，重建索引时更新。

---

## 五、数据流总览

```
DSL 节点树
    ↓ collectNodes + buildQuery（match_dsl.js）
queries[]
    ↓ matchVariantsTogether（match_variant.js）
        ├─ canonical_map.json（命中直通）
        ├─ localFilter（search_index.json）
        ├─ selectComponentSetsTogether（LLM）
        └─ selectVariantsTogether（LLM × G 组）
结果数组 [{ nid, semantic, label, match: { componentSetName, componentKey, variant, path, ... } }]
```

```
自然语言描述
    ↓ matchVariant（match_variant.js）
        ├─ canonical_map.json（命中直通）
        ├─ normalizeQuery（LLM，仅非中文输入）
        ├─ localFilter（search_index.json）
        ├─ selectComponentSet（LLM）
        └─ selectVariant（LLM）
结果 { componentSetName, componentKey, variant, path, reason }
```
