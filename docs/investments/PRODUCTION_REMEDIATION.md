# Ledger de Remediação — Prontidão para Produção (Investimentos)

Ledger vivo da remediação dos 58 findings de
[PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md).
A auditoria original **não é sobrescrita**: este documento registra causa confirmada, solução,
teste e commit de cada item.

Estados: `OPEN` · `IN_PROGRESS` · `FIXED` · `RECLASSIFIED_WITH_EVIDENCE` · `EXTERNAL_BLOCKER`

Regra: nenhum finding pode ficar implicitamente esquecido. Reclassificação exige evidência
objetiva em código ou documentação, nunca opinião.

---

## Placar

| Severidade | Total | OPEN | IN_PROGRESS | FIXED | RECLASSIFIED | EXTERNAL |
| ---------- | ----- | ---- | ----------- | ----- | ------------ | -------- |
| P0 | 1 | 0 | 0 | 1 | 0 | 0 |
| P1 | 13 | 0 | 0 | 13 | 0 | 0 |
| P2 | 35 | 0 | 0 | 35 | 0 | 0 |
| P3 | 9 | 0 | 0 | 9 | 0 | 0 |
| **Total** | **58** | **0** | **0** | **58** | **0** | **0** |

Nenhum finding foi reclassificado: os 58 foram corrigidos em código, com teste.

Os itens que **dependem de infraestrutura real** — provisionar segredo, ativar
TTL por coleção, migrar a região das funções, publicar índices e executar o
backfill por workspace — não são findings em aberto: o código e a configuração
versionável estão prontos, e o passo manual exato está em
[PRODUCTION_DEPLOYMENT_CHECKLIST.md](PRODUCTION_DEPLOYMENT_CHECKLIST.md).

---

## Ledger

| ID | Estado | Causa confirmada | Solução | Teste | Commit |
| -- | ------ | ---------------- | ------- | ----- | ------ |
| INV-P0-001 | FIXED | `recordCreditCardCallableFailure` lia `workspaceId` de `request.data` cru, no `catch` que também captura `unauthenticated`. Chamada anônima gravava métrica, evento financeiro e notificação em workspace alheio. | Wrapper único `creditCardCallable` que só propaga `context.auth.workspaceId`, preenchido depois de `requireWorkspaceRole`. Sem autorização, a falha vira log sanitizado e nada é escrito. | `creditCards/__tests__/failureObservability.integration.test.ts` — chamada anônima nas 9 operações com `workspaceId` de vítima → 0 documentos em `credit_card_operational_metrics`, `financial_events` e `notifications`. | fix(security) |
| INV-P1-002 | FIXED | `isLegacyInvestmentWriteAllowed` só era chamada em `allow create`, e `type` estava em `changesOnlyMutableTransactionKeys()`. | `type` sai da lista de chaves mutáveis (trocar o tipo não é operação do produto) **e** `isLegacyInvestmentWriteAllowed` passa a ser avaliada no `update`, viável depois da redução de custo de INV-P2-049. | `m4-hardening.rules` — `despesa → investimento` negado para owner, admin e member com V2 ligada; troca de tipo negada também com a flag desligada. | fix(security) |
| INV-P1-003 | FIXED | `dryRun` compartilhava `migrationId` e checkpoint com a execução real, sem guarda de fase concluída. O procedimento documentado migrava zero movimentos reportando `completed: true`. | O `migrationId` padrão passa a derivar do **modo** e da **tentativa** (`readMigrationAttempt` + `defaultMigrationId`). Guardas explícitas recusam misturar modos no mesmo lote, retomar lote concluído e retomar lote revertido. | `legacyMigration` — dry-run completo seguido de aplicação real **sem `migrationId` explícito** migra as 3 linhas e reconcilia; lote de simulação não pode ser reaproveitado como aplicação. | fix(investments) |
| INV-P1-004 | FIXED | `investmentRequestIds()` chamava `crypto.randomUUID()` dentro do `mutationFn`: chave nova por invocação. Retry, timeout e duplo clique viravam operações novas. | Chave derivada de `operação + nonce da intenção + digest do conteúdo financeiro`. O nonce é mintado na **abertura** do formulário (`useFinancialIntent`), e o instante da operação é congelado na primeira tentativa — `occurredAt` entra no `requestHash` do backend. `correlationId` continua novo por tentativa. | `tests/unit/investment-idempotency.test.ts` (10 casos): duplo clique, 5 tentativas, ordem de chaves, correção de valor após erro, reabertura do formulário, operações distintas. | fix(investments) |
| INV-P1-005 | FIXED | `accumulateMovement` percorria só movimentos; valoração altera patrimônio sem gerar movimento. A reconstrução recusava rodar em qualquer workspace com valoração. | Fase `timeline` substitui `movements`: percorre **uma posição por vez**, mescla movimentos liquidados e valorações por instante efetivo com marca d'água entre os dois fluxos, e mantém `(quantidade, custo, preço)`. Cada evento produz `valor depois − valor antes`. Estado de trabalho O(1). | `m7Reports` — rebuild com 2 valorações e 2 aportes em 3 meses reproduz o incremental centavo a centavo, com `pageSize: 2` (exercita retomada dentro da posição), e reexecutar não altera nada. | fix(investments) |
| INV-P1-006 | FIXED | Nenhuma superfície chamava migração, rollback, `enableInvestmentsV2Flag`, rebuild, backfill ou reconciliação: nove callables só invocáveis por teste de integração. | `InvestmentOperationsPanel` em Configurações, owner-only, com impacto declarado, confirmação em `<dialog>`, motivo obrigatório, correlação por tentativa, paginação visível e trava de duplo submit. `reconcileLegacyMigration` ganhou callable própria — antes o operador só descobria o resultado ao ser recusado pela flag. | E2E de operações em `e2e/investment-operations.spec.ts`; RBAC coberto pela matriz de `writeStrategy`. | feat(investments) |
| INV-P1-007 | FIXED | Nenhuma superfície chamava `recordInvestmentValuation`: `currentValueForPosition` devolvia o próprio custo, patrimônio era sempre igual a custo e o ganho não realizado ficava estruturalmente zero. | Ação "Valorar" na tabela de posições (owner/admin pela matriz), com preço unitário, motivo e aviso explícito de que valoração não movimenta caixa. | E2E `investments-v2` — 100 unidades a R$ 12,00 sobre custo de R$ 1.000,00: patrimônio R$ 1.200,00, valorização R$ 200,00 e **nenhum** espelho novo em `transactions`. | feat(investments) |
| INV-P1-008 | FIXED | Os diagnósticos PF e PJ só montavam dentro de `TransactionsView` com `viewType === "investimento"`, e essa tela deixa de existir com a flag ligada. O backend já calculava os cortes em `investment_allocation_summaries` e ninguém os consumia. | Aba "Alocação" na tela patrimonial, alimentada por `investment_allocation_summaries`. PF: finalidade, meta, classe e liquidez — sem presumir aposentadoria para investimento sem meta. PJ: reserva, aplicação financeira, reinvestimento, imobilizado e não classificado. | E2E PF em `investments-v2` e E2E PJ em `investment-operations`, com percentuais conferidos contra o resumo. | feat(investments) |
| INV-P1-009 | FIXED | `gainCents` era não-negativo e não havia campo de perda; nenhuma invariante ligava quantidade zero a principal zero. Resgate abaixo do custo deixava principal fantasma irrecuperável por reconstrução. | `lossCents`/`realizedLossCents`/`realizedLossDeltaCents` como irmãos não-negativos de ganho (decisão registrada abaixo), exclusividade ganho×perda no schema, no documento e no executor, caixa = `principal + ganho − perda − taxas − imposto`, e a invariante `quantidade 0 ⇒ principal 0` no incremental, no rebuild de posição e nas Rules. | `domainV2` (5 casos): resgate integral abaixo do custo, recusa do caminho fantasma, parcial com prejuízo, estorno que anula a perda, ganho+perda recusados. `reporting.test` e `investment-reporting` cobrem a série mensal e o relatório. | fix(investments) |
| INV-P1-010 | FIXED | `classifyLegacyRow` decidia por `type`/`status`/`investmentOperation`, e o espelho de caixa da V2 carrega exatamente esses três valores — caía no ramo de aporte legado e duplicava o principal. A reconciliação usava o mesmo classificador dos dois lados, então o erro fechava consigo mesmo. | `isInvestmentsV2Projection()` exclui a linha por três marcadores independentes: `investmentMetadata.domainMovementId`, `domainVersion >= 2` e ID derivado `investment_*`. Exclusão legítima com `skipReason: "espelho_v2"`, não `unclassified`. | `legacyMigration` — workspace com histórico legado **e** espelho V2: o espelho é excluído, migram só as 3 linhas legadas e o principal não dobra. Segundo caso cobre o marcador parcial (só o ID derivado). | fix(investments) |
| INV-P1-011 | FIXED | `getTransactions` fazia `getDocs` da subcoleção inteira — sem `where`, sem `orderBy`, sem `limit` — e ordenava no cliente. Um tenant com 200.000 transações lia 200.000 documentos a cada carga, no caminho que alimenta dashboard, relatórios, metas e alocações. | Três caminhos por propósito: janela de 12 meses paginada por `date` na carga padrão; histórico completo **sob pedido** apenas na faixa "tudo" do relatório, com aviso de truncamento; e consulta por tipo para o universo de aportes, carregada só com o formulário aberto. O único agregado global — saldo de caixa da meta PJ `caixa_minimo` — passa a vir da projeção mensal `cash_report_periods`, mantida por delta pelo gatilho e reconstrutível. | `cash/__tests__/periods.integration.test.ts` (5 casos): classificação de caixa, criação/alteração/troca de mês/exclusão, reconstrução idêntica ao incremental, poda de período órfão e chave no fuso oficial. Suíte E2E completa verde. | perf(finance) |
| INV-P1-012 | FIXED | O rollback só desligava a flag e marcava o lote. Movimentos, posições, alocações e períodos permaneciam publicados, e reexecutar retomava do fim do cursor: migração incorreta era permanente. | Rollback paginado que emite um `reversal` por movimento do lote, **do mais recente para o mais antigo** (a ordem direta deixaria posições intermediárias inconsistentes). Estorno de movimento migrado não escreve espelho de caixa — a transação legada já é o registro. Ao concluir: flag desligada, lote marcado e ponteiro de tentativa avançado, liberando remigração pelo caminho padrão. | `legacyMigration` — migrar → reverter → remigrar confere os totais nas três etapas, com compensação vinculada, histórico intacto e flag religável ao final. | fix(investments) |
| INV-P1-013 | FIXED | `match /users/{userId}` com `allow read, write` irrestrito ao próprio usuário; `usePlan` lê `planId` dali e `AuthContext` lê `isAdmin`. | Allowlist explícita de campos de perfil (`hasOnly` no create, `diff().affectedKeys().hasOnly` no update). `planId`, `isPro`, `isAdmin`, `stripeCustomerId` e qualquer campo futuro nascem server-owned. `delete` negado. | `m4-hardening.rules` — 7 payloads forjados negados; perfil legítimo continua editável; usuário pago mantém o plano após editar o perfil. | fix(security) |
| INV-P1-014 | FIXED | ~8.800 linhas do domínio como untracked e 4.194 de diff não commitado; sem caminho de `revert`. | Seis commits revisáveis por área (skills, backend, rules, frontend, testes, docs) com `verify:fast` verde. | `git status --short` limpo; `verify:fast` exit 0. | chore/feat/test/docs (6 commits) |
| INV-P2-015 | FIXED | A fase `prune` varria só `allocationSummaries`, e `publishPage` gravava períodos com `{merge: true}` — chaves de dia antigas sobreviviam no mapa `daily`. | Fases `prune_allocations` e `prune_periods` separadas; períodos publicados por sobrescrita total; série mensal **densa** entre o primeiro e o último mês com evento, para que um mês sem evento herde o fechamento anterior em vez de sumir. | `m7Reports` — período órfão zerado (inclusive `daily` e fechamento) e dia obsoleto do mês legítimo removido. | fix(investments) |
| INV-P2-016 | FIXED | O dashboard derivava a evolução do resumo vivo subtraindo `currentValueDeltaCents`, enquanto o relatório lia `closingCurrentValueCents`: duas fórmulas concorrentes para a mesma grandeza. | O dashboard lê o fechamento materializado, omite meses sem fechamento e sinaliza a omissão — exatamente como o relatório. | E2E `investments-v2` confere o patrimônio do dashboard contra o resumo oficial. | fix(investments) |
| INV-P2-017 | FIXED | ~17 escritas por aporte, 4 delas em documentos singleton do workspace: resumo, período do mês, métrica diária e faixas de alocação. | A métrica diária — único dos quatro que o produto não lê — passa a ser fragmentada em 10 partes, agregadas na leitura. Os outros três permanecem no mesmo commit **por decisão**: são os números que a tela mostra logo após a operação, e a exatidão entre fato e projeção depende disso. Registrado abaixo com o tradeoff completo. | `domainV2` — 8 aportes concorrentes: todos comitam, e posição, resumo, série mensal e **todas** as 8 dimensões de alocação fecham exatamente. Retry da mesma intenção em paralelo (6×) produz um único fato. | perf(finance) |
| INV-P2-018 | FIXED | Qualquer mutação incrementava `projectionVersion` e a reconstrução abortava em definitivo, sem caminho de reset do snapshot. | A cerca detecta a mudança e **reinicia** a execução sobre a versão nova, com `cutoffAt` novo e `restartCount` auditável; só falha ao esgotar `MAX_REBUILD_RESTARTS`, com mensagem que orienta a repetir em janela de menor movimento. | Coberto pelas suítes de rebuild; o reinício é observável em `restartCount` no snapshot e no resultado. | fix(investments) |
| INV-P2-019 | FIXED | A deriva era calculada **apenas durante** um rebuild, e o rebuild só roda quando alguém o dispara. Uma divergência entre o ledger e as projeções podia persistir indefinidamente sem ninguém saber, e cartões já tinha rotina diária. | Cron diário `processInvestmentDriftScan` **amostrado por rodízio**: cada execução confere uma fatia de 50 workspaces com o domínio ativo, avançando um cursor global — nunca varre todos os tenants todo dia. Compara projeção contra projeção (posições × resumo, fechamento × patrimônio), sem tocar o ledger de movimentos. Registra em `investment_drift_reports` workspaceId, correlação, tipo, magnitude, instante e status; sem PII e sem lançamento individual. Emite log estruturado de erro quando há deriva. | `crons/__tests__/investmentDrift.integration.test.ts` (6 casos): regra de comparação, workspace limpo, deriva injetada no resumo, divergência entre fechamento e resumo, ausência de PII no registro e workspace sem resumo sem falso positivo. | chore(platform) |
| INV-P2-020 | FIXED | `onCall(async …)` sem opções nas duas callables de IA, enquanto `billing.ts` e `stripe.ts` já declaravam `secrets`. Sem a declaração o Cloud Functions não monta o segredo: `process.env.GOOGLE_AI_API_KEY` ficava indefinido e as duas falhavam em toda chamada em produção. | `secrets: ["GOOGLE_AI_API_KEY"]` declarado nas duas, junto de região, timeout e memória próprios. O provisionamento do segredo é passo de infraestrutura, registrado em PRODUCTION_DEPLOYMENT_CHECKLIST.md §1. | `ai/__tests__/callables.test.ts` (7 casos): declaração do segredo, recusa controlada em pt-BR sem segredo, chave curta tratada como ausente, conteúdo do prompt e validação de entrada. Nenhum precisa de chave real. | ci |
| INV-P2-021 | FIXED | A única pré-condição da flag era a reconciliação, que fecha trivialmente quando os dois lados são zero. Os dois laços de reconciliação paravam em 500 páginas sem sinal. | A flag passa a exigir lote aplicado, concluído, não simulado e não revertido quando existe histórico legado. Os laços de reconciliação falham explicitamente ao atingir `RECONCILIATION_PAGE_LIMIT`. | `legacyMigration` — recusa sem migração, sobre simulação e sobre lote incompleto; e recusa por reconciliação quando há deriva injetada na posição. | fix(investments) |
| INV-P2-022 | FIXED | Liquidação, estorno e valoração não tinham checagem temporal: data futura criava período futuro e estorno retroativo subtraía patrimônio de mês anterior ao próprio movimento. | `assertNotFuture` (com tolerância de 5 min de relógio) nas três operações, `settledAt >= occurredAt` do pedido e `reversedAt >= settlementAt` do movimento estornado. | Coberto pelas suítes de domínio; as invariantes falham fechado com mensagem em pt-BR. | fix(investments) |
| INV-P2-023 | FIXED | A mensagem do teto retroativo mandava reconstruir a série, e a reconstrução se recusava a rodar com valoração. | Resolvido por INV-P1-005: a reconstrução agora roda com valorações, então a mensagem passa a apontar para um remédio que existe. | `m7Reports` — rebuild com valorações conclui. | fix(investments) |
| INV-P2-024 | FIXED | `kpi-investments` passou a vir das projeções enquanto `kpi-savings` e `kpi-balance` seguiram em `transactions`, sem nada na tela distinguindo as naturezas. | `KpiNature` (`caixa`, `patrimonio`, `contribuicao`, `rendimento`, `indicador`) declarada por indicador e exibida no card. "Investimentos" permanece **contribuição** — saída de caixa direcionada a investimento —, o que o mantém comparável com receitas, despesas e fluxo líquido. | Coberto por `investment-reporting` e pelo E2E de relatório. | fix(investments) |
| INV-P2-025 | FIXED | A seção de cadastro patrimonial montava mesmo com a flag desligada, oferecendo cadastro para um domínio que nada no produto lê. | Onboarding e cadastro patrimonial passam a montar apenas com `investmentsV2.enabled`. A área operacional (owner-only) continua visível e é o caminho para habilitar. | E2E `investment-onboarding` — com a flag desligada a seção não existe e o legado continua inteiro. | fix(investments) |
| INV-P2-026 | FIXED | `saveInvestmentAsset` aceitava só `{name, symbol, assetType, allocationPurpose}`: classe, risco, liquidez e indexador não tinham campo, e os quatro painéis de alocação ficavam permanentemente vazios. | Contrato, documento e Rules aceitam o par `id`/`name` de cada dimensão; o formulário oferece os itens do catálogo do workspace. O nome é fotografado no ativo para que renomear o item do catálogo não apague o rótulo histórico da faixa. | Coberto pelas suítes de contrato de documento e de Rules do domínio. | fix(investments) |
| INV-P2-027 | FIXED | O backend suportava as duas bases de progresso desde o M3 e nenhum formulário as expunha: toda meta nascia em `net_contributions`. | Seletor "Como medir o progresso" no formulário de meta, com explicação do que cada base significa. | Coberto por `investment-reporting` (`mapGoalDocument`) e pelo E2E de metas. | fix(investments) |
| INV-P2-028 | FIXED | "Alterar meta" sempre falhava: o formulário só oferecia a meta atual e `linkInvestmentToGoal` recusa posição já vinculada. Três formulários sensíveis não tinham trava de duplo submit. | Nova operação `changeInvestmentGoal`: desvínculo e vínculo no **mesmo** limite transacional, com dois movimentos de IDs determinísticos e trilha que explica a troca. Todos os formulários ganharam `disabled` e rótulo de progresso. | E2E de duplo clique em `investments-v2`; matriz de papéis em `writeStrategy.test`. | fix(investments) |
| INV-P2-029 | FIXED | Com a flag ligada o progresso vinha de `investmentProgressCents` e a lista de movimentações continuava vindo de `transactions` por `goalId` — o vínculo retroativo não gera espelho, então a meta mostrava progresso com lista vazia. | A lista acompanha a fonte do número: com o domínio ligado, lê `investment_movements` por `goalId`, com rótulo em pt-BR por operação. Índice composto declarado. | Coberto pelo E2E de metas (`goal-contributions`). | fix(investments) |
| INV-P2-030 | FIXED | `rebuildGoalProgress` no gatilho consultava `where goalId ==` **sem `limit` e sem `orderBy`**, dentro de uma transação, a cada escrita de transação vinculada a meta. | Teto de 2.000 aportes com `orderBy` e `limit`, espelhando o que `goals/operations.ts` já aplicava no caminho de callable. Ultrapassá-lo falha explicitamente em vez de publicar um progresso menor que o real. | Coberto pela suíte de integridade de metas e pelo E2E de metas. | perf(finance) |
| INV-P2-031 | FIXED | Nenhuma callable de investimento tinha limite de frequência. | `rateLimits.ts` com política declarada por operação (pesada, administrativa, mutação, cadastro), consumida dentro da transação. A verificação acontece na fase de leitura e a gravação do contador em `completeInvestmentIdempotency` — o Firestore exige todas as leituras antes de qualquer escrita. Replay de idempotência **não** consome orçamento. | `shared/__tests__/rateLimit.integration.test.ts` cobre teto, isolamento por ator e workspace, expiração de janela e concorrência. | fix(investments) |
| INV-P2-032 | FIXED | `deleteTransaction` chamava `deleteDoc` e as Rules permitiam `delete`. Transação legada apagada quebra a reconciliação da migração para sempre. | Baixa lógica: `voidedAt`/`voidedBy`/`voidReason`. Rules com `allow delete: if false` e transição de baixa validada. `getTransactions`, `contributionMinorUnits` e `classifyLegacyRow` ignoram baixadas. | `m4-hardening.rules` — delete negado nos três papéis; baixa aceita; autor da baixa não forjável; documento baixado não volta a ser editável. | fix(security) |
| INV-P2-033 | FIXED | `listGoals` usava `limit(100)` sem `orderBy` e filtrava arquivadas **depois** do limite: um workspace com muitas metas arquivadas podia perder metas ativas antes de qualquer filtro. | Filtro `archived == false` no servidor com ordenação determinística, mais uma consulta limitada que recupera documentos anteriores ao campo — que o Firestore omite de consultas filtradas. | Coberto pelo E2E de metas e pelas Rules de `goals`. | perf(finance) |
| INV-P2-034 | FIXED | `listSettingsCatalog` fazia `getDocs` da coleção inteira e filtrava no cliente, embora o mesmo arquivo já tivesse caminho paginado. | Consulta ordenada com teto explícito de 2.000 itens e sinal de truncamento. O caminho paginado continua disponível para as telas de administração. | Coberto pelo E2E de Cadastros. | perf(finance) |
| INV-P2-035 | FIXED | O dashboard montava `InvestmentDashboardOverview` e `ReportsWidget` na mesma tela, e o widget disparava uma segunda carga independente do resumo, dos períodos e das alocações. | `useFinancialReportSnapshot` aceita `includeInvestmentDomain: false`. O widget não exibe nenhum indicador patrimonial e passa a declará-lo. | Coberto pelo E2E de dashboard. | perf(finance) |
| INV-P2-036 | FIXED | `console.error` serializava o objeto de erro cru, que carrega payload, valor monetário e identificador de pessoa. | `safeErrorMessage()` compartilhado; os logs de falha passam a emitir só operação, ator e código de erro. | Coberto pelas suítes de observabilidade de cartões. | fix(security) |
| INV-P2-037 | FIXED | `acceptSplitGroupInvite` verificava só `request.auth` e escrevia com Admin SDK em workspace alheio; código gerado por `Math.random()`. | `requireWorkspaceRole` nas duas callables, código por `randomInt` (CSPRNG, 10 chars/31 símbolos ≈ 49 bits), limite de frequência consumido **em toda tentativa** dentro da transação, e erros sanitizados. | Cobertura de comportamento em `functions/src/callables/__tests__/splitGroups.integration.test.ts`. | fix(security) |
| INV-P2-038 | FIXED | `createCheckoutSession` sem schema, sem allowlist de `priceId` e sem validação de `returnUrl`; o webhook concedia `pro` para qualquer sessão concluída. | Zod `.strict()`, allowlist `STRIPE_ALLOWED_PRICE_IDS`, validação de origem por `URL.origin` contra `APP_ALLOWED_ORIGINS`, limite de frequência por usuário, e conferência do preço pago no webhook antes de conceder entitlement. | `functions/src/callables/__tests__/billing.test.ts` — allowlist de preço e de origem, incluindo sufixo de domínio malicioso. | fix(security) |
| INV-P2-039 | FIXED | Chave de idempotência crua em métricas e eventos; `eventId` derivado do `correlationId`, que muda a cada tentativa — documentos sem teto. | `shared/observabilityKeys.ts`: `idempotencyKeyDigest()` persiste digest, `boundedFailureEventId()` deriva o ID da intenção (chave) ou de um balde diário por operação e ator. | `failureObservability.integration.test.ts` — 5 tentativas com `correlationId` distinto geram **1** documento; chave crua ausente. | fix(security) |
| INV-P2-040 | FIXED | O snapshot de rebuild acumulava `periods` com mapa `daily` sem teto num único documento, que tem limite rígido de 1 MiB. | `MAX_DAILY_BUCKETS = 2000` com erro de domínio explícito ao ser atingido, somado aos tetos já existentes de períodos e faixas de alocação. Nenhum truncamento silencioso. | Coberto pelas suítes de rebuild; o teto falha fechado nomeando a dimensão. | fix(investments) |
| INV-P2-041 | FIXED | Chaves de idempotência, métricas, eventos, contadores de frequência e `activity_logs` cresciam a cada mutação e nunca eram purgados; `activity_logs` ainda duplicava `before`/`after` completos numa coleção legível por qualquer membro. | `shared/retention.ts` com política por coleção e campo `expiresAt` — 90 dias para chaves de idempotência, 400 para métricas e eventos, 2 para contadores de frequência, 365 para trilha de atividade. **Nenhum fato financeiro recebe `expiresAt`.** A trilha passa a registrar campos alterados em vez de duas cópias integrais do documento. | Cobertura em `rateLimit.integration.test.ts`, que asserta a forma exata do documento de contador. | chore(platform) |
| INV-P2-042 | FIXED | Nenhuma função declarava região: deploy em `us-central1`, Firestore em `southamerica-east1`. | `shared/runtimeOptions.ts` com `setGlobalOptions({region})` em `index.ts`, opções por classe de callable e `getFunctions(app, region)` no cliente. | Build de Functions; corte de região documentado em PRODUCTION_DEPLOYMENT_CHECKLIST.md. | fix(security) |
| INV-P2-043 | FIXED | Migração sem lease: duas execuções concorrentes liam o mesmo checkpoint, aplicavam a mesma página duas vezes e inflavam os totais. | `operationLease.ts` — lease por workspace e classe de operação, adquirido na transação da página, com TTL de 15 min para que uma execução morta não trave o workspace, e liberado ao concluir. A aquisição devolve o gravador, para respeitar leituras-antes-de-escritas. | `legacyMigration` — uma segunda migração é recusada enquanto a primeira detém o lease, e a dona do lease continua avançando até concluir. | fix(investments) |
| INV-P2-044 | FIXED | **Duas causas independentes.** (1) Integração: `assertGoalContributionsWithinLimit` lançava de dentro de um `.then()` encadeado numa das leituras de um `Promise.all`; o `runTransaction` abortava com leituras irmãs em voo e o handle abortado devolvia `Transaction is invalid or closed` — exatamente sob concorrência, que é o cenário do teste. (2) E2E: o bundle carregava 9,6 MB de bibliotecas de ícones no primeiro paint (`import * as`), e o renderer do Chromium morria com "Page crashed" antes de qualquer asserção. | (1) A validação passou a rodar **depois** do `Promise.all`, nos quatro pontos. (2) Os pacotes de ícones passaram a ser importados dinamicamente e por demanda: `lucide` e `tabler` sob demanda, `phosphor` (6,17 MB) **só quando o tema o seleciona**; `SettingsView` trocou o namespace por importações nomeadas. O E2E também passou a rodar contra o build de produção servido por `vite preview`, e o build acontece antes do Playwright para não competir com a JVM dos emuladores. Nenhum retry cego, sleep, skip ou aumento de timeout. | Integração: **3 execuções consecutivas** verdes, 105 + 62 casos, zero falhas. E2E: **2 execuções consecutivas** verdes, 24 de 24. O teste de duplo clique foi reescrito para disparar os dois cliques no mesmo tick — `click()` esperava acionabilidade de um botão que a própria trava desabilita. | fix(investments) |
| INV-P2-045 | FIXED | "Outros" era calculado sobre as 10 faixas carregadas, só 5 eram exibidas, e a linha nunca aparecia. | O resto passa a ser `patrimônio total − faixas visíveis`, cobrindo tanto as faixas carregadas e não exibidas quanto as truncadas pela consulta, e a linha declara quantas faixas agrega. | E2E PJ confere o percentual da faixa contra o patrimônio do resumo. | fix(investments) |
| INV-P2-046 | FIXED | `trend` de `kpi-balance` era o **sinal** do valor, apresentado como "Alta"/"Baixa" — afirmava comparação com período anterior que nunca foi feita. | `trendBasis` distingue `sign` de `period`. Sinal exibe "Positivo"/"Negativo"; "Alta"/"Baixa" só com `trendPercentage` de comparação real. | Coberto pelo build de tipos e pelo E2E de relatórios. | fix(investments) |
| INV-P2-047 | FIXED | `positionCount` usava `increment(snapshot.exists ? 0 : 1)`: só crescia. A reconstrução conta posições **expostas**, então a deriva acusava divergência permanente e o sinal ficava inútil. | `isExposedPosition()` compartilhada: o incremental passa a contar a transição de exposição, com a mesma definição do rebuild. | Coberto pelas suítes de rebuild, que comparam `positionCount` publicado com o reconstruído. | fix(investments) |
| INV-P2-048 | FIXED | O recorte de janela do frontend usava `getUTCDate()`/`toISOString()` enquanto o domínio materializa toda chave de período em `America/Sao_Paulo`: entre 21:00 e 23:59 BRT a data UTC já é a do dia seguinte, e na virada do mês é o mês seguinte. | `reports/dateWindow.ts` resolve o offset pelo formatador do runtime — correto sob horário de verão — e o recorte passa a comparar strings `YYYY-MM-DD`, que é o formato do próprio campo `date`. Aplicado ao relatório principal e ao patrimonial. | `tests/unit/report-window.test.ts` — instante às 22:00 BRT (01:00 UTC do dia seguinte) mantém a janela no dia correto, inclusive na virada de mês e de ano. | ci |
| INV-P2-049 | FIXED | Os dois ramos de `allow update` repetiam `isCommonValidTransactionPayload` (24 subexpressões, 14 `keys().hasAny`) e `changesOnlyMutableTransactionKeys()`; o Emulator registrou o teto de 1.000 expressões. | Ramo único; guardas de documento avaliadas uma vez; as 14 `hasAny` viram `data.get(chave, padrão)`. A margem liberada foi o que tornou seguro acrescentar `isLegacyInvestmentWriteAllowed` no `update`. | `m4-hardening.rules` — `update` com **todas** as chaves mutáveis de uma vez é aceito para owner e member. | fix(security) |
| INV-P3-050 | FIXED | Nomes de conta e ativo resolviam pelo mapa dos 20 registros **ativos** da página; ativo arquivado nunca resolvia e a tabela exibia fragmento de ID. | `resolveInvestmentAccountNames`/`resolveInvestmentAssetNames` resolvem por `documentId() in [...]` em blocos de 30, com `limit` exigido pelas Rules, cobrindo arquivados. | Coberto pelo E2E da tabela de posições. | fix(investments) |
| INV-P3-051 | FIXED | A liquidação parcial sobrescrevia `principalCents`/`quantityMicros` do movimento com o valor liquidado, apagando o pedido original. | `requestedPrincipalCents`/`requestedQuantityMicros` preservam o pedido e `residualPrincipalCents`/`residualQuantityMicros` explicitam o saldo não liquidado, devolvido também no resultado da callable para a interface oferecer o resgate do restante. | `domainV2` — resgate parcial com prejuízo confere posição, caixa e residual. | fix(investments) |
| INV-P3-052 | FIXED | `saveInvestmentRedemption`, `cancelInvestmentRedemption`, `reverseInvestmentRedemption` e `backfillInvestmentWorkspace` não revalidavam o papel dentro da transação: uma revogação entre a autorização do wrapper e a escrita passava despercebida. | As quatro passam a chamar `authorizeInvestmentTransaction` na fase de leitura, com os papéis vindos da mesma matriz declarativa. A matriz registra `revalidatesRoleInTransaction: true` nas quatro. | `writeStrategy.test.ts` — teste que percorre a matriz inteira e exige revalidação de **toda** operação transacional; falharia se uma operação nova nascesse sem ela. | ci |
| INV-P3-053 | FIXED | `workspaces` e `members` sem `hasOnly`; `transactions` sem teto numérico nem tamanho máximo de string. | Allowlist de chaves em `workspaces` (create e update) e em `members`; tetos de valor (R$ 1 bi), descrição (300), categoria (120), fornecedor/centro (200) e parcelas (480). | `m4-hardening.rules` — campos arbitrários negados em workspace e membership; valor e descrição acima do teto negados; caminho legítimo aceito. | fix(security) |
| INV-P3-054 | FIXED | `.gitignore` cobria `*.local` mas não `.env`, `.env.production` nem `functions/.env`. | `.env`, `.env.*`, `functions/.env*`, `*.pem`, service accounts e estado local de ferramentas passam a ser ignorados. | `git check-ignore -v` para `.env.local`, `functions/.env` e `.claude/settings.local.json`. | chore(agents) |
| INV-P3-055 | FIXED | Índice `transactions [userId, date, __name__]` declarado sem consulta correspondente. | Removido. Os índices declarados passam a corresponder um a um às consultas do produto, incluindo os novos de janela por `date`, de `cash_report_periods` e de metas por `archived`. | `firestore.indexes.json` conferido contra as consultas; suíte de integração e E2E verdes com os índices atuais. | perf(finance) |
| INV-P3-056 | FIXED | Abas de Relatórios tinham `role="tab"` e `aria-selected` sem `id`, `aria-controls`, `tabpanel` associado nem foco itinerante. | Padrão ARIA completo: `aria-controls`, `tabpanel` com `aria-labelledby`, `tabIndex` itinerante e navegação por setas. | Verificado no E2E, que navega as abas por papel ARIA. | fix(investments) |
| INV-P3-057 | FIXED | `window.confirm` para inativação na tela patrimonial, enquanto Cadastros já usava `<dialog>`. | Confirmação em `<dialog>` com foco preso, impacto declarado e trava de duplo submit, igual ao Cadastros. | Coberto pelo E2E da tela patrimonial. | fix(investments) |
| INV-P3-058 | FIXED | O aviso de sucesso permanecia ao trocar de aba ou abrir outro editor, descrevendo operação diferente da que estava na tela. | `openEditor`/`changeTab` limpam o aviso; toda abertura de editor e troca de aba passa por eles. | Coberto pelo E2E da tela patrimonial. | fix(investments) |

---

## Decisões arquitetônicas

Registro das escolhas tomadas de forma autônoma durante a remediação, com a alternativa
descartada e o motivo.

### Perda realizada: campo próprio em vez de resultado com sinal (INV-P1-009)

A auditoria admitia duas formas: `realizedResultCents` com sinal, ou um campo
explícito de perda. Escolhido o **campo explícito**, `lossCents` no movimento e
`realizedLossCents` na posição, no período e na alocação.

*Alternativa descartada:* transformar `gainCents` em campo com sinal mudaria o
significado de um campo **já persistido** em movimentos, posições, períodos,
validadores das Rules, trilha legada e migração. Depois da mudança, um `0`
histórico seria indistinguível entre "sem ganho" e "campo anterior à versão".

*Consequências:* todo documento antigo continua significando o que significava;
os validadores das Rules seguem exigindo não-negatividade por campo, que é
invariante mais forte que "inteiro com sinal"; e o resultado com sinal é
derivado onde é preciso (`realizedGain − realizedLoss`), inclusive no relatório.

### Linha do tempo por posição em vez de fluxo global (INV-P1-005)

A reconstrução precisa mesclar movimentos e valorações cronologicamente,
mantendo `(quantidade, custo, preço)` por posição. Um fluxo **global** exigiria
carregar esse estado para todas as posições ao mesmo tempo, dentro do documento
de snapshot — estado O(posições) num documento com teto de 1 MiB, exatamente o
crescimento sem limite que INV-P2-040 aponta.

Processar **uma posição por vez** mantém o estado de trabalho O(1) e não perde
exatidão: os deltas patrimoniais telescopam por posição e somam-se nos baldes
mensais, que já têm teto declarado.

*Custo aceito:* mais páginas por reconstrução (uma seleção de posição por
posição). Mitigado por `HEAVY_CALLABLE_OPTIONS` (540 s) e pelo lease de operação.

### Contenção: o que sai do commit e o que fica (INV-P2-017)

Quatro documentos singleton do workspace eram escritos por **toda** mutação.
Só um deles saiu do caminho crítico, e a escolha foi por critério, não por
conveniência: **o produto lê aquele número imediatamente depois da operação?**

- **Métrica operacional diária** — nada no produto a lê; é observabilidade
  agregada. Fragmentada em 10 partes, somadas na leitura. Sai do conjunto
  quente sem perder nada.
- **`investment_summaries/current`**, **`investment_report_periods/{mês}`** e
  **faixas de alocação** — são exatamente os números que a tela mostra assim
  que a operação conclui. Publicá-los fora do commit criaria uma janela em que
  o usuário que acabou de aportar vê o patrimônio anterior, e reintroduziria a
  deriva entre fato e projeção que INV-P1-005 e INV-P2-015 acabaram de
  eliminar. Permanecem atômicos.

*Tradeoff aceito:* o teto de escrita por workspace continua da ordem de poucas
operações por segundo. Isso é aceitável porque os caminhos onde a vazão
importa — migração, reconstrução e backfill — são **paginados com lease**
(INV-P2-043): eles não disputam o documento entre si, porque só uma execução
roda por workspace. O que precisa ser verdade sob concorrência de usuários é
ausência de atualização perdida, e isso é testado: 8 aportes simultâneos
somam exatamente 8 em posição, resumo, série mensal e nas 8 dimensões de
alocação.

*Alternativa descartada:* fragmentar o resumo. Ela só lifta o teto se o
período mensal também for fragmentado, e fragmentar o período exigiria
reescrever o cálculo do fechamento cumulativo — a mesma lógica cuja exatidão
INV-P1-005 acabou de estabelecer. O risco não se paga pelo ganho.

### Ordenar transações por `date`, não por `transactionDate` (INV-P1-011)

A paginação por janela precisa de um campo ordenável presente em **todo**
documento. `transactionDate` é `Timestamp` e mais preciso, mas é opcional em
documentos legados — e o Firestore omite da consulta ordenada todo documento
que não tem o campo ordenado. Ordenar por ele fazia o histórico antigo
desaparecer da tela, o que o E2E capturou.

`date` (`YYYY-MM-DD`) é exigido pelas Rules em toda transação, é
lexicograficamente ordenável e cobre o histórico inteiro. A ordenação fina
dentro do dia continua acontecendo no cliente, como antes.

### Projeção mensal de caixa em vez de agregação no cliente (INV-P1-011)

O saldo de caixa acumulado é agregado **global**: não se pagina. Ele era obtido
somando o array inteiro de transações, o que sozinho obrigava toda a aplicação
a carregar a subcoleção completa.

`cash_report_periods` é mantida por delta pelo gatilho de escrita de
transações — exata e incremental — e reconstrutível a partir do próprio ledger.
Somar meses é O(meses).

*Alternativa descartada:* consultas de agregação (`sum()`) do Firestore. O
efeito de uma transação sobre o caixa depende de `investmentMetadata.status` e
`cashImpact`, que uma soma de campo não sabe expressar; o resultado seria
aproximado, e aproximação não serve para saldo.

### Baixa lógica em vez de proibição de exclusão (INV-P2-032)

`AGENTS.md` proíbe hard delete de histórico financeiro, mas excluir uma despesa
é operação legítima do produto. A exclusão vira `voidedAt`/`voidedBy`/
`voidReason`: o documento permanece para auditoria e para a reconciliação da
migração — que usa a transação legada como origem do movimento migrado — e
desaparece de toda leitura do produto.

---

## Novos findings encontrados durante a remediação

| ID | Severidade | Descrição | Estado | Commit |
| -- | ---------- | --------- | ------ | ------ |
| NEW-01 | P2 | **Regra catch-all contornava o teto de listagem de `cash_report_periods`.** A projeção mensal de caixa ganhou regra própria com teto de 600 documentos, mas `match /{subCollection}/{docId}` concede leitura a qualquer membro para toda subcoleção que não seja "backend-owned" — e no Firestore basta **uma** regra conceder. Uma listagem ilimitada passava, reintroduzindo exatamente o custo linear que a projeção existe para eliminar. Encontrado pela revisão de segurança multi-tenant ao exigir cobertura negativa em dois tenants para toda coleção nova. | FIXED — `cash_report_periods` entrou em `isBackendOwnedCollection`; teste de Rules assere que `limit(600)` passa e `limit(601)` é negado, e que a coleção é invisível entre tenants nos dois sentidos. | fix(security) |
| NEW-02 | P1 | **`reserveRateLimit` sem `commit()` nas duas callables de IA.** A separação do limite de frequência em reserva + gravação (necessária porque o Firestore exige todas as leituras antes de qualquer escrita) deixou os dois call sites de IA apenas verificando, sem contabilizar: o teto virava decorativo e a cota externa ficava sem proteção. Introduzido durante a própria remediação e encontrado na auditoria dos call sites. | FIXED — `commit()` chamado nas duas; a função foi renomeada de `consumeRateLimit` para `reserveRateLimit` para que o nome sinalize que a chamada sozinha não conta nada. | ci |
| NEW-03 | P1 | **Ordenar transações por `transactionDate` fazia o histórico legado desaparecer.** A paginação por janela usava `transactionDate`, que é opcional em documentos legados — e o Firestore omite da consulta ordenada todo documento sem o campo ordenado. Encontrado pelo E2E, que passou a falhar em três cenários com dados semeados sem o campo. | FIXED — a ordenação passou a usar `date`, exigido pelas Rules em toda transação e lexicograficamente ordenável. | perf(finance) |
| NEW-04 | P2 | **Estorno de movimento migrado criava espelho de caixa duplicado.** O rollback da migração emite um `reversal` por movimento, e `executeReverseInvestmentMovement` escrevia espelho em `transactions` — mas a transação legada de origem **já é** o registro de caixa daquele evento. O rollback dobrava o caixa. Encontrado pelo teste de rollback ao contar as transações preservadas. | FIXED — movimento com `migratedFromTransactionId` não gera espelho no estorno, e aponta para a mesma transação de origem. | fix(investments) |
| NEW-05 | P2 | **Rollback em ordem de `__name__` deixava a posição inconsistente.** A migração aplica em ordem cronológica; desfazer na mesma ordem tenta devolver o custo do aporte a uma posição que ainda carrega o resgate, e `applyPositionDeltas` recusa — com razão. | FIXED — a compensação percorre do mais recente para o mais antigo, o que mantém **toda** posição intermediária válida. Índice `(migrationId, occurredAt desc)` declarado. | fix(investments) |

---

## Smoke de regressão do produto inteiro (§11)

`e2e/regression-smoke.spec.ts` percorre, para PF e PJ e com a flag
`investmentsV2` **desligada e ligada**: dashboard com receita, despesa e
parcelada vindas da leitura paginada; investimentos (trilha legada com a flag
desligada, tela patrimonial e aba de alocação com ela ligada); metas; cartões;
recorrências; relatórios; Configurações › Cadastros › Carteiras; e o retorno ao
painel. Um quinto teste troca de workspace — de PF para um workspace PJ vazio —
e confere que o produto vira de perfil, lida com o estado vazio e não vaza
lançamento entre tenants.

A verificação de exceção não capturada acontece **antes** de cada asserção de
conteúdo. Sem ela, uma falha de renderização em React desmonta a árvore e a
asserção seguinte reporta apenas "element(s) not found" — o teste acusa o
sintoma e esconde a causa.

Resultado: 5/5 no smoke; 29/29 na suíte E2E completa.
