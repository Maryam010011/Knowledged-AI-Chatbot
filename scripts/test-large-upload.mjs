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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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

async function testLargeUploads() {
    console.log('🚀 Testing Direct Supabase Storage Upload & Ingestion for Large PDFs...\n');

    // Get sample org ID
    const { data: orgs } = await supabase.from('organizations').select('id, name').limit(1);
    const orgId = orgs[0].id;
    console.log(`Academy Organization: ${orgs[0].name} (${orgId})\n`);

    const largeFiles = [
        'Pro Performance cricket.pdf',
        'JSES_SueSee-et-al.-2025_Volume-9-Issue-2-Article-2.pdf',
        'thesis_hsf_2017_noorbhai_mohammed_habib.pdf',
    ];

    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

    for (const fileName of largeFiles) {
        const filePath = path.join(rootDir, 'data', fileName);
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            continue;
        }

        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`--------------------------------------------------`);
        console.log(`📄 Uploading "${fileName}" (${fileSizeMB} MB)...`);

        const pdfBuffer = fs.readFileSync(filePath);
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${orgId}/${Date.now()}_${sanitizedName}`;

        // 1. Direct Supabase Storage upload
        const { error: storageError } = await supabase.storage
            .from('coach-documents')
            .upload(storagePath, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true,
            });

        if (storageError) {
            console.error(`  ❌ Storage Upload Error:`, storageError.message);
            continue;
        }
        console.log(`  ✅ Direct Storage Upload successful to: ${storagePath}`);

        // 2. Server Ingestion via Storage Path
        const parsed = await pdfParse(pdfBuffer);
        const chunks = chunkText(parsed.text, 220, 40);
        console.log(`  Parsed ${parsed.numpages} pages -> Generated ${chunks.length} chunks (220 tokens target).`);

        // Insert or update document record
        const { data: docRecord, error: docError } = await supabase
            .from('documents')
            .insert({
                organization_id: orgId,
                title: fileName,
                storage_path: storagePath,
                status: 'processing',
            })
            .select()
            .single();

        if (docError || !docRecord) {
            console.error(`  ❌ Failed to create document record:`, docError?.message);
            continue;
        }

        // Embed chunks
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
                    title: fileName,
                    totalPages: parsed.numpages,
                },
            });
        }

        // Batch insert chunks
        const batchSize = 50;
        for (let i = 0; i < chunkRows.length; i += batchSize) {
            const batch = chunkRows.slice(i, i + batchSize);
            const { error: insertErr } = await supabase.from('document_chunks').insert(batch);
            if (insertErr) throw insertErr;
        }

        await supabase.from('documents').update({ status: 'ready' }).eq('id', docRecord.id);
        console.log(`  ✅ Status updated to 'ready' with ${chunkRows.length} vector chunks (384 dims)!\n`);
    }

    console.log('🎉 Direct Storage Ingestion Test Completed Successfully!');
}

testLargeUploads().catch(console.error);
