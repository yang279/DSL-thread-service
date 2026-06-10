# 中间产物存储功能

## 功能说明

每次调用 `/pipeline` 接口时，系统会自动保存所有中间产物到 `output-artifacts` 目录，便于追踪和调试。

## 存储位置

```
unified-dsl-pipeline/output-artifacts/
├── 2026-06-09T08-30-23-492Z-78y2qz/  ← 以 request_id 唯一标识
│   ├── manifest.json              ← 元数据（时间戳、文件列表）
│   ├── input-node.json            ← 原始输入的 node-dsl
│   ├── icon-result.json           ← iconAgent 的补全结果
│   ├── component-result.json      ← component-service 的补全结果
│   ├── final-node.json            ← 补全后的最终 node-dsl
│   ├── design-dsl.json            ← 转换后的 design-dsl
│   ├── output.hex                 ← 最终的 hex 文件
│   └── output.zip                 ← zip 包（包含 hex + placeholder）
```

## Request ID 格式

每个请求会生成唯一的 request_id：

```
2026-06-09T08-30-23-492Z-78y2qz
│                    │  │
│                    │  └─ 随机字符串（防重复）
│                    └──── 时间戳（ISO 格式）
└──────────────────────── 日期
```

## 查看产物的 API

### 1. 查看产物列表

```bash
GET /artifacts

curl http://localhost:3104/artifacts
```

**响应：**
```json
{
  "artifacts_dir": "/path/to/output-artifacts",
  "total": 2,
  "artifacts": [
    {
      "request_id": "2026-06-09T08-30-23-492Z-78y2qz",
      "created_at": "2026-06-09T08:30:23.839Z",
      "files": ["design-dsl.json", "output.hex", ...]
    }
  ]
}
```

---

### 2. 查看具体产物详情

```bash
GET /artifacts/:requestId

curl http://localhost:3104/artifacts/2026-06-09T08-30-23-492Z-78y2qz
```

**响应：**
```json
{
  "request_id": "2026-06-09T08-30-23-492Z-78y2qz",
  "artifacts_dir": "/path/to/output-artifacts/...",
  "manifest": {
    "created_at": "2026-06-09T08:30:23.839Z",
    "artifacts": {...}
  },
  "files": ["design-dsl.json", "output.hex", ...]
}
```

---

### 3. 下载产物文件

```bash
GET /artifacts/:requestId/:filename

# 下载 JSON 文件
curl http://localhost:3104/artifacts/2026-06-09T08-30-23-492Z-78y2qz/design-dsl.json

# 下载 hex 文件
curl http://localhost:3104/artifacts/2026-06-09T08-30-23-492Z-78y2qz/output.hex

# 下载 zip 包
curl http://localhost:3104/artifacts/2026-06-09T08-30-23-492Z-78y2qz/output.zip --output artifacts.zip
```

---

## 文件说明

| 文件 | 说明 | 格式 |
|------|------|------|
| `manifest.json` | 元数据清单 | JSON |
| `input-node.json` | 原始输入的 node-dsl | JSON |
| `icon-result.json` | iconAgent 补全结果 | JSON |
| `component-result.json` | component-service 补全结果 | JSON |
| `final-node.json` | 补全后的最终 node-dsl | JSON |
| `design-dsl.json` | 转换后的 design-dsl（符合设计dsl.md规范）| JSON |
| `output.hex` | 最终的 Pixso hex 文件 | Binary |
| `output.zip` | zip 包（hex + placeholder 资源）| Binary |

---

## 使用场景

### 1. 调试和追溯

当处理失败时，可以查看中间产物：

```bash
# 查看最近的处理
curl http://localhost:3104/artifacts | jq '.artifacts[0]'

# 查看 icon 补全结果
curl http://localhost:3104/artifacts/{request_id}/icon-result.json

# 查看最终 design-dsl
curl http://localhost:3104/artifacts/{request_id}/design-dsl.json
```

---

### 2. 批量处理历史

查看所有历史处理记录：

```bash
curl http://localhost:3104/artifacts | jq '.total'
# 返回：已处理的请求总数
```

---

### 3. 数据分析

提取所有 design-dsl 用于分析：

```bash
# 列出所有 design-dsl 文件
ls unified-dsl-pipeline/output-artifacts/*/design-dsl.json
```

---

### 4. 重新处理

如果某个步骤失败，可以从中间产物重新开始：

```bash
# 1. 获取 final-node.json
curl http://localhost:3104/artifacts/{request_id}/final-node.json > final.json

# 2. 直接调用 convert 接口（跳过补全）
curl -X POST http://localhost:3104/convert \
  -F "file=@final.json"
```

---

## 实际测试结果

**测试时间：2026-06-09 16:30**

✅ 成功保存所有中间产物：
- `manifest.json` - 元数据 ✓
- `input-node.json` - 输入 ✓
- `icon-result.json` - icon 结果 ✓
- `component-result.json` - component 结果 ✓
- `final-node.json` - 最终 node-dsl ✓
- `design-dsl.json` - design-dsl ✓
- `output.hex` - hex 文件 ✓
- `output.zip` - zip 包 ✓

✅ API 接口正常：
- GET `/artifacts` - 查看列表 ✓
- GET `/artifacts/:id` - 查看详情 ✓
- GET `/artifacts/:id/:file` - 下载文件 ✓

---

## 存储空间管理

产物会持续累积，建议定期清理旧数据：

```bash
# 查看总大小
du -sh unified-dsl-pipeline/output-artifacts/

# 删除 7 天前的产物（示例）
find unified-dsl-pipeline/output-artifacts/ -type d -mtime +7 -exec rm -rf {} +

# 或保留最近 100 条
cd unified-dsl-pipeline/output-artifacts
ls -t | tail -n +101 | xargs rm -rf
```

---

## 总结

✅ **功能已完全实现**

每次 `/pipeline` 请求都会自动保存：
1. 原始输入
2. 图标补全结果
3. 组件补全结果
4. 最终 node-dsl
5. design-dsl
6. hex 文件
7. zip 包

所有产物可通过 API 查看、下载、分析。便于：
- ✅ 问题追溯
- ✅ 数据分析
- ✅ 重新处理
- ✅ 批量管理