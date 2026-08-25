# FOLLOWCHECK V3 — PROMPT PARA ANTIGRAVITY

Quiero crear un proyecto NUEVO y COMPLETAMENTE INDEPENDIENTE llamado `followcheck`.

IMPORTANTE:
- No tocar, mover, importar ni reutilizar archivos del otro proyecto web.
- No modificar ningún repo existente.
- No reutilizar tablas del Supabase de otro proyecto.
- No usar scraping de Instagram.
- No usar cookies, sesión ni contraseña de Instagram.
- No automatizar follows/unfollows.
- Solo usar exportaciones oficiales de Instagram en ZIP/JSON.

## Objetivo
Construir una PWA privada para una sola persona que:
1. importe el ZIP oficial de Instagram;
2. lea `followers_*.json` y `following.json`;
3. muestre seguidores, seguidos y “no me siguen”;
4. guarde snapshots;
5. compare el nuevo snapshot con el anterior;
6. detecte quién dejó de seguir y quién empezó a seguir;
7. guarde historial;
8. permita abrir perfiles de Instagram;
9. persista en un Supabase NUEVO;
10. quede preparada para instalarse como PWA en iPhone.

## Git/GitHub
1. Comprueba `git status`.
2. Si esta carpeta no es repo, inicialízala.
3. Crea repo GitHub NUEVO llamado `followcheck`, preferiblemente privado.
4. Rama `main`.
5. No uses `git add .` ni `git add -A`.
6. Usa `git add -- <archivos concretos>`.
7. Antes de commit: `git status`, `git diff`, `npm run build`.
8. No hagas push a ningún repo distinto de FollowCheck.

## Supabase
Crear un proyecto Supabase NUEVO e independiente.
Usar `supabase/schema.sql` como base.
Implementar Auth sencilla y privada, preferiblemente magic link/email OTP.
Mantener RLS para que cada fila quede limitada a `auth.uid()`.
No exponer `service_role`.
Frontend solo con anon key y variables de entorno.

## Importación
Aceptar el ZIP oficial entero.
Localizar:
- `connections/followers_and_following/following.json`
- uno o varios `followers_*.json`

No asumir solo `followers_1.json`.
Normalizar usernames a minúsculas.
No usar `recently_unfollowed_profiles.json` como fuente de verdad de seguidos actuales.

## UX inicial
Tres pestañas:
- Inicio
- No me siguen
- Actividad

Inicio:
- seguidores
- seguidos
- no me siguen
- última actualización
- importador ZIP
- resumen `-X bajas · +Y nuevos`

No me siguen:
- username
- tocar abre Instagram
- buscador sencillo

Actividad:
- altas y bajas
- fecha/hora
- filtro Todos / Bajas / Nuevos

## Privacidad
No subir a Git:
- ZIPs de Instagram
- usernames reales
- exports
- `.env`
- claves
- fixtures personales

## Validación
Probar:
- 1 followers file
- varios followers files
- duplicados
- `__deleted__...`
- baja real
- nuevo follower
- ZIP incorrecto

## PRIMERA FASE
Haz SOLO:
1. inspeccionar la base;
2. instalar dependencias;
3. comprobar que compila;
4. inicializar repo independiente;
5. crear repo GitHub nuevo;
6. crear Supabase nuevo y dejar Auth/RLS preparados;
7. mantener app funcionando en local.

NO desplegar todavía.
NO añadir automatización no oficial de Instagram.
NO tocar ningún proyecto externo.

Al acabar, dame:
- archivos modificados
- repo creado y URL
- estado de Supabase
- tablas/RLS
- validaciones
- `git status`
- hash commit
- confirmación explícita de que no tocaste ningún otro proyecto
