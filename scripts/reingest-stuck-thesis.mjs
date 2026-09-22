import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import pdfParse from 'pdf-parse';

env.useBrowserCache = false;
env.allowLocalModels = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const envFile = path.join(rootDir, '.env.local');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function estimateTokens(text) {
  return Math.ceil(text.trim().split(/\s+/).length * 1.33);
}

function chunkText(text, targetTokenSize = 220, tokenOverlap = 40) {
  if (!text || !text.trim()) return [];
  const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks = [];
  let currentChunkParagraphs = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  function keepOverlap(paragraphs, targetOverlapTokens) {
    const overlap = [];
    let tokens = 0;
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const pTokens = estimateTokens(paragraphs[i]);
      if (tokens + pTokens <= targetOverlapTokens || overlap.length === 0) {
        overlap.unshift(paragraphs[i]);
        tokens += pTokens;
      } else break;
    }
    return overlap;
  }

  for (let i = 0; i < rawParagraphs.length; i++) {
    const paragraph = rawParagraphs[i];
    const paraTokens = estimateTokens(paragraph);
    if (paraTokens > targetTokenSize * 1.2) {
      const sentences = paragraph.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokenCount + sentenceTokens > targetTokenSize && currentChunkParagraphs.length > 0) {
          const chunkStr = currentChunkParagraphs.join('\n\n');
          chunks.push({ content: chunkStr, metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) } });
          currentChunkParagraphs = keepOverlap(currentChunkParagraphs, tokenOverlap);
          currentTokenCount = estimateTokens(currentChunkParagraphs.join('\n\n'));
        }
        currentChunkParagraphs.push(sentence);
        currentTokenCount += sentenceTokens;
      }
      continue;
    }
    if (currentTokenCount + paraTokens > targetTokenSize && currentChunkParagraphs.length > 0) {
      const chunkStr = currentChunkParagraphs.join('\n\n');
      chunks.push({ content: chunkStr, metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) } });
      currentChunkParagraphs = keepOverlap(currentChunkParagraphs, tokenOverlap);
      currentTokenCount = estimateTokens(currentChunkParagraphs.join('\n\n'));
    }
    currentChunkParagraphs.push(paragraph);
    currentTokenCount += paraTokens;
  }
  if (currentChunkParagraphs.length > 0) {
    const chunkStr = currentChunkParagraphs.join('\n\n');
    chunks.push({ content: chunkStr, metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) } });
  }
  return chunks;
}

async function reingestStuckDocument(docId) {
  console.log(`\n🏏 =================================================`);
  console.log(`Starting Batch Ingestion for Stuck Document: ${docId}`);
  console.log(`=================================================\n`);

  // 1. Fetch document record
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single();

  if (docErr || !doc) {
    console.error('❌ Document not found:', docErr);
    process.exit(1);
  }

  console.log(`Document: "${doc.title}" (Org: ${doc.organization_id})`);
  console.log(`Initial Status: ${doc.status}`);

  // 2. Clear any existing chunks
  console.log('🧹 Clearing any stale chunks in document_chunks...');
  await supabase.from('document_chunks').delete().eq('document_id', docId);

  // 3. Mark status to processing
  await supabase.from('documents').update({ status: 'processing' }).eq('id', docId);

  // 4. Download PDF
  console.log(`📥 Downloading PDF from storage: ${doc.storage_path}...`);
  let pdfBuffer = null;
  const { data: dlData, error: dlErr } = await supabase.storage.from('coach-documents').download(doc.storage_path);
  if (dlData && !dlErr) {
    pdfBuffer = Buffer.from(await dlData.arrayBuffer());
    console.log(`✅ Downloaded ${pdfBuffer.length} bytes from Supabase Storage.`);
  } else {
    console.log('⚠️ Storage download failed, checking local data/ directory fallback...');
    const localPath = path.join(rootDir, 'data', doc.title);
    if (fs.existsSync(localPath)) {
      pdfBuffer = fs.readFileSync(localPath);
      console.log(`✅ Loaded ${pdfBuffer.length} bytes from local data/ directory.`);
    } else {
      console.error('❌ Could not find PDF buffer:', dlErr);
      process.exit(1);
    }
  }

  // 5. Parse and chunk
  console.log('📄 Parsing PDF and extracting text...');
  const parsed = await pdfParse(pdfBuffer);
  console.log(`✅ Extracted ${parsed.numpages} pages (${parsed.text.length} characters).`);

  console.log('✂️ Generating semantic chunks (220 tokens, 40 overlap)...');
  const chunks = chunkText(parsed.text, 220, 40);
  console.log(`✅ Generated ${chunks.length} chunks.`);

  // 6. Initialize local embedding extractor
  console.log('🤖 Loading Xenova/all-MiniLM-L6-v2 embedding model...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ Embedding pipeline initialized.');

  // 7. Process chunks in batches of 25 (identical to the serverless batching architecture)
  const batchSize = 25;
  const totalBatches = Math.ceil(chunks.length / batchSize);
  console.log(`\n🚀 Ingesting ${chunks.length} chunks across ${totalBatches} batches (${batchSize} chunks/batch)...\n`);

  for (let b = 0; b < chunks.length; b += batchSize) {
    const batchIndex = Math.floor(b / batchSize) + 1;
    const slice = chunks.slice(b, b + batchSize);
    const chunkRows = [];

    const startMs = Date.now();
    for (let s = 0; s < slice.length; s++) {
      const chunk = slice[s];
      const output = await extractor(chunk.content.replace(/\n+/g, ' ').trim(), {
        pooling: 'mean',
        normalize: true,
      });
      chunkRows.push({
        document_id: docId,
        organization_id: doc.organization_id,
        content: chunk.content,
        embedding: Array.from(output.data),
        metadata: {
          ...chunk.metadata,
          chunkIndex: b + s,
          title: doc.title,
          totalPages: parsed.numpages,
        }
      });
    }

    const { error: insertErr } = await supabase.from('document_chunks').insert(chunkRows);
    if (insertErr) {
      console.error(`❌ Batch ${batchIndex}/${totalBatches} insertion failed:`, insertErr.message);
      await supabase.from('documents').update({ status: 'failed' }).eq('id', docId);
      process.exit(1);
    }

    const elapsedMs = Date.now() - startMs;
    const pct = Math.round(((b + slice.length) / chunks.length) * 100);
    console.log(`  [Batch ${batchIndex}/${totalBatches}] Ingested ${b + slice.length}/${chunks.length} chunks (${pct}%) in ${elapsedMs}ms`);
  }

  // 8. Mark document as ready
  const { error: finalStatusErr } = await supabase
    .from('documents')
    .update({ status: 'ready' })
    .eq('id', docId);

  if (finalStatusErr) {
    console.error('❌ Failed to update document status to ready:', finalStatusErr.message);
    process.exit(1);
  }

  console.log(`\n🎉 SUCCESS: Document ${docId} successfully updated to status = 'ready'!`);

  // 9. Verification queries
  const { data: finalDoc } = await supabase.from('documents').select('*').eq('id', docId).single();
  const { count: finalCount } = await supabase.from('document_chunks').select('*', { count: 'exact', head: true }).eq('document_id', docId);

  console.log('\n📊 Final Verification Results:');
  console.log('  - Document Title:', finalDoc.title);
  console.log('  - Document Status:', finalDoc.status);
  console.log('  - Chunks in document_chunks:', finalCount);
}

reingestStuckDocument('ea6d059b-554f-4280-a849-dd7d5c5a83bc').catch(console.error);
