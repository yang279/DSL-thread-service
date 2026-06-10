require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pipeline, env } = require('@huggingface/transformers');
const VectorStore = require('./vectorStore');

if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
  console.log(`使用镜像源: ${env.remoteHost}`);
}

const ICONS_PATH = path.resolve(__dirname, '../iconJson/icons.json');
const INDEX_PATH = path.resolve(__dirname, '../iconJson/index.bin');
const MODEL = 'Xenova/bge-large-zh-v1.5';
const EMBED_DIM = 1024;

async function buildIndex() {
  console.log('加载嵌入模型（首次运行会自动下载，模型约 1.3GB）...');
  const embedder = await pipeline('feature-extraction', MODEL);

  console.log('读取图标数据...');
  const icons = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf-8'));
  console.log(`共 ${icons.length} 个图标，开始生成向量...`);

  const texts = icons.map(i => `${i.name}: ${i.description}`);
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i++) {
    console.log(`处理第 ${i + 1}/${texts.length} 条: ${icons[i].id}`);
    const output = await embedder(texts[i], { pooling: 'mean', normalize: true });
    allEmbeddings.push(Array.from(output.data));
  }

  const maxElements = Math.max(icons.length * 2, 100000);
  console.log(`构建 HNSW 索引（最大容量: ${maxElements}）...`);
  const store = new VectorStore(INDEX_PATH);
  store.build(EMBED_DIM, maxElements);

  for (let i = 0; i < icons.length; i++) {
    store.addItem(icons[i].id, allEmbeddings[i], {
      name: icons[i].name,
      description: icons[i].description,
    });
  }

  store.save(EMBED_DIM);
  console.log(`索引已保存至 ${INDEX_PATH}`);
  console.log('构建完成！');
}

buildIndex().catch(err => {
  console.error('构建索引失败:', err);
  process.exit(1);
});