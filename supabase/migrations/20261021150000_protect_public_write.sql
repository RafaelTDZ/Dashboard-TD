-- F11 — proteção da escrita pública: teto de payload, cooldown e retenção do histórico.
--
-- A escrita do snapshot é pública (decisão D1 = A, ver F4): qualquer pessoa com
-- a chave publishable pode inserir em public.excel_imports. O risco residual
-- documentado no README era: "rate limit e monitoramento não implementados".
-- Esta migration fecha essa lacuna no próprio banco, que é o único ponto onde
-- a escrita pública pode ser contida.
--
-- 1. TETO DE PAYLOAD — o mesmo limite de 6 MB que o cliente aplica
--    (DashboardImport.MAX_SNAPSHOT_BYTES, 6 * 1024 * 1024 bytes). O cliente
--    recusa antes de enviar (mensagem amigável); aqui é a rede de segurança
--    para quem chamar a API direto.
--
-- 2. COOLDOWN — no máximo uma escrita a cada 30 segundos. Uma pessoa não
--    importa o mesmo arquivo duas vezes em menos de 30 s; o cooldown corta o
--    abuso de escrita (spam) e o custo de CPU do trigger de validação, que é
--    O(n) no tamanho do dataset.
--
-- 3. RETENÇÃO DO HISTÓRICO — cada escrita arquiva o snapshot anterior
--    (~2,4 MB por escrita). Sem janela, o histórico cresce sem limite e vira
--    um vetor de exaustão de disco. A partir de agora são mantidas as 5
--    últimas versões. O histórico continua append-only para o cliente (sem
--    UPDATE/DELETE concedidos a anon/authenticated): quem poda é o dono, por
--    dentro do trigger, e só o que está fora da janela.
--
-- MONITORAMENTO — as recusas são registradas com `raise warning`, que aparece
-- no log do Postgres (Supabase → Logs Explorer). Não há tabela de auditoria
-- porque a recusa aborta a transação: qualquer linha gravada na mesma
-- transação seria desfeita junto. O que fica durável é o histórico das
-- escritas ACEITAS (excel_imports_history).

-- ---------------------------------------------------------------------------
-- Limites (mantidos em sincronia com o cliente e com o ANALISE.md)
-- ---------------------------------------------------------------------------
-- 6 * 1024 * 1024 = 6.291.456 bytes (6 MB) — mesmo número do cliente.
-- 30 s entre duas escritas.
-- 5 versões no histórico.

-- ---------------------------------------------------------------------------
-- 1 + 2 — trigger de superset: teto de payload e cooldown
-- ---------------------------------------------------------------------------
-- A lógica de validação (SNAPSHOT_INVALID, SNAPSHOT_INVALID_KEYS,
-- SNAPSHOT_DUPLICATE_KEYS, SNAPSHOT_MISSING_RECORDS), o lock de serialização
-- e a comparação de superset permanecem exatamente como estavam.
create or replace function public.excel_imports_enforce_single_latest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb;
  v_current jsonb;
  v_current_created_at timestamptz;
  v_keys text[];
  v_missing text[];
  v_empty integer;
  v_dupes integer;
  v_bytes integer;
  v_wait_seconds integer;
begin
  v_new := new.records::jsonb;

  if v_new is null
     or jsonb_typeof(v_new) <> 'array'
     or jsonb_array_length(v_new) = 0 then
    raise exception 'SNAPSHOT_INVALID: lista de registros vazia ou inválida';
  end if;

  -- F11 (1) — teto de payload. Medido no texto canônico do jsonb, que tem o
  -- mesmo tamanho do JSON enviado pelo cliente (o jsonb só reordena as
  -- chaves, sem mudar o total de bytes).
  v_bytes := octet_length(v_new::text);
  if v_bytes > 6291456 then
    raise warning 'SNAPSHOT_TOO_LARGE: escrita recusada — % bytes (limite 6291456), arquivo %', v_bytes, new.file_name;
    raise exception 'SNAPSHOT_TOO_LARGE: % bytes excedem o limite de 6291456 bytes', v_bytes;
  end if;

  -- Serializa importações concorrentes: a segunda espera a primeira terminar
  -- e compara contra o snapshot já gravado.
  perform pg_advisory_xact_lock(hashtext('public.excel_imports.singleton')::bigint);

  select e.records::jsonb, e.created_at
    into v_current, v_current_created_at
  from public.excel_imports e
  order by e.created_at desc, e.id desc
  limit 1;

  -- F11 (2) — cooldown. O check fica DEPOIS do advisory lock: assim duas
  -- importações simultâneas não passam as duas pelo teste.
  if v_current_created_at is not null
     and now() - v_current_created_at < interval '30 seconds' then
    v_wait_seconds := ceil(extract(epoch from (v_current_created_at + interval '30 seconds' - now())))::integer;
    raise warning 'SNAPSHOT_COOLDOWN: escrita recusada — o snapshot vigente tem % s; aguarde % s', v_current_created_at, v_wait_seconds;
    raise exception 'SNAPSHOT_COOLDOWN: aguarde % s antes de gravar outro snapshot', greatest(v_wait_seconds, 1);
  end if;

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

revoke execute on function public.excel_imports_enforce_single_latest()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 — retenção do histórico: apenas as 5 últimas versões
-- ---------------------------------------------------------------------------
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

  -- F11 (3) — janela de retenção. O histórico continua append-only para o
  -- cliente (sem UPDATE/DELETE concedidos); quem poda é o dono, por dentro
  -- deste trigger. Sem esta janela, cada escrita duplicaria o snapshot
  -- (~2,4 MB) no histórico para sempre.
  delete from public.excel_imports_history
    where history_id not in (
      select history_id
      from public.excel_imports_history
      order by history_id desc
      limit 5
    );

  return old;
end;
$$;

revoke execute on function public.excel_imports_archive_history()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Índice do cooldown: a consulta do trigger lê o snapshot vigente ORDER BY
-- created_at desc, id desc. Com uma única linha na tabela o planner usa o
-- índice único; o índice abaixo deixa a intention explícita e o custo previsível.
-- ---------------------------------------------------------------------------
create index if not exists excel_imports_created_at_idx
  on public.excel_imports (created_at desc, id desc);
