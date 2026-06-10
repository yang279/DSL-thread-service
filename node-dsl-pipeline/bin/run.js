#!/usr/bin/env node
'use strict';
require('../lib/load-env');

const fs   = require('fs');
const path = require('path');

const { ServiceClient }               = require('../lib/client');
const { enrich }                      = require('../lib/enrich');
const { buildDesignDsl, countLayers } = require('../lib/design-dsl');
const { exportHex }                   = require('../lib/export-hex');

function parseArgs(argv) {
  const a = { input: null, pageName: null, outDir: null, skipEnrich: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if      (arg === '--page-name')   a.pageName   = rest[++i];
    else if (arg === '--out-dir')     a.outDir     = rest[++i];
    else if (arg === '--skip-enrich') a.skipEnrich = true;
    else if (!a.input)                a.input      = arg;
  }
  return a;
}

function usage() {
  console.error([
    'Usage: node bin/run.js <input.json> [options]',
    '',
    '  --page-name <name>   design-dsl 页面名称（默认取输入文件名）',
    '  --out-dir <dir>      产物目录（默认 <输入文件同目录>/<输入文件名>-pipeline）',
    '  --skip-enrich        跳过节点补全，输入须已含 iconSvg/component',
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

  const client = new ServiceClient(path.resolve(__dirname, '..'));

  try {
    await client.init();
  } catch (err) {
    console.error(`✗ 子进程启动失败: ${err.message}`);
    process.exit(1);
  }

  try {
    let finalSchema;
    if (args.skipEnrich) {
      console.log('— 跳过补全（--skip-enrich）—');
      finalSchema = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      fs.writeFileSync(path.join(outDir, 'final.json'), JSON.stringify(finalSchema, null, 2), 'utf8');
    } else {
      console.log('— Step1: 并行调用 iconAgent + componentService —');
      try {
        finalSchema = await enrich(inputPath, outDir, client);
      } catch (e) {
        console.warn(`⚠ 补全异常，回退为原始 schema: ${e.message}`);
        finalSchema = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
        fs.writeFileSync(path.join(outDir, 'final.json'), JSON.stringify(finalSchema, null, 2), 'utf8');
      }
    }

    console.log('— Step2: node-dsl → design-dsl —');
    const dsl = buildDesignDsl(finalSchema, pageName);
    const designDslPath = path.join(outDir, 'design-dsl.json');
    fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');
    const stats = countLayers(dsl.pages[0].layers);
    console.log(`图层总数 ${stats.total} | frame ${stats.frames} | text ${stats.texts} | instance ${stats.instances}`);

    console.log('— Step3: design-dsl → hex —');
    const { hexPath, missingKeys } = await exportHex(dsl, outDir, client);

    console.log('');
    console.log(`✓ 完成: ${hexPath}`);
    if (missingKeys.length) console.log(`  missing_keys: ${missingKeys.length} 个`);
  } catch (err) {
    console.error(`✗ ${err.message || String(err)}`);
    process.exit(1);
  } finally {
    client.stop();
  }
}

main();
