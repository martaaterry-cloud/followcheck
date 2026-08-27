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

function mapAuthError(err) {
  if (!err) return 'Ha ocurrido un error inesperado.';
  const msg = String(err.message || '').toLowerCase();
  const status = err.status;

  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch')) {
    return 'Error de conexión. Comprueba tu acceso a internet.';
  }
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('over_email_send_rate_limit')) {
    return 'Supabase ha limitado temporalmente los correos. Espera antes de solicitar otro.';
  }
  if (msg.includes('invalid login credentials') || msg.includes('invalid_grant') || msg.includes('invalid credentials')) {
    return 'La contraseña no es correcta o el correo no está registrado.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Debes confirmar tu correo electrónico antes de iniciar sesión.';
  }
  if (msg.includes('user already registered') || msg.includes('already exists') || msg.includes('already registered')) {
    return 'Ya existe una cuenta con este correo. Inicia sesión.';
  }
  if (msg.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }

  return err.message || 'Error en la autenticación.';
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
    throw new Error(mapAuthError(error));
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
    throw new Error(mapAuthError(error));
  }

  // Supabase devuelve user con identities vacío si el correo ya existe
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('Ya existe una cuenta con este correo. Inicia sesión.');
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

  const redirectTo = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://martaaterry-cloud.github.io/followcheck/';

  const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo
  });

  if (error) {
    throw new Error(mapAuthError(error));
  }

  return data;
}

export async function updateUserPassword(newPassword, confirmPassword = null) {
  const check = validatePassword(newPassword, confirmPassword);
  if (!check.valid) {
    throw new Error(check.message);
  }

  if (!supabaseReady()) {
    throw new Error('Supabase no está configurado en este entorno.');
  }

  const { data, error } = await supabase.auth.updateUser({
    password: newPassword
  });


  if (error) {
    throw new Error(mapAuthError(error));
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
