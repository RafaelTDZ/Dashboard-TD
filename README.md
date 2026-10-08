# BI Integration Hub

Dashboard estático offline para visualização e importação de dados de processos de comércio exterior.

## Executar localmente

O projeto não exige npm, build ou conexão externa. Com Node.js instalado:

```powershell
node tools/serve.mjs 8765
```

Abra `http://127.0.0.1:8765/` no Chrome ou Edge.

## Verificar

```powershell
node --test
```

Os testes cobrem regras de status, datas, números e moedas (incluindo células Excel formatadas em CNY), importação XLSX, campos auxiliares e aba `Comments`, escaping, snapshots persistidos, sintaxe dos scripts e referências locais.

Também é possível verificar individualmente os scripts:

```powershell
Get-ChildItem assets/js -Filter *.js | ForEach-Object { node --check $_.FullName }
```

## Smoke test manual

1. Confirme o dataset demo e os seis KPIs.
2. Alterne entre Dashboard, Tabela e Código de Integração usando mouse e teclado; no filtro global de ano, confirme que KPIs, gráficos, tabela, paginação e CSV mudam juntos. Na evolução mensal, confira o tooltip de Outubro e a regra ETA > ETS (sem ambas, o processo não entra na série). Confira também os cards de quantidade por agente e por sigla da operação.
3. Teste filtros, busca, ordenação, paginação e exportação CSV.
4. Importe um `.xlsx` com cabeçalho deslocado e confirme o relatório de mapeamento.
5. Com `!Importações.xlsx`, confirme o total importado (1.837 processos, 11 linhas ignoradas, 1.947 comentários da aba `Comments`) e os campos auxiliares no CSV; a série mensal deve mostrar 32 processos em Outubro de 2026, incluir o fallback ETS de `SIE254` em Agosto e excluir 22 registros sem ETA/ETS. Na coluna `Valor / Moeda`, os 14 registros em CNY devem permanecer identificados e fora dos totais em USD; o CSV exportado separa `Valor informado`, `Moeda` e `Valor USD`.
6. Recarregue a página e confirme a restauração do último dataset. Se o snapshot for de um parser anterior, ele será preservado e o dashboard recomendará uma nova importação.
7. Abra e feche o relatório pelo teclado; o foco deve retornar ao botão de origem.
8. Verifique o console do navegador para erros após cada fluxo.

## Dependências offline

As bibliotecas de runtime ficam em `vendor/`. Os hashes e as referências de origem registradas durante a revisão estão em `vendor/manifest.json`.
