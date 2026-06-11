'use strict';

const fs   = require('fs');
const path = require('path');

async function exportHex(dsl, outDir, client) {
  console.log(`调用 dsl-to-hex (file: ${dsl.meta?.file_name || 'design-dsl'})`);

  const designDslPath = path.join(outDir, 'design-dsl.json');
  fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');

  const result = await client.callDslToHexConvert(dsl);

  if (!result.zip) {
    throw new Error(`dsl2hex 转换失败：${result.error || JSON.stringify(result)}（design-dsl 已保留于 ${designDslPath}）`);
  }

  const zipPath = path.join(outDir, 'output.zip');
  const zipBuf  = Buffer.from(result.zip, 'base64');
  fs.writeFileSync(zipPath, zipBuf);
  console.log(`✓ 已写出 ${zipPath} (${zipBuf.length} 字节)`);

  const missingKeys = result.missing_keys || [];
  if (missingKeys.length) {
    console.warn(`⚠ 缺失组件 ${missingKeys.length} 个: ${missingKeys.slice(0, 3).join(', ')}${missingKeys.length > 3 ? '...' : ''}`);
  } else {
    console.log('✓ 所有组件均已解析');
  }

  return { zipPath, missingKeys };
}

module.exports = { exportHex };