// Fuente única y centralizada de versión para FollowCheck
export const APP_VERSION = "0.3.11";

// BUILD_ID inyectado en tiempo de compilación por Vite o fallback en entorno local
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
