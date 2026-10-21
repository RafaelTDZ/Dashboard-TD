-- F6 — harness de carga do lado do banco (sempre reverte).
--
-- Mede o custo de gravar um snapshot no tamanho de 1x/2x/5x/10x do dataset de
-- referência, pelo MESMO caminho de produção: o POST em public.excel_imports
-- dispara o trigger de superset (valida chaves, duplicadas e superset), apaga
-- a linha anterior e arquiva o snapshot substituído em
-- public.excel_imports_history.
--
-- SEGURANÇA: a transação é revertida. A medição é feita dentro de um
-- sub-transaction (bloco BEGIN/EXCEPTION do PL/pgSQL) e o INSERT é
-- terminado com `raise exception 'FORCE_ROLLBACK'`, que desfaz TUDO: a linha
-- nova, o arquivo no histórico e o DELETE da linha anterior. A sequência do
-- histórico avança (gap normal), nada mais muda.
--
-- Como rodar: no SQL Editor do Supabase (ou por psql), troque {extra} pelo
-- número de cópias sintéticas. Cada execução é independente e o resultado
-- volta na última consulta.
--
-- Resultado medido em 21/10/2026 (dataset de 1.944 registros, 2.440.283 bytes):
--
--   escala | registros | bytes (JSON) | INSERT (ms)
--   1x     |   1.944   |   2.440.283  |   165,6
--   2x     |   3.894   |   4.963.796  |   434,9
--   5x     |   9.744   |  12.538.535  | 1.018,0
--   10x    |  19.444   |  25.103.333  | 2.221,1
--
-- O `statement_timeout` do papel `anon` é de 3 s: o INSERT de 10x (2,2 s) ainda
-- cabe, mas com 26% de folga. Acima de ~13x o banco passaria a recusar a
-- escrita — e é por isso que o cliente recusa payload acima de 6 MB (ver
-- assets/js/import.js).

-- ---------------------------------------------------------------------------
-- Exemplo: 5x  →  {extra} = 156 (50 registros-base x 156 = 7.800 sintéticos
-- + 1.944 reais ≈ 9.744).
-- ---------------------------------------------------------------------------

create temp table load_measure (
  label text,
  n int,
  bytes_text int,
  insert_ms double precision,
  err text
);

do $$
declare
  t0 timestamptz;
  v_err text;
  v_n int;
  v_bytes int;
begin
  t0 := clock_timestamp();
  begin
    insert into public.excel_imports (id, file_name, sheet_name, records, metadata, created_at, updated_at)
    select gen_random_uuid(), 'carga-sintetica.xlsx', '!Importacoes', jsonb_agg(elem), '{}'::jsonb, now(), now()
    from (
      -- os registros reais: o trigger de superset exige que eles continuem no arquivo
      select jsonb_array_elements(records) as elem from public.excel_imports
      union all
      -- cópias sintéticas com Operação diferente (gera o volume extra)
      select base.elem || jsonb_build_object('operacao', base.elem->>'operacao' || '-' || g)
      from (select jsonb_array_elements(records) elem from public.excel_imports limit 50) base,
           generate_series(1, {extra}) g
    ) s;
    select jsonb_array_length(records), length(records::text)
      into v_n, v_bytes
      from public.excel_imports;
    -- desfaz a gravação (sub-transaction): nada fica no banco
    raise exception 'FORCE_ROLLBACK';
  exception when others then
    v_err := sqlerrm;
  end;
  insert into load_measure values ('{label}', v_n, v_bytes,
    extract(epoch from (clock_timestamp() - t0)) * 1000, v_err);
end $$;

select * from load_measure;

-- ---------------------------------------------------------------------------
-- Conferência depois da medição (o snapshot de produção deve estar intacto):
--   select count(*) as linhas,
--          max(jsonb_array_length(records)) as registros,
--          (select count(*) from public.excel_imports_history) as historico
--     from public.excel_imports;
-- ---------------------------------------------------------------------------
