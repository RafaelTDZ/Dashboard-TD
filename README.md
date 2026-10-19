# BI Integration Hub

Dashboard estático para visualização e importação de dados de processos de comércio exterior. O processamento dos arquivos (`!Importações.xlsx`) acontece no próprio navegador, sem etapa de build: os dados ficam em cache local e são sincronizados com o Supabase.

- **Produção**: https://tdz-db.vercel.app (deploy automático pela Vercel a partir deste repositório)
- **Local**: `node tools/serve.mjs 8765` → `http://127.0.0.1:8765/`
- **Testes**: `node --test`

## Executar localmente

O projeto não exige `npm install` nem build. Com Node.js 18+ instalado:

```powershell
node tools/serve.mjs 8765
```

Abra `http://127.0.0.1:8765/` no Chrome ou Edge. Sem conexão com a internet, o dashboard continua funcionando com os dados do cache local.

## Persistência dos dados

- **Importação**: ao carregar um `.xlsx`, o dashboard compara a lista de `operacao` do arquivo novo com o snapshot mais recente do Supabase. O arquivo só substitui o anterior quando contém **todos** os processos já salvos (pode acrescentar novos e atualizar dados dos existentes). Se algum processo antigo desaparecer, a importação é bloqueada e o banco não é alterado.
- **Uma única versão**: a tabela `excel_imports` mantém exatamente um snapshot — o último arquivo aceito. O trigger `excel_imports_single_latest` valida a comparação e apaga as versões anteriores na mesma transação. A migration está em `supabase/migrations/20261019120000_excel_imports_single_latest.sql` e deve ser aplicada uma vez no SQL Editor do projeto Supabase do dashboard (ela também limpa as versões já acumuladas).
- **Interações** (filtros, busca, ordenação, estilo Claro/Escuro e alternância USD/QTD): alteram apenas o cache local — não geram novos envios à nuvem.
- **Restauração**: ao abrir ou recarregar a página, vence o snapshot mais recente (`meta.loadedAt`) entre a nuvem e o cache local, e os filtros salvos voltam como estavam.
- **Recusa do banco**: se o trigger recusar o arquivo (por exemplo, por uma importação concorrente), o snapshot novo não é gravado no IndexedDB e o snapshot anterior volta a ser exibido.
- **Parser antigo**: snapshots gerados por uma versão anterior do parser são preservados, e o dashboard recomenda uma nova importação.

A chave publishable embutida no cliente é pública e permite apenas ler e inserir (SELECT/INSERT); atualizações e exclusões continuam bloqueadas pela RLS. O trigger é `SECURITY DEFINER` e roda como dono da tabela, sem liberar DELETE para o cliente.

## Publicação (Vercel)

O site em produção é publicado pela Vercel a partir deste repositório no GitHub: qualquer push para a branch `main` dispara um novo deploy automático (site estático, sem build manual). Depois do deploy, quem estiver com a página aberta precisa recarregar para pegar a versão nova.

## Verificar

```powershell
node --test
```

Os testes cobrem regras de status, datas, números e moedas (incluindo células Excel formatadas em CNY), importação XLSX e aba `Comments`, validação e normalização de snapshots e filtros, comparação por `operacao` (superset, processos removidos, atualizações e chaves duplicadas), bloqueio de arquivo incompleto, recusa do trigger sem contaminar o cache local, persistência (envio apenas na importação, cache local das interações, restauração "mais recente vence" e respostas do Supabase sem corpo), sintaxe dos scripts, referências locais e acessibilidade estrutural.

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
10. Verifique o console do navegador para erros após cada fluxo (o aviso do Tailwind Play CDN é esperado; fora da Vercel, o 404 de `/_vercel/insights/script.js` também).

## Estrutura

- `index.html` — página única com as abas Dashboard Visual, Tabela de Dados e Código de Integração.
- `assets/js/` — `etl.js` (parsing e mapeamento), `state.js` (snapshots e filtros), `app.js` (orquestração e UI), `charts.js`, `ui.js`, `worker.js` (parsing em Web Worker), `supabase.js` (cliente da nuvem) e `analytics.js`.
- `tools/serve.mjs` — servidor estático local.
- `supabase/migrations/` — SQL do trigger que mantém apenas o último snapshot.
- `tests/` — suíte `node --test`.
- `data/` — planilha de referência do smoke test.
- `vendor/` — bibliotecas offline (SheetJS/XLSX, Chart.js, Tailwind, Font Awesome e Vercel Analytics).

## Dependências offline

As bibliotecas de runtime ficam em `vendor/`; os hashes e as referências de origem registradas durante a revisão estão em `vendor/manifest.json`. O `package.json` e o `pnpm-lock.yaml` existem para o ambiente da Vercel/v0 (ex.: `@vercel/analytics`); o dashboard não precisa de `npm install` para rodar.
