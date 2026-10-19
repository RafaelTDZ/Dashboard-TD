create extension if not exists pgcrypto;

create table if not exists public.excel_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  sheet_name text not null,
  records jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.excel_imports enable row level security;

drop policy if exists "excel_imports_anon_select" on public.excel_imports;
drop policy if exists "excel_imports_anon_insert" on public.excel_imports;
create policy "excel_imports_anon_select" on public.excel_imports for select to anon using (true);
create policy "excel_imports_anon_insert" on public.excel_imports for insert to anon with check (true);

grant select, insert on table public.excel_imports to anon;
