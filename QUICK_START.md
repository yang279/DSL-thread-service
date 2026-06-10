# 快速启动指南

## ✅ 已验证可用的方式

### 1. 文件上传方式（唯一方式）

**所有接口均只支持文件上传，不再支持 JSON body**

```bash
# 启动服务
npm start

# pipeline 接口 - 完整流程
curl -X POST http://localhost:3104/pipeline \
  -F "file=@your-node.json" \
  -F "page_name=页面名称"

# enrich 接口 - 补全节点信息
curl -X POST http://localhost:3104/enrich \
  -F "file=@your-node.json"

# convert 接口 - DSL 转 hex
curl -X POST http://localhost:3104/convert \
  -F "file=@your-dsl.json"

# 响应示例
{
  "success": true,
  "hex": "...Pixso hex 数据...",
  "zip": "UEsDBBQA..."  // base64 编码
}
```

## ⚠️ 重要变更

### 接口调用方式

**所有接口统一改为文件上传方式：**

| 接口 | 调用方式 | 说明 |
|------|---------|------|
| `/pipeline` | `-F "file=@xxx.json"` | 完整流程 |
| `/enrich` | `-F "file=@xxx.json"` | 补全节点 |
| `/convert` | `-F "file=@xxx.json"` | DSL 转换 |

**已移除 JSON body 支持：**
- ❌ 不再支持 `{"data": {...}}` 格式
- ❌ 不再支持 `{"dsl": {...}}` 格式
- ✅ 只支持文件上传方式

## 🔧 配置 API Keys

```bash
# 图标解析服务
vi packages/icon-agent/.env
# DEEPSEEK_API_KEY=sk-真实key

# 组件匹配服务
vi packages/component-service/.env
# DASHSCOPE_API_KEY=sk-真实key
```

## 📋 测试命令

```bash
# 健康检查
curl http://localhost:3104/health

# 测试 pipeline（完整流程）- 文件上传
curl -X POST http://localhost:3104/pipeline \
  -F "file=@profile-node.json" \
  -F "page_name=测试页面"

# 测试 enrich（补全节点）- 文件上传
curl -X POST http://localhost:3104/enrich \
  -F "file=@profile-node.json"

# 测试 convert（DSL 转 hex）- 文件上传
curl -X POST http://localhost:3104/convert \
  -F "file=@test-dsl.json"
```

## ✅ 验证结果

所有接口已验证可用：
- ✅ GET /health - 健康检查
- ✅ POST /enrich - 补全节点信息（只支持文件上传）
- ✅ POST /convert - DSL 转换（只支持文件上传）
- ✅ POST /pipeline - 完整流程（只支持文件上传）

## 🚀 生产部署

```bash
# PM2
pm2 start packages/pipeline-server/ecosystem.config.js

# Docker
docker build -t unified-dsl .
docker run -p 3104:3104 unified-dsl
```
