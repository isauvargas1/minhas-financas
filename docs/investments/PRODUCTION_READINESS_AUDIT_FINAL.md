# Auditoria final de prontidão para produção — módulo de investimentos

Reavaliação independente do estado do módulo **depois** da remediação. Não
substitui `PRODUCTION_READINESS_AUDIT.md`, que permanece como o retrato do
estado anterior; este documento diz o que mudou, com que prova, e o que
continua sendo risco.

- Base de comparação: `c754cfa`
- `HEAD` auditado: `d9ee526`
- Commits de remediação: 19
- Diff: 174 arquivos, +28.945 / −2.095

---

## 1. Placar final

| Severidade | Total | FIXED | OPEN |
| ---------- | ----- | ----- | ---- |
| P0 | 1 | 1 | 0 |
| P1 | 13 | 13 | 0 |
| P2 | 35 | 35 | 0 |
| P3 | 9 | 9 | 0 |
| **Total** | **58** | **58** | **0** |

Sete achados novos apareceram durante a remediação (NEW-01 a NEW-07) e também
estão fechados. Cinco vieram dos próprios testes; dois vieram dos gates
executados no fim (escala/custo e regressão).

Nenhum item foi fechado por documentação, TODO ou promessa operacional.

---

## 2. Estado final por finding

| ID | Estado final | Evidência no código | Teste que o prova |
| -- | ------------ | ------------------- | ----------------- |
| INV-P0-001 | FIXED | Wrapper único `creditCardCallable` que só propaga `context.auth.workspaceId`, preenchido depois de `requireWorkspaceRole`. Sem autorização, a falha… | `creditCards/__tests__/failureObservability.integration.test.ts` — chamada anônima nas 9 operações com `workspaceId` de vítima → 0 documentos em… |
| INV-P1-002 | FIXED | `type` sai da lista de chaves mutáveis (trocar o tipo não é operação do produto) **e** `isLegacyInvestmentWriteAllowed` passa a ser avaliada no… | `m4-hardening.rules` — `despesa → investimento` negado para owner, admin e member com V2 ligada; troca de tipo negada também com a flag desligada. |
| INV-P1-003 | FIXED | O `migrationId` padrão passa a derivar do **modo** e da **tentativa** (`readMigrationAttempt` + `defaultMigrationId`). Guardas explícitas recusam… | `legacyMigration` — dry-run completo seguido de aplicação real **sem `migrationId` explícito** migra as 3 linhas e reconcilia; lote de simulação não… |
| INV-P1-004 | FIXED | Chave derivada de `operação + nonce da intenção + digest do conteúdo financeiro`. O nonce é mintado na **abertura** do formulário… | `tests/unit/investment-idempotency.test.ts` (10 casos): duplo clique, 5 tentativas, ordem de chaves, correção de valor após erro, reabertura do… |
| INV-P1-005 | FIXED | Fase `timeline` substitui `movements`: percorre **uma posição por vez**, mescla movimentos liquidados e valorações por instante efetivo com marca… | `m7Reports` — rebuild com 2 valorações e 2 aportes em 3 meses reproduz o incremental centavo a centavo, com `pageSize: 2` (exercita retomada dentro… |
| INV-P1-006 | FIXED | `InvestmentOperationsPanel` em Configurações, owner-only, com impacto declarado, confirmação em `<dialog>`, motivo obrigatório, correlação por… | E2E de operações em `e2e/investment-operations.spec.ts`; RBAC coberto pela matriz de `writeStrategy`. |
| INV-P1-007 | FIXED | Ação "Valorar" na tabela de posições (owner/admin pela matriz), com preço unitário, motivo e aviso explícito de que valoração não movimenta caixa. | E2E `investments-v2` — 100 unidades a R$ 12,00 sobre custo de R$ 1.000,00: patrimônio R$ 1.200,00, valorização R$ 200,00 e **nenhum** espelho novo em… |
| INV-P1-008 | FIXED | Aba "Alocação" na tela patrimonial, alimentada por `investment_allocation_summaries`. PF: finalidade, meta, classe e liquidez — sem presumir… | E2E PF em `investments-v2` e E2E PJ em `investment-operations`, com percentuais conferidos contra o resumo. |
| INV-P1-009 | FIXED | `lossCents`/`realizedLossCents`/`realizedLossDeltaCents` como irmãos não-negativos de ganho (decisão registrada abaixo), exclusividade ganho×perda no… | `domainV2` (5 casos): resgate integral abaixo do custo, recusa do caminho fantasma, parcial com prejuízo, estorno que anula a perda, ganho+perda… |
| INV-P1-010 | FIXED | `isInvestmentsV2Projection()` exclui a linha por três marcadores independentes: `investmentMetadata.domainMovementId`, `domainVersion >= 2` e ID… | `legacyMigration` — workspace com histórico legado **e** espelho V2: o espelho é excluído, migram só as 3 linhas legadas e o principal não dobra.… |
| INV-P1-011 | FIXED | Três caminhos por propósito: janela de 12 meses paginada por `date` na carga padrão; histórico completo **sob pedido** apenas na faixa "tudo" do… | `cash/__tests__/periods.integration.test.ts` (5 casos): classificação de caixa, criação/alteração/troca de mês/exclusão, reconstrução idêntica ao… |
| INV-P1-012 | FIXED | Rollback paginado que emite um `reversal` por movimento do lote, **do mais recente para o mais antigo** (a ordem direta deixaria posições… | `legacyMigration` — migrar → reverter → remigrar confere os totais nas três etapas, com compensação vinculada, histórico intacto e flag religável ao… |
| INV-P1-013 | FIXED | Allowlist explícita de campos de perfil (`hasOnly` no create, `diff().affectedKeys().hasOnly` no update). `planId`, `isPro`, `isAdmin`,… | `m4-hardening.rules` — 7 payloads forjados negados; perfil legítimo continua editável; usuário pago mantém o plano após editar o perfil. |
| INV-P1-014 | FIXED | Seis commits revisáveis por área (skills, backend, rules, frontend, testes, docs) com `verify:fast` verde. | `git status --short` limpo; `verify:fast` exit 0. |
| INV-P2-015 | FIXED | Fases `prune_allocations` e `prune_periods` separadas; períodos publicados por sobrescrita total; série mensal **densa** entre o primeiro e o último… | `m7Reports` — período órfão zerado (inclusive `daily` e fechamento) e dia obsoleto do mês legítimo removido. |
| INV-P2-016 | FIXED | O dashboard lê o fechamento materializado, omite meses sem fechamento e sinaliza a omissão — exatamente como o relatório. | E2E `investments-v2` confere o patrimônio do dashboard contra o resumo oficial. |
| INV-P2-017 | FIXED | A métrica diária — único dos quatro que o produto não lê — passa a ser fragmentada em 10 partes, agregadas na leitura. Os outros três permanecem no… | `domainV2` — 8 aportes concorrentes: todos comitam, e posição, resumo, série mensal e **todas** as 8 dimensões de alocação fecham exatamente. Retry… |
| INV-P2-018 | FIXED | A cerca detecta a mudança e **reinicia** a execução sobre a versão nova, com `cutoffAt` novo e `restartCount` auditável; só falha ao esgotar… | Coberto pelas suítes de rebuild; o reinício é observável em `restartCount` no snapshot e no resultado. |
| INV-P2-019 | FIXED | Cron diário `processInvestmentDriftScan` **amostrado por rodízio**: cada execução confere uma fatia de 50 workspaces com o domínio ativo, avançando… | `crons/__tests__/investmentDrift.integration.test.ts` (6 casos): regra de comparação, workspace limpo, deriva injetada no resumo, divergência entre… |
| INV-P2-020 | FIXED | `secrets: ["GOOGLE_AI_API_KEY"]` declarado nas duas, junto de região, timeout e memória próprios. O provisionamento do segredo é passo de… | `ai/__tests__/callables.test.ts` (7 casos): declaração do segredo, recusa controlada em pt-BR sem segredo, chave curta tratada como ausente, conteúdo… |
| INV-P2-021 | FIXED | A flag passa a exigir lote aplicado, concluído, não simulado e não revertido quando existe histórico legado. Os laços de reconciliação falham… | `legacyMigration` — recusa sem migração, sobre simulação e sobre lote incompleto; e recusa por reconciliação quando há deriva injetada na posição. |
| INV-P2-022 | FIXED | `assertNotFuture` (com tolerância de 5 min de relógio) nas três operações, `settledAt >= occurredAt` do pedido e `reversedAt >= settlementAt` do… | Coberto pelas suítes de domínio; as invariantes falham fechado com mensagem em pt-BR. |
| INV-P2-023 | FIXED | Resolvido por INV-P1-005: a reconstrução agora roda com valorações, então a mensagem passa a apontar para um remédio que existe. | `m7Reports` — rebuild com valorações conclui. |
| INV-P2-024 | FIXED | `KpiNature` (`caixa`, `patrimonio`, `contribuicao`, `rendimento`, `indicador`) declarada por indicador e exibida no card. "Investimentos" permanece… | Coberto por `investment-reporting` e pelo E2E de relatório. |
| INV-P2-025 | FIXED | Onboarding e cadastro patrimonial passam a montar apenas com `investmentsV2.enabled`. A área operacional (owner-only) continua visível e é o caminho… | E2E `investment-onboarding` — com a flag desligada a seção não existe e o legado continua inteiro. |
| INV-P2-026 | FIXED | Contrato, documento e Rules aceitam o par `id`/`name` de cada dimensão; o formulário oferece os itens do catálogo do workspace. O nome é fotografado… | Coberto pelas suítes de contrato de documento e de Rules do domínio. |
| INV-P2-027 | FIXED | Seletor "Como medir o progresso" no formulário de meta, com explicação do que cada base significa. | Coberto por `investment-reporting` (`mapGoalDocument`) e pelo E2E de metas. |
| INV-P2-028 | FIXED | Nova operação `changeInvestmentGoal`: desvínculo e vínculo no **mesmo** limite transacional, com dois movimentos de IDs determinísticos e trilha que… | E2E de duplo clique em `investments-v2`; matriz de papéis em `writeStrategy.test`. |
| INV-P2-029 | FIXED | A lista acompanha a fonte do número: com o domínio ligado, lê `investment_movements` por `goalId`, com rótulo em pt-BR por operação. Índice composto… | Coberto pelo E2E de metas (`goal-contributions`). |
| INV-P2-030 | FIXED | Teto de 2.000 aportes com `orderBy` e `limit`, espelhando o que `goals/operations.ts` já aplicava no caminho de callable. Ultrapassá-lo falha… | Coberto pela suíte de integridade de metas e pelo E2E de metas. |
| INV-P2-031 | FIXED | `rateLimits.ts` com política declarada por operação (pesada, administrativa, mutação, cadastro), consumida dentro da transação. A verificação… | `shared/__tests__/rateLimit.integration.test.ts` cobre teto, isolamento por ator e workspace, expiração de janela e concorrência. |
| INV-P2-032 | FIXED | Baixa lógica: `voidedAt`/`voidedBy`/`voidReason`. Rules com `allow delete: if false` e transição de baixa validada. `getTransactions`,… | `m4-hardening.rules` — delete negado nos três papéis; baixa aceita; autor da baixa não forjável; documento baixado não volta a ser editável. |
| INV-P2-033 | FIXED | Filtro `archived == false` no servidor com ordenação determinística, mais uma consulta limitada que recupera documentos anteriores ao campo — que o… | Coberto pelo E2E de metas e pelas Rules de `goals`. |
| INV-P2-034 | FIXED | Consulta ordenada com teto explícito de 2.000 itens e sinal de truncamento. O caminho paginado continua disponível para as telas de administração. | Coberto pelo E2E de Cadastros. |
| INV-P2-035 | FIXED | `useFinancialReportSnapshot` aceita `includeInvestmentDomain: false`. O widget não exibe nenhum indicador patrimonial e passa a declará-lo. | Coberto pelo E2E de dashboard. |
| INV-P2-036 | FIXED | `safeErrorMessage()` compartilhado; os logs de falha passam a emitir só operação, ator e código de erro. | Coberto pelas suítes de observabilidade de cartões. |
| INV-P2-037 | FIXED | `requireWorkspaceRole` nas duas callables, código por `randomInt` (CSPRNG, 10 chars/31 símbolos ≈ 49 bits), limite de frequência consumido **em toda… | Cobertura de comportamento em `functions/src/callables/__tests__/splitGroups.integration.test.ts`. |
| INV-P2-038 | FIXED | Zod `.strict()`, allowlist `STRIPE_ALLOWED_PRICE_IDS`, validação de origem por `URL.origin` contra `APP_ALLOWED_ORIGINS`, limite de frequência por… | `functions/src/callables/__tests__/billing.test.ts` — allowlist de preço e de origem, incluindo sufixo de domínio malicioso. |
| INV-P2-039 | FIXED | `shared/observabilityKeys.ts`: `idempotencyKeyDigest()` persiste digest, `boundedFailureEventId()` deriva o ID da intenção (chave) ou de um balde… | `failureObservability.integration.test.ts` — 5 tentativas com `correlationId` distinto geram **1** documento; chave crua ausente. |
| INV-P2-040 | FIXED | `MAX_DAILY_BUCKETS = 2000` com erro de domínio explícito ao ser atingido, somado aos tetos já existentes de períodos e faixas de alocação. Nenhum… | Coberto pelas suítes de rebuild; o teto falha fechado nomeando a dimensão. |
| INV-P2-041 | FIXED | `shared/retention.ts` com política por coleção e campo `expiresAt` — 90 dias para chaves de idempotência, 400 para métricas e eventos, 2 para… | Cobertura em `rateLimit.integration.test.ts`, que asserta a forma exata do documento de contador. |
| INV-P2-042 | FIXED | `shared/runtimeOptions.ts` com `setGlobalOptions({region})` em `index.ts`, opções por classe de callable e `getFunctions(app, region)` no cliente. | Build de Functions; corte de região documentado em PRODUCTION_DEPLOYMENT_CHECKLIST.md. |
| INV-P2-043 | FIXED | `operationLease.ts` — lease por workspace e classe de operação, adquirido na transação da página, com TTL de 15 min para que uma execução morta não… | `legacyMigration` — uma segunda migração é recusada enquanto a primeira detém o lease, e a dona do lease continua avançando até concluir. |
| INV-P2-044 | FIXED | (1) A validação passou a rodar **depois** do `Promise.all`, nos quatro pontos. (2) Os pacotes de ícones passaram a ser importados dinamicamente e por… | Integração: **3 execuções consecutivas** verdes, 105 + 62 casos, zero falhas. E2E: **2 execuções consecutivas** verdes, 24 de 24. O teste de duplo… |
| INV-P2-045 | FIXED | O resto passa a ser `patrimônio total − faixas visíveis`, cobrindo tanto as faixas carregadas e não exibidas quanto as truncadas pela consulta, e a… | E2E PJ confere o percentual da faixa contra o patrimônio do resumo. |
| INV-P2-046 | FIXED | `trendBasis` distingue `sign` de `period`. Sinal exibe "Positivo"/"Negativo"; "Alta"/"Baixa" só com `trendPercentage` de comparação real. | Coberto pelo build de tipos e pelo E2E de relatórios. |
| INV-P2-047 | FIXED | `isExposedPosition()` compartilhada: o incremental passa a contar a transição de exposição, com a mesma definição do rebuild. | Coberto pelas suítes de rebuild, que comparam `positionCount` publicado com o reconstruído. |
| INV-P2-048 | FIXED | `reports/dateWindow.ts` resolve o offset pelo formatador do runtime — correto sob horário de verão — e o recorte passa a comparar strings… | `tests/unit/report-window.test.ts` — instante às 22:00 BRT (01:00 UTC do dia seguinte) mantém a janela no dia correto, inclusive na virada de mês e… |
| INV-P2-049 | FIXED | Ramo único; guardas de documento avaliadas uma vez; as 14 `hasAny` viram `data.get(chave, padrão)`. A margem liberada foi o que tornou seguro… | `m4-hardening.rules` — `update` com **todas** as chaves mutáveis de uma vez é aceito para owner e member. |
| INV-P3-050 | FIXED | `resolveInvestmentAccountNames`/`resolveInvestmentAssetNames` resolvem por `documentId() in [...]` em blocos de 30, com `limit` exigido pelas Rules,… | Coberto pelo E2E da tabela de posições. |
| INV-P3-051 | FIXED | `requestedPrincipalCents`/`requestedQuantityMicros` preservam o pedido e `residualPrincipalCents`/`residualQuantityMicros` explicitam o saldo não… | `domainV2` — resgate parcial com prejuízo confere posição, caixa e residual. |
| INV-P3-052 | FIXED | As quatro passam a chamar `authorizeInvestmentTransaction` na fase de leitura, com os papéis vindos da mesma matriz declarativa. A matriz registra… | `writeStrategy.test.ts` — teste que percorre a matriz inteira e exige revalidação de **toda** operação transacional; falharia se uma operação nova… |
| INV-P3-053 | FIXED | Allowlist de chaves em `workspaces` (create e update) e em `members`; tetos de valor (R$ 1 bi), descrição (300), categoria (120), fornecedor/centro… | `m4-hardening.rules` — campos arbitrários negados em workspace e membership; valor e descrição acima do teto negados; caminho legítimo aceito. |
| INV-P3-054 | FIXED | `.env`, `.env.*`, `functions/.env*`, `*.pem`, service accounts e estado local de ferramentas passam a ser ignorados. | `git check-ignore -v` para `.env.local`, `functions/.env` e `.claude/settings.local.json`. |
| INV-P3-055 | FIXED | Removido. Os índices declarados passam a corresponder um a um às consultas do produto, incluindo os novos de janela por `date`, de… | `firestore.indexes.json` conferido contra as consultas; suíte de integração e E2E verdes com os índices atuais. |
| INV-P3-056 | FIXED | Padrão ARIA completo: `aria-controls`, `tabpanel` com `aria-labelledby`, `tabIndex` itinerante e navegação por setas. | Verificado no E2E, que navega as abas por papel ARIA. |
| INV-P3-057 | FIXED | Confirmação em `<dialog>` com foco preso, impacto declarado e trava de duplo submit, igual ao Cadastros. | Coberto pelo E2E da tela patrimonial. |
| INV-P3-058 | FIXED | `openEditor`/`changeTab` limpam o aviso; toda abertura de editor e troca de aba passa por eles. | Coberto pelo E2E da tela patrimonial. |

---

## 3. Achados novos da própria remediação

| ID | Severidade | O que era | Estado |
| -- | ---------- | --------- | ------ |
| NEW-01 | P2 | Regra catch-all contornava o teto de listagem de `cash_report_periods` | FIXED |
| NEW-02 | P1 | `reserveRateLimit` sem `commit()` nas duas callables de IA — teto decorativo | FIXED |
| NEW-03 | P1 | Ordenar por `transactionDate` fazia o histórico legado desaparecer da tela | FIXED |
| NEW-04 | P2 | Estorno de movimento migrado criava espelho de caixa duplicado | FIXED |
| NEW-05 | P2 | Rollback em ordem de `__name__` deixava a posição inconsistente | FIXED |
| NEW-06 | P1 | Meta acima de 2.000 aportes virava beco sem saída, sem rotina de volta | FIXED |
| NEW-07 | P2 | 3 MB de ícones no primeiro paint; falha de recurso disfarçada de flakiness | FIXED |

O detalhamento de cada um está em `PRODUCTION_REMEDIATION.md`.

---

## 4. Reavaliação por dimensão

| Dimensão | Antes | Depois | Prova |
| -------- | ----- | ------ | ----- |
| SaaS multiworkspace | Escrita cross-tenant possível pelo Admin SDK | Todo caminho privilegiado resolve o workspace por `requireWorkspaceRole`; nenhuma escrita usa `workspaceId` do payload cru | `failureObservability.integration.test.ts`; E2E `espelho de papel forjado não abre a área operacional` |
| Segurança e RBAC | `allow write` irrestrito ao próprio usuário; troca de `type` contornava a trilha legada | Allowlist de campos por documento; `type` imutável; `delete` negado; papel revalidado dentro da transação | 64 testes de Rules em 5 suítes |
| Correção financeira | Perda realizada inexistente; caixa podia divergir do fato | Centavos e micros inteiros, `BigInt` half-up; perda com campo próprio; caixa = principal + ganho − perda − taxas − imposto | `domainV2`, `m7Reports`, `redemption` |
| Idempotência | Chave alcançável por repetição de payload | Reserva atômica com `requestHash`; replay devolve o resultado anterior | `retry da mesma intenção sob concorrência não duplica o fato` |
| Concorrência | Recomposição de meta sem limite dentro de transação | Transações com leitura antes de escrita; lease por classe de operação | `aportes concorrentes não perdem atualização em nenhuma projeção` |
| Escalabilidade e paginação | Leitura do histórico inteiro a cada carga | Toda listagem com `orderBy` determinístico, `limit` e cursor; janela de 12 meses por padrão | Revisão de escala/custo; `firestore.indexes.json` com 44 índices |
| Custo Firestore | Saldo exigia varrer `transactions` | Projeção mensal `cash_report_periods` (≤600 documentos) mantida por delta e reconstruível | `cash/__tests__/periods.integration.test.ts` |
| Observabilidade | Métrica gravada sem workspace autorizado | Falha vira log sanitizado; `expiresAt` nas coleções operacionais | `observabilityKeys.ts`; checklist de TTL |
| Reconciliação | Migração declarava sucesso sem conferir | `reconcileLegacyMigration` compara principal e resultado em centavos; a flag só liga com reconciliação fechada | `a flag só liga depois da reconciliação` |
| Migração e reversibilidade | `dryRun` compartilhava lote com a execução real | `migrationId` deriva de modo e tentativa; rollback compensa sem apagar nada | `migrar, reverter e remigrar devolve os totais corretos nas três etapas` |
| Deriva | Inexistente | Rotina diária compara projeção e fatos, com rodízio de 50 workspaces | `crons/__tests__/investmentDrift.integration.test.ts` |
| Testabilidade | 79 declarações de teste | 314 declarações; nenhum teste removido, skipado ou relaxado | `git grep` comparativo entre base e `HEAD` |
| Acessibilidade | — | Diálogos com papel e rótulo; navegação por teclado exercitada no E2E | Suíte E2E |
| PF e PJ | Alocação PF regredida | PF (finalidade, meta, classe, liquidez) e PJ (finalidade, classe, liquidez, conta) explícitos | `PJ classifica a finalidade sem recair em aposentadoria`; `PF sem meta fica sem meta e não classificado` |
| Compatibilidade com o legado | Ordenação escondia documentos antigos | Leitura por `date`, exigido pelas Rules em toda transação | Smoke de regressão com a flag desligada |

---

## 5. Gates executados

| Gate | Comando | Resultado |
| ---- | ------- | --------- |
| Tipos | `npm run typecheck` | exit 0 |
| Lint Functions | `npm run functions:lint` | 0 erros, 2.191 avisos de formatação |
| Build frontend | `npm run build` | exit 0 |
| Build Functions | `npm --prefix functions run build` | exit 0 |
| Unitários Functions | `npm run functions:test:unit` | 87/87 |
| Unitários frontend | `npm run test:unit:investments` | 35/35 |
| Integração + Rules | `npm run test:integration:emulator` | 106/106 + 64 de Rules, 3 execuções |
| E2E | `npm run test:e2e` | 29/29, 2 execuções consecutivas |
| Segurança multi-tenant | skill `multi-tenant-security-review` | PASS |
| Escala e custo Firestore | skill `firestore-scale-cost-review` | PASS (após NEW-06) |
| Integridade do domínio financeiro | skill `financial-domain-integrity` | PASS |
| Gate de regressão | skill `regression-release-gate` | PASS |

Nenhum teste foi pulado. Nenhuma asserção foi relaxada. Nenhum limiar foi
reduzido.

---

## 6. Riscos residuais

1. **Pré-requisitos externos não executados.** Segredos, TTL, índices, região
   das Functions e backfill dependem de projeto real e estão em
   `PRODUCTION_DEPLOYMENT_CHECKLIST.md`. Enquanto não forem cumpridos, o
   rollout não deve começar.
2. **Módulos adjacentes com leitura ilimitada.** `recurring-expenses`, `loans`
   e `split-bills` mantêm `getDocs` sem `limit`. São anteriores a esta
   remediação, não foram tocados por ela, e não estavam entre os 58 achados.
   Ficam registrados como dívida conhecida.
3. **Teto de 2.000 aportes para refazer vínculo em lote.** É limite físico da
   transação do Firestore, não uma pendência: acima disso o ajuste é por
   aporte. O progresso continua correto por delta e reconciliável pela
   reconstrução paginada.
4. **Rollout por workspace.** A migração é retomável e reversível, mas a
   sequência simular → aplicar → reconciliar → habilitar precisa ser seguida
   por workspace; ligar a flag sem reconciliação é recusado pelo backend.

---

## 7. Veredito

O módulo está **tecnicamente pronto** para uso real e rollout controlado, com
os 58 achados fechados por código e prova, e os 7 achados novos igualmente
fechados.

Não declaro "pronto para produção" em sentido operacional: os itens da seção 6.1
dependem de acesso a projeto real e **nenhum deles foi executado** nesta
remediação — nenhum deploy, nenhuma migração em produção, nenhum acesso a dados
reais, nenhum segredo real.
