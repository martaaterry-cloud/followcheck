import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        val = val.trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('Supabase env vars no encontradas en .env. Saltando live test.');
  process.exit(0);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runRlsTests() {
  console.log('=== TEST 1: Intento de lectura anónima (sin autenticación) ===');
  const { data: anonSnapshots, error: anonReadErr } = await client
    .from('snapshots')
    .select('*');
  console.log('Resultado lectura snapshots anónima:', { dataCount: anonSnapshots?.length, error: anonReadErr });

  const { data: anonActivity, error: anonActErr } = await client
    .from('activity')
    .select('*');
  console.log('Resultado lectura activity anónima:', { dataCount: anonActivity?.length, error: anonActErr });

  console.log('\n=== TEST 2: Intento de inserción anónima / sin auth ===');
  const fakeUserId = '00000000-0000-0000-0000-000000000001';
  const { data: insertSnapData, error: insertSnapErr } = await client
    .from('snapshots')
    .insert({
      user_id: fakeUserId,
      followers: ['test1'],
      following: ['test2'],
      followers_count: 1,
      following_count: 1
    });
  console.log('Resultado inserción snapshots no autorizada:', {
    blockedByRls: Boolean(insertSnapErr),
    errorCode: insertSnapErr?.code,
    errorMessage: insertSnapErr?.message
  });

  const { data: insertActData, error: insertActErr } = await client
    .from('activity')
    .insert({
      user_id: fakeUserId,
      username: 'testuser',
      type: 'followed'
    });
  console.log('Resultado inserción activity no autorizada:', {
    blockedByRls: Boolean(insertActErr),
    errorCode: insertActErr?.code,
    errorMessage: insertActErr?.message
  });

  console.log('\n=== TEST 3: Intento de borrado no autorizado ===');
  const { data: deleteData, error: deleteErr } = await client
    .from('snapshots')
    .delete()
    .eq('id', 1);
  console.log('Resultado borrado anónimo:', { error: deleteErr, data: deleteData });

  console.log('\nRLS Live Validation completada.');
}

runRlsTests();
