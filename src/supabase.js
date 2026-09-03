import { createClient } from '@supabase/supabase-js';
import { AUTH_ENABLED } from './config.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env
  : (typeof process !== 'undefined' && process.env ? process.env : {});

const url = env.VITE_SUPABASE_URL || '';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';

// Si AUTH_ENABLED es false, no se crea el cliente de Supabase ni se abren conexiones
export const supabase = (AUTH_ENABLED && url && anonKey)
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'followcheck_auth_session_v1',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      }
    })
  : null;

export function supabaseReady() {
  return Boolean(AUTH_ENABLED && supabase);
}

