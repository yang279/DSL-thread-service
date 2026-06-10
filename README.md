# Unified DSL Pipeline

统一的 DSL 处理流程项目 - 从 node-dsl schema JSON 到 Pixso hex 文件。

## 📦 项目结构

```
unified-dsl-pipeline/
├── packages/
│   ├── icon-agent/          # 图标智能识别服务
│   ├── component-service/   # 组件库匹配服务
│   ├── dsl-to-hex/          # DSL 转 hex 服务
│   └── pipeline-server/     # 主服务（HTTP API + IPC 编排）
├── package.json             # 根 package.json (npm workspaces)
├── .env.example             # 配置模板
└── README.md                # 本文件
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd unified-dsl-pipeline
npm install
```

这会自动安装所有子包的依赖（npm workspaces）。

### 2. 配置环境变量

```bash
cp .env.example .env

# 编辑 .env，填写 API keys:
# - DEEPSEEK_API_KEY (图标解析 + 组件匹配)
# - DASHSCOPE_API_KEY (组件匹配)
```

### 3. 启动服务

**IPC 模式（推荐）** - 一键启动所有服务:

```bash
npm start
```

**HTTP 模式** - 分别启动各服务（用于调试）:

```bash
# 启动图标服务
npm run start:icon

# 启动组件服务
npm run start:component

# 启动 hex 服务
npm run start:hex

# 启动主服务
npm start
```

### 4. 测试 API

```bash
# 健康检查
npm run health

# 处理示例文件
curl -X POST http://localhost:3104/pipeline \
  -F "file=@profile-node.json" \
  -F "page_name=个人中心页面"
```

## 📋 可用命令

### 根项目命令

```bash
npm run bootstrap        # 安装所有依赖
npm start                # 启动主服务（IPC 模式）
npm run start:icon       # 仅启动图标服务
npm run start:component  # 仅启动组件服务
npm run start:hex        # 仅启动 hex 服务
npm run test             # 运行所有测试
npm run build            # 构建所有包
npm run clean            # 清理所有依赖
npm run health           # 检查服务健康
```

### 单包命令

```bash
# 仅对某个包执行命令
npm run test --workspace=@unified/icon-agent
npm run start --workspace=@unified/component-service
npm run build --workspace=@unified/dsl-to-hex
```

## 🔧 各包说明

### @unified/icon-agent

**图标智能识别服务**

- 端口: 3103
- 功能: 
  - 使用 BGE 向量嵌入模型识别图标
  - DeepSeek LLM 解析图标描述
  - 动态修改 SVG（大小/颜色/线条）
- 依赖: transformers, hnswlib-node, openai

**关键文件:**
- `src/core.js` - 核心逻辑
- `src/server.js` - HTTP 服务
- `src/worker.js` - IPC worker
- `iconJson/` - 图标库数据

**问题排查:**
```bash
cd packages/icon-agent
npm run test
```

### @unified/component-service

**组件库匹配服务**

- 端口: 3102
- 功能:
  - LLM 语义匹配组件变体
  - 组件库管理（拆解/注册/重建索引）
  - 规范映射表缓存
- 依赖: express, multer, openai

**关键文件:**
- `core.js` - 核心逻辑
- `server.js` - HTTP 服务
- `worker.js` - IPC worker
- `match_variant.js` - 匹配算法
- `search_index.json` - 组件索引

**问题排查:**
```bash
cd packages/component-service
npm run test
npm run rebuild-index
```

### @unified/dsl-to-hex

**DSL 转 hex 服务**

- 端口: 3101
- 功能:
  - 调用 WASM 转换 DSL
  - placeholder 资源处理
  - zip 打包输出
- 依赖: 无外部 npm 依赖

**关键文件:**
- `converter.js` - 转换逻辑
- `server.js` - HTTP 服务
- `worker.js` - IPC worker
- `bin/dsl_to_hex.wasm` - WASM 模块

**问题排查:**
```bash
cd packages/dsl-to-hex
ls -la bin/dsl_to_hex.wasm  # 检查 WASM 文件
```

### @unified/pipeline-server

**主服务（编排层）**

- 端口: 3104
- 功能:
  - HTTP API 入口
  - IPC 进程管理
  - 完整流程编排
- 依赖: express, multer, 所有子包

**关键文件:**
- `server.js` - HTTP 服务
- `lib/ipc-manager.js` - IPC 管理
- `lib/client.js` - 统一客户端
- `bin/run.js` - CLI 入口

**问题排查:**
```bash
curl http://localhost:3104/health
curl http://localhost:3104/pipeline -F "file=@test.json"
```

## 🐛 问题排查指南

### 检查依赖安装

```bash
# 查看所有包的依赖状态
npm ls --depth=0

# 检查某个包的依赖
npm ls --workspace=@unified/icon-agent
```

### 检查包状态

```bash
# 列出所有 workspace 包
npm workspaces list

# 查看包信息
npm pkg get name version --workspace=@unified/icon-agent
```

### 常见问题

#### 1. API Key 错误

```
错误: 401 Authentication Fails
位置: @unified/icon-agent 或 @unified/component-service
解决: 检查 .env 中的 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY
```

#### 2. WASM 文件缺失

```
错误: WASM 文件不存在
位置: @unified/dsl-to-hex
解决: 
cd packages/dsl-to-hex
ls -la bin/
# 如果缺失，需要从 nodejs/dsl-to-hex/bin 复制
```

#### 3. 图标库数据缺失

```
错误: icons.json 或 index.bin 不存在
位置: @unified/icon-agent
解决:
cd packages/icon-agent
ls -la iconJson/
# 如果缺失，需要从 wonderfulj-main/iconJson 复制
```

#### 4. 组件索引缺失

```
错误: search_index.json 不存在
位置: @unified/component-service
解决:
cd packages/component-service
npm run rebuild-index
```

### 查看详细日志

```bash
# 查看主服务日志
tail -f packages/pipeline-server/logs/out.log

# 查看 icon-agent 日志
curl http://localhost:3103/health

# 查看 component-service 日志
curl http://localhost:3102/health

# 查看 dsl-to-hex 日志
curl http://localhost:3101/health
```

## 📊 性能对比

| 指标 | IPC 模式 | HTTP 模式 |
|------|----------|-----------|
| 进程数 | 1 主 + 3 子进程 | 4 独立进程 |
| 通信方式 | process.send | HTTP |
| 启动时间 | ~10秒 | ~10秒 + 手动启动 |
| 内存占用 | 共享部分资源 | 各进程独立 |
| 适用场景 | 生产部署 | 开发调试 |

## 🔐 环境变量详解

| 变量 | 包 | 说明 |
|------|----|----|
| `PORT` | pipeline-server | 主服务端口（默认 3104） |
| `DEEPSEEK_API_KEY` | icon-agent | 图标解析 API key |
| `DASHSCOPE_API_KEY` | component-service | 组件匹配 API key |
| `MODEL` | component-service | LLM 模型名 |
| `LLM_BASE_URL` | component-service | LLM API 地址 |
| `HF_ENDPOINT` | icon-agent | HuggingFace 镜像地址 |
| `LIB_OUT_DIR` | component-service | 组件库根目录 |
| `HEX_LIB_DIR` | dsl-to-hex | hex 文件根目录 |

## 🚢 部署

### PM2 部署

```bash
cd unified-dsl-pipeline
pm2 start packages/pipeline-server/ecosystem.config.js
pm2 logs unified-pipeline
pm2 monit
```

### Docker 部署

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY unified-dsl-pipeline .
RUN npm install --production
EXPOSE 3104
CMD ["npm", "start"]
```

## 📝 License

ISC# DSL-thread-service
