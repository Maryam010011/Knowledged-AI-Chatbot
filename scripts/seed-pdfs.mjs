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

// Load environment variables manually from .env.local
const envFile = path.join(rootDir, '.env.local');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function estimateTokens(text) {
  return Math.ceil(text.trim().split(/\s+/).length * 1.33);
}

function chunkText(text, targetTokenSize = 600, tokenOverlap = 75) {
  if (!text || !text.trim()) return [];

  const rawParagraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks = [];
  let currentChunkParagraphs = [];
  let currentTokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const paragraph = rawParagraphs[i];
    const paraTokens = estimateTokens(paragraph);

    if (paraTokens > targetTokenSize * 1.2) {
      const sentences = paragraph.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokenCount + sentenceTokens > targetTokenSize && currentChunkParagraphs.length > 0) {
          const chunkStr = currentChunkParagraphs.join('\n\n');
          chunks.push({
            content: chunkStr,
            metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) }
          });
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
      chunks.push({
        content: chunkStr,
        metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) }
      });
      currentChunkParagraphs = keepOverlap(currentChunkParagraphs, tokenOverlap);
      currentTokenCount = estimateTokens(currentChunkParagraphs.join('\n\n'));
    }

    currentChunkParagraphs.push(paragraph);
    currentTokenCount += paraTokens;
  }

  if (currentChunkParagraphs.length > 0) {
    const chunkStr = currentChunkParagraphs.join('\n\n');
    chunks.push({
      content: chunkStr,
      metadata: { chunkIndex: chunkIndex++, estimatedTokens: estimateTokens(chunkStr) }
    });
  }

  return chunks;
}

function keepOverlap(paragraphs, targetOverlapTokens) {
  const overlap = [];
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

async function main() {
  console.log('🏏 Cricket Coaching RAG — Sample PDF Seeder\n');

  // 1. Get or create a sample coach academy
  let orgId = null;
  const { data: existingOrgs } = await supabase.from('organizations').select('id, name, invite_code').limit(1);

  if (existingOrgs && existingOrgs.length > 0) {
    orgId = existingOrgs[0].id;
    console.log(`✅ Using existing academy: "${existingOrgs[0].name}" (Invite: ${existingOrgs[0].invite_code})`);
  } else {
    console.log('⚡ Creating default academy: "Marylebone Cricket Coaching Academy"...');
    const inviteCode = 'cricket1';
    const { data: newOrg, error: orgErr } = await supabase
      .from('organizations')
      .insert({ name: 'Marylebone Cricket Coaching Academy', invite_code: inviteCode })
      .select()
      .single();

    if (orgErr) {
      if (orgErr.code === '42501' || orgErr.message?.includes('permission denied')) {
        console.error('\n❌ Table permissions error (Postgres 42501: permission denied for table organizations).');
        console.error('👉 In Supabase, the tables were created by the "postgres" role and need privileges granted to "service_role".');
        console.error('👉 Please run the following SQL command in your Supabase SQL Editor:\n');
        console.error('   GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;\n');
        console.error('   (Or run the complete script in: supabase/fix-permissions.sql)\n');
      } else {
        console.error('❌ Failed to create organization:', orgErr.message);
      }
      process.exit(1);
    }
    orgId = newOrg.id;
    console.log(`✅ Academy created with invite code: ${inviteCode}`);
  }

  // 2. Load Transformers.js embedding model
  console.log('🤖 Initializing local Transformers.js embedding pipeline...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ Embedding model ready.');

  // 3. Scan data/ directory for PDFs
  const dataDir = path.join(rootDir, 'data');
  if (!fs.existsSync(dataDir)) {
    console.error('❌ data/ directory not found.');
    process.exit(1);
  }

  const files = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`\n📚 Found ${files.length} cricket coaching PDFs in data/:\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`[${i + 1}/${files.length}] Processing: ${file}`);
    const filePath = path.join(dataDir, file);
    const buffer = fs.readFileSync(filePath);

    try {
      // Check if document already ingested
      const { data: existingDoc } = await supabase
        .from('documents')
        .select('id, status')
        .eq('organization_id', orgId)
        .eq('title', file)
        .single();

      if (existingDoc && existingDoc.status === 'ready') {
        console.log(`  ↪️ Already ingested (ID: ${existingDoc.id}). Skipping.\n`);
        continue;
      }

      // Extract text
      const parsed = await pdfParse(buffer);
      const text = parsed.text || '';
      console.log(`  📄 Extracted ${parsed.numpages} pages (${text.length} chars)`);

      if (text.trim().length < 50) {
        console.log(`  ⚠️ Insufficient extractable text. Skipping.\n`);
        continue;
      }

      // Chunk text
      const chunks = chunkText(text, 600, 75);
      console.log(`  ✂️ Generated ${chunks.length} semantic chunks`);

      // Create document record
      const { data: docRecord, error: docErr } = await supabase
        .from('documents')
        .insert({
          organization_id: orgId,
          title: file,
          storage_path: `seeded/${file}`,
          status: 'processing',
        })
        .select()
        .single();

      if (docErr) throw docErr;

      // Embed chunks and insert
      const chunkRows = [];
      for (const chunk of chunks) {
        const output = await extractor(chunk.content.replace(/\n+/g, ' ').trim(), {
          pooling: 'mean',
          normalize: true,
        });
        chunkRows.push({
          document_id: docRecord.id,
          organization_id: orgId,
          content: chunk.content,
          embedding: Array.from(output.data),
          metadata: {
            ...chunk.metadata,
            title: file,
            totalPages: parsed.numpages,
          }
        });
      }

      // Insert in batches
      const batchSize = 40;
      for (let b = 0; b < chunkRows.length; b += batchSize) {
        const batch = chunkRows.slice(b, b + batchSize);
        const { error: batchErr } = await supabase.from('document_chunks').insert(batch);
        if (batchErr) throw batchErr;
      }

      await supabase.from('documents').update({ status: 'ready' }).eq('id', docRecord.id);
      console.log(`  ✅ Successfully ingested and stored ${chunkRows.length} vector chunks.\n`);
    } catch (err) {
      console.error(`  ❌ Error processing ${file}:`, err.message, '\n');
    }
  }

  console.log('🎉 Seed process finished!');
}

main().catch(console.error);
