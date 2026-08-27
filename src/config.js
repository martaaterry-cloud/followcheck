export { APP_VERSION, BUILD_ID } from './version.js';

// MODO TEMPORAL SIN LOGIN:
// false = Almacenamiento local en navegador/PWA (sin pantalla de login ni llamadas a Supabase).
// true  = Autenticación privada con Supabase (Magic Link / RLS).
export const AUTH_ENABLED = false;

