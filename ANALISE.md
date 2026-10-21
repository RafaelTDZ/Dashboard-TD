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
| F2 | 🔴 P0 | “Mais recente vence” ainda usa timestamp do cliente | `[ ]` |
| F3 | 🟠 P1 | Sem timeout de rede e restauração bloqueante | `[ ]` |
| F4 | 🟠 P1 | Escrita pública sem autenticação e sem histórico | `[ ]` |
| F5 | 🟠 P1 | `app.js` monolítico e acoplamento por globals | `[ ]` |
| F6 | 🟠 P1 | Snapshot inteiro e limite de escala | `[ ]` |
| F7 | 🟡 P2 | Tailwind em runtime e CSP permissiva | `[ ]` |
| F8 | 🟡 P2 | Higiene de engenharia e documentação | `[ ]` |
| F9 | 🟠 P1 | Resumo do dataset e total não persistem no Dashboard | `[ ]` |
| F10 | 🟡 P2 | Cobertura de testes não comprova T3/T4/M5/B6 | `[ ]` |

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
| JS de aplicação | ~3.800 linhas |
| `app.js` | 1.721 linhas |
| `charts.js` | 725 linhas |
| `etl.js` | 787 linhas |
| `state.js` | 225 linhas |
| `ui.js` | 219 linhas |
| `supabase.js` | 81 linhas |
| `analytics.js` + `worker.js` | 48 linhas |
| CSS | 1.076 linhas |
| HTML | 547 linhas |
| Testes | 104 em 11 arquivos |
| Migrações SQL | 3 |
| Vendor | 2,66 MB no total |
| Dataset de referência | ~1,9 mil registros |
| Snapshot remoto | ~2,2 MB após o trim (número registrado na auditoria original) |

---

## 2. Estrutura de diretórios

```text
Dashboard TD/
├─ index.html                  # shell da SPA, 3 abas, CSP, ordem de carga dos scripts
├─ assets/
│  ├─ css/styles.css           # tema, componentes, overrides (1.076 linhas)
│  └─ js/
│     ├─ etl.js                # parsing, mapeamento e canonicalização (787 linhas)
│     ├─ state.js              # filtros, snapshots e compareRecords (225 linhas)
│     ├─ ui.js                 # escapeHtml, formatadores, toast, modal (219 linhas)
│     ├─ charts.js             # 7 gráficos Chart.js (725 linhas)
│     ├─ supabase.js           # cliente REST SELECT/INSERT (81 linhas)
│     ├─ app.js                # orquestrador: DOM, filtros, tabela, import, persistência (1.721 linhas)
│     ├─ worker.js             # parse do Excel em Web Worker (12 linhas)
│     └─ analytics.js          # Vercel Analytics condicional (36 linhas)
├─ supabase/migrations/        # 3 migrações (tabela/RLS, trigger, hardening)
├─ tests/                      # 11 arquivos, 104 testes
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
  ├─ vendor/tailwind.js + tailwind.config inline
  ├─ vendor/chart.umd.min.js
  ├─ vendor/fontawesome/css/all.min.css
  ├─ vendor/fonts/plus-jakarta-sans.css
  ├─ assets/css/styles.css
  └─ assets/js (defer, nesta ordem)
       etl.js → ui.js → charts.js → state.js → supabase.js → app.js
       analytics.js (type="module")
```

> A ordem dos scripts é um **contrato implícito**: `app.js` assume que todos os
> globals (`ETL`, `UI`, `Charts`, `DashboardState`, `SupabaseStorage`) já existem.

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

- [ ] `metadata.loadedAt` no futuro é ignorado na escolha nuvem/cache
- [ ] A escolha usa `created_at` retornado pelo Supabase
- [ ] “Última leitura” reflete o horário do servidor
- [ ] Cache local pós-save também usa o timestamp do servidor
- [ ] Teste de persistência usa `created_at`, não `metadata.loadedAt`
- [ ] Importação e restauração continuam funcionando
- [ ] Teste automatizado cobre o cenário

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

- [ ] Fetch remoto tem timeout configurável
- [ ] Offline/rede lenta mostra o cache local sem esperar o Supabase
- [ ] POST pendurado não deixa a UI em “Processando…” indefinidamente
- [ ] Nenhum `unhandled rejection` no console
- [ ] Teste com fetch que nunca resolve (ou demora) cobre o timeout

---

### 🟠 F4 — Escrita pública sem autenticação e sem histórico (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js` · `supabase/migrations/20261020120000_harden_excel_imports.sql` |
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

**Critérios de aceite**

- [ ] Decisão A/B/C registrada
- [ ] Se B/C: `anon` não consegue mais inserir
- [ ] Histórico contém uma linha por importação aceita
- [ ] Procedimento de rollback testado
- [ ] README documenta o modelo de escrita e o risco residual

---

### 🟠 F5 — `app.js` monolítico e acoplamento por globals (P1)

| | |
|---|---|
| **Arquivos** | `assets/js/app.js` (1.721 linhas, ~81 funções) · `index.html:40-47` |
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

Cada passo deve terminar com `node --test` 104/104 e nenhuma mudança visual.

**Critérios de aceite**

- [ ] `app.js` abaixo de ~400 linhas
- [ ] Nenhum comportamento alterado (smoke test manual)
- [ ] 104/104 testes verdes
- [ ] Contratos de snapshot e canonicalização preservados
- [ ] Worker continua funcionando

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
| **Arquivos** | `index.html:12-13` · `vendor/tailwind.js` · `assets/css/styles.css` |
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

**Critérios de aceite**

- [ ] Tailwind compilado e versionado (ou gerado no deploy)
- [ ] Nenhum aviso de Play CDN no console
- [ ] CSP sem `unsafe-eval`
- [ ] `connect-src` restrito ao projeto correto
- [ ] Comparação visual antes/depois (screenshot)
- [ ] 104/104 testes verdes

---

### 🟡 F8 — Higiene de engenharia e documentação (P2)

| | |
|---|---|
| **Arquivos** | raiz do projeto · `ANALISE.md` · `package.json` |
| **Esforço** | 🟡 ~3-4 h |
| **Risco** | Baixo |

**Evidência**

- Não há `.gitignore`, `.gitattributes`, `.github/` nem `vercel.json`.
- `.agents/` está untracked (skill do Supabase via MCP).
- Sem ESLint/Prettier/type check.
- A versão anterior deste documento tinha deriva: topo falava em 55 testes,
  log em 103, A2/B17 em 104; painel declarava 32 concluídos/2 pendentes, mas o
  real é 31/3; 8 itens `[x]` eram parciais (A2, M2, M5, M7, B6, B9, T3, T4);
  checkboxes internos desmarcados em A1/A3/M1–M8; B10/B14/B16 abertos.
- Regras duplicadas (`isEmptyValue` vs `isEmptyPersistedValue`; canonicalização
  no ETL e no `app.js`) dependem de disciplina para não divergir.

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

**Critérios de aceite**

- [ ] `.gitignore` cobre artefatos locais
- [ ] CI roda em Linux e Windows
- [ ] Documento único sem contagens/checkboxes contraditórios
- [ ] Regras de normalização têm uma única fonte de verdade
- [ ] Decisão sobre `.agents/` registrada

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

- [ ] Após 8 s (e após reload), o Dashboard mostra o nome do arquivo carregado
- [ ] O Dashboard mostra o total do dataset e o total filtrado sem trocar de aba
- [ ] O texto da tabela não repete “de” de forma ambígua
- [ ] Teste cobre o estado depois que o timer do banner dispara

---

### 🟡 F10 — Cobertura de testes não comprova T3/T4/M5/B6 (P2)

| | |
|---|---|
| **Arquivos** | `tests/payload.test.mjs` · `tests/ui.test.mjs` · `tests/hardening.test.mjs` |
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

- [ ] Payload tem limite absoluto testado
- [ ] Pelo menos um teste por sink de HTML (ou `openModal` deixa de aceitar HTML cru)
- [ ] Fallback do Worker tem teste de não congelamento/não duplicação
- [ ] Comparação tem teste de campo novo do parser

---

### Auditoria dos 34 itens originais

> Feita em 21/10/2026 contra o commit `f185f84`, antes da consolidação deste
> documento. Status: ✅ confirmado no código/teste/live · 🟡 parcial · ⏳
> pendente. “Live” = consulta read-only ao Supabase de produção; nenhum dado foi
> alterado.

**Resumo:** 23 confirmados, 8 parciais e 3 pendentes. A versão anterior declarava
32 concluídos e 2 pendentes; a contagem correta é 31 e 3, e 8 dos 31 “concluídos”
não atendem integralmente ao critério de aceite.

| Item | Status | Evidência / lacuna |
|---|---|---|
| A1 | ✅ | Live: `anon` tem `SELECT`/`INSERT`; `UPDATE`/`DELETE`/`TRUNCATE` são negados; RLS ligada. README atualizado. Checkboxes internos continuam `[ ]`. |
| A2 | 🟡 | Estado vazio persistente e com dataset transitório (8 s) testados. Depois de 8 s só resta `#last-read-header` com data/hora, sem arquivo nem total. O texto original dizia “visível em 4,5 s / oculto em ~6 s”. |
| A3 | ✅ | `_search` é recalculado depois da canonicalização (`app.js:215-220`); `tests/search.test.mjs:340+` cobre com/sem acento. |
| A4 | ✅ | Migração e função live usam `delete ... where id in (...)`; teste de regressão existe, mas falha no Windows por CRLF (F1). |
| M1 | ✅ | Live: 1.944 registros, 0 com `_search`. `toPersistedRecord` também remove `null`/`''`/arrays vazios; o bloco original mostrava só `_search` (deriva documental; ver DA4 b). |
| M2 | 🟡 | Live: `created_at` e `updated_at` são do servidor, mas `supabase.js:70` ainda prefere `metadata.loadedAt`; `tests/persist.test.mjs:660` espera o valor do cliente; o cache local pós-save também fica com o valor do cliente. |
| M3 | ✅ | Live: índice único `excel_imports_singleton` e check `excel_imports_records_is_array`. |
| M4 | ✅ | SheetJS 0.20.3 no bundle e no manifesto. O hash só confere em LF; no Windows o teste falha por CRLF (F1). |
| M5 | 🟡 | Guardas `settled` e `runWhenIdle` existem, mas o fallback ainda executa `parseWorkbook` síncrono na main thread se o Worker falhar antes do timeout; “interface não congela” não é garantido/testado. |
| M6 | ✅ | Live: ACL da função só tem `postgres` e `service_role`; `anon` sem `EXECUTE`. |
| M7 | 🟡 | CSP existe e é testada, mas `script-src` inclui `'unsafe-inline'` **e** `'unsafe-eval'`; o bloco documentado cita apenas `'unsafe-inline'`. |
| M8 | ✅ | Live: `search_path=""` na função de trigger. |
| B1 | ✅ | `canonicalizeDataset` roda antes do rebuild de `_search` (`app.js:215-220`). |
| B2 | ✅ | `csvNumberCell` mantém negativo como número; `tests/payload.test.mjs:404+` cobre. |
| B3 | ✅ | Funcional: `statusBannerLocked` no mesmo `#banner-text`. O texto original ainda falava em `#banner-error` separado (deriva documental). |
| B4 | ✅ | Limite `PERSIST_RETRY_LIMIT = 10`; `endSnapshotValidation` retoma a persistência. |
| B5 | ✅ | `LATEST` só em comentário; `isSuperset` documentado como API pública. |
| B6 | 🟡 | `recordFingerprint` ignora `_search`, `sourceRowNumber` e vazios, mas ainda inclui todas as chaves; campo novo no parser marca todos como atualizados (reproduzido: `updated=1`, `unchanged=0`). |
| B7 | ✅ | Live: trigger `excel_imports_touch_updated_at`. |
| B8 | ✅ | `parseExcelDate` rejeita seriais fora de 1–80.000. |
| B9 | 🟡 | `table-count` mostra “3 de 4” na aba Tabela; o KPI só mostra filtrados e o Dashboard não tem “861 de 1.944” após o banner. As métricas originais 858/1.942 estão velhas (live: 861/1.944). |
| B10 | ⏳ | Tailwind Play CDN continua compilando em runtime. |
| B11 | ✅ | Manifesto com Tailwind 3.4.16, analytics 2.0.1 e versões reais. |
| B12 | ✅ | `role="group"`, `aria-controls`, `aria-haspopup`, `aria-expanded` e um único rótulo no ano. |
| B13 | ✅ | Guarda para `tab` nula no handler do tablist, com teste. |
| B14 | ⏳ | Timeouts continuam `anon=3s`, `authenticated=8s`, `authenticator=8s/8s` (live). |
| B15 | ✅ | `analytics.js` condiciona a injeção a host local/Vercel e faz HEAD em domínio próprio. |
| B16 | ⏳ | Fonte ainda com versão `unknown` no manifesto. |
| B17 | ✅ | `serve.mjs` envia `Cache-Control: no-store`; `ensureXlsxLoaded` usa `?v=` e retry com `&t=`. |
| T1 | ✅ | `tests/banner.test.mjs` cobre estado vazio persistente, com dataset transitório e refresh. |
| T2 | ✅ | `tests/search.test.mjs:340+` cobre acento, sem acento, parcial e operação. |
| T3 | 🟡 | `tests/payload.test.mjs:353-367` só exige queda relativa de 25%; não há limite absoluto. |
| T4 | 🟡 | `escapeHtml` é testado isoladamente; não há teste por sink. `ui.openModal` aceita HTML cru. |
| T5 | ✅ | `tests/vendor.test.mjs:74-111` exige SheetJS >= 0.20.2 e confere manifesto/cache-busting. |
| V1–V12 | ✅ | Confirmados por código e/ou live, com duas ressalvas de redação/cobertura: V3 diz “upsert é rejeitado”, mas um upsert válido substitui a linha; V7 não tem teste por sink (ver T4). |

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

### Pendências herdadas (B10, B14, B16)

| Item | Evidência | Correção sugerida | Critério de aceite |
|---|---|---|---|
| **B10** | Tailwind Play CDN compila em runtime; CSP precisa de `'unsafe-eval'`; console avisa para não usar em produção. | Compilar CSS estático varrendo `index.html` **e** `assets/js/*.js` (classes de badge/status só existem em strings); ou manter o runtime documentando o trade-off (D3/D5). | CSS estático, visual equivalente e console limpo. |
| **B14** | `anon=3s`, `authenticated=8s`, `authenticator=8s/8s`; o `anon` é o papel usado pelo dashboard. | Aumentar `statement_timeout` do `anon` (ex.: 30 s) ou mover a escrita para Edge Function com timeout próprio (DA5). | Importação do dataset real sem timeout. |
| **B16** | `Plus Jakarta Sans` está com `"version": "unknown"` no manifesto. | Identificar a versão real do CSS do Google Fonts e fixar origem/hash; ou registrar explicitamente que a versão não é rastreável. | Manifesto sem `unknown` ou exceção documentada. |

### Decisões da auditoria original (DA1–DA5)

> Estes IDs são históricos e não se confundem com as decisões **D1–D5** do plano atual.

| ID | Decisão | Opções | Estado |
|---|---|---|---|
| DA1 | Filtro de ano padrão (B9) | (a) ano corrente + exibir total; (b) “Todos os anos” | ✅ (a) aplicada, mas o total ficou só na aba Tabela (ver F9) |
| DA2 | Onde exibir o resumo do dataset (A2) | (a) card permanente; (b) barra de filtros; (c) cabeçalho; (d) card de status transitório | ✅ (d) aplicada; o cabeçalho persistente ficou incompleto (ver F9) |
| DA3 | Compilar o Tailwind (B10) | (a) sim, CSS estático; (b) manter Play CDN | ⏸️ aberta; corresponde a D3/D5 |
| DA4 | Recorte de payload (M1) | (a) só `_search`; (b) também campos vazios; (c) Storage + Edge Function | ✅ (b) aplicada; (c) evolução futura |
| DA5 | Timeout do `anon` (B14) | (a) 30 s; (b) Edge Function | ⏸️ aberta |

---

## 9. Plano de execução

### Fase 0 — Preparação

- [x] Criar branch de trabalho (`chore/estrutura-correcoes`)
- [x] Confirmar árvore limpa (exceto `.agents/`)
- [x] Rodar `node --test` e registrar o baseline (101/104 no Windows)
- [ ] Fotografar/validar visualmente o dashboard atual

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
| F10 | limites absolutos + testes de sink/Worker/fingerprint | suíte verde nos dois SOs |

---

## 10. Decisões pendentes

| ID | Decisão | Opções | Estado |
|---|---|---|---|
| D1 | Modelo de escrita (**F4**) | A: público documentado · B: Auth · C: Edge Function | ⏸️ aberto |
| D2 | Escala do snapshot (**F6**) | A: manter · B: Storage · C: normalizado · D: híbrido | ⏸️ aberto |
| D3 | Tailwind (**F7**) | A: compilar agora · B: manter runtime | ⏸️ aberto |
| D4 | `.agents/` | A: versionar · B: ignorar | ⏸️ aberto |
| D5 | Restrição “sem build” | A: manter (CSS gerado versionado) · B: permitir build no deploy | ⏸️ aberto |

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
| V7 | XSS mitigado nos dados | `escapeHtml` nos sinks de registros; `ui.openModal` ainda aceita HTML cru e a cobertura por sink é **T4** |
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
| F10 | `tests/payload.test.mjs`, `tests/ui.test.mjs`, `tests/hardening.test.mjs`, `assets/js/ui.js` |
