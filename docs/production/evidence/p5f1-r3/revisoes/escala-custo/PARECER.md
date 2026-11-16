FAIL — Firestore scale/cost review

Revisão independente da P5-F.1-R3 (B03, marcas de aplicação da projeção; RR-R2A-04), especialidade `firestore-scale-cost-review`. Revisor sem participação na implementação. 2026-11-09, 19:20 UTC.

**Veredito.** Não há achado HIGH. Medi todas as dimensões e o desenho tem limite em cada uma: +1 leitura e +1 escrita por entrega; documento de marca de no máximo 5.743 B; commit de página da reconstrução de no máximo 500 escritas; prova de no máximo 113 documentos por tentativa; nenhuma consulta, nenhum listener e nenhum índice composto novos. O FAIL vem de dois itens obrigatórios do checklist:

- **M1.** O modelo de custo entregue (§9 do desenho) subestima a prova do cliente em 2 a 3 vezes. Também não cobre o custo por mês e por workspace que o pedido B03-03 exige, nem a capacidade da reconstrução, as leituras dependentes das Rules, as novas tentativas e o armazenamento de índice.
- **M2.** A leitura máxima da prova (13 meses e 100 marcas) não tem teste versionado no Emulator.

## Árvore e método

- WT: `<scratchpad>/wt-p5f1-r3`.
  - Base R2A: `f82679226ec93e18f906731be09d0675326fd764`.
  - Árvore revisada: `905ed3d67ecb9cdff2dfd01e81271e241809e29b`. Gerei-a com um índice temporário meu, com a mesma lógica de `final-tree.sh` e sem tocar no índice do WT.
- O WT continuou mudando durante a revisão: testes, evidências e `BACKUP_RESTORE_DR.md`; às 18:5x a árvore já era `8e96b945…`. Os 19 arquivos de produção e de configuração revisados não mudaram até 19:12 UTC. Os sha-256 estão em `<scratchpad>/p5f1r3/revisoes/escala-custo/hashes-revisados.txt`.
- Contagens **medidas** com as funções reais, compiladas num sandbox meu a partir das árvores R2A (`git archive` de `f8267922`) e R3, com a mesma entrada nas duas. As **estimativas** estão marcadas, com fórmula e premissas.
- Nada no WT foi alterado por esta revisão.
  - As Functions foram compiladas fora do WT (`--outDir` no sandbox), e os testes leram o WT só para leitura.
  - O `functions/lib` e o `dist/` do WT foram regravados às 18:57 por outro processo, não por esta revisão.

## Escopo (caminhos e operações)

| Superfície | Operação Firestore | Onde |
| --- | --- | --- |
| Gatilho de caixa | transação com um `getAll` de 3 documentos: marca de entrega, estado e marca de aplicação. Depois, `set` da marca inteira; `set` merge no estado só na primeira quebra de uma cadeia; `projectionGeneration` nos meses | `functions/src/cash/periods.ts:1301-1425`, `:840-866`, `:1093-1117`, `:1193-1212`; `functions/src/triggers/transactions.ts:278-313`, `:395-404` |
| Modelo da marca | funções puras; 2 posições; no máximo 16 pendências por cadeia; a 17ª quebra a cadeia e grava `pending: []` | `functions/src/cash/projectionMarks.ts:43`, `:315-324`, `:359-374`, `:483-511` |
| Reconstrução | página `orderBy(__name__).limit(pageSize)`, já existente. No commit que avança o cursor, 1 âncora (`set` merge) por documento da base, dentro do orçamento de 500 escritas. A publicação etiqueta meses e órfãos. Novo motivo de recomeço: `post_cutoff_event_missed_staging` | `functions/src/cash/rebuild.ts:798-811`, `:843`, `:1191-1196`, `:1248-1287`, `:1078-1126`, `:1585-1636` |
| Prova no cliente | leitura por id em lotes de 30 (`getDocsFromServer`, `documentId in`); transação só de leitura com até 13 meses e 100 marcas, `maxAttempts: 5`; chave do React Query inclui a janela | `src/modules/transactions/api.ts:149-183`; `src/modules/work-time/projectionReads.ts:7-9`, `:19-49`; `src/modules/transactions/incomeReads.ts:73-89`; `src/modules/work-time/useIncomeEstimateWith.ts:221-234`, `:360-389` |
| Dashboard (RR-R2A-04) | a escuta `onSnapshot` de até 2 meses, já existente, passa a contar o primeiro retorno. A releitura agrupada só refaz as consultas que não estão lendo depois da mudança | `src/modules/reports/hooks.ts:132-180`; `src/modules/reports/queryKeys.ts:80-133` |
| Agendadores | Dashboard: 40 seguidas e depois 1 por minuto. Bases e prova: 5 seguidas e depois 1 a cada 120 s | `src/modules/reports/liveRefresh.ts:12-14`, `:35-80`; `src/modules/reports/queryKeys.ts:39-43` |
| Rules e índices | `cash_projection_marks`: só `get` por membro ativo; `list` e escrita negados; coleção fora da regra genérica. Nenhum índice novo: `git diff` vazio em `firestore.indexes.json` entre a base e a R3 | `firestore.rules:459`, `:818-822`, `:1168-1174`; `firestore.indexes.json` |

## Evidência por item do checklist

| # | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | `workspaceId` de contexto confiável | PASS | **Gatilho:** `workspaceId` e `transactionId` vêm dos parâmetros do caminho do evento (`functions/src/triggers/transactions.ts:363-404`). **Reconstrução:** o ator é relido na transação, com papel owner/admin (`functions/src/cash/rebuild.ts:1698-1712`), e as âncoras ficam sob o mesmo workspace (`:1266-1276`). **Cliente:** o caminho decide, e as Rules exigem membership do workspace do caminho (`firestore.rules:66-68`, `:818-822`) |
| 2 | Leitura restrita ao workspace; IDOR | PASS | A coleção fica sob `workspaces/{id}`; `get` só para membro ativo. A negação entre workspaces aparece na suíte oficial (testes 1 e 5) e na reexecução do revisor de segurança às 19:02: 10 testes de ataque, todos passando (A↔B, não membros, collection group, teto, revogação no meio da transação), em `p5f1r3/revisoes/seguranca/rules-reexecucao.log` |
| 3 | Sem enumeração nem collection group | PASS | `allow list: if false`, e a coleção fica fora da regra genérica (`firestore.rules:459`, `:818-822`, `:1168-1174`). Testes 2 e 4 em `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:217-268` |
| 4 | Paginação no servidor | N/A para marcas; PASS para a varredura | As marcas não têm listagem. A varredura usa cursor `__name__` com `limit` (`functions/src/cash/rebuild.ts:1191-1196`), sem mudança |
| 5 | Índices para filtros e ordens | PASS | Nenhuma consulta nova. A consulta pós-corte usa campo único automático e `limit(201)` (`rebuild.ts:1044-1054`), sem mudança. Isenções: ver L1 |
| 6 | Cursor e desempate | N/A | Não há paginação nova; a existente ordena por `__name__`, que é único |
| 7 | Formas inviáveis; multiplicação de entradas | PASS | Não há intervalo em mais de um campo nem agregação. A amplificação pelos índices automáticos está em L1 |
| 8 | N+1 e leitura por linha | PASS com ressalva | **Gatilho:** os 3 documentos vêm num `getAll`. **Prova:** 1 RPC por documento. O SDK web 4.10.0 envia um `BatchGetDocuments` por `transaction.get` (`node_modules/@firebase/firestore/dist/index.node.mjs:2175-2178`; `common-e6dbc511.node.mjs:27719-27727`, `:23849-23854`). As chamadas vão em paralelo, com teto de 113 (`projectionReads.ts:26-33`). Isso é inevitável na API de transação do SDK web e tem limite. O custo das Rules por RPC entra em M1 |
| 9 | Listeners: justificativa e ciclo de vida | PASS | Nenhum listener novo: a guarda conta 2 `onSnapshot` (`tests/unit/work-time-guard.test.ts:397`) e nenhum em `projectionReads.ts` (`:322`). O primeiro retorno passa a contar (`hooks.ts:163-174`); `cancel` e `unsubscribe` acontecem na limpeza (`:175-178`). O custo está na tabela E |
| 10 | Consultas amplas no navegador | PASS | Só leitura por id (até 100 ids, em lotes de 30) e até 13 meses. O navegador só tira os itens lidos do total; não agrega mais nada |
| 11 | Agregados | N/A | A prova não agrega; ela compara com a projeção mensal existente |
| 12 | Fan-out por ação | PASS | **Gatilho:** +1 leitura por entrega e +1 escrita por entrega aplicada (medido; tabela A). **Âncoras:** N por tentativa de reconstrução, em páginas limitadas e retomáveis. Não há gatilho em marcas nem em meses: a busca por `onDocument*` em `functions/src` só acha `transactions` e outros domínios |
| 13 | Crescimento de documento | PASS | 2 posições e no máximo 16 pendências por cadeia (`projectionMarks.ts:43`, `:315-324`, `:359-367`). O maior documento medido tem 5.743 B: 2 âncoras e 2 cadeias com 16 pendências cada (`logs/sonda-tamanho-marca.log`) |
| 14 | Atomicidade e idempotência | PASS | A marca é gravada na mesma transação do delta (`periods.ts:1400-1410`); as âncoras, na transação que avança o cursor (`rebuild.ts:1248-1287`). Uma reentrega faz 0 escrita (medido; tabela A) |
| 15 | Operações em massa | PASS com ressalva (L2) | O maior commit de página medido teve exatamente 500 escritas e nunca passou disso nos 10 cenários, inclusive o adversário (`logs/sonda-orcamento-pagina.resumo.txt`). A varredura é retomável pelo cursor, e a página falha inteira |
| 16 | Retenção de coleção que cresce com o uso | PASS | A coleção não é log append-only: há 1 marca por lançamento, que vive enquanto o lançamento existir (ele não é apagado), com tamanho limitado. A marca sai com o workspace pelo fluxo da P8 (`docs/production/DATA_RETENTION_LIFECYCLE.md:104`, `docs/production/DATA_MODEL.md:140`). A falta de exclusão de workspace é uma lacuna geral da P8, anterior à R3 |
| 17 | Jobs que percorrem tenants | N/A | Não há job agendado novo; a reconstrução roda por chamada, um workspace por vez |
| 18 | Remoção de legado | PASS | A regra de espera da R2A saiu do cliente (`tests/unit/work-time-guard.test.ts:475-476`). Não ficou consulta, listener, índice nem regra obsoleta. Há um resto de código morto sem custo Firestore (I2) |
| 19 | Fórmulas e premissas por ação e por período | **FAIL** | M1 |
| 20 | Cardinalidades realistas e altas | **FAIL** | M1: a §9 usa "na prática 1 a 10" sem premissa nomeada e não dá custo por mês nem por workspace; o pedido B03-03 exige os quatro custos |
| 21 | Rules, novas tentativas, offline e índice | **FAIL** | M1: a §9 não considera as leituras dependentes das Rules, o `verify` do commit, `maxAttempts: 5` multiplicado pelo `retry` padrão 3, nem o armazenamento de índice |
| 22 | Sem depender de otimização futura ou limpeza manual | PASS com ressalva (L3) | A releitura num estado passageiro que não acaba (A04 do revisor de arquitetura) tem teto por hora: 34 na primeira hora e 31/h depois (medido). Mas ela não para sozinha, e esse estado só termina com uma reconstrução, sem nenhum sinal para quem opera |
| 23 | Emulator: formas novas, Rules, vazio e máximo | **FAIL** | M2: o teto da prova (13 + 100) não está na suíte versionada. O resto está coberto: 6 testes de Rules; 14 de integração das marcas (concorrência, páginas de 3, quebra, reconstrução); 108 das suítes de caixa |
| 24 | Vários workspaces e página cruzada | PASS | As Rules são testadas com dois workspaces (A e B). A integração usa `pageSize: 3` (`functions/src/cash/__tests__/projectionMarks.integration.test.ts:133`), e a cerca usa 498 e 601 documentos (`rebuildFence.integration.test.ts:736-770`) |
| 25 | Execução da suíte relevante | PASS com ressalva (I1) | O executor rodou numa cópia, com os hashes do backend iguais aos finais. O arquivo final de integração não tem execução registrada. As Rules finais foram reexecutadas pelo revisor de segurança |

## Modelo de custo

**Premissas das estimativas:**

- **P1.** Cada documento lido custa 1 leitura, inclusive o inexistente (premissa conservadora). Uma consulta custa no mínimo 1.
- **P2.** Cada requisição do cliente custa 2 leituras dependentes nas Rules: o perfil `users/{uid}` e a membership, deduplicados dentro da requisição. O custo por requisição está registrado em `firestore.rules:22-27`; `isMember` está em `:42-46`.
- **P3.** No SDK web 4.10.0, cada `transaction.get` é um `BatchGetDocuments`. O commit da transação só de leitura leva 1 `verify` por documento lido (`common-e6dbc511.node.mjs:27746-27762`).
  - **Premissa não verificada:** o `verify` não é cobrado como escrita.
  - Se for cobrado, cada tentativa custa m + u escritas a mais.
- **P4.** Tamanhos pelas regras públicas de *storage size* do Firestore. Entrada de índice ≈ nome do documento + caminho do campo + valor + 32 B. Índices automáticos: crescente e decrescente por campo escalar; `array-contains` por elemento de array. Não há isenção para `cash_projection_marks`.

**Notação:**

| Símbolo | Significado |
| --- | --- |
| N | lançamentos do workspace |
| E | entregas aplicadas por mês |
| m | meses da janela (1 a 12) |
| k | desconsideradas, até 50 (`firestore.rules:1277-1279`) |
| u | k + espelhos de estorno, até 100 |
| Q | ⌈u/30⌉ |

### A. Por entrega do gatilho

Valores **medidos** com o `applyCashPeriodWriteOnce` real das duas árvores (`sondas/sonda-custo-gatilho.cjs`, `logs/sonda-custo-gatilho.log`). Não incluem a trilha `activity_logs`, que custa +1 escrita igual nas duas.

| Caso | R2A (leituras/escritas) | R3 | Δ |
| --- | --- | --- | --- |
| Criação | 2/3 | 3/4 | +1/+1 |
| Edição de valor no mesmo mês | 2/3 | 3/4 | +1/+1 |
| Edição sem efeito no caixa (só descrição) | 2/1 | 3/2 | +1/+1 (dobra a escrita) |
| Mudança de mês e de ano | 2/5 | 3/6 | +1/+1 |
| Evento depois do corte, com reconstrução em preparação | 2/4 | 3/5 | +1/+1: uma marca serve às duas gerações |
| Reentrega | 2/0 | 3/0 | +1/0 |
| Coberto pela reconstrução | 2/1 | 3/1 | +1/0 |
| 17º evento fora de ordem (a cadeia quebra) | — | 3/5 | +1 escrita no estado, só na primeira quebra |
| Evento seguinte sobre cadeia já quebrada | — | 3/4 | sem novo registro |

- Cada tentativa da transação do Admin SDK relê os 3 documentos.
- A reentrega do Eventarc cai no caso "Reentrega".
- Cada escrita da marca atualiza as entradas automáticas dos campos que mudaram: 20 a 78 por documento (estimativa; L1).

### B. Por lançamento, por mês e por workspace

| Unidade | Custo |
| --- | --- |
| Por lançamento (armazenamento) | 1 marca. **Medido** pela fórmula de tamanho aplicada ao documento real: 373 B só na `g0`, 726 B depois de uma reconstrução, no máximo 5.743 B. Índice (**estimativa**): 22, 42 e 78 entradas; cerca de 3,3 KB, 6,6 KB e 16,7 KB, ou seja, cerca de 9 vezes o documento no caso típico |
| Por lançamento (operações) | 1 escrita por entrega aplicada; 1 escrita de âncora por tentativa de reconstrução; 1 leitura de marca por tentativa de prova em que o lançamento ou o espelho dele é desconsiderado |
| Por mês da projeção | `projectionGeneration` acrescenta de 35 a 76 B e 4 entradas de índice, sem escrita a mais (as escritas de meses medidas são as mesmas da R2A) |
| Por mês de uso | +E leituras e +E escritas no gatilho. Reentregas e entregas cobertas custam só +1 leitura |
| Por workspace (armazenamento, **estimativa**) | N × (0,4 a 0,7 KB de documento + 3,3 a 6,6 KB de índice). N = 10 mil: cerca de 35 a 70 MiB. N = 200 mil: cerca de 0,7 a 1,4 GiB. Cerca de 90% vai para índice automático sem consumidor. O estado da projeção ganha 4 campos, mais 3 de diagnóstico na quebra |

### C. Prova no cliente

Custo por tentativa (**estimativa**, P1 a P3):

`R = Σ max(1, achados por consulta) + 2Q + 3(m + u) + 2`. Some m + u se o `verify` for cobrado.

| Caso | m | u | §9 declara (m + 2u) | Estimativa revisada | Releitura dependente na R2A (u + 2Q) |
| --- | --- | --- | --- | --- | --- |
| PF típico | 3 | 3 | 9 | **25** | 5 |
| Médio | 12 | 20 | 52 | **120** | 22 |
| Teto | 12 | 100 | 212 | **446** | 108 |

- **Falha:** a transação faz até 5 tentativas (`projectionReads.ts:48`). O React Query repete até 3 vezes, porque `incomeReads.ts:81-88` não define `retry` e o padrão do `QueryClient` (`src/App.tsx:116-123`) também não. Teto teórico: 4 × (108 + 5 × 338) = 7.192 leituras.
- **Estado passageiro que não acaba** (A04; agendador real; `sondas/sonda-agendador.mjs`, `logs/sonda-agendador.log`):
  - 34 releituras na primeira hora, depois 31/h, e 725 em 24 h, por estimativa montada. O `WorkTimeProvider` fica montado no nível do app.
  - PF típico: cerca de 775 leituras/h. Teto: cerca de 13,8 mil/h e cerca de 323 mil em 24 h.
- **Receitas contínuas nos meses da janela** (**estimativa**):
  - Releituras: até 35/h pelo agendador da prova, mais 1 por liberação da base (`basisSync.ts:428`). As liberações vêm da escuta (até 35/h) e da mutação (até 8/h), por base. Total: até 78/h.
  - No teto, cerca de 34,8 mil leituras/h.
  - A R3 multiplica o custo de cada releitura dependente por 4 a 5 em relação à R2A (última coluna da tabela).

### D. Reconstrução

Valores **medidos** com o `processPage` real das duas árvores: N = 20 mil por cenário, a mesma entrada nas duas (`sondas/sonda-orcamento-pagina.cjs`, `logs/sonda-orcamento-pagina.resumo.txt`).

| Cenário | pageSize | Chamadas R2A → R3 | Leituras por documento da base R2A → R3 | Maior commit R3 |
| --- | --- | --- | --- | --- |
| Concentrado (12 meses, 10 categorias) | 300 | 67 → 67 | 1,00 → 1,00 | 323 |
| Concentrado | 500 | 40 → 42 | 1,00 → 1,05 | 500 |
| Típico (36 meses, 20 categorias) | 300 | 67 → 67 | 1,00 → 1,00 | 397 |
| Típico | 500 | 40 → 50 | 1,00 → 1,24 | 500 |
| Diverso (120 meses, 60 categorias) | 300 | 67 → 93 | 1,00 → 1,39 | 500 |
| Diverso | 500 | 52 → 93 | 1,29 → 2,30 | 500 |
| Extremo (240 meses, 150 categorias) | 300 | 79 → 107 | 1,18 → 1,60 | 500 |
| Extremo | 500 | 79 → 107 | 1,96 → 2,65 | 500 |
| Adversário (600 meses, 500 categorias) | 300 | 93 → 116 | 1,38 → 1,72 | 500 |
| Adversário | 500 | 93 → 116 | 2,29 → 2,85 | 500 |

- Cada tentativa grava N âncoras; cada recomeço grava todas de novo, com outro `g`.
- **Capacidade em 24 h** (**estimativa**). Limites: `MAX_REBUILD_AGE_SECONDS` (`rebuild.ts:206`) e 100 chamadas/h por usuário e workspace (`rebuild.ts:1678-1682`).
  - Cenário diverso: cerca de 716 mil lançamentos na R2A e cerca de 516 mil na R3.
  - Cenário adversário: cerca de 516 mil na R2A e cerca de 414 mil na R3.

### E. Dashboard (RR-R2A-04)

- Cada nova assinatura da escuta acrescenta 1 releitura agrupada: na carga do app, na troca de workspace e na troca do mês do Header.
- Essa releitura refaz as consultas ativas do relatório: no Dashboard, a do mês (`src/App.tsx:260-262`) e a do widget de 30 dias (`src/components/ReportsWidget.tsx:22`).
- A primeira leitura reaproveitada ganha uma releitura encadeada (`queryKeys.ts:131`).
- Resultado: 2 a 3 chamadas de `getFinancialReport` a mais por evento, dentro do orçamento (`liveRefresh.ts:12-14`).
- O custo de cada chamada é anterior à R3 e não foi medido aqui. O `rr-r2a-04.md:41-47` registra o acréscimo só como "uma releitura agrupada".

### F. Cenários por mês

Todos os valores são **estimativas**, com as premissas declaradas em cada linha.

| Cenário (premissas) | Gatilho | Prova | Armazenamento | Reconstrução, por tentativa |
| --- | --- | --- | --- | --- |
| PF realista: N = 10 mil; E = 300; m = 3; u = 3; 1 sessão de 176 h/mês; cerca de 2 releituras dependentes/h | +300 L, +300 E | cerca de 8,8 mil L (R2A: cerca de 1,8 mil) | 35 a 70 MiB | 10 mil L, +10 mil E, cerca de 34 chamadas (igual à R2A) |
| PJ de alto volume: N = 200 mil; E = 15 mil; m = 12; u = 10; 5 sessões × 176 h; receitas frequentes, 35 releituras/h | +15 mil L, +15 mil E | cerca de 2,46 milhões de L (R2A: cerca de 370 mil) | 0,7 a 1,4 GiB | cerca de 930 chamadas (cerca de 9,3 h no limite), cerca de 278 mil L, 200 mil E (R2A: cerca de 670 chamadas e 200 mil L) |
| PJ no teto: o mesmo, com u = 100 | igual | cerca de 13,7 milhões de L (R2A: cerca de 3,3 milhões), mais 31/h × 446 por sessão em estado A04 | igual | igual |

## Achados

### Bloqueantes

**M1. MEDIUM. Modelo de custo da R3 incompleto e subestimado.**

**Evidência.** `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md:94-103`, comparado com as tabelas A a F. As lacunas:

1. **Prova.** A §9 declara m + 2u. Faltam:
   - as 2 leituras das Rules em cada RPC (um RPC por documento), as 2 de cada consulta por id e as do commit;
   - as 5 tentativas da transação;
   - as 3 novas tentativas do React Query.

   O valor real fica 2 a 3 vezes acima: 25 contra 9 no caso típico, 446 contra 212 no teto.
2. **Cadência.** Não há custo por hora nem por mês da prova. A R3 multiplica cada releitura dependente por 4 a 5. A resposta ao A04 (`revisoes/respostas-revisao-arquitetura-1.md:10`) dá "até 35/h × (2k + 13)", o que omite as Rules e as liberações da base.
3. **Reconstrução.** O texto diz só "+1 escrita por documento". Faltam:
   - a perda de capacidade da página: até 1,79 vez mais chamadas, e até 2,30 leituras por documento no cenário diverso (2,85 no adversário);
   - a capacidade em 24 h sob o limite de chamadas;
   - o custo de cada recomeço (todas as âncoras de novo).
4. **Armazenamento.** "Poucos KiB" mede só o documento. Os índices automáticos sem consumidor somam cerca de 9 vezes o documento (L1).
5. **Unidades e premissas.** Faltam o custo por mês e o custo por workspace, que o pedido B03-03 exige. "Na prática 1 a 10" é premissa não declarada.
6. **Registro.** O desenho (§10) e a resposta ao A04 citam a §20.18 do plano como registro do custo e do risco. A seção não existe: o arquivo `docs/production/PRODUCTION_READINESS_PLAN.md` não muda desde 16:26 UTC e só chega à §20.17.

**Mudança exigida.**

- Trocar a §9 por um modelo com fórmulas, premissas nomeadas e números para cardinalidades realistas e altas. As tabelas A a F deste parecer podem ser adotadas ou corrigidas.
- Incluir as leituras das Rules, o `verify` (premissa explícita ou medida), as novas tentativas, a cadência por hora e por mês, a capacidade e os recomeços da reconstrução e o armazenamento com índice.
- Registrar tudo na §20.18, com o risco do A04 e a decisão sobre as isenções (L1).

**M2. MEDIUM. Teto da prova sem teste versionado no Emulator.**

**Evidência.**

- O único teste versionado da transação só de leitura lê 2 meses e 2 marcas (`tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:271-299`).
- O E2E usa 1 desconsiderada (`e2e/work-time-b03.spec.ts:331`).
- O teto é conferido só por expressão regular (`tests/unit/work-time-guard.test.ts:333`).
- Com 4 documentos, mesmo sem o cache de `get`/`exists` das Rules, a avaliação do commit fica em no máximo 16 chamadas de acesso (4 por documento): abaixo do limite de 20 de uma requisição com vários documentos. Por isso o teste não distingue o comportamento com 113 `verify`.
- A sonda avulsa do revisor de segurança mostra que 13 meses e 100 marcas passam numa transação, em 494 ms, com as Rules finais (sha `3f6f8eb8…`). Ela está em `<scratchpad>/p5f1r3/revisoes/seguranca/ataques-marcas-r3.test.mjs:300-321`, com log em `rules-reexecucao.log:161-165`. O risco é baixo, mas a evidência está fora do repositório.

**Mudança exigida.**

- Pôr na suíte versionada (`npm run test:rules:projection-marks`) um teste no teto: pelo menos 12 meses e 100 marcas, lidos pelo viewer com sucesso, e a negação para outro workspace sem resultado parcial. Dá para promover o teste do revisor.
- Cobrir também o comportamento do teto: 101 ids ou 14 meses devem dar erro antes de qualquer leitura.

### Não bloqueantes

**L1. LOW. Índices automáticos sem consumidor em `cash_projection_marks`.**

- **Medida:** 20 a 42 entradas por marca no caso típico e 78 no pior. Bytes de índice estimados em cerca de 9 vezes os do documento (tabela B).
- **Sem uso:** ninguém consulta a coleção. As Rules negam `list`, e o backend e o cliente leem por id.
- **Escritas concentradas:** as âncoras de uma reconstrução compartilham `g` e `cut`, e o `updatedAt` cresce de forma monotônica. Nos commits de página, de até 500 escritas, isso concentra as escritas de índice em faixas estreitas.
- **Precedente no projeto:** `firestore.indexes.json:1419-1433` já isenta os mapas `days`.
- **Recomendação:** criar `fieldOverrides` com `indexes: []` para `anchors`, `chains` e `updatedAt`, e possivelmente para os metadados escalares, com uma guarda de teste. Registrar a decisão (M1).

**L2. LOW. A página da reconstrução divide o orçamento do commit com as âncoras.**

- Uma página cortada é lida inteira, e a próxima chamada relê a cauda que ficou de fora.
- Medido na tabela D: em workspaces diversos, até 1,79 vez mais chamadas e até 2,85 leituras por documento da base; a capacidade em 24 h cai de 20% a 28%, conforme o cenário.
- O mecanismo é anterior: a R2A já relia 1,29 vez no cenário diverso com página de 500.
- O teste da R3 que passou de `pageSize: 250` para `125` (`functions/src/cash/__tests__/rebuildFence.integration.test.ts:757-770`) mostra essa queda. As asserções continuam iguais, então não há enfraquecimento.
- **Recomendação:** ajustar o `limit` ao orçamento quando há âncoras (por exemplo, `min(pageSize, 250)`) e documentar a capacidade (M1).

**L3. LOW. Releitura sem condição de parada num estado passageiro que não acaba.**

Este é o A04 do revisor de arquitetura, visto pelo custo.

- **Teto:** 31/h por estimativa montada, medido com o agendador real; até cerca de 13,8 mil leituras/h no teto.
- **Duração:** dura enquanto a sessão estiver aberta e só termina com uma reconstrução, sem nenhum sinal: `markRecoveryNeeded` não tem leitor, e `mark_pending` não registra nada.
- **Por que não bloqueia:** o teto por hora existe, e o estado só aparece fora da operação normal do produto.
- **Recomendação:** parar ou espaçar as releituras depois de N leituras idênticas, retomando quando a escuta mudar ou no "Tentar de novo"; dar um sinal operacional (P7). No mínimo, documentar o teto corrigido (M1).

**L4. LOW. Comentário de custo desatualizado.**

`functions/src/cash/periods.ts:1298-1299` diz "duas leituras", mas agora são três (`:1311-1313`).

**I1. INFO. Procedência da evidência de Emulator.**

- **Marcas:** as integrações do executor rodaram em `p5f1r3/copia-mutantes-backend`.
  - O backend de produção da cópia tinha os mesmos sha-256 dos arquivos finais na execução-base dos mutantes (`logs/mut-backend-base.log`, 14/14, cerca de 18:33).
  - O arquivo final `projectionMarks.integration.test.ts` (sha `687ba5da…`, 18:44) é outro: o executado foi `b11e29b9…`. Não achei execução registrada do arquivo final.
- **Caixa:** `int-copia-cash-fix-1.log` (108/108) é das 18:27, antes da última alteração de `periods.ts` (A03, 18:30); o conteúdo daquela execução não pode ser demonstrado.
- **Rules:** as Rules finais diferem da `rules-marcas-oficial-2.log` só num comentário (linha 457) e foram reexecutadas pelo revisor de segurança às 19:02 (6/6 na suíte oficial e 10/10 nos ataques).
- **O que falta:** registrar a execução final (`verify:all`) da árvore final. Esta revisão não sobe o Emulator.

**I2. INFO. Código morto.**

`observeDependentRead` e os estados `dependentObservations` e `dependentStates` ficaram sem chamador (`src/modules/reports/basisRegistry.ts:77-78`, `:137-143`, `:223-224`). É resto da regra substituída, sem custo Firestore; fica para o gate de regressão e de legado.

**I3. INFO. Alcance da releitura do RR-R2A-04.**

`refreshFinancialReportsAfterChange` refaz todas as consultas ativas do relatório, inclusive o widget de 30 dias, e não só a do mês que mudou (`queryKeys.ts:118-133`). Esse alcance já existia: a R2A também invalidava tudo. O acréscimo da R3 está quantificado na tabela E.

**I4. INFO. Custo do `verify`.**

A cobrança do `verify` no commit da transação só de leitura não está estabelecida no repositório (premissa P3). Ela entra em M1.

## Verificação

Comandos executados por esta revisão. Os logs estão em `<scratchpad>/p5f1r3/revisoes/escala-custo/logs/`.

| Comando | Resultado |
| --- | --- |
| `git diff --stat f82679226ec9… 905ed3d67ecb…`, com índice temporário meu | 54 arquivos. `firestore.indexes.json` sem diff na R3 |
| `npx tsc --noEmit` (raiz) | exit 0 (`tsc-frontend.log`) |
| `cd functions && npx tsc --noEmit` | exit 0 (`tsc-functions.log`) |
| `npx tsc -p functions --outDir <sandbox>/functions/lib` (sem tocar no `lib` do WT) | exit 0 |
| `node --test lib/cash/__tests__/projectionMarks.test.js lib/cash/__tests__/dayProjection.test.js` | **29/29** (`functions-unit-marks.log`) |
| `node --test` de todos os testes de unidade das Functions, no sandbox | **675/675** (`functions-unit-all-2.log`). A primeira rodada, sem os links do sandbox para `firestore.indexes.json`, `functions/src`, `firebase.json` e `tsconfig`, teve 9 falhas de caminho (ENOENT e MODULE_NOT_FOUND), em `functions-unit-all.log` |
| `node --experimental-strip-types --test` dos arquivos de `test:unit:work-time`, `test:unit:reports` e `test:unit:cash`, a partir do WT, só leitura | **211/211**, **107/107**, **23/23** (`unit-test-unit-*.log`) |
| `node sondas/sonda-custo-gatilho.cjs <sandbox R3> <sandbox R2A>` | tabela A (`sonda-custo-gatilho.log`) |
| `node sondas/sonda-orcamento-pagina.cjs <sandbox R3> <sandbox R2A>` | tabela D, com a verificação de no máximo 500 escritas por commit (`sonda-orcamento-pagina.log` e `.resumo.txt`) |
| `node --experimental-strip-types sondas/sonda-agendador.mjs <WT>` | teto das releituras (`sonda-agendador.log`) |
| `node sondas/sonda-tamanho-marca.cjs <sandbox R3>` | tabela B (`sonda-tamanho-marca.log`) |

**Emulator** (`minhas-financas-local`). Esta revisão não o executou, porque o pedido proíbe.

| Suíte | Resultado | Ressalva |
| --- | --- | --- |
| Integração das marcas, executor | 13/13 (`p5f1r3/logs/int-copia-marcas-fix-2.log`); 14/14 na execução-base dos mutantes (`mut-backend-base.log`) | I1 |
| Suítes de caixa, executor | 108/108 (`int-copia-cash-fix-1.log`) | I1 |
| Rules das marcas | 6/6 (`rules-marcas-oficial-2.log`); reexecução pelo revisor de segurança com as Rules finais: 6/6 mais 10/10 ataques, inclusive o teto 13 + 100 (`p5f1r3/revisoes/seguranca/rules-reexecucao.log`) | — |

**Para o PASS:**

1. Corrigir M1 e M2.
2. Rodar e registrar a suíte final da árvore final: integração das marcas e de caixa, mais `test:rules:projection-marks`, de preferência no `verify:all`.
3. Classificar L1 a L4 por escrito.
