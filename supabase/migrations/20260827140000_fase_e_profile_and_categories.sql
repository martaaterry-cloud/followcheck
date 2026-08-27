-- Migración Fase E: Perfil de Instagram + Categorías Personalizadas y Memberships

-- 1. Tabla de perfil de usuario
create table if not exists public.user_profile (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade unique,
  instagram_username text,
  display_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.user_profile enable row level security;

create policy "user_profile_select" on public.user_profile
  for select using (auth.uid() = user_id);

create policy "user_profile_insert" on public.user_profile
  for insert with check (auth.uid() = user_id);

create policy "user_profile_update" on public.user_profile
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_profile_delete" on public.user_profile
  for delete using (auth.uid() = user_id);


-- 2. Tabla de categorías personalizadas
create table if not exists public.categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (user_id, name)
);

alter table public.categories enable row level security;

create policy "categories_select" on public.categories
  for select using (auth.uid() = user_id);

create policy "categories_insert" on public.categories
  for insert with check (auth.uid() = user_id);

create policy "categories_update" on public.categories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "categories_delete" on public.categories
  for delete using (auth.uid() = user_id);


-- 3. Tabla de asignaciones de cuentas a categorías (memberships)
create table if not exists public.account_category_memberships (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz default now() not null,
  unique (user_id, username, category_id)
);

alter table public.account_category_memberships enable row level security;

create policy "account_category_memberships_select" on public.account_category_memberships
  for select using (auth.uid() = user_id);

create policy "account_category_memberships_insert" on public.account_category_memberships
  for insert with check (auth.uid() = user_id);

create policy "account_category_memberships_update" on public.account_category_memberships
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "account_category_memberships_delete" on public.account_category_memberships
  for delete using (auth.uid() = user_id);

-- Índices de optimización
create index if not exists idx_categories_user_id on public.categories(user_id);
create index if not exists idx_memberships_user_username on public.account_category_memberships(user_id, username);
create index if not exists idx_memberships_category_id on public.account_category_memberships(category_id);
