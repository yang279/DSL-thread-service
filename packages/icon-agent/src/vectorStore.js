const fs = require('fs');
const hnswlib = require('hnswlib-node');

class VectorStore {
  constructor(indexPath) {
    this.indexPath = indexPath;
    this.metaPath = indexPath.replace('.bin', '.meta.json');
    this.index = null;
    this.metadata = [];
  }

  build(dim, maxElements, M = 16, efConstruction = 200) {
    this.index = new hnswlib.HierarchicalNSW('cosine', dim);
    this.index.initIndex(maxElements, M, efConstruction);
    this.metadata = [];
    return this;
  }

  addItem(id, embedding, meta) {
    const label = this.metadata.length;
    this.index.addPoint(embedding, label);
    this.metadata.push({ label, id, ...meta });
    return this;
  }

  load() {
    if (!fs.existsSync(this.indexPath) || !fs.existsSync(this.metaPath)) {
      throw new Error(`索引文件不存在: ${this.indexPath}\n请先运行 npm run build-index`);
    }
    const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
    const dim = meta.dim;
    this.metadata = meta.items;
    this.index = new hnswlib.HierarchicalNSW('cosine', dim);
    this.index.readIndexSync(this.indexPath);
    return this;
  }

  save(dim) {
    this.index.writeIndexSync(this.indexPath);
    fs.writeFileSync(this.metaPath, JSON.stringify({ dim, items: this.metadata }));
    return this;
  }

  search(queryEmbedding, topK = 5) {
    const result = this.index.searchKnn(queryEmbedding, topK);
    return result.neighbors.map((label, i) => {
      const meta = this.metadata[label];
      return {
        id: meta?.id,
        name: meta?.name,
        description: meta?.description,
        score: 1 - result.distances[i],
      };
    }).filter(r => r.id !== undefined);
  }
}

module.exports = VectorStore;