#!/bin/bash

set -e

echo "=== Unified DSL Pipeline 快速测试 ==="

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$BASE_DIR"

echo ""
echo "1. 检查包结构..."
ls -d packages/*/ 2>/dev/null || echo "  packages 目录不存在"

echo ""
echo "2. 检查依赖..."
npm ls --depth=0 || true

echo ""
echo "3. 检查关键文件..."

# Icon Agent
echo "  [icon-agent]"
test -f packages/icon-agent/src/core.js && echo "    ✓ src/core.js" || echo "    ✗ src/core.js 缺失"
test -f packages/icon-agent/iconJson/icons.json && echo "    ✓ iconJson/icons.json" || echo "    ✗ iconJson/icons.json 缺失"
test -f packages/icon-agent/iconJson/index.bin && echo "    ✓ iconJson/index.bin" || echo "    ✗ iconJson/index.bin 缺失"

# Component Service
echo "  [component-service]"
test -f packages/component-service/core.js && echo "    ✓ core.js" || echo "    ✗ core.js 缺失"
test -f packages/component-service/search_index.json && echo "    ✓ search_index.json" || echo "    ✗ search_index.json 缺失"
test -f packages/component-service/bin/split_compset.wasm && echo "    ✓ bin/split_compset.wasm" || echo "    ⚠ bin/split_compset.wasm 缺失"

# DSL to Hex
echo "  [dsl-to-hex]"
test -f packages/dsl-to-hex/converter.js && echo "    ✓ converter.js" || echo "    ✗ converter.js 缺失"
test -f packages/dsl-to-hex/bin/dsl_to_hex.wasm && echo "    ✓ bin/dsl_to_hex.wasm" || echo "    ✗ bin/dsl_to_hex.wasm 缺失"

# Pipeline Server
echo "  [pipeline-server]"
test -f packages/pipeline-server/server.js && echo "    ✓ server.js" || echo "    ✗ server.js 缺失"
test -f packages/pipeline-server/lib/ipc-manager.js && echo "    ✓ lib/ipc-manager.js" || echo "    ✗ lib/ipc-manager.js 缺失"

echo ""
echo "4. 检查环境变量..."
test -f .env && echo "  ✓ .env 文件存在" || echo "  ⚠ .env 文件不存在，请从 .env.example 复制"

echo ""
echo "=== 测试完成 ==="
echo ""
echo "启动服务: npm start"
echo "健康检查: npm run health"