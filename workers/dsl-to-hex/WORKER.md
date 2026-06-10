# dsl-to-hex worker

IPC 子进程，由主进程通过 `child_process.fork` 启动，负责将 design-dsl JSON 转换为 Pixso 可导入的 hex 文件。

## 目录结构

```
dsl-to-hex/
├── worker.js   ← 入口，本文件描述的对象
├── core.js     ← 业务实现（需自行提供）
├── .env        ← 环境变量（可选）
└── WORKER.md
```

## core.js 约定

worker 启动时会 `require('./core')` 并校验以下导出，缺失任何一项都会导致进程退出。

### 必须导出

#### `init(): Promise<void> | void`

初始化业务模块（预热 WASM 等）。worker 会等待其完成后才发送 `ready`。

#### `convert(dsl: object): Promise<object>`

将 design-dsl JSON 转换为 hex，打包成 zip 返回。

| 参数 | 类型 | 说明 |
|---|---|---|
| `dsl` | `object` | design-dsl JSON，需包含 `meta` 和 `pages` 字段 |

**返回值（成功）：**

```json
{
  "zip": "<base64 编码的 zip 文件>",
  "missing_keys": ["<缺失组件key>"]
}
```

**返回值（失败）：**

```json
{ "error": "<错误信息>" }
```

zip 内容：
- `output.hex` — 主 hex 文件
- `<id>.svg` — 图标 SVG（来自节点 placeholder）
- `<id>.png` — 图片资源（来自节点 placeholder）

### 可选导出

#### `getStats(): object`

返回状态信息，用于 `health` 检查。

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
| `convert` | design-dsl 对象 | 转换为 hex zip |
| `health` | — | 健康检查 |

## 环境变量

`.env` 文件放在 `dsl-to-hex/` 目录下，worker 启动时自动加载。

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
