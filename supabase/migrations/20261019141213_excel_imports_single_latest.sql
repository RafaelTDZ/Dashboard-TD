-- Mantém a tabela excel_imports com exatamente um snapshot: o último arquivo
-- aceito. O trigger compara a lista de `operacao` do snapshot atual com a do
-- novo arquivo e recusa a substituição quando algum processo antigo desapareceu.
-- Rode este SQL no SQL Editor do projeto usado pelo dashboard.

-- Limpeza única das versões acumuladas. A partir daqui o trigger cuida disso.
delete from public.excel_imports
where id <> (
  select id
  from public.excel_imports
  order by created_at desc, id desc
  limit 1
);

create or replace function public.excel_imports_enforce_single_latest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

  -- A nova linha ainda não existe (BEFORE INSERT): apagar todas as anteriores
  -- deixa a tabela com exatamente o snapshot que está entrando.
  delete from public.excel_imports;
  return new;
end;
$$;

drop trigger if exists excel_imports_single_latest on public.excel_imports;
create trigger excel_imports_single_latest
before insert on public.excel_imports
for each row execute function public.excel_imports_enforce_single_latest();
