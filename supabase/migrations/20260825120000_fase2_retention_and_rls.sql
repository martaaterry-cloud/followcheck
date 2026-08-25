-- FollowCheck V3 - Fase 2: Políticas RLS DELETE e Índices de Rendimiento

-- Permitir al usuario eliminar sus propios snapshots (necesario para política de retención de máx. 10)
create policy "snapshots_delete_own"
on public.snapshots for delete
using (auth.uid() = user_id);

-- Permitir al usuario eliminar su propia actividad si fuera necesario
create policy "activity_delete_own"
on public.activity for delete
using (auth.uid() = user_id);

-- Índices para optimizar las consultas por usuario ordenadas por fecha
create index if not exists idx_snapshots_user_created_at
on public.snapshots(user_id, created_at desc);

create index if not exists idx_activity_user_created_at
on public.activity(user_id, created_at desc);
