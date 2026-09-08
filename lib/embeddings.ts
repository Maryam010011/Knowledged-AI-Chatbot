// Embeddings generator using @xenova/transformers (all-MiniLM-L6-v2)
// Runs inside Node.js server environment at zero external cost

let extractorPromise: Promise<any> | null = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      
      // In serverless/node environments, avoid trying to download to non-writable directories
      env.useBrowserCache = false;
      env.allowLocalModels = false;
      
      return await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    })();
  }
  return extractorPromise;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const cleanedText = text.replace(/\n+/g, ' ').trim();
  
  if (!cleanedText) {
    return new Array(384).fill(0);
  }

  const output = await extractor(cleanedText, {
    pooling: 'mean',
    normalize: true,
  });

  return Array.from(output.data);
}

export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const emb = await generateEmbedding(text);
    embeddings.push(emb);
  }
  return embeddings;
}
