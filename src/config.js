export { APP_VERSION, BUILD_ID } from './version.js';

// MODO DE AUTENTICACIÓN:
// false = Almacenamiento local en navegador/PWA (sin pantalla de login ni llamadas a Supabase).
// true  = Autenticación privada con Supabase (Email + Contraseña / RLS).
export const AUTH_ENABLED = false;



// URL oficial del Centro de Cuentas de Meta para descarga de información
export const META_ACCOUNTS_CENTER_URL = 'https://accountscenter.instagram.com/info_and_permissions/dyi/';


