'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { postJson } = require('./http-client');

const ARTIFACTS_DIR = path.resolve(__dirname, '../../../../output-artifacts');

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function generateRequestId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

function saveArtifacts(tmpDir, requestId, artifacts) {
  const artifactDir = path.join(ARTIFACTS_DIR, requestId);
  fs.mkdirSync(artifactDir, { recursive: true });
  
  for (const [tmpFile, targetName] of Object.entries(artifacts)) {
    const srcPath = path.join(tmpDir, tmpFile);
    if (fs.existsSync(srcPath)) {
      const destPath = path.join(artifactDir, targetName);
      fs.copyFileSync(srcPath, destPath);
      console.log(`[artifacts] 已保存: ${targetName} → ${destPath}`);
    }
  }
  
  const manifestPath = path.join(artifactDir, 'manifest.json');
  const manifest = {
    request_id: requestId,
    created_at: new Date().toISOString(),
    artifacts: artifacts
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  
  return artifactDir;
}

async function exportHex(dsl, tmpDir, client, requestId) {
  const urlDesc = client.mode === 'ipc' ? 'IPC' : (process.env.HEX_SERVICE_URL || 'http://localhost:3101');
  console.log(`调用 dsl-to-hex (${urlDesc}) (file: ${dsl.meta?.file_name || 'design-dsl'})`);

  const result = await client.callDslToHexConvert(dsl);

  if (!result.zip) {
    const designDslPath = `${tmpDir}/design-dsl.json`;
    fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');
    
    if (requestId) {
      saveArtifacts(tmpDir, requestId, {
        'design-dsl.json': 'design-dsl.json',
        'input.json': 'input-node.json'
      });
    }
    
    throw new Error(`dsl2hex 转换失败：${result.error || JSON.stringify(result)}（design-dsl 已保留于 ${designDslPath}）`);
  }

  const zipPath = path.join(tmpDir, 'output.zip');
  const zipBuf  = Buffer.from(result.zip, 'base64');
  fs.writeFileSync(zipPath, zipBuf);
  console.log(`已写出 ${zipPath} (${zipBuf.length} 字节)`);

  execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });
  const hexPath = path.join(tmpDir, 'output.hex');
  console.log(`✓ 已解压 → ${hexPath}`);

  const missingKeys = result.missing_keys || [];
  if (missingKeys.length) {
    console.warn(`⚠ 缺失组件 ${missingKeys.length} 个: ${missingKeys.slice(0, 3).join(', ')}${missingKeys.length > 3 ? '...' : ''}`);
  } else {
    console.log('✓ 所有组件均已解析');
  }

  const designDslPath = path.join(tmpDir, 'design-dsl.json');
  fs.writeFileSync(designDslPath, JSON.stringify(dsl, null, 2), 'utf8');
  
  if (requestId) {
    const artifacts = {
      'design-dsl.json': 'design-dsl.json',
      'input.json': 'input-node.json',
      'raw-icons.json': 'icon-result.json',
      'raw-components.json': 'component-result.json',
      'final.json': 'final-node.json',
      'output.hex': 'output.hex',
      'output.zip': 'output.zip'
    };
    
    const artifactDir = saveArtifacts(tmpDir, requestId, artifacts);
    console.log(`[artifacts] 产物已保存到: ${artifactDir}`);
  }

  return { zipPath, hexPath, missingKeys };
}

module.exports = { exportHex, generateRequestId, ARTIFACTS_DIR };