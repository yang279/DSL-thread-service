# component-service 日志与排查指南

接口本身只把精简后的 `{ error }` 返回给调用方，看不出请求到没到、卡在哪一步、具体原因。`component-service` 的进程日志（`node server.js` 的标准输出/标准错误）里记录了完整链路，从"收到请求"到"每一步进展"再到"返回了什么"。本文档说明日志格式，并给出常见问题的排查路径。

## 1. 请求有没有到达

每个接口收到请求时都会先打一条 `收到请求`，带上关键参数（如 `description=`、`key=`、文件名等）。日志里完全没有这条，说明请求没到 `component-service`（网络/反代/端口问题）。

## 2. 所有非 2xx 响应都会落日志

4xx 用 `warn`、5xx 用 `error`，格式统一为：

```
[时间戳] <接口> (<关键参数>) 返回 <状态码>：<原因>
```

例如：

```
[2026-06-08T08:00:00.000Z] POST /match (description="主按钮大号") 返回 500：Request timed out.
[2026-06-08T08:00:01.000Z] POST /match (description=undefined) 返回 400：description is required
[2026-06-08T08:00:02.000Z] GET /hex/:key (key="abc") 返回 404：component not found: abc
```

看到 400/404 不代表服务有问题，多是调用方传参不对——日志里的"原因"和"关键参数"已经足够定位是哪次请求、传了什么、为什么被拒。

## 3. LLM 匹配链路的逐步进展

`/match`、`/batch`、`/match-dsl`、`/match-dsl-single` 都会打印逐步进展，但走的是两条不同的链路：

### 3.1 逐条独立匹配：`/match`、`/batch`、`/match-dsl-single`

内部每条描述都走 `matchVariant` 的三步（语义提取 → 选组件集 → 精选变体）：

```
[match_variant] matchVariant 开始：「主按钮大号」
[match_variant] normalizeQuery（语义提取） → 调用 https://api.deepseek.com/v1 (model=deepseek-v4-flash, timeout=60000ms)
[match_variant] normalizeQuery（语义提取） ✓ 完成，耗时 1016ms
[match_variant] selectComponentSet（选组件集） → 调用 https://api.deepseek.com/v1 (model=deepseek-v4-flash, timeout=60000ms)
[match_variant] selectComponentSet（选组件集） ✗ 失败，耗时 60003ms：Request timed out.
[2026-06-08T08:00:00.000Z] POST /match (description="主按钮大号") 返回 500：Request timed out.
```

`→ 调用` 之后长时间没有 `✓`/`✗`，就是卡在那一步；`normalizeQuery` / `selectComponentSet` / `selectVariant` 分别对应"语义提取 / 选组件集 / 精选变体"。

### 3.2 整页统一匹配：`/match-dsl`

走的是 `matchVariantsTogether`，按 Step 1/2/3 推进，并报告每一步命中了多少：

```
[match_dsl] matchDsl（整页统一匹配）→ 提取到 3 个可匹配节点
[match_dsl] matchDsl → 查询词：["确定 按钮","确定 按钮","用户名 输入框"]
[match_variant] matchVariantsTogether（整页统一匹配）开始：共 3 条查询
[match_variant] Step 1 本地过滤完成：3/3 条有候选组件集，0 条本地过滤未命中
[match_variant] Step 2 开始：把 3 个元素一次性交给 LLM 选组件集
[match_variant] selectComponentSetsTogether → 3 个元素，去重合并候选池 17 个组件集
[match_variant] selectComponentSetsTogether ✓ 完成：3/3 个元素选到了组件集，去重后涉及 2 个不同组件集
[match_variant] Step 3 开始：按选到的组件集分成 2 组，逐组让 LLM 统一选变体（1.按钮×2、1.单行文本输入框×1)
[match_variant] selectVariantsTogether ✓ 「1.按钮」完成：2/2 个元素选到了变体
[match_variant] selectVariantsTogether ✓ 「1.单行文本输入框」完成：1/1 个元素选到了变体
[match_variant] matchVariantsTogether ✓ 完成：3 条查询中命中 3 条
[match_dsl] matchDsl ✓ 完成：3 个节点中命中 3 个
[server] POST /match-dsl ✓ 完成：提取到 3 个可匹配节点，命中 3 个
```

如果某一步命中数明显偏低（比如 Step 1 本地过滤大量未命中），说明问题出在本地索引/候选召回，而不是 LLM；如果 Step 2/3 命中数偏低，再去看对应的 `selectComponentSetsTogether`/`selectVariantsTogether` 那一行有没有"⚠ 模型返回数量不一致"的告警——这通常意味着模型没有按要求返回与输入等长的数组。

## 4. 想看 LLM 每一步收到的完整 prompt 和原始回复

把 `.env` 里的 `LLM_LOG_IO` 改成 `true`（重启服务生效），就能在每个 `→ 调用`/`✓ 完成` 之间额外看到 `→ 输入 messages：...` 和 `→ 输出 message：...`——直接定位"模型为什么选了这个 / 选错了"。

prompt 可能很长，单条会按 `LLM_LOG_IO_MAX_LEN`（默认 4000 字符）截断；调大这个值可看到完整内容。排查完记得把 `LLM_LOG_IO` 改回 `false`，避免把大 prompt 持续刷进日志。

## 5. 是真超时还是网络/密钥问题

- 耗时接近 `LLM_TIMEOUT_MS`（默认 60000ms）：通常是连不通 `LLM_BASE_URL` 或对端响应慢
- 耗时很短就报错（如几十~几百毫秒）：通常是 `DASHSCOPE_API_KEY` 无效、`MODEL` 名称错误等鉴权/参数问题，错误信息里一般会带 HTTP 状态码或具体原因

排查顺序：先在 `.env` 里把 `LLM_TIMEOUT_MS` 调大排除"网络慢但最终能通"的情况；再确认 `LLM_BASE_URL`/`DASHSCOPE_API_KEY`/`MODEL` 三项配置正确（见 [API.md](./API.md#启动) 的配置表）。
