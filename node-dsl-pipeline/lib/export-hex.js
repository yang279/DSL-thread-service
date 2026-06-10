'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function exportHex(dsl, outDir, client) {
  const urlDesc = client.mode === 'ipc' ? 'IPC' : (process.env.HEX_SERVICE_URL || 'http://localhost:3101');
  console.log(`调用 dsl-to-hex (${urlDesc}) (file: ${dsl.meta?.file_name || 'design-dsl'})`);

  const result = await client.callDslToHexConvert(dsl);

  if (!result.zip) {
    const designDslPath = `${outDir}/design-dsl.json`;
    fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');
    throw new Error(`dsl2hex 转换失败：${result.error || JSON.stringify(result)}（design-dsl 已保留于 ${designDslPath}）`);
  }

  const zipPath = path.join(outDir, 'output.zip');
  const zipBuf  = Buffer.from(result.zip, 'base64');
  fs.writeFileSync(zipPath, zipBuf);
  console.log(`已写出 ${zipPath} (${zipBuf.length} 字节)`);

  execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'pipe' });
  const hexPath = path.join(outDir, 'output.hex');
  console.log(`✓ 已解压 → ${hexPath}`);

  const missingKeys = result.missing_keys || [];
  if (missingKeys.length) {
    console.warn(`⚠ 缺失组件 ${missingKeys.length} 个: ${missingKeys.slice(0, 3).join(', ')}${missingKeys.length > 3 ? '...' : ''}`);
  } else {
    console.log('✓ 所有组件均已解析');
  }

  return { zipPath, hexPath, missingKeys };
}

module.exports = { exportHex };