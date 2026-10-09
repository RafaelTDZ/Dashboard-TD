# Relatório de merges — RafaelTDZ/Dashboard-TD

Data: 2026-10-09

## O que foi mesclado em `main`

1. **PR #1 — `vercel/install-vercel-web-analytics-debmyd`**
   - Merge commit: `eadbf15` (Merge pull request #1: Install Vercel Web Analytics)
   - Conteúdo: `@vercel/analytics@2.0.1` em `package.json` + `pnpm-lock.yaml`,
     `assets/js/analytics.js`, `vendor/vercel-analytics.mjs` e o
     `<script type="module" src="assets/js/analytics.js">` no `<head>` de `index.html`.

2. **PR #2 — `v0/supabase-memoria-principal`**
   - Merge commit: `693ab29` (Merge pull request #2 from RafaelTDZ/v0/supabase-memoria-principal)
   - Conteúdo: Supabase como fonte principal (IndexedDB vira cache offline),
     card "Última leitura" (`#last-read-header`) no cabeçalho e
     `showTransientUpdateBanner()` mostrando o banner de status por 8s após novo Excel.

## Branches removidas do origin

- `vercel/install-vercel-web-analytics-debmyd` (mesclada via PR #1)
- `v0/supabase-memoria-principal` (mesclada via PR #2)
- `v0/salvar-excel-supabase` (já estava totalmente contida em `main`, 0 commits à frente)

Branches restantes no origin: `main` e `cline/2a990raq` (branch de backup desta sessão).

## Validação

- Merge da branch `v0/*` testado localmente antes de mesclar: sem conflitos
  (`index.html` com auto-merge em regiões distintas).
- `node --test` na `main` final: **33/33 testes passando**.
- Verificações pontuais em `index.html`: linha 42 (analytics) e linha 91 (`#last-read-header`)
  coexistem; `vendor/vercel-analytics.mjs` e `assets/js/analytics.js` presentes;
  `package.json` com `@vercel/analytics: ^2.0.1`.
