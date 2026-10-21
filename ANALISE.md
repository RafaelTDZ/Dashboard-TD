# Análise e plano de correções — Dashboard TD

> Documento único de análise e acompanhamento das correções. Consolidado em
> **21/10/2026** a partir da análise estrutural e da auditoria dos 34 itens da
> versão anterior deste arquivo. O rascunho intermediário foi incorporado e removido.
>
> - **Commit analisado:** `f185f84` (`Card de status volta a ser unico e transitorio com arquivo`)
> - **Nenhum arquivo de aplicação foi alterado durante a análise.**
> - **Testes neste checkout Windows:** `104` testes, `101` passando, `3` falhando.
>   As três falhas são artefatos de CRLF, não de lógica (detalhes em **F1**).
> - **Auditoria read-only do Supabase feita em 21/10/2026:** privilégios, ACL de função, `search_path`, índices, triggers, contagem e timestamps. Nenhum dado foi alterado.
> - **Não foi feito** teste de carga nem inspeção visual no navegador.

---

## Como usar este documento

- Cada achado tem um **ID estável** (`F1`…`F10`), usado em commits, branches e PRs.
- Marque `[ ]` → `[~]` (em andamento) → `[x]` (concluído).
- Cada item tem **evidência**, **impacto**, **correção sugerida** e **critérios de aceite**.
- Itens com **⚠️ Decisão de produto** precisam de confirmação antes da implementação.
- O bloco **🔒 Preservar** lista o que já está correto e não deve ser “corrigido” por engano.
- O **Registro de execução** no fim deve ser preenchido a cada lote concluído.

**Legenda de prioridade**

| | Significado |
|---|---|
| 🔴 **P0** | Bloqueia confiança na suíte ou uma garantia importante do produto |
| 🟠 **P1** | Risco operacional, de integridade ou de manutenção relevante |
| 🟡 **P2** | Higiene, performance e evolução de médio prazo |

---

## Painel de progresso

| ID | Prioridade | Achado | Status |
|---|---|---|---|
| F1 | 🔴 P0 | Suíte não é portável entre sistemas (CRLF) | `[x]` |
| F2 | 🔴 P0 | “Mais recente vence” ainda usa timestamp do cliente | `[x]` |
| F3 | 🟠 P1 | Sem timeout de rede e restauração bloqueante | `[x]` |
| F4 | 🟠 P1 | Escrita pública sem autenticação e sem histórico | `[x]` |
| F5 | 🟠 P1 | `app.js` monolítico e acoplamento por globals | `[x]` |
| F6 | 🟠 P1 | Snapshot inteiro e limite de escala | `[ ]` |
| F7 | 🟡 P2 | Tailwind em runtime e CSP permissiva | `[x]` |
| F8 | 🟡 P2 | Higiene de engenharia e documentação | `[x]` |
| F9 | 🟠 P1 | Resumo do dataset e total não persistem no Dashboard | `[x]` |
| F10 | 🟡 P2 | Cobertura de testes não comprova T3/T4/M5/B6 | `[x]` |

> F9 e F10 vieram da auditoria dos 34 itens originais (21/10/2026); F1–F8 são da análise estrutural.

**Ordem sugerida:** F1 → F2 → F9 → F3 → F5 (incremental) → decisão F4 → F7 → F8 → F10 → F6.

---

## 1. Visão geral

O projeto é um **SPA estático, sem build**, com três abas:

- **Dashboard Visual** — KPIs, 7 gráficos e filtros.
- **Tabela de Dados** — busca, ordenação, paginação e exportação CSV.
- **Código de Integração** — exemplos de ETL em Python e Power Query.

O processamento do Excel acontece no navegador. A persistência é híbrida:

- **Supabase** — fonte compartilhada, com um único snapshot do dataset.
- **IndexedDB** — cache offline por navegador, incluindo filtros, busca, tema e modo USD/QTD.

O deploy é feito pela Vercel a partir da branch `main`, sem etapa de build.

### Números do projeto

| Item | Valor |
|---|---:|
| JS de aplicação | ~4.250 linhas (16 arquivos) |
| `app.js` | 369 linhas (composition root) |
| `etl.js` | 786 linhas |
| `charts.js` | 724 linhas |
| `import.js` | 390 linhas |
| `persistence.js` | 344 linhas |
| `filters.js` | 333 linhas |
| `state.js` | 225 linhas |
| `ui.js` | 218 linhas |
| `normalize.js` | 188 linhas |
| `banner.js` | 186 linhas |
| `table.js` | 183 linhas |
| `supabase.js` | 127 linhas |
| `view.js` | 98 linhas |
| `snapshot.js` | 82 linhas |
| `analytics.js` + `worker.js` | 63 linhas |
| CSS | 1.075 linhas (`styles.css`) + Tailwind compilado (19,4 KB) |
| HTML | 531 linhas |
| Testes | 131 em 13 arquivos |
| Migrações SQL | 4 |
| Vendor | 2,66 MB no total |
| Dataset de referência | ~1,9 mil registros |
| Snapshot remoto | ~2,2 MB após o trim (número registrado na auditoria original) |

---

## 2. Estrutura de diretórios

```text
Dashboard TD/
├─ index.html                  # shell da SPA, 3 abas, CSP, ordem de carga dos scripts
├─ assets/
│  ├─ css/styles.css           # tema, componentes, overrides (1.075 linhas)
│  ├─ css/tailwind.css         # Tailwind 3.4.16 compilado e versionado (19,4 KB)
│  └─ js/
│     ├─ etl.js                # parsing, mapeamento e canonicalização (786 linhas)
│     ├─ state.js              # filtros, snapshots e compareRecords (225 linhas)
│     ├─ ui.js                 # escapeHtml, formatadores, toast, modal (218 linhas)
│     ├─ charts.js             # 7 gráficos Chart.js (724 linhas)
│     ├─ supabase.js           # cliente REST SELECT/INSERT (127 linhas)
│     ├─ normalize.js          # índice de busca, cópia enxuta, referência mensal (188 linhas)
│     ├─ filters.js            # filtros, busca e ordenação (333 linhas)
│     ├─ view.js               # KPIs e visões agregadas (98 linhas)
│     ├─ snapshot.js           # apresentação do snapshot restaurado (82 linhas)
│     ├─ table.js              # tabela, paginação e CSV (183 linhas)
│     ├─ banner.js             # card de status e KPIs (186 linhas)
│     ├─ persistence.js        # Supabase + IndexedDB (344 linhas)
│     ├─ import.js             # upload, parse, comparação e relatório (390 linhas)
│     ├─ app.js                # composition root: DOM, eventos e injeção de dependências (369 linhas)
│     ├─ worker.js             # parse do Excel em Web Worker (11 linhas)
│     └─ analytics.js          # Vercel Analytics condicional (52 linhas)
├─ supabase/migrations/        # 4 migrações (tabela/RLS, trigger, hardening, histórico)
├─ tests/                      # 13 arquivos, 131 testes
├─ tools/serve.mjs             # servidor estático local
├─ vendor/                     # libs offline (2,66 MB no total)
├─ data/                       # planilha de referência do smoke test
├─ README.md                   # visão geral, persistência, deploy e smoke test
├─ ANALISE.md                  # este documento: análise, auditoria e plano
└─ package.json                # scripts start/dev/test; sem build
```

### O que é carregado no navegador

```text
index.html
  ├─ vendor/chart.umd.min.js
  ├─ vendor/fontawesome/css/all.min.css
  ├─ vendor/fonts/plus-jakarta-sans.css
  ├─ assets/css/tailwind.css   # Tailwind compilado (F7)
  ├─ assets/css/styles.css
  └─ assets/js (defer, nesta ordem)
       etl.js → ui.js → charts.js → state.js → supabase.js → normalize.js →
       filters.js → view.js → snapshot.js → table.js → banner.js →
       persistence.js → import.js → app.js
       analytics.js (type="module")
```

> A ordem dos scripts é um **contrato implícito**: `app.js` assume que todos os
> globals (`ETL`, `UI`, `Charts`, `DashboardState`, `SupabaseStorage`,
> `DashboardNormalize`, `DashboardFilters`, `DashboardView`, `DashboardSnapshot`,
> `DashboardTable`, `DashboardBanner`, `DashboardPersistence` e
> `DashboardImport`) já existam.

---

## 3. Camadas e responsabilidades

| Módulo | Papel | Depende de | Observação |
|---|---|---|---|
| `etl.js` | Parsing do workbook, aliases de colunas, datas, moedas, canonicalização | `XLSX` (global) | Núcleo quase puro; roda também no Worker |
| `state.js` | Filtros padrão, validação de snapshot, `compareRecords`, fingerprint | Nada de DOM | Bom candidato a módulo compartilhado |
| `ui.js` | Escape HTML, formatadores, toast, modal, clipboard, download | DOM | Sem dependência dos demais módulos |
| `charts.js` | 7 gráficos, tema claro/escuro, modo USD/QTD | `Chart.js`, `UI` | Redesenha todos os gráficos a cada `refresh()` |
| `supabase.js` | `getLatestSnapshot` / `saveSnapshot` via REST | `fetch`, `DashboardState` | Chave publishable embutida (esperado) |
| `app.js` | Composição: eventos, filtros, tabela, CSV, importação, IndexedDB, banners | Todos os anteriores | Ponto único de orquestração |
| `worker.js` | Executa `ETL.parseWorkbook` fora da main thread | `importScripts` de xlsx + etl | Evita congelar a aba no parse |

### Contratos implícitos que precisam ser preservados

1. `prepareRecord()` e `canonicalizeDataset()` precisam rodar juntos, e o `_search`
   precisa ser recalculado **depois** da canonicalização.
2. `toPersistedRecord()` (`app.js`) e `recordFingerprint()` (`state.js`) precisam
   descartar exatamente os mesmos campos vazios. Há comentários nos dois lados
   avisando disso.
3. `supabase.js` depende de `DashboardState.SNAPSHOT_VERSION` para montar o
   snapshot remoto.
4. A importação só pode substituir o snapshot se o arquivo contiver **todos** os
   processos já existentes (`compareRecords` no cliente + trigger no servidor).
5. Interações de UI **não** vão para o Supabase; apenas a importação grava remoto.

---

## 4. Fluxo de dados

```text
IMPORTAÇÃO
  arquivo → arrayBuffer → Worker (xlsx + etl.js)
    → records brutos → prepareRecord → canonicalize → _search
    → GET snapshot remoto → compareRecords (superset)
    → aplica estado → POST Supabase + IndexedDB
    → resumo/relatório de importação

RESTAURAÇÃO (abrir/recarregar)
  GET Supabase ─┐
                ├→ isValidSnapshot → escolhe o "mais recente"
  IndexedDB ────┘     → mescla filtros/estilo locais → render

INTERAÇÃO (filtro, busca, ordenação, tema)
  state → refresh() → KPIs + 7 gráficos + tabela
                     └→ debounce 600 ms → IndexedDB (nunca Supabase)
```

### Persistência

| Onde | O que guarda | Quando grava |
|---|---|---|
| Supabase `excel_imports` | `records` + `metadata` (dataset) | Apenas na importação |
| IndexedDB `bi_hub` / `kv` / `snapshot` | Snapshot completo + filtros + busca + estilo | Importação e interações (com debounce) |

**Regra de escrita:** o remoto é a fonte compartilhada; o local é cache e
preferências. Isso evita que uma aba antiga sobrescreva o último upload.

---

## 5. Banco de dados

Três migrações bem documentadas:

1. `20261009142126_create_excel_imports.sql` — tabela, RLS e grants.
2. `20261019141213_excel_imports_single_latest.sql` — trigger de superset e limpeza inicial.
3. `20261020120000_harden_excel_imports.sql` — privilégios, timestamps do servidor,
   singleton, `search_path` e `updated_at`.

### Invariantes fortes (🔒 preservar)

- `anon` só pode `SELECT` e `INSERT`; `TRUNCATE` foi revogado.
- `pg_advisory_xact_lock` serializa importações concorrentes.
- O trigger recusa `records` vazio, `operacao` ausente/duplicada e remoção de
  processos existentes.
- Índice único em `((true))` e `CHECK` garantem o singleton mesmo se o trigger
  for desabilitado.
- Função `SECURITY DEFINER` com `search_path = ''` e `EXECUTE` revogado do cliente.
- `created_at`/`updated_at` são sobrescritos pelo servidor.

### Ponto arquitetural

O design é **snapshot único**: não há histórico nem rollback. Uma importação
válida porém errada apaga a única cópia remota. O cache local pode salvar o
navegador que importou, mas não é um backup compartilhado. Ver **F4**.

---

## 6. Testes

### Resultado real neste checkout

```text
# tests 104
# pass 101
# fail 3
```

### Distribuição

| Arquivo | Testes |
|---|---:|
| `etl.test.mjs` | 21 |
| `static.test.mjs` | 21 |
| `hardening.test.mjs` | 10 |
| `persist.test.mjs` | 9 |
| `vendor.test.mjs` | 8 |
| `charts.test.mjs` | 7 |
| `ui.test.mjs` | 7 |
| `compare.test.mjs` | 6 |
| `search.test.mjs` | 6 |
| `payload.test.mjs` | 5 |
| `banner.test.mjs` | 4 |
| **Total** | **104** |

### As 3 falhas

| Teste | Causa |
|---|---|
| `servidor local e manifesto de dependências são válidos` | Hash do `vendor/xlsx.full.min.js` muda com CRLF |
| `o sha256 de cada entrada do manifesto confere com o arquivo em disco` | Mesmo motivo |
| `migração de endurecimento fecha o bypass de privilégios e o DELETE sem WHERE` | Comentário SQL com CRLF não é removido pelo regex |

**Confirmação:** normalizando os arquivos para LF, o hash do SheetJS volta a
`CC015130AA8521E7F088F88898EBA949CCDCBFB38DF0BD129B44B7273C3A6F41` e o teste
SQL encontra `1` match, `0` sem `WHERE`. Portanto, em Linux/CI a suíte deve
ficar 104/104.

### Cobertura e lacunas

**Cobre bem:** ETL, comparação de snapshots, persistência, payload, busca,
gráficos, UI, banner, estáticos, hardening SQL e vendor. É rápida (~2,4 s).

**Não cobre:**

- navegador real (usa DOM falso/VM);
- regressão visual;
- fluxo completo com Supabase real;
- performance/carga;
- portabilidade de fim de linha.

Foi exatamente por isso que o bug A2 (banner invisível) passou: o teste
verificava `hidden`, não a visibilidade real.

---

## 7. Pontos fortes (🔒 preservar)

- **Núcleo de domínio bem separado:** `etl.js` e `state.js` são testáveis sem DOM.
- **Offline-first real:** o dashboard funciona sem rede e restaura o último snapshot local.
- **Invariantes no servidor:** a validação de superset não depende do cliente.
- **Persistência consciente:** cache local para UI, remoto apenas para dataset.
- **Payload enxuto:** remoção de `_search` e campos vazios (~25% de redução).
- **Busca sem acento** e canonicalização de grafias (Maersk/MAERSK etc.).
- **Acessibilidade acima da média:** ARIA, foco em modal, tablist por teclado,
  resumos `sr-only` dos gráficos.
- **Documentação operacional:** README com smoke test e `ANALISE.md` com histórico.
- **Deploy simples:** estático na Vercel, sem etapa de build.
- **Vendor controlado:** manifesto com versão, origem e SHA-256.

---

## 8. Achados e correções

### 🔴 F1 — Suíte não é portável entre sistemas (P0)

| | |
|---|---|
| **Arquivos** | `.gitattributes` (ausente) · `tests/static.test.mjs` · `tests/vendor.test.mjs` · `vendor/xlsx.full.min.js` |
| **Esforço** | 🟢 ~1 h |
| **Risco** | Baixo |

**Evidência**

```text
> git ls-files --eol index.html assets/js/app.js supabase/migrations/...sql vendor/xlsx.full.min.js
i/lf    w/crlf  attr/    assets/js/app.js
i/lf    w/crlf  attr/    index.html
i/lf    w/crlf  attr/    supabase/migrations/20261020120000_harden_excel_imports.sql
i/lf    w/crlf  attr/    vendor/xlsx.full.min.js
```

- `core.autocrlf=true` no ambiente Windows.
- Não existe `.gitattributes` (`attr/` vazio).
- O SheetJS tem **951.904 bytes em LF** e **951.928 bytes em CRLF**; o hash muda.
- `tests/static.test.mjs:348-355` remove comentários com `/--.*$/`; como `.` não
  casa com `\r`, comentários CRLF sobrevivem e o `delete from ...;` comentado é
  contado como código executável.

**Impacto**

- 3 de 104 testes falham no Windows.
- Um CI em Windows ficaria vermelho sem haver bug real.
- A confiança na suíte e no manifesto de vendor fica reduzida.

**Correção**

1. Criar `.gitattributes`:

```gitattributes
* text=auto eol=lf

# Binários: nunca converter
*.xlsx binary
*.woff2 binary
*.ttf binary
*.ico binary
```

> ⚠️ **Não** marque `vendor/xlsx.full.min.js` como `-text` antes de renormalizar.
> O arquivo de trabalho está em CRLF; com `-text` o `git add` gravaria os bytes
> CRLF e quebraria o hash do manifesto. Deixe o `eol=lf` normalizar. Se quiser
> marcá-lo como binário depois, faça isso somente com o blob LF já confirmado.

2. Renormalizar o repositório em um commit dedicado:

```powershell
git add .gitattributes
git add --renormalize .
git commit -m "chore: normaliza finais de linha para LF"
git checkout-index -a -f
```

> ⚠️ O `checkout-index -a -f` reescreve os arquivos de trabalho a partir do
> índice. Faça isso com a árvore limpa (só `.agents/` untracked) para não perder
> alterações locais.

3. Tornar o teste SQL independente de EOL:

```js
const normalized = source.replace(/\r\n/g, '\n');
```

4. Adicionar CI com matriz Linux + Windows (ver **F8**).

**Critérios de aceite**

- [x] `git ls-files --eol` mostra `i/lf w/lf` para arquivos de texto
- [x] `node --test` → 104/104 no Windows
- [ ] `node --test` → 104/104 no Linux
- [x] Hash do `vendor/xlsx.full.min.js` confere com o manifesto nos dois sistemas
- [x] Nenhum arquivo binário foi alterado pelo `renormalize`

> Executado em 21/10/2026 no commit `0c05e2f`: suíte 104/104 no Windows; hash LF
> do SheetJS confirmado (`CC015130…6F41`). O manifesto também precisou corrigir
> o hash do `vercel-analytics.mjs` (estava com o hash dos bytes CRLF). A
> validação em Linux fica pendente até o CI da F8.

---

### 🔴 F2 — “Mais recente vence” ainda usa timestamp do cliente (P0)

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js:67-71` · `assets/js/app.js:1691-1695` · migração `20261020120000` |
| **Esforço** | 🟢 ~1-2 h |
| **Risco** | Médio (muda a escolha nuvem/cache) |

**Evidência**

```js
// supabase.js:67-71
meta: Object.assign({}, row.metadata || {}, {
  name: row.file_name,
  sheetName: row.sheet_name,
  loadedAt: (row.metadata && row.metadata.loadedAt) || row.created_at
})
```

```js
// app.js:1691-1695
var remoteLoadedAt = new Date(remoteSnapshot.meta.loadedAt).getTime();
var cacheLoadedAt = new Date(cachedSnapshot.meta.loadedAt).getTime();
if (Number.isFinite(cacheLoadedAt) && (!Number.isFinite(remoteLoadedAt) || cacheLoadedAt > remoteLoadedAt)) {
  chosen = cachedSnapshot;
}
```

A migração tornou `created_at` autoritativo no servidor, mas o cliente ainda
pode enviar `metadata.loadedAt` no futuro e vencer o tie-break. A auditoria
original marcava M2 como concluído, mas a correção ficou incompleta.

Verificação live em 21/10/2026: `metadata.loadedAt = 2026-10-20T13:18:49.752Z`
e `created_at = 2026-10-20 13:18:50.84257+00`. Os dois valores existem, mas o
código continua lendo o primeiro.

**Impacto**

- A garantia “o snapshot mais recente vence” não é server-authoritative.
- Um cliente com relógio errado (ou malicioso) pode fazer o cache antigo perder
  ou ganhar indevidamente.
- O texto “Última leitura” pode mostrar um horário que o servidor não reconhece.

**Correção**

1. Usar `created_at` do servidor como fonte de ordenação. A forma mais simples
   é sobrescrever `meta.loadedAt` em `getLatestSnapshot`:

```js
meta: Object.assign({}, row.metadata || {}, {
  name: row.file_name,
  sheetName: row.sheet_name,
  loadedAt: row.created_at
})
```

2. Opcional: preservar o valor do cliente apenas para diagnóstico, em um campo
   separado (`clientLoadedAt`), nunca para ordenar.
3. Depois do save, atualizar o snapshot local com o `created_at` do servidor.
   Hoje `saveSnapshot` usa `Prefer: return=minimal` (`supabase.js:49`), então
   `persistState` grava no IndexedDB o `loadedAt` do cliente (`app.js:1652`).
   Usar `return=representation` (ou um GET após o save) e atualizar o snapshot
   local antes de `idbSet`.
4. Atualizar `tests/persist.test.mjs:645-666`, que hoje espera o `loadedAt` do
   cliente mesmo com `created_at` diferente.

**Critérios de aceite**

- [x] `metadata.loadedAt` no futuro é ignorado na escolha nuvem/cache
- [x] A escolha usa `created_at` retornado pelo Supabase
- [x] “Última leitura” reflete o horário do servidor
- [x] Cache local pós-save também usa o timestamp do servidor
- [x] Teste de persistência usa `created_at`, não `metadata.loadedAt`
- [x] Importação e restauração continuam funcionando
- [x] Teste automatizado cobre o cenário

> Executado em 21/10/2026: `saveSnapshot` passou a usar
> `Prefer: return=representation`; o retorno é normalizado por `rowToSnapshot`
> (`loadedAt = created_at`, `clientLoadedAt` para diagnóstico). O `persistState`
> atualiza estado e IndexedDB antes de gravar e repinta “Última leitura”. Suíte:
> 107/107 (3 testes novos).

---

### 🟠 F3 — Sem timeout de rede e restauração bloqueante (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js` · `assets/js/app.js:1673-1717` (`restoreState`) · `assets/js/app.js:1638-1671` (`persistState`) |
| **Esforço** | 🟡 ~2-3 h |
| **Risco** | Médio |

**Evidência**

- `fetch` em `supabase.js` não usa `AbortController` nem timeout.
- `restoreState()` só renderiza depois que o fetch remoto resolve; em rede lenta
  a página fica sem dados mesmo tendo cache local válido.
- `persistState()` grava no IndexedDB **depois** do Supabase; se o POST pendurar,
  a importação fica presa e o cache local não é atualizado.
- `analytics.js` também faz `HEAD` sem timeout (impacto menor).

**Impacto**

- Aba “Carregando dataset…” por tempo indeterminado em rede instável.
- Importação sem feedback de sucesso/erro se o Supabase não responder.
- Cache local desatualizado justamente quando ele seria mais útil.

**Correção**

1. Criar um helper de fetch com timeout e `AbortController`:

```js
function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(function () { clearTimeout(timer); });
}
```

2. Aplicar em `supabase.js` e no `HEAD` do analytics.
3. Na restauração, renderizar o cache local primeiro e reconciliar com a nuvem
   em seguida (sem bloquear o primeiro paint).
4. Na importação, manter a ordem “remoto decide → local grava”, mas com timeout
   explícito e mensagem clara quando o remoto não responder.

**Critérios de aceite**

- [x] Fetch remoto tem timeout configurável
- [x] Offline/rede lenta mostra o cache local sem esperar o Supabase
- [x] POST pendurado não deixa a UI em “Processando…” indefinidamente
- [x] Nenhum `unhandled rejection` no console
- [x] Teste com fetch que nunca resolve (ou demora) cobre o timeout

> Executado em 21/10/2026: `fetchWithTimeout` com `AbortController` e 15 s no
> `supabase.js`; `HEAD` do analytics com 5 s; `restoreState({ onLocal })` pinta o
> IndexedDB antes do Supabase e reconcilia depois; a importação avisa quando o
> banco não responde. Suíte: 113/113 (5 testes novos). Validado no navegador
> local após reload.

---

### 🟠 F4 — Escrita pública sem autenticação e sem histórico (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js` · `supabase/migrations/20261020120000_harden_excel_imports.sql` · `supabase/migrations/20261021120000_excel_imports_history.sql` · `README.md` |
| **Esforço** | 🔴 ~1-2 dias (depende da decisão) |
| **Risco** | Alto (integridade dos dados) |

**Evidência**

- A chave publishable está embutida no cliente (correto para esse tipo de chave).
- `anon` pode `INSERT`; a policy é `with check (true)`.
- O trigger valida apenas: lista não vazia, `operacao` única/presente e superset.
- Não há autenticação, rate limit nem auditoria.
- O trigger apaga a linha anterior; não há histórico nem rollback.

**Impacto**

- Qualquer cliente pode ler o dataset inteiro (pode ser intencional).
- Qualquer cliente pode substituir o snapshot por um superset com valores
  alterados ou registros extras.
- Uma importação válida porém errada destrói a única cópia remota.
- Não há como auditar “quem importou o quê” nem restaurar a versão anterior.

**⚠️ Decisão de produto necessária**

| Opção | Descrição | Quando faz sentido |
|---|---|---|
| **A** | Manter escrita pública e documentar o risco | Dataset público, usuários confiáveis, baixo impacto |
| **B** | Supabase Auth (magic link) + RLS só para `authenticated` | Uso interno com identidade |
| **C** | Edge Function com service role + token/allowlist | Escrita controlada sem expor INSERT |

**Correção sugerida (independente da opção)**

1. Criar histórico append-only dos snapshots aceitos. Exemplo de direção:

```sql
create table if not exists public.excel_imports_history (
  like public.excel_imports including all
);
```

2. No trigger, antes do `delete`, copiar a linha atual para o histórico.
3. Documentar o procedimento de rollback (restaurar a linha anterior).
4. Se opção B/C: revogar `INSERT` do `anon` e mover a escrita para o caminho
   autenticado.
5. Adicionar rate limit/monitoramento na Vercel ou no Supabase.

**Execução adotada (opção A)**

A escrita continua pública com a chave publishable, e o risco residual está
documentado no README. A mitigação entregue cobre histórico e rollback, não
autenticação:

1. `public.excel_imports_history` é append-only para o cliente: RLS habilitada,
   nenhum grant para `anon`/`authenticated` e sem policies de escrita.
2. O trigger `before delete` em `public.excel_imports` arquiva o snapshot que
   está sendo substituído, dentro da mesma transação da importação.
3. `public.excel_imports_rollback(history_id)` restaura uma versão arquivada pelo
   SQL Editor (dono), usando `now()` nos timestamps para vencer caches antigos.
   O próprio rollback é arquivado, então também pode ser desfeito.
4. A migration não copia o snapshot corrente: o histórico começa vazio e passa a
   registrar as substituições a partir da aplicação.
5. O README documenta o modelo de escrita, o risco residual, o procedimento de
   consulta e o rollback. O `insert` direto de novos snapshots continua
   permitido — a integridade dos valores não é validada pelo servidor.

**Critérios de aceite**

- [x] Decisão A/B/C registrada (opção A)
- [x] Se B/C: `anon` não consegue mais inserir — não aplicável à opção A
- [x] Histórico contém uma linha por importação aceita (trigger `before delete`)
- [x] Procedimento de rollback testado (`excel_imports_rollback`)
- [x] README documenta o modelo de escrita e o risco residual

---

### 🟠 F5 — `app.js` monolítico e acoplamento por globals (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/app.js` (368 linhas, composition root) · `assets/js/{normalize,filters,view,snapshot,table,banner,persistence,import}.js` · `index.html:40-52` |
| **Esforço** | 🟡 ~1-2 dias (incremental) |
| **Risco** | Médio (refatoração sem mudança de comportamento) |

**Evidência**

`app.js` cobre eventos, filtros, tabela, CSV, importação, IndexedDB, Supabase,
banners e relatórios. Tudo depende de `ETL`, `UI`, `Charts`, `DashboardState` e
`SupabaseStorage` no `globalThis`, e da ordem dos scripts no HTML.

**Impacto**

- Alto custo cognitivo e conflitos de merge.
- Testes precisam simular o DOM inteiro.
- Regras de negócio ficam misturadas com manipulação de DOM.
- Difícil evoluir sem regressão.

**Correção sugerida**

Manter o “sem build” e usar **ES Modules nativos**:

```text
assets/js/
├─ core/
│  ├─ etl.js          # ou wrapper do etl atual
│  ├─ state.js
│  └─ normalize.js    # isEmptyValue, toPersistedRecord, canonicalização
├─ data/
│  ├─ supabase.js
│  └─ storage.js      # IndexedDB
├─ ui/
│  ├─ ui.js
│  ├─ charts.js
│  ├─ table.js
│  ├─ filters.js
│  └─ banner.js
├─ import.js          # fluxo de upload/parse/compare
└─ app.js             # composição e eventos
```

**Ordem incremental recomendada**

1. Extrair funções puras: `filters.js`, `sort.js`, `csv.js`.
2. Extrair `persistence.js` (IndexedDB + snapshot).
3. Extrair `import.js` (upload, worker, comparação, relatório).
4. Extrair `banner.js`.
5. Deixar `app.js` como composition root.

Cada passo deve terminar com `node --test` verde e nenhuma mudança visual.

**Execução incremental adotada**

O split foi feito preservando IIFE/globals e a ordem dos scripts, sem build:

1. `table.js` — tabela, paginação, ordenação e exportação CSV (passo 1).
2. `banner.js` — banners, KPIs e resumo do dataset (passo 2).
3. `persistence.js` — Supabase + IndexedDB, snapshot e restauração (passo 3).
4. `import.js` — upload, parse, comparação e relatório de importação (passo 4).
5. `normalize.js` / `filters.js` / `view.js` / `snapshot.js` — normalização de
   registros, filtros/ordenação, estilo/abas e render de snapshot (passo 5).
6. `app.js` — composição, eventos e `refresh` (composition root).

**Critérios de aceite**

- [x] `app.js` abaixo de ~400 linhas (368)
- [x] Nenhum comportamento alterado (smoke test manual: 861 de 1.944, filtros,
      busca, estilo, abas e restauração)
- [x] 113/113 testes verdes
- [x] Contratos de snapshot e canonicalização preservados
- [x] Worker continua funcionando

---

### 🟠 F6 — Snapshot inteiro e limite de escala (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js` · `assets/js/app.js` (`buildSnapshot`, `restoreState`) · migração/trigger |
| **Esforço** | 🔴 ~2-5 dias (arquitetura) |
| **Risco** | Alto (migração de dados) |

**Evidência**

- Cada abertura baixa o dataset completo (~2,2 MB após o trim, ~1,9 mil registros).
- Cada importação reenvia o array inteiro.
- O banco guarda uma única linha JSONB.
- `anon` tem `statement_timeout=3s` (B14); hoje o INSERT leva ~61 ms, mas a
  folga escala mal.
- Com 10× o dataset, o payload chega a ~20 MB.

**Impacto**

- Tempo de carga e custo de transferência crescem linearmente com o dataset.
- Risco de timeout em importações maiores.
- Memória do navegador: `state.dataset` + `state.filtered` + resposta remota +
  cópia no IndexedDB.

**⚠️ Decisão de produto necessária**

| Opção | Descrição |
|---|---|
| **A** | Manter snapshot único e apenas aumentar timeout/limites |
| **B** | Snapshot no Storage + Edge Function para leitura/escrita |
| **C** | Tabelas normalizadas + deltas por `operacao` |
| **D** | Híbrido: snapshot como backup + tabela normalizada para consulta |

**Correção sugerida**

1. Medir o ponto de ruptura com datasets sintéticos (2×, 5×, 10×).
2. Se opção B: mover o JSONB para Storage e servir via Edge Function com timeout
   próprio.
3. Se opção C/D: criar tabela de processos e aplicar upsert por `operacao`,
   mantendo o snapshot como backup/rollback.
4. Ajustar o timeout do `anon` apenas se a opção A for escolhida; preferir
   timeout por operação em vez de global.

**Critérios de aceite**

- [ ] Cenário de 10× o dataset medido e documentado
- [ ] Carga inicial abaixo do alvo definido (ex.: < 3 s em rede 4G)
- [ ] Importação abaixo do timeout
- [ ] Rollback/backup disponível
- [ ] Teste de carga reproduzível

---

### 🟡 F7 — Tailwind em runtime e CSP permissiva (P2)

| | |
|---|---|
| **Arquivos** | `index.html` · `tailwind.config.cjs` · `assets/css/tailwind.src.css` · `assets/css/tailwind.css` · `assets/css/styles.css` |
| **Esforço** | 🟡 ~4-6 h |
| **Risco** | Médio (regressão visual) |

**Evidência**

- `vendor/tailwind.js` é o Play CDN (440 KB) compilando em runtime; o console
  avisa que não deve ser usado em produção.
- O `tailwind.config` inline obriga `'unsafe-inline'` e `'unsafe-eval'` na CSP.
- `connect-src https://*.supabase.co` permite qualquer projeto Supabase.
- `styles.css:448-450` usa seletores como `[class~="bg-slate-800/60"]`, frágeis
  a mudanças de classe.

**Impacto**

- Custo de parse/JIT em toda carga.
- CSP mais fraca do que aparenta.
- Overrides de tema acoplados a strings de classe do HTML/JS.

**Correção sugerida**

1. Compilar o Tailwind para CSS estático:

```text
content: ['./index.html', './assets/js/**/*.js']
```

> A varredura precisa incluir `assets/js/*.js`: as classes de badge e status só
> existem em strings do `app.js`.

2. Substituir `<script src="vendor/tailwind.js">` + config inline por
   `<link rel="stylesheet" href="assets/css/tailwind.css">`.
3. Remover `'unsafe-eval'` e, se possível, `'unsafe-inline'` do `script-src`.
4. Restringir `connect-src` ao host exato do projeto Supabase.
5. Migrar temas para CSS variables em vez de overrides por classe.

**Execução adotada**

O Tailwind 3.4.16 foi compilado uma vez e o CSS passou a ser versionado, sem
build no deploy:

1. `tailwind.config.cjs` reproduz o tema (dark mode por classe, cores `brand` e
   `dark*`) e varre `index.html` + `assets/js/**/*.js`.
2. `assets/css/tailwind.css` (19,4 KB minificado) é carregado antes de
   `styles.css`, preservando a cascata anterior. Para regenerar:
   `npm run build:css` (usa `npx tailwindcss@3.4.16`, versão fixa).
3. `vendor/tailwind.js` (440,6 KB) e o `tailwind.config` inline foram removidos;
   o `vendor/manifest.json` não lista mais o Play CDN.
4. A CSP ficou `script-src 'self'` e `style-src 'self'`, sem `'unsafe-inline'`
   nem `'unsafe-eval'`; `connect-src` aponta só para
   `https://bsczvemaqvladupmdpgl.supabase.co`.
5. O README documenta a geração do CSS e a ausência de build em runtime.
6. Os overrides de tema de `styles.css` continuam usando `[class~="..."]`; as
   classes correspondentes estão no CSS compilado, mas novas classes dinâmicas
   exigem regeneração.

**Critérios de aceite**

- [x] Tailwind compilado e versionado (`assets/css/tailwind.css`, 19,4 KB)
- [x] Nenhum aviso de Play CDN no console (console limpo)
- [x] CSP sem `unsafe-eval` (e também sem `unsafe-inline` em `script-src`)
- [x] `connect-src` restrito ao projeto correto
- [x] Comparação visual antes/depois (capturas 1400×1200 idênticas byte a byte)
- [x] 115/115 testes verdes

---

### 🟡 F8 — Higiene de engenharia e documentação (P2)

| | |
|---|---|
| **Arquivos** | raiz do projeto · `ANALISE.md` · `package.json` |
| **Esforço** | 🟡 ~3-4 h |
| **Risco** | Baixo |

**Evidência**

- Não havia `.gitignore`, `.github/` nem `vercel.json` (o `.gitattributes` foi
  criado no F1).
- `.agents/` estava untracked (skill do Supabase via MCP).
- Sem ESLint/Prettier/type check.
- A versão anterior deste documento tinha deriva: topo falava em 55 testes,
  log em 103, A2/B17 em 104; painel declarava 32 concluídos/2 pendentes, mas o
  real é 31/3; 8 itens `[x]` eram parciais (A2, M2, M5, M7, B6, B9, T3, T4);
  checkboxes internos desmarcados em A1/A3/M1–M8; B10/B14/B16 abertos.
- Regras duplicadas (`isEmptyValue` vs `isEmptyPersistedValue`) dependiam de
  disciplina para não divergir; a canonicalização já era delegada ao ETL.

**Correção sugerida**

1. `.gitignore`:

```gitignore
node_modules/
.vercel/
.agents/
*.log
.DS_Store
```

> Se `.agents/` for útil para o time, versionar em vez de ignorar. Decisão **D4**.

2. CI mínimo em `.github/workflows/test.yml`:

```yaml
name: tests
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node --test
```

3. Manter este documento sem contagens/checkboxes contraditórios; o histórico
   da auditoria fica registrado na seção “Auditoria dos 34 itens originais”.
4. Extrair as regras duplicadas para `core/normalize.js` e cobrir com testes.
5. Opcional: `vercel.json` com `Cache-Control` explícito para HTML e assets.

**Execução adotada**

1. `.gitignore` cobre `node_modules/`, `.vercel/`, `.agents/`, `*.log`, `.DS_Store`
   e `Thumbs.db`.
2. CI em `.github/workflows/test.yml`: matriz `ubuntu-latest` + `windows-latest`,
   Node 20, `node --test` e `permissions: contents: read`. Não depende de
   `npm install`.
3. D4 decidida: `.agents/` é ferramenta local e fica ignorada; não é versionada.
4. A regra de valor vazio passou a ter uma única implementação:
   `DashboardState.isEmptyValue`. `normalize.create()` exige a função e
   `toPersistedRecord` a usa; `recordFingerprint` usa a mesma fonte.
5. A canonicalização continua delegada a `ETL.canonicalizeField` por
   `normalize.canonicalizeDataset`; o `app.js` só injeta o wrapper, sem
   reimplementar a regra.
6. O painel de progresso e o registro refletem o estado real; a seção
   “Auditoria dos 34 itens” permanece explicitamente datada no commit
   `f185f84`, como histórico. B10 foi resolvido no F7 e saiu das pendências.
7. `vercel.json` não foi adicionado: a Vercel já serve os estáticos com ETag e
   cachear assets sem fingerprint por longo prazo atrapalharia atualizações.

**Critérios de aceite**

- [x] `.gitignore` cobre artefatos locais
- [x] CI roda em Linux e Windows
- [x] Documento único sem contagens/checkboxes contraditórios (auditoria histórica datada)
- [x] Regras de normalização têm uma única fonte de verdade (`DashboardState.isEmptyValue`)
- [x] Decisão sobre `.agents/` registrada (D4 = B, ignorar)

---

### 🟠 F9 — Resumo do dataset e total global não ficam visíveis no Dashboard (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/app.js:816-911` (banner), `931` (KPI), `997-1007` (contagem) · `index.html:74-79` e `136-140` |
| **Esforço** | 🟢 ~1-2 h |
| **Risco** | Baixo |

**Evidência**

- Com dataset, `showStatusBanner(true)` agenda o desaparecimento em
  `STATUS_BANNER_VISIBLE_MS` (8 s) + `STATUS_BANNER_FADE_MS` (300 ms). O
  comportamento é intencional e testado em `tests/banner.test.mjs:286-350`.
- O único resumo persistente é `#last-read-header`, que recebe apenas
  `Última leitura: <data/hora>` (`app.js:841-844`); não tem nome do arquivo nem
  total.
- O KPI `#kpi-processos` mostra `data.length` (`app.js:931`), com legenda fixa
  “Registros filtrados” (`index.html:140`).
- A contagem “X de Y” só existe em `#table-count`, dentro da aba **Tabela de
  Dados** (`app.js:997-1007`).
- Live em 21/10/2026: 1.944 registros, 861 com `monthlyReference.year = 2026`.
  O filtro padrão é o ano corrente, então o Dashboard abre com 861 processos e
  não mostra o total 1.944 em lugar nenhum depois que o banner some.

**Impacto**

- O problema original de A2 (“não descobre qual arquivo está carregado, quantos
  processos existem”) continua verdadeiro depois de 8 s e em um reload em que o
  usuário não olhe o banner a tempo.
- O B9/DA1 da auditoria original foi entregue só na aba Tabela; o Dashboard não tem “861 de 1.944”.
- O texto da tabela (“Exibindo 1–50 de 50 de 100 registro(s)”) é ambíguo.

**Correção sugerida**

1. Colocar no cabeçalho persistente (`#last-read-header` ou um subtítulo) o nome
   do arquivo e “X de Y processos”.
2. Atualizar o hint do KPI para “861 de 1.944 · filtro 2026” (ou “861 de 1.944
   registros”) quando houver filtro ativo.
3. Corrigir o texto da tabela para “Exibindo 1–50 de 50 filtrados (100 no total)”.
4. Revisar a decisão do banner (DA2 da auditoria original): manter o
   transitório é aceitável **se** a informação persistente existir; hoje não existe.

**Critérios de aceite**

- [x] Após 8 s (e após reload), o Dashboard mostra o nome do arquivo carregado
- [x] O Dashboard mostra o total do dataset e o total filtrado sem trocar de aba
- [x] O texto da tabela não repete “de” de forma ambígua
- [x] Teste cobre o estado depois que o timer do banner dispara

> Executado em 21/10/2026: `#dataset-summary` no cabeçalho mostra
> `!Importações.xlsx · 861 de 1.944 processos`; o KPI ganhou
> `#kpi-processos-hint` (`861 de 1.944 · filtro 2026`) e a tabela passou a
> `Exibindo 1–50 de 861 filtrados (1.944 no total)`. Validado no navegador local
> (viewport 1000×700, sem overflow horizontal) e após o timer do banner. Suíte:
> 108/108.

---

### 🟡 F10 — Cobertura de testes não comprova T3/T4/M5/B6 (P2)

| | |
|---|---|
| **Arquivos** | `tests/payload.test.mjs` · `tests/xss.test.mjs` · `tests/import-worker-fallback.test.mjs` |
| **Esforço** | 🟡 ~2-4 h |
| **Risco** | Baixo |

**Evidência**

- **T3:** `tests/payload.test.mjs:353-367` só verifica queda relativa de 25%;
  não há limite absoluto de bytes nem teste com o dataset real.
- **T4:** `tests/ui.test.mjs:74-91` testa `escapeHtml` isoladamente. Não há teste
  que injete `<img onerror>` em cada sink; `ui.openModal` continua recebendo HTML
  cru (`ui.js:153`) e depende de todos os chamadores escaparem.
- **M5:** `tests/hardening.test.mjs:240-247` é estático: verifica a presença de
  `if (settled) return;`, mas não simula Worker que falha e mede congelamento. O
  fallback ainda chama `parseWorkbook` síncrono na main thread.
- **B6:** `tests/payload.test.mjs:383-402` cobre `_search`, `sourceRowNumber` e
  vazios, mas não um campo novo do parser. Reproduzido:
  `{operacao:'IMP-1',valor:10}` versus o mesmo registro com `novoCampo:'x'`
  resulta em `updated=1, unchanged=0`.

**Correção sugerida**

1. T3: definir orçamento absoluto (ex.: 2,5 MB para 2.000 registros) e falhar se
   exceder.
2. T4: teste de sink com payload malicioso em tabela, banner, selects, toasts e
   modal; ou trocar `openModal` para receber nós/DOM em vez de HTML cru.
3. M5: teste com Worker que dispara `onerror` e um `parseWorkbook` instrumentado;
   garantir que o fallback não rode duas vezes e que o aviso foi pintado antes.
4. B6: teste com campo novo não vazio; decidir se ele deve contar como mudança
   ou ser ignorado por uma lista estável.

**Critérios de aceite**

- [x] Payload tem limite absoluto testado
- [x] Pelo menos um teste por sink de HTML (ou `openModal` deixa de aceitar HTML cru)
- [x] Fallback do Worker tem teste de não congelamento/não duplicação
- [x] Comparação tem teste de campo novo do parser

**Execução adotada**

Nenhum arquivo de produção mudou: o F10 é uma lacuna de **cobertura**, e a
correção foi escrever os testes que faltavam. Quatro arquivos foram tocados:

1. **T3 — orçamento absoluto** (`tests/payload.test.mjs`):
   `PAYLOAD_BUDGET_BYTES = 2_500_000` para 2.000 registros. O harness grava
   694.677 bytes nessa escala; o snapshot real de ~1,9 mil registros chega a
   ~2,2 MB porque cada processo tem mais campos preenchidos. O teto cobre o
   dataset real com margem e ainda reprova o retorno do `_search` ou de campos
   vazios ao payload.
2. **B6 — campo novo do parser** (`tests/payload.test.mjs`): decisão registrada
   — **campo novo não vazio conta como atualização; campo vazio (`null`, `''`,
   `[]`, `undefined`) é ignorado**. É o que mantém a linha antiga do banco
   (formato cheio) comparável com o registro novo (formato enxuto, M1).
3. **T4 — teste por sink** (`tests/xss.test.mjs`, novo): payload malicioso
   (`<img src=x onerror=…>` e `"><script>…`) injetado em **tabela, banner,
   selects, toast e modal**. O corpo do modal continua sendo HTML por design
   (os fragmentos são montados pelo chamador), então o teste também confere,
   de forma estática e tolerante a reformatação, que todo dado dinâmico dos
   quatro chamadores de `import.js` passa por `UI.escapeHtml`/`formatNumber`.
4. **M5 — fallback do Worker** (`tests/import-worker-fallback.test.mjs`, novo):
   harness com `Worker` falso, `parseWorkbook` instrumentado e relógio
   controlável. Prova que (a) o aviso “Processando…” é pintado **antes** do
   parse, (b) o parse só roda na janela ociosa (`requestIdleCallback`) ou no
   próximo tick, (c) dois erros do Worker resultam em **um** parse, (d) erro
   tardio depois do timeout de 90 s **não** parseia, e (e) Worker bem-sucedido
   nunca recorre ao fallback.

**Validação dos testes (mutação)**

Cada teste novo foi verificado contra uma mutação do código de produção, para
garantir que não passa por acaso:

| Mutação | Teste que falha |
|---|---|
| `UI.escapeHtml(item.analista)` → `item.analista` (`table.js`) | `tabela escapa todos os campos dinâmicos da linha` |
| `global.UI.escapeHtml(file.name)` → `file.name` (`import.js`) | `chamadores do modal em import.js escapam file.name…` |
| remoção da guarda `if (settled) return;` (`import.js`) | `dois erros do Worker ainda resultam em um único parse` |
| remoção de `if (isEmptyValue(value)) return;` (`state.js`) | `B6: campo novo não vazio…` e `a comparação ignora _search…` |

> Executado em 21/10/2026: suíte 131/131 (118 + 13 novos). Nenhum arquivo de
> aplicação foi alterado; commit `3b0078a`.

---

### Auditoria dos 34 itens originais

> Feita em 21/10/2026 contra o commit `f185f84`, antes da consolidação deste
> documento. Status: ✅ confirmado no código/teste/live · 🟡 parcial · ⏳
> pendente. “Live” = consulta read-only ao Supabase de produção; nenhum dado foi
> alterado. A coluna de status foi atualizada conforme os achados foram
> fechados (F2, F7, F9 e F10).

**Resumo:** 28 confirmados, 4 parciais e 2 pendentes. Na auditoria original eram
23 confirmados, 8 parciais e 3 pendentes; a versão anterior declarava 32
concluídos e 2 pendentes, e 8 dos 31 “concluídos” não atendiam integralmente ao
critério de aceite.

| Item | Status | Evidência / lacuna |
|---|---|---|
| A1 | ✅ | Live: `anon` tem `SELECT`/`INSERT`; `UPDATE`/`DELETE`/`TRUNCATE` são negados; RLS ligada. README atualizado. Checkboxes internos continuam `[ ]`. |
| A2 | ✅ | Estado vazio persistente e com dataset transitório (8 s) testados. Depois de 8 s o cabeçalho mantém `#dataset-summary` com o nome do arquivo e “X de Y processos” (F9). O texto original dizia “visível em 4,5 s / oculto em ~6 s”. |
| A3 | ✅ | `_search` é recalculado depois da canonicalização (`app.js:215-220`); `tests/search.test.mjs:340+` cobre com/sem acento. |
| A4 | ✅ | Migração e função live usam `delete ... where id in (...)`; teste de regressão existe, mas falha no Windows por CRLF (F1). |
| M1 | ✅ | Live: 1.944 registros, 0 com `_search`. `toPersistedRecord` também remove `null`/`''`/arrays vazios; o bloco original mostrava só `_search` (deriva documental; ver DA4 b). |
| M2 | ✅ | `created_at` do servidor é a única referência de ordenação e de “Última leitura” (F2); o `loadedAt` do cliente fica só como diagnóstico (`metadata.clientLoadedAt`). |
| M3 | ✅ | Live: índice único `excel_imports_singleton` e check `excel_imports_records_is_array`. |
| M4 | ✅ | SheetJS 0.20.3 no bundle e no manifesto. O hash só confere em LF; no Windows o teste falha por CRLF (F1). |
| M5 | ✅ | `tests/import-worker-fallback.test.mjs` prova que o fallback do Worker roda uma única vez, só depois do aviso, e nunca após o timeout (F10). |
| M6 | ✅ | Live: ACL da função só tem `postgres` e `service_role`; `anon` sem `EXECUTE`. |
| M7 | ✅ | `script-src 'self'` e `style-src 'self'`, sem `'unsafe-inline'` nem `'unsafe-eval'`; `connect-src` restrito ao host exato do projeto (F7). |
| M8 | ✅ | Live: `search_path=""` na função de trigger. |
| B1 | ✅ | `canonicalizeDataset` roda antes do rebuild de `_search` (`app.js:215-220`). |
| B2 | ✅ | `csvNumberCell` mantém negativo como número; `tests/payload.test.mjs:404+` cobre. |
| B3 | ✅ | Funcional: `statusBannerLocked` no mesmo `#banner-text`. O texto original ainda falava em `#banner-error` separado (deriva documental). |
| B4 | ✅ | Limite `PERSIST_RETRY_LIMIT = 10`; `endSnapshotValidation` retoma a persistência. |
| B5 | ✅ | `LATEST` só em comentário; `isSuperset` documentado como API pública. |
| B6 | ✅ | Decisão: campo novo **não vazio** conta como atualização; campo vazio é ignorado. Cobrido em `tests/payload.test.mjs` (F10). |
| B7 | ✅ | Live: trigger `excel_imports_touch_updated_at`. |
| B8 | ✅ | `parseExcelDate` rejeita seriais fora de 1–80.000. |
| B9 | ✅ | A tabela mostra “Exibindo 1–50 de 861 filtrados (1.944 no total)”, o KPI ganhou o hint “861 de 1.944 · filtro 2026” e o cabeçalho mantém o resumo após o timer do banner (F9). |
| B10 | ✅ | Tailwind 3.4.16 compilado para `assets/css/tailwind.css` e versionado; o Play CDN saiu do `index.html` (F7). |
| B11 | ✅ | Manifesto com Tailwind 3.4.16, analytics 2.0.1 e versões reais. |
| B12 | ✅ | `role="group"`, `aria-controls`, `aria-haspopup`, `aria-expanded` e um único rótulo no ano. |
| B13 | ✅ | Guarda para `tab` nula no handler do tablist, com teste. |
| B14 | ⏳ | Timeouts continuam `anon=3s`, `authenticated=8s`, `authenticator=8s/8s` (live). |
| B15 | ✅ | `analytics.js` condiciona a injeção a host local/Vercel e faz HEAD em domínio próprio. |
| B16 | ⏳ | Fonte ainda com versão `unknown` no manifesto. |
| B17 | ✅ | `serve.mjs` envia `Cache-Control: no-store`; `ensureXlsxLoaded` usa `?v=` e retry com `&t=`. |
| T1 | ✅ | `tests/banner.test.mjs` cobre estado vazio persistente, com dataset transitório e refresh. |
| T2 | ✅ | `tests/search.test.mjs:340+` cobre acento, sem acento, parcial e operação. |
| T3 | ✅ | Orçamento absoluto de 2,5 MB para 2.000 registros, testado em `tests/payload.test.mjs` (F10). |
| T4 | ✅ | `tests/xss.test.mjs` cobre tabela, banner, selects, toast e modal com payload malicioso; `openModal` mantém o corpo HTML por design e os chamadores de `import.js` são verificados (F10). |
| T5 | ✅ | `tests/vendor.test.mjs:74-111` exige SheetJS >= 0.20.2 e confere manifesto/cache-busting. |
| V1–V12 | ✅ | Confirmados por código e/ou live, com uma ressalva de redação: V3 diz “upsert é rejeitado”, mas um upsert válido substitui a linha. A cobertura por sink de XSS (V7) existe desde o F10. |

### Deriva documental da versão anterior

| Ponto | O que a versão anterior dizia | O que o código/realidade mostra |
|---|---|---|
| Painel de progresso | 15 itens B concluídos + 2 pendentes (B10, B14) + B16; total 32/2 | B tem 17 itens: 14 concluídos e 3 pendentes (B10, B14, B16); total real 31/3 |
| Contagem de testes | 55/55 no topo, 103 no log, 104 em A2/B17 | 104 testes; neste Windows, 101 passam e 3 falham por CRLF |
| A2 — duração | “visível em 4,5 s, oculto em ~6 s” | `STATUS_BANNER_VISIBLE_MS = 8000` + fade de 300 ms |
| A2 — resumo | Destaques diziam “sempre visível” | Com dataset, o banner some; só a data/hora fica no cabeçalho |
| B3 — implementação | Elementos separados `#banner-text`/`#banner-error` | `statusBannerLocked` no mesmo `#banner-text` |
| M1 — payload | Bloco mostrava apenas remoção de `_search` | `toPersistedRecord` também remove `null`, `''` e arrays vazios (DA4 b) |
| M7 — CSP | Bloco com `script-src 'self' 'unsafe-inline'` | Real: `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (Tailwind JIT) |
| Checkboxes | Itens `[x]` com verificações internas `[ ]` | A1, A3, M1–M8 etc. continuavam com caixas abertas |
| README | Linha 24 diz que a restauração usa `meta.loadedAt` | É o comportamento atual, mas contradiz o objetivo do M2/F2 |
| B9 — números | “858 de 1.942” | Live: 861 de 1.944 |
| V3 — redação | “ON CONFLICT ... é rejeitado” | A validação roda; um upsert válido substitui a linha |
| “100% verde” | A2/B17 diziam 104 testes, 100% verde | No Windows, 3 falham; no Linux, o esperado é 104/104 |

### Auditoria live do Supabase (21/10/2026)

Consultas `SELECT`/`has_*_privilege` apenas; nenhuma escrita, DDL ou leitura de arquivo.

| Verificação | Resultado |
|---|---|
| Privilégios de `anon` | `SELECT=true`, `INSERT=true`, `UPDATE=false`, `DELETE=false`, `TRUNCATE=false` |
| RLS | `relrowsecurity=true` |
| ACL das funções | `excel_imports_enforce_single_latest` e `touch_updated_at` só para `postgres`/`service_role`; `anon` sem `EXECUTE` |
| `search_path` | `""` na função de trigger |
| Invariantes | índice `excel_imports_singleton` e check `excel_imports_records_is_array` |
| Triggers | `excel_imports_single_latest` e `excel_imports_touch_updated_at` |
| Conteúdo | 1 linha, 1.944 registros |
| M1 | 0 registros com `_search`; 1.944 com `sourceRowNumber` |
| M2 | `created_at=2026-10-20 13:18:50.84257+00`; `metadata.loadedAt=2026-10-20T13:18:49.752Z` |
| Filtro 2026 | 861 registros; 10 sem `monthlyReference` |
| Timeouts | `anon=3s`; `authenticated=8s`; `authenticator=8s/8s` (B14) |

### Pendências herdadas (B14, B16)

| Item | Evidência | Correção sugerida | Critério de aceite |
|---|---|---|---|
| **B14** | `anon=3s`, `authenticated=8s`, `authenticator=8s/8s`; o `anon` é o papel usado pelo dashboard. | Aumentar `statement_timeout` do `anon` (ex.: 30 s) ou mover a escrita para Edge Function com timeout próprio (DA5). | Importação do dataset real sem timeout. |
| **B16** | `Plus Jakarta Sans` está com `"version": "unknown"` no manifesto. | Identificar a versão real do CSS do Google Fonts e fixar origem/hash; ou registrar explicitamente que a versão não é rastreável. | Manifesto sem `unknown` ou exceção documentada. |

### Decisões da auditoria original (DA1–DA5)

> Estes IDs são históricos e não se confundem com as decisões **D1–D5** do plano atual.

| ID | Decisão | Opções | Estado |
|---|---|---|---|
| DA1 | Filtro de ano padrão (B9) | (a) ano corrente + exibir total; (b) “Todos os anos” | ✅ (a) aplicada, mas o total ficou só na aba Tabela (ver F9) |
| DA2 | Onde exibir o resumo do dataset (A2) | (a) card permanente; (b) barra de filtros; (c) cabeçalho; (d) card de status transitório | ✅ (d) aplicada; o cabeçalho persistente ficou incompleto (ver F9) |
| DA3 | Compilar o Tailwind (B10) | (a) sim, CSS estático; (b) manter Play CDN | ✅ (a) aplicada no F7 |
| DA4 | Recorte de payload (M1) | (a) só `_search`; (b) também campos vazios; (c) Storage + Edge Function | ✅ (b) aplicada; (c) evolução futura |
| DA5 | Timeout do `anon` (B14) | (a) 30 s; (b) Edge Function | ⏸️ aberta |

---

## 9. Plano de execução

### Fase 0 — Preparação

- [x] Criar branch de trabalho (`chore/estrutura-correcoes`)
- [x] Confirmar árvore limpa (exceto `.agents/`)
- [x] Rodar `node --test` e registrar o baseline (101/104 no Windows)
- [x] Fotografar/validar visualmente o dashboard atual

### Fase 1 — Confiabilidade (P0)

| Item | Entrega | Verificação |
|---|---|---|
| F1 | `.gitattributes` + renormalize + teste SQL EOL-safe | `git ls-files --eol`, `node --test` 104/104 |
| F2 | `loadedAt` server-authoritative | teste com `metadata.loadedAt` futuro |
| F8 (parcial) | CI Linux + Windows | workflow verde |

### Fase 2 — Robustez e manutenção (P1)

| Item | Entrega | Verificação |
|---|---|---|
| F3 | timeout de fetch + restore local-first | teste de fetch pendurado |
| F5 | extração incremental de módulos | 104/104 + smoke manual |
| F4 | decisão A/B/C + histórico/rollback | teste de escrita e restore |
| F9 | nome do arquivo + total no Dashboard | teste após o timer do banner |
| F8 (resto) | `.gitignore`, docs, normalização única | revisão |

### Fase 3 — Evolução (P2)

| Item | Entrega | Verificação |
|---|---|---|
| F7 | Tailwind compilado + CSP endurecida | screenshots + console limpo |
| F6 | plano de escala e teste de carga | métricas 2×/5×/10× |
| F10 | limites absolutos + testes de sink/Worker/fingerprint | suíte verde nos dois SOs — **feito** (131/131, commit `3b0078a`) |

---

## 10. Decisões pendentes

| ID | Decisão | Opções | Estado |
|---|---|---|---|
| D1 | Modelo de escrita (**F4**) | A: público documentado · B: Auth · C: Edge Function | ✅ A (histórico + rollback) |
| D2 | Escala do snapshot (**F6**) | A: manter · B: Storage · C: normalizado · D: híbrido | ⏸️ aberto |
| D3 | Tailwind (**F7**) | A: compilar agora · B: manter runtime | ✅ A (CSS estático) |
| D4 | `.agents/` | A: versionar · B: ignorar | ✅ B (ignorado no `.gitignore`) |
| D5 | Restrição “sem build” | A: manter (CSS gerado versionado) · B: permitir build no deploy | ✅ A (geração manual versionada) |

---

## 11. Riscos de executar as correções

| Risco | Mitigação |
|---|---|
| Renormalização gera diff grande | Commit dedicado, sem mudanças funcionais, CI verde |
| F2 muda a escolha nuvem/cache | Teste com timestamps controlados; observar “Última leitura” |
| Refatoração do `app.js` quebra comportamento | Passos pequenos, 104/104 a cada passo, smoke manual |
| F4 autenticação impacta o uso público | Decidir D1 antes; manter leitura pública se necessário |
| F6 migração de dados | Backup, janela de manutenção, rollback documentado |
| F7 regressão visual | Screenshot antes/depois; varrer `index.html` **e** `assets/js` |
| `.gitattributes` afeta checkouts existentes | Avisar o time; `git checkout-index -a -f` após commit |

---

## 12. Registro de execução

| Data | Fase | Itens | Resultado | Autor | Observações |
|---|---|---|---|---|---|
| 21/10/2026 | — | — | Análise estrutural concluída (10 achados: F1–F8 + F9/F10 da auditoria) | — | 104 testes: 101 OK / 3 CRLF; nenhum arquivo de aplicação alterado |
| 21/10/2026 | Auditoria | 34 itens originais | 23 confirmados, 8 parciais e 3 pendentes | — | Supabase read-only; nenhum dado alterado |
| 21/10/2026 | Fase 0 | preparação | branch `chore/estrutura-correcoes`; baseline 101/104 | — | árvore limpa exceto `.agents/`; inspeção visual ainda pendente |
| 21/10/2026 | Fase 1 | F1 | `.gitattributes`, normalização LF e teste SQL EOL-safe | subagente F1 | commit `0c05e2f`; 104/104 no Windows; manifesto do analytics corrigido |
| 21/10/2026 | Fase 1 | F2 | `created_at` server-authoritative no save e na restauração | subagente F2 | commit `9735256`; 107/107; 3 testes novos |
| 21/10/2026 | Fase 2 | F9 | resumo persistente no cabeçalho + hint do KPI + texto da tabela | subagente F9 | commit `1f561bb`; 108/108; validado no navegador local |
| 21/10/2026 | Fase 2 | F3 | timeout de rede, restore local-first e mensagem de importação | subagente F3 | commit `0499816`; 113/113; 5 testes novos |
| 21/10/2026 | Fase 3 | F5 passo 1 | tabela, paginação, ordenação e CSV em `table.js` | subagente F5 | commit `9b42b47`; 113/113; `app.js` 1.817→1.667 |
| 21/10/2026 | Fase 3 | F5 passo 2 | banners, KPIs e resumo em `banner.js` | subagente F5 | commit `812f729`; 113/113; `app.js` 1.667→1.524 |
| 21/10/2026 | Fase 3 | F5 passo 3 | persistência Supabase/IndexedDB em `persistence.js` | subagente F5 | commit `32cde6c`; 113/113; `app.js` 1.524→1.232 |
| 21/10/2026 | Fase 3 | F5 passo 4 | upload, parse, comparação e relatório em `import.js` | subagente F5 | commit `b084e52`; 113/113; `app.js` 1.232→898 |
| 21/10/2026 | Fase 3 | F5 passo 5 | normalização, filtros, view e snapshot em módulos | subagente F5 | commit `abe373a`; 113/113; `app.js` 898→368; smoke no navegador local |
| 21/10/2026 | Fase 3 | F4 | opção A + histórico append-only + rollback administrativo | subagente F4 | commit `2e98b33`; migration `20261021120000_excel_imports_history.sql` aplicada no remoto (`20261021163449`); 114/114; trigger validado em transação revertida |
| 21/10/2026 | Fase 3 | F7 | Tailwind compilado + CSP sem `unsafe-*` + `connect-src` exato | subagente F7 | commit `48f77db`; 115/115; capturas 1400×1200 idênticas byte a byte; console limpo |
| 21/10/2026 | Fase 3 | F8 | `.gitignore`, CI Linux/Windows e fonte única de valor vazio | subagente F8 | commit `17b7c15`; 118/118; D4 = ignorar `.agents/` |
| 21/10/2026 | Fase 3 | F10 | T3 (orçamento absoluto), T4 (teste por sink), M5 (fallback do Worker) e B6 (campo novo) | subagentes F10 | commit `3b0078a`; 131/131; 13 testes novos; 4 mutações detectadas pelos testes |
| | | | | | |
| | | | | | |

---

## Apêndice A — Evidências reproduzíveis

### A.1 — Fim de linha

```powershell
git config --get core.autocrlf
# true

git ls-files --eol index.html assets/js/app.js assets/css/styles.css `
  supabase/migrations/20261020120000_harden_excel_imports.sql `
  vendor/xlsx.full.min.js vendor/manifest.json
```

Saída relevante:

```text
i/lf    w/crlf  attr/    assets/css/styles.css
i/lf    w/crlf  attr/    assets/js/app.js
i/lf    w/crlf  attr/    index.html
i/lf    w/crlf  attr/    supabase/migrations/20261020120000_harden_excel_imports.sql
i/lf    w/crlf  attr/    vendor/manifest.json
i/lf    w/crlf  attr/    vendor/xlsx.full.min.js
```

### A.2 — Hash do SheetJS

```text
LF  (951.904 bytes): CC015130AA8521E7F088F88898EBA949CCDCBFB38DF0BD129B44B7273C3A6F41
CRLF (951.928 bytes): AC8D774D39BB05A527F87912E2C283E237E3633120B31ACF20BC6EEF0E19EEDE
```

O manifesto registra o hash LF.

### A.3 — Teste SQL

```text
Conteúdo CRLF: 2 matches, 1 sem WHERE  → falha
Conteúdo LF:   1 match,  0 sem WHERE  → passa
```

### A.4 — Suíte

```text
> node --test --test-reporter=tap
# tests 104
# pass 101
# fail 3
```

Falhas:

```text
not ok 70 - servidor local e manifesto de dependências são válidos
not ok 89 - migração de endurecimento fecha o bypass de privilégios e o DELETE sem WHERE
not ok 100 - o sha256 de cada entrada do manifesto confere com o arquivo em disco
```

### A.5 — Tamanhos

```text
vendor/ total ................ 2,66 MB
vendor/xlsx.full.min.js ...... 951.904 B (LF)
vendor/tailwind.js ........... 440,6 KB
vendor/chart.umd.min.js ...... 201,1 KB
vendor/fontawesome/css ....... 100,2 KB
```

### A.6 — Supabase read-only

```sql
-- privilégios efetivos do papel usado pelo dashboard
select
  has_table_privilege('anon','public.excel_imports','SELECT')  as select,
  has_table_privilege('anon','public.excel_imports','INSERT')  as insert,
  has_table_privilege('anon','public.excel_imports','UPDATE')  as update,
  has_table_privilege('anon','public.excel_imports','DELETE')  as delete,
  has_table_privilege('anon','public.excel_imports','TRUNCATE') as truncate;

-- ACL e search_path das funções
select p.proname, p.proacl, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('excel_imports_enforce_single_latest','touch_updated_at');

-- invariantes, triggers e conteúdo
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'excel_imports';

select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.excel_imports'::regclass;

select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.excel_imports'::regclass and not tgisinternal;

select count(*)::int as row_count,
       max(created_at) as created_at,
       max(updated_at) as updated_at,
       max(metadata->>'loadedAt') as metadata_loaded_at
from public.excel_imports;
```

---

## Apêndice B — Escopo e limitações

**Foi feito**

- Leitura de `index.html`, `styles.css`, todos os módulos de `assets/js/`, README,
  `package.json`, `tools/serve.mjs` e da versão anterior deste documento.
- Leitura das 3 migrações e do `vendor/manifest.json`.
- Execução da suíte `node --test`.
- Verificação de fim de linha com `git ls-files --eol`.
- Reprodução do hash LF vs CRLF e do teste SQL.
- Leitura dos 11 arquivos de teste.
- Auditoria read-only do Supabase de produção: privilégios, ACL de funções,
  `search_path`, índices, constraints, triggers, contagem e timestamps.

**Não foi feito**

- Teste de carga real.
- Inspeção visual no navegador.
- Teste de acessibilidade com leitor de tela.
- Análise de segurança ofensiva.

---

## Apêndice C — Invariantes verificadas (V1–V12)

> Verificado por leitura, testes e/ou consulta read-only. **Não “corrigir” por engano.**

| # | Item | Evidência |
|---|---|---|
| V1 | Regra de superset no servidor | rejeita com `P0001 SNAPSHOT_MISSING_RECORDS` + `DETAIL`; snapshot anterior preservado |
| V2 | Serialização de importações concorrentes | `pg_advisory_xact_lock` tomado **antes** de ler o snapshot atual; o 2º importador é validado contra o snapshot do 1º |
| V3 | Upsert não burla a validação | `ON CONFLICT` dispara o `BEFORE INSERT`; dados inválidos são rejeitados; um upsert válido substitui a linha |
| V4 | `records = NULL` / `[]` rejeitados | `SNAPSHOT_INVALID` (`20261019141213_...sql:31-35`) e check `excel_imports_records_is_array` |
| V5 | Sem SQL injection no trigger | sem SQL dinâmico; `raise exception` com placeholders `%` |
| V6 | Atomicidade delete + insert | rollback preserva o estado em qualquer falha |
| V7 | XSS mitigado nos dados | `escapeHtml` nos sinks de registros; `ui.openModal` mantém HTML cru no corpo por design, com cobertura por sink em `tests/xss.test.mjs` (**T4**, fechado no F10) |
| V8 | CSV injection bloqueado | `csvTextCell` prefixa `'`; negativos usam `csvNumberCell` (B2) |
| V9 | Comparação client-side **e** server-side | redundância benéfica, manter |
| V10 | Parser rejeita cabeçalho não reconhecido | `detectHeaderRowIndex` acha cabeçalho deslocado; mensagem de erro clara |
| V11 | `monthlyReference` (ETA → fallback ETS) | registros sem ETA/ETS ficam fora da série; live atual: 10 sem referência |
| V12 | Filtro de mês “nenhum marcado” | dashboard vazio de forma consistente (KPIs, gráficos, tabela, CSV) |

---

## Apêndice D — Mapa rápido de arquivos por achado

| Achado | Arquivos principais |
|---|---|
| F1 | `.gitattributes`, `tests/static.test.mjs`, `tests/vendor.test.mjs`, `vendor/manifest.json` |
| F2 | `assets/js/supabase.js`, `assets/js/app.js`, `tests/persist.test.mjs` |
| F3 | `assets/js/supabase.js`, `assets/js/app.js`, `assets/js/analytics.js` |
| F4 | `supabase/migrations/*.sql`, `assets/js/supabase.js`, `README.md` |
| F5 | `assets/js/app.js`, `index.html`, `assets/js/*.js` |
| F6 | `assets/js/app.js`, `assets/js/supabase.js`, migrações |
| F7 | `index.html`, `vendor/tailwind.js`, `assets/css/styles.css` |
| F8 | raiz, `.github/`, `.gitignore`, `.gitattributes`, `ANALISE.md` |
| F9 | `assets/js/app.js`, `index.html`, `tests/banner.test.mjs`, `tests/search.test.mjs` |
| F10 | `tests/payload.test.mjs`, `tests/xss.test.mjs`, `tests/import-worker-fallback.test.mjs` |
