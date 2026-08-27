-- Migración Fase E.1: Reestructurar jerarquía de cuentas (account_group y unavailable_reason)

alter table public.account_preferences
  add column if not exists account_group text default 'normal' not null,
  add column if not exists unavailable_reason text default null;

-- Migración compatible de datos existentes
update public.account_preferences
set account_group = case
  when deleted = true then 'unavailable'
  when ignored = true then 'secondary'
  when famous = true then 'relevant'
  else 'normal'
end
where account_group is null or account_group = 'normal';

update public.account_preferences
set unavailable_reason = case
  when deleted = true and username like '__deleted__%' then 'deleted'
  when deleted = true then 'manual'
  else null
end
where account_group = 'unavailable' and unavailable_reason is null;

-- Índice para consultas rápidas por grupo
create index if not exists idx_account_prefs_group on public.account_preferences(user_id, account_group);
