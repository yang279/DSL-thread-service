#!/bin/bash

set -e

echo "=== node-dsl-pipeline HTTP 服务部署脚本 ==="

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$BASE_DIR")"

echo "基础目录: $BASE_DIR"
echo "父目录: $PARENT_DIR"

cd "$BASE_DIR"

echo ""
echo "1. 安装依赖..."
npm install --production

echo ""
echo "2. 检查 worker 文件..."
for worker in \
  "$PARENT_DIR/wonderfulj-main/src/worker.js" \
  "$PARENT_DIR/nodejs/component-service/worker.js" \
  "$PARENT_DIR/nodejs/dsl-to-hex/worker.js"
do
  if [ -f "$worker" ]; then
    echo "✓ $worker"
  else
    echo "✗ $worker 不存在！"
    exit 1
  fi
done

echo ""
echo "3. 检查 WASM 文件..."
for wasm in \
  "$PARENT_DIR/nodejs/dsl-to-hex/bin/dsl_to_hex.wasm" \
  "$PARENT_DIR/nodejs/component-service/bin/split_compset.wasm"
do
  if [ -f "$wasm" ]; then
    echo "✓ $wasm"
  else
    echo "⚠ $wasm 不存在（部分功能可能受限）"
  fi
done

echo ""
echo "4. 检查数据文件..."
ICON_JSON="$PARENT_DIR/wonderfulj-main/iconJson/icons.json"
ICON_INDEX="$PARENT_DIR/wonderfulj-main/iconJson/index.bin"
SEARCH_INDEX="$PARENT_DIR/nodejs/component-service/search_index.json"

if [ -f "$ICON_JSON" ]; then
  echo "✓ icons.json ($(wc -l < "$ICON_JSON") 条)"
else
  echo "⚠ icons.json 不存在（图标解析功能将无法使用）"
fi

if [ -f "$ICON_INDEX" ]; then
  echo "✓ index.bin ($(du -h "$ICON_INDEX" | cut -f1))"
else
  echo "⚠ index.bin 不存在（图标解析功能将无法使用）"
fi

if [ -f "$SEARCH_INDEX" ]; then
  echo "✓ search_index.json ($(wc -l < "$SEARCH_INDEX") 条)"
else
  echo "⚠ search_index.json 不存在（组件匹配功能将无法使用）"
fi

echo ""
echo "=== 部署检查完成 ==="
echo ""
echo "启动服务:"
echo "  PORT=3104 npm run server"
echo ""
echo "或使用 PM2:"
echo "  pm2 start server.js --name node-dsl-pipeline"
echo ""