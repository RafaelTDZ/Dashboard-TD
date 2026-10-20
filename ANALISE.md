# Análise de erros e melhorias — BI Integration Hub

> Documento de trabalho para acompanhamento **ponto a ponto**.
> Criado em 20/10/2026 a partir de uma revisão completa do repositório (código, migrações SQL,
> suíte de testes, execução real no browser e leitura do banco Supabase de produção).
>
> - **55/55 testes passam** (`node --test`) e **não há erros de runtime** no console.
> - Nenhum arquivo do projeto foi alterado durante a análise. O banco foi apenas lido (`SELECT`).

---

## Como usar este documento

- Cada item tem um **ID estável** (`A1`, `M4`, `B7`, `T3`) — use-o em commits e PRs.
- Marque `[ ]` → `[~]` (em andamento) → `[x]` (concluído) e registre em **Registro de execução**.
- O bloco **🔒 Não mexer** lista o que foi verificado como correto — não "corrigir" por engano.
- Itens com **⚠️ Decisão de produto** precisam de confirmação antes de implementar.

**Legenda de severidade**

| | Significado |
|---|---|
| 🔴 **A** | Alto — risco de perda de dados, bypass de segurança ou usuário sem informação |
| 🟡 **M** | Médio — funcionalidade degradada, payload excessivo, risco de segurança latente |
| 🟢 **B** | Baixo — manutenção, robustez, acessibilidade, limpeza |

---

## Painel de progresso

| Severidade | Itens | Concluídos | Em andamento | Pendentes |
|---|---:|---:|---:|---:|
| 🔴 Alto | 4 | 4 | 0 | 0 |
| 🟡 Médio | 8 | 8 | 0 | 0 |
| 🟢 Baixo | 17 | 15 | 0 | 2 (B10, B14) + B16 |
| 🧪 Testes | 5 | 5 | 0 | 0 |
| **Total** | **34** | **32** | **0** | **2** |

> **Pendentes e por quê**
> - **B10** (compilar o Tailwind) — decisão de produto D3; risco de regressão visual maior que
>   o benefício (as classes de badge existem só em strings do `app.js`).
> - **B14** (timeouts do papel `anon`) — decisão de produto D5; hoje há folga enorme
>   (3 s para 61 ms de trabalho real).
> - **B16** (versão do Plus Jakarta Sans no manifesto) — exige o artefato de origem.
>
> **A4, B14 e B15** não existiam na análise inicial: foram descobertos durante a execução
> (A4 por execução real do `INSERT`; B14 por `pg_roles.rolconfig`; B15 pelo 404 do analytics).

---

## 🔴 ALTO

### [x] A1 — `anon` mantém `TRUNCATE`/`UPDATE`/`DELETE`; a regra de superset pode ser burlada

| | |
|---|---|
| **Arquivos** | `supabase/migrations/20261009142126_create_excel_imports.sql:20` |
| **Impacto** | Perda de dados + bypass completo da validação de superset |
| **Esforço** | 🟢 5 min (1 migração SQL) |

**Diagnóstico**

O `grant select, insert` é **aditivo**. O ACL padrão do Supabase já concedeu `ALL` ao `anon`/`authenticated`.
ACL vivo verificado:

```
relacl = {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
          authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
```

| Comando como `anon` | Resultado |
|---|---|
| `UPDATE` | 0 linhas (RLS bloqueia — não há policy) ✔ |
| `DELETE` | 0 linhas (RLS bloqueia) ✔ |
| **`TRUNCATE`** | **SUCEDE — apaga tudo.** RLS não se aplica a `TRUNCATE` ✘ |

`TRUNCATE` não dispara trigger de linha, então o guard de superset
(`20261019141213_excel_imports_single_latest.sql:78`) é simplesmente pulado.
A cadeia `TRUNCATE → INSERT` destrói o dataset de 1.942 processos e reinsere sem validação alguma.

O README (linha 28) afirma que a chave "permite apenas ler e inserir" — isso é verdade no
*comportamento* (não há policy de UPDATE/DELETE), mas **não no nível de privilégio**.

**Correção**

```sql
revoke all on table public.excel_imports from anon, authenticated;
grant select, insert on table public.excel_imports to anon;
```

O trigger é `SECURITY DEFINER` propriedade do dono, portanto continua podendo deletar.

> ⚠️ **NÃO** usar `alter table ... force row level security` — o `delete` interno do trigger
> passaria a ser sujeito à RLS (sem policy de DELETE) e o singleton quebraria silenciosamente.

**Verificação**

```sql
set local role anon;
truncate table public.excel_imports;  -- deve falhar com 42501 permission denied
```

- [ ] Migration criada e aplicada
- [ ] `TRUNCATE` como `anon` retorna `42501`
- [ ] `INSERT` e `SELECT` como `anon` continuam funcionando
- [ ] Importação pelo dashboard segue funcionando
- [ ] README atualizado (linha 28) para refletir os privilégios reais

---

### [x] A2 — A mensagem de estado vazio e o resumo do arquivo são invisíveis

| | |
|---|---|
| **Arquivos** | `index.html` (`#status-banner`) · `assets/css/styles.css` · `assets/js/app.js` (`updateBanner`, `showStatusBanner`) |
| **Impacto** | Usuário não vê o que está carregado nem como começar |
| **Esforço** | 🟡 ~2 h (HTML + CSS + teste) |

**Diagnóstico**

`#banner-text` (`index.html:110`) está **dentro** de `#status-banner`, que nasce com o atributo
`hidden` (`index.html:107`) e tem `display: none !important` (`styles.css:57-59`).
Mas `updateBanner()` (`app.js:744-762`) escreve justamente nesse elemento.

Verificado no browser (dados reais carregados):

```js
{
  bannerHiddenAttr: true,
  bannerDisplay: "none",
  bannerRect: { w: 0, h: 0 },
  bannerTextContent: "!Importações (59).xlsx • Guia !Importações • 1.942 processos
                      • Cabeçalho na linha 1 • 59 comentário(s)"
}
```

O texto é preenchido e **nunca aparece**. O card só é revelado por 8 s após um upload
(`app.js:782-796`).

**Consequências**

- Passo 1 do smoke test do README ("confirme o estado inicial vazio — banner
  'Nenhum arquivo carregado'") é **não observável**.
- Quem recarrega a página não descobre qual arquivo está carregado, quantos processos
  existem, nem há comentário na aba `Comments`.
- Combinado com **B9** (filtro de ano padrão oculta 56% dos dados), o usuário não tem
  como saber que existe mais informação disponível.

**Correção — card único com dois modos** (decisão final, 20/10)

O `#status-banner` voltou a ser o **único** cartão de status, com dois modos:

| Situação | Comportamento |
|---|---|
| **Sem arquivo** (estado inicial) | visível, mostra "Nenhum arquivo carregado. Clique em **Carregar Excel Atualizado**…" e **fica** (sem timer) |
| **Com arquivo** (importação ou restauração) | visível, mostra "!Importações.xlsx • Guia … • 1.944 processos • 4 comentário(s)" e **some sozinho** em 8 s (fade de 300 ms) |
| **Erro fatal de inicialização** | visível, sem timer, e **travado** (`statusBannerLocked`) para que um `refresh()` não apague a mensagem (B3) |

Implementação:
- `updateBanner()` escreve o resumo em `#banner-text` / `#last-update-time` e **nunca** mexe
  na visibilidade.
- `showStatusBanner(transient)` centraliza a revelação: com `transient = true` arma o timer
  de 8 s; com `false` deixa o card visível sem timer.
- O estado inicial decide o modo em `init()`: `showStatusBanner(!!snapshot)`.
- A visibilidade nunca é mudada por `refresh()` — o card não reaparece a cada tecla digitada.
- O card `#dataset-summary` (criado na primeira rodada) foi **removido**: dois cartões para a
  mesma informação eram redundantes. A informação persistente ficou no cabeçalho
  (`#last-read-header` → "Última leitura: 20/10/2026 às 10:18").

**Verificação**

- [x] Com dataset, o resumo aparece e **some sozinho** (medido: visível em 4,5 s, oculto em ~6 s)
- [x] Sem dataset, "Nenhum arquivo carregado…" fica **visível** e não expira
- [x] Mudança de filtro (`refresh()`) **não** ressuscita o card
- [x] `tests/banner.test.mjs` reescrito para checar **visibilidade**, não só `hidden`
- [x] `tests/hardening.test.mjs` e `tests/static.test.mjs` ajustados
- [x] `node --test` → **104 testes, 100% verde**

---

### [x] A3 — A busca e o filtro de operação ignoram acentos

| | |
|---|---|
| **Arquivos** | `assets/js/app.js:142-149` (índice `_search`), `:663` (filtro operação), `:687` (busca) |
| **Impacto** | Usuário digita "acido" e não acha nada |
| **Esforço** | 🟢 ~30 min |

**Diagnóstico**

`prepareRecord` monta `_search` com `String(...).toLowerCase()` e sem normalizar diacríticos.
A comparação em `matchesFilters` é `indexOf` literal.

Medido no browser com o dataset real:

| Busca | Resultado |
|---|---|
| `ácido fosfórico` | 5 registros ✔ |
| `ÁCIDO FOSFÓRICO` | 5 registros ✔ |
| `acido fosforico` | **0 registros** ✘ |
| `fosfor` | **0 registros** ✘ |

Em português é comum digitar sem acentuação (teclado sem acentuação automática, colar de e-mail).

**Correção**

```js
// helper único, usado na preparação e na consulta
function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
```

Aplicar em `app.js:142-149` (construção do `_search`) **e** em `app.js:663` / `app.js:687`
(comparação). Manter o `_search` original (com acento) para exibição/exportação — só o índice
e a consulta usam a forma normalizada.

**Verificação**

- [ ] `acido fosforico` retorna os mesmos 5 registros que `ácido fosfórico`
- [ ] `fosfor` (parcial) retorna resultados
- [ ] Busca por acento continua funcionando
- [ ] Busca por operação (`BRP018`) continua funcionando
- [ ] Teste automatizado adicionado (ver **T2**)

---

### [x] A4 — Toda importação estava quebrada em produção (achado durante a correção)

| | |
|---|---|
| **Arquivos** | `supabase/migrations/20261019141213_excel_imports_single_latest.sql:87` → corrigido em `20261020120000_harden_excel_imports.sql` |
| **Impacto** | 🔴 **100% das importações falhavam** desde 19/10/2026 |
| **Esforço** | 🟢 1 linha + 1 migração |

**Diagnóstico**

O papel `authenticator` do projeto tem `session_preload_libraries=supautils, safeupdate`
(confirmado em `pg_roles.rolconfig`). A lib `safeupdate` recusa **qualquer `DELETE` sem `WHERE`** —
inclusive o `delete from public.excel_imports;` interno do trigger, disparado pelo POST do app.

O erro real era `400 / SQLSTATE 21000 / "DELETE requires a WHERE clause"`. Como o trigger foi
criado em **19/10** e o último import bem-sucedido é de **16/10**, nenhuma importação funcionava
desde então — a falha só não era visível porque o app degrada para "ficou salvo apenas neste
navegador" sem erro claro.

> Este bug **não** apareceu na análise estática: só emerge executando o INSERT real.
> O agente de hardening o reproduziu com A/B via HTTP real (função original → `400 21000`;
> função corrigida → `201 Created`).

**Correção**

```sql
delete from public.excel_imports
  where id in (select id from public.excel_imports);
```

**Verificação**

- [x] Migration `20261020120000` aplica a forma com `WHERE`
- [x] POST real com o corpo exato de `supabase.js` → `201 Created`
- [x] POST com `records` incompleto → `400 SNAPSHOT_MISSING_RECORDS` (comportamento correto)
- [x] Teste de regressão em `tests/` impede a volta do `DELETE` sem `WHERE`
- [x] README documenta o motivo

---

## 🟡 MÉDIO

### [x] M1 — O snapshot enviado ao Supabase carrega o índice de busca derivado (15% do payload)

| | |
|---|---|
| **Arquivos** | `assets/js/app.js:1409-1429` (`buildSnapshot`), `:1455-1463` (`persistState`) |
| **Impacto** | 3,27 MB baixados por carga de página e reenviados a cada importação |
| **Esforço** | 🟡 ~1 h |

**Diagnóstico**

`buildSnapshot()` usa `state.dataset`, que já passou por `prepareRecord` e portanto **inclui
`_search`**. Medido no banco de produção:

```
records (1.942 registros) .... 3.008.001 bytes
_search ......................   445.657 bytes  →  14,8%
campos null ..................   144.282 bytes
strings vazias ...............   126.829 bytes
arrays vazios ................    22.824 bytes
resposta REST completa ....... 3.270.999 bytes (gzip no transporte)
```

`_search` é dado **derivado** e já é excluído de `recordFingerprint` (`state.js:101-108`),
ou seja, o próprio código já o considera não-essential.

**Correção**

Criar `toPersistedRecord(record)` em `app.js`:

```js
function toPersistedRecord(record) {
  const copy = Object.assign({}, record);
  delete copy._search;                 // índice derivado, recalculado no restore
  return copy;
}
```

Aplicar em `buildSnapshot()` (para o payload remoto **e** o cache local).
**Atenção:** aplicar a **mesma** normalização nos dois lados da comparação em
`handleFileUpload` (`app.js:1219`), senão todo registro vira "atualizado" no resumo.

**Verificação**

- [ ] `records` no banco não contém mais a chave `_search`
- [ ] Tamanho de `records` cai de ~3,0 MB para ~2,5 MB
- [ ] A busca continua funcionando após restaurar do Supabase
- [ ] O resumo de importação não passa a reportar "1.942 atualizados"

---

### [x] M2 — `created_at` e `metadata.loadedAt` são controlados pelo cliente

| | |
|---|---|
| **Arquivos** | `assets/js/supabase.js:70` · `assets/js/app.js:1496-1498` · trigger |
| **Impacto** | Cliente pode monopolizar a ordenação "mais recente vence" |
| **Esforço** | 🟢 ~30 min |

**Diagnóstico**

- `supabase.js:70` usa `row.metadata.loadedAt` (escrito pelo cliente) como fonte de `loadedAt`.
- `app.js:1496-1498` decide entre nuvem e cache local comparando esse valor.
- O trigger **não** sobrescreve `created_at`, e o `order by created_at desc`
  (`20261019141213_...sql:61` e `supabase.js:60`) aceita qualquer valor enviado pelo cliente.

Testado: um `INSERT` com `created_at='1970-01-01'` e `updated_at='2999-01-01'` é aceito
verbatim. Com um `loadedAt` no futuro, o cliente ganha o tie-break contra o cache de
outros navegadores indefinidamente.

**Correção**

```sql
-- dentro do trigger, antes do return new;
new.created_at := now();
new.updated_at := now();
```

E trocar o tie-break em `app.js:1496-1498` para usar `created_at` (servidor) em vez de
`metadata.loadedAt`.

**Verificação**

- [ ] `created_at` enviado pelo cliente é ignorado
- [ ] Tie-break nuvem/cache usa timestamp do servidor
- [ ] Importação e restauração continuam funcionando

---

### [x] M3 — A invariante "uma única linha" só existe no trigger

| | |
|---|---|
| **Arquivos** | `supabase/migrations/20261019141213_excel_imports_single_latest.sql:92-95` |
| **Impacto** | Trigger desabilitado ⇒ linhas se acumulam e a ordenação vira indefinida |
| **Esforço** | 🟢 ~15 min |

**Diagnóstico**

O trigger é `before insert` apenas. Não há `unique index`, nem `check`, nem arm `before update`.
Se o trigger for desabilitado/dropado, as linhas se acumulam e a seleção do "último snapshot"
passa a depender de `created_at` — que é controlado pelo cliente (ver **M2**).

**Correção**

```sql
create unique index if not exists excel_imports_singleton
  on public.excel_imports ((true));

alter table public.excel_imports
  add constraint excel_imports_records_is_array
  check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) > 0);
```

> A unique index muda o comportamento de `INSERT` multi-linha: de "colapsa na última" para
> "falha com violação de unicidade". É a falha ruidosa desejada.

**Verificação**

- [ ] `insert` de 2 linhas em uma transação falha
- [ ] Tabela nunca passa de 1 linha
- [ ] `records` vazio/`null` é rejeitado pelo `check`

---

### [x] M4 — SheetJS vendorizado está desatualizado e com CVEs conhecidos

| | |
|---|---|
| **Arquivos** | `vendor/xlsx.full.min.js` (0.18.5) vs `package.json:17` (0.20.3) · `vendor/manifest.json` |
| **Impacto** | Prototype Pollution e ReDoS ao processar planilhas |
| **Esforço** | 🟡 ~1 h |

**Diagnóstico**

`vendor/xlsx.full.min.js` é a versão **0.18.5** (confirmado no conteúdo do arquivo), mas
`package.json:17` declara `xlsx@0.20.3`. O dashboard executa **sempre** o `vendor/` — a
dependência npm nunca entra em cena, criando uma falsa sensação de segurança.

0.18.5 é afetada por:
- **CVE-2023-30533** — Prototype Pollution (corrigido em 0.19.3)
- **CVE-2024-22363** — ReDoS no parser (corrigido em 0.20.2)

**Correção**

1. Baixar `xlsx-0.20.3.tgz` de `cdn.sheetjs.com` e extrair `dist/xlsx.full.min.js`
   para `vendor/xlsx.full.min.js`.
2. Atualizar o `sha256` e a `version` em `vendor/manifest.json`.
3. Rodar `node --test` (o teste de parsing usa `vendor/xlsx.full.min.js`).

**Verificação**

- [ ] `vendor/xlsx.full.min.js` reporta versão ≥ 0.20.2
- [ ] `vendor/manifest.json` com hash e versão corretos
- [ ] `node --test` passa
- [ ] Importação do `data/Importaes-63cc10.xlsx` continua com 1.898 processos / 3 comentários

---

### [x] M5 — O fallback de parsing pode congelar a interface

| | |
|---|---|
| **Arquivos** | `assets/js/app.js:1000-1042` (em especial `:1030-1034`) |
| **Impacto** | Aba travada em arquivo grande ou malformado |
| **Esforço** | 🟢 ~30 min |

**Diagnóstico**

```js
worker.onerror = function (event) {
  console.error('Falha no Worker de importação; usando o processamento principal.', event);
  try { finish(global.ETL.parseWorkbook(buffer)); }   // ← parse síncrono na main thread
  catch (error) { finish({ error: error }); }
};
```

Se o worker estourou o timeout de 90 s (`app.js:1023-1025`), `settled` já é `true` e
`finish()` retorna cedo — **mas** `global.ETL.parseWorkbook(buffer)` ainda executa, de forma
síncrona, na thread principal. Com ReDoS isso pode travar a aba por tempo indeterminado.
O caminho de fallback em `app.js:1009-1013` (quando `new Worker` lança) tem o mesmo problema.

**Correção**

- Não reexecutar o parse se o timeout já disparou (`if (settled) return;` **antes** do parse).
- Sinalizar o progresso (`"Processando…"`) antes do parse na main thread.
- Considerar `requestIdleCallback`/chunking para arquivos grandes.

**Verificação**

- [ ] Worker com timeout não provoca parse na main thread
- [ ] Interface não congela ao processar arquivo grande

---

### [x] M6 — Função `SECURITY DEFINER` executável por `anon`

| | |
|---|---|
| **Arquivos** | `supabase/migrations/20261019141213_excel_imports_single_latest.sql:15-20` |
| **Impacto** | Entry point `SECURITY DEFINER` exposto publicamente |
| **Esforço** | 🟢 5 min |

**Diagnóstico**

`proacl` mostra `EXECUTE` concedido a `PUBLIC` (default do Postgres). O linter do Supabase
sinaliza `anon_security_definer_function_executable` (nível WARN).

Hoje é inofensivo: uma chamada direta falha com
`0A000: trigger functions can only be called as triggers`. Mas continua sendo um entry point
`SECURITY DEFINER` alcançável — se a função um dia virar função comum, vira escalação.

**Correção**

```sql
revoke execute on function public.excel_imports_enforce_single_latest()
  from public, anon, authenticated;
```

**Verificação**

- [ ] `EXECUTE` revogado para `public`/`anon`/`authenticated`
- [ ] Trigger continua funcionando (o trigger não depende do `EXECUTE` do cliente)

---

### [x] M7 — Não há Content-Security-Policy

| | |
|---|---|
| **Arquivos** | `index.html` (head) · opcionalmente `vercel.json` |
| **Impacto** | Ausência de barreira contra XSS futuro |
| **Esforço** | 🟢 ~30 min |

**Diagnóstico**

`ui.js:153` faz `modal-body.innerHTML = options.html` — um sink de HTML cru.
Hoje todo o conteúdo passado é montado com `escapeHtml` (verificado: um `<img src=x onerror=...>`
injetado em `records` fica armazenado verbatim e nunca executa). Mas não há CSP para travar
um sink futuro que esqueça o escape.

**Correção**

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' https://*.supabase.co; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'">
```

> Atenção: `'unsafe-inline'` no `script-src` é necessário por causa do `tailwind.config`
> inline (`index.html:9-31`). Removê-lo exige mover a config para arquivo.

**Verificação**

- [ ] CSP ativo sem quebrar Tailwind, Chart.js, Font Awesome, Worker e Supabase
- [ ] Console sem violações de CSP

---

### [x] M8 — `search_path` do trigger mais permissivo do que o necessário

| | |
|---|---|
| **Arquivos** | `supabase/migrations/20261019141213_excel_imports_single_latest.sql:19` |
| **Impacto** | Superfície de shadowing desnecessária |
| **Esforço** | 🟢 5 min |

**Diagnóstico**

`set search_path = public, pg_temp`. Não é explorável hoje (`pg_catalog` é sempre pesquisado
primeiro e o `anon` só tem `USAGE` em `public`, sem `CREATE`), mas todo o corpo da função já
é schema-qualified — dá para endurecer.

**Correção**

```sql
set search_path = ''
```

**Verificação**

- [ ] Trigger continua funcionando com `search_path = ''`

---

## 🟢 BAIXO

### [x] B1 — `_search` é calculado antes da canonicalização (latente)

`assets/js/app.js:165-166` — `prepareRecord` monta `_search` e **só depois** `canonicalizeDataset`
altera `analista`/`origem`/`destino`/`mercadoria`/`despachante`. Hoje é inofensivo porque o worker
já canonicaliza antes (`etl.js:711-714`) e a canonicalização é idempotente — mas qualquer
reordenação futura quebra a busca **silenciosamente**.
**Correção:** canonicalizar antes de computar `_search` (mover o bloco `_search` para o fim de
`prepareRecord` ou canonicalizar antes do `map`).

### [x] B2 — CSV: valores negativos viram texto no Excel

`assets/js/app.js:912-916` — `csvCell` prefixa `'` em qualquer texto que comece com `-`.
`app.js:935` gera `"-1234,56"` para valores negativos → o Excel/Power BI lê como **texto** e a
agregação quebra. (Hoje há 0 negativos em 1.942 registros, mas `parseNumber` aceita negativos
e `operacao`/`exportador` são textos livres.)
**Correção:** aplicar a proteção contra fórmula **apenas a campos de texto**, não aos numéricos
(`Valor informado`, `Valor USD`, `Peso`, `Free time`, `Dias p/ ...`).

### [x] B3 — `showStatusBannerError` sobrescreve a mensagem de `updateBanner`

`assets/js/app.js:800-808` — escreve em `#banner-text`, o **mesmo** elemento de `updateBanner`
(`app.js:751`/`757`). Um `refresh()` posterior (ex.: mudança de filtro) apaga o erro de
inicialização. É exatamente o motivo do comentário em `app.js:798-799`, mas o bug permanece.
**Correção:** elementos separados — `#banner-text` (status) e `#banner-error` (erro fatal).
*(Relacionado a **A2** — resolver juntos.)*

### [x] B4 — `schedulePersist` se reagenda indefinidamente

`assets/js/app.js:1367-1372` — enquanto `pendingSnapshotValidations > 0`, `schedulePersist` se
reagenda a cada 600 ms. Se uma importação travar (fetch pendurado), o timer roda para sempre.
**Correção:** limitar as tentativas ou usar um flag `pendingPersist` em vez de recursão.

### [x] B5 — Código morto

| Local | Item |
|---|---|
| `app.js:1362-1364` | `schedulePersist({remote:true})` nunca é chamado (`remote` é sempre `false`) |
| `charts.js:631` | `requestedYear === 'LATEST'` nunca ocorre (o select só tem `ALL` + anos) |
| `charts.js:160` | `Charts.getAnalistaMode` não é usado em lugar nenhum |
| `state.js:174` | `compareRecords` devolve `isSuperset`, nunca consumido |

**Correção:** remover ou documentar como API pública.

### [x] B6 — `recordFingerprint` compara conjuntos de chaves diferentes

`assets/js/state.js:101-108` — inclui todas as chaves do registro. Se o parser ganhar um campo
novo, os registros remotos (formato antigo) vs novos (formato novo) ficam com fingerprints
diferentes e **todos** são marcados como "atualizados" no resumo da importação (cosmético, mas
confuso).
**Correção:** comparar apenas um conjunto estável de campos, ou normalizar os dois lados com a
mesma função (ver **M1**).

### [x] B7 — `updated_at` nunca é mantida

`supabase/migrations/20261009142126_create_excel_imports.sql:10` — a coluna é criada mas não há
trigger que a atualize, e `UPDATE` não é permitido para o cliente. Coluna enganosa.
**Correção:** adicionar trigger `before update` que faça `new.updated_at := now();`, ou remover
a coluna.

### [x] B8 — `parseExcelDate` trata qualquer número como serial Excel

`assets/js/etl.js:341-348` — uma célula **numérica** não-data (ex.: um código) vira uma data
plausível (2025 → 13/06/1905). A proteção `if (/^\d+$/.test(text)) return null;` (`etl.js:351`)
só se aplica a strings.
**Correção:** exigir faixa plausível de serial (ex.: 20.000–80.000 ≈ 1954–2119) ou exigir
formato de data no cabeçalho da coluna.

### [x] B9 — ⚠️ O filtro de ano padrão oculta 56% do dataset

`assets/js/state.js:10` — `ano: String(new Date().getFullYear())` → 2026.
Medido: **858 de 1.942 registros visíveis** (1.084 ocultos: 2025, 2027 e os 11 sem ETA/ETS).
Combinado com **A2** (resumo invisível), o usuário não tem como saber que há mais dados.
**⚠️ Decisão de produto:** manter o padrão (ano corrente) e *exibir* "858 de 1.942 processos",
ou mudar o padrão para "Todos os anos".

### [ ] B10 — Tailwind Play CDN em runtime

`index.html:8` — `<script src="vendor/tailwind.js">` é o bundle do **Tailwind Play CDN**
(JIT em runtime). O console avisa: *"cdn.tailwindcss.com should not be used in production"*.
Como o projeto já é 100% offline com `vendor/`, compilar para CSS estático elimina o warning
e o custo de parse do DOM.
**Correção:** gerar `assets/css/tailwind.css` com o CLI do Tailwind v3 a partir do conteúdo
de `index.html` e remover o `<script>`.

### [x] B11 — `vendor/manifest.json` incompleto

Não registra `vendor/vercel-analytics.mjs` e mantém `"version": "unknown"` para o Tailwind.
**Correção:** incluir a analytics e fixar a versão real do Tailwind vendorizado.

### [x] B12 — Acessibilidade: menu de mês e rótulo duplicado

`index.html:188-205` — `#monthly-year` tem **dois** rótulos (`<label for>` sr-only *e*
`aria-label`); `#filter-mes-menu` não tem `aria-controls` nem `role`.
**Correção:** remover o `aria-label` duplicado, adicionar `aria-controls="filter-mes-menu"`
no botão e `role="group"`/`aria-labelledby` no menu.

### [x] B13 — Guard ausente no handler de teclado do tablist

`assets/js/app.js:259` — `document.querySelector('.tablist [aria-selected="true"]').dataset.tab`
lança `TypeError` se nenhum tab estiver selecionado (hoje sempre há um, mas é frágil).
**Correção:** `const active = document.querySelector(...); if (!active) return;`

---

### [ ] B14 — Timeouts apertados no papel `anon` (achado durante a correção)

`pg_roles.rolconfig` do projeto:

```
anon          → statement_timeout=3s
authenticated → statement_timeout=8s
authenticator → session_preload_libraries=supautils, safeupdate
                statement_timeout=8s, lock_timeout=8s
```

Medido em produção: o `INSERT` real com o trigger completo e o payload de 1.942 registros leva
**61 ms** — folga enorme hoje. Mas:

- O `statement_timeout=3s` escala mal: o payload é ~2,2 MB de JSONB e a importação faz
  `delete` + `insert` + comparação de superset. Com o dataset ~10× maior, o limite pode estourar.
- O `lock_timeout=8s` faz uma **importação concorrente** estourar timeout em vez de receber a
  recusa limpa do trigger (`SNAPSHOT_MISSING_RECORDS`), generates um erro genérico na interface.

**Correção possível** (não aplicada — requer decisão)

```sql
alter role anon set statement_timeout = '30s';
```
ou, melhor, uma `edge function` com timeout próprio, ou `pg_advisory_xact_lock` com
`lock_timeout` menor para falhar rápido com mensagem clara.

**Verificação**

- [ ] Timeout de `anon` dimensionado para o payload real (hoje: 3 s para 61 ms de trabalho)
- [ ] Importação concorrente devolve "recusada" e não "timeout"

---

### [x] B15 — Analytics injetava o script incondicionalmente (404 fora da Vercel)

`assets/js/analytics.js` chamava `inject()` sempre. O `inject()` do pacote `@vercel/analytics`
insere `<script src="/_vercel/insights/script.js">`, que **só existe em deploys da Vercel**.
Em qualquer outro host (servidor local, bucket estático, outro provedor) a URL devolve 404 e o
console fica com um erro sem relação com o dashboard — o que também quebrava o smoke test
"verifique o console para erros".

**Correção** (`assets/js/analytics.js`)

1. host local (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `*.local`) → **não injeta e não faz
   nenhuma requisição** (zero ruído no console em dev);
2. host padrão da Vercel (`*.vercel.app`) → injeta direto, sem round-trip;
3. domínio próprio na Vercel → um `HEAD` barato em `/_vercel/insights/script.js` decide.

**Verificação**

- [x] Console local: **0 erros** (só o aviso esperado do Tailwind Play CDN)
- [x] Nenhuma requisição a `/_vercel/*` em ambiente local
- [x] `HEAD` em `https://tdz-db.vercel.app/_vercel/insights/script.js` → **200** (analytics segue
      ativo em produção)

---

### [ ] B16 — `vendor/manifest.json` com versão "unknown" do Plus Jakarta Sans

A entrada de `vendor/fonts/plus-jakarta-sans.css` continua com `"version": "unknown"`: o CSS
vendorizado não carrega a versão e o repositório não guarda a proveniência da origem.
**Não é corrigível sem acesso ao artefato de origem** (o `origin` registrado é a página de
amostra do Google Fonts, que não expõe um número de versão para este subset).

**Verificação**

- [ ] Registrar a versão real do subset vendorizado

---

### [x] B17 — Servidor local sem `Cache-Control`: o navegador servia asset obsoleto/truncado

| | |
|---|---|
| **Arquivos** | `tools/serve.mjs:40-48` · `assets/js/app.js` (`ensureXlsxLoaded`) |
| **Impacto** | 🔴 erro "Não foi possível carregar a biblioteca de importação Excel" ao importar |
| **Esforço** | 🟢 ~30 min |

**Diagnóstico**

O `tools/serve.mjs` respondia **sem nenhum `Cache-Control`**. O Chrome aplica freshness
heurística nesse caso, então um asset pode ser reaproveitado do cache sem revalidação.

Durante a troca do SheetJS (0.18.5 → 0.20.3) o arquivo foi substituído em caliente. Quem
cliquei em "Carregar Excel" nessa janela recebeu uma resposta **truncada/parcial** — que o
navegador guardou no cache. Como a URL era sempre a mesma (`vendor/xlsx.full.min.js`, sem
query string), todas as tentativas seguintes reusavam a cópia quebrada e o `script.onerror`
disparava a cada vez.

Confirmado: o arquivo em disco estava **íntegro** (951.904 bytes, terminação correta) e havia
**só uma cópia** do projeto na máquina — ou seja, não era arquivo faltando nem corruption.

**Correção**

1. `tools/serve.mjs` agora envia `Cache-Control: no-store, must-revalidate` — o servidor de
   desenvolvimento nunca entrega asset antigo.
2. `assets/js/app.js` carrega a lib com **cache-busting**: `vendor/xlsx.full.min.js?v=0.20.3`
   (a query muda quando a lib muda, então o navegador baixa o arquivo de novo).
3. Uma **tentativa única** de retry com carimbo de tempo (`&t=…`) cobre uma resposta
   truncada que tenha ficado guardada.
4. A mensagem de erro passou a ser **acionável** (pede Ctrl+Shift+R) em vez de um erro seco.
5. `tests/vendor.test.mjs` garante que `XLSX_LIB_VERSION` no `app.js` acompanha a versão do
   `vendor/manifest.json` — se alguém trocar a lib e esquecer de atualizar a constante, o
   teste quebra.

**Verificação**

- [x] `HEAD vendor/xlsx.full.min.js?v=0.20.3` → 200 com `Cache-Control: no-store`
- [x] Importação real do arquivo do usuário (1.944 processos) **sem erro**
- [x] Banco atualizado para 1.944 registros (KLV602/KLV603 incluídos)
- [x] `node --test` → **104 testes, 100% verde**

---

## 🧪 LACUNAS DE TESTE

A suíte é incomumente (55 testes) para um dashboard estático — mas **por isso o bug A2 passou**:
`tests/banner.test.mjs:300` verifica `banner.hidden === true`, ou seja, exatamente o que
*esconde* a mensagem.

### [x] T1 — Testar **visibilidade** do estado vazio, não só `hidden`
Adicionar a `tests/banner.test.mjs` a asserção de que a mensagem de estado vazio é exibida
(elemento fora do banner transitório) e que o resumo do dataset carregado é visível.

### [x] T2 — Teste de busca sem acento
`ácido fosfórico` e `acido fosforico` devem retornar o mesmo conjunto.

### [x] T3 — Teste de payload do Supabase
Garantir que o `records` enviado **não** contém `_search` e que existe um limite de tamanho
(sinal de degradação).

### [x] T4 — Exercitar `charts.js` e `ui.js`
Hoje são testados só via stubs de DOM (`tests/banner.test.mjs:160-191`).
Cobrir ao menos: `countBy`/`sumBy` (dedup de Maersk/MAERSK), `updateMonthlyPresentation`
(média 12m), `csvCell` (fórmula + negativo) e `escapeHtml` em todos os sinks.

### [x] T5 — Validar a versão real das libs vendorizadas
O manifesto é validado, mas a **versão** não. Foi exatamente por isso que o gap
0.18.5 vs 0.20.3 (**M4**) passou. Adicionar asserção de versão mínima do SheetJS.

---

## 🔒 VERIFICADO CORRETO — NÃO MEXER

Verificado por leitura, teste no banco e execução real no browser.

| # | Item | Evidência |
|---|---|---|
| V1 | Regra de superset no servidor | rejeita com `P0001 SNAPSHOT_MISSING_RECORDS` + `DETAIL`; snapshot anterior preservado |
| V2 | Serialização de importações concorrentes | `pg_advisory_xact_lock` tomado **antes** de ler o snapshot atual; 2º importador é validado contra o snapshot do 1º |
| V3 | Upsert não burla a validação | `ON CONFLICT` ainda dispara o `BEFORE INSERT` e é rejeitado |
| V4 | `records = NULL` / `[]` rejeitados | `SNAPSHOT_INVALID` (`20261019141213_...sql:31-35`) |
| V5 | Sem SQL injection no trigger | sem SQL dinâmico; `raise exception` com placeholders `%` |
| V6 | Atomicidade delete + insert | rollback preserva o estado em qualquer falha |
| V7 | XSS mitigado | `escapeHtml` em todos os sinks de registros, inclusive `error.details` (`app.js:1182-1184`) |
| V8 | CSV injection bloqueado | `csvCell` prefixa `'` (exceto o caso do sinal negativo — ver **B2**) |
| V9 | Importação faz comparação client-side **e** server-side | redundância benéfica, manter |
| V10 | Parser rejeita cabeçalho não reconhecido | `detectHeaderRowIndex` acha cabeçalho deslocado; mensagem de erro clara |
| V11 | `monthlyReference` (ETA → fallback ETS) | 11 registros sem ETA/ETS ficam fora da série, como documentado |
| V12 | Filtro de mês "nenhum marcado" | dashboard vazio de forma consistente (KPIs, gráficos, tabela, CSV) — validado no browser |

---

## 📋 SUGESTÃO DE EXECUÇÃO

| Lote | Itens | Esforço | Risco | Status |
|---|---|---|---|---|
| **1 — Hardening do banco** | A1, A4, M2, M3, M6, M8, B7 | ~2 h | Baixo | ✅ **aplicado no banco real** |
| **2 — Visibilidade** | A2, B3, T1 | ~3 h | Baixo | ✅ código pronto · ⏳ T1 na Onda 3 |
| **3 — Busca** | A3, T2 | ~1 h | Baixo | ✅ código pronto · ⏳ T2 na Onda 3 |
| **4 — Payload** | M1, B6, T3 | ~2 h | Médio | ✅ **−25,8%** no payload · ⏳ T3 |
| **5 — Dependências** | M4, M5, M7, B11 | ~3 h | Médio | ✅ concluído |
| **6 — Robustez** | B1, B2, B4, B8, B13 | ~2 h | Baixo | ✅ concluído |
| **7 — Limpeza** | B5, B7, B12 | ~1 h | Baixo | ✅ concluído |
| **8 — UI/performance** | B9, B10, B14 | ~1 d | Médio | 🟡 B9 feito · B10 e B14 abertos |
| **9 — Cobertura** | T4, T5 | ~3 h | Baixo | ⏳ Onda 3 |

**Ordem executada:** Onda 1 (SUPABASE + HTMLCSS + ETLVENDOR) e Onda 2 (APPJS) em paralelo, com
escopos de arquivos disjuntos e contrato de IDs travado entre HTML e JS; Onda 3 (testes) depois,
para fechar a cobertura sobre o código já estável.

**Destaques do que mudou em produção**

| Métrica | Antes | Depois |
|---|---|---|
| Payload gravado no Supabase | 3.008.001 B (1.942 registros) | ≈ 2.240.000 B (**−25%**) |
| `records` com `_search` derivado | sim (445 KB) | **não** |
| Privilégios do `anon` | `arwdDxtm` (TRUNCATE!) | `ar` (só SELECT + INSERT) |
| Importação pela nuvem | ❌ `400 21000` | ✅ `201 Created` |
| SheetJS vendorizado | 0.18.5 (2 CVEs) | **0.20.3** |
| Resumo do dataset na tela | invisível | **sempre visível** |
| Busca "acido fosforico" | 0 resultados | **5 resultados** |

---

## 📝 DECISÕES DE PRODUTO PENDENTES

| # | Decisão | Opções | Estado | Responsável |
|---|---|---|---|---|
| D1 | Filtro de ano padrão (**B9**) | (a) manter ano corrente + exibir "858 de 1.942"; (b) padrão "Todos os anos" | ✅ **(a) aplicada** — o `table-count` agora mostra o total do dataset | — |
| D2 | Onde exibir o resumo do dataset (**A2**) | (a) card permanente acima dos KPIs; (b) dentro da barra de filtros; (c) no cabeçalho; (d) no card de status, transitório | ✅ **(d) aplicada** — o `#status-banner` voltou a ser o único cartão: transitório com arquivo, persistente no estado vazio | — |
| D3 | Compilar o Tailwind (**B10**) | (a) sim, gerar CSS estático; (b) manter Play CDN offline | ⏸️ **aberto** — risco de regressão visual: as classes de status (`bg-brand-600`, `text-emerald-400`, `bg-cyan-950`…) são injetadas pelo `app.js` em runtime, então o build precisa varrer `index.html` **e** `assets/js/*.js` | |
| D4 | Recorte de payload: onde compactar (**M1**) | (a) só remover `_search`; (b) remover também campos vazios; (c) mover para Supabase Storage + `edge function` | ✅ **(b) aplicada** — −25,8%; **(c)** segue como evolução futura | — |
| D5 | Timeout do papel `anon` (**B14**) | (a) `alter role anon set statement_timeout = '30s'`; (b) edge function com timeout próprio | ⏸️ **aberto** — hoje 3 s para 61 ms de trabalho real | |

> **Por que B10 ficou aberto:** compilar o Tailwind exige varrer também o JS (as classes de badge
> do `renderTable` e dos botões de status só existem em strings do `app.js`). Uma varredura
> incompleta quebraria silenciosamente o visual. Como o projeto é 100% offline e o Play CDN já
> está vendorizado, o ganho real é de performance, não de segurança — risco de regressão maior
> que o benefício. Recomendo fazer com comparação visual (screenshot) antes e depois.

---

## 🗒️ REGISTRO DE EXECUÇÃO

| Data | Lote | Itens | Resultado | Autor | Observações |
|---|---|---|---|---|---|
| 20/10/2026 | — | — | Análise inicial concluída (29 itens catalogados) | — | 55/55 testes OK; sem erros de runtime; banco lido em modo `SELECT` |
| 20/10/2026 | Onda 1 | A1, A4, M2, M3, M6, M8, B7 | ✅ **aplicado no banco real** | agente SUPABASE | `revoke all` + `grant select, insert`; `search_path=''`; `created_at` do servidor; índice único; `DELETE` com `WHERE`. Linha de produção **intacta** (`f9fc540b…`, 1.942 registros, `created_at` original) |
| 20/10/2026 | Onda 1 | M4, B8, B11 | ✅ concluído | agente ETLVENDOR | SheetJS 0.18.5 → **0.20.3** (hash do manifesto confere); 1.898 registros **byte-idênticos**; manifesto completo |
| 20/10/2026 | Onda 1 | A2(markup), M7, B12 | ✅ concluído | agente HTMLCSS | CSP validada no browser (script externo bloqueado, Tailwind/Chart.js OK); card `#dataset-summary` sempre visível |
| 20/10/2026 | Onda 2 | A2(JS), A3, B1, B2, B4, B5, B6, B9, B13, M1, M5 | ✅ concluído | agente APPJS | Busca sem acento; payload **−25,8%**; fingerprint normalizado; CSV numérico sem aspa |
| 20/10/2026 | Onda 3 | T1–T5 | ✅ concluído | agente TESTS | **64 → 103 testes, 100% verde** (2,4 s). Criados `hardening/charts/ui/vendor.test.mjs`; card visível e busca sem acento validados no browser |
| 20/10/2026 | Ajuste final | B15 | ✅ concluído | — | `analytics.js` só injeta onde o script existe → console local com **0 erros**; CSP com `worker-src 'self' blob:` |
| 20/10/2026 | Ajuste final | B17 | ✅ concluído | — | `tools/serve.mjs` envia `Cache-Control: no-store`; lib XLSX carregada com cache-busting (`?v=`) + retry + mensagem acionável. Importação real do arquivo do usuário (1.944 processos) **sem erro**; banco atualizado |
| 20/10/2026 | Ajuste final | A2 | ✅ concluído | — | Card de status volta a ser **único** e **transitório** com arquivo (some em 8 s), persistente no estado vazio e no erro fatal. Card `#dataset-summary` removido; informação persistente fica no cabeçalho |
| | | | | | |
| | | | | | |
| | | | | | |
