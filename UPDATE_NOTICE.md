# 接口更新说明

## 变更时间
2026-06-09 16:05

## 变更内容

### 接口统一改为文件上传方式

**变更前：**
- 支持文件上传：`-F "file=@xxx.json"`
- 支持 JSON body：`{"data": {...}}` 或 `{"dsl": {...}}`

**变更后：**
- 只支持文件上传：`-F "file=@xxx.json"`
- 移除 JSON body 支持

## 受影响的接口

| 接口 | 变更说明 |
|------|---------|
| POST /pipeline | 只支持文件上传，移除 JSON body (`data` 字段) |
| POST /enrich | 只支持文件上传，移除 JSON body (`data` 字段) |
| POST /convert | 保持不变（原本就主要用文件上传） |

## 变更原因

1. **简化接口调用** - 统一方式，避免格式混淆
2. **减少错误** - JSON body 格式容易出错
3. **更符合实际使用** - 实际使用都是文件上传

## 迁移指南

### 如果你之前使用 JSON body：

**pipeline 接口（之前）：**
```bash
curl -X POST http://localhost:3104/pipeline \
  -H "Content-Type: application/json" \
  -d '{"data": {"meta": {...}, "pages": [...]}}'
```

**pipeline 接口（现在）：**
```bash
# 先把数据保存为文件
cat > input.json <<'JSON'
{"meta": {...}, "pages": [...]}
JSON

# 然后上传文件
curl -X POST http://localhost:3104/pipeline \
  -F "file=@input.json" \
  -F "page_name=页面名称"
```

### enrich 接口同理

**enrich 接口（之前）：**
```bash
curl -X POST http://localhost:3104/enrich \
  -H "Content-Type: application/json" \
  -d '{"data": {...}}'
```

**enrich 接口（现在）：**
```bash
curl -X POST http://localhost:3104/enrich \
  -F "file=@input.json"
```

## 错误响应

如果使用 JSON body，现在会返回：

```json
{
  "error": "请上传 JSON 文件（使用 -F \"file=@input.json\"）"
}
```

## 验证结果

✅ 文件上传方式已验证成功：
```bash
curl -X POST http://localhost:3104/pipeline -F "file=@profile-node.json"
→ {"success": true, "hex_length": 3839}
```

✅ JSON body 方式正确返回错误：
```bash
curl -X POST http://localhost:3104/pipeline -d '{"data": {...}}'
→ {"error": "请上传 JSON 文件（使用 -F \"file=@input.json\"）"}
```

## 优势

1. **统一简单** - 所有接口调用方式一致
2. **不易出错** - 避免字段名混淆（data vs dsl）
3. **更直观** - 直接上传文件，符合直觉
4. **兼容性好** - 文件上传在各种环境下都稳定

## 建议

如果你有现成的 JSON 数据，建议：
1. 保存为临时文件
2. 上传文件调用接口

示例代码（Node.js）：
```javascript
const fs = require('fs');
const data = {"meta": {...}, "pages": [...]};
fs.writeFileSync('temp.json', JSON.stringify(data));
// 然后用 curl 或 HTTP 客户端上传 temp.json
```

## 需要帮助？

如果你在迁移过程中遇到问题，请：
1. 检查文件是否是有效的 JSON
2. 确认使用 `-F "file=@文件路径"` 格式
3. 查看服务日志：`tail -f unified-dsl-pipeline/server.log`
