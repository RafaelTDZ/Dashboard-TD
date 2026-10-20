-- Endurecimento da tabela excel_imports e da função que mantém o snapshot único.
-- Consolida os itens A1, M2, M3, M6, M8 e B7 do ANALISE.md:
--   A1 — o papel `anon` mantinha TRUNCATE/UPDATE/DELETE (a RLS não cobre TRUNCATE);
--   M2 — `created_at`/`updated_at` passam a ser gravados pelo servidor;
--   M3 — a invariante "uma única linha" ganha índice único e CHECK de `records`;
--   M6 — a função SECURITY DEFINER deixa de ser executável pelo cliente;
--   M8 — `search_path` restrito na função de trigger;
--   B7 — `updated_at` passa a ser mantida por um trigger de UPDATE.
-- Roda também uma correção do DELETE do trigger (ver "DELETE do trigger" abaixo).
-- Rode este SQL no SQL Editor do projeto usado pelo dashboard.

-- ---------------------------------------------------------------------------
-- A1 — privilégios reais do papel usado pelo dashboard
-- ---------------------------------------------------------------------------
-- O ACL padrão do Supabase concede ALL ao `anon`/`authenticated`. A RLS bloqueia
-- UPDATE e DELETE (não existem policies para eles), mas TRUNCATE não passa por
-- RLS: apaga a tabela inteira sem disparar o trigger e burla a validação de
-- superset. Revogando tudo e concedendo apenas SELECT/INSERT o cliente não
-- consegue mais truncar a tabela.
revoke all on table public.excel_imports from anon, authenticated;
grant select, insert on table public.excel_imports to anon;

-- O trigger é SECURITY DEFINER e roda como dono da tabela: o `delete` interno
-- continua funcionando mesmo com o DELETE revogado para o cliente.
--
-- NÃO usar `alter table public.excel_imports force row level security`:
-- o DELETE passaria a ser sujeito à RLS (sem policy de DELETE) e o singleton
-- quebraria silenciosamente.

-- ---------------------------------------------------------------------------
-- M3 — a invariante "uma única linha" não depende só do trigger
-- ---------------------------------------------------------------------------
-- Índice único: mesmo com o trigger desabilitado ou removido, a tabela não
-- aceita uma segunda linha. No caminho normal não há conflito: o trigger
-- apaga a linha anterior (na mesma transação) antes do INSERT.
create unique index if not exists excel_imports_singleton
  on public.excel_imports ((true));

-- CHECK: o snapshot nunca é vazio — `records` precisa ser um array com pelo
-- menos um registro.
alter table public.excel_imports
  drop constraint if exists excel_imports_records_is_array;
alter table public.excel_imports
  add constraint excel_imports_records_is_array
  check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) > 0);

-- ---------------------------------------------------------------------------
-- M2 + M8 — função de trigger: search_path restrito e timestamps do servidor
-- ---------------------------------------------------------------------------
-- A lógica de validação (SNAPSHOT_INVALID, SNAPSHOT_INVALID_KEYS,
-- SNAPSHOT_DUPLICATE_KEYS, SNAPSHOT_MISSING_RECORDS), o lock de serialização
-- e a comparação de superset permanecem exatamente como estavam. As únicas
-- mudanças são o `search_path` vazio e os timestamps sob controle do servidor.
create or replace function public.excel_imports_enforce_single_latest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_current jsonb;
  v_keys text[];
  v_missing text[];
  v_empty integer;
  v_dupes integer;
begin
  v_new := new.records::jsonb;

  if v_new is null
     or jsonb_typeof(v_new) <> 'array'
     or jsonb_array_length(v_new) = 0 then
    raise exception 'SNAPSHOT_INVALID: lista de registros vazia ou inválida';
  end if;

  -- Serializa importações concorrentes: a segunda espera a primeira terminar
  -- e compara contra o snapshot já gravado.
  perform pg_advisory_xact_lock(hashtext('public.excel_imports.singleton')::bigint);

  select array_agg(upper(btrim(coalesce(item->>'operacao', ''))))
    into v_keys
  from jsonb_array_elements(v_new) as item;

  select (count(*) filter (where k = ''))::integer,
         (count(*) - count(distinct k))::integer
    into v_empty, v_dupes
  from unnest(v_keys) as k;

  if v_empty > 0 then
    raise exception 'SNAPSHOT_INVALID_KEYS: % registro(s) sem Operação', v_empty;
  end if;

  if v_dupes > 0 then
    raise exception 'SNAPSHOT_DUPLICATE_KEYS: % Operação(ões) duplicada(s)', v_dupes;
  end if;

  select e.records::jsonb
    into v_current
  from public.excel_imports e
  order by e.created_at desc, e.id desc
  limit 1;

  if v_current is not null and jsonb_typeof(v_current) = 'array' then
    select array_agg(m.key)
      into v_missing
    from (
      select distinct upper(btrim(coalesce(item->>'operacao', ''))) as key
      from jsonb_array_elements(v_current) as item
      where btrim(coalesce(item->>'operacao', '')) <> ''

      except

      select upper(btrim(coalesce(item->>'operacao', ''))) as key
      from jsonb_array_elements(v_new) as item
    ) as m;

    if v_missing is not null and cardinality(v_missing) > 0 then
      raise exception 'SNAPSHOT_MISSING_RECORDS: % processo(s) do banco não estão no arquivo novo',
        cardinality(v_missing)
        using detail = array_to_string(v_missing[1:20], ', ');
    end if;
  end if;

  -- M2 — os timestamps são do servidor: o que o cliente envia é ignorado.
  -- Sem isso, um `created_at` no futuro monopoliza a ordenação
  -- "mais recente vence" e um `updated_at` falso confundiria a leitura.
  new.created_at := now();
  new.updated_at := now();

  -- A nova linha ainda não existe (BEFORE INSERT): apagar todas as anteriores
  -- deixa a tabela com exatamente o snapshot que está entrando.
  --
  -- O WHERE é obrigatório: o papel `authenticator` do projeto carrega a
  -- biblioteca `safeupdate` (session_preload_libraries), que recusa qualquer
  -- DELETE sem cláusula WHERE — inclusive o DELETE interno deste trigger,
  -- chamado pelo app via POST /rest/v1/excel_imports. Sem o WHERE a
  -- importação é rejeitada com "DELETE requires a WHERE clause" (SQLSTATE
  -- 21000) e o dashboard nunca consegue gravar o snapshot na nuvem.
  -- `id in (select id from ...)` apaga exatamente as mesmas linhas do
  -- `delete from public.excel_imports;` original.
  delete from public.excel_imports
    where id in (select id from public.excel_imports);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- M6 — a função de trigger sai do alcance do cliente
-- ---------------------------------------------------------------------------
-- O EXECUTE default do Postgres (papel PUBLIC) deixa a função SECURITY DEFINER
-- como entry point público. Hoje a chamada direta falha com
-- "0A000: trigger functions can only be called as triggers", mas revogar evita
-- que ela vire escalação no futuro. O disparo do trigger não depende do
-- EXECUTE do cliente: a permissão só é conferida na criação do trigger.
-- O revoke vem depois do `create or replace` para valer sobre a versão nova.
revoke execute on function public.excel_imports_enforce_single_latest()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B7 — `updated_at` passa a ser mantida
-- ---------------------------------------------------------------------------
-- A coluna existia, mas nada a atualizava e o cliente não tem UPDATE. O
-- trigger mantém a coluna honesta para qualquer atualização feita pelo dono
-- da tabela (ou por um papel de serviço futuro).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

drop trigger if exists excel_imports_touch_updated_at on public.excel_imports;
create trigger excel_imports_touch_updated_at
before update on public.excel_imports
for each row execute function public.touch_updated_at();
