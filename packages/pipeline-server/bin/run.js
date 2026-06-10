#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const { ServiceClient } = require('../lib/client');
const { enrich }         = require('../lib/enrich');
const { buildDesignDsl, countLayers } = require('../lib/design-dsl');
const { exportHex }      = require('../lib/export-hex');

function parseArgs(argv) {
  const a = {
    input: null,
    pageName: null,
    outDir: null,
    mode: 'http',
    skipEnrich: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if      (arg === '--page-name')   a.pageName     = rest[++i];
    else if (arg === '--out-dir')     a.outDir       = rest[++i];
    else if (arg === '--mode')        a.mode         = rest[++i];
    else if (arg === '--skip-enrich') a.skipEnrich   = true;
    else if (!a.input)                a.input        = arg;
  }

  if (a.mode !== 'ipc' && a.mode !== 'http') {
    console.error(`无效的 --mode 参数: ${a.mode}，必须是 ipc 或 http`);
    process.exit(1);
  }

  return a;
}

function usage() {
  console.error([
    'Usage: node bin/run.js <input.json> [options]',
    '',
    '  --page-name <name>          design-dsl 页面名称（默认取输入文件名）',
    '  --out-dir <dir>             产物目录（默认 <输入文件同目录>/<输入文件名>-pipeline）',
    '  --mode <ipc|http>           运行模式（默认 http）',
    '                               - ipc: 通过子进程 IPC 通信（无需启动独立服务）',
    '                               - http: 通过 HTTP 请求通信（需手动启动三个服务）',
    '  --skip-enrich               跳过 Step3/C，输入须已含 iconSvg/component',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) { usage(); process.exit(1); }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`输入文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const pageName = args.pageName || baseName;
  const outDir   = path.resolve(args.outDir || path.join(path.dirname(inputPath), `${baseName}-pipeline`));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`产物目录: ${outDir}`);
  console.log(`运行模式: ${args.mode}`);

  const client = new ServiceClient(args.mode, path.resolve(__dirname, '..'));

  if (args.mode === 'ipc') {
    try {
      await client.init();
    } catch (err) {
      console.error(`✗ IPC 服务启动失败: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    let finalSchema;
    if (args.skipEnrich) {
      console.log('— 跳过 Step3/C（--skip-enrich），直接使用输入文件 —');
      finalSchema = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      fs.writeFileSync(path.join(outDir, 'final.json'), JSON.stringify(finalSchema, null, 2), 'utf8');
    } else {
      console.log('— Step3/C: 并行调用 iconAgent + Component Match，合并节点信息 —');
      try {
        finalSchema = await enrich(inputPath, outDir, client);
      } catch (e) {
        console.warn(`⚠ Step3/C 异常，回退为直接复制原始 schema: ${e.message}`);
        finalSchema = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        fs.writeFileSync(path.join(outDir, 'final.json'), JSON.stringify(finalSchema, null, 2), 'utf8');
      }
    }

    console.log('— Step4/D①: node-dsl → design-dsl —');
    const dsl = buildDesignDsl(finalSchema, pageName);
    const designDslPath = path.join(outDir, 'design-dsl.json');
    fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');
    const stats = countLayers(dsl.pages[0].layers);
    console.log(`图层总数 ${stats.total} | frame ${stats.frames} (placeholder ${stats.placeholders}) | text ${stats.texts} | instance ${stats.instances}`);
    console.log(`已写出 ${designDslPath}`);

    console.log('— Step4/D②: 调用 dsl-to-hex 生成 hex —');
    const { hexPath, missingKeys } = await exportHex(dsl, outDir, client);

    console.log('');
    console.log(`✓ 完成: ${hexPath}`);
    if (missingKeys.length) console.log(`  missing_keys: ${missingKeys.length} 个（zip 仍有效，对应组件在 Pixso 中缺失）`);
  } catch (err) {
    console.error(`✗ ${err.message || err.code || String(err)}`);
    process.exit(1);
  } finally {
    if (args.mode === 'ipc') {
      client.stop();
    }
  }
}

main();