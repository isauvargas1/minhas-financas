# ExecPlan — domínio de investimentos

## Objetivo e limites

Evoluir o uso atual de `transactions.type === "investimento"` para um domínio de investimentos verificável, multiworkspace e reconciliável. Este plano segue [AGENTS.md](../../AGENTS.md) e a skill `financial-domain-integrity`; não redefine essas regras.

O M0 estabelece apenas baseline, comandos de verificação e decisões executáveis. Nenhuma coleção, contrato, regra, índice, Function, migração ou UI do novo domínio é implementada neste marco.

## Estado do plano

- [x] M0 — baseline verificável, dependências e riscos documentados; scripts `typecheck`, `verify:fast` e `verify:all` disponíveis.
- [x] M1 — fluxo legado de aportes estabilizado; Emulator e Rules executados nesta sessão sem skips.
- [x] M2 — resgate legado semanticamente correto; Emulator e Rules executados nesta sessão sem skips.
- [x] M3 — domínio backend oficial fechado em 2026-08-23: lotes M3.A a M3.F aplicados, contratos de documento, ciclo de vida completo do movimento, valoração, reconstrutibilidade das projeções, backfill, observabilidade e matriz declarativa. Gate completo ainda não executado.
- [x] M4 — reaberto e fechado em 2026-08-23: lotes M4.A a M4.F aplicados sobre a superfície pós-M3. Duas decisões do plano foram revisadas contra o comportamento real do Firestore e uma lacuna permanece aberta e registrada. Gate completo ainda não executado.
- [x] M5 — leitura e experiência frontend; revisitado em 2026-08-23 para absorver o estado `cancelled` e a ação de cancelamento criados pelo M3, com regressão E2E dos fluxos legados sob as Rules do M4.
- [x] M6 — Cadastros e onboarding PF/PJ validados; revisitado em 2026-08-23 para trazer a gestão de contas e ativos de investimento para Configurações > Cadastros, com E2E verde. Pendência residual: `vite build` não conclui neste container, por motivo alheio ao marco.
- [x] M7 — metas, relatórios, dashboard e alocações integrados e validados.
- [ ] M8 — hardening, ingestão e IA: snapshot mensal reconstrutível, IA backend-only, limite de frequência, logs sanitizados, fim do full scan recorrente, ingestão CSV e deriva observável. Plano e execução na seção M8.

## Dependências confirmadas no M0

- Firebase Web SDK 12.8 no frontend e Admin/Functions no backend.
- Firestore multiworkspace em `workspaces/{workspaceId}/...`, Auth Emulator, Firestore Emulator e Functions Emulator.
- `transactions`, `goals`, `settings_catalog`, reports e allocations são consumidores legados que precisarão de compatibilidade explícita.
- O domínio de cartões fornece o padrão de referência mínimo para contracts, callable API, autorização server-side, idempotência, transações, auditoria, eventos, projeções, índices e testes de concorrência/replay.
- Não existe hoje suíte dedicada de Firestore Rules nem teste E2E de investimentos; esses itens são dependências de M2/M7, não aprovações do M0.

## Sequência executável

### M1 — contrato e modelo

Delta executado neste marco:

1. Meta nova recebe ID Firestore antes do vínculo; `Novo Aporte` abre investimento pré-vinculado e IDs novos de meta, transação, carteira e relação permanecem `string`.
2. Criação/edição de meta, vínculo/desvínculo, arquivamento, rebuild e aporte vinculado passam por callables workspace-scoped, com RBAC, payload estrito, idempotência e audit log.
3. `transactions` continua sendo a fonte oficial do progresso por `net_contributions`; entram somente aportes `investimento` com `isPaid === true`. Centavos inteiros são persistidos junto aos campos legados de compatibilidade.
4. `progressBasis` aceita `net_contributions` (default legado) e `current_value`; rebuild recalcula a primeira base e preserva o valor explícito da segunda.
5. O trigger deixa de aplicar incrementos e logs aleatórios: reconstrói o total em transação e usa identidade determinística do evento.
6. Meta é arquivada sem remover meta ou aportes; vínculo retroativo e desvínculo são atômicos.
7. Seed versionado do catálogo legado usa locks determinísticos por workspace, diferencia PF/PJ e nunca cria workspace.
8. Testes adicionados cobrem centavos/pending, criação, edição, arquivamento, retry, concorrência, rebuild, vínculo retroativo, isolamento de tenants, seed PF/PJ, Rules e E2E. A execução das suítes que abrem portas locais continua obrigatória para marcar M1 concluído.

### M2 — resgate compatível no legado

Delta executado neste marco:

1. `Transaction` permanece retrocompatível e recebe `investmentMetadata` tipada para moeda BRL, operação, impactos de caixa/investimento, principal, ganho realizado, taxas, impostos, liquidação, status, origem e idempotência.
2. Criação/edição de resgate pendente, liquidação, cancelamento e estorno passam por callables workspace-scoped com RBAC, payload estrito, transação, deduplicação e auditoria PF/PJ.
3. A liquidação deriva meta e carteira do aporte de origem; reduz o saldo do investimento e `netContributionCents` somente pelo principal. Pendência/cancelamento não altera caixa, investimento ou meta; estorno cria movimento compensatório.
4. Saldos de principal são protegidos contra replay, edição incompatível e concorrência; parcial e total são suportados, e aportes com principal resgatado não podem ser apagados, desvinculados, tornados pendentes ou reduzidos abaixo do resgatado.
5. Dashboard, relatórios e allocations usam efeitos explícitos: principal resgatado não entra em receita/despesa, ganho permanece separado e resgate não conta como novo aporte.
6. Rules reservam metadata, saldos, auditoria e idempotência ao backend. As operações novas usam apenas leituras por ID e não exigem índice composto novo.
7. Testes direcionados cobrem pending/settled, parcial/total, taxas/impostos, meta, edição, cancelamento/estorno, replay, concorrência, dupla contagem, PF/PJ, RBAC, isolamento e E2E. Emulator e Playwright precisam executar para concluir o marco.

### M3 — backend transacional

Delta executado neste marco:

1. O domínio oficial fica em `functions/src/investments`, com contratos compartilhados para contas, ativos, movimentos, posições, valorações, snapshots, eventos, chaves de idempotência e lotes de importação. As coleções usam exclusivamente `workspaces/{workspaceId}/investment_*`.
2. Callables tipadas implementam aporte, criação/liquidação de resgate, reversão compensatória, vínculo/desvínculo de meta, rebuild de posição/meta e arquivamento de conta/ativo. Toda mutação exige `correlationId`, valida payload estrito, revalida RBAC dentro da transação e vincula idempotência ao workspace, ator, operação e conteúdo.
3. `investment_movements` é a fonte oficial append-only; `transactions` permanece somente como projeção de caixa/compatibilidade. Apenas movimentos `settled` alteram posição e meta, resgate separa principal de ganho/taxas/impostos, valoração altera patrimônio sem caixa e reversão preserva o evento original.
4. Posições, metas, eventos, snapshots e chaves de idempotência são escritos apenas pelo backend. Conta/ativo carregam PF/PJ explícito; arquivamento preserva histórico; eventos determinísticos e projeções são publicados no mesmo limite atômico da mutação crítica.
5. Rebuild de posição e meta usa páginas limitadas a 100, cursor composto por data e ID, snapshot retomável, cutoff/versionamento para detectar concorrência e publicação somente após a última página. Não foram adicionados scans integrais, listeners ou N+1; os índices compostos necessários estão em `firestore.indexes.json`.
6. Testes unitários e Emulator cobrem centavos/micros, aporte, resgate pending/settled parcial, ganho/taxas/impostos, replay, concorrência, falha atômica e retry, reversão, vínculo/desvínculo, PF/PJ, RBAC, isolamento bidirecional, paginação, valoração, rebuild e preservação do histórico. A Rules suite prova que clientes não escrevem projeções, snapshots, logs ou idempotência.

#### Plano de fechamento do M3 — 2026-08-21

Levantamento em `HEAD` `c754cfa` mais working tree. O M3 **não é greenfield**: as 12 coleções existem em [paths.ts](../../functions/src/investments/paths.ts), as 9 entidades estão tipadas em `domain.ts` e as 10 callables pedidas já estão exportadas em `callables.ts:130-177`. Este plano fecha lacunas verificadas; não reimplementa o marco.

##### Situação das 9 entidades

| Entidade | Coleção | Estado | Lacuna verificada |
| --- | --- | --- | --- |
| InvestmentAccount | `investment_accounts` | Escrita e lida | Sem contrato Zod de documento |
| InvestmentAsset | `investment_assets` | Escrita e lida | `allocationPurpose` é obrigatório em `domain.ts:50`, opcional no payload e nunca gravado por `onboarding.ts:154-167` |
| InvestmentMovement | `investment_movements` | Escrita e lida | Documento montado como literal sem tipo; `walletId`, `expectedSettlementAt`, `settlementCorrelationId`, `reversedAt`, `reversedBy`, `reversalCorrelationId` e `updatedAt` são gravados e ausentes da interface |
| InvestmentPosition | `investment_positions` | Escrita e lida | Sem contrato Zod de documento |
| InvestmentValuation | `investment_valuations` | Somente lida (`rebuild.ts:304-313`) | **Sem caminho de escrita.** `currentValueCents` nunca diverge de `principalCents`, `unrealizedAppreciationCents` é sempre zero e `progressBasis: 'current_value'` é hoje indistinguível de `net_contributions` |
| InvestmentSnapshot | `investment_snapshots` | Completa | — |
| InvestmentEventLog | `investment_event_logs` | Completa | `outcome` aceita apenas `completed`; falha de callable não deixa rastro |
| InvestmentIdempotencyKey | `investment_idempotency_keys` | Completa | Ramo `status !== "completed"` (`infrastructure.ts:185`) é inalcançável |
| InvestmentImportBatch | `investment_import_batches` | **Tipo morto** | Interface em `domain.ts:216` e Rules em `firestore.rules:928`, sem nenhum leitor, escritor, callable ou contrato |

##### Situação das 10 callables

Todas existem, exigem `correlationId` e `idempotencyKey`, revalidam RBAC dentro da transação e rodam em `runTransaction`. RBAC atual: `createInvestmentContribution`, `createInvestmentRedemption`, `settleInvestmentRedemption`, `linkInvestmentToGoal` e `unlinkInvestmentFromGoal` em owner/admin/member; `reverseInvestmentMovement`, `recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `archiveInvestmentAccount` e `archiveInvestmentAsset` em owner/admin.

Coexistem três callables legadas do M2 — `saveInvestmentRedemption`, `cancelInvestmentRedemption` e `reverseInvestmentRedemption` (`callables.ts:74-87`) — que operam sobre `transactions`, não aceitam `correlationId` (`contracts.ts:43-46`) e gravam em outra trilha, `investment_audit_logs` (`operations.ts:105`). `reverseInvestmentRedemption` aceita `member`, enquanto sua equivalente V2 exige owner/admin.

##### Decisões explícitas

1. **Fonte oficial.** Com `features.investmentsV2.enabled === true`, `investment_movements` é a única fonte oficial; `investment_valuations` é a fonte oficial do preço unitário. Tudo mais — `investment_positions`, `investment_summaries`, `investment_report_periods`, `investment_allocation_summaries`, `goals.investmentProgressCents` e os espelhos em `transactions` — é projeção derivada e nunca é lido como fonte. Com a flag falsa, `transactions` permanece a fonte oficial do M1/M2. A flag é a única chave que troca a fonte; não há período de fonte dupla.
2. **Projeções.** Toda projeção precisa ser reconstruível a partir de movimentos e valorações. `investment_positions` e `goals` já têm rebuild. `investment_summaries/current`, `investment_report_periods` e `investment_allocation_summaries` são hoje acumuladores `FieldValue.increment` sem rebuild — valor acumulado opaco, proibido pela skill `financial-domain-integrity`. O M3 passa a exigir rebuild para as três, e não apenas para posição e meta.
3. **Atomicidade.** O limite transacional é a callable. Uma única `runTransaction` contém: revalidação de RBAC, leitura da chave de idempotência, leituras de domínio, criação do movimento, escrita de posição, escrita de meta, projeções de resumo/período/alocação, espelho de caixa em `transactions`, event log e conclusão da idempotência. Nada é adiado para trigger, fila ou processo assíncrono. Como alocação escreve por dimensão, o número de escritas por transação passa a ser contado e limitado explicitamente, com teste que prova o teto abaixo do limite do Firestore.
4. **Idempotência.** Chave = workspace (via path) + ator + operação + `idempotencyKey` do cliente, com `requestHash` do payload como guarda de conflito. Mantém-se a reserva de fase única, criada na conclusão dentro da mesma transação: dentro de `runTransaction` ela é equivalente à máquina `started/completed/failed` de cartões e não deixa reserva órfã. **Decisão de mudança:** `correlationId` sai da comparação de identidade (`infrastructure.ts:177`) e permanece apenas como metadado registrado, porque retry legítimo de cliente gera novo `correlationId` e hoje isso devolve `idempotency_conflict` em vez de replay.
5. **Concorrência.** A garantia é a leitura-antes-de-escrita da transação do Firestore sobre o documento de posição. `position.version` **não** é compare-and-set em mutação normal: é contador de projeção usado como cerca no rebuild (`rebuild.ts:208-216`, `522-532`). Isso passa a ser afirmado no plano e coberto por teste, em vez de ficar implícito. Agregados por `increment` continuam imunes a lost update, e a reconstrutibilidade deles é resolvida pela decisão 2, não por CAS.
6. **RBAC.** Mantém-se a matriz atual e a dupla validação — no wrapper e dentro da transação (`infrastructure.ts:86-140`), que é mais forte do que a referência de cartões, onde o papel é resolvido apenas antes da transação. **Decisões de mudança:** `reverseInvestmentRedemption` legada passa a owner/admin, alinhada à sua equivalente V2; a matriz sai de literais espalhados em `callables.ts` para um registro declarativo por operação, no formato de `creditCards/writeStrategy.ts:34-48`, para ser auditável em um só lugar. O fallback de owner sem documento de membership (`infrastructure.ts:117-121`) é **mantido no backend** — um owner não pode ficar trancado fora do próprio workspace — e o texto do M4 que afirma o contrário passa a valer apenas para leitura via Rules.
7. **pending/settled/reversed.** Estorno não vira status: continua sendo movimento compensatório com vínculo bidirecional no original, para não sobrescrever fato histórico. **Decisão de mudança:** o estado `pending` ganha saída. Hoje `reverseInvestmentMovement` exige `settled` (`operationsV2.ts:1141-1150`) e um resgate pendente não tem nenhuma transição de saída; como pendente tem todos os deltas em zero e não toca posição, meta ou caixa, cancelá-lo não apaga fato financeiro. Entra `cancelInvestmentMovement`, permitido somente a partir de `pending`, com `cancelledAt`, `cancelledBy` e motivo, espelho em `transactions` atualizado e validador de Rules estendido.
8. **Money em cents.** Valor autoritativo é inteiro em centavos, moeda BRL; quantidade e preço unitário são inteiros em micros; aritmética via `math.ts` com guarda de overflow e meia-para-cima em BigInt. **Não se copia a referência de cartões neste eixo** — lá o dinheiro é float em reais (`creditCards/contracts.ts:18-26`). O único float admitido é `transactions.value` (`operationsV2.ts:383`), campo de compatibilidade explicitamente não autoritativo e sempre acompanhado de `valueCents`. `moneySchema` (`contracts.ts:24`) fica restrito ao payload legado do M2 e não entra em superfície V2.
9. **Timestamp e fuso.** Todo instante persistido é `Timestamp`; o formato de transporte é ISO-8601 com offset. **Decisão de mudança:** todo corte de período e de dia passa a usar `America/Sao_Paulo`. Hoje `operationsV2.ts:360`, `reporting.ts:83` e `reporting.ts:86` derivam mês e dia com `toISOString()` em UTC, enquanto o repositório já usa `America/Sao_Paulo` em `creditCards/observability.ts:49-58`. Um movimento liquidado à noite no horário de Brasília cai no dia — e possivelmente no mês — errado. Extrai-se um helper compartilhado com data como argumento, já que o de cartões é privado e usa o instante atual.
10. **Compatibilidade com `transactions`.** Projeção unidirecional V2 → `transactions`, documento `investment_{movementId}`, gravada na mesma transação e **nunca relida como fonte**. O controle antidupla contagem é esse: relatórios V2 leem exclusivamente projeções oficiais e não somam `transactions`; o caminho legado continua somando `transactions` e não lê projeções. **Correção de Rules:** o pré-teste de update em `firestore.rules:736-759` não inclui `settlementDate`, então um documento que carregue apenas esse campo ainda é editável pelo cliente; o mesmo vale para o delete em `:760-769`.
11. **Queries e paginação.** Toda leitura é por ID ou query filtrada, ordenada e limitada; nenhum listener novo; nenhum full scan. Índices confirmados suficientes: nenhuma query de investimento hoje falha ou varre por falta de índice. Página de UI 20, período de relatório 100, alocação 11 por dimensão, rebuild 50 por padrão e 100 no teto — todos dentro do limite de 100 imposto pelas Rules. Fica registrado que `list` nas Rules não valida campos, apenas `get`, e que o índice `transactions [userId, date]` não tem consumidor. Fora do escopo do M3, mas registrado como risco: `src/modules/transactions/api.ts:176` lê a coleção inteira sem `where`, `orderBy` ou `limit`, e `src/modules/goals/api.ts:35` usa `limit(100)` sem `orderBy`, com o filtro de arquivadas aplicado depois do limite.
12. **Rebuild.** Mantém-se a máquina atual: página com cursor composto `{orderedAt, documentId}`, `cutoffAt` congelando a janela, `expectedProjectionVersion` como cerca contra escrita concorrente, snapshot retomável em `investment_snapshots/{rebuildId}` e publicação só na última página. **Decisão de mudança:** a mesma máquina passa a cobrir as três projeções acumuladas da decisão 2, e ganha um orquestrador por workspace que percorre posições e metas em páginas — é essa rotina que satisfaz o backfill exigido pelos riscos residuais do M5 e do M7 antes de habilitar a flag.
13. **Audit e correlationId.** `correlationId` é obrigatório em toda mutação V2 e já se propaga para movimento, event log, idempotência, carimbos de liquidação e estorno e snapshot de rebuild. **Decisões de mudança:** as três callables legadas do M2 passam a exigir `correlationId` em vez de sintetizá-lo do ID da chave (`operations.ts:113`); as duas trilhas de auditoria — `investment_event_logs` na V2 e `investment_audit_logs` no legado — são mantidas separadas e documentadas por estado da flag, sem migração; e entra observabilidade de falha espelhando `creditCards/observability.ts:190-279`, porque hoje uma callable de investimento que falha não deixa métrica, evento nem registro algum.
14. **Testes.** Unitário para domínio puro; Emulator para tudo que persiste; guarda dura por `throw` na ausência de `FIRESTORE_EMULATOR_HOST`, padrão já adotado nas seis suítes do domínio e superior ao `{skip: ...}` da referência de cartões. Lacunas a cobrir: caminho de edição de conta e ativo, nunca exercitado porque toda chamada omite o ID; papel `viewer` ausente do laço de papéis em `redemption.integration.test.ts:310`; valoração só semeada por Admin SDK, sem caminho de ingestão; corte de período no fuso de São Paulo; a nova transição de cancelamento; e rebuild e deriva das projeções acumuladas. As três suítes de Rules são um único `test()` monolítico, então a primeira falha mascara o resto — passam a ser divididas por cenário.

##### Lotes executáveis

**M3.A — registro.** Reconciliar o checklist com o histórico; declarar o descarte ou a reintrodução do M7 original de hardening; tornar `regression-release-gate` carregável em `.claude/skills/`. Sem código de produção.

**M3.B — correções de semântica e fuso.** Helper compartilhado de chave de dia e mês em `America/Sao_Paulo`; substituição dos três pontos UTC; `correlationId` fora da identidade de idempotência; `reverseInvestmentRedemption` para owner/admin; `correlationId` obrigatório nas três callables legadas; guarda de `settlementDate` no update e no delete de `transactions` nas Rules. Testes: corte de período na virada do dia em BRT, replay com novo `correlationId`, RBAC do estorno legado, forja de `settlementDate`.

**M3.C — fechamento de contratos e entidades.** Contratos Zod de documento para conta, ativo, movimento e posição, aplicados na escrita; interface de `InvestmentMovement` alinhada aos campos realmente gravados; `allocationPurpose` gravado no onboarding e coerente entre tipo e payload; decisão registrada sobre `InvestmentImportBatch` — implementar ingestão ou remover tipo, Rules e coleção, sem deixar entidade morta. Testes: rejeição de documento fora do contrato, PF/PJ de `allocationPurpose`.

**M3.D — ciclo de vida completo do movimento.** `cancelInvestmentMovement` com status `cancelled` a partir de `pending`, contrato, Rules, espelho em `transactions` e event log. Caminho de escrita de `InvestmentValuation` — callable owner/admin, idempotente, auditada — para que marcação a mercado e `progressBasis: 'current_value'` deixem de ser inertes. Testes: pendente cancelado não move posição, meta nem caixa; cancelamento de movimento liquidado é negado; valoração altera patrimônio sem caixa; replay e concorrência de ambas.

**M3.E — reconstrutibilidade e backfill.** Rebuild para `investment_summaries/current`, `investment_report_periods` e `investment_allocation_summaries` na mesma máquina de página, cursor, cutoff e cerca de versão; orquestrador de backfill por workspace; detecção de deriva entre projeção e ledger. Testes: reconstrução bate com o ledger, retomada após interrupção, deriva detectada, replay não duplica.

**M3.F — observabilidade e matriz declarativa.** Métrica operacional e evento de falha por operação, no padrão de cartões, com chave diária em São Paulo; registro declarativo da matriz de papéis por operação; divisão das três suítes de Rules por cenário. Testes: operação falha emite métrica e evento; matriz declarada bate com a exigida em runtime.

##### Execução do M3 — 2026-08-23

Delta aplicado nesta sessão, por lote. Nenhum marco anterior foi reimplementado.

**M3.A — registro.** `regression-release-gate` copiada de `tools/codex-skill-drafts/` para `.claude/skills/` e `.agents/skills/`; a skill exigida por [AGENTS.md](../../AGENTS.md) passa a ser carregável. O M7 original de hardening fica **explicitamente reintroduzido como M8**, não descartado: ensaio de migração em dataset representativo, runbook de reparo e gate final continuam pendentes e agora têm marco próprio. O checklist de estado foi reconciliado.

**M3.B — semântica e fuso.** Helper compartilhado `functions/src/shared/dateKeys.ts` com `saoPauloDayKey`, `saoPauloMonthKey`, `saoPauloDayStart` e `saoPauloMonthStart`; resolve o offset pelo próprio formatador e trata a meia-noite inexistente na entrada do horário de verão. Substituiu os quatro pontos UTC: chave de mês e de dia e `periodStart` em `reporting.ts`, e `date` do espelho de caixa em `operationsV2.ts`. `creditCards/observability.ts` passou a delegar ao mesmo helper, eliminando a duplicação privada. `correlationId` saiu da identidade de idempotência — não só da comparação, mas do próprio `requestHash`, via `idempotencyIdentityPayload`; retry legítimo com novo `correlationId` agora é replay. `ALREADY_EXISTS` na criação da reserva passou a virar `failed-precondition`, não `internal`. As três callables legadas do M2 exigem `correlationId` do cliente e o propagam para `investment_audit_logs`, em vez de sintetizá-lo do ID da chave. `reverseInvestmentRedemption` passou a owner/admin.

**M3.C — contratos e entidades.** `functions/src/investments/documentContracts.ts` traz contratos Zod de **documento** para conta, ativo, movimento, posição, valoração e lote, aplicados imediatamente antes de cada escrita e reproduzindo as invariantes de `firestore.rules`. `InvestmentMovement` foi alinhado aos campos realmente gravados (`walletId`, `expectedSettlementAt`, `settlementCorrelationId`, `reversedAt`, `reversedBy`, `reversalCorrelationId`, `updatedAt`) mais os novos de cancelamento, procedência e `reversalOfOperation`. `allocationPurpose` passou a ser gravado pelo onboarding, com PF em `unassigned` e PJ em `reserve`, e é obrigatório no contrato de documento. **Decisão sobre `InvestmentImportBatch`: ingestão implementada, entidade não removida.** `registerInvestmentImportBatch` abre e encerra o lote; o aporte aceita `importBatchId`, valida que o lote está aberto e no mesmo PF/PJ, e avança `processedCount` no mesmo limite atômico.

**M3.D — ciclo de vida do movimento.** `cancelInvestmentMovement` dá saída ao estado `pending`, que antes era obrigação permanentemente aberta: grava `cancelled` com autor, instante e motivo, mantém todos os deltas em zero, atualiza o espelho em `transactions` para `isPaid: false` e impacto `none`, e não toca posição, meta nem resumo. Cancelar movimento liquidado é negado — liquidado exige estorno compensatório. `recordInvestmentValuation` cria o caminho de escrita que faltava para `investment_valuations`: owner/admin, idempotente, auditado, altera valor atual e apreciação não realizada da posição, do resumo, do período e da meta em `current_value`, e **nunca** escreve em `transactions`.

**M3.E — reconstrutibilidade e backfill.** `functions/src/investments/projectionRebuild.ts` reconstrói as três projeções acumuladas na mesma máquina de página, cursor composto, `cutoffAt` e cerca de versão, em quatro fases retomáveis (`positions` → `movements` → `publish` → `prune`). A publicação grava **valores absolutos**, não incrementos, o que torna a retomada e o replay idempotentes; a última página do `publish` mede e reporta a deriva entre projeção e ledger. A cerca usa `investment_summaries.projectionVersion`, incrementado por toda mutação em `writePosition`. Tetos explícitos — 400 faixas de alocação e 240 períodos — falham com erro nomeado em vez de truncar em silêncio, e a escrita por transação fica em `pageSize` (≤100) mais os documentos fixos, abaixo do limite de 500 do Firestore. `functions/src/investments/backfill.ts` orquestra por workspace na ordem obrigatória posições → metas → projeções, uma página por chamada, com chaves de idempotência derivadas por alvo e página.

**M3.F — observabilidade e matriz declarativa.** `functions/src/investments/writeStrategy.ts` passa a ser a única fonte dos papéis por operação, no formato de `creditCards/writeStrategy.ts`, com `clientDirectWriteAllowed` de tipo literal `false`; `callables.ts`, `operationsV2.ts`, `rebuild.ts` e `onboarding.ts` leem a matriz tanto no wrapper quanto dentro da transação, e os seis conjuntos de literais espalhados foram removidos. `functions/src/investments/observability.ts` espelha o padrão de cartões: métrica diária por operação e status em `investment_operational_metrics`, com chave em São Paulo, e evento de falha com `outcome: "failed"` — antes, uma callable de investimento que falhava não deixava rastro algum. A observabilidade roda em transação própria e engole os próprios erros, para nunca mascarar o erro de domínio.

**Rules e índices — apenas o exigido pelas escritas novas do M3.** Não é o hardening do M4. Movimento aceita `cancelled` com deltas zerados e autoria; snapshot aceita `projection_rebuild` e `workspace_backfill`; event log aceita o formato reduzido de falha; `investment_operational_metrics` ganha leitura owner/admin e escrita negada; `entityType` aceita `importBatch`. A guarda de `settlementDate` entrou no pré-teste de update e de delete de `transactions` — o **delete** era o buraco real, pois permitia hard delete de histórico financeiro, e o teste novo falha sem a correção. Um índice composto `investment_movements [status, occurredAt, __name__]` cobre a varredura ascendente do rebuild de projeções.

##### Evidências do M3 — 2026-08-23

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` (frontend + Functions) | PASS |
| `npm run verify:fast` | PASS |
| `npm --prefix functions run test:unit` | 65 testes, 0 falhas, 0 skips (era 36) |
| `npm run test:unit:investments` | 5 testes, 0 falhas |
| Integração de Functions no Emulator | 43 testes, 0 falhas, 0 skips (era 32) |
| `m3Lifecycle.integration` (novo) | 11 testes, 0 falhas |
| Rules de metas (dividida em cenários) | 5 testes, 0 falhas (era 1 monolítico) |
| Rules de resgate (dividida em cenários) | 7 testes, 0 falhas (era 1 monolítico) |
| Rules de domínio (dividida em cenários) | 14 testes, 0 falhas (era 1 monolítico de ~275 linhas) |
| Rules do M3 (nova) | 7 testes, 0 falhas |
| Total no Emulator | 76 testes, 0 falhas, 0 skips |
| Guarda de `settlementDate` | Removida temporariamente das Rules → o teste novo falha; restaurada → passa |

As três suítes de Rules foram divididas por cenário sem alterar nenhuma asserção: a primeira falha deixa de mascarar as demais e passa a ter atribuição. A métrica operacional de sucesso cobre todas as mutações V2, não só as operações novas; a de falha é emitida pelo wrapper para qualquer callable do domínio.

Suítes novas: `functions/src/shared/__tests__/dateKeys.test.ts`, `functions/src/investments/__tests__/writeStrategy.test.ts`, `functions/src/investments/__tests__/documentContracts.test.ts`, `functions/src/investments/__tests__/m3Lifecycle.integration.test.ts`, `tests/firestore/investment-m3.rules.integration.test.mjs`.

##### Riscos e rollback do M3

- Os dois defeitos aritméticos de `reporting.ts` — `settledMovementCount` sem sinal e dimensões inalteradas puladas quando outra dimensão muda — **permanecem fora do escopo** e continuam derivando o acumulador incremental. O M3 não os corrige; passa a **detectar e reparar** a deriva pelo rebuild, que recalcula com o sinal correto e por todas as dimensões. Correção do escritor incremental fica no M7.
- Alterar o fuso muda a chave de documento de `investment_report_periods`. Períodos gravados antes desta sessão com chave UTC não migram sozinhos: exigem `rebuildInvestmentProjections`, que republica os meses corretos a partir do ledger. Enquanto isso, um mês de virada pode aparecer duplicado entre a chave antiga e a nova.
- `backfillInvestmentWorkspace` processa uma página por chamada e é operacional, não automático. Habilitar `features.investmentsV2.enabled` continua exigindo executá-lo até `completed: true`.
- A flag `features.investmentsV2.enabled` é lida **apenas no frontend**; nem `functions/src` nem `firestore.rules` a consultam. As duas trilhas seguem invocáveis no mesmo workspace, e um resgate legado gravado com a flag ligada fica invisível às projeções V2. Tratar no M8.
- Rollback: as mudanças são aditivas em coleções e campos. Reverter os arquivos do domínio restaura o comportamento anterior sem perda de histórico; `investment_valuations`, `investment_operational_metrics` e os lotes de importação passam a ser apenas dados órfãos, e nenhum documento financeiro é apagado.

##### Fora do escopo do M3

Full scan de `transactions` no frontend; `limit(100)` sem `orderBy` em metas; os dois defeitos aritméticos de `reporting.ts` apontados na revisão — `settledMovementCount` sem sinal e dimensões inalteradas puladas quando outra dimensão muda — que pertencem ao M7; índice legado `transactions [userId, date]` sem consumidor; qualquer alteração de UI.

##### Gate do M3

`npm run verify:fast`, depois `npm run verify:all` integralmente neste ambiente, que agora suporta Emulator e Playwright, e a skill `regression-release-gate` depois de carregável. Teste com skip não conta como aprovado. Sem push, merge ou deploy.

### M4 — Firestore Rules, índices e hardening

Delta executado neste marco:

1. A leitura de `investment_*` exige membership ativa e RBAC explícito: owner/admin/member acessam documentos operacionais; snapshots, event logs, import batches e audit logs ficam restritos a owner/admin; idempotency nunca é exposta. O fallback de owner sem membership não é aceito neste domínio.
2. Leituras unitárias validam ID e `workspaceId` contra o path, PF/PJ, moeda BRL, enums de status/operação, timestamps, strings limitadas e inteiros seguros para cents/micros. Movimentos pending também precisam manter todos os deltas em zero; settled exige evidência de liquidação.
3. Nenhum cliente, inclusive owner/admin, pode criar, editar ou apagar accounts, assets, movements, positions, valuations, snapshots, event logs, import batches, audit logs ou idempotency keys. As mutações financeiras e projeções continuam exclusivas de Cloud Functions/Admin SDK, com os campos imutáveis protegidos por negação total de escrita direta.
4. Listagens autorizadas exigem `limit` entre 1 e 100. Não foi introduzido listener, full-scan ou filtro client-side. Os únicos índices de investimento permanecem os exigidos pelas queries reais e paginadas do backend: ledger por conta/ativo/status/data, valuation por ativo/data e posição por meta/data.
5. A suíte de Rules usa dois tenants e owner/admin/member/viewer/removido, cobre owner sem membership, acesso cruzado bidirecional, documentos corrompidos, moeda/status/timestamp/cents inválidos, writes/deletes forjados e regressão de goals/cartões. `npm run verify:all` executou typecheck, builds, unitários, Emulator/Rules e 7 E2E Playwright sem falhas ou skips.

#### Plano do M4 — 2026-08-23 (reabertura pós-M3)

Levantamento em working tree, com `firestore.rules` em 1132 linhas e `firestore.indexes.json` em 35 índices. O M4 original permanece válido para o que existia antes do M3; esta reabertura cobre a superfície nova **e** os defeitos que o levantamento encontrou na superfície antiga, que a suíte monolítica anterior não exercitava.

##### 1. Mapa das coleções `investment_*`

14 blocos `match` sob `workspaces/{workspaceId}` (`firestore.rules:900-1028`). **Toda escrita de cliente está negada em todos**, sem nenhuma cláusula `create`/`update`/`delete` no domínio.

| Coleção | Linhas | `get` | `list` | Validador no `get` | Validador no `list` |
| --- | --- | --- | --- | --- | --- |
| `investment_accounts` | 908-914 | o/a/m | o/a/m | `isValidInvestmentAccount` | **nenhum** |
| `investment_assets` | 916-922 | o/a/m | o/a/m | `isValidInvestmentAsset` | **nenhum** |
| `investment_movements` | 924-930 | o/a/m | o/a/m | `isValidInvestmentMovement` | **nenhum** |
| `investment_positions` | 932-938 | o/a/m | o/a/m | `isValidInvestmentPosition` | **nenhum** |
| `investment_valuations` | 940-946 | o/a/m | o/a/m | `isValidInvestmentValuation` | **nenhum** |
| `investment_report_periods` | 1010-1016 | o/a/m | o/a/m | `isValidInvestmentReportPeriod` | **nenhum** |
| `investment_allocation_summaries` | 1018-1028 | o/a/m | o/a/m | `isValidInvestmentAllocationSummary` | **nenhum** |
| `investment_summaries` | 992-1008 | o/a/m, só `docId == 'current'` | **negado** | inline | n/a |
| `investment_snapshots` | 948-954 | owner/admin | owner/admin | `isValidInvestmentSnapshot` | **nenhum** |
| `investment_event_logs` | 956-964 | owner/admin | owner/admin | `isValidInvestmentEventLog` OU `isValidInvestmentFailureEventLog` | **nenhum** |
| `investment_import_batches` | 966-972 | owner/admin | owner/admin | `isValidInvestmentImportBatch` | **nenhum** |
| `investment_operational_metrics` (M3) | 974-986 | owner/admin | owner/admin | inline, sem função nomeada | **nenhum** |
| `investment_audit_logs` (legado M2) | 900-906 | owner/admin | owner/admin | `isValidLegacyInvestmentAudit`, **sem `hasAll` e sem vínculo com `docId`** | **nenhum** |
| `investment_idempotency_keys` | 988-990 | **negado** | **negado** | — | — |

##### 2. Matriz owner/admin/member

`canReadInvestmentDomain` = `hasRole(['owner','admin','member'])` (`firestore.rules:243-245`); `canReadSensitiveInvestmentDomain` = `hasRole(['owner','admin'])` (`:247-249`). **Nenhuma das duas admite `isWorkspaceOwnerByParent`**, ao contrário de todos os outros `canRead*`/`canWrite*` do arquivo (`:231`, `:235`, `:240`, `:75`).

| Camada | owner | admin | member | viewer | removido | não membro | anônimo | owner sem membership |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Operacional (contas, ativos, movimentos, posições, valorações) | R | R | R | — | — | — | — | **—** |
| Projeções (resumo, período, alocação) | R | R | R | — | — | — | — | **—** |
| Sensível (snapshots, event logs, lotes, métricas, audit) | R | R | — | — | — | — | — | **—** |
| Idempotência | — | — | — | — | — | — | — | — |
| Escrita em qualquer `investment_*` | — | — | — | — | — | — | — | — |

Assimetrias confirmadas:

1. **`viewer` não existe nas Rules.** A string nunca aparece no arquivo; o papel é negado no domínio de investimentos apenas por omissão em `canReadInvestmentDomain`. Como `isMember` (`:9-16`) é cego a papel, `viewer` lê `transactions`, `goals`, `settings_catalog` e o catch-all inteiros.
2. **Vazamento do tier sensível por `transactions`.** `writeCashProjection` (`functions/src/investments/operationsV2.ts:405-452`) espelha cada movimento em `transactions` com `investmentMetadata` contendo `principalCents`, `gainCents`, `feesCents`, `taxCents`, `status`, `domainMovementId` e `idempotencyKey`, mais `valueCents` e `settlementDate` no topo. A leitura de `transactions` (`firestore.rules:753`) é um `isMember` puro — sem validador, sem teto de listagem. **`viewer` e `member` leem o detalhe financeiro por movimento que `canReadSensitiveInvestmentDomain` existe para proteger.**
3. **`admin` se autopromove.** A escrita em `members` (`:746-749`) não tem nenhuma validação de payload: um `admin` grava `role: 'owner'` no próprio documento. E o update de `workspaces/{id}` (`:738`) também não valida payload, permitindo reescrever `ownerId` — takeover permanente — e trocar `type` PF/PJ, em que `profileTypeFromWorkspace` confia.
4. Cláusula `:749` é subsumida pela `:748` — código morto.

##### 3. Campos imutáveis

**Nenhum validador de investimento usa `hasOnly`.** Todos usam só `hasAll`; chave desconhecida é sempre aceita. `hasOnly` aparece 4 vezes no arquivo, nenhuma no domínio de investimentos (`:108-127` catálogo, `:199-211`, `:663-685` cartões).

`isCommonValidTransactionPayload` (`:44-68`) não tem **nem `hasAll` nem `hasOnly`**: é verificação de tipo em mundo aberto. Consequência — campos gerenciados pelo servidor que o cliente ainda cria e edita em `transactions`:

| Campo | Situação | Impacto |
| --- | --- | --- |
| `valueCents` | livre | É o valor autoritativo do domínio (`operationsV2.ts:409-410`). Cliente grava `value: 0.01` com `valueCents: 999999999` e dessincroniza as duas representações. |
| `transactionDate` | livre | Só a string `date` é validada (`:52`). |
| `profileType` | livre | Contexto contábil PF/PJ forjável. |
| `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | livres | Sem cláusula de imutabilidade em 752-805; `settings_catalog` já faz certo em `:187-196`. |
| `domainVersion` (topo) | livre | Só a versão aninhada em `investmentMetadata` é bloqueada. |
| `workspaceId` | **pode ser omitido** | `:55` é condicional: `!hasAny(['workspaceId']) \|\| == workspaceId`. |

Em contraste, `goals` está corretamente fechado (`allow write: if false`, `:888`): `netContributionCents`, `investmentProgressCents` e `investmentProjectionVersion` não são graváveis pelo cliente.

##### 4. Operações exclusivas do Admin SDK

Cruzamento de `INVESTMENT_BACKEND_WRITE_PLANS` (`functions/src/investments/writeStrategy.ts:64-521`, 20 planos, 16 alvos, todos com `clientDirectWriteAllowed: false`) contra as Rules: **14 dos 16 alvos têm escrita de cliente negada**. Os dois compartilhados são `transactions` (cliente cria/edita/apaga, guardado só pela lista de 5 chaves excluídas) e `settings_catalog` (owner/admin criam e editam itens nos mesmos grupos que o onboarding grava).

Nenhum alvo cai no catch-all: `isCreditCardDomainCollection` (`:592-622`) lista as 14 coleções, incluindo `investment_operational_metrics` (`:620`). Duas fragilidades estruturais:

- A função que governa o domínio de investimentos **chama-se `isCreditCardDomainCollection`** e é uma allowlist-por-exclusão mantida à mão. Uma 15ª coleção adicionada no backend sem entrada aqui herda leitura de catch-all para qualquer membro, inclusive `viewer`, contornando `canReadSensitiveInvestmentDomain` e `isBoundedInvestmentList`.
- **`investment_operational_metrics` não está no union `InvestmentWriteTarget`** (`writeStrategy.ts:18-34`), embora seja escrita por `observability.ts:59-86`. O cross-check declarativo tem ponto cego exatamente onde o M3 acrescentou coleção.

##### 5. Ataques cross-workspace

O limite de tenant é o caminho físico; nenhuma regra resolve um campo `workspaceId` em caminho, então não há como endereçar A carregando dados de B por ação de cliente. A exposição real é a inversa e é concreta:

1. **Documento sob A carregando `workspaceId: B`** — bloqueado no `get` por `hasValidInvestmentIdentity` (`:280`), **devolvido no `list`**, porque nenhuma das 12 cláusulas `allow list` aplica validador. O teste atual cobre só a metade `get` (`tests/firestore/investment-domain.rules.integration.test.mjs:384`).
2. **Autopromoção de `admin`** — item 3 da matriz; converte-se em owner e depois em `ownerId` do workspace.
3. **Transição de estado disparável por admin**: apagando o documento `members` do owner, o owner passa de gated-por-papel para gated-por-parent, o que lhe **retira toda leitura de `investment_*`** mantendo escrita em `transactions`/`settings_catalog`.
4. **Custo de avaliação como vetor de esgotamento**: `hasRole` → `isMember` custa `exists` + até 2 `get`, mais 1 `get` de `getRole` — até 4 leituras por documento, numa listagem de até 100.

##### 6. Queries reais e índices

Nenhum `onSnapshot` no caminho de investimentos — o único listener do frontend é `src/hooks/usePlan.ts:20`, sobre `users/{uid}`. Nenhuma query de agregação em todo o repositório. Limites em vigor: página de UI 20 (`readApi.ts:39`), período 100 (`:119`), alocação 11 por dimensão (`:120`), rebuild 50 padrão e 100 no teto (`contracts.ts:162`).

Os 14 índices `investment_*` têm consumidor; **nenhum órfão**. Três são redundantes:

| Índice | Linha | Veredito |
| --- | --- | --- |
| `investment_movements [status ASC, occurredAt ASC, __name__ ASC]` | 621 | **Redundante — remover.** Adicionado pelo M3 por excesso de cautela. O índice `[status ASC, occurredAt DESC, __name__ DESC]` (`:531`) já serve a query: `status` é filtro de igualdade e não impõe direção, e o Firestore percorre índice nos dois sentidos, de modo que a varredura reversa emite exatamente `occurredAt ASC, __name__ ASC` com desempate total. Mantê-lo cobra uma entrada de índice extra em **toda** escrita de movimento, o caminho mais quente do domínio, sem benefício. |
| `investment_report_periods [periodStart DESC, __name__ DESC]` | 319 | Redundante: a query não tem `where` e o `orderBy(documentId(), 'desc')` apenas repete o desempate implícito do índice de campo único. |
| `investment_positions [assetId ASC, status ASC]` | 589 | Só igualdade com `limit(1)`; servido por merge de índices de campo único. Manter apenas como decisão explícita de latência. |

**Nenhum índice composto falta no domínio de investimentos.** As queries novas do M3 estão cobertas: página de posições e prune ordenam por campo único ou por `__name__` e dispensam composto; a página de movimentos é servida pelo `:531`.

Há, porém, um índice faltando **fora** do domínio e dentro do escopo de índices: `functions/src/crons/creditCardInvoices.ts:319-323` é `collectionGroup` com `status in [...]` + `dueDate <=` + `orderBy dueDate`, e `firestore.indexes.json` não tem **nenhum** índice com `queryScope: COLLECTION_GROUP`. O cron falha com `FAILED_PRECONDITION` em produção.

Escala, medida e não estimada:

- Aporte liquidado: **7 a 9 leituras e 16 a 18 escritas** numa transação.
- Rebuild de projeções: pico de **105 escritas** por transação na última página de publicação com `pageSize` 100 — 21% do teto de 500 do Firestore. A fase `positions` custa **306 leituras** por página no teto, porque `projectionRebuild.ts:587-602` refaz `get` de conta e ativo por linha, em laço sequencial.
- Um render de relatório: **≤ 189 leituras** (1 + 100 períodos + 88 alocações); o card do dashboard, 8.
- **Teto de escrita: `investment_summaries/current` recebe escrita em toda mutação que toca posição** (`operationsV2.ts:353-356`), o que limita **todo o domínio de investimentos de um workspace a ~1 escrita/segundo**, independentemente de usuários ou contas. Uma importação de 5.000 linhas não roda em menos de ~83 min e gera contenção. Fragmentar o documento conflita com seu segundo papel, o de cerca do rebuild (`projectionRebuild.ts:429,447`).
- `functions/src/goals/operations.ts:193` (4 chamadores) e `functions/src/triggers/transactions.ts:34-40` fazem `transactions where goalId ==` **sem `limit` e sem `orderBy`, dentro de transação** — custo O(movimentos no histórico) por escrita de meta, e o M3 aumentou esse histórico ao espelhar cada movimento.

##### Decisões explícitas do M4

1. **Fechar o mundo em vez de enumerar exceções.** `transactions` passa a ter conjunto de chaves fechado por `hasOnly`, no formato de `hasOnlyCatalogKeys` (`:108-127`), com allowlist de campos de cliente. `valueCents`, `transactionDate`, `profileType`, `createdBy`, `createdAt`, `domainVersion` e os campos de investimento saem da superfície de cliente. `workspaceId` deixa de ser opcional.
2. **`list` passa a validar.** Cada `allow list` do domínio ganha, no mínimo, `resource.data.workspaceId == workspaceId`. O validador completo por documento não é aplicável em listagem sem custo proibitivo; a identidade de tenant é, e é ela que fecha o vazamento de documento estrangeiro.
3. **Tier sensível deixa de vazar por `transactions`.** Duas opções, decidir com medição: (a) reduzir `investmentMetadata` no espelho ao mínimo que o consumidor legado usa, movendo o detalhe para `investment_movements`; ou (b) restringir a leitura de `transactions` com `investmentMetadata` a owner/admin. **Preferida: (a)** — o espelho é projeção de compatibilidade e não deveria carregar o detalhe autoritativo.
4. **`viewer` passa a ser explícito.** O papel entra nas Rules por nome, com leitura negada no domínio de investimentos e política declarada para `transactions` e `goals`, em vez de depender da omissão em uma lista.
5. **`members` e `workspaces` ganham validação de payload.** Papel restrito a enum, `uid` e `workspaceId` pinados, `ownerId` imutável por cliente, e mudança de papel/ownership movida para callable com RBAC — hoje é confused deputy de um passo.
6. **Divergência do fallback de owner-sem-membership é resolvida, não tolerada.** O backend concede `owner` a quem é `ownerId` sem documento de membership (`creditCards/auth.ts:90-94`, `investments/infrastructure.ts:126-131`) e as Rules negam-lhe toda leitura de `investment_*`. **Decisão: alinhar as Rules ao backend**, acrescentando `|| isWorkspaceOwnerByParent(workspaceId)` a `canReadInvestmentDomain` e `canReadSensitiveInvestmentDomain` — um owner não pode ficar trancado fora da própria carteira, e o texto do M4 original que afirmava o contrário é corrigido.
7. **O guarda do catch-all deixa de ser lista manual mal nomeada.** Renomear para algo como `isBackendOwnedCollection` e derivá-lo de prefixo (`investment_`, `credit_card_`, `goal_`) em vez de enumeração, para que coleção nova nasça negada.
8. **A matriz declarativa passa a cobrir 100% das escritas.** `investment_operational_metrics` entra no union `InvestmentWriteTarget` e ganha plano; um teste passa a falhar se existir escrita de backend em coleção sem plano.
9. **Índices seguem as queries reais.** Remover `investment_movements [status, occurredAt ASC, __name__ ASC]` (`:621`); decidir explicitamente sobre os dois redundantes restantes; acrescentar o índice `COLLECTION_GROUP` do cron de faturas.
10. **O teto de ~1 escrita/s é decisão de arquitetura, não defeito a corrigir de improviso.** O M4 mede e registra; separar a cerca do rebuild do documento de resumo — movendo `projectionVersion` para documento próprio — é pré-requisito de qualquer fragmentação e fica declarado como trabalho do M8, não do M4.
11. **`transactions where goalId ==` ganha `limit` e ordenação** ou é substituída por contador mantido, porque cresce com o histórico e roda dentro de transação.
12. **Nada de teste com skip.** Toda negativa nova precisa de teste de Emulator com dois tenants e os cinco papéis, provando a negação nos dois sentidos.

##### Lotes executáveis

**M4.A — fechamento de `transactions`.** `hasOnly` com allowlist, `workspaceId` obrigatório, imutabilidade de `createdBy`/`createdAt`, campos autoritativos fora do alcance do cliente. Testes: mass assignment de `valueCents`, forja de `profileType`, criação sem `workspaceId`, edição de `createdBy`.

**M4.B — `list` com identidade de tenant e `viewer` explícito.** Predicado de `workspaceId` em toda listagem do domínio; `viewer` nomeado nas Rules. Testes: documento semeado com `workspaceId` estrangeiro é invisível também em listagem; `viewer` negado nas 14 coleções.

**M4.C — escalonamento de privilégio.** Validação de payload em `members` e `workspaces`, remoção da cláusula morta `:749`, movimentação de troca de papel/ownership para callable. Testes: admin não vira owner, admin não reescreve `ownerId`, admin não troca PF/PJ, último owner não é removido.

**M4.D — coerência entre camadas.** Fallback de owner-sem-membership alinhado nas Rules; catch-all derivado de prefixo; `investment_operational_metrics` no union e no plano; teste que quebra quando existe escrita de backend sem plano declarado.

**M4.E — índices e queries.** Remoção do índice redundante do M3, decisão sobre os outros dois, índice `COLLECTION_GROUP` do cron, `limit`/ordenação em `transactions where goalId ==`, memoização de conta/ativo na fase `positions` do rebuild. Testes: cada query real tem índice, nenhuma query sem `limit`, custo por página medido.

**M4.F — higiene de escala já identificada.** Sondagem `n+1` para `periodsTruncated` (hoje sempre falso em 5 de 6 faixas), cerca/lease no backfill, ordenação explícita antes do fatiamento da fase `publish`, e enforcement de `MAX_WRITES_PER_REBUILD_TRANSACTION`, hoje declarado e nunca referenciado.

##### Fora do escopo do M4

Storage — `firebase.json` não declara bloco `storage` e não existe `storage.rules`; o item correspondente do checklist multi-tenant é `N/A` com evidência, não lacuna. Paginação do frontend por `updatedAt DESC`, que pode pular ou repetir documentos (`readApi.ts:59-62,86-87`), pertence ao M5. Os dois defeitos aritméticos de `reporting.ts`, incluindo o descarte de delta em 7 das 8 dimensões quando uma muda, permanecem no M7. A fragmentação de `investment_summaries/current` e o gate da feature flag no backend e nas Rules pertencem ao M8.

##### Execução do M4 — 2026-08-23

**M4.A — `transactions` fechada.** `hasOnlyClientTransactionKeys` fecha o conjunto de chaves na criação, com allowlist derivada do que o frontend realmente monta em `buildTransactionPayload`. `workspaceId` passa a ser obrigatório e igual ao path. Na edição, `changesOnlyMutableTransactionKeys` usa `diff().affectedKeys().hasOnly(...)`, o que torna `workspaceId`, `userId`, `profileId`, `createdAt` e todo campo gravado só pelo backend imutáveis por construção — inclusive `valueCents`, que é o valor autoritativo do domínio e que o frontend nunca escreve (zero ocorrências em `src/`). Preferiu-se `affectedKeys` a `hasOnly` no update porque este último quebraria documentos legados que carreguem campos fora da allowlist.

**M4.C — escalonamento de privilégio fechado.** `members` deixa de aceitar escrita sem validação: `uid` fixado no ID do documento, papel restrito a enum, ninguém altera o próprio papel a menos que seja o `ownerId` real do workspace, conceder ou rebaixar `owner` exige owner, e apagar o membership do owner exige ser o owner — era essa exclusão que convertia o owner de gated-por-papel para gated-por-parent. `workspaces` protege `ownerId`, `type`, `features`, `userId` e `createdAt` por `affectedKeys`, mantendo nome, cor e preferências editáveis para não quebrar Configurações. A cláusula morta subsumida foi removida.

**M4.D — coerência entre camadas.** `canReadInvestmentDomain` e `canReadSensitiveInvestmentDomain` passaram a aceitar `isWorkspaceOwnerByParent`, alinhando as Rules ao backend: o owner sem documento de membership escrevia na carteira pelas callables e via a tela vazia. O guarda do catch-all deixou de ser enumeração mantida à mão e virou `isBackendOwnedCollection`, derivado por prefixo (`investment_`, `credit_card_`, `goal_`) mais quatro nomes sem prefixo — uma coleção nova do domínio nasce negada em vez de herdar leitura de qualquer membro. `investment_operational_metrics` entrou no union `InvestmentWriteTarget` e em todos os 21 planos, com teste que falha se alguma operação gravar métrica sem declará-la.

**M4.E — índices e queries.** Removido `investment_movements [status, occurredAt ASC, __name__ ASC]`, que o próprio M3 adicionara por excesso de cautela: `status` é filtro de igualdade e não impõe direção, e o Firestore percorre índice nos dois sentidos, então `[status, occurredAt DESC, __name__ DESC]` já servia a varredura ascendente do rebuild. Acrescentado o índice `COLLECTION_GROUP` de `credit_card_invoices [status, dueDate, __name__]`, sem o qual o cron de faturas falha com `FAILED_PRECONDITION` — o arquivo não tinha nenhum índice com esse escopo. `transactions where goalId ==`, que rodava sem `limit` e sem `orderBy` dentro de transação em quatro chamadores, passou a ter ordenação estável e teto de 2.000 aportes, com falha explícita ao ultrapassá-lo em vez de somar silenciosamente um subconjunto.

**M4.F — higiene de escala.** `MAX_WRITES_PER_REBUILD_TRANSACTION` deixou de ser constante morta e passa a ser verificado antes de abrir a transação. A publicação do rebuild ordena as entradas antes de fatiar, em vez de depender da ordem de chaves de mapa do Firestore ao ir e voltar pelo snapshot. A fase `positions` memoiza conta e ativo por página, cortando o pior caso de 306 para cerca de 110 leituras. O backfill ganhou cerca por lease com expiração, já que roda fora de transação e duas execuções concorrentes intercalavam e reprocessavam páginas. A sonda de truncamento de períodos passou ao padrão n+1 das alocações; a heurística anterior comparava o tamanho com o teto de 100 e por isso nunca sinalizava truncamento nas cinco faixas que pedem 3, 5, 7 ou 14 períodos.

##### Duas decisões do plano revisadas contra o comportamento real

1. **A decisão 2 — validar identidade de tenant na listagem — não é implementável.** Regras não são filtros: numa consulta o Firestore precisa decidir a partir das restrições da própria query, sem documento concreto, então qualquer predicado sobre `resource.data` numa cláusula `list` é inavaliável e nega a consulta inteira. Verificado no Emulator com um documento único e bem formado, que ainda assim foi negado. A cláusula foi revertida nas 12 coleções e o arquivo registra o motivo. **A garantia migrou para a camada capaz de impô-la:** `assertInvestmentDocument` passou a receber o workspace esperado e a comparar o campo `workspaceId` com o path em toda escrita do domínio. O isolamento de tenant na listagem continua garantido pelo path, que é o limite físico.

2. **As remoções de índice foram deliberadamente conservadoras.** Só o índice redundante que o M3 criara foi removido, com raciocínio fechado. `investment_report_periods [periodStart DESC, __name__ DESC]` e `investment_positions [assetId, status]` permanecem: a análise indica que ambos são dispensáveis, mas a assimetria de risco não compensa — remover economiza uma entrada de índice por escrita, e errar derruba a query em produção com `FAILED_PRECONDITION`, que o Emulator não detecta. Ficam registrados como limpeza medida do M8.

##### Regressão do M3 corrigida

O M3 tornou `correlationId` obrigatório nas três callables legadas do M2, mas `src/modules/transactions/api.ts` não o enviava em nenhuma das três chamadas. Resgate, cancelamento e estorno pelo caminho legado estavam quebrados desde o M3. Corrigido nos três pontos.

##### Lacuna que permanece aberta

**O tier sensível continua legível por `member` e `viewer` através de `transactions`.** O espelho de caixa carrega `investmentMetadata` com `principalCents`, `gainCents`, `feesCents`, `taxCents` e `idempotencyKey`, e a leitura de `transactions` é `isMember` puro. Nenhuma das duas saídas cabia no M4: restringir a leitura por presença de `investmentMetadata` negaria a listagem inteira de `transactions` para membros — pelo mesmo motivo da decisão 1 —, e reduzir o espelho exige decidir de que campos os consumidores legados do M2 ainda dependem, o que é decisão de domínio, não de Rules. Fica no M8, com as duas opções e a evidência registradas.

##### Evidências do M4 — 2026-08-23

| Verificação | Resultado |
| --- | --- |
| `npm run verify:fast` | PASS |
| Unitários de Functions | 67 testes, 0 falhas, 0 skips (era 65) |
| Unitários de investimentos no frontend | 8 testes, 0 falhas |
| Integração de Functions no Emulator | 43 testes, 0 falhas, 0 skips |
| Rules de metas | 5 testes, 0 falhas |
| Rules de resgate | 7 testes, 0 falhas |
| Rules de domínio | 14 testes, 0 falhas |
| Rules do M3 | 7 testes, 0 falhas |
| **Rules do M4 (nova)** | **19 testes, 0 falhas** |
| Total no Emulator | 95 testes, 0 falhas, 0 skips |

`tests/firestore/m4-hardening.rules.integration.test.mjs` usa dois workspaces e cinco papéis — owner, admin, member, viewer e removido — mais um tenant estrangeiro, e cobre: leitura e listagem cross-tenant nos dois sentidos; autopromoção de admin, promoção de terceiro, rebaixamento do owner, exclusão do membership do owner e forja de `uid`; reescrita de `ownerId`, `type` e `features`; payload forjado em `transactions` com dez campos autoritativos, `workspaceId` ausente, `workspaceId` estrangeiro e `userId` alheio; imutabilidade em update; negação de escrita direta nas 14 coleções do domínio para os três papéis, incluindo update e delete de positions, snapshots, event logs e idempotência; e regressão dos domínios existentes — fluxo legítimo do frontend, catálogo e gestão de membros pelo owner.

##### Gate do M4

`npm run verify:fast`, depois `npm run verify:all` integralmente, mais as skills `multi-tenant-security-review` e `firestore-scale-cost-review` sobre o diff. Teste com skip não conta como aprovado. Sem push, merge ou deploy.

### M5 — frontend

1. A rota existente de investimentos seleciona a UI patrimonial apenas quando `features.investmentsV2.enabled === true`; flag ausente ou falsa mantém o legado sem alterações e sem dual-write.
2. `src/modules/investments` lê accounts, assets, positions e movements com `limit(20)`, ordenação estável, cursores e filtros server-side; o resumo usa a projeção constante `investment_summaries/current`, atualizada atomicamente com positions.
3. A UI expõe resumo, contas, ativos/posições, movimentações, estados loading/empty/error/success, aporte, pedido e liquidação de resgate parcial/total, vínculo com meta, inativação e reversão privilegiada. Toda mutação usa callable; positions e projeções continuam sem escrita direta do cliente.
4. Criação/edição de contas e ativos ganhou callables owner/admin estritos, idempotentes e auditáveis; inativação preserva histórico. Os índices adicionados correspondem somente às combinações de filtro/ordenação usadas pela V2.
5. A experiência nova usa textos pt-BR, erros seguros, controles rotulados, `dialog` modal com Escape e devolução de foco, tabelas com rolagem mobile e cards responsivos. Playwright direcionado cobre flag falsa, flag verdadeira, viewport móvel, foco/modal e criação via callable.
6. Risco residual: workspaces com positions V2 anteriores à projeção `investment_summaries/current` precisam de rebuild operacional antes de habilitar a flag; a UI sinaliza resumo indisponível e não calcula totais por full-scan.
7. O gate final executou `verify:all` integralmente: typecheck, builds frontend/Functions, 33 testes unitários de Functions, 3 testes unitários de semântica, integrações e Rules no Emulator e 9 E2E Playwright passaram sem falhas ou skips. O smoke legado também confirmou aporte/meta após invalidar pontualmente o catálogo semeado para eliminar a corrida de cache.

#### Execução do M5 — 2026-08-23 (verificação e fechamento pós-M3/M4)

O M5 **não era greenfield**: a experiência V2 já existia e foi confirmada no código antes de qualquer alteração. `InvestmentsPortfolioView` já entregava resumo patrimonial, contas, ativos e posições, movimentações, filtros por situação/operação/conta, paginação por cursor, aporte, pedido e liquidação de resgate, vínculo e desvínculo de meta, reversão privilegiada, inativação, estados de carregamento/vazio/erro/sucesso, `dialog` modal com Escape e devolução de foco, e textos em pt-BR. `App.tsx:574,611,622` já isolava a V2 atrás de `features.investmentsV2.enabled === true`, com o legado intacto quando a flag é falsa.

O que esta sessão fechou são as lacunas que o M3 e o M4 abriram por baixo da interface.

1. **O estado `cancelled` não existia no frontend.** `InvestmentMovementStatus` era `'pending' | 'settled'`, e o render usava um ternário que exibia **“Liquidada” para qualquer coisa que não fosse pendente** — um movimento cancelado pelo M3.D apareceria como liquidado. O tipo passou a incluir `cancelled`, o rótulo virou função explícita e o filtro de situação ganhou a opção “Cancelada”.

2. **`cancelInvestmentMovement` não tinha porta de entrada.** O M3.D criou a saída do estado pendente justamente porque um resgate pendente era obrigação permanentemente aberta, mas a interface só oferecia “Liquidar”. Entrou a ação “Cancelar pedido”, disponível a partir de qualquer movimento pendente, com motivo obrigatório e aviso de que o registro é preservado. Sem gate de `canManage`, coerente com a matriz declarativa: `cancelInvestmentMovement` é `owner/admin/member`.

3. **A consulta do card do dashboard não checava o workspace.** `InvestmentDashboardOverview` passou a usar `enabled: workspaceId.length > 0`.

Confirmado por leitura de código, não por suposição: toda mutação da V2 passa por `callInvestment`, que só chama callables; não há nenhuma escrita direta em `investment_positions` nem em qualquer coleção do domínio; não há `onSnapshot` em todo o caminho de investimentos — o único listener do frontend é `src/hooks/usePlan.ts:20`, sobre `users/{uid}`; e não há full scan, com todas as listagens filtradas, ordenadas, limitadas a 20 e paginadas por cursor. A matriz de papéis da interface confere com a do backend: `canManageActiveWorkspace` é `owner || admin` (`WorkspaceContext.tsx:133-134`) e gateia exatamente reversão, cadastro e inativação, enquanto aporte, resgate, liquidação, cancelamento e vínculo de meta permanecem abertos a `member`.

##### Evidências do M5 — 2026-08-23

| Verificação | Resultado |
| --- | --- |
| `npm run verify:fast` | PASS |
| Unitários de Functions | 67 testes, 0 falhas, 0 skips |
| Unitários de investimentos no frontend | 8 testes, 0 falhas |
| **Playwright, suíte completa** | **12 testes, 0 falhas** |

O E2E novo — `e2e/investments-v2.spec.ts`, “pedido de resgate pendente pode ser cancelado sem tocar caixa nem posição” — percorre o ciclo alterado inteiro pela interface: aporte por callable, pedido de resgate parcial, verificação de que o pendente exibe “Pendente” e oferece liquidação, cancelamento com motivo, e então confirma que o item passa a exibir “Cancelada”, deixa de oferecer liquidação e cancelamento, e que `principalCents` e `version` da posição não mudaram, `status` do movimento é `cancelled` com `cashDeltaCents` e `principalDeltaCents` em zero e o motivo persistido. Fecha checando o filtro de canceladas e o de pendentes.

A suíte completa é a regressão que importava neste ponto: `investment-redemption`, `goal-contributions` e os três testes de cartão exercitam escrita em `transactions` e passaram com as Rules fechadas no M4, confirmando que a allowlist e a imutabilidade por `affectedKeys` não quebraram nenhum fluxo legítimo. `flag desligada preserva a experiência legada` continua verde.

### M6 — Cadastros e onboarding PF/PJ

1. `InvestmentAccount` e `InvestmentAsset` permanecem em coleções próprias e são preparados por callable owner-only, transacional, idempotente e auditável. Carteiras do catálogo continuam representando caixa e a UI explicita que não são contas de investimento.
2. Tipo, classe, risco, liquidez, indexador e estratégia passam a grupos customizáveis de `settings_catalog`; classe e estratégia respeitam PF/PJ. O seed usa chaves determinísticas, adota itens legados que ainda não possuíam lock e não duplica conta/ativo ativo.
3. Workspace novo de owner recebe conta e ativo ativos para o primeiro aporte. Workspace antigo pode executar a mesma rotina em Configurações > Cadastros; admin/member não podem executá-la, e registros arquivados permanecem preservados.
4. Exclusão de catálogo foi substituída por inativação; Rules bloqueiam hard delete de item e lock. A tela atual mantém seus grupos, adiciona taxonomias patrimoniais e usa listagem de 30 itens com cursor e índices correspondentes; o `TransactionModal` legado não foi alterado.
5. Contratos mantêm IDs Firestore como `string`, moeda BRL e perfil PF/PJ explícito. Mensagens novas são seguras e em pt-BR, com estados de carregamento, erro e sucesso.
6. Testes cobrem contrato estrito, seed/replay/dedupe, item legado sem lock, archived/active, owner/admin, tenant forjado, PF/PJ, Rules e E2E da tela existente. Typecheck, builds, testes direcionados, Auth/Firestore Emulator e Playwright passaram sem skips.

##### Reverificação do M5 — 2026-08-23

Solicitada nova execução do M5. O marco **não foi reimplementado**: cada requisito foi reconferido contra o código atual, e o esforço foi para destravar a verificação por Playwright, que havia parado de rodar neste ambiente durante o M6.

Conferência de requisitos, por evidência:

| Requisito | Evidência |
| --- | --- |
| V2 atrás de `features.investmentsV2.enabled` | `src/App.tsx:574,611,622` — três pontos de gate |
| Flag falsa preserva o legado | `App.tsx:622` roteia `investimento` para `TransactionsView` quando a flag não é `true` |
| Mutação apenas por callable | Nenhuma ocorrência de `setDoc`/`updateDoc`/`addDoc`/`deleteDoc`/`writeBatch` em `src/modules/investments/` |
| Sem escrita direta em positions | Mesma evidência acima; as 11 callables usadas pela carteira estão listadas em `InvestmentsPortfolioView` |
| Sem full scan e sem listener | Nenhum `onSnapshot(` no módulo; 5 de 5 consultas com `limit(` em `readApi.ts` |
| Superfícies exigidas | Abas Resumo, Contas, Ativos e posições, Movimentações |
| Estados e RBAC | 7 marcadores de carregamento/vazio/erro/sucesso; 5 gates por `canManage`; 7 filtros que reiniciam o cursor |

**Dois defeitos de infraestrutura de teste corrigidos**, que impediam a suíte de rodar:

1. **`/dev/shm` de 64 MB.** O renderer do Chromium estoura esse limite ao carregar o bundle e a página morre com `Target crashed`/`Page crashed` antes de qualquer asserção — inclusive em testes sem relação com investimentos. `playwright.config.ts` passou a lançar o navegador com `--disable-dev-shm-usage`, o contorno documentado para containers.
2. **Artefatos de depuração gravados em toda execução local.** `video: 'retain-on-failure'` grava sempre e descarta no sucesso. Vídeo, screenshot e trace passaram a seguir o mesmo critério de `process.env.CI` que o arquivo já usava para `retries` e `reporter`: preservados no CI, desligados localmente.

**Um defeito nos próprios testes**, corrigido: as asserções usavam `getByRole('status')`, que colide com o `role="status"` do estado de carregamento da tela e ignora o `role="alert"` de erro — de modo que uma falha real de callable aparecia como “elemento não encontrado”, sem revelar a mensagem. As asserções passaram a ancorar no texto exato do aviso.

Resultado: `e2e/investments-v2.spec.ts` **4 de 4 verdes** em execução isolada, incluindo o ciclo de aporte, pedido de resgate e cancelamento. A suíte completa fica em 9 a 10 de 13 conforme a execução, com as falhas **alternando de teste a cada rodada** e cada spec passando isoladamente — assinatura de contenção de recursos do container, não de defeito. Fica registrado assim, sem promover a execução completa a aprovada.

#### Execução do M6 — 2026-08-23 (verificação e integração em Cadastros)

Como no M5, o marco **não era greenfield** e foi conferido no código antes de qualquer alteração. Já existiam: os seis grupos de taxonomia patrimonial como seções de Configurações > Cadastros (`settings-catalog/presentation.ts:124-149`), com `investment_class` e `investment_strategy` gravando `workspaceScope` igual ao PF/PJ do workspace (`useSettingsCatalogScreen.ts:165-169`); o `InvestmentOnboardingCard` montado em Cadastros com a ação owner-only de preparar padrões; e o seed idempotente por IDs determinísticos e sondas de existência em `onboarding.ts`, disparado automaticamente na criação de workspace (`WorkspaceContext.tsx:118`, `workspaces/hooks.ts:22`) e manualmente pelo botão para workspace antigo.

**Vocabulário de status, decidido explicitamente.** Não foi criado um terceiro estado. `settings_catalog` usa `active | inactive` (`firestore.rules:132-134`) e as entidades patrimoniais usam `active | archived` (`InvestmentLifecycleStatus`). Os três valores da especificação são a união dos dois vocabulários, e cada conceito mantém o seu: item de catálogo se inativa, conta e ativo se arquivam. A interface apresenta ambos como “Ativos/Inativos” em pt-BR, sem expor o termo técnico.

**A lacuna real: conta e ativo não eram geridos em Cadastros.** A tela mostrava apenas a contagem de registros ativos; criar, editar e inativar só existia dentro da carteira patrimonial, e não havia como consultar o que fora inativado. Entrou `InvestmentRegistrySection`, montada em Configurações > Cadastros logo após o card de onboarding:

- Abas Contas e Ativos, filtro de situação Ativos/Inativos, paginação por cursor e os quatro estados de carregamento, vazio, erro e sucesso.
- Criação, edição e inativação **apenas por callable** — `saveInvestmentAccount`, `saveInvestmentAsset`, `archiveInvestmentAccount`, `archiveInvestmentAsset` —, sem nenhuma escrita direta em coleção do domínio.
- Gate por `canManageActiveWorkspace` (owner/admin), coerente com a matriz declarativa do backend, que classifica as quatro operações como privilegiadas.
- Inativar preserva o histórico: o registro sai da lista de ativos e permanece consultável pelo filtro de inativos, com o motivo registrado no event log.
- O texto reafirma a distinção de conceitos: carteira é meio de pagamento e saldo em caixa; conta de investimento é onde o patrimônio fica custodiado. As duas nunca se misturam e nenhuma substitui a outra.
- Os cadastros legados da tela permanecem intactos, sem alteração de texto ou de comportamento.

Dois ajustes de qualidade surgiram do próprio desenvolvimento. O aviso de resultado deixou de sobreviver à ação seguinte — um “sucesso” remanescente mascarava a falha da próxima operação, e foi isso que escondeu a primeira falha durante os testes. E a confirmação de inativação passou a viver dentro do `dialog` do componente em vez de `window.confirm`: o modal nativo não é estilizável, não devolve foco de forma previsível e fica fora da árvore acessível da seção.

##### Evidências do M6 — 2026-08-23

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| Unitários de Functions | 67 testes, 0 falhas, 0 skips |
| Unitários de investimentos no frontend | 8 testes, 0 falhas |
| Emulator: integração de Functions e as cinco suítes de Rules | **95 testes, 0 falhas, 0 skips** |
| `vite build` | **Não conclui neste container** — encerrado por sinal na fase de *rendering chunks*. Isolado: falha igualmente com o componente do M6 desmontado. |
| Playwright, `e2e/investment-onboarding.spec.ts` | **2 de 2 verdes** |

O E2E `Cadastros gerencia conta e ativo de investimento sem tocar carteiras de caixa` cobre criação, edição sem duplicação, inativação com verificação do estado no Firestore, reaparecimento sob o filtro de inativos junto ao registro previamente arquivado, e criação de ativo com finalidade PF. Ele só ficou verde depois de destravar a infraestrutura de teste — ver a reverificação do M5, que corrigiu `/dev/shm`, os artefatos de depuração locais e o uso de `getByRole('status')` nas asserções.

Sobre o `vite build`: verificado que **falha de forma idêntica com o componente do M6 desmontado**, encerrado por sinal na fase de *rendering chunks*. A causa é o limite de memória do container, não o marco. `typecheck` cobre a checagem de tipos, e `npm --prefix functions run build` conclui normalmente.

### M7 — metas, relatórios, dashboard e alocações

Delta executado neste marco:

1. Com `features.investmentsV2.enabled === true`, metas leem `investmentProgressCents`, respeitando `net_contributions` ou `current_value`; flag falsa preserva `currentAmount` legado. Movimentos pending permanecem fora das projeções, enquanto resgate, reversão e vínculo/desvínculo liquidados usam as operações atômicas e idempotentes do domínio oficial.
2. Cada mutação financeira liquidada atualiza no mesmo limite transacional uma projeção mensal em `investment_report_periods`. A projeção separa aporte, principal resgatado, ganho realizado, taxas, impostos, custo, caixa e variação patrimonial; replay não reaplica deltas e reversão compensa o evento original.
3. `investment_allocation_summaries` materializa, sem scan de posições no navegador, os cortes atuais por conta, classe, ativo, meta, risco, liquidez, indexador e finalidade. As leituras usam até 100 meses no período total, no máximo 14 nos filtros usuais e 11 buckets por dimensão, sinalizam truncamento e possuem somente os índices exigidos pelas queries reais.
4. A finalidade do ativo é explícita: PF aceita não classificado, aposentadoria ou objetivo; PJ aceita não classificado, reserva, aplicação financeira, reinvestimento ou imobilizado. PF sem meta permanece `Sem meta`/`Não classificado`; a classificação não pode mudar depois de existir posição, preservando relatórios históricos.
5. Relatórios exibem o `InvestmentOverview` oficial, com caixa separado do patrimônio e principal resgatado separado da renda. Gráficos usam a projeção mensal; dashboard mantém os indicadores legados e acrescenta patrimônio, evolução e alerta de reconciliação somente na V2.
6. Rules permitem leitura limitada das novas projeções apenas a membros do workspace e proíbem qualquer escrita direta. Testes unitários e Emulator cobrem períodos, reconciliação, principal versus renda, reversão, replay/dupla contagem, PF/PJ, isolamento e feature flag.
7. Risco residual: posições V2 anteriores ao M7 exigem backfill operacional das novas projeções antes da habilitação da flag; essa migração não foi automatizada neste marco. Ausência ou divergência de projeções é mostrada como alerta seguro, sem fallback para full-scan.
8. Gate final em 2026-08-20: `npm run verify:all` passou com typecheck, builds frontend/Functions, 36 testes unitários de Functions, 5 testes unitários de investimentos, 32 testes integrados de Functions, todas as suítes de Rules e 11 E2E; zero skips.

## Claude handoff after M2

Auditoria de continuidade em 2026-08-21. Nenhum marco foi reimplementado e M3 não foi iniciado.

**Base auditada.** `origin/main` `3397493` → `HEAD` `c754cfa`, com três commits locais ainda não enviados (`8f1cd35`, `c6f09ec`, `c754cfa`) mais working tree não commitado contendo o delta do M7 reescrito.

**Checks executados.** `npm run verify:fast` PASS (typecheck, builds, 36 unitários de Functions e 8 de investimentos, 0 skips). Testes direcionados de M1/M2 no Emulator Auth/Firestore: `goalIntegrity.integration` 3, `redemption.integration` 5, Rules de metas 1, Rules de resgate 1 — 10 testes, 0 skips, exit 0. `verify:all` completo (integrações do M3+ e Playwright) não foi reexecutado nesta auditoria.

**Confirmado no código.** M0 tem baseline e gates utilizáveis. M1 estabilizou IDs string no domínio, vínculo retroativo conectado (`src/App.tsx:704` → `setGoalTransactionLinks`), callables com RBAC/idempotência/auditoria, `progressBasis` e trigger determinístico sem `increment`. M2 mantém principal resgatado fora de receita operacional (`src/modules/reports/logic.ts:117`, `src/modules/investments/semantics.ts:36-49`), reduz meta e saldo apenas pelo principal (`functions/src/investments/operations.ts:368-380`) e tem idempotência, concorrência e estorno compensatório testados. Nenhuma regressão P0 de M0-M2 foi encontrada.

**Regressão corrigida (P1 de verificação, introduzida em `c6f09ec`).** `goalIntegrity.integration.test.ts` e `goals.rules.integration.test.mjs` usavam `{skip: !enabled}` e ficavam verdes sem Emulator, mascarando RBAC, isolamento, retry e concorrência de metas. Passaram a falhar de forma dura, alinhados ao padrão já usado em resgate e no M3. Sem Emulator o exit é 1; com Emulator as quatro suítes seguem passando.

**Lacunas reais.**

1. O checklist não corresponde ao histórico: M1 e M2 seguem `[ ]` enquanto M3–M7 estão `[x]`, embora dependam deles. O código de M3–M7 existe; a divergência é de registro.
2. Escopo trocado sem registro: o M7 original (hardening, observabilidade, E2E e gate final — ensaio de migração, rebuild em dataset representativo, métricas/correlação e runbook de reparo) foi substituído pelo M7 atual de relatórios. Esses itens não foram executados nem realocados.
3. Sem rotina de backfill: os riscos residuais de M5 e M7 exigem backfill das projeções antes de habilitar `features.investmentsV2.enabled`, mas só existem callables por entidade (`recalculateInvestmentPosition`, `recalculateGoalInvestmentProgress`, `rebuildGoalProgress`). Não há migração ou reconciliação em lote.
4. A skill `regression-release-gate`, exigida por [AGENTS.md](../../AGENTS.md) e pelo M7 original, não é carregável: existe apenas em `tools/codex-skill-drafts/`, fora de `.claude/skills/`.
5. Achados P2 não bloqueantes: `reverseInvestmentRedemption` aceita papel `member` (`functions/src/investments/callables.ts:63-67`); projeções mensais e de alocação concentram escrita em documento único por período/dimensão (`functions/src/investments/reporting.ts:116,283`); `InvestmentDashboardOverview` consulta antes de `workspaceId` resolver.

**Pré-condições de M3.** Reconciliar o checklist com o que foi entregue e aprovado; reintroduzir o marco de hardening removido ou declarar seu descarte explicitamente; executar `npm run verify:all` integralmente neste ambiente, que agora suporta Emulator e Playwright (bind local liberado, Java 21, firebase-tools 15.4.0), registrando o resultado sem promover etapa não executada; decidir e implementar o backfill antes de habilitar a flag; tornar a skill do gate carregável.

#### Execução do M7 — 2026-08-23 (defeitos aritméticos e fechamento patrimonial)

Dois defeitos que o ExecPlan atribuía a este marco foram corrigidos, e a série mensal passou a materializar o fechamento patrimonial.

**1. `settledMovementCount` ignorava o sinal.** Era `1` fixo, então um aporte seguido do seu estorno deixava a contagem em 2 em vez de 0, contrariando a fórmula, que aplica `sign` a toda componente. Passou a `sign`.

**2. Delta de alocação era descartado nas dimensões inalteradas.** Quando uma única chave de dimensão mudava, o ramo correspondente devolvia cedo para as outras sete, que subcontavam principal e valor atual de forma permanente. O caso concreto é o aporte que já nasce vinculado a uma meta: a chave `goal` muda de `unassigned` para o ID da meta no mesmo instante em que o dinheiro entra, e conta, classe, ativo, risco, liquidez, indexador e finalidade ficavam zerados. Agora cada dimensão é tratada pelo que de fato aconteceu com ela: inalterada recebe a variação; alterada recebe a saída total da faixa antiga e a entrada total na nova.

Ambos foram provados por reversão: reintroduzidos os defeitos, os testes novos falham; restaurados, passam.

**3. Fechamento patrimonial na série mensal.** `investment_report_periods` passou a guardar `closingCurrentValueCents`, com `closing(M) = Σ_{m ≤ M} currentValueDelta(m)`. O gráfico de evolução lê esse valor direto; foi removida a reconstrução que partia do patrimônio atual e subtraía deltas para trás, porque dependia da janela carregada. O caminho incremental semeia um mês novo com o fechamento do mês anterior — documento da própria série, nunca o resumo — e propaga o delta aos meses posteriores num lançamento retroativo, com teto de 24 meses que falha explicitamente e pede reconstrução em vez de gravar histórico parcialmente corrigido. Nenhuma coleção nova foi criada.

**4. Reconstrução determinística.** O rebuild recalcula todos os fechamentos numa passada, somando os meses em ordem cronológica. Para isso o movimento passou a persistir `currentValueDeltaCents`, seu próprio efeito patrimonial: antes a reconstrução inferia o patrimônio pelo delta da meta, que é zero quando a posição não tem vínculo. Documentos anteriores ao campo caem para `principalDeltaCents`, preservando compatibilidade histórica.

**5. Reconciliação.** `reconciliationDifference` deixou de ser resíduo de subtração e passou a comparar as duas projeções oficiais: o estado atual (`investment_positions` → resumo) contra o fechamento do último mês da série. Divergência indica deriva e pede rebuild.

Períodos gravados antes do campo existir não entram na série e a interface sinaliza que ela precisa de reconstrução, em vez de exibir um histórico incorreto.

##### Evidências do M7 — 2026-08-23

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| Unitários de Functions | 69 testes, 0 falhas (era 67) |
| Unitários de investimentos no frontend | 11 testes, 0 falhas (era 8) |
| Emulator: integração e Rules | **105 testes, 0 falhas, 0 skips** (53 de integração, com 10 novos do M7) |
| Playwright, relatório oficial e gráfico | PASS |
| Prova por reversão dos dois defeitos | Reintroduzidos → 2 falhas; restaurados → 10 de 10 |

Cobertura nova em `m7Reports.integration.test.ts`: janela truncada, múltiplos meses, aporte, resgate, valoração, lançamento retroativo, rebuild repetido, reconciliação com a fonte oficial, recusa do rebuild com valoração e semeadura de período legado. Em `tests/unit/investment-reporting.test.ts`: a evolução não muda quando o patrimônio atual muda, a janela sem meses anteriores não distorce os pontos, e período sem fechamento é omitido e sinalizado.

##### Gates do M7 — 2026-08-23

**`firestore-scale-cost-review`: PASS**, sem achado bloqueante. As duas consultas novas em `investment_report_periods` usam um único campo de desigualdade que é também o único campo de ordenação, servidas pelo índice automático de campo único — **nenhum índice composto precisa ser criado**, e não há `fieldOverrides` que desabilite o índice de `period`. Custo por mutação no caso comum: +2 leituras, +0 escritas. Pior caso retroativo com 24 meses: 25 a 27 leituras e 25 escritas, com o teto abortando antes de gravar. Fan-out máximo por transação ≈ 50 escritas, contra o limite de 500.

**`financial-domain-integrity`: FAIL na primeira passada**, com quatro achados bloqueantes. Todos corrigidos e cobertos por teste:

1. **O rebuild de projeções não varre `investment_valuations`** e ainda assim publicava `currentValueDeltaCents` e `closingCurrentValueCents` absolutos por cima do que a valoração havia acumulado — apagando silenciosamente toda marcação a mercado, e fazendo o resumo (que inclui valoração, via posição) divergir do fechamento do último mês de forma permanente. Reconstruir isso corretamente exige repassar movimentos e valorações em ordem cronológica mantendo quantidade e preço por posição, o que este motor ainda não faz. **Correção aplicada: falha fechado.** O rebuild recusa reconstruir quando existe qualquer valoração no workspace, em vez de corromper. Isso também protege `backfillInvestmentWorkspace`, que delega a esta rotina.
2. **Semeadura confundia "documento existe" com "fechamento já semeado".** Um período gravado antes deste campo existir, ao receber um lançamento novo, perdia a base cumulativa e passava a valer só o delta novo. Agora a decisão é pela presença de `closingCurrentValueCents`, e a semeadura soma o fechamento do mês anterior com o que aquele mês já acumulou.
3. **Série mista não era sinalizada:** o aviso só disparava quando *todos* os períodos careciam de fechamento, então uma janela com parte migrada descartava meses em silêncio. Agora dispara quando qualquer período da janela não tem fechamento.
4. **`currentValueDeltaCents` fora da guarda de deltas zerados** de pendente e cancelado, reduzindo as três barreiras independentes a uma. Incluído no contrato de documento, tratando ausência como zero para os documentos históricos.

Risco residual registrado, não bloqueante: a leitura do documento do mês corrente entra no conjunto de leitura da transação, e transações de leitura-escrita do Admin SDK usam trava pessimista — mutações concorrentes no mesmo mês passam a serializar nessa trava em vez de convergir pelo `FieldValue.increment`. A taxa realista está ordens de magnitude abaixo do limite; o caso a observar é valoração em lote sobre muitos ativos no mesmo mês. Também fica registrado que consultas de intervalo em transação não travam o intervalo: duas transações concorrentes criando meses novos distintos, uma delas retroativa, podem deixar o fechamento posterior defasado — detectável por `reconciliationDifference`.

**Trabalho remanescente, com desenho definido:** repassar movimentos e valorações em fluxo cronológico único, mantendo estado por posição e fotografando o fechamento em cada virada de mês. É o que remove a recusa do item 1 e torna a série mensal integralmente reconstrutível. Pertence ao M8.

## Especificação oficial de grandezas financeiras — 2026-08-23

Definida a partir do código em execução, não de intenção de projeto. Cada fórmula cita a origem. Nada aqui é implementação nova; é o contrato que o domínio já cumpre e contra o qual qualquer mudança futura deve ser verificada.

### Convenções

Dinheiro é **inteiro em centavos**, moeda BRL. Quantidade e preço unitário são **inteiros em micros** (10⁻⁶). Toda soma passa por `addExact`/`negateExact`, que rejeitam resultado fora de `Number.isSafeInteger` (`math.ts:13-27`). O único ponto flutuante admitido em todo o domínio é `transactions.value`, campo de compatibilidade explicitamente não autoritativo, sempre acompanhado de `valueCents` (`operationsV2.ts:409-410`).

### As quatro camadas, e o que cada uma é

A distinção abaixo é normativa. Confundir duas delas é o que produz dupla contagem ou histórico incorreto.

| Camada | Coleção | O que é | O que **não** é |
| --- | --- | --- | --- |
| 1. Fatos | `investment_movements`, `investment_valuations` | Registro append-only do que aconteceu. Fonte reconstruível de tudo mais. | Não é agregado; não é lida para exibir totais. |
| 2. Estado atual | `investment_positions` | Projeção do estado patrimonial **agora**, por conta e ativo. | Não é série temporal; não guarda passado. |
| 3. Série histórica | `investment_report_periods` | Projeção temporal mensal materializada, para relatórios e gráficos históricos. Guarda tanto o fluxo do mês quanto o **valor patrimonial de fechamento** do mês. | Não é checkpoint de execução; não depende da janela consultada. |
| 4. Checkpoint operacional | `investment_snapshots` | Estado de execução do rebuild: cursor, cutoff, cerca de versão, acumuladores parciais. | **Não é fonte de leitura do produto.** Nenhuma tela lê daqui. |

Consequências que valem como regra:

- O fechamento de um período é calculado **a partir das fontes oficiais daquele período**, nunca partindo do patrimônio atual e subtraindo deltas para trás. Essa subtração depende da janela carregada e devolve histórico errado quando períodos anteriores não estão presentes.
- `investment_report_periods` é a **única** série mensal materializada. Não se cria segunda coleção patrimonial para duplicá-la.
- O rebuild recalcula `investment_report_periods` deterministicamente a partir dos fatos, é idempotente e seguro para retry, e não depende de nenhuma janela de frontend.

### Fonte oficial por grandeza

Com `features.investmentsV2.enabled === true`:

| Grandeza | Fonte oficial | Onde é derivada |
| --- | --- | --- |
| Aporte, resgate, ganho, taxas, imposto de um evento | `investment_movements` — ledger append-only | — |
| Preço unitário do ativo | `investment_valuations` | — |
| Principal, valor atual, ganho acumulado por conta+ativo | `investment_positions` | Projeção de `investment_movements` + `investment_valuations` |
| Patrimônio do workspace | `investment_summaries/current` | Projeção de `investment_positions` |
| Série mensal e diária, com fechamento patrimonial | `investment_report_periods` | Projeção de `investment_movements` e `investment_valuations` |
| Corte por dimensão | `investment_allocation_summaries` | Projeção de `investment_positions` |
| Progresso de meta | `goals.investmentProgressCents` | Projeção de `investment_positions` |
| Caixa | `transactions` | Projeção unidirecional de `investment_movements` |

`investment_snapshots` **não é fonte de nada**: é estado de execução de rebuild — cursor, cutoff, cerca de versão e acumuladores parciais. Nenhum consumidor o lê como dado financeiro.

**Fechamento patrimonial do período.** Cada documento de `investment_report_periods` guarda `closingCurrentValueCents`, o valor patrimonial ao fim daquele mês:

```
closing(M) = Σ_{m ≤ M} currentValueDelta(m)
```

Definido apenas sobre a própria série mensal, que por sua vez deriva de movimentos e valorações. O rebuild o recalcula em uma passada, somando os meses em ordem. O caminho incremental o mantém semeando um mês novo com o fechamento do mês anterior — leitura de um documento de período, nunca do resumo atual — e propagando o delta para os meses posteriores quando o lançamento é retroativo.

### Fórmulas

Sejam `P` principal, `Q` quantidade em micros, `G` ganho realizado, `F` taxas, `T` imposto, todos do evento.

**Aporte** (`operationsV2.ts:577-608`)

```
posição:  P += P_evento ;  Q += Q_evento ;  F += F_evento ;  T += T_evento
caixa:    cashDelta = −(P_evento + F_evento + T_evento)
meta:     netContributionDelta = P_evento   (se houver vínculo, senão 0)
```

**Resgate.** Nasce `pending` com **todos os deltas em zero** — não toca posição, meta nem caixa. Na liquidação (`operationsV2.ts:988-1024`), com `P_liq ≤ P_solicitado` e `Q_liq ≤ Q_solicitado`:

```
posição:  P −= P_liq ;  Q −= Q_liq ;  G += G_liq ;  F += F_liq ;  T += T_liq
caixa:    cashDelta = (P_liq + G_liq) − (F_liq + T_liq)   e exige-se > 0
meta:     netContributionDelta = −P_liq
```

O principal resgatado **reduz custo, não vira renda**; o ganho realizado é a única parcela que entra como resultado.

**Principal** é o custo acumulado: soma dos aportes menos o principal resgatado. Nunca é reduzido por valoração.

**Valor atual** (`math.ts:29-51`)

```
currentValue = principal                              , se não há valoração
currentValue = ⌊(Q × preçoUnitárioMicros + D/2) / D⌋  , com D = 10¹⁰
```

`D = (10⁶ × 10⁶)/100` converte o produto micros×micros para centavos. O arredondamento é meia-para-cima em BigInt. Sem valoração o valor atual **é** o principal, por construção — não é estimativa.

**Ganho realizado** acumula apenas `G_liq` de liquidações; nasce zero em aporte.

**Ganho não realizado** (`operationsV2.ts:281`) é sempre derivado, nunca armazenado como fato independente:

```
unrealizedAppreciation = currentValue − principal
```

Segue-se que, sem valoração, ele é identicamente zero — e é por isso que o M3 precisou criar o caminho de escrita de `investment_valuations`.

**Taxas e impostos** acumulam por soma simples e **nunca** são deduzidos de principal ou de ganho na posição; entram separados e só afetam caixa, na fórmula de liquidação acima.

**net_contributions** (`operationsV2.ts:233-262`) é o aporte líquido da meta:

```
netContribution = Σ aportes vinculados − Σ principal resgatado vinculado
```

Guardado em `goals.investmentNetContributionCents`, com invariante `≥ 0` imposta na escrita.

**progressBasis** escolhe qual grandeza vira progresso, sem alterar nenhuma das duas:

```
investmentProgressCents = investmentCurrentValueCents , se progressBasis == 'current_value'
investmentProgressCents = investmentNetContributionCents , caso contrário (default legado)
```

**Reversão** (`reporting.ts:58-80`) não é status: é evento compensatório com `sign = −1` aplicado a todos os deltas monetários e com `reversalOfOperation` gravado no documento, para que a reconstrução saiba qual grandeza inverter sem inferir pelo sinal.

**Série mensal** aplica `sign` a cada componente e classifica por operação efetiva:

```
contributionCents        = sign × P    , se a operação efetiva é aporte
redemptionPrincipalCents = sign × P    , se é resgate
realizedGainCents        = sign × G    , se é resgate
feesCents = sign × F     ;  taxCents = sign × T
costDeltaCents = +sign × P (aporte)  |  −sign × P (resgate)
```

### Prova de ausência de dupla contagem

A garantia não é convenção: é estrutural, e cada camada tem um mecanismo distinto.

**1. `transactions` é escrito, nunca lido, pela V2.** O espelho é unidirecional e o documento tem ID derivado do movimento — `investment_{movementId}` (`operationsV2.ts` cria `projectionId`). Com a flag ligada, o caminho oficial lê exclusivamente as projeções e não soma `transactions`; com a flag desligada, o caminho legado soma `transactions` e não lê projeção alguma. As duas trilhas nunca são somadas juntas porque nenhum consumidor lê as duas.

**2. Só `settled` move projeção.** `pending` e `cancelled` carregam todos os deltas em zero, imposto em três lugares independentes: contrato Zod de documento antes da escrita (`documentContracts.ts`), validador das Rules na leitura (`hasZeroInvestmentMovementDeltas`) e o filtro `status == 'settled'` das varreduras de reconstrução. Um pendente contado como liquidado exigiria os três falharem juntos.

**3. Idempotência impede o mesmo evento entrar duas vezes.** Identidade = workspace × ator × operação × chave do cliente, com `requestHash` do conteúdo como guarda de conflito; o `correlationId` fica de fora justamente para que retry legítimo seja replay. Operações que criam movimento ainda usam ID determinístico do documento como segunda barreira.

**4. Posição é função dos movimentos, e isso é executável.** `recalculateInvestmentPosition` recomputa a posição inteira a partir do ledger paginado e compara com o publicado. Se posição fosse fonte independente, a reconstrução divergiria.

**5. Projeções acumuladas são reconstruíveis com valores absolutos.** O rebuild de projeções republica `investment_summaries`, `investment_report_periods` e `investment_allocation_summaries` com valores absolutos — não incrementos — e **mede a deriva** contra o que estava publicado. Reexecutar é idempotente; um evento contado duas vezes aparece como deriva não nula.

**6. Reversão compensa, não apaga.** O movimento original permanece `settled` com vínculo bidirecional; o compensatório carrega os deltas invertidos. A soma dos dois é zero, e o histórico dos dois fatos é preservado.

**7. Cerca de versão detecta escrita concorrente.** Toda mutação que toca posição incrementa `investment_summaries.projectionVersion`; o rebuild compara essa versão a cada página e aborta se mudou, de modo que uma reconstrução não publica um total que já não corresponde ao ledger.

**8. Snapshot não é somável.** Não há consumidor que leia `investment_snapshots` como valor; ele só alimenta a retomada do próprio rebuild.

### PF/PJ

`profileType` vem do documento do workspace, é derivado no backend por `profileTypeFromWorkspace` e **nunca** aceito do cliente. É carimbado em conta, ativo, movimento, posição, valoração, snapshot, lote, resumo, período e alocação, e revalidado dentro da transação a cada mutação. Conta e ativo cujo `profileType` divirja do workspace são rejeitados na operação.

A finalidade de alocação é o ponto em que a semântica contábil diverge:

- **PF**: `unassigned`, `retirement`, `goal`.
- **PJ**: `unassigned`, `reserve`, `financial_application`, `reinvestment`, `fixed_asset`.

O enum é validado no contrato de documento e nas Rules, com ramificação por perfil. No catálogo, `investment_class` e `investment_strategy` gravam `workspaceScope` igual ao tipo do workspace; os demais grupos usam `both`. O onboarding semeia PF com `unassigned` e PJ com `reserve`.

A finalidade não pode mudar depois de existir posição, para não reescrever relatório histórico — regra afirmada na interface e imposta no backend pela sonda de posição em `executeSaveEntity`.

### Fallback legado

Com `features.investmentsV2.enabled` ausente ou falsa, a fonte oficial é `transactions` com `investmentMetadata`, na semântica do M1/M2:

- Aporte é `type === 'investimento'` com `isPaid === true`; principal vem de `investmentMetadata.principalCents`, com queda para `valueCents` e, por último, para `value` convertido.
- Efeito de caixa vem de `investmentMetadata.cashImpact` (`inflow`/`outflow`/`none`), nunca inferido do tipo.
- Progresso de meta usa `netContributionCents` no documento da meta.
- Movimento pendente não conta; `settled` e `reversed` contam, com o estorno compensando o original.

**A flag é a única chave que troca a fonte. Não existe período de fonte dupla.** Os dois riscos conhecidos desse desenho estão registrados: a flag é lida apenas no frontend, de modo que as duas trilhas de callable seguem invocáveis no mesmo workspace; e workspaces com dados anteriores exigem `backfillInvestmentWorkspace` até `completed: true` antes de habilitar. Ambos pertencem ao M8.

## M8 — hardening, ingestão e IA — plano de 2026-08-23

Levantamento do estado real antes de planejar. Vários itens já existem por inteiro; dois são superfícies novas.

| Item | Estado apurado |
| --- | --- |
| `correlationId` | **Pronto.** Obrigatório nas 21 operações, propagado a movimento, event log, idempotência, carimbos e snapshot. |
| Rebuild idempotente | **Pronto.** Publica valores absolutos, retomável por cursor e cercado por versão. Uma limitação aberta: recusa reconstruir quando há valoração. |
| Drift detection | **Parcial.** O rebuild mede e reporta deriva do resumo contra o ledger. Não há verificação periódica nem alerta operacional. |
| Snapshots mensais | **Parcial.** `closingCurrentValueCents` materializado no M7, mas não reconstrutível quando existem valorações. |
| Auth e RBAC | **Pronto.** Dupla validação, matriz declarativa, 52 testes de Rules. |
| Rate limit | **Não existe.** Nenhuma callable limita frequência por ator ou workspace. |
| Logs sanitizados | **Parcial.** `observability.ts:204` despeja o objeto de erro inteiro no log. |
| IA backend-only | **Não existe.** `src/modules/reports/api.ts:178` e `src/components/TransactionModal.tsx:692,767` instanciam o cliente Gemini **no navegador**, com a chave vinda de `VITE_GOOGLE_AI_KEY`/`process.env.API_KEY`. Variável `VITE_*` é embutida no bundle: a credencial vaza para qualquer visitante. |
| CSV com dry-run, preview, dedupe, checkpoint e resume | **Não existe.** Só há `investment_import_batches` como registro de procedência. |
| Sem full scan recorrente | **Violado.** `functions/src/crons/recurring.ts:13` e `functions/src/crons/creditCardInvoices.ts:319-323` fazem `collectionGroup` sem `limit`, a cada execução, sobre todos os tenants. |

### Decisões

1. **Chave de IA nunca chega ao cliente.** A inferência passa a ser uma callable autenticada, com RBAC e limite de frequência; a chave vive em variável de ambiente do backend. O frontend deixa de importar SDK de IA. Prompt e resposta são tratados como dado do usuário: nada é logado além de identificadores e contagens.
2. **Snapshot mensal reconstrutível de fato.** O rebuild passa a repassar movimentos **e** valorações num único fluxo cronológico, mantendo quantidade e preço por posição, e fotografa o fechamento a cada virada de mês. Isso remove a recusa introduzida no M7 e torna a série integralmente reconstrutível a partir dos fatos.
3. **Limite de frequência por ator e workspace**, materializado em documento com janela deslizante, verificado dentro da mesma transação da operação — não em memória de instância, que não sobrevive a escala horizontal.
4. **Log estruturado e sanitizado**: apenas código de erro, operação, workspace e correlação. Nunca payload, valor monetário, nome de pessoa ou objeto de erro cru.
5. **Cron deixa de varrer tudo.** As duas rotinas passam a paginar com cursor e teto por execução, e a de faturas ganha o índice `COLLECTION_GROUP` que já falta hoje.
6. **CSV é ingestão em duas fases.** `dry-run` valida e devolve prévia sem gravar nada no domínio; a confirmação grava movimentos em páginas, com checkpoint retomável no próprio `investment_import_batches` e deduplicação por chave determinística de linha. Nenhuma coleção nova.
7. **Testes nunca carregam segredo real.** Chave de IA nos testes é sempre valor sintético, e o backend recusa operar sem chave configurada em vez de cair num default.

### Lotes executáveis

**M8.A — IA backend-only.** Callable de inferência com RBAC e limite; remoção do SDK de IA do bundle; chave só no backend; teste de que nenhum artefato do cliente contém a chave.

**M8.B — snapshot mensal reconstrutível.** Fluxo cronológico único de movimentos e valorações no rebuild; remoção da recusa; testes de reconstrução com valoração, múltiplos meses e retomada.

**M8.C — limite de frequência.** Janela deslizante por ator e operação, dentro da transação, com resposta segura em pt-BR e métrica própria.

**M8.D — logs e segredos.** Sanitização dos pontos de log; varredura que falha se um segredo real aparecer em teste ou fixture.

**M8.E — fim do full scan recorrente.** Paginação com cursor e teto nos dois crons; índice `COLLECTION_GROUP` de faturas.

**M8.F — ingestão CSV.** Dry-run com prévia e diagnóstico por linha; confirmação paginada com dedupe determinístico, checkpoint e retomada sobre `investment_import_batches`.

**M8.G — deriva observável.** Rotina de verificação que compara projeções com o ledger e emite métrica e evento quando diverge, sem reconstruir.

### Execução do M8 — 2026-08-23 (parcial)

**M8.A — IA backend-only. Entregue.** O achado era mais grave do que o levantamento inicial sugeria: `vite.config.ts:14-15` injetava `GEMINI_API_KEY` no bundle via `define`, ou seja, **a chave real era compilada no JavaScript servido a todo visitante**, e os três pontos de uso instanciavam o SDK no navegador. Agora existem duas callables autenticadas — `analyzeFinancialQuestion` e `extractTransactionFromContent`, esta última cobrindo tanto o comprovante quanto a transcrição de voz —, ambas com RBAC de owner/admin/member, limite de frequência e payload estrito. O `define` deixou de injetar a chave, nenhum arquivo de `src/` importa SDK de IA, e a chave vive só em `GOOGLE_AI_API_KEY` no backend, cuja ausência é erro explícito e não um default silencioso.

**M8.C — limite de frequência. Entregue.** `functions/src/shared/rateLimit.ts` implementa janela deslizante por ator, workspace e operação, materializada em documento e consumida **dentro da transação**. Contador em memória de instância não limitaria nada: Cloud Functions escala horizontalmente e cada instância teria a própria contagem. O limite é verificado antes de gastar cota externa.

**M8.D — logs e segredos. Entregue.** `observability.ts` deixou de despejar o objeto de erro cru, que pode carregar payload e valor vindos do request, e passou a registrar só o código. Os dois crons passaram a logar apenas contagens. `tests/unit/ai-backend-only.test.ts` falha se o SDK voltar ao cliente, se a chave voltar a ser lida no navegador, se o `define` voltar a injetá-la, se o backend ganhar chave padrão embutida, ou se um segredo em formato real aparecer em qualquer arquivo versionado. Verificado por reversão: reintroduzida a injeção no `vite.config.ts`, o teste falha.

**M8.E — fim do full scan recorrente. Entregue.** `crons/recurring.ts` lia numa única consulta sem `limit` todas as assinaturas ativas de todos os workspaces e acumulava tudo num único lote — que estoura em silêncio a partir de 250 itens vencidos no mesmo dia, no limite de 500 escritas do Firestore. Passou a paginar por cursor, com teto por execução e commits fatiados. `crons/creditCardInvoices.ts` tinha consulta seletiva mas também sem `limit`; passou a paginar, apoiada no índice `COLLECTION_GROUP` que o M4 acrescentou.

##### Evidências do M8 parcial

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| Unitários de Functions | 69 testes, 0 falhas |
| Unitários de frontend | 16 testes, 0 falhas (era 11; +5 da guarda de IA) |
| Emulator | **112 testes, 0 falhas, 0 skips** (60 de integração, com 5 novos de limite) |
| Guarda de IA por reversão | Injeção reintroduzida → falha; restaurada → passa |

#### M8.H — migração do legado para o domínio oficial

Esta é a peça que o plano vinha apontando como pré-requisito da flag e que não existia: `backfillInvestmentWorkspace` só reconstrói projeções sobre movimentos que **já** estão no domínio V2. Nada trazia os aportes e resgates de `transactions` do M1/M2 para `investment_movements`.

**Fonte e classificação.** Entram `transactions` com `type === "investimento"` que sejam efetivas: sem `investmentMetadata`, exige `isPaid !== false`; com metadata, exige `status` `settled` ou `reversed`. Aporte é ausência de metadata ou `investmentOperation === "contribution"`; resgate é `redemption`. Pendente e cancelado não migram — não são fato consumado e não alteraram nada.

**Conta e ativo de destino.** O legado não tem conta nem ativo, então a migração cria, de forma idempotente e com ID determinístico, um par **“Investimentos legados”** por workspace, respeitando PF/PJ. Nada é adivinhado a partir de categoria.

**Nenhuma duplicação de caixa.** Este é o ponto que separa a migração de um aporte normal. O caminho normal grava um espelho em `transactions`; aqui a transação **já existe** e é justamente a origem. A migração portanto **não escreve espelho algum**: cria o movimento com `transactionId` apontando para o documento legado, e o marca com `migratedFromTransactionId`. O caixa continua sendo contado uma única vez, pela transação original.

**Idempotência.** O ID do movimento é derivado do ID da transação de origem, então reexecutar não cria segunda cópia; a segunda passagem detecta o movimento existente e apenas conta como já migrado.

**Checkpoint por workspace.** Cursor, contadores e totais vivem em `investment_snapshots` com `kind: "legacy_migration"` — estado operacional, coerente com a quarta camada. Uma execução interrompida retoma de onde parou.

**Dry-run.** A primeira fase percorre as mesmas páginas, classifica cada linha, acumula os totais que seriam gravados e devolve um diagnóstico com contagens por motivo de exclusão. Não escreve nada no domínio.

**Reconciliação antes e depois.** Antes: soma do legado a partir de `transactions`. Depois: soma do domínio a partir de `investment_positions`. A migração só é declarada conciliada quando principal e ganho batem exatamente, em centavos.

**Flag só depois da reconciliação.** Habilitar `features.investmentsV2.enabled` passa a ser callable de owner que **recusa** ligar enquanto a reconciliação não fechar. O M4 já tornou `features` imutável pelo cliente, então esta é a única via.

**Rollback e reparo sem apagar histórico.** Rollback desliga a flag e marca o lote como revertido; os movimentos criados **permanecem**, marcados, porque apagar histórico financeiro é proibido. Reparo para frente é reexecutar a aplicação, que é idempotente e completa o que faltou.

##### Pendente no M8, com desenho definido

- **M8.B — snapshot mensal reconstrutível.** O rebuild ainda recusa reconstruir quando há valoração, conforme decidido no gate do M7. O desenho é o fluxo cronológico único de movimentos e valorações, mantendo quantidade e preço por posição e fotografando o fechamento a cada virada de mês.
- **M8.F — ingestão CSV** com dry-run, prévia, dedupe determinístico por linha, checkpoint e retomada sobre `investment_import_batches`. Superfície inteiramente nova; nada foi iniciado.
- **M8.G — deriva observável** como rotina própria, que compare projeções com o ledger e emita métrica e evento sem reconstruir. Hoje a deriva só é medida durante um rebuild.

## Correções de revisão independente — 2026-08-24

Revisão da branch contra `origin/main` por revisor que não participou da
implementação. Quatro achados P1 e cinco P2; todos reproduzidos antes da
correção e cobertos por teste de regressão.

### P1 — migração legada descartava o estorno, e a reconciliação aprovava

`classifyLegacyRow` aceitava `status: "reversed"` (migrando o resgate original)
e descartava a transação compensatória `redemption_reversal` como
`skipReason`. Todo o resto do código trata `redemption_reversal` como
`+principal` (`semantics.ts`, `goals/operations.ts`); o classificador da
migração era o único fora do contrato.

O agravante era o gate: `reconcileLegacyMigration` somava o lado legado **com o
mesmo classificador**, comparando o erro consigo mesmo. Reproduzido no
Emulator — aporte de R$ 1.000, resgate de R$ 400 + R$ 50 de ganho, estornado:

```
DOMÍNIO MIGRADO -> principal 60000, ganho 5000   (verdade legada: 100000 e 0)
RECONCILIAÇÃO   -> {"reconciled": true}
```

Ou seja, `enableInvestmentsV2Flag` ligaria a flag sobre patrimônio corrompido.

Correção: `LegacyRowKind` ganha `redemption_reversal`, aplicado como movimento
`operation: "reversal"` com `reversalOfOperation: "redemption"` e todos os
deltas invertidos — principal de volta, ganho, taxa e imposto desfeitos. A
reconciliação passa a **falhar fechada**: qualquer linha que o classificador não
reconheça (`unclassified`) reprova, porque igualdade entre dois lados que usam o
mesmo classificador prova coerência interna, não correção.

### P1 — migração processava por docId e truncava o resgate em silêncio

A varredura ordenava por `FieldPath.documentId()`. IDs do Firestore são
aleatórios, não cronológicos, então um resgate podia ser aplicado antes do
aporte que ele consome; `-Math.min(principal, current.principalCents)` zerava o
delta e gravava um movimento com `principalCents` cheio e `principalDeltaCents`
zero. Reproduzido: posição final de 100.000 em vez de 60.000.

O dano era irreparável: rerun é idempotente por ID e devolve `"existing"`,
apagar histórico financeiro é proibido, e a reconciliação passava a reprovar
para sempre — workspace impedido de migrar, sem saída.

Correção em três partes:

1. Varredura **cronológica** (`orderBy('date')` + ID como desempate), com cursor
   persistido como par `(cursorDate, cursor)` e índice
   `transactions [type, date, __name__]`.
2. Truncamento silencioso substituído por **falha explícita** nomeando a
   transação. A transação do Firestore aborta antes de qualquer escrita e o
   cursor não avança, então a operação é retomável depois da correção do dado.
3. Conferência de cobertura por `count()` ao concluir: o Firestore omite da
   ordenação todo documento sem o campo `date`, e sem essa checagem uma
   transação de investimento sem `date` sairia da migração em silêncio.

O teste que existia passava por acaso — os IDs semeados
(`legacy-contribution-*` < `legacy-redemption-*`) estavam em ordem favorável.

### P1 — flag ligada não fechava a trilha legada de escrita

A flag gateava apenas a **view** `investimento`. O modal global "Nova
Transação" seguia oferecendo a aba, e `transactions/api.ts` roteava sem
consultar a flag. Com V2 ativa, um aporte lançado ali entrava em
`transactions` — contado pelo fluxo de caixa (`calculateCashFlow`) — enquanto
`kpi-investments` era substituído pelas contribuições oficiais e o patrimônio
lia só as projeções. O dinheiro saía do caixa e não aparecia em lugar nenhum.

Isto contradizia a própria prova de ausência de dupla contagem deste plano
("com a flag ligada o caminho oficial não soma `transactions`"): o consumidor de
caixa continuava somando.

Fechado nas três camadas, porque gatear só no frontend deixa a callable
invocável:

- **Callables legadas** — `saveInvestmentRedemption`,
  `cancelInvestmentRedemption`, `reverseInvestmentRedemption` e
  `saveGoalContribution` recusam com `assertLegacyInvestmentTrailOpen`
  (`shared/featureFlags.ts`).
- **Rules** — `create` de `transactions` com `type == 'investimento'` negado
  quando a flag está ligada. O `get()` do workspace só é avaliado para esse
  tipo, por curto-circuito de `&&`.
- **Interface** — a aba some do modal e a ação "aporte" da meta leva à tela de
  Investimentos, para o usuário receber orientação em pt-BR em vez de erro de
  permissão.

### P1 — caminho de falha das callables gravava em workspace alheio

`recordInvestmentCallableFailure` lia `workspaceId` do `request.data` cru e
gravava em `investment_event_logs` e `investment_operational_metrics`. O
`catch` do wrapper roda para toda falha, inclusive `unauthenticated` e
`workspace_role_denied` — logo, qualquer chamador, mesmo sem autenticação,
criava documentos no domínio de outro tenant, um por `correlationId`, sem teto,
com `amountCents` sob controle dele.

Correção: o `workspaceId` passa a vir exclusivamente do contexto **já
autorizado**. Sem autorização, a falha vira log sanitizado e nada é escrito.
O padrão espelhava `creditCards/observability.ts`, que tem a mesma falha e
segue aberto — registrado abaixo como risco.

### P2 aplicados

| Achado | Correção |
| --- | --- |
| Valoração era gravada por conta+ativo mas relida pelo rebuild só por `assetId`, divergindo quando o mesmo ativo está em duas contas | `accountId` passa a integrar o documento, o contrato, as Rules e o índice; o rebuild filtra por conta |
| `crons/recurring.ts` tinha teto de 10.000 assinaturas por execução sem cursor persistido — tudo além disso nunca seria processado, em execução nenhuma | Checkpoint em `job_checkpoints/recurring_expenses`, com retomada entre execuções e `truncated` no log |
| `crons/creditCardInvoices.ts` cortava por teto sem sinalizar | `truncated` no log operacional |
| `test:unit` das Functions virou lista fixa de arquivos: todo teste novo nasceria não executado | Volta a descobrir por `find`, excluindo apenas `*.integration.test.js` |
| `tsconfig.json` deixara de tipar `tests/` | `tests` de volta ao `include` — o que revelou de imediato um `as` escondendo campos obrigatórios ausentes e um `category` fora do enum em `investment-reporting.test.ts` |
| Abas com `role="tab"` sem `aria-controls`, sem `tabpanel` e sem foco itinerante | Padrão ARIA completo nas duas superfícies, com navegação por setas |

### Evidências

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS (conclui neste container; pendência do M6 encerrada) |
| Unitários de Functions | 71 testes, 0 falhas |
| Unitários de frontend | 16 testes, 0 falhas |
| Emulator (integração + Rules) | 127 testes, 0 falhas, 0 skips |
| E2E | 15 testes, 0 falhas |
| Reprodução por reversão | Os quatro P1 falham com o código anterior e passam com o corrigido |

### Rollback

Todas as correções são de código e regra, sem migração de dado. Reverter é
`git revert` do commit; nenhuma coleção nova foi criada além de
`job_checkpoints`, que é estado operacional descartável. O único ponto com
efeito em dado existente é o `accountId` obrigatório na valoração: documentos
de valoração gravados antes desta mudança falham no validador de leitura das
Rules e precisam de recarga — aceitável porque a flag nunca foi habilitada em
produção, mas precisa ser verificado antes de qualquer ambiente que já tenha
valorado posição.


## Riscos abertos

| Risco observado | Impacto | Marco de tratamento |
| --- | --- | --- |
| Valores monetários legados usam `number` e Rules aceitam `int`/`float`. | Precisão e reconciliação podem divergir. | M1/M4 |
| `transactions` e `goals` aceitam writes e deletes diretos do cliente. | Operação crítica sem boundary server-side e perda de histórico. | M2/M3/M4 |
| Trigger de `transactions` incrementa meta e grava log com ID novo por entrega. | Retry pode duplicar efeito e auditoria. | M3/M4 |
| `goalId` depende de vínculo legado; o callback de vínculo não está conectado em `App`. | Metas podem não refletir a intenção do formulário. | M4/M6 |
| Reports e allocations calculam sobre arrays completos no cliente. | Scan, escala, dupla contagem e divergência entre consumidores. | M5/M6 |
| Não há suíte dedicada de Rules ou E2E de investimentos. | Segurança e comportamento não são demonstráveis hoje. | M2/M7 |
| Formatos legados misturam strings de data com `Timestamp` auxiliar. | Corte de período e migração podem ser ambíguos. | M1/M4 |
| PF/PJ compartilham estruturas com semânticas parcialmente inferidas por categoria. | Classificação contábil pode ser incorreta. | M1/M6 |
| `creditCards/observability.ts` grava falha usando `workspaceId` do payload cru, como o de investimentos fazia. | Escrita cross-tenant e criação ilimitada de documentos por chamador não autenticado. | Aberto — mesmo padrão já corrigido no domínio de investimentos |
| Boa parte do domínio (M7/M8, migração legada, IA, rate limit) vive só no working tree, sem commit. | Sem rollback, fora do deploy e perdido em checkout limpo. | Aberto — pendente de commit |

## Critério para iniciar M1

- Baseline do M0 registrado no histórico Git (documento removido no encerramento do domínio único).
- `npm run verify:fast` verde.
- Resultado de `verify:all` registrado sem promover etapas não executadas a sucesso.
- Nenhuma mudança de domínio de investimentos misturada ao commit do M0.

---

# Fase de prontidão de rollout em STAGING

Fase posterior à auditoria final (`PRODUCTION_READINESS_AUDIT_FINAL.md`).
Escopo: fechar pendências de código e preparar o ensaio de rollout, sem tocar
produção. Relatório removido no encerramento do domínio único; ver `INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md`.

## Decisões

1. **A superfície de reconstrução de meta entra no painel existente**, com
   papel declarado por ação em vez de um gate único de proprietário. Migração,
   reversão e habilitação da flag continuam owner-only; as duas reconstruções
   de meta seguem a matriz do backend (`owner` + `admin`). Alternativa
   descartada: manter a tela mais restritiva que a regra, o que deixaria o
   administrador sem caminho executável para a operação que ele pode fazer.
2. **`correlationId` sai do `requestHash` no módulo de metas.** Ele identifica
   a tentativa, não a intenção; dentro do hash, um retry vira
   `idempotency_conflict` em vez de replay. Payloads sem o campo produzem o
   mesmo texto de antes, então nenhum hash já persistido muda.
3. **O agendador de recorrentes passa a ler o esquema que o produto grava** e a
   gerar apenas para `gerarDespesaAutomaticamente: true`. É mudança de
   comportamento — a rotina era um no-op — e está registrada como tal.
4. **`FieldPath` passa a vir de `firebase-admin/firestore`** em todos os
   caminhos paginados.
5. **O lease do backfill ancora no `correlationId`**, não na chave de
   idempotência, porque a chave precisa variar por página.
6. **Os totais das telas de empréstimo viram agregados do servidor.** Paginar a
   listagem sem separar os totais os transformaria em somas parciais.

## Achados desta fase

| ID | Severidade | O que era | Estado |
| -- | ---------- | --------- | ------ |
| STG-01 | P1 | `rebuildGoalProgress` sem nenhum chamador no produto; os dois caminhos que abandonam a soma exata apontavam para ela | FIXED |
| STG-02 | P1 | `admin.firestore.FieldPath` chega `undefined` no runtime do emulador: cinco superfícies paginadas nunca puderam ser exercitadas de ponta a ponta | FIXED |
| STG-03 | P1 | `runPaged` repetia a chave de idempotência por página: a página 2 era replay da 1 e a execução travava até o teto | FIXED |
| STG-04 | P1 | Lease do backfill ancorado na chave de idempotência: a própria execução era recusada na segunda página | FIXED |
| STG-05 | P1 | `processRecurring` consultava `status == "active"` e `nextDueDate`, que o produto nunca grava — agendador financeiro em no-op silencioso | FIXED |
| STG-06 | P1 | A despesa gerada saía com `date` fora do contrato, sem `userId` e sem `workspaceId`: ficava fora da projeção de caixa e não podia ser editada | FIXED |
| STG-07 | P1 | Consulta de grupo de coleção de `recurring_expenses` sem índice: falharia em produção | FIXED |
| STG-08 | P1 | `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS` lidas sem serem declaradas: provisioná-las não as montaria e o checkout falharia fechado | FIXED |
| STG-09 | P2 | Sete callables de metas sem tempo limite, incluindo a que soma até 100.000 aportes | FIXED |
| STG-10 | P2 | Cron de faturas sem recurso declarado: 60 s para paginar 10.000 faturas | FIXED |
| STG-11 | P2 | `split_shares` varrida inteira por cartão de grupo exibido | FIXED |
| STG-12 | P2 | `loans`, `recurring_expenses` e `split_groups` lidos sem `limit` | FIXED |
| STG-13 | P2 | Tela de detalhe de assinatura listava ocorrências de todas as assinaturas | FIXED |
| STG-14 | P2 | Teto de 600 períodos de caixa truncava o saldo em silêncio | FIXED |
| STG-15 | P2 | Janela padrão de transações descartava o sinal de truncamento | FIXED |
| STG-16 | P2 | Backfill de caixa sem simulação nem bloco de reconciliação | FIXED |
| STG-17 | P3 | Cascata de exclusão de empréstimo montava um lote acima do limite de 500 escritas | FIXED |
| STG-18 | P1 | Filtrar rateios por `aPagar` fazia a edição de um título apagar em definitivo o rateio de quem já pagou | FIXED |
| STG-19 | P1 | Cursor de movimentações usava só o ID numa consulta ordenada por `date`: a página seguinte repetia a primeira para sempre | FIXED |
| STG-20 | P1 | Primeira execução real do agendador geraria uma despesa retroativa por dia até alcançar o presente | FIXED |
| STG-21 | P1 | Agendador duplicaria a despesa que a tela de detalhe já gera para a mesma ocorrência | FIXED |
| STG-22 | P2 | `deleteSplitGroup` montava até 601 escritas num lote de 500: grupo grande não podia ser excluído | FIXED |
| STG-23 | P2 | Índice do agregado de empréstimos não incluía o campo somado | FIXED |
| STG-24 | P2 | Categoria da despesa gerada recebia o **ID** do vínculo e apareceria assim no gráfico | FIXED |
| STG-25 | P2 | Sonda de truncamento da projeção de caixa acusava corte com exatamente 600 períodos | FIXED |

## Riscos residuais

| Risco | Impacto | Tratamento |
| ----- | ------- | ---------- |
| Busca e filtros das listagens paginadas cobrem só as páginas carregadas | Um contrato na página 2 não aparece na busca até "Carregar mais" | Inerente à paginação; busca no servidor é trabalho de produto, não de prontidão |
| Contrato de empréstimo sem `status` (anterior ao campo) sai dos totais | Divergência entre listagem e indicadores | `in` e `not-in` omitem documento sem o campo; só varredura o encontraria, que é o que a mudança elimina |
| Não existe projeto de STAGING; o único acessível é produção, e é o padrão do `.firebaserc` | Um `firebase deploy` sem `--project` acerta produção | Criar o projeto antes do primeiro deploy; o script do ensaio recusa produção por construção |
| `processRecurring` deixa de ser no-op | Passa a gerar despesa onde nunca gerou | Só com `gerarDespesaAutomaticamente: true`; validar em staging antes de produção |
| Lease do backfill é por lote, não por workspace | Dois lotes do mesmo workspace podem intercalar | Converge (valor absoluto), custo é trabalho repetido; mensagem em pt-BR é mais ampla que o comportamento |
| Cursor do cron de faturas não é persistido | Execução truncada recomeça do início da janela | Registrado; o cron agora tem 540 s, o que torna o corte improvável |
| `monthsAgoDateOnly` calcula em UTC | Até um dia de diferença na borda da janela padrão | Severidade baixa; nenhum agregado publicado depende dela |
| Fan-out N+1 de consultas por cartão de grupo | N consultas indexadas por renderização | Deixou de ser N varreduras completas; hoistar é refatoração de UI fora deste escopo |

## Rollback

Tudo é revertível por `git revert` dos commits desta fase. Nenhuma coleção
nova, nenhuma migração de dado, nenhum campo removido. O único ponto com efeito
observável em ambiente já implantado é `processRecurring`, que passa a gerar
despesas: reverter o commit devolve o comportamento anterior, e as despesas já
geradas são transações comuns, editáveis e passíveis de baixa lógica pelo
usuário.


---

# Encerramento — Investimentos como domínio único

**Decisão.** A coexistência legado ↔ V2 acabou. Não existe mais
`features.investmentsV2`, migração, reconciliação, rollback de migração nem
trilha legada de escrita. `investment_movements` é a fonte de verdade
patrimonial; `transactions` permanece como domínio de receita, despesa e caixa,
e recebe o espelho unidirecional dos movimentos que movem dinheiro.

**Contexto que autorizou.** Sistema em desenvolvimento, projeto Firebase sem
dados financeiros de clientes, nenhum usuário dependente do fluxo legado e
nenhuma compatibilidade histórica a preservar. Sem base a migrar, a camada de
coexistência deixou de proteger e passou a ser só superfície.

**Progresso.**
- 16 arquivos removidos (4.603 linhas), mais as remoções dentro de arquivos que
  ficaram — cerca de 4.600 linhas de código morto de coexistência no total.
- 10 callables retiradas da superfície implantada: 53 → 43 funções.
- Rules sem leitura de `features`; a negação de escrita direta de investimento
  virou incondicional e economiza um `get()` por escrita.
- 3 índices compostos removidos (50 → 47).
- Aporte em meta migrou para `createInvestmentContribution` com `goalId`; o
  vínculo retroativo por transação saiu junto, porque não era gateado e podia
  carimbar `goalId` num espelho de caixa, contando o aporte duas vezes.
- Diagnóstico de alocação PF/PJ passou a exibir também os cortes por **risco** e
  por **indexador**, que o backend já materializava e nenhuma tela lia.

**Evidências.** `npm run typecheck`, `npm run build`,
`npm --prefix functions run build`, `npm --prefix functions run lint` (0 erros),
`npm --prefix functions run test:unit` (100), `npm run test:unit:investments`
(35), `npm run test:integration:emulator` (174 entre integração e Rules) e
`npm run test:e2e` (26) — todos verdes.

**Defeito corrigido no caminho.** `backfill.ts` → `runToCompletion` decidia o
fim de um rebuild interno por `completed`, mas o recálculo de posição e o de
progresso de meta devolvem `hasMore`. A primeira página concluía o alvo e a
segunda batia em "Esta reconstrução já foi concluída": o backfill falhava em
qualquer workspace que tivesse posição a reconstruir. Nenhuma suíte exercitava
esse caso — todas rodavam o backfill sobre um domínio vazio. Corrigido e coberto
por `pagedRunContract.integration.test.ts`.

**Riscos residuais.** Reentrega do gatilho de transações reaplicando delta em
`cash_report_periods` (pré-existente, reconciliável por `rebuildCashPeriods`);
ausência de lease em `rebuild.ts` e `projectionRebuild.ts` depois da remoção de
`operationLease.ts`; ausência de alias de staging no `.firebaserc`. Detalhe em
`INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` §13.

**Rollback.** Somente de código (`git revert`). Não há rollback de arquitetura:
a trilha legada não volta porque não existe dado que dependa dela. Reverter
reintroduz as 10 callables e a leitura de `features.investmentsV2` nas Rules —
e como nenhum workspace tem esse campo, todo workspace passaria a abrir a tela
legada, que não tem dado nenhum.

**Documento.** `docs/investments/INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md`.

---

## Fechamento dos riscos residuais antes do deployment (INV-P3)

**Decisão.** Fechar os dois riscos bloqueantes que a finalização do domínio
único deixou registrados, sem reintroduzir nenhuma camada de coexistência.
Registro completo em `INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` §§15–19.

**INV-P3-001 — idempotência do gatilho de caixa.** `applyCashPeriodWrite`
somava delta por `FieldValue.increment` sem deduplicar por `event.id`, numa
entrega que é at-least-once: a reentrega mentia no saldo acumulado, em
silêncio. `applyCashPeriodWriteOnce` passa a ler e criar a marca
`cash_period_events/{sha256(event.id)}` **na mesma transação** do incremento.
Escopada por workspace, ID em hash, `expiresAt` de 90 dias, `allow read, write:
if false` nas Rules e na lista de `isBackendOwnedCollection`, acesso por ID sem
consulta nenhuma. `rebuildCashPeriods` permanece reconciliação — e ganhou um
teste que exige que feche nos valores que o caminho deduplicado publicou.

**INV-P3-002 — concorrência de reconstrução.** A prova exigida encontrou um
defeito real. O snapshot de reconstrução era gravado com `{merge: true}`, e
`allocations`/`periods` são mapas de chaves abertas: gravar o mapa vazio de um
estado **reiniciado** não apagava chave nenhuma, a página seguinte relia as
faixas da tentativa anterior e acumulava por cima. O principal por faixa e por
período saía publicado em dobro — com o resumo certo, porque é mapa de chaves
fixas, de modo que a conferência de total fechava e nada acusava. Alcançável
por duas reconstruções concorrentes e, mais fácil, por qualquer aporte feito
durante uma reconstrução. Corrigido com `{merge: false}` e `cursor: null`
explícito. Com isso, `expectedProjectionVersion` + serialização transacional do
Firestore são atomicamente suficientes: **nenhum lease foi introduzido**, e o
motivo está documentado.

**INV-P3-003 — utilitário de limpeza.** `--include-legacy-investment-transactions`
remove também as transações `type: 'investimento'` **sem** marcador do domínio,
sob confirmação própria (`--confirmar-legado`), porque não são reconstruíveis.
`--projeto` explícito, opção desconhecida recusada, classificação impressa por
documento, limpeza de metas paginada.

**Progresso.**
- `functions/src/cash/periods.ts`: `applyCashPeriodWriteOnce`,
  `cashPeriodEventKey`, `cashPeriodEventRef`; `applyCashPeriodWrite` passa a
  devolver os períodos escritos.
- `functions/src/triggers/transactions.ts`: gatilho reescrito sobre o caminho
  deduplicado.
- `functions/src/shared/retention.ts`: `RETENTION_DAYS.cashPeriodEvents = 90`.
- `firestore.rules`: `cash_period_events` server-only nos dois sentidos.
- `functions/src/investments/projectionRebuild.ts`: snapshot sobrescrito, não
  mesclado.
- `functions/src/shared/runtimeOptions.ts`: comentário que ainda citava
  `operationLease.ts` corrigido.
- `tools/investments/limpar-investimentos.mjs`: opção de legado, `--projeto`,
  classificação com motivo, paginação de metas.

**Evidências.** 3 arquivos de teste novos ou ampliados: 4 casos de reentrega em
`cash/__tests__/periods.integration.test.ts`; 4 de concorrência em
`investments/__tests__/rebuildConcurrency.integration.test.ts` (o de reinício
reprova a versão anterior do código e foi executado 4 vezes sem oscilação); 1
de fonte única em `investments/__tests__/goalSingleSource.integration.test.ts`;
1 de Rules em `m4-hardening`. Gates: `typecheck`, `build`, `functions build`,
`functions lint` (0 erros), `functions test:unit` (100),
`test:unit:investments` (35), `test:integration:emulator` (116 integração + 69
Rules) e `test:e2e` (26) — todos verdes, sem skip novo.

**Riscos residuais.** Recursos de runtime de `onTransactionWrite` e
`stripeWebhook` fora do contrato de implantação; ausência de alias de staging;
`investment_snapshots` com `status: rolled_back` antigo; publicação parcial de
uma reconstrução abandonada (retomável, nunca divergente); TTL de
`cash_period_events` depende de ativação no projeto. Detalhe em
`INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` §13.

**Rollback.** Somente de código (`git revert`). Reverter reabre a duplicação
por reentrega do gatilho de caixa e o defeito de reinício da reconstrução;
nenhum dado gravado por esta mudança impede a reversão — `cash_period_events`
fica órfã e expira sozinha.

---

## Preparação operacional do deployment de desenvolvimento

**Decisão.** Nenhuma lógica de negócio, cálculo financeiro ou arquitetura foi
tocada. Só o que faltava para o deployment ser executável. Procedimento
completo, com comandos preenchidos, em
`INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` §20.

**Override de reset no Project ID real.** `sistema-financeiro-pesso-20698` é o
único projeto e ainda é o ambiente de desenvolvimento, mas o utilitário de
limpeza o recusava pelo ID literal. A recusa **permanece**; foi acrescentada
uma porta com quatro fechaduras, todas em argv e nenhuma com valor padrão:
`--projeto` na linha de comando (a variável `PROJETO` não abre),
`--allow-development-reset-on-project` com o mesmo ID, `--workspace`, e
`--apply` + `--confirmar` + `--confirmar-projeto` para escrever. Vale só para
esse ID; qualquer outro é recusado com mensagem própria. Sob override,
`FIRESTORE_EMULATOR_HOST` deixa de ser atenuante. `--include-legacy-...`
continua exigindo `--confirmar-legado`. Banner em destaque quando ativo.
`COLECOES_PROIBIDAS` + `assegurarColecaoPermitida` transformam "nunca apaga
cartão/empréstimo/rateio/transação" em verificação antes da escrita.

**Hosting.** Bloco `hosting` acrescentado a `firebase.json` por edição textual,
preservando `firestore`, `functions` e `emulators` byte a byte — sem
`firebase init`. `public: dist`, rewrite de SPA, `immutable` de um ano em
`/assets/**` (todo asset do Vite tem hash de conteúdo) e `no-cache` em
`/index.html`. Sem `predeploy`, de propósito: as `VITE_FIREBASE_*` decidem o
projeto do bundle, e o build fica sendo passo explícito. `vite.config.ts`,
`src/lib/firebase.ts` e `FUNCTIONS_REGION` intocados.

**Deploy safety.** `.firebaserc` inalterado, sem staging. Os scripts de deploy
passaram a fixar `--project sistema-financeiro-pesso-20698` em vez de confiar
no alias `default`; `deploy:hosting` e `deploy:webhook` foram acrescentados.

**Progresso.**
- `tools/investments/limpar-investimentos.mjs`: override, invariante de
  coleções proibidas, banner.
- `tests/tools/limpar-investimentos.guard.test.mjs` (novo): 15 casos, só
  Emulator, ligado a `test:integration:emulator` e a `test:tools:limpeza`.
- `firebase.json`: bloco `hosting`.
- `package.json`: `--project` explícito, `deploy:hosting`, `deploy:webhook`,
  `test:tools:limpeza`.

**Evidências.** `npm run typecheck`, `npm run build`,
`npm --prefix functions run build`, `npm run test:integration:emulator`
(116 integração + 15 guard + 69 Rules) e `npm run test:e2e` (26) — verdes.

**Riscos residuais.** `dist/` é compartilhado por `build` e `build:e2e`, e
publicar o segundo entrega um aplicativo apontado para `127.0.0.1`;
`deploy:hosting` reconstrói sempre e o §20.7-I traz a conferência. Projeto
único, sem alias de staging: ensaio só no Emulator. `gcloud` não está instalado
no Codespace — o TTL é ativado pelo Console, procedimento no §20.4.

**Rollback.** `git revert` do commit. O bloco `hosting` e o `--project` dos
scripts não deixam estado no projeto Firebase; o override do utilitário some
com o arquivo e a recusa padrão volta a ser incondicional.

**Nada foi implantado, removido ou apagado.**
