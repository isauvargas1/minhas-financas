# ExecPlan — domínio de investimentos

## Objetivo e limites

Evoluir o uso atual de `transactions.type === "investimento"` para um domínio de investimentos verificável, multiworkspace e reconciliável. Este plano segue [AGENTS.md](../../AGENTS.md) e a skill `financial-domain-integrity`; não redefine essas regras.

O M0 estabelece apenas baseline, comandos de verificação e decisões executáveis. Nenhuma coleção, contrato, regra, índice, Function, migração ou UI do novo domínio é implementada neste marco.

## Estado do plano

- [x] M0 — baseline verificável, dependências e riscos documentados; scripts `typecheck`, `verify:fast` e `verify:all` disponíveis.
- [ ] M1 — fluxo legado de aportes estabilizado no código; aprovação do marco depende da execução de Emulator/E2E e dos gates.
- [ ] M2 — resgate legado semanticamente correto implementado; aprovação depende da execução de Emulator/E2E e dos gates.
- [x] M3 — domínio backend oficial, operações críticas, rebuild paginado e auditoria implementados e validados.
- [x] M4 — Firestore Rules, índices e hardening validados para `investment_*`.
- [ ] M5 — leitura e experiência frontend.
- [ ] M6 — integração com metas, relatórios e allocations.
- [ ] M7 — hardening, observabilidade, E2E e gate final.

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

### M4 — Firestore Rules, índices e hardening

Delta executado neste marco:

1. A leitura de `investment_*` exige membership ativa e RBAC explícito: owner/admin/member acessam documentos operacionais; snapshots, event logs, import batches e audit logs ficam restritos a owner/admin; idempotency nunca é exposta. O fallback de owner sem membership não é aceito neste domínio.
2. Leituras unitárias validam ID e `workspaceId` contra o path, PF/PJ, moeda BRL, enums de status/operação, timestamps, strings limitadas e inteiros seguros para cents/micros. Movimentos pending também precisam manter todos os deltas em zero; settled exige evidência de liquidação.
3. Nenhum cliente, inclusive owner/admin, pode criar, editar ou apagar accounts, assets, movements, positions, valuations, snapshots, event logs, import batches, audit logs ou idempotency keys. As mutações financeiras e projeções continuam exclusivas de Cloud Functions/Admin SDK, com os campos imutáveis protegidos por negação total de escrita direta.
4. Listagens autorizadas exigem `limit` entre 1 e 100. Não foi introduzido listener, full-scan ou filtro client-side. Os únicos índices de investimento permanecem os exigidos pelas queries reais e paginadas do backend: ledger por conta/ativo/status/data, valuation por ativo/data e posição por meta/data.
5. A suíte de Rules usa dois tenants e owner/admin/member/viewer/removido, cobre owner sem membership, acesso cruzado bidirecional, documentos corrompidos, moeda/status/timestamp/cents inválidos, writes/deletes forjados e regressão de goals/cartões. `npm run verify:all` executou typecheck, builds, unitários, Emulator/Rules e 7 E2E Playwright sem falhas ou skips.

### M5 — frontend

1. Substituir writes financeiros diretos por callables e consumir read models paginados.
2. Expor estados loading/empty/error/success e mensagens seguras em pt-BR.
3. Preservar rotas e comportamento legado até a compatibilidade ser comprovada.
4. Cobrir teclado, foco, responsividade e fluxos críticos com Playwright.

### M6 — metas, relatórios e allocations

1. Trocar incrementos frágeis de `goals.currentAmount` por projeção reconstruível a partir da fonte oficial.
2. Integrar relatórios sem dupla contagem com `transactions` e projeções de cartão.
3. Separar fluxo de caixa, patrimônio, principal, rendimento realizado e valorização em todos os consumidores.
4. Reconciliar relatórios e allocations contra reconstrução independente por PF/PJ.

### M7 — hardening

1. Executar migração de ensaio e rebuild em dataset representativo.
2. Exercitar Emulator, Rules, integrações, concorrência, retry, E2E e smoke adjacente.
3. Registrar métricas, falhas, correlação e runbook de reparo/reconciliação.
4. Executar `npm run verify:all` e `regression-release-gate` sem etapas omitidas.

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

## Critério para iniciar M1

- Baseline em [BASELINE.md](BASELINE.md) revisado.
- `npm run verify:fast` verde.
- Resultado de `verify:all` registrado sem promover etapas não executadas a sucesso.
- Nenhuma mudança de domínio de investimentos misturada ao commit do M0.
