import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase Connection...');
const adminClient = createClient(url, serviceKey);
const anonClient = createClient(url, anonKey);

async function runTest() {
  console.log('\n1. Testing Service Role Client query on profiles:');
  const { data: adminProfiles, error: adminErr } = await adminClient.from('profiles').select('*').limit(5);
  if (adminErr) {
    console.error('Service role error:', adminErr);
  } else {
    console.log('Service role success! Found profiles:', adminProfiles.length);
  }

  console.log('\n2. Testing Anon Client query on profiles (Logged out):');
  const { data: anonProfiles, error: anonErr } = await anonClient.from('profiles').select('*').limit(5);
  if (anonErr) {
    console.error('Anon error:', anonErr);
  } else {
    console.log('Anon success! Found profiles:', anonProfiles.length);
  }
}

runTest().catch(console.error);
