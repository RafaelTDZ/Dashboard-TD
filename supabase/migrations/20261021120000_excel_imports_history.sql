-- F4 — histórico append-only e rollback dos snapshots aceitos.
--
-- DECISÃO A (opção A): a escrita continua pública, com a chave publishable no
-- cliente, e o risco residual está documentado no README. O trigger de
-- importação valida chaves, duplicatas e superset em `operacao`, mas NÃO valida
-- os valores dos registros.
--
-- Esta migration NÃO copia o snapshot que já está em public.excel_imports: o
-- histórico começa vazio e passa a registrar as substituições a partir da
-- aplicação deste arquivo. Cada linha é append-only para o cliente — não há
-- UPDATE nem DELETE de histórico expostos, e a tabela não é concedida a
-- anon/authenticated (o dono/service role acessa pelo SQL Editor).

create table if not exists public.excel_imports_history (
  history_id bigint generated always as identity primary key,
  import_id uuid not null,
  file_name text not null,
  sheet_name text not null,
  records jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz not null default now()
);

-- Não usar `like public.excel_imports including all`: o índice único singleton
-- (`((true))`) seria copiado e impediria mais de uma linha no histórico.
alter table public.excel_imports_history
  drop constraint if exists excel_imports_history_records_is_array;
alter table public.excel_imports_history
  add constraint excel_imports_history_records_is_array
  check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) > 0);

create index if not exists excel_imports_history_created_at_idx
  on public.excel_imports_history (created_at desc, history_id desc);

-- O histórico não é exposto ao cliente: RLS habilitada e nenhum privilégio
-- para anon/authenticated. O dono da tabela continua com acesso pelo SQL
-- Editor e é ele quem executa a função SECURITY DEFINER abaixo.
alter table public.excel_imports_history enable row level security;
revoke all on table public.excel_imports_history from anon, authenticated;

-- Arquiva o snapshot que está sendo substituído. SECURITY DEFINER porque o
-- `anon` não tem INSERT no histórico: quem insere é o dono da tabela, no
-- contexto do trigger de DELETE de public.excel_imports.
create or replace function public.excel_imports_archive_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.excel_imports_history
    (import_id, file_name, sheet_name, records, metadata, created_at, updated_at, archived_at)
  values
    (old.id, old.file_name, old.sheet_name, old.records, old.metadata, old.created_at, old.updated_at, now());
  return old;
end;
$$;

revoke execute on function public.excel_imports_archive_history()
  from public, anon, authenticated;

drop trigger if exists excel_imports_archive_history on public.excel_imports;
create trigger excel_imports_archive_history
before delete on public.excel_imports
for each row execute function public.excel_imports_archive_history();

-- Restaura um snapshot do histórico. Deve ser executado pelo dono no SQL
-- Editor. O trigger de superset é desabilitado APENAS nesta transação: o ALTER
-- TABLE é transacional, então qualquer erro na restauração o reabilita
-- automaticamente (a transação inteira é desfeita) e o lock dura só o tempo da
-- operação. O trigger de arquivo continua ativo durante o DELETE e registra o
-- snapshot que estava valendo, então o próprio rollback também pode ser
-- desfeito por outro rollback.
create or replace function public.excel_imports_rollback(p_history_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.excel_imports_history%rowtype;
  v_id uuid;
begin
  select *
    into v_row
  from public.excel_imports_history
  where history_id = p_history_id;

  if not found then
    raise exception 'HISTORY_NOT_FOUND: histórico % não encontrado', p_history_id;
  end if;

  -- Sem desabilitar o trigger, o INSERT restaurado seria comparado com a
  -- tabela vazia e precisaria ser um superset de si mesmo. O ALTER é
  -- transacional e o trigger volta a ficar ativo no fim da função.
  alter table public.excel_imports disable trigger excel_imports_single_latest;

  -- O WHERE é obrigatório por causa da safeupdate; o trigger de arquivo
  -- registra o snapshot que estava valendo antes desta restauração.
  delete from public.excel_imports where id in (select id from public.excel_imports);

  -- O rollback é um novo evento de snapshot: created_at/updated_at recebem o
  -- horário do servidor para vencer qualquer cache local anterior. Os
  -- timestamps originais continuam preservados na linha do histórico.
  insert into public.excel_imports
    (id, file_name, sheet_name, records, metadata, created_at, updated_at)
  values
    (v_row.import_id, v_row.file_name, v_row.sheet_name, v_row.records, v_row.metadata, now(), now())
  returning id into v_id;

  alter table public.excel_imports enable trigger excel_imports_single_latest;

  return v_id;
end;
$$;

revoke execute on function public.excel_imports_rollback(bigint)
  from public, anon, authenticated;
