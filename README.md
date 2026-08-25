# FollowCheck V3

PWA privada para analizar exportaciones oficiales de Instagram y saber:
- quién no te sigue;
- quién te dejó de seguir desde la última importación;
- quién empezó a seguirte;
- historial de cambios.

## Seguridad
No inicia sesión en Instagram, no guarda contraseña, no usa cookies, no hace scraping y no automatiza follows/unfollows.

## Arranque
```bash
npm install
copy .env.example .env
npm run dev
```

## Supabase
Crear un proyecto NUEVO y separado.
Ejecutar `supabase/schema.sql`.
Configurar `.env` con URL y anon key del proyecto nuevo.

Antes de producción, comprobar Auth y RLS.
