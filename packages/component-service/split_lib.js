'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// WASM 单例（服务生命周期内只初始化一次）
// 编译自 pixso-parse/pix-split/split_compset_wasm.cpp，NODERAWFS=1 —— 直接通过
// Node.js fs 读写真实路径，无需把文件内容搬进 WASM 虚拟文件系统
// ---------------------------------------------------------------------------
let _wasmMod = null;

async function getWasm() {
  if (_wasmMod) return _wasmMod;

  const wasmJs = process.env.SPLIT_WASM_PATH
    || path.join(__dirname, 'bin/split_compset.js');

  if (!fs.existsSync(wasmJs)) {
    throw new Error(`WASM 文件不存在: ${wasmJs}\n请设置环境变量 SPLIT_WASM_PATH`);
  }

  const SplitCompset = require(wasmJs);
  _wasmMod = await SplitCompset();
  return _wasmMod;
}

// 把拆解输出目录打包为 zip（base64），zip 根目录直接是 component/，
// 解压后可直接整体放进 lib-out/{source}/ 下使用
function buildZip(outDir) {
  const zipPath = path.join(path.dirname(outDir), 'output.zip');
  const r = spawnSync('zip', ['-r', zipPath, '.'], { cwd: outDir });
  if (r.status !== 0) {
    throw new Error(`zip 打包失败: ${r.stderr?.toString().trim()}`);
  }
  return fs.readFileSync(zipPath);
}

// splitLibrary(pixBuffer, { originalName, publishFile, saveDir, source })
//   不传 saveDir → { stats: { total, componentSets, standaloneComponents, compDir, indexFile }, zip: base64 }
//   传了 saveDir → 跳过打包，直接把 component/ 目录写入 saveDir，
//                  返回 { stats: {...}, savedTo: '{source}/component' }
//   → { error: '...' }
async function splitLibrary(pixBuffer, opts = {}) {
  const mod = await getWasm();

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'split-compset-'));
  const pixPath = path.join(tmpRoot, opts.originalName || 'library.pix');
  const outDir  = path.join(tmpRoot, 'output');

  try {
    fs.writeFileSync(pixPath, pixBuffer);

    const raw    = mod.splitCompset(pixPath, outDir, opts.publishFile || '');
    const result = JSON.parse(raw);
    if (result.error) {
      // WASM 返回的错误信息里带的是临时文件的绝对路径，对调用方无意义且暴露服务器目录结构，
      // 替换成调用方上传时的原始文件名
      return { error: result.error.split(pixPath).join(opts.originalName || 'library.pix') };
    }

    // compDir / indexFile 是临时目录下的绝对路径，对调用方无意义，
    // 转成相对 outDir 的路径（解压 zip 后这些相对路径依然有效）
    const rel = p => (p ? path.relative(outDir, p) || '.' : p);
    result.compDir   = rel(result.compDir);
    result.indexFile = rel(result.indexFile);

    // 指定了 saveDir：直接把 component/ 整个目录写到 lib-out/{source}/，跳过 zip 打包，
    // 调用方无需再手动解压挪动文件
    if (opts.saveDir) {
      const destComponent = path.join(opts.saveDir, 'component');
      if (fs.existsSync(destComponent)) {
        return { error: `目标目录已存在，为避免覆盖已有数据请先手动清理后重试: ${opts.source}/component` };
      }
      fs.mkdirSync(opts.saveDir, { recursive: true });
      fs.cpSync(path.join(outDir, 'component'), destComponent, { recursive: true });
      return { stats: result, savedTo: `${opts.source}/component` };
    }

    const zipBuf = buildZip(outDir);
    return { stats: result, zip: zipBuf.toString('base64') };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

module.exports = { splitLibrary };
