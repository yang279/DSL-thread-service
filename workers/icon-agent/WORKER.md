# icon-agent worker

IPC 子进程，由主进程通过 `child_process.fork` 启动，负责识别节点树中的图标并注入 SVG。

## 目录结构

```
icon-agent/
├── worker.js   ← 入口，本文件描述的对象
├── core.js     ← 业务实现（需自行提供）
├── .env        ← 环境变量（可选）
└── WORKER.md
```

## core.js 约定

worker 启动时会 `require('./core')` 并校验以下导出，缺失任何一项都会导致进程退出。

### 必须导出

#### `init(): Promise<void> | void`

初始化业务模块（加载模型、读取索引等）。worker 会等待其完成后才发送 `ready`。

#### `resolve(data: object): Promise<object>`

遍历节点树，为所有 `semantic === 'icon'` 的节点注入 `iconSvg` 字段，返回处理后的节点树。

| 参数 | 类型 | 说明 |
|---|---|---|
| `data` | `object` | node-dsl 节点树 |

返回值：与入参结构相同，各图标节点新增 `iconSvg` 字段。

### 可选导出

#### `getStats(): object`

返回状态信息，用于 `health` 检查，例如 `{ icons: 1200 }`。

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
| `resolve` | node-dsl 节点树对象 | 注入图标 SVG |
| `health` | — | 健康检查 |

## 环境变量

`.env` 文件放在 `icon-agent/` 目录下，worker 启动时自动加载。已存在于系统环境的变量不会被覆盖。

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
