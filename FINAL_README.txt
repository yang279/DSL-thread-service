统一 DSL Pipeline - 最终版本说明
====================================

更新时间: 2026-06-09 16:32

✅ 完成功能
----------

1. npm workspaces 统一管理 ✓
   - 4 个包清晰分离
   - 依赖一目了然

2. 接口统一改为文件上传 ✓
   - /pipeline - 文件上传
   - /enrich   - 文件上传
   - /convert  - 文件上传

3. 中间产物自动存储 ✓
   - output-artifacts 目录
   - request_id 唯一标识
   - API 查看产物

存储产物列表:
- input-node.json        原始输入
- icon-result.json       图标补全结果
- component-result.json  组件补全结果
- final-node.json        最终 node-dsl
- design-dsl.json        design-dsl
- output.hex             hex 文件
- output.zip             zip 包
- manifest.json          元数据

4. 产物查看 API ✓
   - GET /artifacts          查看列表
   - GET /artifacts/:id      查看详情
   - GET /artifacts/:id/:file 下载文件

目录结构
--------

unified-dsl-pipeline/
├── packages/
│   ├── icon-agent/          图标识别服务
│   ├── component-service/   组件匹配服务
│   ├── dsl-to-hex/          DSL 转 hex 服务
│   └── pipeline-server/     主服务
├── output-artifacts/        ✨ 产物存储（新增）
│   └── {request_id}/
│       ├── manifest.json
│       ├── input-node.json
│       ├── icon-result.json
│       ├── component-result.json
│       ├── final-node.json
│       ├── design-dsl.json
│       ├── output.hex
│       └── output.zip
├── README.md
├── QUICK_START.md
├── ARTIFACTS_STORAGE.md    ✨ 产物存储说明（新增）
├── UPDATE_NOTICE.md        接口变更说明
└── package.json

快速使用
--------

1. 启动服务
   npm start

2. 调用接口（文件上传）
   curl -X POST http://localhost:3104/pipeline \
     -F "file=@your-node.json" \
     -F "page_name=页面名称"

3. 响应（包含 request_id）
   {
     "success": true,
     "request_id": "2026-06-09T08-30-23-492Z-78y2qz",
     "artifacts_dir": "/path/to/output-artifacts",
     "hex": "...",
     "zip": "..."
   }

4. 查看产物
   curl http://localhost:3104/artifacts
   curl http://localhost:3104/artifacts/{request_id}
   curl http://localhost:3104/artifacts/{request_id}/design-dsl.json

5. 导入 Pixso
   cd output-artifacts/{request_id}
   mv output.hex output.txt
   # 在 Pixso 中导入

验证结果
--------

✅ 测试通过
   - pipeline 接口正常
   - 产物自动保存
   - API 查看正常
   - 文件下载正常

✅ 产物完整
   - 所有中间步骤都有保存
   - manifest.json 记录元数据
   - request_id 唯一标识

✅ 接口统一
   - 所有接口改为文件上传
   - 简单清晰
   - 不再有格式混淆

优势总结
--------

1. 日志式存储
   每次处理都保存完整记录，便于追溯

2. 问题排查
   查看中间产物，快速定位问题

3. 数据分析
   所有 design-dsl 可用于批量分析

4. 重新处理
   从任意中间步骤重新开始

5. API 管理
   通过接口查看、下载所有产物

建议使用
--------

生产环境：
- 定期清理旧产物（保留最近 N 条）
- 监控 output-artifacts 目录大小
- 使用产物 API 进行数据统计

开发调试：
- 查看中间产物分析问题
- 从失败步骤重新开始
- 验证每个步骤的输出

部署就绪
--------

✅ 完全可用
   - 功能全部实现
   - 测试全部通过
   - 文档完整齐全

✅ 生产就绪
   - PM2 配置
   - Docker 配置
   - 产物存储

推荐使用方式：文件上传 + 自动产物存储

