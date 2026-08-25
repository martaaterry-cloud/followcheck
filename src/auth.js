import { supabase, supabaseReady } from './supabase.js';

export async function getAuthUser() {
  if (!supabaseReady()) return null;
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function getAuthSession() {
  if (!supabaseReady()) return null;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session;
}

export async function sendOtpEmail(email) {
  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado.');
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      emailRedirectTo: window.location.href.split('?')[0].split('#')[0]
    }
  });
  if (error) throw error;
  return data;
}

export async function verifyOtpCode(email, token) {
  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado.');
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanToken = String(token).trim();
  const { data, error } = await supabase.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type: 'email'
  });
  if (error) throw error;
  return data;
}

export async function logoutUser() {
  if (!supabaseReady()) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function subscribeToAuth(callback) {
  if (!supabaseReady()) return { unsubscribe: () => {} };
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return subscription;
}
