# component-service worker

IPC 子进程，由主进程通过 `child_process.fork` 启动，负责匹配节点树中的 UI 组件并注入组件信息。

## 目录结构

```
component-service/
├── worker.js   ← 入口，本文件描述的对象
├── core.js     ← 业务实现（需自行提供）
├── .env        ← 环境变量（可选）
└── WORKER.md
```

## core.js 约定

worker 启动时会 `require('./core')` 并校验以下导出，缺失任何一项都会导致进程退出。

### 必须导出

#### `init(): Promise<void> | void`

初始化业务模块（加载搜索索引等）。worker 会等待其完成后才发送 `ready`。

#### `matchDslNodes(data: object): Promise<object[]>`

遍历 node-dsl 树，为所有可匹配语义节点批量匹配组件。

| 参数 | 类型 | 说明 |
|---|---|---|
| `data` | `object` | node-dsl 节点树 |

返回值：`[{ nid: string, match: object | null }]`，与节点树中可匹配节点一一对应。

### 可选导出

#### `getStats(): object`

返回状态信息，用于 `health` 检查，例如 `{ hex_keys: 3200 }`。

## IPC 协议

### 请求格式

```json
{ "type": "request", "id": "<唯一id>", "method": "<方法名>", "data": {} }
```

### 响应格式

成功：`{ "type": "response", "id": "<唯一id>", "data": <结果> }`

失败：`{ "type": "error", "id": "<唯一id>", "error": "<错误信息>" }`

### 支持的方法

| method | data 字段 | 说明 |
|---|---|---|
| `match-dsl` | node-dsl 节点树对象 | 批量匹配节点组件 |
| `health` | — | 健康检查 |

## 环境变量

`.env` 文件放在 `component-service/` 目录下，worker 启动时自动加载。

## 启动流程

```
fork(worker.js)
  → 加载 .env
  → require('./core')
  → 校验 core.init 是否为函数（否则 exit(1)）
  → 执行 core.init()
  → 发送 { type: 'ready' }
  → 监听 IPC 消息
```
