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

async function reindex() {
    console.log('🔄 Starting Re-indexing of Existing Documents...\n');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    const { data: docs, error: docErr } = await supabase.from('documents').select('*');
    if (docErr) throw docErr;

    console.log(`Found ${docs.length} existing document records.\n`);

    for (const doc of docs) {
        console.log(`Processing Document: "${doc.title}" (ID: ${doc.id})`);
        const dataDir = path.join(rootDir, 'data');
        let pdfBuffer = null;

        // 1. Try reading from local data/ directory if seeded file
        const localPath = path.join(dataDir, doc.title);
        if (fs.existsSync(localPath)) {
            pdfBuffer = fs.readFileSync(localPath);
        } else {
            // 2. Otherwise download from Supabase Storage
            const { data: downloadData, error: downloadErr } = await supabase.storage
                .from('coach-documents')
                .download(doc.storage_path);

            if (downloadData) {
                pdfBuffer = Buffer.from(await downloadData.arrayBuffer());
            } else {
                console.warn(`  ⚠️ Could not locate buffer for ${doc.title}:`, downloadErr?.message);
                continue;
            }
        }

        const parsed = await pdfParse(pdfBuffer);
        const text = parsed.text || '';
        console.log(`  Extracted ${text.length} chars, ${parsed.numpages} pages.`);

        const chunks = chunkText(text, 220, 40);
        console.log(`  Generated ${chunks.length} chunks (220 tokens target, 40 overlap).`);

        // Safely delete existing chunks for this document ONLY
        const { error: delErr } = await supabase.from('document_chunks').delete().eq('document_id', doc.id);
        if (delErr) {
            console.error(`  ❌ Failed to delete old chunks:`, delErr.message);
            continue;
        }

        // Embed new chunks
        const chunkRows = [];
        for (const chunk of chunks) {
            const output = await extractor(chunk.content.replace(/\n+/g, ' ').trim(), {
                pooling: 'mean',
                normalize: true,
            });
            chunkRows.push({
                document_id: doc.id,
                organization_id: doc.organization_id,
                content: chunk.content,
                embedding: Array.from(output.data),
                metadata: {
                    ...chunk.metadata,
                    title: doc.title,
                    totalPages: parsed.numpages,
                }
            });
        }

        // Insert new chunks in batches
        const batchSize = 40;
        for (let b = 0; b < chunkRows.length; b += batchSize) {
            const batch = chunkRows.slice(b, b + batchSize);
            const { error: insertErr } = await supabase.from('document_chunks').insert(batch);
            if (insertErr) throw insertErr;
        }

        await supabase.from('documents').update({ status: 'ready' }).eq('id', doc.id);
        console.log(`  ✅ Successfully re-indexed "${doc.title}" with ${chunkRows.length} chunks (384 dims).\n`);
    }

    console.log('🎉 Re-indexing complete!');
}

reindex().catch(console.error);
