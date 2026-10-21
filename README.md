# BI Integration Hub

Dashboard estático para visualização e importação de dados de processos de comércio exterior. O processamento dos arquivos (`!Importações.xlsx`) acontece no próprio navegador, sem build em runtime: os dados ficam em cache local e são sincronizados com o Supabase.

- **Produção**: https://tdz-db.vercel.app (deploy automático pela Vercel a partir deste repositório)
- **Local**: `node tools/serve.mjs 8765` → `http://127.0.0.1:8765/`
- **Testes**: `node --test`

## Executar localmente

O projeto não exige `npm install` nem build. Com Node.js 18+ instalado:

```powershell
node tools/serve.mjs 8765
```

Abra `http://127.0.0.1:8765/` no Chrome ou Edge. Sem conexão com a internet, o dashboard continua funcionando com os dados do cache local.

## CSS (Tailwind)

O Tailwind não roda no navegador. O CSS é compilado previamente e versionado em `assets/css/tailwind.css`, carregado antes de `assets/css/styles.css`. A configuração fica em `tailwind.config.cjs` e varre `index.html` **e** `assets/js/**/*.js` (as classes de badge/status só existem em strings do JavaScript).

Para regenerar depois de adicionar classes:

```powershell
npm run build:css
```

O script usa `npx --yes tailwindcss@3.4.16` (versão fixa) e `--minify`; não é necessário `npm install`. O CSS gerado deve ser commitado junto com a mudança que o exigiu. Como não há script inline nem `eval`, a CSP do `index.html` usa apenas `script-src 'self'` e `connect-src` restrito ao host do projeto Supabase.

## Persistência dos dados

- **Importação**: ao carregar um `.xlsx`, o dashboard compara a lista de `operacao` do arquivo novo com o snapshot mais recente do Supabase. O arquivo só substitui o anterior quando contém **todos** os processos já salvos (pode acrescentar novos e atualizar dados dos existentes). Se algum processo antigo desaparecer, a importação é bloqueada e o banco não é alterado.
- **Uma única versão**: a tabela `excel_imports` mantém exatamente um snapshot — o último arquivo aceito. O trigger `excel_imports_single_latest` valida a comparação e apaga as versões anteriores na mesma transação, e o índice único `excel_imports_singleton` garante a mesma invariante mesmo se o trigger for desabilitado. O `DELETE` do trigger leva `WHERE` de propósito: o projeto carrega a biblioteca `safeupdate`, que recusa qualquer `DELETE` sem cláusula `WHERE` — sem ela a importação pela nuvem é rejeitada. As migrations do Supabase estão espelhadas em `supabase/migrations/`: `20261009142126_create_excel_imports.sql` (tabela, RLS e grants), `20261019141213_excel_imports_single_latest.sql` (trigger e limpeza inicial), `20261020120000_harden_excel_imports.sql` (privilégios do papel `anon`, timestamps do servidor, invariante de linha única e `search_path` restrito) e `20261021120000_excel_imports_history.sql` (histórico append-only e rollback).
- **Interações** (filtros, busca, ordenação, estilo Claro/Escuro e alternância USD/QTD): alteram apenas o cache local — não geram novos envios à nuvem.
- **Restauração**: ao abrir ou recarregar a página, vence o snapshot mais recente entre a nuvem e o cache local; a ordenação usa o `created_at` do servidor, exposto como `meta.loadedAt` (o horário enviado pelo cliente fica apenas como diagnóstico). Os filtros salvos voltam como estavam.
- **Recusa do banco**: se o trigger recusar o arquivo (por exemplo, por uma importação concorrente), o snapshot novo não é gravado no IndexedDB e o snapshot anterior volta a ser exibido.
- **Parser antigo**: snapshots gerados por uma versão anterior do parser são preservados, e o dashboard recomenda uma nova importação.

A chave publishable embutida no cliente é pública e o papel `anon` tem apenas `SELECT` e `INSERT` sobre a tabela — `UPDATE`, `DELETE` e `TRUNCATE` são recusados pelo próprio banco (o `TRUNCATE` não passa pela RLS, por isso foi revogado junto com os demais). O `created_at` e o `updated_at` são gerados pelo servidor: o que o cliente envia é ignorado. A função do trigger é `SECURITY DEFINER`, roda como dono da tabela — é ela quem apaga o snapshot anterior — e não pode ser chamada pelo cliente.

## Segurança da escrita, histórico e rollback (F4)

**Decisão A (opção A) — escrita pública documentada.** A escrita continua pública: a chave publishable embutida no cliente permite que qualquer pessoa com acesso à página insira um snapshot em `excel_imports`. O trigger `excel_imports_single_latest` valida que a lista não está vazia, que cada registro tem `operacao`, que não há chaves duplicadas e que o arquivo é um superset dos processos já gravados. Ele **não valida os valores** dos registros: um cliente mal-intencionado (ou um arquivo errado) pode enviar um superset com valores alterados, campos trocados ou registros inventados. Esse é o **risco residual** aceito nesta decisão. A leitura também é pública.

**Histórico append-only.** A tabela `public.excel_imports_history` guarda uma linha por snapshot substituído, com os campos originais (`import_id`, `file_name`, `sheet_name`, `records`, `metadata`, `created_at`, `updated_at`) e `archived_at` (o momento em que foi arquivado). Ela não é exposta ao cliente: tem RLS habilitada e nenhum privilégio para `anon`/`authenticated`; o dono acessa pelo SQL Editor. O histórico começa a valer a partir da aplicação da migration `20261021120000_excel_imports_history.sql` — o snapshot que já estava no banco não é copiado.

Listar o histórico:

```sql
select history_id, file_name, created_at, archived_at,
       jsonb_array_length(records) as processos
from public.excel_imports_history
order by history_id desc;
```

Restaurar um snapshot (SQL Editor, como owner):

```sql
select public.excel_imports_rollback(123);
```

O rollback desabilita o trigger de superset **apenas na transação atual** (se a função falhar, a transação é desfeita e o trigger volta a ficar ativo), apaga o snapshot vigente — que o trigger de arquivo copia para o histórico — e insere de volta a linha escolhida como um **novo evento de snapshot**: `created_at` e `updated_at` recebem `now()` do servidor, para que o snapshot restaurado vença qualquer cache local anterior. Os timestamps originais continuam preservados na linha do histórico. Por isso, o snapshot que estava valendo também é arquivado e o rollback pode ser desfeito por outro rollback. O `ALTER TABLE ... DISABLE TRIGGER` bloqueia a tabela por um instante; execute o rollback em uma janela de manutenção.

Procedimento manual de emergência, caso a função não esteja disponível:

```sql
begin;
alter table public.excel_imports disable trigger excel_imports_single_latest;
delete from public.excel_imports where id in (select id from public.excel_imports);
insert into public.excel_imports (id, file_name, sheet_name, records, metadata, created_at, updated_at)
select import_id, file_name, sheet_name, records, metadata, now(), now()
from public.excel_imports_history where history_id = <id>;
alter table public.excel_imports enable trigger excel_imports_single_latest;
commit;
```

Confirme o `history_id` antes de executar: no procedimento manual, se ele não existir, o `INSERT ... SELECT` não restaura nenhuma linha e a tabela fica vazia (a função `excel_imports_rollback` recusa o id inexistente com `HISTORY_NOT_FOUND`).

Se o dataset virar sensível ou o risco de tampering deixar de ser aceitável, migrar para a opção B (Supabase Auth + RLS para `authenticated`) ou C (Edge Function com service role e allowlist). Rate limit e monitoramento não estão implementados.

## Publicação (Vercel)

O site em produção é publicado pela Vercel a partir deste repositório no GitHub: qualquer push para a branch `main` dispara um novo deploy automático (site estático, sem build manual). Depois do deploy, quem estiver com a página aberta precisa recarregar para pegar a versão nova.

## Verificar

```powershell
node --test
```

Os testes cobrem regras de status, datas, números e moedas (incluindo células Excel formatadas em CNY), importação XLSX e aba `Comments`, validação e normalização de snapshots e filtros, comparação por `operacao` (superset, processos removidos, atualizações e chaves duplicadas), bloqueio de arquivo incompleto, recusa do trigger sem contaminar o cache local, persistência (envio apenas na importação, cache local das interações, restauração "mais recente vence" e respostas do Supabase sem corpo), histórico append-only e rollback, sintaxe dos scripts, referências locais e acessibilidade estrutural.

Também é possível verificar individualmente os scripts:

```powershell
Get-ChildItem assets/js -Filter *.js | ForEach-Object { node --check $_.FullName }
```

## Smoke test manual

1. Confirme o estado inicial vazio (banner "Nenhum arquivo carregado"), os seis KPIs zerados e o filtro global de ano em "Todos os anos".
2. Alterne entre Dashboard Visual, Tabela de Dados e Código de Integração usando mouse e teclado; escolha um ano no filtro global e confirme que KPIs, gráficos, tabela, paginação e CSV mudam juntos. Na evolução mensal, confira a regra ETA > ETS (sem ambas, o processo não entra na série), a média dos últimos 12 meses até o mês atual e os cards de quantidade por agente e por sigla da operação, sem duplicidade de grafias (ex.: Maersk/MAERSK, Ningbo/NINGBO). Alterne também Claro/Escuro e USD/QTD.
3. Teste filtros (no filtro de mês, abra o menu e marque vários meses nas caixinhas; o item "Todos os Meses" alterna entre acender e apagar todas de uma vez e, com nenhum mês marcado, o dashboard fica vazio — KPIs, gráficos, tabela e CSV acompanham juntos), busca, ordenação (inclusive Reg DI em ordem cronológica), paginação e exportação CSV.
4. Importe um `.xlsx` com cabeçalho deslocado e confirme o relatório de mapeamento.
5. Importe `data/Importaes-63cc10.xlsx` e confirme: 1.898 processos, 0 linhas ignoradas e 3 comentários da aba `Comments`. O filtro global de ano volta no ano corrente (2026), e a evolução mensal — regra ETA > ETS — soma só esse ano (Outubro = 67); escolha "Todos os anos" para ver a série completa (Outubro = 186, com 119 de 2025 + 67 de 2026). Os 11 registros sem ETA/ETS ficam fora da série. Em `Valor / Moeda`, os 25 registros em CNY permanecem identificados e fora dos totais em USD; o CSV exportado separa `Valor informado`, `Moeda` e `Valor USD`.
6. Importe uma planilha que não contenha um dos processos já carregados e confirme: o modal "Importação bloqueada" lista o processo ausente, nada é enviado ao Supabase e o dashboard continua com o snapshot anterior.
7. Recarregue a página e confirme a restauração do último dataset (o mais recente entre nuvem e cache local) e que a tabela `excel_imports` tem apenas uma linha.
8. Mude filtros e estilo, recarregue de novo e confirme que voltam como estavam (persistência local; a nuvem só recebe snapshots em importações).
9. Abra e feche o relatório pelo teclado; o foco deve retornar ao botão de origem.
10. Verifique o console do navegador para erros após cada fluxo (fora da Vercel, o 404 de `/_vercel/insights/script.js` é esperado).

## Estrutura

- `index.html` — página única com as abas Dashboard Visual, Tabela de Dados e Código de Integração.
- `assets/js/` — `etl.js` (parsing e mapeamento), `state.js` (snapshots e filtros), `normalize.js`, `filters.js`, `view.js`, `snapshot.js`, `table.js`, `banner.js`, `persistence.js`, `import.js`, `app.js` (composition root), `charts.js`, `ui.js`, `worker.js` (parsing em Web Worker), `supabase.js` (cliente da nuvem) e `analytics.js`.
- `tools/serve.mjs` — servidor estático local.
- `supabase/migrations/` — SQL das migrations (snapshot único, endurecimento, histórico append-only e rollback), incluindo `20261021120000_excel_imports_history.sql`.
- `tests/` — suíte `node --test`.
- `data/` — planilha de referência do smoke test.
- `vendor/` — bibliotecas offline (SheetJS/XLSX, Chart.js, Font Awesome e Vercel Analytics).

## Dependências offline

As bibliotecas de runtime ficam em `vendor/`; os hashes e as referências de origem registradas durante a revisão estão em `vendor/manifest.json`. O `package.json` e o `pnpm-lock.yaml` existem para o ambiente da Vercel/v0 (ex.: `@vercel/analytics`); o dashboard não precisa de `npm install` para rodar. O único artefato gerado é `assets/css/tailwind.css`, versionado no repositório.
