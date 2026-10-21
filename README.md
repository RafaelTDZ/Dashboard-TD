# BI Integration Hub

Dashboard estático para visualização e importação de dados de processos de comércio exterior. O processamento dos arquivos (`!Importações.xlsx`) acontece no próprio navegador, sem build em runtime: os dados ficam em cache local e são sincronizados com o Supabase.

- **Produção**: https://tdz-db.vercel.app (deploy automático pela Vercel a partir deste repositório)
- **Local**: `node tools/serve.mjs 8765` → `http://127.0.0.1:8765/`
- **Testes**: `node --test` (137 testes; também no CI, em Linux e Windows)
- **Documento de análise**: [`ANALISE.md`](ANALISE.md) — o que foi corrigido, as medições e as decisões de arquitetura

## Executar localmente

O projeto não exige `npm install` nem build. Com Node.js 18+ instalado:

```powershell
node tools/serve.mjs 8765
```

Abra `http://127.0.0.1:8765/` no Chrome ou Edge. Sem conexão com a internet, o dashboard continua funcionando com os dados do cache local.

## O que fica visível na tela

- **Cabeçalho (sempre visível)**: `#dataset-summary` mostra `arquivo · X de Y processos` — por exemplo `!Importações (61).xlsx · 861 de 1.944 processos`. É a informação que sobrevive ao card de status e ao recarregamento da página.
- **Card de status (transitório)**: ao carregar um arquivo, o card `#status-banner` mostra o nome, a guia, o total de processos e os avisos da importação, e some sozinho depois de 8 s (300 ms de fade). Sem nenhum arquivo carregado, ele fica visível com a instrução de como importar. Um erro fatal de inicialização trava o card, para que um `refresh()` posterior não apague a mensagem.
- **KPI de processos**: o número grande é o total **filtrado**; a legenda embaixo mostra o total do dataset e o filtro ativo (`861 de 1.944 · filtro 2026`).
- **Tabela de dados**: a contagem é `Exibindo 1–50 de 861 filtrados (1.944 no total)` — nunca “X de Y de Z”, que era ambíguo.
- **Estado vazio**: sem dataset, os seis KPIs ficam zerados, o filtro global de ano volta para "Todos os anos" e o card de status continua visível.

## CSS (Tailwind)

O Tailwind não roda no navegador. O CSS é compilado previamente e versionado em `assets/css/tailwind.css` (19,4 KB minificado), carregado antes de `assets/css/styles.css`. A configuração fica em `tailwind.config.cjs` e varre `index.html` **e** `assets/js/**/*.js` (as classes de badge/status só existem em strings do JavaScript).

Para regenerar depois de adicionar classes:

```powershell
npm run build:css
```

O script usa `npx --yes tailwindcss@3.4.16` (versão fixa) e `--minify`; não é necessário `npm install`. O CSS gerado deve ser commitado junto com a mudança que o exigiu. Como não há script inline nem `eval`, a CSP do `index.html` usa apenas `script-src 'self'` e `connect-src` restrito ao host do projeto Supabase.

O Play CDN (`vendor/tailwind.js`, 440 KB, que compilava o Tailwind em runtime) foi removido: ele avisava no console que não deve ser usado em produção e obrigava a CSP a permitir `'unsafe-inline'` e `'unsafe-eval'`. Hoje a CSP é `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `font-src 'self' data:`, `img-src 'self' data:`, `connect-src 'self' https://bsczvemaqvladupmdpgl.supabase.co`, `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'` e `form-action 'self'`.

> As classes que o `styles.css` sobrescreve continuam usando seletores `[class~="..."]`. As classes correspondentes estão no CSS compilado, mas **nova classe dinâmica exige regenerar** o `tailwind.css`.

## Arquitetura do código

SPA estática, sem build e sem empacotador: cada módulo é uma IIFE que publica um global, e o `index.html` carrega os scripts nessa ordem:

```text
etl.js → ui.js → charts.js → state.js → supabase.js → normalize.js →
filters.js → view.js → snapshot.js → table.js → banner.js →
persistence.js → import.js → app.js
```

- `app.js` é o **composition root** (369 linhas): monta o estado, resolve os elementos do DOM, liga os eventos e injeta as dependências nos módulos. A ordem dos scripts é um contrato — cada módulo assume que os globals anteriores já existem.
- Módulos extraídos do antigo `app.js` monolítico: `normalize.js` (índice de busca, cópia enxuta, referência mensal), `filters.js` (filtros, busca e ordenação), `view.js` (estilo, abas e KPIs), `snapshot.js` (apresentação do snapshot restaurado), `table.js` (tabela, paginação e CSV), `banner.js` (card de status e KPIs), `persistence.js` (Supabase + IndexedDB) e `import.js` (upload, parse, comparação e relatório).
- **Regra de valor vazio com uma única fonte**: `DashboardState.isEmptyValue` define o que é "vazio" (`null`, `''`, `undefined` e arrays vazios). A mesma função decide o que é gravado no banco (`normalize.toPersistedRecord`) e o que conta como mudança na comparação de snapshots (`state.recordFingerprint`) — assim as duas não podem divergir.
- A importação roda o parse do Excel em um **Web Worker** (`worker.js`), com fallback para a thread principal; o fallback só roda depois que a interface teve a chance de pintar o aviso e apenas uma vez.

## Persistência dos dados

- **Importação**: ao carregar um `.xlsx`, o dashboard compara a lista de `operacao` do arquivo novo com o snapshot mais recente do Supabase. O arquivo só substitui o anterior quando contém **todos** os processos já salvos (pode acrescentar novos e atualizar dados dos existentes). Se algum processo antigo desaparecer, a importação é bloqueada e o banco não é alterado.
- **O que é gravado**: o que vai para o banco é a **cópia enxuta** dos registros — sem o índice de busca derivado (`_search`) e sem campos vazios (`null`, `''` e arrays vazios). Os dados em memória continuam completos, porque o `_search` é recalculado ao restaurar. É essa cópia que ocupa espaço (e que o limite de 6 MB mede).
- **Uma única versão**: a tabela `excel_imports` mantém exatamente um snapshot — o último arquivo aceito. O trigger `excel_imports_single_latest` valida a comparação e apaga as versões anteriores na mesma transação, e o índice único `excel_imports_singleton` garante a mesma invariante mesmo se o trigger for desabilitado. O `DELETE` do trigger leva `WHERE` de propósito: o projeto carrega a biblioteca `safeupdate`, que recusa qualquer `DELETE` sem cláusula `WHERE` — sem ela a importação pela nuvem é rejeitada. As migrations do Supabase estão espelhadas em `supabase/migrations/`: `20261009142126_create_excel_imports.sql` (tabela, RLS e grants), `20261019141213_excel_imports_single_latest.sql` (trigger e limpeza inicial), `20261020120000_harden_excel_imports.sql` (privilégios do papel `anon`, timestamps do servidor, invariante de linha única e `search_path` restrito) e `20261021120000_excel_imports_history.sql` (histórico append-only e rollback).
- **Interações** (filtros, busca, ordenação, estilo Claro/Escuro e alternância USD/QTD): alteram apenas o cache local — não geram novos envios à nuvem.
- **Restauração local-first**: ao abrir ou recarregar a página, o snapshot do **IndexedDB** é pintado primeiro (a tela aparece sem esperar a rede) e o Supabase reconcilia em segundo plano; vence o mais recente entre os dois, com a ordenação pelo `created_at` do servidor, exposto como `meta.loadedAt` (o horário enviado pelo cliente fica apenas como diagnóstico). Os filtros salvos voltam como estavam. As chamadas ao Supabase têm timeout de 15 s (`AbortController`): uma rede instável não deixa a tela presa esperando.
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

## Limite de escala do snapshot (F6)

O banco guarda o dataset inteiro em **uma** linha JSONB e cada importação reenvia o array. Medido em 21/10/2026 (dataset de referência: 1.944 registros, 2,4 MB):

| Escala | Registros | Payload | Gravação no banco | 4G (10 Mbit/s) |
|---|---:|---:|---:|---:|
| 1× | 1.944 | 2,4 MB | 0,17 s | 2,0 s |
| 2× | 3.894 | 4,9 MB | 0,43 s | 3,9 s |
| 5× | 9.744 | 12,5 MB | 1,02 s | 9,7 s |
| 10× | 19.444 | 25,1 MB | 2,22 s | 19,4 s |

O banco aguenta (o `statement_timeout` do papel `anon` é de 3 s); o **transporte** não. Por isso a importação recusa, **antes de qualquer escrita**, um arquivo cujo payload passe de **6 MB** (`DashboardImport.MAX_SNAPSHOT_BYTES`): nada muda na tela, nada é enviado ao Supabase e o usuário recebe o modal "Arquivo grande demais" com a orientação de importar a planilha em partes menores. O limite é ~2,5× o dataset atual (≈ 4.800 registros).

Medições reproduzíveis:

```powershell
node tools/loadtest.mjs            # lado do cliente, sem rede (1x/2x/5x/10x)
node tools/loadtest.mjs --json     # mesmo resultado em JSON
```

`tools/loadtest.sql` mede o lado do banco (custo do INSERT com os triggers) **sempre revertido**: a gravação é feita dentro de um sub-transaction e terminada com `raise exception 'FORCE_ROLLBACK'`, de modo que nem a linha nova, nem o arquivo no histórico, nem o `DELETE` da linha anterior sobrevivem. Rode-o no SQL Editor do Supabase e confira depois que o snapshot de produção continua intacto.

Se o volume passar de 6 MB, a decisão de arquitetura precisa ser reaberta: o caminho natural é a opção **D (híbrido)** — o snapshot como backup/rollback e uma tabela normalizada por `operacao` para consulta, o que tira o dataset inteiro do caminho crítico.

## Publicação (Vercel)

O site em produção é publicado pela Vercel a partir deste repositório no GitHub: qualquer push para a branch `main` dispara um novo deploy automático (site estático, sem build manual). Depois do deploy, quem estiver com a página aberta precisa recarregar para pegar a versão nova.

## Higiene do repositório

- **Fim de linha**: o `.gitattributes` normaliza tudo para **LF** no repositório. Sem isso, a suíte falhava no Windows (os testes de SQL comparavam arquivos com CRLF) — o checkout local pode exibir CRLF, mas o que está versionado é LF.
- **`.gitignore`** cobre `node_modules/`, `.vercel/`, `.agents/`, `*.log` e o resto dos artefatos locais. O `.agents/` (skill do Supabase via MCP) fica **fora** do versionamento por decisão registrada.
- **CI**: `.github/workflows/test.yml` roda `node --test` em **Linux e Windows** a cada push e pull request. Não há ESLint, Prettier nem type check no projeto.
- **Sem build no deploy**: o único artefato gerado é `assets/css/tailwind.css`, versionado no repositório e regenerado sob demanda com `npm run build:css`.
- **Documento único**: o `ANALISE.md` reúne a análise estrutural, a auditoria dos 34 itens originais, as decisões (D1–D5) e o registro de execução. O README é o documento operacional; o `ANALISE.md` é o histórico com as medições e as justificativas.

## Acessibilidade

- O card de status é uma região ao vivo (`aria-live="polite"`), mas o texto não é reescrito a cada tecla digitada — a reader de tela não repete a leitura.
- O menu de meses tem `role="group"`, `aria-haspopup`, `aria-controls` e `aria-expanded`; o seletor de ano tem **um** rótulo só (evita leitura duplicada).
- A navegação por abas funciona pelo teclado (setas, `Home`, `End`), com guarda para o caso de nenhuma aba estar selecionada.
- O modal prende o `Tab` dentro dele, foca o botão de fechar ao abrir e **devolve o foco** ao elemento de origem ao fechar.

## Verificar

```powershell
node --test
```

A mesma suíte roda em Linux e Windows no GitHub Actions (`.github/workflows/test.yml`).

Os testes cobrem regras de status, datas, números e moedas (incluindo células Excel formatadas em CNY), importação XLSX e aba `Comments`, validação e normalização de snapshots e filtros, comparação por `operacao` (superset, processos removidos, atualizações, chaves duplicadas e campo novo do parser), bloqueio de arquivo incompleto, recusa do trigger sem contaminar o cache local, persistência (envio apenas na importação, cache local das interações, restauração "mais recente vence" e respostas do Supabase sem corpo), histórico append-only e rollback, orçamento absoluto de bytes do payload persistido, escape de HTML em cada sink de tela (tabela, banner, selects, toast e modal), fallback do Worker de importação (parse único, adiado e só depois do aviso na tela), limite de escala da importação (payload acima de 6 MB é recusado antes de qualquer escrita) e reprodução do teste de carga, sintaxe dos scripts, referências locais e acessibilidade estrutural.

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
8. Espere o card de status sumir (8 s) e confirme que o **cabeçalho** continua mostrando `arquivo · X de Y processos` e que a legenda do KPI mostra `X de Y · filtro 2026`.
9. Mude filtros e estilo, recarregue de novo e confirme que voltam como estavam (persistência local; a nuvem só recebe snapshots em importações).
10. Abra e feche o relatório pelo teclado; o foco deve retornar ao botão de origem.
11. Tente importar um arquivo que gere mais de 6 MB de payload e confirme o modal "Arquivo grande demais": nada muda na tela e nada é enviado ao Supabase.
12. Verifique o console do navegador para erros após cada fluxo (fora da Vercel, o 404 de `/_vercel/insights/script.js` é esperado).

## Estrutura

- `index.html` — página única com as abas Dashboard Visual, Tabela de Dados e Código de Integração (CSP e ordem de carga dos scripts).
- `assets/js/` — `etl.js` (parsing e mapeamento), `state.js` (snapshots e filtros), `normalize.js`, `filters.js`, `view.js`, `snapshot.js`, `table.js`, `banner.js`, `persistence.js`, `import.js`, `app.js` (composition root), `charts.js`, `ui.js`, `worker.js` (parsing em Web Worker), `supabase.js` (cliente da nuvem) e `analytics.js`.
- `assets/css/` — `styles.css` (tema e componentes) e `tailwind.css` (Tailwind compilado, versionado).
- `tools/serve.mjs` — servidor estático local.
- `tools/loadtest.mjs` / `tools/loadtest.sql` — teste de carga (cliente e banco) do limite de escala.
- `supabase/migrations/` — SQL das migrations (snapshot único, endurecimento, histórico append-only e rollback), incluindo `20261021120000_excel_imports_history.sql`.
- `tests/` — suíte `node --test` (14 arquivos, 137 testes).
- `.github/workflows/test.yml` — CI da suíte em Linux e Windows.
- `.gitattributes` — normalização de fim de linha (LF) e regras de diff.
- `.gitignore` — dependências locais, metadados de deploy e ferramentas de agentes.
- `data/` — planilha de referência do smoke test.
- `vendor/` — bibliotecas offline (SheetJS/XLSX, Chart.js, Font Awesome, Plus Jakarta Sans v12 e Vercel Analytics).
- `ANALISE.md` — análise estrutural, auditoria dos 34 itens originais, decisões e registro de execução.

## Dependências offline

As bibliotecas de runtime ficam em `vendor/`; os hashes e as referências de origem registradas durante a revisão estão em `vendor/manifest.json`. O `package.json` e o `pnpm-lock.yaml` existem para o ambiente da Vercel/v0 (ex.: `@vercel/analytics`); o dashboard não precisa de `npm install` para rodar. O único artefato gerado é `assets/css/tailwind.css`, versionado no repositório.
