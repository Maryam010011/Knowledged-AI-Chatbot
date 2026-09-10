import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

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

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
    console.log('NO_DB_URL: DATABASE_URL not set in .env.local');
    process.exit(0);
}

const sql = postgres(dbUrl, { ssl: 'require' });

async function run() {
    const sqlFile = path.join(rootDir, 'supabase', 'fix-rls-recursion.sql');
    const query = fs.readFileSync(sqlFile, 'utf-8');
    console.log('Executing SQL migration script...');
    await sql.unsafe(query);
    console.log('SUCCESS: SQL Migration executed successfully!');
    await sql.end();
}

run().catch((err) => {
    console.error('ERROR executing SQL:', err);
    process.exit(1);
});
