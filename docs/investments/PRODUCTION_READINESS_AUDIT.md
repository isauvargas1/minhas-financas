# Auditoria de Prontidão para Produção — Investimentos

Auditoria independente executada em 2026-08-24 sobre o working tree em `HEAD` `c754cfa`
(`main`) mais 52 arquivos modificados e 24 arquivos não rastreados. Conduzida por revisor
que não participou da implementação, contra **código, regras, índices, testes e
comportamento reproduzido**. O [ExecPlan](EXECPLAN.md) foi lido como declaração de intenção
arquitetônica, não como prova de implementação: toda afirmação marcada como concluída lá foi
reconferida no código, e as divergências estão registradas.

Nenhum código de produção, regra, índice, teste ou configuração foi alterado nesta auditoria.
As duas reproduções dinâmicas usaram scripts descartáveis fora do repositório, contra o
Firestore Emulator local. Nenhum acesso a Firebase de produção.

---

## 1. Veredito executivo

**NÃO PRONTO PARA PRODUÇÃO**

O domínio backend de investimentos é sólido no núcleo: representação monetária exata em
centavos e micros, idempotência atômica de verdade, projeções reconstrutíveis com valores
absolutos, Rules que fecham 100% da escrita do cliente nas 14 coleções `investment_*` (as 13 do domínio V2 declaradas em `paths.ts` mais a legada `investment_audit_logs`) e uma
matriz RBAC declarativa revalidada dentro da transação. Isso foi confirmado, não presumido.

O que impede produção não é o núcleo, e sim a borda. Existe **1 achado P0** — uma callable de
cartão grava em workspace alheio a partir de chamador **não autenticado**, no mesmo deploy — e
**13 achados P1**, dos quais dois foram **reproduzidos no Emulator**: a barreira que fecha a
trilha legada sob a flag V2 é contornável por `update` do campo `type`, e o `dry-run` da
migração consome o mesmo checkpoint da execução real, de modo que o procedimento documentado
("simular, depois aplicar") migra **zero** movimentos e ainda assim reporta `completed: true`.

Somam-se a isso lacunas que tornam o marco não operável: não existe superfície nenhuma —
interface, script ou runbook — para migrar, reverter, ligar a flag, reconstruir projeções ou
registrar valoração. A reconstrução, que é o único reparo de deriva, **recusa-se a rodar** em
qualquer workspace que tenha uma valoração. E a idempotência do backend é anulada pelo
frontend, que gera chave nova a cada clique.

---

## 2. Bloqueadores

| ID | Severidade | Área | Problema | Impacto | Evidência |
| -- | ---------- | ---- | -------- | ------- | --------- |
| INV-P0-001 | P0 | Multi-tenant / cartões (mesmo deploy) | `recordCreditCardCallableFailure` lê `workspaceId` do payload cru no `catch` de todas as callables de cartão | Chamador **não autenticado** grava métricas, eventos financeiros e **notificações** em workspace alheio, com `amount`, `errorMessage` e `correlationId` sob controle dele, sem teto de documentos | [creditCards/observability.ts:189](../../functions/src/creditCards/observability.ts#L189), [:215-269](../../functions/src/creditCards/observability.ts#L215-L269), [creditCards/callables.ts:78-92](../../functions/src/creditCards/callables.ts#L78-L92), [callable.ts:53-61](../../functions/src/creditCards/callable.ts#L53-L61) |
| INV-P1-002 | P1 | Segurança / Rules / integridade | `allow update` de `transactions` não chama `isLegacyInvestmentWriteAllowed`, e `type` é chave mutável | Com V2 ligada, o cliente cria `despesa` e atualiza para `investimento`: o dinheiro sai do fluxo de caixa e nunca chega ao patrimônio | **REPRODUZIDO** (§24). [firestore.rules:851](../../firestore.rules#L851) vs [:862-887](../../firestore.rules#L862-L887), [:87](../../firestore.rules#L87) |
| INV-P1-003 | P1 | Migração | `dryRun` compartilha `migrationId` e checkpoint com a execução real, sem guarda de fase concluída | O procedimento documentado migra 0 movimentos e reporta `completed: true`; o workspace fica bloqueado para migrar pelo caminho padrão | **REPRODUZIDO** (§24). [legacyMigration.ts:382-384](../../functions/src/investments/legacyMigration.ts#L382-L384), [:470](../../functions/src/investments/legacyMigration.ts#L470), [:505-521](../../functions/src/investments/legacyMigration.ts#L505-L521), [contracts.ts:189](../../functions/src/investments/contracts.ts#L189) |
| INV-P1-004 | P1 | Idempotência | `investmentRequestIds()` gera `crypto.randomUUID()` a cada chamada | Retry e duplo clique viram operações novas: a idempotência do backend é inalcançável em toda a interface, exceto onboarding | [callableApi.ts:10-13](../../src/modules/investments/persistence/callableApi.ts#L10-L13) |
| INV-P1-005 | P1 | Rebuild / operação | `executeRebuildInvestmentProjections` recusa reconstruir quando existe qualquer valoração | O único reparo de deriva fica indisponível exatamente nos workspaces que marcam a mercado | [projectionRebuild.ts:488-503](../../functions/src/investments/projectionRebuild.ts#L488-L503) |
| INV-P1-006 | P1 | Operação / migração | Nenhuma superfície chama migração, rollback, `enableInvestmentsV2Flag`, rebuild, backfill ou valoração | Nove callables críticas só são invocáveis por teste de integração; não há runbook nem script | `grep` em `src/`, `tools/`, `e2e/` → zero ocorrências |
| INV-P1-007 | P1 | Domínio | Valoração sem caminho de escrita no produto | `currentValue == principal` sempre; ganho não realizado é estruturalmente zero; `progressBasis: 'current_value'` é indistinguível do padrão | [callables.ts:210](../../functions/src/investments/callables.ts#L210) sem consumidor; [math.ts:44-51](../../functions/src/investments/math.ts#L44-L51) |
| INV-P1-008 | P1 | Frontend / PF / PJ | Telas de alocação PF e PJ só montam dentro de `TransactionsView` com `viewType === 'investimento'` | Ligar a flag remove do produto o diagnóstico de alocação PF e o de reserva/reinvestimento PJ | [App.tsx:619-630](../../src/App.tsx#L619-L630), [TransactionsView.tsx:443-456](../../src/components/TransactionsView.tsx#L443-L456) |
| INV-P1-009 | P1 | Integridade financeira | Não existe campo para perda realizada e nenhuma invariante liga quantidade zero a principal zero | Resgate abaixo do custo deixa principal fantasma na posição, somado ao patrimônio e às 8 faixas de alocação, e o rebuild reproduz o mesmo erro | [contracts.ts:25-30](../../functions/src/investments/contracts.ts#L25-L30), [operationsV2.ts:144-160](../../functions/src/investments/operationsV2.ts#L144-L160), [math.ts:44-51](../../functions/src/investments/math.ts#L44-L51) |
| INV-P1-010 | P1 | Migração / dupla contagem | `classifyLegacyRow` não exclui o espelho `investment_{movementId}` escrito pela própria V2 | Workspace com movimentos V2 anteriores à migração tem principal contado duas vezes | [legacyMigration.ts:131-179](../../functions/src/investments/legacyMigration.ts#L131-L179) vs [operationsV2.ts:422-424](../../functions/src/investments/operationsV2.ts#L422-L424) |
| INV-P1-011 | P1 | Escala / custo | `getTransactions` lê a subcoleção inteira, sem filtro, sem `limit`, com ordenação no cliente | Fluxo principal (dashboard, relatórios, metas, alocações) com custo linear no histórico; os espelhos V2 engordam a mesma coleção | [transactions/api.ts:174-182](../../src/modules/transactions/api.ts#L174-L182) |
| INV-P1-012 | P1 | Rollback | Rollback só desliga a flag e marca o lote; não compensa movimentos e não libera o checkpoint | Migração parcial ou incorreta é permanente e não reexecutável pelo `migrationId` padrão | [legacyMigration.ts:838-866](../../functions/src/investments/legacyMigration.ts#L838-L866) |
| INV-P1-013 | P1 | Segurança / billing (mesmo deploy) | `match /users/{userId}` permite `write` irrestrito ao próprio usuário e `usePlan` lê `planId` dali | Qualquer usuário autenticado concede a si mesmo o plano pago pelo console do navegador | [firestore.rules:1221-1226](../../firestore.rules#L1221-L1226), [usePlan.ts:20-27](../../src/hooks/usePlan.ts#L20-L27), [stripe.ts:40-44](../../functions/src/webhooks/stripe.ts#L40-L44) |
| INV-P1-014 | P1 | Operação / rollback | ~8.800 linhas do domínio estão como untracked e 4.194 linhas de diff não commitadas; `origin/main` está 3 commits atrás | Não existe `git revert` para o M7/M8, a migração legada, a IA e o limite de frequência; o rollback descrito no ExecPlan não se aplica e um checkout limpo destrói o domínio | `git status --short` (24 arquivos `??`), `git diff --stat HEAD` (52 arquivos, +4194/-553), [EXECPLAN.md:959](EXECPLAN.md) |

---

## 3. Estado geral por dimensão

| Dimensão | Status | Evidência | Observação |
| -------- | ------ | --------- | ---------- |
| Domínio financeiro | AMARELO | `math.ts`, `documentContracts.ts`, `operationsV2.ts` | Núcleo exato e reconstrutível; perda realizada não é representável (INV-P1-009) |
| Funcionalidades | AMARELO | §6 | Aporte, resgate, liquidação, cancelamento, reversão e vínculo funcionam; valoração, rebuild, migração e alocação não têm superfície |
| Frontend | AMARELO | `InvestmentsPortfolioView.tsx`, `InvestmentRegistrySection.tsx` | Leitura paginada correta, ARIA completo, pt-BR; idempotência anulada e duas telas perdidas com a flag |
| Backend | VERDE | `functions/src/investments/*` | 24 callables tipadas, Zod `.strict()`, transacional, auditável |
| Integrações | VERMELHO | §8 | Alocação PF/PJ perdida, Cadastros sem gate, KPIs de fonte mista |
| Segurança | VERMELHO | INV-P0-001, INV-P1-013 | Escrita cross-tenant não autenticada e escalada de plano no mesmo deploy |
| Multi-tenant | AMARELO | `infrastructure.ts:179-188`, `paths.ts` | Isolamento do domínio de investimentos é sólido; a falha está em cartões |
| RBAC | VERDE | `writeStrategy.ts:62-617` | Matriz declarativa única, revalidada na transação em 20 de 24 operações |
| Integridade | AMARELO | §9 | Sem dupla contagem estrutural entre trilhas; dois vetores condicionais (INV-P1-002, INV-P1-010) |
| Concorrência | AMARELO | `infrastructure.ts:198-238` | Reserva atômica correta; cerca de versão torna rebuild irretomável sob escrita concorrente |
| Idempotência | VERMELHO | INV-P1-004 | Backend correto, cliente gera chave nova a cada clique |
| Firestore | AMARELO | `firestore.rules`, `firestore.indexes.json` | 14 coleções server-only; todas as queries do domínio têm índice; `update` de `transactions` com furo |
| Performance | AMARELO | §11 | Domínio paginado; `transactions`, `goals` e `settings_catalog` sem limite |
| Custo | AMARELO | §11 | ~17 escritas por aporte, 4 documentos singleton por workspace |
| Relatórios | AMARELO | `reports/investments.ts` | Série materializada e determinística; dashboard usa fórmula concorrente |
| Metas | AMARELO | `goals/projection.ts` | Fonte troca corretamente com a flag; textos e lista de movimentações contradizem o número |
| Dashboard | AMARELO | `InvestmentDashboardOverview.tsx` | Patrimônio correto; evolução derivada do resumo vivo |
| PF | VERMELHO | INV-P1-008 | Diagnóstico de alocação inacessível com a flag ligada |
| PJ | VERMELHO | INV-P1-008, §8 | Idem, e sem KPI de investimentos nos relatórios |
| Migração | VERMELHO | INV-P1-003, INV-P1-010 | Dry-run bloqueia a aplicação real; espelho V2 pode duplicar |
| Rollback | VERMELHO | INV-P1-012 | Não compensa e não libera o checkpoint |
| Observabilidade | AMARELO | `investments/observability.ts` | Log sanitizado e auditoria completa; deriva só medida durante rebuild e `positionCount` sempre divergente |
| UX | AMARELO | §17 | pt-BR correto, erros sanitizados; três formulários sem trava de duplo submit |
| Acessibilidade | AMARELO | §17 | ARIA completo nas duas superfícies novas; Relatórios com `role="tab"` incompleto |
| Testes | AMARELO | §18 | 229 casos executados nesta auditoria, 2 falhas não determinísticas; lacunas em migração, valoração e rebuild |
| Operação | VERMELHO | INV-P1-005, INV-P1-006 | Sem superfície para migrar, reverter, ligar a flag ou reconstruir |

---

## 4. Arquitetura atual

O que existe hoje, verificado no código. Duas trilhas mutuamente exclusivas, selecionadas por
`workspaces/{id}.features.investmentsV2.enabled`.

### Trilha oficial (flag ligada)

```text
Frontend
  InvestmentsPortfolioView.tsx / InvestmentRegistrySection.tsx / InvestmentOnboardingCard.tsx
  InvestmentDashboardOverview.tsx / ReportsOverview.tsx / ReportsChartsView.tsx
        │  escrita: 100% httpsCallable (callableApi.ts:15)
        │  leitura: SDK Web direto, paginado (readApi.ts) — Rules exigem limit ≤ 100
        ▼
Cloud Functions — functions/src/investments/callables.ts (24 callables onCall)
  wrapper investmentCallable → requireWorkspaceRole (matriz writeStrategy.ts)
        ▼
operationsV2.ts / operations.ts / rebuild.ts / projectionRebuild.ts / legacyMigration.ts
  tudo dentro de runTransaction; RBAC revalidado; idempotência reservada e completada
        ▼
Firestore — workspaces/{workspaceId}/…
  FATOS (append-only)      investment_movements · investment_valuations
  ESTADO ATUAL             investment_positions → investment_summaries/current
  SÉRIE HISTÓRICA          investment_report_periods (mensal + mapa daily + closing)
  CORTES                   investment_allocation_summaries (8 dimensões)
  CHECKPOINT OPERACIONAL   investment_snapshots (rebuild, backfill, migração)
  AUDITORIA                investment_event_logs · investment_operational_metrics
  IDEMPOTÊNCIA             investment_idempotency_keys (server-only, hash)
  CADASTRO                 investment_accounts · investment_assets · investment_import_batches
        │
        ├─ espelho unidirecional → transactions/investment_{movementId}  (só caixa)
        └─ projeção de meta      → goals.investmentProgressCents
                                    ▼
Consumidores
  patrimônio/relatório  ← investment_summaries + investment_report_periods + allocation_summaries
  gráfico de evolução   ← investment_report_periods.closingCurrentValueCents
  progresso de meta     ← goals.investmentProgressCents
  fluxo de caixa        ← transactions (inclui o espelho)
```

### Trilha legada (flag desligada ou ausente)

```text
TransactionModal → transactions/api.ts → escrita direta no SDK Web (validada por Rules)
                                       → callables legadas para resgate e aporte com meta
transactions (type === 'investimento' + investmentMetadata)
  → triggers/transactions.ts → goals.currentAmountCents / netContributionCents
  → reports/logic.ts (semantics.ts) → KPIs, fluxo de caixa, alocação PF/PJ
```

### Fontes oficiais, projeções e o que muda com a flag

| Grandeza | Flag ligada | Flag desligada |
| --- | --- | --- |
| Fato financeiro | `investment_movements` (append-only) | `transactions` + `investmentMetadata` |
| Preço unitário | `investment_valuations` | não existe |
| Posição por conta+ativo | `investment_positions` | não existe |
| Patrimônio do workspace | `investment_summaries/current` | soma de aportes em `transactions` |
| Série mensal + fechamento | `investment_report_periods` | derivada no cliente a cada carga |
| Corte por dimensão | `investment_allocation_summaries` | `allocations/logic.ts` e `business-allocations/logic.ts` no cliente |
| Progresso de meta | `goals.investmentProgressCents` | `goals.currentAmount` |
| Caixa | `transactions` (espelho) | `transactions` |

**Fontes concorrentes remanescentes** (tratadas como risco até prova de determinismo):

1. `InvestmentDashboardOverview` deriva a evolução de `investment_summaries.currentValueCents`
   subtraindo `currentValueDeltaCents`, em vez de ler `closingCurrentValueCents`
   ([:19-26](../../src/modules/investments/components/InvestmentDashboardOverview.tsx#L19-L26)) — INV-P2-016.
2. `kpi-investments` vem das projeções, mas `kpi-savings` e `kpi-balance` seguem em `transactions`
   ([reports/api.ts:72-82](../../src/modules/reports/api.ts#L72-L82) vs [logic.ts:119-122](../../src/modules/reports/logic.ts#L119-L122)) — INV-P2-024.
3. O card "Investimentos" do dashboard ignora a flag ([App.tsx:580](../../src/App.tsx#L580)) — INV-P2-024.

### Mecanismos

- **Feature flag**: lida no backend por `investmentsV2Enabled(workspace)`
  ([shared/featureFlags.ts:12-17](../../functions/src/shared/featureFlags.ts#L12-L17)), no frontend em 8 pontos,
  e nas Rules por `investmentsV2Enabled(workspaceId)` ([firestore.rules:53-58](../../firestore.rules#L53-L58)).
  `features` é imutável pelo cliente ([firestore.rules:798-803](../../firestore.rules#L798-L803)); a única via de escrita é
  `enableInvestmentsV2Flag`, que exige reconciliação fechada.
- **Rebuild**: `recalculateInvestmentPosition` (posição, a partir do ledger paginado) e
  `rebuildInvestmentProjections` (resumo, períodos e alocações, valores absolutos, cursor,
  `cutoffAt`, cerca de `projectionVersion`, fase `prune`).
- **Migração**: `migrateLegacyInvestments` (dry-run, checkpoint cronológico, resume,
  conferência por `count()`), `reconcileLegacyMigration` (falha fechada),
  `enableInvestmentsV2Flag`, `rollbackLegacyInvestmentMigration`.

---

## 5. Modelo de dados e fontes de verdade

As quatro camadas descritas no ExecPlan existem e são respeitadas pelo código:

| Camada | Coleção | Escrita | Leitura pelo cliente | Reconstrutível |
| --- | --- | --- | --- | --- |
| 1. Fatos | `investment_movements`, `investment_valuations` | server-only | get+list (owner/admin/member), `limit ≤ 100` | — (é a fonte) |
| 2. Estado atual | `investment_positions`, `investment_summaries/current` | server-only | positions get+list; summary só `get` de `current`, `list` negada | SIM — `recalculateInvestmentPosition` recomputa do ledger e compara |
| 3. Série histórica | `investment_report_periods` | server-only | get+list | PARCIAL — `rebuildInvestmentProjections` recusa se houver valoração (INV-P1-005) e não poda períodos órfãos (INV-P2-015) |
| 4. Checkpoint operacional | `investment_snapshots` | server-only | get+list (owner/admin) | n/a — nenhuma tela lê. **CONFIRMADO** por `grep` em `src/` |
| Auditoria legada | `investment_audit_logs` | server-only ([operations.ts:107](../../functions/src/investments/operations.ts#L107)) | get+list (owner/admin) | n/a — trilha append-only das três operações legadas de resgate, declarada em `writeStrategy.ts:563,583,606`. Fora do enum `INVESTMENT_COLLECTIONS` de `paths.ts`, que só cobre o domínio V2 |

**Representação monetária.** Dinheiro é inteiro em centavos (`centsSchema`, `.int().safe()`,
[contracts.ts:25-30](../../functions/src/investments/contracts.ts#L25-L30)); quantidade e preço em micros inteiros.
`positionValueCents` usa BigInt com divisor `10^10` e arredondamento meia-para-cima
([math.ts:29-42](../../functions/src/investments/math.ts#L29-L42)); `addExact`/`negateExact` rejeitam fora de
`Number.isSafeInteger`. **CONFIRMADO: não há aritmética financeira autoritativa em ponto
flutuante.** O único `number` fracionário é `transactions.value`, campo de compatibilidade
sempre acompanhado de `valueCents` ([operationsV2.ts:408-409](../../functions/src/investments/operationsV2.ts#L408-L409)).

**Datas.** Toda chave de período do domínio usa `America/Sao_Paulo` via
[shared/dateKeys.ts](../../functions/src/shared/dateKeys.ts), com offset resolvido pelo próprio formatador (correto sob
horário de verão), coberto por 9 testes unitários. `periodStart` é `Timestamp`.
**Divergência:** o recorte de janela do frontend usa UTC ([reports/investments.ts:6-19](../../src/modules/reports/investments.ts#L6-L19)) —
INV-P2-048.

**Campos server-owned.** `workspaceId`, `profileType`, `createdBy`, `actorId`, `actorRole`,
`domainVersion`, `calculationVersion`, `version`, `projectionVersion`, todos os `*DeltaCents`,
`idempotencyKeyHash`, `settledAt/By`, `cancelledAt/By`, `reversedByMovementId`. Derivados no
servidor, validados por `assertInvestmentDocument` na escrita e por validadores de `get` nas
Rules. **CONFIRMADO: o cliente não forja nenhum deles.**

---

## 6. Inventário funcional completo

### Contas e ativos

| Item | Estado | Evidência |
| --- | --- | --- |
| Criação de conta | FUNCIONAL | `saveInvestmentAccount`; [InvestmentRegistrySection.tsx:154](../../src/modules/investments/components/InvestmentRegistrySection.tsx#L154) |
| Criação de ativo | PARCIAL | `saveInvestmentAsset` aceita só `{name, symbol, assetType, allocationPurpose}` ([contracts.ts:279-303](../../functions/src/investments/contracts.ts#L279-L303)); classe/risco/liquidez/indexador não têm campo — INV-P2-026 |
| Edição | FUNCIONAL | mesma callable, `accountId`/`assetId` opcional |
| Inativação / arquivamento | FUNCIONAL | `archiveInvestmentAccount` / `archiveInvestmentAsset`; histórico preservado |
| Visualização | FUNCIONAL COM RESSALVAS | paginado 20 por página; nomes de posição só resolvem os 20 ativos carregados — INV-P3-050 |
| PF / PJ | FUNCIONAL | `profileType` do workspace, nunca do cliente; enum de finalidade ramificado |
| Histórico | FUNCIONAL | sem hard delete em `functions/src/investments/*` |

### Aportes

| Item | Estado | Evidência |
| --- | --- | --- |
| Criação | FUNCIONAL | `createInvestmentContribution`; [operationsV2.ts:461-751](../../functions/src/investments/operationsV2.ts#L461-L751) |
| Estado pending | NÃO APLICÁVEL | aporte nasce `settled` por contrato |
| Estado settled | FUNCIONAL | deltas aplicados a posição, meta, período, caixa |
| Carteira / origem | FUNCIONAL | `walletId` opcional propagado ao espelho |
| Meta pré-vinculada | FUNCIONAL | `goalId` no payload; `goalNetContributionDeltaCents` |
| Idempotência (backend) | FUNCIONAL | reserva e conclusão na mesma transação |
| Idempotência (retry real) | **QUEBRADO** | chave nova a cada clique — INV-P1-004 |
| Edição | NÃO IMPLEMENTADO | não existe callable de edição de movimento V2 |
| Cancelamento / reversão | FUNCIONAL | `cancelInvestmentMovement` (pendente) e `reverseInvestmentMovement` (liquidado) |

### Resgates

| Item | Estado | Evidência |
| --- | --- | --- |
| Parcial | FUNCIONAL | `settlement.principalCents ≤ movement.principalCents` |
| Total | FUNCIONAL | [domainV2.integration.test.ts:514](../../functions/src/investments/__tests__/domainV2.integration.test.ts#L514) |
| Pending | FUNCIONAL | deltas zero em três camadas independentes |
| Settlement | FUNCIONAL COM RESSALVAS | sem validação de data (INV-P2-022); pedido residual não vira novo pendente (INV-P3-051) |
| Principal separado de ganho | FUNCIONAL | fórmulas em [operationsV2.ts:988-1024](../../functions/src/investments/operationsV2.ts#L988-L1024) |
| **Resgate com prejuízo** | **QUEBRADO** | perda realizada não é representável — INV-P1-009 |
| Taxas / impostos | FUNCIONAL | acumulam separados, só afetam caixa |
| Wallet destino | FUNCIONAL | derivado do aporte de origem |
| Meta | FUNCIONAL | `netContributionDelta = −principal` |
| Reversão | FUNCIONAL | evento compensatório com vínculo bidirecional |
| Idempotência / concorrência | FUNCIONAL no backend | [redemption.integration.test.ts:196](../../functions/src/investments/__tests__/redemption.integration.test.ts#L196) |

### Rendimento e valorização

| Item | Estado | Evidência |
| --- | --- | --- |
| Valuation (backend) | FUNCIONAL | `recordInvestmentValuation`; testes em `m3Lifecycle` e `m7Reports` |
| **Valuation (produto)** | **NÃO IMPLEMENTADO** | nenhuma superfície chama a callable — INV-P1-007 |
| Valorização não realizada | NÃO IMPLEMENTADO na prática | `currentValue == principal` sem valoração ⇒ sempre 0 |
| Rendimento recebido / reinvestido, dividendos, juros | NÃO IMPLEMENTADO | não há operação para isso; só `contribution`, `redemption`, `reversal`, `goal_link/unlink` |
| Efeito em caixa da valoração | FUNCIONAL | `writeStrategy.ts:273` `affectsCashProjection: false`; nenhum espelho escrito |
| Efeito patrimonial | FUNCIONAL | `currentValueDeltaCents` no período e na posição |

### Posições

| Item | Estado | Evidência |
| --- | --- | --- |
| Cálculo e atualização | FUNCIONAL | `applyPositionDeltas` com invariantes de não-negatividade |
| Custo / quantidade / currentValue / realizedGain | FUNCIONAL | ver §9 |
| unrealizedGain | FUNCIONAL (derivado) | `currentValue − principal`, nunca armazenado como fato |
| Rebuild de posição | FUNCIONAL | `recalculateInvestmentPosition`, paginado, compara com o publicado |
| Reconciliação | PARCIAL | posição sim; projeções só durante rebuild, e o rebuild recusa com valoração — INV-P1-005 |
| **Invariante quantidade 0 ⇒ principal 0** | **NÃO IMPLEMENTADO** | INV-P1-009 |

### Metas

| Item | Estado | Evidência |
| --- | --- | --- |
| Novo aporte pré-vinculado | FUNCIONAL | E2E `goal-contributions.spec.ts:115` |
| Vínculo retroativo | FUNCIONAL | `linkInvestmentToGoal` |
| Alterar meta de posição vinculada | QUEBRADO | o formulário só oferece a meta atual e o backend rejeita revínculo — INV-P2-028 |
| Desvínculo | FUNCIONAL | `unlinkInvestmentFromGoal` |
| Resgate reduz progresso | FUNCIONAL | `netContributionDelta = −principal` |
| progressBasis | PARCIAL | backend suporta as duas bases; nenhum formulário expõe — INV-P2-027 |
| Arquivamento | FUNCIONAL | `archiveGoal`, sem delete |
| Rebuild de meta | NÃO IMPLEMENTADO no produto | `recalculateGoalInvestmentProgress` sem consumidor |
| PJ | PARCIAL | `GoalDetailsView` calcula progresso PJ por `calculateBusinessGoalProgress` sobre `transactions`, ignorando `investmentProgressCents` |

### Relatórios

| Item | Estado | Evidência |
| --- | --- | --- |
| Aportes, resgates, principal, ganho realizado, taxas, impostos | FUNCIONAL | `buildInvestmentOverview` sobre `investment_report_periods` |
| Patrimônio e ganho não realizado | FUNCIONAL COM RESSALVAS | do resumo; não realizado é sempre 0 por INV-P1-007 |
| Períodos | FUNCIONAL | limite 99 + sonda n+1 de truncamento |
| Gráfico de evolução | FUNCIONAL | usa `closingCurrentValueCents` materializado; omite meses sem fechamento e sinaliza |
| Snapshots / report periods | FUNCIONAL | ver §13 |
| Consistência ao mudar a janela | FUNCIONAL no relatório | ver §13 |
| Alerta de reconciliação | FUNCIONAL COM RESSALVAS | calculado; a ação que ele pede não existe — INV-P1-006 |

### Dashboard

| Item | Estado | Evidência |
| --- | --- | --- |
| Patrimônio, custo, resultado | FUNCIONAL | `InvestmentDashboardOverview` |
| Evolução | FUNCIONAL COM RESSALVAS | fórmula concorrente — INV-P2-016 |
| Card "Investimentos" | FUNCIONAL COM RESSALVAS | fonte legada, ignora a flag — INV-P2-024 |
| Alertas | PARCIAL | cobre só `periods.length === 0` e truncamento; não mede deriva |
| Feature flag | FUNCIONAL | `App.tsx:582` |

### Configurações > Cadastros

| Item | Estado | Evidência |
| --- | --- | --- |
| Seed PF / PJ | FUNCIONAL | `onboardInvestmentWorkspace`, chave determinística, owner-only, E2E |
| Dedupe | FUNCIONAL | IDs determinísticos; E2E prova ausência de duplicação |
| Contas / ativos / arquivamento | FUNCIONAL | `InvestmentRegistrySection` |
| Classes / risco / liquidez / indexadores | PARCIAL | catálogo semeado e exibido, mas nenhum ativo pode referenciá-lo — INV-P2-026 |
| Respeito à flag | QUEBRADO | seção montada mesmo com a flag desligada — INV-P2-025 |

### Alocação

| Item | Estado | Evidência |
| --- | --- | --- |
| PF: meta, classe, liquidez, sem meta | **QUEBRADO com a flag ligada** | INV-P1-008; no legado, `allocations/logic.ts` só tem os buckets `essenciais/estilo_vida/educacao/aposentadoria/objetivos` |
| PJ: reserva, aplicação, reinvestimento, imobilizado | **QUEBRADO com a flag ligada** | INV-P1-008; no legado, `business-allocations/logic.ts` classifica por `category`, nunca por `allocationPurpose` |
| Backend de alocação | FUNCIONAL | `investment_allocation_summaries` com 8 dimensões, incluindo `purpose` com exatamente esses rótulos |
| Impacto no resultado empresarial | FUNCIONAL COM RESSALVAS | `business-allocations/logic.ts:71` subtrai aportes do resultado como despesa |

### Migração

| Item | Estado | Evidência |
| --- | --- | --- |
| Dry-run | FUNCIONAL, com defeito bloqueante | INV-P1-003 |
| Idempotência | FUNCIONAL | ID do movimento derivado da transação de origem |
| Checkpoint / resume | FUNCIONAL | cursor `(date, __name__)`, ordem cronológica |
| Conferência de cobertura | FUNCIONAL | `count()` agregado detecta transação sem `date` |
| Reconciliação | FUNCIONAL COM RESSALVAS | falha fechada; trunca em 500 páginas sem sinal — INV-P2-021 |
| Feature gate | FUNCIONAL COM RESSALVAS | só checa reconciliação, não o estado da migração — INV-P2-021 |
| Rollback | PARCIAL | não compensa nem libera o checkpoint — INV-P1-012 |
| Compatibilidade legado | FUNCIONAL | migração não escreve espelho; o caixa continua contado uma vez |
| Operação | NÃO IMPLEMENTADO | INV-P1-006 |

### Importação

| Item | Estado | Evidência |
| --- | --- | --- |
| CSV, preview, dry-run, dedupe, retry, erros, rollback | **NÃO IMPLEMENTADO** | M8.F declarado pendente no ExecPlan; `grep -rn "csv" src/` = 0 |
| Procedência | PARCIAL | `registerInvestmentImportBatch` existe e é auditável, sem consumidor |

### IA

| Item | Estado | Evidência |
| --- | --- | --- |
| Backend-only | FUNCIONAL | nenhum SDK em `src/`; `vite.config.ts:18-19` neutraliza o `define`; teste-guarda em `tests/unit/ai-backend-only.test.ts` |
| Autenticação / autorização | FUNCIONAL | `requireWorkspaceRole` owner/admin/member |
| Rate limit | FUNCIONAL | `consumeRateLimit` dentro de transação, antes de gastar cota externa |
| Sanitização | FUNCIONAL | nunca a pergunta, a resposta, o documento ou o erro cru |
| Sem provider | FUNCIONAL | erro explícito em pt-BR, sem default embutido |
| **Configuração de produção** | **QUEBRADO** | `onCall` sem `secrets: ["GOOGLE_AI_API_KEY"]` e sem `functions/.env` — INV-P2-020 |
| Cobertura de comportamento | LACUNA | nenhum teste das duas callables além da guarda de bundle |

---

## 7. Fluxos ponta a ponta

**Aporte**
```text
InvestmentsPortfolioView.tsx:142 "Confirmar aporte"
→ callInvestment('createInvestmentContribution', {…, investmentRequestIds()})   ← chave nova a cada clique (INV-P1-004)
→ investmentCallable → requireWorkspaceRole(owner|admin|member)
→ runTransaction: authorize → reserveIdempotency → get(conta, ativo, posição, meta, período, meses posteriores)
→ create(movement settled) · writePosition · writeAllocationProjections(8) · writeReportPeriod
  · writeCashProjection(transactions/investment_{id}) · metric · eventLog · completeIdempotency
→ ~17 escritas, 4 delas em documentos singleton do workspace (INV-P2-017)
→ trigger onTransactionWrite grava activity_logs com before/after completo (+1 escrita)
Resultado: posição, patrimônio, série mensal, alocações, meta e caixa atualizados atomicamente.
```

**Aporte com meta** — idêntico, mais `goalNetContributionDeltaCents` e a atualização de
`goals.investmentNetContributionCents` / `investmentProgressCents` no mesmo limite atômico.
Invariante `netContribution ≥ 0` imposta na escrita.

**Vínculo retroativo** — `linkInvestmentToGoal` cria movimento `goal_link` com todos os deltas
monetários zero, move a posição inteira entre as faixas da dimensão `goal` nas alocações
(`reporting.ts:485-539`) e soma o principal ao progresso da meta. **Ressalva:** a lista de
movimentações de `GoalDetailsView` continua vinda de `transactions`, e o vínculo retroativo não
gera espelho — a meta mostra progresso positivo com lista vazia (INV-P2-029).

**Resgate** — `createInvestmentRedemption` cria movimento `pending` com **todos os deltas em
zero** (imposto pelo contrato Zod de documento, pelo validador das Rules e pelo filtro
`status == 'settled'` das varreduras). Nada muda em posição, meta ou caixa. Um espelho é
gravado em `transactions` com `isPaid: false` e `cashImpact: 'none'`.

**Settlement** — `settleInvestmentRedemption` valida `principal ≤ solicitado` e
`quantidade ≤ solicitada`, subtrai principal e quantidade, soma ganho, taxas e impostos, exige
`cashDelta > 0`, atualiza meta com `−principal` e reescreve o espelho como liquidado.
**Ressalvas:** sem validação de data (INV-P2-022) e sem representação de prejuízo (INV-P1-009).

**Reversão** — `reverseInvestmentMovement` cria movimento novo `operation: 'reversal'` com
`reversalOfOperation` e todos os deltas invertidos, vínculo bidirecional com o original, que
permanece `settled`. Nenhum documento é apagado.

**Valuation** — `recordInvestmentValuation` grava `investment_valuations` (por conta+ativo),
recalcula `currentValueCents` da posição por BigInt half-up, propaga a variação ao resumo e ao
período. **Não escreve espelho em `transactions`** — valoração não gera caixa. Sem superfície
no produto (INV-P1-007).

**Rebuild** — `recalculateInvestmentPosition` recomputa a posição do ledger paginado e mede
divergência. `rebuildInvestmentProjections` acumula posições e movimentos em fases
(`positions → movements → publish → prune`), publica **valores absolutos**, recalcula
`closingCurrentValueCents` como soma corrida e mede deriva contra o publicado.
**Aborta se existir qualquer valoração** (INV-P1-005) e não poda períodos órfãos (INV-P2-015).

**Relatório**
```text
useFinancialReportSnapshot → getOfficialInvestmentReportData
  1 getDoc  investment_summaries/current
  1 query   investment_report_periods (periodStart desc, limit periodLimit+1)
  8 queries investment_allocation_summaries (dimension ==, currentValueCents desc, limit 11)
→ buildInvestmentOverview: contribuições/resgates/ganho/taxas/imposto por soma dos períodos
  evolução = closingCurrentValueCents materializado
  reconciliationDifference = currentValue − último fechamento (só em range 'all' e sem truncamento)
→ getFinancialReportSnapshot substitui apenas kpi-investments (INV-P2-024)
```

**Migração**
```text
migrateLegacyInvestments {dryRun:true}   → varre, classifica, acumula, GRAVA O CURSOR
migrateLegacyInvestments {dryRun:false}  → retoma do fim do cursor → migra 0 → completed:true
reconcileLegacyMigration                 → legacy 150000 vs domínio 0 → reconciled:false
enableInvestmentsV2Flag                  → recusa (falha fechada)
```
Reproduzido no Emulator (§24). Com `migrationId` explícito distinto o caminho funciona e é
idempotente, cronológico e retomável — mas isso não está documentado em lugar nenhum e não há
superfície que o invoque (INV-P1-006).

---

## 8. Integrações com outros módulos

### 8.1 `transactions` (caixa)
Espelho unidirecional com ID derivado `investment_{movementId}`
([operationsV2.ts:389-459](../../functions/src/investments/operationsV2.ts#L389-L459)). **CONFIRMADO: a V2 escreve e nunca lê
`transactions`.** As Rules impedem o cliente de criar, atualizar ou apagar qualquer documento
com `investmentMetadata` ([firestore.rules:854-891](../../firestore.rules#L854-L891)). O gate que fecha a trilha legada
está no `create` e **não** no `update` — INV-P1-002.

### 8.2 `goals`
`goals` é `write: if false` para o cliente. Com a flag ligada, `mapGoalDocument` troca
`currentAmount` por `investmentProgressCents`. O trigger `onTransactionWrite` não recompõe a
meta quando há `investmentMetadata` (`projectionAlreadyApplied`), evitando dupla contagem —
**CONFIRMADO**. Campos são disjuntos: o trigger escreve `netContributionCents`/`currentAmountCents`,
a V2 escreve `investmentNetContributionCents`/`investmentProgressCents`.
Ressalvas: INV-P2-029 (texto e lista contradizem o número), progresso PJ ignora a V2, e
`rebuildGoalProgress` faz query sem `limit` ([triggers/transactions.ts:33-35](../../functions/src/triggers/transactions.ts#L33-L35)) — INV-P2-030.

### 8.3 Relatórios e dashboard
Ver §4 e §13. Fontes concorrentes remanescentes: INV-P2-016 e INV-P2-024.

### 8.4 Alocações PF e PJ
O backend produz `investment_allocation_summaries` com a dimensão `purpose` e exatamente os
rótulos PF (`unassigned/retirement/goal`) e PJ
(`unassigned/reserve/financial_application/reinvestment/fixed_asset`)
([reporting.ts:331-339](../../functions/src/investments/reporting.ts#L331-L339)). O produto **não consome nada disso**: as telas
de diagnóstico continuam sendo `AllocationAnalysis`/`BusinessAllocationAnalysis` sobre
`transactions`, e elas desaparecem quando a flag é ligada — INV-P1-008.

### 8.5 Configurações > Cadastros e `settings_catalog`
O onboarding semeia 6 grupos novos. `listSettingsCatalog` lê a coleção inteira e filtra no
cliente ([settings-catalog/api.ts:84-99](../../src/modules/settings-catalog/api.ts#L84-L99)), embora exista caminho paginado no
mesmo arquivo — INV-P2-034. A seção não respeita a flag — INV-P2-025.

### 8.6 Cartões de crédito
Não há acoplamento de **dados**: nenhuma coleção é compartilhada e nenhuma leitura cruza os dois
domínios. Há, porém, acoplamento de **código** real: 15 arquivos de `functions/src/investments/`
importam de `../creditCards/` — `CreditCardApplicationError` (math, errors, documentContracts,
infrastructure, operationsV2, operations, reporting, rebuild, projectionRebuild, legacyMigration,
backfill), `requireWorkspaceRole` (callables) e `WorkspaceAuthorizationContext`/`WorkspaceMemberRole`
(onboarding, writeStrategy). Todo erro de domínio de investimentos é construído a partir de uma
classe de cartões, inclusive o de INV-P1-005. Consequência prática: a correção de INV-P0-001 toca
um módulo do qual o domínio de investimentos depende em tempo de compilação, e por isso exige
rodar também a suíte de investimentos, não só a de cartões. Há ainda acoplamento de **deploy e de
padrão**: `creditCards/observability.ts` mantém a falha cross-tenant que o domínio de
investimentos já corrigiu — INV-P0-001 — e o log com objeto de erro cru — INV-P2-036.

### 8.7 IA
`functions/src/ai/callables.ts` só recebe agregados já calculados no cliente; não lê Firestore
financeiro. Ver §6.

### 8.8 Crons
Nenhum cron toca investimentos (`grep -rn "investment" functions/src/crons/*.ts` = 0). Não
existe rotina de deriva agendada — INV-P2-019.

### 8.9 Billing / planos
Sem acoplamento com investimentos, mas no mesmo deploy: INV-P1-013 e INV-P2-037.

---

## 9. Integridade financeira

### 9.1 Semântica — provas

| Afirmação | Estado | Prova |
| --- | --- | --- |
| Aporte não é despesa de consumo | **CONFIRMADO** | `transactionCashImpactCents` trata `investimento` por `investmentMetadata.cashImpact`, nunca por tipo ([semantics.ts:25-41](../../src/modules/investments/semantics.ts#L25-L41)); `kpi-expenses` filtra só `despesa`/`parcelado` |
| Principal resgatado não é receita | **CONFIRMADO** | `redemptionPrincipalCents` é campo próprio do período; `realizedGainCents` é a única parcela de resultado ([reporting.ts:78-88](../../functions/src/investments/reporting.ts#L78-L88)); teste `m7Reports:153` |
| Rendimento separado de principal | **CONFIRMADO** | `principalCents` e `gainCents` são campos distintos do movimento e da posição |
| Caixa separado de patrimônio | **CONFIRMADO** | `cashDeltaCents` só existe no espelho e no período; patrimônio vem de `investment_positions` |
| Ganho realizado separado do não realizado | **CONFIRMADO** | realizado acumula só em liquidação; não realizado é derivado `currentValue − principal`, nunca armazenado como fato |
| Valoração não cria fluxo de caixa | **CONFIRMADO** | [writeStrategy.ts:273](../../functions/src/investments/writeStrategy.ts#L273) `affectsCashProjection: false` no plano de `recordInvestmentValuation`; nenhum `writeCashProjection` no caminho |
| Reversão não apaga histórico | **CONFIRMADO** | movimento compensatório com vínculo bidirecional; nenhum `.delete()` em `functions/src/investments/*` |
| **Perda realizada é representável** | **NÃO IMPLEMENTADO** | INV-P1-009 |
| **Hard delete de histórico proibido** | **FALHOU fora do domínio V2** | [transactions/api.ts:317-318](../../src/modules/transactions/api.ts#L317-L318) apaga transações não-resgate — INV-P2-032 |

### 9.2 Reconstrução por grandeza

| Total | Fonte oficial | Fórmula | Filtro de status | Regra temporal | Sinal | Moeda | Arredondamento |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Principal da posição | `investment_movements` | Σ aportes − Σ principal liquidado | `settled` | `settlementAt ?? occurredAt` | aporte +, resgate − | BRL centavos | inteiro exato |
| Valor atual | posição + `investment_valuations` | `⌊(Q×preço + D/2)/D⌋`, D=10¹⁰; sem valoração = principal | `settled` | valoração mais recente por conta+ativo | — | BRL centavos | half-up BigInt |
| Ganho realizado | `investment_movements` | Σ `gainCents` de liquidações | `settled` | idem | reversão inverte | BRL centavos | exato |
| Ganho não realizado | derivado | `currentValue − principal` | — | — | pode ser negativo | BRL centavos | — |
| Patrimônio do workspace | `investment_positions` | Σ `currentValueCents` | `status == 'active'` | — | — | BRL centavos | exato |
| Série mensal | movimentos + valorações | `movementReportDeltas`, `sign = −1` em reversão | `settled` | chave `YYYY-MM` em `America/Sao_Paulo` | por operação efetiva | BRL centavos | exato |
| Fechamento do mês | `investment_report_periods` | `closing(M) = Σ_{m≤M} currentValueDelta(m)` | — | ordem cronológica | — | BRL centavos | exato |
| Progresso de meta | `investment_positions` | `net_contributions` ou `current_value` | `settled` | — | resgate reduz | BRL centavos | exato |
| Caixa | `transactions` | `cashImpact` explícito | `settled`/`reversed` | `date` (BRT) | inflow +, outflow − | BRL | `valueCents` |

**`movements → positions`: RECONSTRUTÍVEL — CONFIRMADO.** `recalculateInvestmentPosition`
recomputa do ledger paginado e compara com o publicado
([domainV2.integration.test.ts:649](../../functions/src/investments/__tests__/domainV2.integration.test.ts#L649)).

**`movements + valuations → report periods`: RECONSTRUTÍVEL APENAS SEM VALORAÇÃO — FALHOU
no caso geral.** `executeRebuildInvestmentProjections` recusa quando existe qualquer valoração,
por não repassar valorações no fluxo cronológico ([projectionRebuild.ts:488-503](../../functions/src/investments/projectionRebuild.ts#L488-L503)). Esta é a
lacuna M8.B, declarada pendente no ExecPlan e **confirmada aqui**. Sem valoração, a reconstrução
é determinística, idempotente e testada (`m7Reports:360`).

**`report periods → gráficos`: NÃO DEPENDE DA JANELA — CONFIRMADO.** Ver §13.

### 9.3 Dupla contagem — varredura dirigida

| Par | Resultado |
| --- | --- |
| transaction × movement | **SEM DUPLA CONTAGEM.** Espelho unidirecional, ID derivado, nenhum consumidor soma as duas trilhas. A flag é a única chave de fonte. |
| aporte × despesa | **SEM DUPLA CONTAGEM.** `kpi-expenses` não inclui `investimento`. |
| resgate × receita | **SEM DUPLA CONTAGEM.** `kpi-income` só soma `receita`; principal entra em campo próprio. |
| rendimento × valuation | **SEM DUPLA CONTAGEM.** Realizado só em liquidação, não realizado só derivado. |
| position × report | **SEM DUPLA CONTAGEM**, e há reconciliação explícita (`reconciliationDifference`). |
| meta × movimento | **SEM DUPLA CONTAGEM.** Trigger e V2 escrevem campos disjuntos; o trigger se abstém quando há `investmentMetadata`. |
| importação × lançamento manual | **NÃO APLICÁVEL** — importação não existe. |
| legado × V2 (migração) | **RISCO CONFIRMADO.** `classifyLegacyRow` não exclui o espelho V2 — INV-P1-010. |
| legado × V2 (escrita direta) | **RISCO REPRODUZIDO.** Update de `type` cria transação de investimento com a flag ligada — INV-P1-002. Não duplica patrimônio: subtrai do caixa e não aparece em lugar nenhum. |

---

## 10. Segurança e isolamento

### 10.1 Matriz RBAC — domínio de investimentos
Fonte única: `INVESTMENT_BACKEND_WRITE_PLANS` ([writeStrategy.ts:62-617](../../functions/src/investments/writeStrategy.ts#L62-L617)), lida pelo
wrapper e revalidada dentro da transação.

| Operação | owner | admin | member | viewer | Revalida na transação |
| --- | :-: | :-: | :-: | :-: | --- |
| `onboardInvestmentWorkspace` | ✔ | ✖ | ✖ | ✖ | sim |
| `enableInvestmentsV2Flag` | ✔ | ✖ | ✖ | ✖ | sim |
| `migrateLegacyInvestments` | ✔ | ✖ | ✖ | ✖ | sim |
| `rollbackLegacyInvestmentMigration` | ✔ | ✖ | ✖ | ✖ | sim |
| `saveInvestmentAccount` / `saveInvestmentAsset` | ✔ | ✔ | ✖ | ✖ | sim |
| `archiveInvestmentAccount` / `archiveInvestmentAsset` | ✔ | ✔ | ✖ | ✖ | sim |
| `reverseInvestmentMovement` | ✔ | ✔ | ✖ | ✖ | sim |
| `recordInvestmentValuation` | ✔ | ✔ | ✖ | ✖ | sim |
| `recalculateInvestmentPosition` / `recalculateGoalInvestmentProgress` | ✔ | ✔ | ✖ | ✖ | sim |
| `rebuildInvestmentProjections` | ✔ | ✔ | ✖ | ✖ | sim |
| `registerInvestmentImportBatch` | ✔ | ✔ | ✖ | ✖ | sim |
| `backfillInvestmentWorkspace` | ✔ | ✔ | ✖ | ✖ | **não** |
| `createInvestmentContribution` | ✔ | ✔ | ✔ | ✖ | sim |
| `createInvestmentRedemption` / `settleInvestmentRedemption` | ✔ | ✔ | ✔ | ✖ | sim |
| `cancelInvestmentMovement` | ✔ | ✔ | ✔ | ✖ | sim |
| `linkInvestmentToGoal` / `unlinkInvestmentFromGoal` | ✔ | ✔ | ✔ | ✖ | sim |
| `saveInvestmentRedemption` / `cancelInvestmentRedemption` (legado) | ✔ | ✔ | ✔ | ✖ | **não** |
| `reverseInvestmentRedemption` (legado) | ✔ | ✔ | ✖ | ✖ | **não** |

`viewer` não aparece em nenhum plano e é excluído da leitura do domínio pelas Rules
(`canReadInvestmentDomain`), testado em `m4-hardening:490`. **Nenhuma escalada de privilégio
foi encontrada nas callables de investimento.** As 4 operações sem revalidação transacional
estão declaradas como tal na própria matriz (`revalidatesRoleInTransaction: false`) — janela
TOCTOU estreita entre o gate do wrapper e o commit: INV-P3-052.

### 10.2 Cross-tenant

| Verificação | Resultado |
| --- | --- |
| Workspace A não lê B | **CONFIRMADO** — testado nos dois sentidos em 11 das 14 coleções `investment_*` (`m4-hardening:201,:226,:243`, `investment-domain:455,:583`, `investment-m3:280`) |
| Workspace A não altera B | **CONFIRMADO no domínio de investimentos** (`write: if false` em todas as 14 coleções) · **FALHOU no domínio de cartões** — INV-P0-001 |
| Member não escala privilégio | **CONFIRMADO** — `firestore.rules:823-825`, teste `m4-hardening:318`; papel sempre lido do servidor |
| Cliente não altera campos server-owned | **CONFIRMADO** — `hasOnlyClientTransactionKeys` e `changesOnlyMutableTransactionKeys` |
| Cliente não grava projeções protegidas | **CONFIRMADO** — nenhum `setDoc`/`updateDoc`/`deleteDoc` em `src/modules/investments/persistence/*` |
| Cliente não forja `workspaceId` | **CONFIRMADO** — todo path vem de `auth.workspaceId`; `reserveInvestmentIdempotency` rejeita divergência ([infrastructure.ts:179-188](../../functions/src/investments/infrastructure.ts#L179-L188)) |
| Cliente não forja `createdBy` / `actorId` / `profileType` | **CONFIRMADO** — derivados do contexto autorizado e do documento do workspace |

### 10.3 Outros vetores auditados

| Vetor | Resultado |
| --- | --- |
| IDOR | Não encontrado no domínio de investimentos |
| Replay | Bloqueado: identidade `${operation}_${sha256(uid:idempotencyKey).slice(0,32)}` + `requestHash`; `transaction.create` traduzido de `ALREADY_EXISTS`. O prefixo de operação impede colisão entre callables distintas com a mesma chave de cliente; a truncagem em 128 bits é a margem contra colisão de hash |
| Mass assignment | Bloqueado em `transactions`, `settings_catalog`, `credit_cards`; **ausente** em `workspaces`, `members` e nas coleções sem validação — INV-P3-053 |
| Bypass por callable | Nenhuma callable exportada sem `request.auth`. Duas com autorização insuficiente fora do escopo: INV-P2-037 e INV-P2-038 |
| Escrita direta Firestore | Só em `transactions` (por desenho, validada) — com o furo INV-P1-002 |
| Wildcard recursivo em Rules | **Não existe.** O único catch-all é `match /{subCollection}/{docId}`, com `write: if false` e leitura negada por prefixo `investment_|credit_card_|goal_` |
| Exposição de segredos | **Nenhum segredo real versionado** (varredura de código e de histórico Git). `.gitignore` não cobre `.env`/`.env.production` — INV-P3-054 |
| Dados financeiros em log | **Nenhum** em Cloud Logging no domínio de investimentos e de IA. Em cartões: objeto de erro cru — INV-P2-036 |
| Chave de idempotência exposta | `investment_idempotency_keys` é inacessível, mas a chave **crua** é copiada para `investment_operational_metrics` e `investment_event_logs`, legíveis por owner/admin — INV-P2-039 |

---

## 11. Escalabilidade, performance e custo

Avaliação para milhares de workspaces, anos de histórico e tenants PJ com centenas de milhares
de movimentos.

### 11.1 Leituras

| Origem | Coleção | Filtros | Limite | Índice | Reads estimados | Classificação |
| --- | --- | --- | --- | --- | --- | --- |
| [transactions/api.ts:177](../../src/modules/transactions/api.ts#L177) | `transactions` | **nenhum** | **nenhum** | — | O(histórico do workspace), a cada carga | **BLOQUEADOR** (INV-P1-011) |
| [settings-catalog/api.ts:89](../../src/modules/settings-catalog/api.ts#L89) | `settings_catalog` | nenhum | nenhum | — | O(catálogo), cresce com o seed de investimentos | ATENÇÃO (INV-P2-034) |
| [goals/api.ts:35-38](../../src/modules/goals/api.ts#L35-L38) | `goals` | nenhum, sem `orderBy` | 100 | — | ≤100, com perda silenciosa | ATENÇÃO (INV-P2-033) |
| [notifications/api.ts:24](../../src/modules/notifications/api.ts#L24) | `notifications` | `orderBy createdAt desc` | **nenhum** | — | O(notificações) | ATENÇÃO |
| [readApi.ts:57-64](../../src/modules/investments/persistence/readApi.ts#L57-L64) | `investment_accounts` / `assets` | `status`, `updatedAt desc` | 20 | ✔ | 20 | ACEITÁVEL |
| [readApi.ts:84-89](../../src/modules/investments/persistence/readApi.ts#L84-L89) | `investment_positions` | `status` (+`accountId`) | 20 | ✔ | 20 | ACEITÁVEL |
| [readApi.ts:97-103](../../src/modules/investments/persistence/readApi.ts#L97-L103) | `investment_movements` | `status`/`operation` | 20 | ✔ (3 combinações) | 20 | ACEITÁVEL |
| [readApi.ts:139-148](../../src/modules/investments/persistence/readApi.ts#L139-L148) | `investment_report_periods` | `periodStart desc` | ≤100 | ✔ | ≤100 | ACEITÁVEL |
| [readApi.ts:149-155](../../src/modules/investments/persistence/readApi.ts#L149-L155) | `investment_allocation_summaries` | `dimension`, `currentValueCents desc` | 11 | ✔ | **8 queries × 11** por carga, 3 delas garantidamente vazias | ATENÇÃO (INV-P2-026) |
| [triggers/transactions.ts:33-35](../../functions/src/triggers/transactions.ts#L33-L35) | `transactions` | `goalId ==` | **nenhum** | — | O(transações da meta) **dentro de transação**, por escrita | ATENÇÃO (INV-P2-030) |
| [goals/operations.ts:204-209](../../functions/src/goals/operations.ts#L204-L209) | `transactions` | `goalId ==` | 2001 | — | ≤2001 por escrita de meta | ATENÇÃO |
| [crons/recurring.ts:61-64](../../functions/src/crons/recurring.ts#L61-L64) | CG `recurring_expenses` | `status ==` | página + cursor | índice automático de campo único | paginado | ACEITÁVEL |
| [crons/creditCardInvoices.ts:336-341](../../functions/src/crons/creditCardInvoices.ts#L336-L341) | CG `credit_card_invoices` | `status in`, `dueDate <=` | página + cursor | ✔ CG declarado | paginado | ACEITÁVEL |

**Carga do dashboard:** 12 leituras do domínio patrimonial (2 de `InvestmentDashboardOverview`,
com `includeAllocations: false`, e 10 do `ReportsWidget`, com o snapshot completo), das quais 8
são dimensões de alocação que o widget nunca exibe, porque as duas superfícies disparam cargas
independentes — INV-P2-035. Somam-se as 4 queries do domínio de cartões.

**Custo das Rules:** um `create` de `transactions` com `type == 'investimento'` custa
1 leitura adicional (documento do workspace). O curto-circuito que poupa o `get()` para os
demais tipos é o **`||` dentro de `isLegacyInvestmentWriteAllowed`**
(`data.type != 'investimento' || !investmentsV2Enabled(workspaceId)`,
[firestore.rules:60-62](../../firestore.rules#L60-L62)) — não o `&&` da cláusula `allow create`, que alcança o
predicado em toda escrita aceita. O comentário do próprio arquivo em `:51-52` atribui o efeito
ao `&&`; a atribuição está errada, o efeito não. Receita, despesa e parcelado pagam 0 leituras
adicionais. O limite de **10 acessos a documento** por requisição não é ameaçado (no máximo 2
documentos distintos), mas o limite de **1.000 avaliações de expressão** é — ver INV-P2-049.

### 11.2 Escritas

| Operação | Escritas por transação | Documentos singleton do workspace tocados |
| --- | --- | --- |
| Aporte | 16 mínimo · 17-18 típico · até 43 com 24 meses retroativos (+1 assíncrona de `activity_logs`) | `investment_summaries/current`, `investment_report_periods/{mês}`, `investment_operational_metrics/{dia_op}`, alocações `account` e `class` |
| Resgate pendente | 5 | métrica |
| Liquidação | 16-17, até 41 | idem aporte |
| Valoração | 14-16, até 40 | idem |
| Reversão | 16-17, até 41 | idem |
| Onboarding | 47 | — |
| Rebuild, fase publish | até 104 por página | resumo |

**Contenção — ATENÇÃO com potencial de BLOQUEADOR em tenant PJ.** O Firestore sustenta
~1 escrita/s por documento. Como toda mutação escreve o resumo, o período do mês corrente e a
métrica do dia na **mesma transação**, o teto prático do domínio é da ordem de **1 operação por
segundo por workspace**. Isso é irrelevante para PF e para a migração de workspaces pequenos;
torna-se limitante em importação em lote (não implementada), migração de tenant grande e uso
concorrente por vários usuários — INV-P2-017.

**Cerca de versão.** `projectionVersion` é incrementado por toda mutação que toca posição, e o
rebuild aborta se a versão mudou ([projectionRebuild.ts:473-478](../../functions/src/investments/projectionRebuild.ts#L473-L478)). Em workspace ativo o rebuild
pode nunca concluir, e não há caminho de reset do snapshot: exige novo `rebuildId` —
INV-P2-018.

### 11.3 Documentos que crescem sem limite

| Documento | Crescimento | Mitigação |
| --- | --- | --- |
| `investment_snapshots/{rebuildId}` | acumulador inteiro (alocações por ativo/conta + períodos com mapa `daily`), reescrito por página | **nenhuma** — teto de meses conta meses, não buckets diários — INV-P2-040 |
| `investment_report_periods/{mês}.daily` | ≤31 dias × 9 campos | limitado por construção |
| `investment_idempotency_keys` | 1 doc por operação, para sempre | **nenhum TTL declarado** — INV-P2-041 |
| `investment_event_logs`, `investment_operational_metrics` | 1 doc por operação / por dia+operação | nenhum TTL |
| `activity_logs` | 1 doc por escrita em `transactions`, com `before`/`after` completos | nenhum TTL |
| `investment_audit_logs` | 1 doc por operação legada de resgate | nenhum TTL |

### 11.4 Índices

36 índices declarados, 0 `fieldOverrides`. **Todas as queries compostas do domínio de
investimentos têm índice correspondente — CONFIRMADO.** Os 15 índices relevantes: `investment_accounts` ×1,
`investment_assets` ×1, `investment_positions` ×4 (`status+updatedAt`, `accountId+status+updatedAt`,
`goalId+updatedAt`, `assetId+status`), `investment_movements` ×4 (`status+occurredAt`,
`operation+occurredAt`, `status+operation+occurredAt`, `accountId+assetId+status+occurredAt`),
`investment_valuations` ×1, `investment_report_periods` ×1, `investment_allocation_summaries` ×1 e
`transactions` ×2. Um índice órfão: `transactions [userId, date, __name__]`, sem consulta
correspondente em `src/` ou `functions/src/` — INV-P3-055.

### 11.5 Região

Nenhuma função declara região (`grep -rn "setGlobalOptions\|region:" functions/src` = 0),
enquanto o Firestore está em `southamerica-east1` ([firebase.json:4](../../firebase.json)). Callables v2 sem região
são implantadas em `us-central1`: cada uma das ~10 leituras e ~17 escritas de um aporte
atravessa o continente **dentro** da janela de trava pessimista descrita acima — INV-P2-042.

---

## 12. Concorrência e idempotência

Para cada operação crítica de investimento:

```text
Qual é a idempotency key?        id do documento = `${operation}_${sha256(`${auth.uid}:${key}`).slice(0,32)}`
                                 (infrastructure.ts:189-191) — escopo por operação, ator e chave do
                                 cliente, com truncamento em 128 bits
Onde é persistida?               workspaces/{ws}/investment_idempotency_keys/{id}, server-only
Verificação e escrita atômicas?  SIM — transaction.get na reserva e transaction.create na conclusão,
                                 na MESMA transação Firestore (infrastructure.ts:198, :238)
Retry devolve o mesmo resultado? SIM — replay retorna o resultado persistido; requestHash (sem
                                 correlationId) distingue retry legítimo de conflito
Existe janela TOCTOU?            NÃO na idempotência. SIM, estreita, na revalidação de papel das
                                 4 operações com revalidatesRoleInTransaction: false
Risco de saldo/posição negativa? NÃO — applyPositionDeltas rejeita qualquer componente negativa
                                 (operationsV2.ts:161-172); netContribution ≥ 0 imposto na escrita
```

| Cenário | Resultado |
| --- | --- |
| Duplo clique | **QUEBRADO** — chave nova por clique (INV-P1-004); três formulários ainda sem `disabled` (INV-P2-028) |
| Retry de callable | **QUEBRADO** pelo mesmo motivo; o backend estaria correto |
| Retry de trigger Firestore | **CONFIRMADO** — `activity_logs` usa ID determinístico derivado de `event.id`; o rebuild de meta é recomputação total, não incremento |
| Duas abas / dois usuários | **CONFIRMADO** — transações com trava pessimista; ordem de leitura antes de escrita respeitada em todas as operações auditadas |
| Resgate concorrente | **CONFIRMADO** — `redemption.integration.test.ts:196`, `domainV2.integration.test.ts:514` |
| Aporte concorrente | **CONFIRMADO** — mesma reserva atômica |
| Reversão concorrente | **CONFIRMADO** — `reversedByMovementId` no original impede segunda reversão |
| Rebuild concorrente | **PARCIAL** — cerca de versão aborta, mas sem reset: INV-P2-018 |
| Importação concorrente | **NÃO APLICÁVEL** |
| Vínculo/desvínculo concorrente | **CONFIRMADO** — `if (link && current.goalId) throw` |
| Settlement repetido | **CONFIRMADO** — só um movimento `pending` pode ser liquidado |
| Migração concorrente | **PARCIAL** — sem lease, ao contrário do backfill (`backfill.ts:149-175`): duas execuções simultâneas inflam os totais — INV-P2-043 |
| Suíte de integração sob concorrência | **FALHOU de forma não determinística** — `3 INVALID_ARGUMENT: Transaction is invalid or closed` em `goalIntegrity`, 1 falha em 73; 3/3 aprovado isolado — INV-P2-044 |

---

## 13. Relatórios e séries temporais

**Qual coleção serve o gráfico:** `investment_report_periods`, lida por
`getOfficialInvestmentReportData` e mapeada em `buildInvestmentOverview`.

**Cada período tem fechamento materializado?** SIM — `closingCurrentValueCents`, mantido de
duas formas: incrementalmente (semeando o mês novo com o fechamento do mês anterior, lido do
próprio documento de período, nunca do resumo atual — [reporting.ts:152-202](../../functions/src/investments/reporting.ts#L152-L202)) e no rebuild
(soma corrida sobre a série, [projectionRebuild.ts:731-744](../../functions/src/investments/projectionRebuild.ts#L731-L744)). Lançamento retroativo propaga o
delta para todos os meses posteriores, com teto de 24 meses e falha explícita acima disso.

**`valor(Mar, janela6) == valor(Mar, janela12) == valor(Mar, janela24)`?**

- **No relatório: CONFIRMADO.** `evolution` lê `closingCurrentValueCents` do documento do mês
  ([reports/investments.ts:62-68](../../src/modules/reports/investments.ts#L62-L68)); o valor é propriedade do período, não da consulta.
  Períodos sem o campo são **omitidos** e a série inteira é marcada
  `evolutionUnavailable`, em vez de exibir uma série mista. Provado no Emulator por
  `m7Reports:284` ("janela truncada não altera o fechamento de nenhum mês") e `m3Lifecycle:367`.
- **No dashboard: NÃO CONFIRMADO.** `InvestmentDashboardOverview` **ignora** o campo
  materializado e deriva a série de `summary.currentValueCents` subtraindo
  `currentValueDeltaCents` para trás ([:19-26](../../src/modules/investments/components/InvestmentDashboardOverview.tsx#L19-L26)).
  Aritmeticamente a âncora é o topo da série, então a janela por si só não altera o resultado;
  o que altera é **qualquer deriva entre o resumo vivo e a série materializada**, que desloca
  a série inteira sem sinal nenhum, e o fato de o dashboard exibir valores para meses que o
  relatório oficial suprime por não terem fechamento. Duas fórmulas concorrentes para a mesma
  grandeza — INV-P2-016.

**Rebuild é determinístico?** SIM sem valoração — `m7Reports:360` prova que reexecutar não
altera o resultado. NÃO EXECUTÁVEL com valoração — INV-P1-005.

**`investment_snapshots` é produto ou checkpoint?** **Checkpoint — CONFIRMADO.** Nenhuma tela o
lê (`grep` em `src/` = 0 ocorrências); só alimenta a retomada do próprio rebuild, do backfill e
da migração.

**`investment_report_periods` é reconstrutível?** PARCIALMENTE — ver §9.2. Além da recusa com
valoração, a fase `prune` varre **apenas** `investment_allocation_summaries`
([projectionRebuild.ts:866-872](../../functions/src/investments/projectionRebuild.ts#L866-L872)): um período sem lastro no ledger sobrevive à reconstrução com
valores obsoletos, e o `set(..., {merge: true})` do mapa `daily` preserva dias que não existem
mais — INV-P2-015.

**Períodos antigos mudam quando a janela muda?** NÃO no relatório. Não há caminho de escrita
disparado por leitura.

---

## 14. Compatibilidade legado / V2

| Verificação | Resultado |
| --- | --- |
| Legado continua funcional com `enabled = false` | **CONFIRMADO** — E2E `investments-v2.spec.ts:92` e `:229`; Rules `m4-hardening:600` |
| V2 usa a fonte correta com `enabled = true` | **CONFIRMADO** — E2E `:99` e `:120`; `reports/hooks.ts:129,229`; `goals/projection.ts:9-12` |
| Não existe dual-write acidental | **CONFIRMADO** — a migração não escreve espelho; o espelho V2 tem ID derivado e é escrito uma única vez |
| Não existe leitura híbrida | **CONFIRMADO no relatório e nas metas** · **FALHOU no dashboard e nos KPIs de poupança/caixa** — INV-P2-016, INV-P2-024 |
| Relatórios respeitam a flag | PARCIAL — só `kpi-investments` |
| Metas respeitam a flag | **CONFIRMADO** para PF; PJ ignora `investmentProgressCents` |
| Dashboard respeita a flag | PARCIAL — o bloco patrimonial sim; o card "Investimentos" não |
| Cadastros respeitam a flag | **FALHOU** — INV-P2-025 |
| Alocação PF/PJ com a flag ligada | **FALHOU** — a tela deixa de existir: INV-P1-008 |
| Migração não precisa estar completa para manter `false` | **CONFIRMADO** — a flag é a única chave, e ela nasce ausente |
| Rollback por flag funciona | **PARCIAL** — desliga e a leitura volta ao legado (testado), mas os movimentos migrados permanecem e o checkpoint fica travado: INV-P1-012 |
| Escrita legada fechada com a flag ligada | **FALHOU** — callables gateadas (`assertLegacyInvestmentTrailOpen`) e `create` das Rules gateado, mas o `update` não: INV-P1-002 (REPRODUZIDO) |

---

## 15. Migração e rollback

| Capacidade | Estado | Evidência |
| --- | --- | --- |
| Dry-run | EXISTE, com defeito bloqueante | `legacyMigration.ts:470`, teste `:119` · INV-P1-003 |
| Checkpoint | **CONFIRMADO** | cursor `(cursorDate, cursor)` persistido em `investment_snapshots`, teste `:224` |
| Idempotência | **CONFIRMADO** | ID do movimento derivado da transação de origem, teste `:198` |
| Retomada | **CONFIRMADO** | `startAfter(cursorDate, cursor)` com ordem cronológica, teste `Ordering:102` |
| Operação durante writes ao vivo | **NÃO CONFIRMADO** | sem lease e sem cerca de versão na migração — INV-P2-043 |
| Reconciliação | **CONFIRMADO**, falha fechada | `unclassifiedCount === 0 && principal === principal && ganho === ganho`, testes `:251`, `:268`, `Ordering:135` |
| Relatório de divergências | PARCIAL | devolve agregados e `unclassifiedCount`, não lista as linhas divergentes |
| Conferência de cobertura | **CONFIRMADO** | `count()` agregado rejeita transação sem `date` |
| Feature gate | **CONFIRMADO**, com lacuna | só checa reconciliação; não checa `status: completed`, `dryRun: false` nem `rolledBack` — INV-P2-021 |
| Rollback | PARCIAL | desliga a flag e marca o lote; não compensa e não libera o checkpoint — INV-P1-012 |
| Forward repair | **CONFIRMADO** condicionalmente | reexecutar é idempotente **desde que** o checkpoint não esteja em `completed` — o que INV-P1-003 e INV-P1-012 provocam |
| Preservação do histórico | **CONFIRMADO** | nenhum `.delete()` em nenhum caminho de migração ou rollback |
| Dry-run do backfill | **NÃO IMPLEMENTADO** | `grep dryRun functions/src/investments/backfill.ts` = 0 |
| Superfície operacional | **NÃO IMPLEMENTADO** | INV-P1-006 |
| Teste multi-workspace | LACUNA | os 12 casos usam um único workspace |

**Nenhuma migração foi executada contra dados reais.** As duas reproduções desta auditoria
usaram workspaces sintéticos no Emulator local.

---

## 16. Observabilidade e auditoria

**Trilha em Firestore — completa.** `investment_event_logs` grava, no mesmo limite atômico da
mutação: `actorId`, `actorRole`, `operation`, `entityType`, `entityId`, `correlationId`,
`idempotencyKeyId`, `outcome` e `occurredAt`
([infrastructure.ts:253-284](../../functions/src/investments/infrastructure.ts#L253-L284)). `correlationId` é exigido do cliente em todas as 24 operações,
nunca sintetizado.

| Pergunta em produção | Resposta |
| --- | --- |
| Quem criou / alterou / reverteu | **CONFIRMADO** (`actorId` + `actorRole`) |
| Quando | **CONFIRMADO** (`occurredAt`, serverTimestamp) |
| Em qual workspace | **CONFIRMADO** |
| Qual entidade | **CONFIRMADO** (`entityType` + `entityId`) |
| Por qual motivo | **CONFIRMADO** para reversão e cancelamento (`reason` obrigatório, `minLength 3`) |
| `correlationId` | **CONFIRMADO** |
| Resultado / erro | **CONFIRMADO** (`outcome`, `errorCode`, mensagem truncada em 500 chars) |
| **Fora do Firestore (Cloud Logging, métrica, alerta)** | **NÃO CONFIRMADO** — apenas 2 `console.error` no módulo inteiro, ambos em caminho de exceção; nenhuma métrica exportada, nenhuma política de alerta |

**Eventos por operação:** aporte, resgate, liquidação, cancelamento, reversão, vínculo,
valoração, rebuild, backfill, migração e rollback emitem evento e métrica. **Deriva** é
calculada (`state.drift` em `projectionRebuild.ts:818-853`), mas **só quando alguém invoca
manualmente** o rebuild ou o backfill: não há job agendado nem limiar, ao contrário do domínio
de cartões, que tem `processCreditCardInvoiceOperationalAlerts` diário — INV-P2-019. Somado a
INV-P1-005 (rebuild recusa com valoração), o resultado é que **uma deriva pode existir sem ser
detectada e sem poder ser corrigida**.

**`positionCount` do resumo nunca decrementa** (`FieldValue.increment(snapshot.exists ? 0 : 1)`,
[operationsV2.ts:365](../../functions/src/investments/operationsV2.ts#L365)), enquanto o rebuild conta só posições com exposição: toda posição
100% resgatada produz `drift.positionCount` permanentemente não nulo, tornando a própria
métrica de deriva pouco confiável — INV-P2-047.

**PII e valores monetários em logs:** **nenhum vazamento** no domínio de investimentos e de IA
— os logs emitem só `operation`, `actorId` e `errorCode`. Em cartões, `console.error` despeja o
objeto de erro inteiro, que pode carregar payload e valor do request — INV-P2-036.

---

## 17. UX, acessibilidade e pt-BR

**pt-BR — CONFIRMADO.** Toda a superfície nova está em português, com terminologia financeira
correta: "Aporte", "Resgate", "Reversão", "Pendente/Liquidada/Cancelada", "Principal",
"Valor atual", "Ganho realizado", "Valorização não realizada", "Custo", "Finalidade". A
distinção entre carteira de caixa e conta de investimento é explicada na interface
([InvestmentRegistrySection.tsx:211-214](../../src/modules/investments/components/InvestmentRegistrySection.tsx#L211-L214)).

**Erros técnicos — CONFIRMADO que não vazam.** `toInvestmentHttpsError` traduz tudo o que
conhece e devolve "Erro interno ao processar operação de investimento." para o resto
([errors.ts:49-52](../../functions/src/investments/errors.ts#L49-L52)). As telas mapeiam código → mensagem em pt-BR
(`InvestmentsPortfolioView.tsx:40-47`, `InvestmentRegistrySection.tsx:58-65`); códigos técnicos
ficam em `console.error`. Nenhuma menção a Firebase, Firestore, callable, exception ou stack
trace na interface.

**Estados** — loading, empty, error e success existem e usam `role="status"` / `role="alert"`.

**Acessibilidade**

| Item | Estado |
| --- | --- |
| Modal com foco preso e devolução | **CONFIRMADO** — `<dialog showModal()>` nativo nas duas superfícies novas |
| Abas com padrão ARIA completo | **CONFIRMADO** em Investimentos e Cadastros (`aria-controls`, `tabpanel`, foco itinerante por setas) |
| Abas de Relatórios | **FALHOU** — `role="tab"` sem `id`, `aria-controls`, `tabIndex` itinerante nem `aria-labelledby` ([ReportsView.tsx:82-128](../../src/components/ReportsView.tsx#L82-L128)) — INV-P3-056 |
| Confirmação de operação sensível | PARCIAL — Cadastros usa `<dialog>`; a tela patrimonial usa `window.confirm` ([InvestmentsPortfolioView.tsx:164](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L164)) — INV-P3-057 |
| Prevenção de duplo submit | PARCIAL — 5 de 8 formulários com `disabled={mutation.isPending}`; faltam liquidação, vínculo e reversão — INV-P2-028 |
| Responsividade | **CONFIRMADO** — `overflow-x-auto` nas tabelas largas, grids com breakpoints |

**Diferenças por papel** — a interface esconde ações de owner/admin de `member` e os gates
batem exatamente com a matriz do backend. **CONFIRMADO.**

**Problemas de produto**

- Alerta crítico "Solicite a reconstrução das projeções antes de tomar decisões" sem ação
  disponível ([reports/api.ts:104-108](../../src/modules/reports/api.ts#L104-L108)) — INV-P1-006.
- "Alterar meta" abre um formulário cujo caminho padrão sempre falha — INV-P2-028.
- Meta mostra progresso positivo com "Nenhum investimento vinculado ainda" — INV-P2-029.
- "Outros" da alocação é calculado sobre 10 itens, mas só 5 são exibidos, e o texto afirma um
  agrupamento que não ocorreu para os 5 omitidos ([ReportsOverview.tsx:215-223](../../src/components/ReportsOverview.tsx#L215-L223)) — INV-P2-045.
- Indicador de tendência **fabricado** apresentado como comparação real: `prevPercentage = 22.5`
  fixo ([AllocationAnalysis.tsx:29](../../src/components/AllocationAnalysis.tsx#L29)) e `trends: {…, margin: 'up'}`
  ([business-allocations/logic.ts:118](../../src/modules/business-allocations/logic.ts#L118)) — INV-P2-046.
- `notice` de sucesso persiste ao trocar de aba na tela patrimonial — INV-P3-058.

---

## 18. Cobertura de testes

| Fluxo | Unit | Integration | Rules | E2E | Status |
| --- | :-: | :-: | :-: | :-: | --- |
| Aporte | X | X | X | X | COMPLETO |
| Aporte com meta | X | X | X | X | COMPLETO |
| Resgate pendente | X | X | X | X | COMPLETO |
| Liquidação parcial | X | X | — | X | BOM |
| Liquidação total | — | X | — | — | PARCIAL |
| Reversão | X | X | — | — | PARCIAL |
| Cancelamento | X | X | X | X | COMPLETO |
| Valuation | X | X | X | — | BOM |
| Rebuild de posição | — | X | X | — | PARCIAL |
| Rebuild de projeções | — | X | X | — | PARCIAL |
| Report periods / série mensal | X | X | X | X | COMPLETO |
| Determinismo de janela | X | X | n/a | — | BOM (janelas de 6/24 meses não existem no produto) |
| **Resgate com prejuízo** | — | — | — | — | **LACUNA** |
| **Dry-run → apply no mesmo workspace** | — | — | — | — | **LACUNA (INV-P1-003)** |
| **Migração sobre workspace com movimentos V2** | — | — | — | — | **LACUNA (INV-P1-010)** |
| **`update` de `type` para investimento com a flag ligada** | — | — | — | — | **LACUNA (INV-P1-002)** |
| **Escrita não autenticada em workspace alheio** | — | — | — | — | **LACUNA (INV-P0-001)** |
| **Períodos órfãos e mapa `daily` após rebuild** | — | — | — | — | **LACUNA (INV-P2-015)** |
| Migração legada | — | X | X | — | PARCIAL |
| Reconciliação | — | X | — | — | PARCIAL |
| Rollback / feature flag | X | X | X | X | COMPLETO |
| Idempotência / replay (backend) | X | X | X | X | COMPLETO |
| **Idempotência do cliente em retry** | — | — | — | — | **LACUNA (INV-P1-004)** |
| Concorrência | — | X | n/a | — | PARCIAL |
| Cross-tenant | — | X | X | — | BOM |
| RBAC | X | X | X | — | BOM |
| Importação CSV | — | X parcial | X | — | NÃO IMPLEMENTADO |
| IA (bundle/segredo) | X | — | — | — | PARCIAL |
| **IA (comportamento das callables)** | — | — | — | — | **LACUNA** |
| Onboarding PF/PJ | X | X | — | X | BOM |
| Allocations PF / PJ | X | X | X | — | PARCIAL |
| Dashboard | — | — | X | X | PARCIAL |
| Metas | X | X | X | X | COMPLETO |

**Totais executados nesta auditoria:** 71 unit (functions) + 16 unit (frontend) + 73 integration
+ 54 Rules + 15 E2E = **229 casos**, com **2 falhas não determinísticas** e **0 skips** no
domínio de investimentos. Os 18 testes com skip condicional silencioso ao Emulator estão todos
em cartão de crédito; o domínio de investimentos, metas, shared, Rules e E2E falham fechado
quando o Emulator não está presente — comportamento correto.

---

## 19. Findings detalhados

Formato completo para o P0 e para os 13 P1. Os P2 e P3 usam formato condensado, mantendo
arquivo, evidência, cenário, impacto, correção e teste necessário.

### INV-P0-001 — Escrita cross-tenant por chamador não autenticado no caminho de falha das callables de cartão

**Severidade:** P0
**Área:** Multi-tenant, segurança, custo — domínio de cartões, mesmo deploy
**Arquivos envolvidos:** [functions/src/creditCards/observability.ts:189](../../functions/src/creditCards/observability.ts#L189), [:215-269](../../functions/src/creditCards/observability.ts#L215-L269), [functions/src/creditCards/callables.ts:78-92](../../functions/src/creditCards/callables.ts#L78-L92), [functions/src/creditCards/callable.ts:45-61](../../functions/src/creditCards/callable.ts#L45-L61)
**Evidência:**
```ts
// observability.ts:188-189
const payload = asRecord(requestData);
const workspaceId = getStringValue(payload, "workspaceId");   // payload CRU
```
```ts
// callables.ts:78-88 — roda no catch de TODAS as 9 callables de cartão
const toObservedHttpsError = async (operation, request, error) => {
  await recordCreditCardCallableFailureSafely(operation, request.data, request.auth?.uid, error);
```
`buildCreditCardCallableContext` parseia o payload e só então chama `requireWorkspaceRole`
(`callable.ts:53-61`). Toda falha — inclusive `unauthenticated` — cai no mesmo `catch`.
**Cenário de reprodução:** chamada anônima (sem token) para `createCreditCardPurchase` com
`{"workspaceId":"<vítima>","correlationId":"<n>","amount":999999}`. A autorização falha, o
`catch` executa e o Admin SDK grava, ignorando as Rules:
`workspaces/<vítima>/credit_card_operational_metrics/...` com `amountTotal` incrementado pelo
`amount` do atacante; `workspaces/<vítima>/financial_events/{eventId}` com `eventId` derivado do
`correlationId` do atacante — **um documento novo por chamada, sem teto**; e notificações
`processing_failure` enfileiradas para os membros da vítima
([domainNotifications.ts:263-297](../../functions/src/creditCards/domainNotifications.ts#L263-L297)).
**Impacto:** escrita cross-tenant por chamador não autenticado; poluição da trilha financeira e
das métricas operacionais de qualquer tenant; injeção de conteúdo no feed de notificações de
outro tenant; custo de escrita ilimitado.
**Causa provável:** o wrapper de observabilidade foi escrito antes da separação entre payload
cru e contexto autorizado. O ExecPlan registra este mesmo padrão como corrigido em investimentos
e **aberto** em cartões ([EXECPLAN.md:958](EXECPLAN.md)).
**Correção recomendada:** aplicar o padrão já implementado em
[investments/callables.ts:81-104](../../functions/src/investments/callables.ts#L81-L104) e
[investments/observability.ts:130-150](../../functions/src/investments/observability.ts#L130-L150): o wrapper mantém `authorizedWorkspaceId`,
preenchido só depois de `requireWorkspaceRole`, e passa esse valor; sem autorização, a falha
vira log sanitizado e nada é escrito.
**Teste necessário:** teste de integração que chame uma callable de cartão sem token e sem
membership, com `workspaceId` de outro tenant, e asserte que `credit_card_operational_metrics`,
`financial_events` e `notifications` da vítima permanecem vazios.
**Bloqueia produção:** SIM

### INV-P1-002 — Barreira da trilha legada é contornável por `update` do campo `type`

**Severidade:** P1
**Área:** Segurança, Firestore Rules, integridade financeira
**Arquivos envolvidos:** [firestore.rules:60-62](../../firestore.rules#L60-L62), [:851](../../firestore.rules#L851), [:862-887](../../firestore.rules#L862-L887), [:85-94](../../firestore.rules#L85-L94), [functions/src/shared/featureFlags.ts:29-38](../../functions/src/shared/featureFlags.ts#L29-L38)
**Evidência:** `isLegacyInvestmentWriteAllowed` aparece **uma única vez** no arquivo, na linha 851
(`allow create`). Nenhum dos dois ramos de `allow update` o invoca, e `'type'` está na lista de
`changesOnlyMutableTransactionKeys` ([firestore.rules:87](../../firestore.rules#L87)).
**Cenário de reprodução — EXECUTADO no Emulator** (§24):
```json
{"flagV2Ligada": true,
 "createDiretoDeInvestimentoBloqueado": true,
 "updateDeTipoParaInvestimentoPermitido": true,
 "erroDoUpdate": null,
 "tipoPersistido": "investimento", "valorPersistido": 1000}
```
Um `member` do workspace, com `features.investmentsV2.enabled === true`, cria
`transactions/bypass` como `despesa` (aceito) e em seguida executa
`updateDoc({type: 'investimento'})` — aceito.
**Impacto:** contradiz o invariante que o próprio código declara em `featureFlags.ts:17-28`.
Com a flag ligada, o fluxo de caixa continua somando `transactions` enquanto o patrimônio lê só
as projeções: o dinheiro sai do caixa e nunca aparece no patrimônio, sem erro para o usuário.
`assertLegacyInvestmentTrailOpen` fecha as callables legadas, mas a escrita direta do cliente
não passa por callable nenhuma.
**Causa provável:** a correção P1 registrada no ExecPlan em 2026-08-24 fechou as três camadas
para `create` e não replicou o predicado no `update`.
**Correção recomendada:** **remover `type` da lista de `changesOnlyMutableTransactionKeys`** — trocar
o tipo de uma transação existente não é operação legítima do produto, e esta é a única correção
compatível com a evidência de INV-P2-049 (o `allow update` de `transactions` já opera no teto de
1.000 avaliações de expressão das Rules). Acrescentar `isLegacyInvestmentWriteAllowed` aos dois
ramos de `allow update` resolveria o bypass mas introduz mais um `get()` e mais predicados
exatamente na regra que já atinge o teto; só deve ser considerado depois de INV-P2-049.
**Teste necessário:** em `tests/firestore/m4-hardening.rules.integration.test.mjs`, ao lado do
teste de `create` da linha 566, um teste que crie `despesa` e tente `updateDoc({type:'investimento'})`
com a flag ligada, esperando rejeição — para owner, admin e member.
**Bloqueia produção:** SIM

### INV-P1-003 — Dry-run da migração consome o checkpoint e transforma a execução real num no-op que reporta sucesso

**Severidade:** P1
**Área:** Migração
**Arquivos envolvidos:** [functions/src/investments/legacyMigration.ts:382-388](../../functions/src/investments/legacyMigration.ts#L382-L388), [:396-410](../../functions/src/investments/legacyMigration.ts#L396-L410), [:470](../../functions/src/investments/legacyMigration.ts#L470), [:483-521](../../functions/src/investments/legacyMigration.ts#L483-L521), [functions/src/investments/contracts.ts:189](../../functions/src/investments/contracts.ts#L189)
**Evidência:**
```ts
// :382-384 — mesmo id para simulação e aplicação
const migrationId = payload.migrationId ??
  deterministicDocumentId("legacy-migration-run", auth.workspaceId);
// :470 — dryRun bloqueia apenas a aplicação
if (payload.dryRun) continue;
// :483-487 + :548 — o cursor avança e é persistido nos dois modos
if (last) { state.cursor = last.id; state.cursorDate = String(last.get("date")); }
```
`dryRun` tem **default `true`** (`contracts.ts:189`), e não existe guarda de `phase === "completed"`
nem de `dryRun` anterior — o `backfill` tem a guarda equivalente em `backfill.ts:133`.
**Cenário de reprodução — EXECUTADO no Emulator** (§24), workspace com dois aportes legados
somando R$ 1.500,00:
```json
{"dryRun": {"completed": true, "scanned": 2, "migrated": 0},
 "execucaoReal": {"completed": true, "scanned": 2, "migrated": 0},
 "movimentosNoDominio": 0, "posicoesNoDominio": 0,
 "reconciliacao": {"legacy": 150000, "dominio": 0, "reconciled": false}}
```
**Impacto:** o procedimento correto — simular e depois aplicar — migra zero movimentos e
devolve `completed: true`. O workspace fica bloqueado para migrar pelo `migrationId` padrão,
porque reexecutar retoma do fim do cursor. A reconciliação **falha fechada** e impede ligar a
flag, o que evita corrupção, mas o operador recebe uma recusa sem explicação da causa.
**Causa provável:** o `dryRun` foi implementado como filtro de escrita no domínio, sem
considerar que o próprio checkpoint é estado persistido.
**Correção recomendada:** derivar `migrationId` incluindo o modo
(`legacy-migration-dryrun` × `legacy-migration-run`), ou recusar a aplicação quando o snapshot
existente tiver `dryRun: true`, ou não persistir cursor em modo simulação.
**Teste necessário:** em `legacyMigration.integration.test.ts`, um caso que rode `migrateAll(true)`
até `completed` e em seguida `migrateAll(false)` **no mesmo workspace e sem `migrationId`
explícito**, assertando `migrated === 3` e `reconciled === true`.
**Bloqueia produção:** SIM

### INV-P1-004 — Idempotência do backend é inalcançável: o cliente gera chave nova a cada chamada

**Severidade:** P1
**Área:** Idempotência, integridade financeira
**Arquivos envolvidos:** [src/modules/investments/persistence/callableApi.ts:10-13](../../src/modules/investments/persistence/callableApi.ts#L10-L13), [InvestmentsPortfolioView.tsx:111](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L111), [InvestmentRegistrySection.tsx:136](../../src/modules/investments/components/InvestmentRegistrySection.tsx#L136)
**Evidência:**
```ts
export const investmentRequestIds = () => {
  const id = crypto.randomUUID();
  return { idempotencyKey: `investment-ui-${id}`, correlationId: `investment-ui-${id}` };
};
```
Chamado dentro do `mutationFn`, ou seja, **uma vez por invocação**. `idempotencyKey` e
`correlationId` recebem o mesmo valor, anulando também o desenho do ExecPlan, que mantém o
`correlationId` fora da identidade justamente para que o retry seja replay. O único caminho
correto é `onboardInvestmentWorkspace`, que usa `investment-onboarding-v1:${workspaceId}`
(`callableApi.ts:24`).
**Cenário de reprodução:** "Confirmar aporte" → o servidor comete a transação → a resposta se
perde por timeout de rede → o usuário reenvia → nova UUID → **segundo aporte criado**. Idem
para duplo clique em "Confirmar liquidação" e "Confirmar reversão", que ainda não têm
`disabled={mutation.isPending}` (INV-P2-028).
**Impacto:** duplicação de fato financeiro exatamente no cenário que a idempotência existe para
cobrir. Viola o invariante de `AGENTS.md`. Toda a infraestrutura de idempotência do backend —
reserva atômica, `requestHash`, IDs determinísticos — fica inacessível a partir da interface.
**Causa provável:** o gerador foi escrito para produzir identificadores de requisição, não
identidade de intenção do usuário.
**Correção recomendada:** derivar a chave da intenção e mantê-la estável enquanto o formulário
estiver aberto (gerar uma vez por abertura de modal, ou derivar de operação + entidade +
valores). Manter `correlationId` distinto e novo a cada tentativa.
**Teste necessário:** teste de componente que dispare duas submissões do mesmo formulário e
asserte a mesma `idempotencyKey`; e um E2E de duplo clique em "Confirmar aporte" assertando um
único movimento.
**Bloqueia produção:** SIM

### INV-P1-005 — Reconstrução de projeções recusa rodar quando existe valoração: não há caminho de reparo de deriva

**Severidade:** P1
**Área:** Rebuild, integridade, operação
**Arquivos envolvidos:** [functions/src/investments/projectionRebuild.ts:479-503](../../functions/src/investments/projectionRebuild.ts#L479-L503), [:340-395](../../functions/src/investments/projectionRebuild.ts#L340-L395)
**Evidência:**
```ts
if (state.phase === "positions" && !state.cursor) {
  const anyValuation = await transaction.get(
    investmentCollection(auth.workspaceId, INVESTMENT_COLLECTIONS.valuations).limit(1));
  if (!anyValuation.empty) {
    throw new CreditCardApplicationError("domain_precondition_failed",
      "Este workspace possui valorações registradas, e a reconstrução da série mensal ainda não repassa valorações. …");
```
`accumulateMovement` percorre **apenas** movimentos; o efeito patrimonial das valorações não é
repassado, então publicar apagaria a variação de marcação a mercado. A recusa é a decisão
correta — o problema é o que ela deixa sem saída.
**Cenário de reprodução:** workspace com uma valoração registrada apresenta deriva entre
`investment_summaries` e `investment_report_periods`; `rebuildInvestmentProjections` falha com
`failed-precondition`. Coberto por teste (`m7Reports:412`), que confirma o comportamento.
**Impacto:** o único mecanismo de reparo de deriva de projeções fica indisponível exatamente nos
workspaces que usam marcação a mercado. Combinado com INV-P2-019 (deriva só é medida durante um
rebuild) e INV-P2-023 (o teto retroativo manda reconstruir), o sistema fica sem detecção e sem
reparo. É a lacuna **M8.B**, declarada pendente no ExecPlan — aqui confirmada no código.
**Causa provável:** a fase de acumulação foi construída sobre um único fluxo de movimentos.
**Correção recomendada:** implementar o desenho já definido no ExecPlan — repassar movimentos e
valorações num único fluxo cronológico, mantendo quantidade e preço por posição e fotografando
o fechamento a cada virada de mês — e remover a recusa.
**Teste necessário:** integração que crie aportes e valorações em meses distintos, rode o
rebuild e asserte `closingCurrentValueCents` igual ao caminho incremental, em duas execuções
consecutivas e com retomada por página.
**Bloqueia produção:** SIM

### INV-P1-006 — Nenhuma superfície operacional para migrar, reverter, ligar a flag, reconstruir, fazer backfill ou registrar valoração

**Severidade:** P1
**Área:** Operação, migração, produto
**Arquivos envolvidos:** [functions/src/investments/callables.ts:168-250](../../functions/src/investments/callables.ts#L168-L250), [src/modules/investments/persistence/callableApi.ts](../../src/modules/investments/persistence/callableApi.ts), [src/modules/reports/api.ts:104-108](../../src/modules/reports/api.ts#L104-L108)
**Evidência:** `grep` por `migrateLegacyInvestments`, `rollbackLegacyInvestmentMigration`,
`enableInvestmentsV2Flag`, `rebuildInvestmentProjections`, `backfillInvestmentWorkspace`,
`recordInvestmentValuation`, `recalculateInvestmentPosition`,
`recalculateGoalInvestmentProgress` e `registerInvestmentImportBatch` em `src/`, `tools/` e
`e2e/` retorna **zero ocorrências**. Não existe script, CLI ou runbook no repositório.
**Cenário de reprodução:** o relatório exibe o alerta crítico *"Solicite a reconstrução das
projeções antes de tomar decisões"* e não há nenhum controle que a solicite.
**Impacto:** nove callables críticas — todo o caminho de migração, rollback, habilitação da
flag, reconstrução e valoração — só são invocáveis por teste de integração. Não há procedimento
executável para colocar um workspace legado em produção, nem para reverter.
**Causa provável:** o backend foi entregue antes da superfície operacional; o ExecPlan não
prevê um marco de operação.
**Correção recomendada:** entregar superfície administrativa mínima (tela restrita a owner ou
script versionado em `tools/`), com confirmação explícita, exibição do resultado da
reconciliação e registro do `correlationId`; e um controle de reconstrução no ponto onde o
alerta é exibido.
**Teste necessário:** E2E que, com a flag desligada e dados legados, execute a migração pela
superfície, verifique a reconciliação, ligue a flag e confira o patrimônio; e um E2E de rollback.
**Bloqueia produção:** SIM

### INV-P1-007 — Valoração não tem caminho de escrita no produto: ganho não realizado é estruturalmente zero

**Severidade:** P1
**Área:** Domínio financeiro, produto
**Arquivos envolvidos:** [functions/src/investments/callables.ts:210](../../functions/src/investments/callables.ts#L210), [functions/src/investments/math.ts:44-51](../../functions/src/investments/math.ts#L44-L51), [ReportsOverview.tsx:197](../../src/components/ReportsOverview.tsx#L197), [InvestmentsPortfolioView.tsx:211](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L211)
**Evidência:** `currentValueForPosition` devolve `principalCents` quando não há
`unitPriceMicros`. Como nada no produto chama `recordInvestmentValuation`, nenhuma posição
recebe preço, e portanto `currentValue == principal` e `unrealizedAppreciation = 0` em todo
workspace.
**Cenário de reprodução:** aportar R$ 1.000,00 e abrir Relatórios: "Ganho não realizado" exibe
R$ 0,00 permanentemente e o gráfico de evolução patrimonial é idêntico à curva de custo.
**Impacto:** o produto entrega uma tela de patrimônio que não distingue patrimônio de custo — a
razão de existir do módulo. `progressBasis: 'current_value'` torna-se indistinguível de
`net_contributions`. Três painéis de relatório ficam permanentemente zerados.
**Causa provável:** M3 criou o caminho de escrita de valoração no backend; nenhum marco
posterior o expôs.
**Correção recomendada:** expor o registro de valoração na tela patrimonial (owner/admin, com
data efetiva e preço unitário), ou uma rotina de atualização a partir de fonte de preço.
**Teste necessário:** E2E que registre valoração e verifique patrimônio ≠ custo, ganho não
realizado ≠ 0 e o ponto correspondente no gráfico.
**Bloqueia produção:** SIM

### INV-P1-008 — Ligar a flag remove do produto os diagnósticos de alocação PF e PJ

**Severidade:** P1
**Área:** Frontend, PF, PJ, regressão funcional
**Arquivos envolvidos:** [src/App.tsx:619-630](../../src/App.tsx#L619-L630), [src/components/TransactionsView.tsx:443-456](../../src/components/TransactionsView.tsx#L443-L456)
**Evidência:**
```tsx
// TransactionsView.tsx:443,450 — únicos pontos de montagem
{viewType === 'investimento' && isPF && <AllocationAnalysis … />}
{viewType === 'investimento' && isPJ && <BusinessAllocationAnalysis … />}
```
```tsx
// App.tsx:630 — TransactionsView só é montado para 'investimento' com a flag DESLIGADA
{(view === 'receita' || view === 'despesa' ||
  (view === 'investimento' && activeWorkspace.features?.investmentsV2?.enabled !== true)) && <TransactionsView …
```
`InvestmentsPortfolioView`, que ocupa o lugar com a flag ligada, não tem seção de alocação.
**Cenário de reprodução:** ligar a flag → menu Investimentos → o diagnóstico 70/30 (PF) e o de
reserva/aplicação/reinvestimento/imobilizado (PJ) desaparecem do produto.
**Impacto:** regressão funcional visível ao usuário final ao habilitar o marco. Grave em PJ,
onde a classificação contábil é o principal valor do módulo. O backend **já calcula** exatamente
esses cortes em `investment_allocation_summaries` com a dimensão `purpose`
([reporting.ts:331-339](../../functions/src/investments/reporting.ts#L331-L339)) — os dados existem e não são consumidos.
**Causa provável:** o M7 integrou as alocações no relatório e não reavaliou a tela de
Investimentos, onde elas eram exibidas.
**Correção recomendada:** montar uma seção de alocação em `InvestmentsPortfolioView` alimentada
por `investment_allocation_summaries`, com as dimensões `purpose`, `class` e `liquidity`,
ramificada por PF/PJ.
**Teste necessário:** E2E PF e E2E PJ com a flag ligada, assertando presença do diagnóstico e
coerência dos totais com o resumo.
**Bloqueia produção:** SIM

### INV-P1-009 — Resgate com prejuízo é irrepresentável e deixa principal fantasma na posição

**Severidade:** P1
**Área:** Integridade financeira
**Arquivos envolvidos:** [functions/src/investments/contracts.ts:25-30](../../functions/src/investments/contracts.ts#L25-L30), [functions/src/investments/operationsV2.ts:144-172](../../functions/src/investments/operationsV2.ts#L144-L172), [:958-967](../../functions/src/investments/operationsV2.ts#L958-L967), [functions/src/investments/math.ts:44-51](../../functions/src/investments/math.ts#L44-L51)
**Evidência:** `gainCents` usa `centsSchema` (inteiro não-negativo) e o contrato de documento
exige `realizedGainCents` não-negativo — **não existe campo para perda realizada**.
`applyPositionDeltas` valida apenas não-negatividade de cada componente; **nenhuma invariante
liga `quantityMicros === 0` a `principalCents === 0`**.
**Cenário de reprodução:** aporte de 100 unidades por R$ 1.000,00
(`principalCents 100000`, `quantityMicros 100000000`). Resgate integral com retorno de R$ 800,00:
o único preenchimento coerente com o caixa recebido é
`{principalCents: 80000, quantityMicros: 100000000, gainCents: 0}`. Passa nas duas validações.
Posição final: `quantityMicros 0`, `principalCents 20000`, e sem valoração
`currentValueForPosition(0, 20000, undefined)` devolve **20000**.
**Impacto:** R$ 200,00 de patrimônio fantasma permanente no `investment_summaries/current` e nas
8 faixas de alocação, sem quantidade que o sustente. O rebuild reproduz o mesmo valor, porque
soma os `principalDeltaCents` do ledger — o erro é **irrecuperável por reconstrução**. A
alternativa disponível ao operador é lançar a perda como `feesCents`, classificando prejuízo de
capital como taxa e corrompendo o relatório de outra forma.
**Causa provável:** o modelo foi desenhado para o caso de ganho; a perda realizada não entrou no
contrato.
**Correção recomendada:** admitir resultado realizado com sinal (`realizedResultCents` inteiro,
podendo ser negativo) ou um campo explícito de perda, ajustando fórmula de caixa, série mensal e
Rules; e adicionar a invariante `quantityMicros === 0 ⇒ principalCents === 0` na liquidação
total.
**Teste necessário:** integração de resgate integral abaixo do custo, assertando posição zerada,
resultado realizado negativo, caixa correto e reconstrução idêntica.
**Bloqueia produção:** SIM

### INV-P1-010 — A migração legada classifica o espelho V2 como aporte legado e duplica principal

**Severidade:** P1
**Área:** Migração, dupla contagem
**Arquivos envolvidos:** [functions/src/investments/legacyMigration.ts:131-179](../../functions/src/investments/legacyMigration.ts#L131-L179), [functions/src/investments/operationsV2.ts:404-459](../../functions/src/investments/operationsV2.ts#L404-L459)
**Evidência:** `classifyLegacyRow` decide por `type`, `investmentMetadata.status` e
`investmentOperation`. O espelho escrito por `writeCashProjection` carrega exatamente
`type: "investimento"`, `status: "settled"` e `investmentOperation: "contribution"` — e cai no
ramo de contribuição legada. O documento traz `investmentMetadata.domainVersion` e
`domainMovementId` ([operationsV2.ts:422-424](../../functions/src/investments/operationsV2.ts#L422-L424)), mas **nenhum código do repositório os lê**.
**Cenário de reprodução:** workspace que usou callables V2 antes de migrar — nada impede, porque
as callables V2 não são gateadas pela flag — e depois roda `migrateLegacyInvestments`. Cada
espelho `transactions/investment_{movementId}` gera um **segundo** movimento, com ID derivado do
ID do espelho, somando principal outra vez na posição.
**Impacto:** patrimônio e principal duplicados. A reconciliação **não protege**, porque soma o
lado legado com o mesmo classificador — o erro fecha consigo mesmo e a flag é liberada. Sem
undo, por INV-P1-012.
**Causa provável:** o classificador foi escrito assumindo migração em workspace puramente legado.
**Correção recomendada:** excluir em `classifyLegacyRow` toda linha com
`investmentMetadata.domainVersion >= 2` ou com `domainMovementId` presente, marcando
`skipReason: "espelho_v2"` como exclusão legítima (não `unclassified`).
**Teste necessário:** integração que crie um aporte por `createInvestmentContribution`, rode a
migração completa e asserte que o principal da posição não dobrou e que o espelho foi contado
como excluído.
**Bloqueia produção:** SIM

### INV-P1-011 — `getTransactions` lê a subcoleção inteira de transações no fluxo principal

**Severidade:** P1
**Área:** Escala, performance, custo
**Arquivos envolvidos:** [src/modules/transactions/api.ts:174-182](../../src/modules/transactions/api.ts#L174-L182), [src/modules/transactions/hooks.ts:25-32](../../src/modules/transactions/hooks.ts#L25-L32), [src/App.tsx:184](../../src/App.tsx#L184)
**Evidência:**
```ts
const snapshot = await getDocs(txCol(workspaceId));   // sem where, sem orderBy, sem limit
return snapshot.docs.sort((a, b) => getSortTime(b.data()) - getSortTime(a.data())).map(normalizeTransaction);
```
**Cenário de reprodução:** tenant PJ com 200.000 transações. Cada carga do aplicativo lê 200.000
documentos, ordena em memória e recorta o mês no cliente ([App.tsx:541-552](../../src/App.tsx#L541-L552)).
**Impacto:** custo de leitura e latência lineares no histórico, no caminho que alimenta
dashboard, relatórios, metas e alocações. Viola o invariante de `AGENTS.md`. O módulo de
investimentos **agrava** o problema: com a flag ligada, cada movimento acrescenta um espelho à
mesma coleção.
**Causa provável:** dívida pré-existente, registrada no ExecPlan como risco aberto desde o M0.
**Correção recomendada:** paginar por `transactionDate` com cursor e `limit` e recortar o período
no servidor; ou servir dashboard e relatórios exclusivamente por read models, como já se faz
para cartões e investimentos.
**Teste necessário:** teste que asserte presença de `limit` e filtro de período, e um teste de
custo com fixture grande.
**Bloqueia produção:** SIM

### INV-P1-012 — Rollback da migração não compensa nada e deixa o workspace sem caminho de reexecução

**Severidade:** P1
**Área:** Rollback, migração
**Arquivos envolvidos:** [functions/src/investments/legacyMigration.ts:813-869](../../functions/src/investments/legacyMigration.ts#L813-L869), [:744-791](../../functions/src/investments/legacyMigration.ts#L744-L791)
**Evidência:** as únicas escritas do rollback são desligar `features.investmentsV2.enabled` e
marcar `rolledBack: true` no snapshot. Movimentos, posições, alocações e períodos escritos por
`applyLegacyRow` permanecem, sem lançamento compensatório. O checkpoint conserva `cursor` e
`phase: "completed"`.
**Cenário de reprodução:** migração aplicada com o defeito INV-P1-010 (principal duplicado) →
rollback → a flag desliga e a leitura volta ao legado, mas as posições duplicadas continuam
publicadas. Reexecutar a migração com o mesmo `migrationId` migra zero linhas.
**Impacto:** uma migração incorreta é permanente. Preservar histórico é correto e exigido por
`AGENTS.md`; o que falta é o lançamento compensatório equivalente ao `reversal` já existente no
domínio, e a liberação do checkpoint.
**Causa provável:** o rollback foi desenhado como "desligar a flag", não como "reverter os
efeitos preservando o histórico".
**Correção recomendada:** emitir movimentos `reversal` para cada movimento criado pelo lote (o
mecanismo já existe e é testado) e reabrir o checkpoint (`phase: "scanning"`, cursor limpo,
`rolledBack: true` mantido como marca de auditoria).
**Teste necessário:** integração que migre, faça rollback, asserte posições zeradas e histórico
preservado, e então reexecute a migração com sucesso.
**Bloqueia produção:** SIM

### INV-P1-013 — Qualquer usuário autenticado concede a si mesmo o plano pago

**Severidade:** P1
**Área:** Segurança, billing — mesmo deploy
**Arquivos envolvidos:** [firestore.rules:1221-1226](../../firestore.rules#L1221-L1226), [src/hooks/usePlan.ts:20-27](../../src/hooks/usePlan.ts#L20-L27), [functions/src/webhooks/stripe.ts:38-45](../../functions/src/webhooks/stripe.ts#L38-L45)
**Evidência:**
```
match /users/{userId} {
  allow read, write: if signedIn() && request.auth.uid == userId;   // sem hasOnly, sem campo imutável
```
`usePlan` lê `users/{uid}.planId` por `onSnapshot` e é a única fonte de entitlement do cliente.
O webhook Stripe grava exatamente `{planId: "pro", isPro: true}`.
**Cenário de reprodução:** `setDoc(doc(db,'users',myUid), {planId:'pro', isPro:true}, {merge:true})`
no console do navegador.
**Impacto:** bypass de cobrança para todos os usuários. Não é cross-tenant e não afeta o domínio
de investimentos, mas está no mesmo `firestore.rules` que este marco publica.
**Correção recomendada:** restringir a escrita do cliente às chaves de perfil realmente suas,
com `hasOnly`, negando `planId`, `isPro` e `stripeCustomerId` — que só o webhook deve escrever.
**Teste necessário:** Rules test que negue a escrita de `planId` pelo próprio usuário.
**Bloqueia produção:** SIM

### INV-P1-014 — O domínio vive quase inteiro no working tree, sem commit

**Severidade:** P1
**Área:** Operação, rollback, continuidade
**Evidência:** `git status --short` lista 24 arquivos não rastreados somando **8.828 linhas**,
incluindo `legacyMigration.ts` (918), `projectionRebuild.ts` (910), `writeStrategy.ts` (625),
`reporting.ts` (540), `backfill.ts` (370), `documentContracts.ts` (360), `observability.ts` (225),
`ai/callables.ts` (235), `shared/*` (221) e 11 arquivos de teste. `git diff --stat HEAD` soma 52
arquivos com **+4.194 / −553**. `origin/main` está em `3397493`, três commits atrás de `c754cfa`.
**Cenário de reprodução:** `git checkout .` seguido de `git clean -fd` destrói o M7, o M8, a
migração legada, a IA backend-only e o limite de frequência.
**Impacto:** não existe `git revert` para nada disso; o plano de rollback do ExecPlan
("`git revert` do commit") **não se aplica** a código não rastreado; e nenhum pipeline que parta
do repositório consegue implantar o que está no disco.
**Correção recomendada:** commitar em incrementos revisáveis antes de qualquer outra ação, com o
gate executado por commit.
**Teste necessário:** `git status --short` limpo e `npm run verify:all` verde no commit final.
**Bloqueia produção:** SIM

### P2 — corrigir antes ou imediatamente após rollout controlado

| ID | Título | Arquivo:linha | Evidência e cenário | Impacto | Correção | Teste necessário |
| -- | ------ | ------------- | ------------------- | ------- | -------- | ---------------- |
| INV-P2-015 | Rebuild não poda períodos órfãos e faz merge do mapa `daily` | [projectionRebuild.ts:781-810](../../functions/src/investments/projectionRebuild.ts#L781-L810), [:866-872](../../functions/src/investments/projectionRebuild.ts#L866-L872) | A fase `prune` varre só `allocationSummaries`; `publishPage` grava apenas os meses presentes em `state.periods`, com `{merge: true}` — chaves de dia antigas sobrevivem no mapa `daily` | Após uma reconstrução, um mês sem lastro no ledger mantém fechamento obsoleto e a série diária diverge do total mensal | Podar também `investment_report_periods`; substituir o mapa `daily` em vez de mesclar | Integração: estornar o único movimento de um dia, reconstruir e assertar `daily` sem a chave antiga e período órfão zerado |
| INV-P2-016 | Dashboard deriva a evolução do resumo vivo em vez do fechamento materializado | [InvestmentDashboardOverview.tsx:19-26](../../src/modules/investments/components/InvestmentDashboardOverview.tsx#L19-L26) | `let current = summary.currentValueCents; … current -= period.currentValueDeltaCents` — ignora `closingCurrentValueCents`, que está na mesma resposta e é usado pelo relatório ([reports/investments.ts:62-68](../../src/modules/reports/investments.ts#L62-L68)) | Duas fórmulas concorrentes para a mesma grandeza; qualquer deriva entre resumo e série desloca o gráfico inteiro sem sinal, e o dashboard exibe meses que o relatório suprime por não terem fechamento | Ler `closingCurrentValueCents`, omitir meses sem o campo e sinalizar, como o relatório faz | Teste de componente com um período sem fechamento e outro com deriva injetada |
| INV-P2-017 | Contenção: ~17 escritas por aporte, 4 delas em documentos singleton do workspace | [operationsV2.ts:357](../../functions/src/investments/operationsV2.ts#L357), [reporting.ts:217](../../functions/src/investments/reporting.ts#L217), [:410](../../functions/src/investments/reporting.ts#L410), [observability.ts:60](../../functions/src/investments/observability.ts#L60) | `investment_summaries/current`, `investment_report_periods/{mês}`, `investment_operational_metrics/{dia_op}` e as alocações `account`/`class` são escritos na mesma transação por toda mutação | Teto prático de ~1 operação/s por workspace; limitante em migração de tenant grande e em uso concorrente | Fragmentar o resumo em shards agregados na leitura, ou mover métrica e alocações para escrita assíncrona fora da transação crítica | Teste de carga com N mutações concorrentes medindo abortos por contenção |
| INV-P2-018 | Cerca de versão torna o rebuild irretomável sob escrita concorrente | [projectionRebuild.ts:473-478](../../functions/src/investments/projectionRebuild.ts#L473-L478) | Qualquer mutação incrementa `projectionVersion` e a reconstrução aborta; não há caminho de reset do snapshot — exige novo `rebuildId` | Em workspace ativo o rebuild pode nunca concluir; combinado com INV-P1-005, o reparo fica indisponível | Reiniciar a fase automaticamente com nova cerca, ou expor reset explícito do snapshot | Integração: iniciar rebuild, aplicar mutação concorrente, assertar retomada bem-sucedida |
| INV-P2-019 | Não há detecção de deriva agendada nem alerta para investimentos | `grep -rn "investment" functions/src/crons/*.ts` = 0 | A deriva é calculada em `projectionRebuild.ts:818-853`, mas só quando alguém invoca manualmente o rebuild ou o backfill. Cartões tem `processCreditCardInvoiceOperationalAlerts` diário | Uma divergência entre ledger e projeções pode persistir indefinidamente sem ninguém saber | Cron diário paginado que compare projeções com o ledger e emita métrica e evento sem reconstruir (M8.G do ExecPlan) | Integração: injetar deriva, rodar a rotina e assertar evento e métrica |
| INV-P2-020 | Callables de IA sem `secrets` declarado: falham em produção | [functions/src/ai/callables.ts:105](../../functions/src/ai/callables.ts#L105), [:179](../../functions/src/ai/callables.ts#L179), [:87](../../functions/src/ai/callables.ts#L87) | `onCall(async (request) => …)` sem opções, enquanto `billing.ts:10` e `stripe.ts:13` declaram `secrets: [...]`. Não existe `functions/.env` | `process.env.GOOGLE_AI_API_KEY` fica indefinido e as duas callables falham em toda chamada (fecha corretamente, mas o recurso não funciona) | Declarar `secrets: ["GOOGLE_AI_API_KEY"]` nas duas | Teste que asserte a declaração; smoke pós-deploy |
| INV-P2-021 | `enableInvestmentsV2Flag` não checa o estado da migração; reconciliação trunca em 500 páginas sem sinal | [legacyMigration.ts:877-917](../../functions/src/investments/legacyMigration.ts#L877-L917), [:317](../../functions/src/investments/legacyMigration.ts#L317), [:344](../../functions/src/investments/legacyMigration.ts#L344) | A única pré-condição é `reconciliation.reconciled`; não há leitura do snapshot para exigir `status: completed`, `dryRun: false` e `rolledBack !== true`. Os dois laços de reconciliação param em 500 páginas sem `throw` | Um workspace acima de ~100.000 transações de investimento reconcilia sobre um lado truncado — falha fechada, mas com recusa inexplicada; e a flag pode ser ligada sobre um lote em dry-run | Ler o snapshot da migração como pré-condição e falhar explicitamente ao atingir o teto de páginas | Integração com fixture acima do teto e com lote em dry-run |
| INV-P2-022 | Datas de liquidação, estorno e valoração sem validação temporal | [operationsV2.ts:926](../../functions/src/investments/operationsV2.ts#L926), [:1212](../../functions/src/investments/operationsV2.ts#L1212), [:2199](../../functions/src/investments/operationsV2.ts#L2199) | Nenhuma checagem de futuro nem de coerência com `occurredAt` do original; o único `toMillis()` comparativo é o da valoração mais recente | Estorno com `reversedAt` retroativo subtrai patrimônio de um mês anterior e propaga negativo para todos os posteriores; valoração no futuro cria período futuro que passa a receber deltas | Rejeitar data futura e exigir `>= occurredAt` do movimento de origem | Integração para cada uma das três operações |
| INV-P2-023 | Teto retroativo de 24 meses aponta para uma reconstrução que se recusa a rodar | [reporting.ts:182-189](../../functions/src/investments/reporting.ts#L182-L189) + [projectionRebuild.ts:495-502](../../functions/src/investments/projectionRebuild.ts#L495-L502) | A mensagem manda "reconstrua a série mensal"; a reconstrução recusa se houver qualquer valoração | Workspace com 25+ meses de histórico e marcação a mercado fica sem caminho para correção retroativa | Depende de INV-P1-005; até lá, ajustar a mensagem para não indicar um remédio indisponível | Integração com 25 meses e uma valoração |
| INV-P2-024 | KPIs de relatório e dashboard com fontes mistas | [reports/api.ts:72-82](../../src/modules/reports/api.ts#L72-L82), [reports/logic.ts:119-122](../../src/modules/reports/logic.ts#L119-L122), [App.tsx:580](../../src/App.tsx#L580) | Só `kpi-investments` é substituído pela fonte oficial; `kpi-savings` e `kpi-balance` seguem em `transactions`, e o card "Investimentos" do dashboard ignora a flag. Em PJ o override é no-op, porque `buildBusinessKPIs` não emite `kpi-investments` | Na mesma tela, duas grandezas com o mesmo nome vindas de coleções diferentes; qualquer deriva vira incoerência visível | Alimentar poupança e o card do dashboard pela mesma fonte oficial quando a flag está ligada; emitir o KPI em PJ | Teste que injete deriva e asserte coerência entre os KPIs |
| INV-P2-025 | Cadastro patrimonial em Configurações não respeita a flag | [SettingsView.tsx:706-716](../../src/components/SettingsView.tsx#L706-L716) | `InvestmentOnboardingCard` e `InvestmentRegistrySection` são montados sem verificar `features.investmentsV2.enabled`; `InvestmentOnboardingCard.tsx:60-61` dispara 2 queries sem `enabled` condicional | Com a flag desligada, o usuário cria contas e ativos que nenhuma tela consome, e paga 2 leituras por visita | Gatear a seção pela flag | E2E com a flag desligada assertando ausência da seção |
| INV-P2-026 | Ativo não aceita classe, risco, liquidez nem indexador: 3 painéis de alocação sempre vazios | [contracts.ts:279-303](../../functions/src/investments/contracts.ts#L279-L303) vs [reporting.ts:341-381](../../functions/src/investments/reporting.ts#L341-L381) | O contrato `.strict()` não tem `classId/riskId/liquidityId/indexerId`; os formulários enviam só `{name, symbol, assetType, allocationPurpose}`. O onboarding **semeia** os catálogos correspondentes | "Por risco", "Por liquidez" e "Por indexador" exibem sempre uma linha "Não informado", e 3 das 8 queries de alocação por carga são garantidamente vazias | Aceitar os quatro campos no contrato e nos formulários, referenciando o catálogo semeado | Integração de alocação por risco/liquidez/indexador + E2E de cadastro |
| INV-P2-027 | `progressBasis: 'current_value'` não é selecionável em nenhum formulário | [GoalFormModal.tsx:276](../../src/components/GoalFormModal.tsx#L276) | `progressBasis: goalToEdit?.progressBasis ?? 'net_contributions'` fixo; nenhum campo de UI | Meta baseada em valor de mercado é inalcançável pelo usuário, apesar de o backend suportar | Expor a escolha no formulário de meta | E2E que altere a base e verifique o progresso |
| INV-P2-028 | Três formulários sensíveis sem prevenção de duplo submit; "Alterar meta" sempre falha | [InvestmentsPortfolioView.tsx:241](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L241), [:243](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L243), [:244](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L244), [:225](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L225) | Liquidação, vínculo e reversão não têm `disabled={mutation.isPending}`, ao contrário dos outros 5. O select de "Alterar meta" só oferece a meta atual, e `operationsV2.ts:1570` rejeita revínculo | Duplo clique dispara duas callables independentes (agravado por INV-P1-004); o caminho padrão do botão "Alterar meta" é sempre erro | Adicionar `disabled`; oferecer troca de meta como desvincular + vincular numa única ação | Teste de componente para o `disabled`; E2E de troca de meta |
| INV-P2-029 | Meta mostra progresso positivo com lista de movimentações vazia | [GoalDetailsView.tsx:78-79](../../src/components/GoalDetailsView.tsx#L78-L79), [:263](../../src/components/GoalDetailsView.tsx#L263), [GoalFormModal.tsx:700-709](../../src/components/GoalFormModal.tsx#L700-L709) | O progresso vem de `investmentProgressCents` (posições), mas a lista vem de `transactions.filter(goalId)`. Vínculo retroativo não gera espelho. O texto do formulário afirma que "o saldo é calculado somando os investimentos vinculados abaixo" | A tela declara uma origem do número que não é a real e exibe "Nenhum investimento vinculado ainda" com progresso > 0 | Alimentar a lista por `investment_movements`/`investment_positions` quando a flag está ligada e corrigir o texto | E2E de vínculo retroativo verificando lista e progresso |
| INV-P2-030 | Trigger de transações recompõe meta com query sem `limit` dentro da transação | [triggers/transactions.ts:33-35](../../functions/src/triggers/transactions.ts#L33-L35) | `where('goalId','==',goalId)` sem `limit` nem `orderBy`, lida dentro de `runTransaction`. O caminho equivalente de callable impõe teto de 2001 (`goals/operations.ts:204-209`) | Custo O(histórico da meta) por escrita, e estouro de transação em metas antigas | Aplicar o mesmo teto com falha explícita | Integração com fixture acima do teto |
| INV-P2-031 | Nenhuma callable de investimento tem limite de frequência | [callables.ts:74-106](../../functions/src/investments/callables.ts#L74-L106) vs [ai/callables.ts:115](../../functions/src/ai/callables.ts#L115) | `shared/rateLimit.ts` existe, é testado e é usado apenas pela IA. As 24 callables de investimento, incluindo rebuild, backfill e migração, não o consomem | Um membro autenticado dispara varreduras de workspace inteiro em laço; combinado com INV-P2-039, gera documentos ilimitados | Aplicar `consumeRateLimit` no wrapper das 24 callables, com política por classe de operação | Integração de limite por operação, como já existe para IA |
| INV-P2-032 | Hard delete de transações pelo cliente | [transactions/api.ts:317-318](../../src/modules/transactions/api.ts#L317-L318), [firestore.rules:891-901](../../firestore.rules#L891-L901) | `deleteDoc(docRef)` para tudo que não é resgate; as Rules permitem delete quando não há `goalId`, `investmentMetadata` nem campos de resgate | Contraria o invariante de `AGENTS.md`. Uma transação legada migrada (que não tem `investmentMetadata`) pode ser apagada, quebrando a reconciliação para sempre | Substituir por cancelamento/estorno com preservação; negar delete nas Rules | Rules test negando delete; integração de reconciliação após tentativa |
| INV-P2-033 | `listGoals` usa `limit(100)` sem `orderBy` e filtra arquivadas depois do limite | [goals/api.ts:35-48](../../src/modules/goals/api.ts#L35-L48) | `getDocs(query(col, limit(100)))` e `.filter(goal => goal.archived !== true)` no cliente | Acima de 100 metas, ou com muitas arquivadas nas 100 primeiras por ID, metas ativas somem sem aviso | `where('archived','!=',true)` com `orderBy` e paginação | Teste com 120 metas, metade arquivadas |
| INV-P2-034 | `listSettingsCatalog` lê a coleção inteira | [settings-catalog/api.ts:84-99](../../src/modules/settings-catalog/api.ts#L84-L99), [hooks.ts:67](../../src/modules/settings-catalog/hooks.ts#L67) | `getDocs(collection)` sem filtro; grupo filtrado no cliente. Existe caminho paginado no mesmo arquivo (`:111-124`) que o hook não usa. O onboarding de investimentos semeia 6 grupos novos | Custo de leitura cresce com o catálogo, agravado por este marco | Usar o caminho paginado por grupo | Teste que asserte `where('group','==',…)` e `limit` |
| INV-P2-035 | Dashboard dispara duas cargas independentes do domínio patrimonial | [App.tsx:584](../../src/App.tsx#L584), [:592](../../src/App.tsx#L592), [ReportsWidget.tsx:17](../../src/components/ReportsWidget.tsx#L17) | `InvestmentDashboardOverview` usa `includeAllocations: false` (2 leituras); `ReportsWidget` chama o snapshot completo, com 8 queries de alocação que ele nunca exibe | 12 leituras do domínio patrimonial no carregamento do dashboard, 8 delas descartadas | Compartilhar a query, ou passar `includeAllocations: false` no widget | Teste que conte as queries emitidas na montagem do dashboard |
| INV-P2-036 | `creditCards/observability.ts` registra o objeto de erro cru | [creditCards/observability.ts:287-291](../../functions/src/creditCards/observability.ts#L287-L291), [:192-197](../../functions/src/creditCards/observability.ts#L192-L197) | `console.error(..., {observabilityError})` despeja o erro inteiro, que pode carregar payload e valor do request. É o padrão que `investments/observability.ts:218-223` corrigiu e que o ExecPlan declara resolvido em M8.D | Valor monetário e conteúdo de request em Cloud Logging | Registrar só código, operação e correlação | Teste de log sanitizado, como o de investimentos |
| INV-P2-037 | `acceptSplitGroupInvite` sem verificação de membership de workspace | [callables/splitGroups.ts:90-158](../../functions/src/callables/splitGroups.ts#L90-L158), [:58](../../functions/src/callables/splitGroups.ts#L58) | Verifica só `request.auth`; não chama `requireWorkspaceRole`. Escreve com Admin SDK em `workspaces/{alheio}/split_participants`. Código gerado por `Math.random().toString(36).substring(2,8)` — PRNG não criptográfico, espaço reduzido, sem limite de frequência | Escrita cross-tenant por predição/força bruta de código de convite | Gerar o código com `crypto.randomBytes`, aplicar limite de frequência e validar o convite antes de qualquer escrita | Integração de força bruta e de convite inválido |
| INV-P2-038 | `createCheckoutSession` sem validação de `priceId` e `returnUrl` | [callables/billing.ts:9-35](../../functions/src/callables/billing.ts#L9-L35), [webhooks/stripe.ts:34-45](../../functions/src/webhooks/stripe.ts#L34-L45) | Sem schema Zod, sem allowlist de preços, sem verificação de domínio no `returnUrl`; o webhook concede `pro` para qualquer `checkout.session.completed`, sem conferir o preço pago | Checkout com preço arbitrário e redirecionamento para host controlado pelo atacante | Allowlist de `priceId`, validação de domínio no `returnUrl`, conferência do preço no webhook | Integração com `priceId` fora da allowlist |
| INV-P2-039 | Chave de idempotência crua exposta no caminho de falha, e documentos de evento ilimitados por `correlationId` | [investments/observability.ts:75](../../functions/src/investments/observability.ts#L75), [:154](../../functions/src/investments/observability.ts#L154), [:186](../../functions/src/investments/observability.ts#L186), [firestore.rules:1053-1082](../../firestore.rules#L1053-L1082) | O caminho de **sucesso** está correto: `recordInvestmentEvent` grava `idempotencyKeyId: reservation.ref.id` ([infrastructure.ts:278](../../functions/src/investments/infrastructure.ts#L278)), que já é derivado. Quem vaza a chave **crua** do cliente são apenas `observability.ts:75` (`lastIdempotencyKey` em `investment_operational_metrics`) e `observability.ts:186` (`idempotencyKeyId` em `investment_event_logs`, no handler de falha) — ambas coleções legíveis por owner/admin. O mesmo handler deriva o `eventId` do `correlationId` do cliente (`:154`) | O invariante testado ("chaves de idempotência nunca são legíveis") vale só para `investment_idempotency_keys`; e um membro gera documentos ilimitados variando o `correlationId` | Nas duas linhas de `observability.ts`, gravar o id derivado em vez da chave crua; derivar o `eventId` de valor controlado pelo servidor | Rules test que cubra as três coleções; integração de crescimento por `correlationId` |
| INV-P2-040 | Snapshot de rebuild cresce sem teto dentro de um documento | [projectionRebuild.ts:529-571](../../functions/src/investments/projectionRebuild.ts#L529-L571), [:57-58](../../functions/src/investments/projectionRebuild.ts#L57-L58), [:392-398](../../functions/src/investments/projectionRebuild.ts#L392-L398) | `periods` (com mapa `daily`) e `allocations` (uma entrada por ativo e por conta) são persistidos inteiros e reescritos a cada página. O guarda conta **meses**, nunca buckets diários; `MAX_REPORT_PERIODS = 240` × ~31 dias × 9 campos ≈ 67.000 campos | Workspace grande estoura o limite de 1 MiB no meio do rebuild e fica sem caminho de reconstrução; custo de escrita O(n²) ao longo da execução | Limitar por tamanho estimado do snapshot, ou fatiar o acumulador em documentos | Integração com fixture de vários anos de movimentos diários |
| INV-P2-041 | Sem TTL nas coleções que crescem por mutação | `firestore.indexes.json` (0 `fieldOverrides`), `firebase.json` | `investment_idempotency_keys`, `investment_event_logs`, `investment_operational_metrics` e `activity_logs` crescem para sempre; `activity_logs` guarda `before`/`after` completos ([triggers/transactions.ts:90-104](../../functions/src/triggers/transactions.ts#L90-L104)) | Custo de armazenamento crescente; duplicação integral do conteúdo financeiro numa coleção legível por qualquer membro | TTL nas chaves de idempotência (janela de retry) e política de retenção nos logs; reduzir o payload de `activity_logs` | Verificação de configuração no gate de deploy |
| INV-P2-042 | Nenhuma função declara região: funções em `us-central1`, Firestore em `southamerica-east1` | `grep -rn "setGlobalOptions\|region:" functions/src` = 0; [firebase.json:4](../../firebase.json) | Callables v2 sem região são implantadas em `us-central1` | Cada uma das ~10 leituras e ~17 escritas de um aporte atravessa o continente dentro da janela de trava pessimista, aumentando latência, contenção e egress | `setGlobalOptions({region: "southamerica-east1"})` | Verificação de configuração no gate; smoke de latência pós-deploy |
| INV-P2-043 | Migração sem lease: execuções concorrentes inflam os totais | [legacyMigration.ts:378-560](../../functions/src/investments/legacyMigration.ts#L378-L560) vs [backfill.ts:149-175](../../functions/src/investments/backfill.ts#L149-L175) | O backfill tem lease de 10 minutos; a migração não tem nenhum | Duas invocações simultâneas processam páginas sobrepostas e somam `migrationTotals` duas vezes, corrompendo o insumo da reconciliação | Aplicar o mesmo lease do backfill | Integração com duas execuções concorrentes |
| INV-P2-044 | Suíte de integração não determinística sob concorrência | `functions/lib/goals/__tests__/goalIntegrity.integration.test.js:88`, [goals/operations.ts:503-518](../../functions/src/goals/operations.ts#L503-L518), [functions/package.json:6](../../functions/package.json) | `not ok 19 … 3 INVALID_ARGUMENT: Transaction is invalid or closed` numa execução de 73 testes; 3/3 aprovado com o arquivo isolado. `node --test "lib/**/*.integration.test.js"` executa arquivos em paralelo contra o mesmo Emulator | O gate reprova de forma intermitente e o operador não distingue regressão de flake | `--test-concurrency=1` na suíte de integração, ou isolamento de workspace por arquivo | Reexecução repetida da suíte completa assertando estabilidade |
| INV-P2-045 | "Outros" da alocação é calculado sobre 10 itens, só 5 são exibidos, e a própria linha "Outros" nunca aparece | [readApi.ts:123](../../src/modules/investments/persistence/readApi.ts#L123), [reports/investments.ts:81-96](../../src/modules/reports/investments.ts#L81-L96), [ReportsOverview.tsx:215-223](../../src/components/ReportsOverview.tsx#L215-L223) | `ALLOCATION_LIMIT = 10`; "Outros" é calculado sobre os 10 e **empilhado no índice 10** do array; a tela renderiza `slice(0, 5)`, então quando a dimensão está truncada somem **6 linhas** — as 5 menores mais a própria linha "Outros" — enquanto a legenda afirma que "os menores valores foram agrupados em Outros" | 6 linhas somem sem aviso, os percentuais exibidos não somam 100% e o texto anuncia um agrupamento cuja linha é invisível | Alinhar o limite exibido ao limite calculado, ou recalcular "Outros" sobre o recorte exibido e garantir que ele seja renderizado | Teste de componente com 12 faixas assertando presença da linha "Outros" |
| INV-P2-046 | Indicadores de tendência fabricados apresentados como comparação real | [AllocationAnalysis.tsx:29](../../src/components/AllocationAnalysis.tsx#L29), [:76-78](../../src/components/AllocationAnalysis.tsx#L76-L78), [business-allocations/logic.ts:118](../../src/modules/business-allocations/logic.ts#L118) | `const prevPercentage = 22.5;` com o comentário "Simulate previous period comparison"; `trends: { …, margin: 'up' } // Mock de tendências` | Número financeiro inventado exibido ao usuário como "X% melhor que período anterior", com seta de direção | Calcular a comparação a partir de dados reais, ou remover o indicador | Teste que asserte a origem do valor comparativo |
| INV-P2-047 | `positionCount` nunca decrementa: métrica de deriva permanentemente falsa | [operationsV2.ts:365](../../functions/src/investments/operationsV2.ts#L365), [projectionRebuild.ts:269](../../functions/src/investments/projectionRebuild.ts#L269), [:818-853](../../functions/src/investments/projectionRebuild.ts#L818-L853) | `FieldValue.increment(snapshot.exists ? 0 : 1)` conta a criação do documento; o rebuild conta apenas posições com exposição | Toda posição 100% resgatada produz `drift.positionCount` não nulo para sempre, tornando a métrica de deriva pouco confiável | Decrementar quando a posição perde exposição, ou contar por exposição nos dois caminhos | Integração: resgatar 100%, reconstruir e assertar deriva zero |
| INV-P2-048 | Recorte de janela do relatório usa UTC enquanto o domínio materializa em `America/Sao_Paulo` | [reports/investments.ts:6-19](../../src/modules/reports/investments.ts#L6-L19) vs [shared/dateKeys.ts:21-25](../../functions/src/shared/dateKeys.ts#L21-L25) | `rangeStart()` usa `setUTCDate`/`setUTCFullYear`/`setUTCMonth`; as chaves `period` e `daily` são gravadas com `saoPauloMonthKey`/`saoPauloDayKey`. Entre 21:00 e 23:59 BRT o `new Date()` já está no dia UTC seguinte, e o filtro `day >= start` descarta o bucket mais antigo | A janela `7d` começa em D−5 local em vez de D−6 e `30d` perde um dia; na virada de mês o corte desloca um mês inteiro. Os testes existentes são tautológicos: `tests/unit/investment-reporting.test.ts:96-98` e `:123-126` constroem as fixtures com o mesmo `setUTCDate` da produção, então concordam em qualquer fuso | Derivar o início da janela com `saoPauloDayKey`/`saoPauloMonthKey`, os mesmos usados na escrita | Teste unitário com instante às 22:00 BRT do último dia do mês, assertando o mesmo recorte que às 10:00 BRT |
| INV-P2-049 | `allow update` de `transactions` opera no teto de 1.000 avaliações de expressão das Rules | [firestore.rules:862-887](../../firestore.rules#L862-L887), [:100-124](../../firestore.rules#L100-L124), [:85-94](../../firestore.rules#L85-L94) | Observado no Emulator (§24): `Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'update' @ L863`, durante um `set()` sobre documento inexistente — que faz o motor avaliar `create` **e** `update`. Os dois ramos de `allow update` encadeiam `isCommonValidTransactionPayload` (24 subexpressões, 14 delas `keys().hasAny([...])`) mais `changesOnlyMutableTransactionKeys()` | Quando o teto é atingido a regra **nega**. Não há evidência de negação em edição normal — o `updateDoc` de dois campos da reprodução passou —, mas a margem é mínima e **qualquer predicado novo naquela regra pode negar escritas legítimas em produção**. Contraindica diretamente a correção alternativa de INV-P1-002 | Reduzir o custo da regra antes de acrescentar qualquer predicado: extrair a validação comum, trocar as 14 chamadas `keys().hasAny` por um único `keys().hasOnly` já presente no `create`, ou mover a validação de payload para o backend | Rules test que exercite `updateDoc` com payload máximo (todas as chaves mutáveis) e asserte aceitação; medir a margem reexecutando o cenário de `set()` |

### P3 — melhorias (não bloqueiam produção)

| ID | Título | Arquivo:linha | Impacto |
| -- | ------ | ------------- | ------- |
| INV-P3-050 | Nomes de conta e ativo nas posições só resolvem os 20 registros ativos carregados; ativo arquivado nunca resolve e a tabela exibe fragmentos de ID | [InvestmentsPortfolioView.tsx:71-72](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L71-L72), [:225](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L225) | Legibilidade |
| INV-P3-051 | Liquidação parcial sobrescreve `principalCents`/`quantityMicros` do movimento com o valor liquidado; o pedido residual não gera novo pendente | [operationsV2.ts:1075-1079](../../functions/src/investments/operationsV2.ts#L1075-L1079) | Perde o valor originalmente solicitado; obriga novo pedido manual |
| INV-P3-052 | Quatro operações sem revalidação de papel dentro da transação (`saveInvestmentRedemption`, `cancelInvestmentRedemption`, `reverseInvestmentRedemption`, `backfillInvestmentWorkspace`) | [writeStrategy.ts](../../functions/src/investments/writeStrategy.ts) (`revalidatesRoleInTransaction: false`) | Janela TOCTOU estreita entre o gate do wrapper e o commit |
| INV-P3-053 | `workspaces` e `members` sem `hasOnly`; `transactions` sem teto numérico e sem tamanho máximo de string | [firestore.rules:792-803](../../firestore.rules#L792-L803), [:816-832](../../firestore.rules#L816-L832), [:100-124](../../firestore.rules#L100-L124) | Campos arbitrários e valores sem limite; contrasta com o rigor do domínio de investimentos |
| INV-P3-054 | `.gitignore` da raiz cobre `*.local` mas não `.env` nem `.env.production` | `.gitignore` | Um `.env` criado no futuro na raiz seria commitado. `functions/lib/` **não** está versionado — `functions/.gitignore:2` ignora `lib/**/*.js` e `git ls-files functions/lib` devolve 0 |
| INV-P3-055 | Índice órfão `transactions [userId, date, __name__]` sem consulta correspondente | `firestore.indexes.json` | Custo de escrita sem leitor |
| INV-P3-056 | Abas de Relatórios com `role="tab"` sem `id`, `aria-controls`, `tabpanel` nem foco itinerante | [ReportsView.tsx:82-128](../../src/components/ReportsView.tsx#L82-L128) | Leitor de tela anuncia navegação por setas inexistente; o padrão correto já existe nas telas novas |
| INV-P3-057 | `window.confirm` para inativação na tela patrimonial, enquanto Cadastros usa `<dialog>` | [InvestmentsPortfolioView.tsx:164](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L164) | Duas superfícies do mesmo domínio divergem em acessibilidade |
| INV-P3-058 | `notice` de sucesso não é limpo ao trocar de aba ou de editor | [InvestmentsPortfolioView.tsx:53](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L53), [:197](../../src/modules/investments/components/InvestmentsPortfolioView.tsx#L197) | "Operação concluída com sucesso" persiste sobre uma aba onde a próxima ação falhou |

**Contagem:** P0 = 1 · P1 = 13 · P2 = 35 · P3 = 9 · **total 58**.

---

## 20. Dívida técnica real

Apenas o que afeta segurança, escala, custo, confiabilidade, manutenção ou evolução.

| Dívida | Dimensão afetada | Consequência |
| --- | --- | --- |
| `getTransactions` sem paginação alimenta quatro superfícies | Escala, custo | Bloqueia crescimento de tenant; INV-P1-011 |
| Cálculo de KPIs, fluxo de caixa e alocação no cliente sobre arrays completos | Escala, consistência | Impede recortar período no servidor e mantém fontes concorrentes; §11.1 |
| Ausência de CI (`.github` inexistente) | Confiabilidade | Nada impede um commit com testes vermelhos; o gate é inteiramente manual |
| Toolchain local Node 22 × `engines: node 24` | Confiabilidade | Divergência entre o runtime testado e o implantado, nunca exercitada |
| Nenhum script de deploy executa a suíte de Rules | Segurança | `deploy:safe` roda apenas `build` + unitários de Functions (`predeploy:check`), e **`deploy:firestore` (`package.json:20`) publica `firestore.rules` e os índices sem hook nenhum** — nem build, nem unitários, nem as 54 asserções de isolamento |
| `lint` existe e não está em nenhum gate | Manutenção | Regras de estilo e de importação não são aplicadas |
| Nenhuma função declara região | Custo, performance | Latência transcontinental por leitura e escrita; INV-P2-042 |
| Nenhuma callable declara `timeoutSeconds`, `memory` ou `maxInstances` | Confiabilidade, custo | Backfill e rebuild morrem no timeout padrão deixando estado parcial; sem teto de instâncias |
| Sem TTL nem retenção nas coleções operacionais | Custo | Crescimento indefinido de chaves de idempotência, eventos, métricas e `activity_logs` |
| `activity_logs` duplica `before`/`after` completos de toda transação | Custo, privacidade | Segunda cópia integral do conteúdo financeiro numa coleção legível por qualquer membro |
| `InvestmentEntityForm.tsx` é código morto que duplica dois formulários vivos | Manutenção | O arquivo declara existir para impedir divergência entre as duas superfícies; a divergência já existe |
| `@google/genai` e `@google/generative-ai` como dependências de runtime do frontend, sem import | Manutenção, superfície | Dependências órfãs após a migração da IA para o backend |
| Reconciliação da migração usa o mesmo classificador nos dois lados | Confiabilidade | A igualdade prova coerência interna, não correção — mitigado por `unclassifiedCount`, mas não por INV-P1-010 |
| Cobertura de teste ausente em valoração E2E, reversão em Rules e E2E, e todo o comportamento das callables de IA | Confiabilidade | Regressões nessas superfícies passam despercebidas |

---

## 21. Plano obrigatório antes de produção

### Etapa 1 — P0

1. **INV-P0-001** — aplicar em `creditCards/observability.ts` o padrão de
   `authorizedWorkspaceId` já implementado em investimentos.
   *Dependências:* nenhuma. *Risco:* baixo (mudança local no caminho de erro), mas 15 arquivos de
   `functions/src/investments/` importam de `creditCards/` (§8.6), então a suíte de investimentos
   entra no aceite.
   *Aceite:* teste de integração provando que chamada anônima com `workspaceId` alheio não cria
   documento algum em `credit_card_operational_metrics`, `financial_events` nem `notifications`.

### Etapa 2 — P1 (ordem sugerida, por dependência)

2. **INV-P1-014** — commitar o domínio em incrementos revisáveis.
   *Dependências:* nenhuma; é pré-requisito de todas as demais.
   *Risco:* nulo. *Aceite:* `git status --short` limpo, `verify:fast` verde por commit.
3. **INV-P1-002** — aplicar `isLegacyInvestmentWriteAllowed` nos dois ramos de `allow update`.
   *Dependências:* nenhuma. *Risco:* baixo. *Aceite:* o Rules test novo rejeita o `update` para
   owner, admin e member, e a reprodução do §24 passa a falhar.
4. **INV-P1-013** — fechar `users/{uid}` com `hasOnly`, negando `planId`/`isPro`.
   *Dependências:* nenhuma. *Risco:* médio (verificar que o app não escreve esses campos).
   *Aceite:* Rules test de negação; smoke de perfil e de plano.
5. **INV-P1-004** — chave de idempotência estável por intenção no frontend.
   *Dependências:* nenhuma. *Risco:* baixo. *Aceite:* E2E de duplo clique em aporte gerando um
   único movimento.
6. **INV-P1-009** — admitir resultado realizado com sinal e a invariante
   `quantidade 0 ⇒ principal 0`. *Dependências:* muda contrato, Rules e série mensal; exige
   reconstrução das projeções dos workspaces já valorados. *Risco:* alto.
   *Aceite:* integração de resgate abaixo do custo com reconstrução idêntica.
7. **INV-P1-005** — fluxo cronológico único de movimentos e valorações no rebuild (M8.B).
   *Dependências:* item 6, para não materializar duas vezes a mudança de contrato.
   *Risco:* alto. *Aceite:* rebuild com valorações reproduz o caminho incremental, é idempotente
   e retomável.
8. **INV-P1-010** — excluir o espelho V2 na classificação da migração.
   *Dependências:* nenhuma. *Risco:* baixo.
   *Aceite:* integração com aporte V2 pré-existente sem duplicação de principal.
9. **INV-P1-003** — separar o checkpoint de dry-run do de aplicação.
   *Dependências:* nenhuma. *Risco:* baixo.
   *Aceite:* dry-run completo seguido de aplicação real migra todas as linhas e reconcilia.
10. **INV-P1-012** — rollback com lançamento compensatório e reabertura do checkpoint.
    *Dependências:* itens 8 e 9. *Risco:* médio.
    *Aceite:* migrar → rollback → posições zeradas, histórico preservado → remigrar com sucesso.
11. **INV-P1-006** — superfície operacional para migração, rollback, flag, rebuild e valoração.
    *Dependências:* itens 5, 8, 9, 10. *Risco:* médio.
    *Aceite:* E2E de migração ponta a ponta pela superfície, e E2E de rollback.
12. **INV-P1-007** — expor registro de valoração no produto.
    *Dependências:* item 5 (para que a série continue reconstrutível). *Risco:* médio.
    *Aceite:* E2E com patrimônio ≠ custo e ganho não realizado ≠ 0.
13. **INV-P1-008** — seção de alocação PF/PJ na tela patrimonial, alimentada por
    `investment_allocation_summaries`. *Dependências:* nenhuma. *Risco:* médio.
    *Aceite:* E2E PF e E2E PJ com totais coerentes com o resumo.
14. **INV-P1-011** — paginar `getTransactions` com filtro de período no servidor.
    *Dependências:* revisar todos os consumidores. *Risco:* alto (toca dashboard, relatórios,
    metas e alocações). *Aceite:* nenhuma query sem `limit` no caminho principal; smoke de
    regressão nos quatro consumidores.

### Etapa 3 — P2 necessários antes do rollout controlado

| Item | Motivo de ser pré-requisito | Aceite |
| --- | --- | --- |
| INV-P2-020 | Sem `secrets`, a IA falha 100% em produção | Smoke pós-deploy das duas callables |
| INV-P2-016 | Duas fórmulas de patrimônio na mesma sessão | Dashboard e relatório concordam para todo mês |
| INV-P2-024 | KPIs de fontes mistas na mesma tela | Poupança e caixa coerentes com a fonte oficial |
| INV-P2-025 | Cadastro órfão com a flag desligada | E2E sem a seção quando a flag está desligada |
| INV-P2-028 | Duplo submit e "Alterar meta" quebrado | E2E de duplo clique e de troca de meta |
| INV-P2-019 | Sem detecção de deriva não há como observar o rollout | Cron emitindo métrica e evento |
| INV-P2-021 | Flag pode ser ligada sobre lote em dry-run | Pré-condição de snapshot verificada |
| INV-P2-031 | Rebuild e migração sem limite de frequência | Limite por classe de operação |
| INV-P2-032 | Hard delete quebra a reconciliação da migração | Rules negando delete |
| INV-P2-042 | Latência transcontinental em toda transação | Região declarada e smoke de latência |
| INV-P2-044 | Gate não determinístico impede aprovar o release | Suíte estável em execuções repetidas |
| INV-P2-049 | A regra de `update` de `transactions` está no teto de avaliação, e a correção de INV-P1-002 depende disso | Rules test com payload máximo aceito, e margem medida |
| INV-P2-048 | Janela de relatório desloca o recorte na virada do dia e do mês | Teste com instante às 22:00 BRT |

### Etapa 4 — validações finais

1. `npm run verify:fast` verde.
2. `npm run test:integration:emulator` verde, executado **três vezes consecutivas** sem falha.
3. `npm run test:e2e` verde na suíte completa, sem flake de renderer.
4. Suíte de Rules incluída em **todos** os caminhos de deploy — `deploy:safe` e `deploy:firestore` — e verde.
5. Reproduções do §24 reexecutadas e **falhando** (ou seja, o defeito não reproduz mais).
6. Smoke de regressão em receitas, despesas, parceladas, recorrências, cartões, metas,
   relatórios, dashboard, Configurações, wallets, alocações, autenticação e troca de workspace,
   com a flag desligada e com a flag ligada.
7. Skill `regression-release-gate` executada com decisão PASS registrada.

---

## 22. Checklist de produção

- `[x]` Domínio: representação monetária exata em centavos e micros, sem ponto flutuante autoritativo
- `[x]` Domínio: `pending`/`cancelled` com deltas zero, impostos em três camadas independentes
- `[x]` Domínio: reversão compensatória preserva o evento original
- `[x]` Domínio: valoração não gera fluxo de caixa
- `[!]` Domínio: perda realizada representável (INV-P1-009)
- `[x]` Datas: chaves de período determinísticas em `America/Sao_Paulo`, com teste de DST
- `[ ]` Datas: recorte de janela do frontend no mesmo fuso do domínio (INV-P2-048)
- `[!]` Segurança: nenhuma escrita cross-tenant (INV-P0-001)
- `[!]` Segurança: entitlement não forjável pelo cliente (INV-P1-013)
- `[x]` Segurança: nenhum segredo versionado; chave de IA fora do bundle, com teste-guarda
- `[x]` Segurança: logs do domínio sanitizados, sem PII nem valor monetário
- `[x]` Rules: 14 coleções `investment_*` com `write: if false` (13 do domínio V2 + `investment_audit_logs` legado)
- `[x]` Rules: sem wildcard recursivo; catch-all nega escrita e leitura por prefixo
- `[x]` Rules: `list` com teto de 100 no domínio de investimentos
- `[!]` Rules: trilha legada fechada com a flag ligada, também no `update` (INV-P1-002)
- `[ ]` Rules: `allow update` de `transactions` com margem no teto de 1.000 avaliações (INV-P2-049)
- `[ ]` Rules: suíte de Rules em todos os caminhos de deploy, inclusive `deploy:firestore`
- `[x]` Índices: toda query composta do domínio tem índice declarado
- `[x]` Idempotência: reserva e conclusão atômicas na mesma transação, com `requestHash`
- `[!]` Idempotência: chave estável no retry do cliente (INV-P1-004)
- `[ ]` Idempotência: limite de frequência nas callables de investimento (INV-P2-031)
- `[x]` Concorrência: leituras antes de escritas; posição nunca negativa; testes de replay e de corrida
- `[ ]` Concorrência: rebuild retomável sob escrita concorrente (INV-P2-018)
- `[x]` Reconciliação: `movements → positions` reconstrutível e testada
- `[!]` Reconciliação: `movements + valuations → report periods` reconstrutível (INV-P1-005)
- `[x]` Reconciliação: reconstrução independente da janela consultada, no relatório
- `[ ]` Reconciliação: deriva observável sem rebuild (INV-P2-019)
- `[x]` Migração: dry-run, checkpoint cronológico, resume, idempotência, conferência por `count()`
- `[!]` Migração: dry-run isolado da aplicação (INV-P1-003)
- `[!]` Migração: espelho V2 excluído da classificação (INV-P1-010)
- `[!]` Rollback: compensação e reabertura do checkpoint (INV-P1-012)
- `[!]` Operação: superfície executável para migrar, reverter, ligar a flag e reconstruir (INV-P1-006)
- `[x]` Observabilidade: trilha de auditoria responde quem/quando/onde/o quê/correlação/resultado
- `[ ]` Observabilidade: métrica, alerta e log estruturado fora do Firestore
- `[x]` Builds: `tsc --noEmit`, `vite build` e build de Functions verdes
- `[x]` Testes: 71 unit de Functions e 16 unit de frontend verdes, sem skip
- `[x]` Testes: 54 asserções de Rules verdes, cobrindo cross-tenant nos dois sentidos
- `[!]` Testes: suíte de integração determinística (INV-P2-044)
- `[!]` E2E: suíte completa verde sem flake
- `[ ]` E2E: valoração, reversão, rebuild, migração, RBAC de investimentos e alocação PF/PJ
- `[x]` Feature flag: única chave de fonte; `features` imutável pelo cliente; legado preservado com `false`
- `[!]` Feature flag: rollback por flag realmente reverte (INV-P1-012)
- `[x]` Smoke legado: E2E prova experiência legada preservada com a flag desligada
- `[!]` Smoke legado: alocação PF/PJ preservada com a flag ligada (INV-P1-008)
- `[x]` pt-BR: toda a superfície nova em português, terminologia financeira correta
- `[x]` pt-BR: nenhuma mensagem técnica de Firebase/Firestore/callable vaza para a tela
- `[x]` Acessibilidade: modais com foco preso e abas com ARIA completo nas telas novas
- `[ ]` Acessibilidade: abas de Relatórios e confirmação por `<dialog>` na tela patrimonial
- `[!]` Continuidade: código commitado e com caminho de `revert` (INV-P1-014)

---

## 23. Critério de GO/NO-GO

**NO-GO.** As condições que hoje impedem produção, em ordem de bloqueio:

1. **Escrita cross-tenant por chamador não autenticado** (INV-P0-001). Qualquer P0 é veto
   absoluto, e este é explorável sem credencial.
2. **Treze P1 abertos**, dos quais dois reproduzidos nesta auditoria (INV-P1-002 e INV-P1-003).
3. **Migração não é segura pelo caminho padrão** (INV-P1-003, INV-P1-010) e **não tem rollback
   efetivo** (INV-P1-012).
4. **Operação não é executável**: não existe superfície para migrar, reverter, ligar a flag,
   reconstruir ou valorar (INV-P1-006).
5. **Cálculo financeiro sem reconciliação possível** em workspaces valorados (INV-P1-005), e
   **cenário financeiro comum sem representação** (INV-P1-009).
6. **Operação crítica não idempotente na prática** (INV-P1-004).
7. **Full scan impeditivo no fluxo principal** (INV-P1-011).
8. **Gate não pode ser declarado verde**: `test:integration:emulator` e `test:e2e` terminaram com
   exit code 1 nesta auditoria; nos contornos, produziram uma falha cada.
9. **Testes críticos inexistentes** para os quatro defeitos reproduzidos ou confirmados
   (bypass por `update`, dry-run→apply, espelho V2 na migração, escrita não autenticada).
10. **Código não commitado**: sem caminho de deploy nem de `revert` (INV-P1-014).

`PRONTO PARA ROLLOUT CONTROLADO` só poderá ser declarado quando P0 = 0, P1 = 0, a migração for
segura e reversível, o E2E crítico passar de forma estável, a observabilidade permitir detectar
regressões (INV-P2-019) e a flag realmente reverter o efeito.

---

## 24. Evidências técnicas

### Comandos executados

| Comando | Resultado | Evidência |
| --- | --- | --- |
| `npm run typecheck` | **PASS** | dentro de `verify:fast`, exit 0 |
| `npm run build` | **PASS** | `✓ 12145 modules transformed`, `✓ built in 48.25s`; warnings pré-existentes de import dinâmico/estático, exports de ícones e bundle > 500 kB |
| `npm run functions:build` | **PASS** | `tsc` sem erro |
| `npm run functions:test:unit` | **PASS** | `# tests 71 / # pass 71 / # fail 0 / # skipped 0` |
| `npm run test:unit:investments` | **PASS** | `# tests 16 / # pass 16 / # fail 0 / # skipped 0` |
| `npm run verify:fast` | **PASS** | `EXIT=0` |
| `npm run test:integration:emulator` | **BLOQUEADO PELO AMBIENTE** | `Error: Could not start Firestore Emulator, port taken.` — Emulator órfão (PPID=1) na porta 8080 |
| `npm run functions:test:integration:emulator` (contorno, Emulator já ativo) | **FALHOU (1 de 73)** | `not ok 19 - aporte pré-vinculado, vínculo retroativo, pending, retry, concorrência e arquivamento` → `3 INVALID_ARGUMENT: Transaction is invalid or closed.` |
| `node --test lib/goals/__tests__/goalIntegrity.integration.test.js` ×3 (isolado) | **PASS 3/3** | `# pass 3 / # fail 0` em cada execução → falha intermitente |
| 5 suítes de Rules com Auth + Firestore Emulator | **PASS** | `5 + 7 + 14 + 7 + 21 = 54` casos, `# fail 0`, `# skipped 0` |
| `npm run test:e2e` | **BLOQUEADO PELO AMBIENTE** | `Error: Process from config.webServer was not able to start. Exit code: 1` (mesma porta ocupada) |
| `npm run test:e2e:clean` (script do próprio repositório) | **FALHOU (1 de 15)** | `✘ 15 investments-v2.spec.ts:229` → `Error: page.goto: Page crashed`; `1 failed / 14 passed (3.6m)` |
| `npx playwright test e2e/investments-v2.spec.ts` (isolado) | **PASS 6/6** | `6 passed (1.8m)` → crash de renderer por memória, não defeito de código |
| `git status --short`, `git diff --stat HEAD`, `git log --oneline` | executados | 24 arquivos `??` com 8.828 linhas; 52 arquivos modificados, +4.194/−553; `origin/main` em `3397493` |

**Nenhum comando de deploy, push, merge ou migração real foi executado. Nenhum acesso a Firebase
de produção.**

### Reprodução 1 — bypass da trilha legada por `update` (INV-P1-002)

Script descartável fora do repositório, executado com
`firebase emulators:exec --only auth,firestore --project minhas-financas-local`, com
`firestore.rules` carregado. Workspace com `features.investmentsV2.enabled = true`, ator com
papel `member`.

```json
{
  "flagV2Ligada": true,
  "createDiretoDeInvestimentoBloqueado": true,
  "updateDeTipoParaInvestimentoPermitido": true,
  "erroDoUpdate": null,
  "tipoPersistido": "investimento",
  "valorPersistido": 1000
}
```

O `create` direto de `type: 'investimento'` é negado, como o M4 pretendia. O `update` de uma
`despesa` para `investimento` é **aceito**, e o documento persiste com o tipo trocado.

O Emulator emitiu, na mesma requisição, um diagnóstico que virou finding próprio (INV-P2-049):
```
evaluation error at L848:11 for 'create' @ L848, false for 'create' @ L1217,
Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'update' @ L863,
Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'update' @ L1217
```
A avaliação do **`allow update` de `transactions` (L863)** esgotou o teto de 1.000 expressões das
Rules durante o `set()` sobre documento inexistente — que faz o motor avaliar as cláusulas de
`create` **e** de `update`. O `updateDoc` de dois campos da reprodução acima foi avaliado dentro
do orçamento e passou, então **não há evidência de que edições legítimas estejam sendo negadas
hoje**; o que há é evidência de que a regra opera na borda do teto. Isso contraindica a correção
que adicionaria mais predicados ali — ver INV-P1-002 e INV-P2-049.

### Reprodução 2 — dry-run bloqueia a migração real (INV-P1-003)

Script descartável fora do repositório, executado com
`firebase emulators:exec --only firestore`, chamando `executeMigrateLegacyInvestments` e
`reconcileLegacyMigration` do build em `functions/lib`. Workspace sintético com dois aportes
legados somando R$ 1.500,00, `pageSize: 1`, `migrationId` **não informado** (comportamento
padrão).

```json
{
  "dryRun":        { "completed": true, "scanned": 2, "migrated": 0 },
  "execucaoReal":  { "completed": true, "scanned": 2, "migrated": 0 },
  "movimentosNoDominio": 0,
  "posicoesNoDominio": 0,
  "reconciliacao": { "legacy": 150000, "dominio": 0, "reconciled": false }
}
```

A execução real reporta `completed: true` e migra **zero** movimentos. A reconciliação falha
fechada, o que impede ligar a flag sobre patrimônio vazio — mas o operador recebe uma recusa
sem causa aparente, e o workspace fica bloqueado para migrar pelo `migrationId` padrão.

### Verificações estáticas decisivas

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Superfície operacional das callables críticas | `grep -rn "migrateLegacyInvestments\|rollbackLegacyInvestmentMigration\|enableInvestmentsV2Flag\|rebuildInvestmentProjections\|backfillInvestmentWorkspace\|recordInvestmentValuation" src/ tools/ e2e/` | **0 ocorrências** |
| SDK de IA no cliente | `grep -rn "@google/genai\|@google/generative-ai\|GoogleGenerativeAI\|VITE_GOOGLE_AI_KEY" src/` | **0 ocorrências** (só um comentário histórico) |
| Região das funções | `grep -rn "setGlobalOptions\|region:" functions/src` | **0 ocorrências** |
| Cron de investimentos | `grep -rn "investment" functions/src/crons/*.ts` | **0 ocorrências** |
| CI | `ls .github` | **inexistente** |
| Escrita direta do cliente em `investment_*` | inspeção de `src/modules/investments/persistence/*` | apenas `getDoc`/`getDocs` |
| `isLegacyInvestmentWriteAllowed` | `grep -n` em `firestore.rules` | definida em `:60`, usada **apenas** em `:851` (`create`) |
| Wildcard recursivo em Rules | inspeção de `firestore.rules` completo (1229 linhas) | nenhum `{document=**}` / `{path=**}` |
| Runtime | `node --version` vs `functions/package.json` | v22.17.0 local × `engines.node: "24"` |

---

## 25. Conclusão

**1. O módulo está pronto para uso real?**
Não. O núcleo transacional está, mas o produto em volta não: valoração não tem caminho de
escrita (INV-P1-007), a alocação PF/PJ desaparece ao ligar a flag (INV-P1-008), a idempotência
não é alcançável pela interface (INV-P1-004) e não existe superfície para operar migração,
rollback ou reconstrução (INV-P1-006).

**2. Está pronto para produção?**
Não. `NÃO PRONTO PARA PRODUÇÃO`, com 1 P0 e 13 P1 abertos.

**3. Está pronto apenas para homologação?**
Sim, com ressalvas, e apenas em ambiente controlado com dados sintéticos: a flag desligada
preserva a experiência legada (provado por E2E) e as coleções `investment_*` são inacessíveis à
escrita do cliente. Homologar com a flag ligada exige, no mínimo, corrigir INV-P1-002 e
INV-P1-013, que são vetores de escrita disponíveis a qualquer usuário do ambiente.

**4. Quais são os bloqueadores?**
INV-P0-001 e INV-P1-002 a INV-P1-014. Os cinco maiores riscos:
escrita cross-tenant não autenticada; migração que reporta sucesso sem migrar e sem rollback
efetivo; ausência de caminho de reparo de deriva em workspaces valorados; idempotência anulada
no cliente; e full scan de `transactions` no fluxo principal.

**5. Existe risco de perda, corrupção ou inconsistência financeira?**
**Perda de histórico:** não no domínio V2 — nenhum `delete()` em `functions/src/investments/*`,
reversão é compensatória e arquivamento preserva. **Sim fora dele**: o cliente ainda apaga
transações (INV-P2-032), inclusive as que a migração usa como origem.
**Corrupção:** sim, em três caminhos confirmados — resgate abaixo do custo deixa principal
fantasma irrecuperável por reconstrução (INV-P1-009); migração sobre workspace com movimentos
V2 duplica principal e a reconciliação aprova (INV-P1-010); e retry de callable a partir da
interface cria um segundo fato financeiro (INV-P1-004).
**Inconsistência:** sim — a trilha legada reaberta pelo `update` de `type` faz o dinheiro sair
do caixa sem chegar ao patrimônio (INV-P1-002, reproduzido).

**6. Existe risco cross-tenant?**
**Sim, confirmado**, mas **fora do domínio de investimentos**: `creditCards/observability.ts`
grava em workspace alheio a partir de chamador não autenticado (INV-P0-001). Dentro do domínio
de investimentos, o isolamento foi verificado e está correto: todo path deriva de
`auth.workspaceId`, o payload é rejeitado quando diverge, e 11 das 14 coleções têm teste
cross-tenant nos dois sentidos.

**7. Existe risco relevante de escala e custo?**
Sim. `getTransactions` sem paginação no fluxo principal (INV-P1-011) é o mais grave.
Somam-se ~17 escritas por aporte com quatro documentos singleton por workspace, que limitam o
domínio a cerca de uma operação por segundo por tenant (INV-P2-017); funções fora da região do
Firestore (INV-P2-042); ausência de TTL nas coleções operacionais (INV-P2-041); e um snapshot de
rebuild que cresce sem teto dentro de um único documento (INV-P2-040).

**8. Qual é a sequência mínima para chegar a produção?**
Corrigir INV-P0-001; commitar o domínio (INV-P1-014); fechar as duas brechas de escrita
(INV-P1-002 e INV-P1-013); tornar a idempotência alcançável (INV-P1-004); resolver perda
realizada e reconstrução com valoração (INV-P1-009 e INV-P1-005, nesta ordem); tornar a
migração segura e reversível (INV-P1-010, INV-P1-003, INV-P1-012); entregar a superfície
operacional e a valoração no produto (INV-P1-006 e INV-P1-007); restaurar a alocação PF/PJ
(INV-P1-008); paginar `transactions` (INV-P1-011); aplicar os P2 listados na Etapa 3 do §21; e
então executar as validações finais, com a suíte de integração e o E2E verdes em execuções
repetidas e as duas reproduções do §24 deixando de reproduzir.
