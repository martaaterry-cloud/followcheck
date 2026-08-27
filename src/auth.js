import { supabase, supabaseReady } from './supabase.js';

export function validatePassword(password, confirmPassword = null) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Introduce una contraseña.' };
  }
  if (password.length < 6) {
    return { valid: false, message: 'La contraseña debe tener al menos 6 caracteres.' };
  }
  if (confirmPassword !== null && password !== confirmPassword) {
    return { valid: false, message: 'Las contraseñas no coinciden.' };
  }
  return { valid: true, message: '' };
}

export async function getAuthUser() {
  if (!supabaseReady()) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

export async function getAuthSession() {
  if (!supabaseReady()) return null;
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return null;
    return session;
  } catch {
    return null;
  }
}

export async function loginWithPassword(email, password) {
  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado en este entorno.');
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!cleanEmail) {
    throw new Error('Introduce tu correo electrónico.');
  }
  if (!cleanPassword) {
    throw new Error('Introduce tu contraseña.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password: cleanPassword
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
      throw new Error('Correo o contraseña incorrectos.');
    }
    if (msg.includes('email not confirmed')) {
      throw new Error('Debes confirmar tu correo electrónico antes de iniciar sesión.');
    }
    throw new Error(error.message);
  }

  return data;
}

export async function registerWithPassword(email, password, confirmPassword) {
  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado en este entorno.');
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  const cleanConfirm = String(confirmPassword || '');

  if (!cleanEmail) {
    throw new Error('Introduce tu correo electrónico.');
  }

  const check = validatePassword(cleanPassword, cleanConfirm);
  if (!check.valid) {
    throw new Error(check.message);
  }

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password: cleanPassword
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('user already registered') || msg.includes('already exists')) {
      throw new Error('Ya existe una cuenta registrada con este correo.');
    }
    throw new Error(error.message);
  }

  return data;
}

export async function resetPassword(email) {
  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado en este entorno.');
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Introduce tu correo electrónico.');
  }

  const redirectTo = window.location.href.split('?')[0].split('#')[0];
  const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function logoutUser() {
  if (!supabaseReady()) return;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    console.warn('Error al cerrar sesión:', err);
  }
}

export function subscribeToAuth(callback) {
  if (!supabaseReady()) return { unsubscribe: () => {} };
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return subscription;
}
