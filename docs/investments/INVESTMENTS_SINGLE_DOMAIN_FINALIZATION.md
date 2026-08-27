# Investimentos — domínio único

Encerramento da coexistência legado ↔ V2. A partir daqui existe **uma**
arquitetura de investimentos, sem flag, sem migração e sem caminho de leitura
alternativo. Este documento é o registro do que saiu, do que ficou e do porquê.

---

## 1. Arquitetura anterior

Duas trilhas escreviam a mesma grandeza em lugares diferentes, e uma flag por
workspace (`features.investmentsV2.enabled`) decidia qual delas o produto lia.

| | Trilha legada (M1/M2) | Domínio patrimonial (V2) |
|---|---|---|
| Fato | `transactions` com `type: 'investimento'` | `investment_movements` |
| Posição | não existia | `investment_positions` |
| Patrimônio | soma de transações | `investment_summaries` |
| Série histórica | derivada na leitura | `investment_report_periods` |
| Alocação | categoria da transação | `investment_allocation_summaries` |
| Progresso de meta | `netContributionCents` | `investmentProgressCents` |

Para as duas coexistirem sem somar em dobro, o produto acumulou camadas de
compatibilidade — cada uma criada para fechar um defeito real:

- **a flag** era a única chave de troca de fonte: nunca houve período de fonte
  dupla;
- **`assertLegacyInvestmentTrailOpen`** existia porque a flag sozinha vazava —
  com o domínio ligado, um aporte gravado pela trilha legada saía do caixa e
  nunca chegava ao patrimônio;
- **`legacyMigration.ts`** trazia o histórico de `transactions` para o ledger,
  porque o backfill só reconstrói projeções sobre movimentos que já estão em V2;
- **`reconcileLegacyMigration` + `enableInvestmentsV2Flag`** eram o portão
  one-shot: a flag só ligava depois de a reconciliação fechar em centavos;
- **`isInvestmentsV2Projection`** existia porque o espelho de caixa da V2 tem
  `type`/`status`/`investmentOperation` idênticos aos de um aporte legado, e a
  migração o reclassificava, dobrando o principal (INV-P1-010).

## 2. Por que o legado foi removido

O sistema está em desenvolvimento. O projeto Firebase em uso não tem dados
financeiros de clientes, não há usuários que dependam do fluxo legado e não há
compatibilidade histórica a preservar. Sem base a migrar, toda essa camada
deixou de proteger alguma coisa e passou a ser apenas superfície: duas fontes
para cada grandeza, duas leituras em cada tela, dois contratos em cada teste, e
um passo em Configurações antes de o usuário conseguir usar o módulo.

## 3. Arquitetura final

```
investment_movements ............. ledger: os fatos financeiros oficiais
investment_valuations ............ fatos de valoração
investment_positions ............. estado patrimonial atual, derivado
investment_summaries ............. agregação atual
investment_report_periods ........ série histórica patrimonial
investment_allocation_summaries .. cortes de alocação (8 dimensões)
investment_snapshots ............. checkpoint retomável de operação pesada
transactions ..................... receitas, despesas, parcelamentos e o
                                   espelho de caixa dos movimentos
```

**Fonte de verdade patrimonial: `investment_movements`.** Toda projeção é
derivada dele e reconstruível por `rebuildInvestmentProjections`,
`recalculateInvestmentPosition` e `recalculateGoalInvestmentProgress`.

### Projeção para `transactions`

Continua existindo, **unidirecional**, e só nesse sentido:

```
callable V2 → runTransaction {
    reserva idempotência (replay curto-circuita)
  → grava investment_movements/{inv_hash}
  → writePosition / summary / report_period / allocation / goal
  → writeCashProjection: set(transactions/investment_{movementId}, merge:true)
} → onTransactionWrite → delta em cash_report_periods
```

Garantias, todas verificáveis no código:

- **unidirecional**: não existe mais nenhum caminho `transactions → patrimônio`;
- **sem dupla contagem**: só operações com `affectsCashProjection: true`
  escrevem espelho (`writeStrategy.ts`); valoração e vínculo/desvínculo de meta
  não escrevem;
- **idempotente**: o id do espelho deriva do id do movimento, e a escrita é
  `set(..., {merge: true})`;
- **multi-tenant-safe**: o caminho é montado a partir do `workspaceId`
  autorizado por `requireWorkspaceRole`, nunca do payload;
- **`transactions` nunca é fonte de verdade patrimonial**: o espelho carrega
  `investmentMetadata.domainMovementId` e `domainVersion`, e é a única coisa
  que o produto lê dali para investimentos — para efeito de **caixa**.

## 4. Arquivos removidos

| Arquivo | Linhas | Por quê |
|---|---:|---|
| `functions/src/investments/legacyMigration.ts` | 1420 | migração, reconciliação, rollback e habilitação da flag |
| `functions/src/investments/operations.ts` | 621 | trilha legada M2 de resgate sobre `transactions` |
| `functions/src/investments/operationLease.ts` | 133 | único adquirente era a migração |
| `functions/src/shared/featureFlags.ts` | 38 | a flag e a barreira server-side |
| `functions/src/investments/__tests__/legacyMigration.integration.test.ts` | 691 | migração |
| `functions/src/investments/__tests__/redemption.integration.test.ts` | 328 | trilha legada de resgate |
| `functions/src/investments/__tests__/legacyMigrationOrdering.integration.test.ts` | 151 | ordenação da migração |
| `functions/src/investments/__tests__/integrity.test.ts` | 91 | contrato do resgate legado |
| `functions/src/goals/__tests__/goalProgressScale.integration.test.ts` | 165 | teto de varredura de aportes legados |
| `e2e/investment-redemption.spec.ts` | 105 | resgate pelo modal de transação |
| `src/components/BusinessAllocationAnalysis.tsx` | 257 | diagnóstico PJ sobre `transactions` |
| `src/components/AllocationAnalysis.tsx` | 252 | diagnóstico PF sobre `transactions` |
| `src/modules/allocations/{logic,types}.ts` | 188 | idem |
| `src/modules/business-allocations/{logic,types}.ts` | 163 | idem |

**Total: 16 arquivos, 4.603 linhas.** Somando as remoções dentro de arquivos
que ficaram, a base perdeu cerca de **4.600 linhas de código morto** de
coexistência.

## 5. Código morto eliminado dentro de arquivos que ficaram

- **`callables.ts`**: 7 callables (3 de resgate legado + 4 de migração).
- **`contracts.ts`**: `baseSchema`, `moneySchema`, `dateOnlySchema` e os
  aliases `documentIdSchema`/`workspaceIdSchema`/`idempotencyKeySchema` — todos
  usados exclusivamente pelos schemas legados; mais 7 schemas e 7 tipos.
- **`infrastructure.ts`**: 7 membros de `InvestmentBackendOperation`.
- **`writeStrategy.ts`**: 6 planos de escrita e o alvo `investment_audit_logs`.
- **`rateLimits.ts`**: 6 políticas.
- **`operationsV2.ts`**: o ramo `isMigratedMovement` do estorno.
- **`domain.ts` / `documentContracts.ts`**: `migratedFromTransactionId` e
  `migrationId` no contrato do movimento.
- **`paths.ts`**: `investment_operation_leases`.
- **`crons/investmentDrift.ts`**: o filtro por flag no rodízio de workspaces.
- **`triggers/transactions.ts`**: `linkedGoalId`, `goalContributionDelta` e a
  recomposição legada de progresso de meta (o arquivo caiu de 219 para 109
  linhas).
- **`goals/operations.ts`**: `executeSaveGoalContribution`,
  `executeSetGoalTransactionLinks`, `executeRebuildGoalProgress`,
  `contributionMinorUnits`, `isSettledGoalContribution`, `sumGoalContributions`,
  `goalContributionsQuery`, `assertGoalContributionsWithinLimit`,
  `goalNetContributionBase` (865 → 413 linhas).
- **Frontend**: o formulário de investimento do `TransactionModal`, o braço
  `viewType === 'investimento'` do `TransactionsView`, a seção de vínculo
  retroativo do `GoalFormModal`, `listInvestmentTransactions`,
  `useInvestmentTransactions`, `saveRedemption`, `saveLinkedContribution`, e os
  wrappers de migração de `operationsApi.ts`.

## 6. Callables removidas (10)

A superfície implantada caiu de **53 para 43** funções.

| Removida | Substituta oficial |
|---|---|
| `saveInvestmentRedemption` | `createInvestmentRedemption` + `settleInvestmentRedemption` |
| `cancelInvestmentRedemption` | `cancelInvestmentMovement` |
| `reverseInvestmentRedemption` | `reverseInvestmentMovement` |
| `migrateLegacyInvestments` | — (não há histórico a migrar) |
| `rollbackLegacyInvestmentMigration` | — |
| `reconcileLegacyMigration` | — (`reconciliationDifference` dos relatórios é outra coisa e permanece) |
| `enableInvestmentsV2Flag` | — (não há flag) |
| `saveGoalContribution` | `createInvestmentContribution` com `goalId` |
| `setGoalTransactionLinks` | `linkInvestmentToGoal` / `changeInvestmentGoal` |
| `rebuildGoalProgress` | `recalculateGoalInvestmentProgress` |

`functions/src/shared/deploymentContract.test.ts` passou a falhar se qualquer
uma delas voltar à superfície implantada.

### Mudança de comportamento a registrar

Aportar numa meta deixou de ser um lançamento de transação. O caminho é
**Investimentos → Novo aporte**, com a meta escolhida no formulário — o mesmo
que a flag ligada já impunha (`App.tsx` desviava `openGoalContributionModal`
para a tela patrimonial). O vínculo retroativo de transações a metas foi
removido junto: ele não era gateado pela flag e conseguia carimbar `goalId` num
espelho de caixa da V2, contando o mesmo aporte duas vezes no progresso da meta.

## 7. Rules e índices

**`firestore.rules`**

- `investmentsV2Enabled(workspaceId)` removida. Era o único ponto do arquivo que
  lia `features`, e custava um `get()` por escrita de investimento.
- `isLegacyInvestmentWriteAllowed(data)` passa a ser negação incondicional
  (`data.type != 'investimento'`), aplicada no `create` e no ramo de edição do
  `update` de `transactions`. Receita, despesa e parcelado não são afetados: o
  predicado é uma comparação de igualdade sobre `type`.
- `isValidLegacyInvestmentAudit` e `match /investment_audit_logs` removidos — a
  coleção não tem mais gravador. Ela cai no catch-all, que nega leitura de toda
  coleção `investment_*`.
- `match /investment_operation_leases` removido pelo mesmo motivo.
- `'legacy_migration'` sai do enum de `kind` de `isValidInvestmentSnapshot`.

**`firestore.indexes.json`** — 50 → 47 índices:

- `investment_movements (migrationId, __name__)`;
- `investment_movements (migrationId, occurredAt, __name__)` — servia só a query
  de rollback;
- `transactions (type, date, __name__)` — servia a varredura da migração e
  `listInvestmentTransactions`, ambas removidas.

## 8. Testes

| | Antes da remoção | Depois da remoção | Depois do fechamento de riscos |
|---|---:|---:|---:|
| Unitários de Functions | 106 | 100 | 100 |
| Unitários de investimentos | 35 | 35 | 35 |
| Integração no Emulator | 135 | 107 | 116 |
| Rules (6 suítes) | 68 | 68 | 69 |
| E2E | 28 | 26 | 26 |

A última coluna é o estado atual, e o que ela acrescenta são as provas dos
§§15–17: 4 casos de reentrega do gatilho de caixa, 4 de concorrência de
reconstrução, 1 de fonte única do progresso de meta e 1 de Rules sobre a marca
de entrega.

A queda vem exclusivamente de testes cujo objeto deixou de existir. O que foi
**acrescentado** para não perder cobertura:

- `deploymentContract.test.ts` — "nenhuma callable legada de investimento é
  exportada" (guarda contra reintrodução das 10);
- `goalIntegrity.integration.test.ts` — "arquivar preserva o histórico e
  registra o progresso patrimonial";
- `pagedRunContract.integration.test.ts` — "o backfill conclui num workspace com
  posições reais" (ver §11);
- `e2e/investments-v2.spec.ts` — "workspace novo abre Investimentos sem flag e
  sem migração" e "resgate com lucro liquidado pela tela reduz posição e publica
  ganho";
- `e2e/investment-onboarding.spec.ts` — "cadastro patrimonial aparece em
  workspace novo, sem preparo";
- `e2e/goal-contributions.spec.ts` — reescrito para o caminho oficial: "aporte
  vinculado à meta publica progresso e projeta caixa uma vez";
- `m4-hardening.rules` — a negação de escrita direta de investimento virou
  incondicional, e um caso novo prova que uma coleção `investment_*` sem bloco
  `match` cai negada no catch-all.

Cobertura exigida, e onde vive:

| Item | Onde |
|---|---|
| workspace novo sem flag | `e2e/investments-v2.spec.ts`, `e2e/investment-onboarding.spec.ts` |
| PF / PJ completos | `e2e/regression-smoke.spec.ts` (2 personas), `domainV2.integration.test.ts` |
| aporte | `domainV2.integration.test.ts`, `e2e/investments-v2.spec.ts` |
| resgate com lucro | `domainV2.integration.test.ts`, `e2e/investments-v2.spec.ts` |
| resgate com prejuízo | `domainV2.integration.test.ts`, `reporting.test.ts` |
| resgate parcial / total | `domainV2.integration.test.ts` |
| cancelamento | `m3Lifecycle.integration.test.ts`, `e2e/investments-v2.spec.ts` |
| reversão | `domainV2.integration.test.ts`, `m7Reports.integration.test.ts` |
| valoração | `m3Lifecycle`, `m7Reports`, `e2e/investments-v2.spec.ts` |
| posição | `domainV2.integration.test.ts`, `documentContracts.test.ts` |
| reports / gráfico histórico | `m7Reports.integration.test.ts`, `tests/unit/investment-reporting.test.ts` |
| metas | `domainV2.integration.test.ts`, `e2e/goal-contributions.spec.ts`, `e2e/investment-operations.spec.ts` |
| alocação | `m7Reports`, `e2e/investments-v2.spec.ts` (PF), `e2e/investment-operations.spec.ts` (PJ) |
| rebuild / backfill | `pagedRunContract`, `m3Lifecycle`, `m7Reports`, `e2e/investment-operations.spec.ts` |
| replay / idempotência | `domainV2`, `pagedRunContract`, `tests/unit/investment-idempotency.test.ts` |
| concorrência | `domainV2.integration.test.ts`, `m3Lifecycle` |
| RBAC / cross-tenant | `domainV2`, `writeStrategy.test.ts`, `e2e/investment-operations.spec.ts`, 4 suítes de Rules |
| Rules | `tests/firestore/*.mjs` (6 suítes) |
| cash projection | `cash/__tests__/periods.integration.test.ts`, `m4-hardening.rules` |
| ausência de dupla contagem | `domainV2.integration.test.ts`, `m7Reports`, `e2e/goal-contributions.spec.ts` |
| onboarding / contas / ativos / arquivamento | `domainV2`, `e2e/investment-onboarding.spec.ts`, `goalIntegrity` |
| scheduler não duplica | `crons/__tests__/recurring.integration.test.ts`, `schedulerHandlers.integration.test.ts` |

## 9. Limpeza de dados de teste

`tools/investments/limpar-investimentos.mjs`. Simulação por padrão; nada é
escrito sem `--apply` **e** `--confirmar` repetindo o workspace.

```bash
# 1. Inventário (não escreve nada)
node tools/investments/limpar-investimentos.mjs \
  --projeto=<projeto-de-dev> --workspace=<workspaceId>

# 2. Excluir projeções e espelhos, preservando o ledger
node tools/investments/limpar-investimentos.mjs \
  --projeto=<projeto-de-dev> --workspace=<workspaceId> \
  --apply --confirmar=<workspaceId>

# 3. Zerar o domínio inteiro do workspace, ledger incluído
node tools/investments/limpar-investimentos.mjs \
  --projeto=<projeto-de-dev> --workspace=<workspaceId> --incluir-ledger \
  --apply --confirmar=<workspaceId>

# 4. Remover também as transações de investimento ANTERIORES ao domínio único
node tools/investments/limpar-investimentos.mjs \
  --projeto=<projeto-de-dev> --workspace=<workspaceId> \
  --include-legacy-investment-transactions \
  --apply --confirmar=<workspaceId> --confirmar-legado=<workspaceId>

# Contra o Emulator, exporte o host antes:
#   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

`--projeto` substitui a variável `PROJETO`, que continua aceita como fallback.

### Classificação de `transactions`

O utilitário imprime, documento a documento, **por que** cada um sai ou fica.
São três classes, e só a primeira sai por padrão:

| Classe | Critério | Comportamento |
|---|---|---|
| espelho de caixa do domínio | `investmentMetadata.domainMovementId` ou `domainVersion` — campos que as Rules proíbem o cliente de gravar | removido; é derivado e reconstruível a partir do ledger |
| investimento legado | `type == 'investimento'` **sem** marcador do domínio | preservado; só sai com `--include-legacy-investment-transactions` |
| fora do domínio | qualquer outro `type` | nunca é lido: a consulta filtra `type == 'investimento'` |

A segunda classe exige confirmação **própria** (`--confirmar-legado`) porque,
diferente do espelho, ela não é reconstruível: é fato antigo sem ledger por
trás. `--apply --confirmar` sozinho não a remove.

Guardas, todas exercitadas:

- recusa sem `PROJETO`;
- recusa o projeto de produção pelo id literal;
- recusa qualquer projeto cujo nome não contenha `stag|homolog|dev|test|local`,
  exceto sob Emulator;
- recusa sem `--workspace`; não existe modo "todos";
- recusa `--apply` sem `--confirmar` idêntico ao workspace;
- **nunca** apaga usuários do Auth, o documento do workspace, receitas,
  despesas, parcelamentos, metas ou catálogo;
- recusa opção desconhecida, em vez de ignorá-la em silêncio;
- recusa `--include-legacy-investment-transactions` com `--apply` sem
  `--confirmar-legado` idêntico ao workspace;
- em `transactions`, por padrão só remove documentos com
  `investmentMetadata.domainMovementId` ou `domainVersion` — campos que as Rules
  proíbem o cliente de escrever. Toda outra transação `investimento` é listada
  como **preservada**, com o motivo e a opção que a removeria;
- em `goals`, remove apenas os campos de progresso derivado; a meta permanece;
- idempotente: repetir não muda o resultado (a segunda passagem relata
  `total afetado: 0`);
- imprime cada documento afetado, o motivo da classificação e um relatório
  final por coleção.

**Não execute automaticamente.** Rode a simulação, leia o relatório, e só então
aplique.

**Exercitado apenas no Emulator.** O roteiro de conferência cobre as quatro
guardas, a simulação (que deixa o workspace intacto), a aplicação padrão, a
aplicação com legado e a repetição de ambas. Em todas as passagens,
`tx-receita`, `tx-despesa`, `tx-parcelado`, `credit_cards`, `loans`,
`split_groups`, `recurring_expenses` e o documento da meta permaneceram — só o
progresso derivado da meta saiu. Nunca foi executado contra projeto real.

## 10. Reset de desenvolvimento e corte de região

Estado confirmado no código: Firestore em `southamerica-east1`
(`firebase.json:4`), `GLOBAL_FUNCTION_OPTIONS.region` em `southamerica-east1`
(`functions/src/shared/runtimeOptions.ts`), e `getFunctions(app, 'southamerica-east1')`
no frontend (`src/lib/firebase.ts`). Trocar a região de uma função implantada
não é edição no lugar: o Firebase cria a nova e a antiga continua existindo em
`us-central1`.

```bash
# 0. Validar que não há uso live
firebase functions:log --project <PROJETO> --only stripeWebhook | tail -50
gcloud logging read \
  'resource.type="cloud_function" AND resource.labels.region="us-central1"' \
  --project <PROJETO> --freshness=7d --limit=20

# 1. Stripe em TEST mode
#    Painel Stripe → chave começa com sk_test_ / pk_test_
firebase functions:secrets:access STRIPE_SECRET_KEY --project <PROJETO> | head -c 8

# 2. Gate local completo, antes de tocar no projeto
npm run verify:fast
npm run test:integration:emulator
npm run test:e2e

# 3. Remover as Functions antigas de us-central1
firebase functions:list --project <PROJETO>
#    Uma a uma, para conferir cada remoção:
firebase functions:delete <nome> --region us-central1 --project <PROJETO> --force
#    As 53 anteriores estão listadas em §6 e no histórico do deployment contract.

# 4. Deploy limpo das Functions atuais (43) em southamerica-east1
npm run deploy:functions

# 5. Rules e índices
npm run deploy:firestore

# 6. Frontend
npm run build && <comando de hospedagem do projeto>

# 7. Smoke completo
npm run test:e2e
```

Checklist de aceitação do corte:

- [ ] `firebase functions:list` não mostra nenhuma função em `us-central1`;
- [ ] `firebase functions:list` mostra 43 funções em `southamerica-east1`;
- [ ] `npm --prefix functions run test:unit` verde (o contrato de implantação
      trava região, contagem e perfis de execução);
- [ ] workspace novo abre Investimentos sem nenhum preparo;
- [ ] aporte, valoração e resgate com liquidação funcionam pela tela;
- [ ] o relatório mostra patrimônio e o dashboard mostra o resumo.

**Não execute deploy a partir deste repositório sem autorização explícita.**
`CLAUDE.md` proíbe push, merge e deploy pelo agente.

## 11. Defeito encontrado e corrigido no caminho

`backfill.ts` → `runToCompletion` decidia o fim de um rebuild interno por
`result.completed === true`. `recalculateInvestmentPosition` e
`recalculateGoalInvestmentProgress` **não devolvem `completed`** — devolvem
`hasMore`/`status`. Consequência: a primeira página concluía o alvo e marcava o
snapshot como `completed`; a segunda volta do laço batia em
`"Esta reconstrução já foi concluída."` e o backfill do workspace falhava.

O defeito só era alcançável num workspace que tivesse posição ou meta a
reconstruir, e nenhuma suíte exercitava esse caso — todas rodavam o backfill
sobre um domínio vazio, onde a fase `positions` não tem alvo e a execução vai
direto a `projections`. Corrigido para `hasMore === false || completed === true`
e coberto por `pagedRunContract.integration.test.ts`.

## 12. Rollback

**Somente de código.** Não existe rollback de arquitetura: a trilha legada não
volta, porque não há dado que dependa dela.

```bash
git revert <sha do commit desta mudança>
npm run verify:fast
npm run deploy:firestore   # as Rules voltam a ler features.investmentsV2
npm run deploy:functions
```

Reverter reintroduz as 10 callables removidas e a leitura de
`features.investmentsV2` nas Rules. Como nenhum workspace tem esse campo, todo
workspace passaria a ser lido como "flag desligada" — ou seja, o produto voltaria
a abrir a tela legada de investimentos, que não tem dado nenhum. Reverter só faz
sentido para desfazer um defeito introduzido aqui, e acompanhado de decisão
sobre o que fazer com o patrimônio já gravado no ledger.

## 13. Riscos residuais

Os dois riscos bloqueantes desta lista — reentrega do gatilho de caixa e
concorrência de reconstrução — foram fechados, e a prova de cada um está nos
§§15 e 16. O que permanece:

1. **`onTransactionWrite` e `stripeWebhook` sem `timeoutSeconds`/`memory`
   próprios.** Herdam o padrão da plataforma, e o `deploymentContract.test.ts`
   só assere recursos de callables e agendadas. É lacuna de contrato, não de
   comportamento.
2. **Sem alias de staging.** `.firebaserc` tem um único alias (`default` →
   produção). Todo script de Emulator usa `--project minhas-financas-local`, que
   é um id fictício. Qualquer ensaio descrito em `docs/investments/STAGING_*.md`
   não tem destino correspondente configurado.
3. **`investment_snapshots` de rollback.** O enum `status` das Rules aceita
   `running|completed`. Documentos com `rolled_back` gravados por execuções
   anteriores da migração ficam ilegíveis por `get`. Impacto de produto nulo —
   nenhuma tela lê a coleção — e a limpeza de dados de teste os remove.
4. **`domainVersion` não é dispatch.** Ver §14.
5. **Publicação parcial de uma reconstrução abandonada.** A publicação é
   paginada: um operador que pare de repaginar no meio deixa parte das
   projeções com valores da execução em curso e parte com os do caminho
   incremental. Não é divergência de valor — os dois caminhos calculam o mesmo
   número (§16) — e o snapshot fica `running`, retomável, com fase, cursor e
   versão esperada. O reparo é repaginar ou reexecutar. Vale para qualquer
   operação paginada do domínio, não só para esta.
6. **Hosting não está configurado.** `firebase.json` tem `firestore`,
   `functions` e `emulators`, e **nenhum bloco `hosting`**. `firebase deploy
   --only hosting` falha com "no hosting targets". Publicar o frontend exige,
   antes, um `firebase init hosting` (ou o bloco escrito à mão apontando para
   `dist`, com o rewrite de SPA). É configuração ausente, não regressão — o
   §10 já dizia "`<comando de hospedagem do projeto>`" em vez de um comando.
7. **TTL de `cash_period_events` é configuração de projeto.** A marca de
   entrega só é removida se a política de TTL estiver ativa (seção 2 do
   `TTL_MANIFEST.md`). Sem ativá-la, a coleção cresce um documento por escrita
   de transação — custo de armazenamento, não risco de correção. Ativá-la cedo
   demais **com prazo curto** é que seria risco: ver a nota do manifesto.

## 14. O que ainda menciona "V2" ou "legacy", e por quê

| Símbolo | Onde | Justificativa |
|---|---|---|
| `INVESTMENT_DOMAIN_VERSION = 2` / `domainVersion` | `domain.ts`, `documentContracts.ts:144`, `firestore.rules:579`, `operationsV2.ts:480` | **Permanente.** É o contrato do documento de movimento: `z.literal(2)` na escrita, `data.domainVersion == 2` no `allow get` de `investment_movements`, e um dos dois marcadores que identificam o espelho de caixa em `transactions`. Parar de gravá-lo nega todo `get` de movimento e cega a limpeza de dados de teste. Não foi generalizado para dispatch por versão porque não há consumidor — e criar essa camada agora seria código sem teste e sem uso. |
| `INVESTMENT_CALCULATION_VERSION = "investment-v2-cents-micros-half-up"` | `domain.ts:4` | **Permanente.** É a semântica de cálculo, gravada em movimento, posição e snapshot. O literal contém "v2" mas nomeia o arredondamento, não a coexistência. Renomeá-lo invalidaria documentos já gravados. |
| `operationsV2.ts` | nome do arquivo | Mantido. Renomear move 2.920 linhas num commit já grande e quebra toda referência de histórico e de documentação. É trabalho de renomeação pura, seguro de fazer em separado. |
| `InvestmentsPortfolioView` | `src/modules/investments/components/` | Nome adequado, sem "V2". Fica. |
| `seedLegacySettingsCatalog` | `functions/src/goals/callables.ts` | Outro domínio: semeia o catálogo de cadastros do workspace (categorias, carteiras, centros de custo). Nada a ver com investimentos. |
| `migrateLegacyInstallmentsToInvoiceDomain` | `src/modules/credit-cards/writeStrategy.ts` | Domínio de cartões. Fora do escopo desta mudança. |
| `centsFromReais` (era `centsFromLegacyValue`) | `semantics.ts` | Renomeado. O ramo que ele serve cobre documentos sem `valueCents`, não "legado de investimentos". |

---

## 15. Idempotência do gatilho de caixa (INV-P3-001)

### O defeito

`cash_report_periods` é mantido por delta: cada escrita em `transactions`
dispara `onTransactionWrite`, que aplica `depois − antes` com
`FieldValue.increment`. A entrega de um gatilho do Firestore é **pelo menos uma
vez** — o Eventarc reentrega o mesmo `event.id` quando a execução anterior não
confirma a tempo.

Não havia deduplicação. Uma reentrega somava o mesmo delta de novo, e o saldo
acumulado do workspace passava a mentir. Sem erro, sem log, e sem nada que a
distinguisse de um lançamento real — a reentrega chega com o mesmo `before`/
`after` de uma escrita legítima. O `activity_log` do **mesmo handler** já era
deduplicado por ID derivado do evento; o efeito financeiro, não.

`rebuildCashPeriods` corrigia, mas reconciliação não é defesa: é o que se roda
**depois** de já se ter percebido a divergência.

### A correção

`functions/src/cash/periods.ts` → `applyCashPeriodWriteOnce`.

```
onTransactionWrite → runTransaction {
    get(cash_period_events/{sha256(event.id)[0..40]})
      existe?  → não aplica nada, devolve os períodos da aplicação original
      não existe? → applyCashPeriodWrite (incrementos)
                  → create(marca)         ← mesma transação
}
```

Propriedade por propriedade:

| Exigência | Como é cumprida |
|---|---|
| mesma entrega duas vezes = um efeito | a marca é lida e criada na **mesma** transação do incremento; não há janela entre conferir e aplicar |
| create/update/delete | o dedupe envolve `applyCashPeriodWrite` inteiro, que já tratava os quatro casos (inclusive troca de mês, que escreve **dois** períodos) |
| atomicidade | uma única `runTransaction`: ou valem a marca e os incrementos, ou nenhum vale |
| escopo de workspace | `workspaces/{workspaceId}/cash_period_events/{chave}` — o caminho vem de `event.params`, nunca de payload |
| sem dado sensível no ID | o ID é `sha256(event.id)` truncado em 40 hex. O `event.id` carrega o caminho do documento e, com ele, o ID da transação; o hash preserva "mesma entrega, mesmo ID" sem levar identificador financeiro para o nome do documento |
| retenção | `expiresAt` = 90 dias (`RETENTION_DAYS.cashPeriodEvents`), contra um teto de reentrega de 7 dias. Registrado no `TTL_MANIFEST.md` |
| cliente não escreve | `firestore.rules`: bloco `match /cash_period_events/{docId} { allow read, write: if false; }` **e** a coleção na lista de `isBackendOwnedCollection`, para não herdar leitura do catch-all de subcoleção |
| sem full scan | acesso por ID de documento. Nenhuma consulta, nenhum índice novo |

`create` em vez de `set` é deliberado: se a marca aparecesse entre a leitura e o
commit — o que a serialização da transação já impede —, a escrita falha em vez
de sobrescrever. Falha fechada é o comportamento correto, porque o gatilho é
reentregue e uma execução perdida é reparável; um delta a mais, não.

**`rebuildCashPeriods` não mudou de papel.** Continua sendo reconciliação, que
publica valor absoluto a partir do ledger — e agora tem um teste que exige que
ela feche exatamente nos valores que o caminho deduplicado publicou, em vez de
ser o que segura a duplicação.

### Prova

`functions/src/cash/__tests__/periods.integration.test.ts`, 4 casos novos:

1. **a mesma entrega executada duas vezes move o caixa só uma vez** — o mesmo
   `event.id` é executado duas vezes em CREATE, em UPDATE com troca de mês e em
   DELETE. Em todos, o período fica idêntico ao de uma aplicação única
   (`netCents`, `transactionCount` e os dois meses da troca).
2. **a marca de entrega é por workspace e não guarda o `event.id`** — o ID é
   `[0-9a-f]{40}`, o ID da transação não aparece nele, `expiresAt` está
   presente, e a mesma chave em outro workspace não existe.
3. **duas entregas legítimas distintas são ambas aplicadas** — dois `event.id`
   diferentes somam os dois lançamentos (`transactionCount: 2`); reentregar as
   duas não muda nada.
4. **a reconstrução confere o caixa deduplicado sem alterá-lo**.

E em Rules: `m4-hardening.rules` — "a marca de entrega do caixa é invisível e
inescrevível pelo cliente": owner, admin e member não leem, não listam, não
forjam e não apagam; cross-tenant negado nos dois sentidos.

O E2E também exercita o caminho real: o emulador de Functions executa
`onTransactionWrite` de verdade nas 26 specs.

---

## 16. Concorrência de reconstrução (INV-P3-002)

### A pergunta

`operationLease.ts` saiu com a migração legada, seu único adquirente. Duas
reconstruções simultâneas do mesmo workspace ainda são seguras?

### O que segura, e por quê

Não é um lease. São duas propriedades que já existiam, e uma terceira que
faltava e foi corrigida aqui.

**1. A reconstrução nunca incrementa.** `projectionRebuild.ts` lê o ledger e
publica **valor absoluto** em `investment_allocation_summaries`,
`investment_report_periods` e `investment_summaries` — `set` de sobrescrita,
sem `FieldValue.increment` em nenhum ponto do caminho de publicação. Duas
execuções sobre o mesmo ledger publicam o mesmo número. Não existe "aplicar
duas vezes" a partir de uma escrita idempotente.

**2. A cerca de versão é serializada pelo Firestore.** Toda mutação do domínio
faz `projectionVersion: FieldValue.increment(1)` em
`investment_summaries/current` (`operationsV2.ts`). E **toda página** da
reconstrução lê esse documento (`projectionRebuild.ts`, `transaction.get`
incondicional), o que o põe no conjunto de leitura da transação. Consequência:
uma página só comita se a versão não mudou entre a leitura e o commit; se
mudou, a transação aborta e reexecuta, relê a versão nova, encontra o
descasamento com `expectedProjectionVersion` e **reinicia** a acumulação sobre
o estado novo. Não há janela em que uma página publique sobre um ledger que
mudou no meio.

O mesmo desenho, com o documento da meta no lugar do resumo, governa
`recalculateGoalInvestmentProgress` — que, num descasamento, falha fechada com
`"A projeção da meta mudou durante a reconstrução; inicie uma nova
reconstrução."`, em pt-BR.

**3. O reinício precisava mesmo reiniciar — e não reiniciava.**

Este é o defeito que a prova encontrou, e a razão de este parágrafo existir.

O snapshot de reconstrução era gravado com `{merge: true}`. `allocations` e
`periods` são mapas de **chaves abertas**, nascidas da acumulação. Num merge,
gravar o mapa vazio de um estado reiniciado não apaga chave nenhuma: as faixas
da tentativa anterior sobreviviam no documento, a página seguinte as relia por
`readState` e acumulava as mesmas posições **por cima delas**.

O resultado publicado saía com o **dobro** do principal por faixa de alocação e
por período. E o resumo continuava certo — ele é mapa de chaves fixas, todas
reescritas com zero pelo estado novo —, de modo que a conferência de total
fechava e nada acusava a divergência.

Alcançável por duas reconstruções concorrentes e, mais fácil ainda, por
**qualquer aporte feito enquanto uma reconstrução estava em curso**.

Correção: o snapshot passa a ser gravado com `{merge: false}`. A escrita já
montava o documento inteiro a cada página; sobrescrever é a semântica correta e
a única que torna o reinício um reinício. `cursor` deixou de usar
`FieldValue.delete()` (incompatível com sobrescrita) e passa a ser `null`
explícito, que `readState` já tratava.

### Decisão: sem lease

Com as três propriedades acima, os seis riscos enumerados estão fechados:

| Risco | Por que não ocorre |
|---|---|
| dupla aplicação | publicação é absoluta, nunca incremental |
| perda de movimentos | a reconstrução **lê** o ledger; não escreve em `investment_movements` |
| posições divergentes | a reconstrução não escreve posições; `recalculateInvestmentPosition` incrementa o resumo pelo delta lido na própria transação, com a posição no conjunto de leitura |
| metas divergentes | cerca de `investmentProjectionVersion` + falha fechada |
| períodos duplicados | o documento de período é endereçado pela chave do mês; não há como criar um segundo |
| estado parcialmente publicado | possível e retomável, nunca divergente: as duas execuções calculam o mesmo número (ver §13.5) |

Um lease genérico não acrescentaria correção — acrescentaria uma segunda cerca
sobre a mesma invariante, com o próprio risco de expiração, recuperação e
código sem consumidor, que foi exatamente o que motivou a remoção do anterior.
`backfill.ts` mantém o lease **do lote** que já tinha, porque ali o problema é
outro: duas invocações intercalando sobre o mesmo cursor.

### Prova

`functions/src/investments/__tests__/rebuildConcurrency.integration.test.ts`:

1. **duas reconstruções simultâneas do mesmo workspace convergem no mesmo
   estado** — dois drivers em `Promise.all`, com `correlationId` e `pageSize`
   distintos (1 e 2), sobre um workspace com 2 posições, 2 meses, meta
   vinculada e resgate liquidado. O estado final é comparado, campo a campo,
   com o que o caminho incremental publicou: resumo, posições, alocações,
   períodos (**inclusive o conjunto de chaves**, que é o que reprovaria um
   período duplicado), progresso da meta e contagem de movimentos. Quem não
   conclui só pode ter parado por motivo nomeado.
2. **reconstrução de posição concorrente não incrementa o resumo duas vezes** —
   é o único caminho de reconstrução que usa `FieldValue.increment`.
3. **reconstrução de meta concorrente publica progresso exato e não dobrado** —
   e o progresso final é conferido contra a soma das posições vinculadas.
4. **reinício no meio da reconstrução não duplica faixa nem período** — força o
   reinício de forma determinística, gravando um aporte entre duas páginas.
   Este é o caso que reprova a versão anterior do código: com `{merge: true}`
   ele falha; com a correção, passa. Executado 4 vezes seguidas sem oscilação.

---

## 17. Fonte única do progresso da meta

Confirmado por inspeção e por teste.

```
InvestmentMovement → posição → updateGoalProjection → goals.investmentProgressCents
transactions (espelho de caixa) → cash_report_periods
                                → NADA em goals
```

O espelho de caixa **carrega** `goalId` (`operationsV2.writeCashProjection`), e
é justamente por carregar que já foi uma segunda fonte: `onTransactionWrite`
recompunha o progresso a partir dele, e cada aporte contava duas vezes. Hoje o
handler não toca `goals` — o arquivo tem o comentário que registra a decisão, e
`grep` confirma que os únicos gravadores de `investmentProgressCents` /
`investmentNetContributionCents` são `operationsV2.updateGoalProjection`
(incremental) e `rebuild.executeRecalculateGoalInvestmentProgress`
(reconciliação absoluta). Não existe nenhum outro gatilho do Firestore no
projeto além de `onTransactionWrite`.

`functions/src/investments/__tests__/goalSingleSource.integration.test.ts`
percorre o ciclo inteiro num único caso:

| Etapa | Progresso da meta |
|---|---:|
| aporte vinculado de 100.000 | 100.000 |
| **entrega do espelho pelo gatilho de caixa** | 100.000 *(inalterado)* |
| **reentrega do mesmo evento** | 100.000 *(inalterado; e o caixa também)* |
| aporte livre de 40.000 + entrega do espelho | 100.000 |
| vínculo da posição livre | 140.000 *(sem mover caixa)* |
| desvínculo | 100.000 |
| resgate **pendente** de 30.000 | 100.000 |
| resgate **liquidado** | 70.000 |
| **entrega da liquidação pelo gatilho** | 70.000 *(inalterado)* |
| reversão do resgate | 100.000 |

Fecha com `recalculateGoalInvestmentProgress`, que recalcula a partir das
posições e devolve exatamente o mesmo número do caminho incremental — e com a
conferência de que esse número é a soma dos `principalCents` das posições
vinculadas, nem o dobro nem a metade.

---

## 18. Gates

Executados nesta ordem, todos verdes, sem skip novo e sem redução de cobertura.

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `npm --prefix functions run build` | ✅ |
| `npm --prefix functions run lint` | ✅ 0 erros (2.051 avisos de estilo, contra 2.061 antes) |
| `npm --prefix functions run test:unit` | ✅ 100/100 |
| `npm run test:unit:investments` | ✅ 35/35 |
| `npm run test:integration:emulator` | ✅ 116/116 integração + 69/69 Rules (5+7+14+7+31+5) |
| `npm run test:e2e` | ✅ 26/26 |

---

## 19. Estado

**READY FOR DEVELOPMENT DEPLOYMENT.**

As quatro condições da declaração:

- [x] todos os gates do §18 passam;
- [x] idempotência do gatilho de caixa comprovada (§15) — reentrega do mesmo
      `event.id` aplica o efeito financeiro uma única vez, em CREATE, UPDATE e
      DELETE, com o dedupe e o incremento na mesma transação;
- [x] concorrência de reconstrução comprovada (§16) — e o defeito que a prova
      encontrou no caminho de reinício foi corrigido, com teste determinístico
      que reprova a versão anterior;
- [x] nenhum caminho funcional de investimentos legado — varredura por
      `investmentsV2`, `legacyMigration`, `reconcileLegacy`, `rollbackLegacy`,
      `saveGoalContribution`, `setGoalTransactionLinks`, `operationLease` e
      `featureFlags` em `src`, `functions/src`, `tests`, `e2e`, `tools`,
      `firestore.rules` e `firestore.indexes.json` não devolve nenhuma
      ocorrência funcional: só comentários históricos, a deny-list do
      `deploymentContract.test.ts` e `buildLegacyMigrationGroupingKey`, que é do
      domínio de cartões.

Deployment é **de desenvolvimento**, com os passos do §10. Continua valendo:
não executar deploy a partir deste repositório sem autorização explícita.
