export interface DocumentChunk {
  content: string;
  metadata: {
    chunkIndex: number;
    estimatedTokens: number;
    charLength: number;
    pageNumber?: number;
  };
}

// Approximate word count to token ratio (1 token ~ 0.75 words / 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).length * 1.33);
}

export function chunkText(
  text: string,
  targetTokenSize: number = 600,
  tokenOverlap: number = 75
): DocumentChunk[] {
  if (!text || !text.trim()) return [];

  // Split by double newlines or major section headers first
  const rawParagraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks: DocumentChunk[] = [];
  let currentChunkParagraphs: string[] = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const paragraph = rawParagraphs[i];
    const paraTokens = estimateTokens(paragraph);

    // If a single paragraph is enormous, break it into sentences
    if (paraTokens > targetTokenSize * 1.2) {
      const sentences = paragraph.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokenCount + sentenceTokens > targetTokenSize && currentChunkParagraphs.length > 0) {
          const chunkText = currentChunkParagraphs.join('\n\n');
          chunks.push({
            content: chunkText,
            metadata: {
              chunkIndex: chunkIndex++,
              estimatedTokens: estimateTokens(chunkText),
              charLength: chunkText.length,
            }
          });

          // Retain overlap from end of current chunk
          currentChunkParagraphs = keepOverlap(currentChunkParagraphs, tokenOverlap);
          currentTokenCount = estimateTokens(currentChunkParagraphs.join('\n\n'));
        }
        currentChunkParagraphs.push(sentence);
        currentTokenCount += sentenceTokens;
      }
      continue;
    }

    if (currentTokenCount + paraTokens > targetTokenSize && currentChunkParagraphs.length > 0) {
      const chunkText = currentChunkParagraphs.join('\n\n');
      chunks.push({
        content: chunkText,
        metadata: {
          chunkIndex: chunkIndex++,
          estimatedTokens: estimateTokens(chunkText),
          charLength: chunkText.length,
        }
      });

      // Overlap: keep last paragraph(s) up to overlap size
      currentChunkParagraphs = keepOverlap(currentChunkParagraphs, tokenOverlap);
      currentTokenCount = estimateTokens(currentChunkParagraphs.join('\n\n'));
    }

    currentChunkParagraphs.push(paragraph);
    currentTokenCount += paraTokens;
  }

  // Push remainder
  if (currentChunkParagraphs.length > 0) {
    const chunkText = currentChunkParagraphs.join('\n\n');
    chunks.push({
      content: chunkText,
      metadata: {
        chunkIndex: chunkIndex++,
        estimatedTokens: estimateTokens(chunkText),
        charLength: chunkText.length,
      }
    });
  }

  return chunks;
}

function keepOverlap(paragraphs: string[], targetOverlapTokens: number): string[] {
  const overlap: string[] = [];
  let tokens = 0;

  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const pTokens = estimateTokens(paragraphs[i]);
    if (tokens + pTokens <= targetOverlapTokens || overlap.length === 0) {
      overlap.unshift(paragraphs[i]);
      tokens += pTokens;
    } else {
      break;
    }
  }

  return overlap;
}
