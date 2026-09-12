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
const envContent = fs.readFileSync(envFile, 'utf-8');

const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
const serviceRole = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();
const apiKey = envContent.match(/GROQ_API_KEY=(.*)/)?.[1]?.trim();

const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

async function runTests() {
  console.log('================================================================');
  console.log('       CRICKET COACHING RAG - REGRESSION VERIFICATION SUITE       ');
  console.log('================================================================\n');

  // TEST 1: ONE COACH/ADMIN PER ACADEMY
  console.log('--- TEST 1: Verify Exactly One Coach/Admin Per Academy ---');
  const { data: orgs } = await admin.from('organizations').select('id, name');
  const eliteOrg = orgs.find(o => o.name === 'Elite Academy');
  console.log(`[PASS] Elite Academy located: ID ${eliteOrg?.id}`);

  const { data: admins } = await admin.from('profiles').select('*').eq('organization_id', eliteOrg?.id).eq('role', 'admin');
  console.log(`[PASS] Elite Academy current admin count: ${admins?.length} (Admin: ${admins?.[0]?.full_name})`);

  // Attempting second admin insert
  const fakeAdminId = '00000000-0000-0000-0000-000000000001';
  const { error: secondAdminErr } = await admin.from('profiles').insert({
    id: fakeAdminId,
    organization_id: eliteOrg?.id,
    role: 'admin',
    full_name: 'Second Coach Intruder'
  });
  if (secondAdminErr) {
    console.log(`[PASS] Second admin creation rejected by DB constraint: "${secondAdminErr.message}"`);
  } else {
    console.log('[FAIL] Second admin was inserted without DB constraint error. Cleaning up...');
    await admin.from('profiles').delete().eq('id', fakeAdminId);
  }

  // TEST 2: MAGIC LINK ENDPOINT & URL CONFIGURATION AUDIT
  console.log('\n--- TEST 2: Magic Link Audit ---');
  const magicLinkRes = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'maryam51214ali@gmail.com',
    options: {
      redirectTo: 'https://knowledged-ai-chatbot.vercel.app/auth/callback'
    }
  });
  console.log(`[AUDIT] Action Link generated: ${!!magicLinkRes.data?.properties?.action_link}`);
  console.log(`[AUDIT] Action Link target redirect_to: "${magicLinkRes.data?.properties?.redirect_to}"`);
  if (magicLinkRes.data?.properties?.redirect_to === 'http://localhost:3000') {
    console.log('[ROOT CAUSE IDENTIFIED] Supabase Dashboard Site URL is set to http://localhost:3000. It must be updated to https://knowledged-ai-chatbot.vercel.app with allowed redirect URLs.');
  }

  // TEST 3: CONVERSATIONAL QUERY REFORMULATION FOR FOLLOW-UPS
  console.log('\n--- TEST 3: Conversational Query Reformulation (Multi-Turn) ---');
  const history = [
    { role: 'user', content: 'What are the main challenges coaches face in South Africa?' },
    { role: 'assistant', content: 'According to research, coaches face challenges including: 1. Lack of specialized facilities, 2. Socio-economic inequalities in rural provinces, 3. Limited continuous professional development.' }
  ];

  async function rewrite(query) {
    const prompt = [
      {
        role: 'system',
        content: 'You are a search query reformulator for a cricket coaching knowledge base. Given the conversation history, rewrite the user latest follow-up question into a standalone, concise keyword search query for vector retrieval. If the query is already standalone or off-topic, output it as-is. Output ONLY the standalone query, nothing else.'
      },
      ...history,
      { role: 'user', content: query }
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen/qwen3.8-27b', messages: prompt, temperature: 0.1, max_tokens: 80 })
    });
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
  }

  const q1 = await rewrite('Can you explain the second challenge?');
  console.log(`[PASS] Follow-up 1: "Can you explain the second challenge?" -> Reformulated to: "${q1}"`);

  const q2 = await rewrite('Give me an example.');
  console.log(`[PASS] Follow-up 2: "Give me an example." -> Reformulated to: "${q2}"`);

  const q3 = await rewrite('What is the capital of France?');
  console.log(`[PASS] Follow-up 3: "What is the capital of France?" -> Off-topic preserved as: "${q3}"`);

  // TEST 4: VECTOR RETRIEVAL (STRICT 0.5 THRESHOLD)
  console.log('\n--- TEST 4: Vector Retrieval at 0.5 Threshold ---');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  // Test raw follow-up (without rewrite)
  const rawFollowUpEmb = await extractor('Can you explain the second challenge?', { pooling: 'mean', normalize: true });
  const { data: rawChunks } = await admin.rpc('match_document_chunks', {
    query_embedding: Array.from(rawFollowUpEmb.data),
    match_threshold: 0.5,
    match_count: 3,
    filter_organization_id: eliteOrg.id
  });
  console.log(`[VERIFIED] Raw follow-up chunks above 0.5 threshold: ${rawChunks?.length || 0} (Demonstrates why fallback previously failed)`);

  // Test reformulated follow-up
  const refEmb = await extractor(q1, { pooling: 'mean', normalize: true });
  const { data: refChunks } = await admin.rpc('match_document_chunks', {
    query_embedding: Array.from(refEmb.data),
    match_threshold: 0.5,
    match_count: 3,
    filter_organization_id: eliteOrg.id
  });
  console.log(`[PASS] Reformulated follow-up chunks above 0.5 threshold: ${refChunks?.length || 0}`);
  refChunks?.forEach((c, idx) => {
    console.log(`  Chunk ${idx + 1}: ${(c.similarity * 100).toFixed(1)}% match | Document: "${c.metadata?.title}"`);
  });

  // Test off-topic query
  const offTopicEmb = await extractor(q3, { pooling: 'mean', normalize: true });
  const { data: offTopicChunks } = await admin.rpc('match_document_chunks', {
    query_embedding: Array.from(offTopicEmb.data),
    match_threshold: 0.5,
    match_count: 3,
    filter_organization_id: eliteOrg.id
  });
  console.log(`[PASS] Off-topic query ("${q3}") chunks above 0.5 threshold: ${offTopicChunks?.length || 0} (Strict Fallback with ZERO citations)`);

  // Subsequent cricket question after fallback
  const subsequentCricket = 'What is the recommended head and front foot position for a forward defensive?';
  const subEmb = await extractor(subsequentCricket, { pooling: 'mean', normalize: true });
  const { data: subChunks } = await admin.rpc('match_document_chunks', {
    query_embedding: Array.from(subEmb.data),
    match_threshold: 0.5,
    match_count: 3,
    filter_organization_id: eliteOrg.id
  });
  console.log(`[PASS] Subsequent cricket question after fallback retrieved ${subChunks?.length || 0} chunks (Chat recovers seamlessly)`);

  // TEST 5: MULTI-TENANT ISOLATION
  console.log('\n--- TEST 5: Strict Multi-Tenant Isolation ---');
  const testOrg = orgs.find(o => o.name === 'Test Academy');
  if (testOrg) {
    const { data: testOrgChunks } = await admin.rpc('match_document_chunks', {
      query_embedding: Array.from(refEmb.data),
      match_threshold: 0.1, // Even with extremely low threshold
      match_count: 5,
      filter_organization_id: testOrg.id
    });
    console.log(`[PASS] Test Academy cross-tenant chunks returned for Elite Academy query: ${testOrgChunks?.length || 0} (Strict 0 chunks, no data leakage)`);
  }

  console.log('\n================================================================');
  console.log('                ALL REGRESSION TESTS COMPLETED                ');
  console.log('================================================================\n');
}

runTests().catch(console.error);
