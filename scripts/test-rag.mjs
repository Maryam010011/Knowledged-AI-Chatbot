import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, serviceKey);

async function testQuery(queryText) {
    console.log(`\n==================================================`);
    console.log(`🔍 Testing Query: "${queryText}"`);
    console.log(`==================================================`);

    // Get sample org ID
    const { data: orgs } = await supabase.from('organizations').select('id, name').limit(1);
    const orgId = orgs[0].id;
    console.log(`Academy: ${orgs[0].name} (ID: ${orgId})`);

    // Generate query embedding
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const output = await extractor(queryText.replace(/\n+/g, ' ').trim(), { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(output.data);

    // Match chunks via RPC
    const { data: chunks, error } = await supabase.rpc('match_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 5,
        filter_organization_id: orgId,
    });

    if (error) {
        console.error('RPC match error:', error);
        return;
    }

    console.log(`Found ${chunks.length} matching chunks (threshold >= 0.5):`);
    chunks.forEach((c, i) => {
        console.log(`  [${i + 1}] Similarity: ${(c.similarity * 100).toFixed(1)}% | Doc: ${c.metadata?.title} | Content sample: ${c.content.slice(0, 100)}...`);
    });
}

async function run() {
    await testQuery("What challenges coaches face in South Africa");
    await testQuery("How to bake a chocolate cake");
}

run().catch(console.error);
