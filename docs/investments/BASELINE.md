# Baseline M0 — investimentos

Baseline observado em 2026-08-17, branch `main`, `HEAD` inicial `3397493`. A referência Git é `origin/main`; alterações preexistentes do worktree não pertencentes ao M0 foram preservadas e devem permanecer fora do commit.

## Configuração e comandos

| Superfície | Baseline |
| --- | --- |
| Frontend | React 18, TypeScript 5.8, Vite 6; `npm run typecheck` e `npm run build`. |
| Functions | Node 24, TypeScript 5.7, Firebase Functions 7/Admin 13; `npm run functions:build`. |
| Unitários | `npm run functions:test:unit`; três testes puros do domínio de cartões, separados das integrações. |
| Integração | `npm run test:integration:emulator`; inicia Firestore Emulator via `emulators:exec` e executa `*.integration.test.ts`. |
| E2E | `npm run test:e2e`; Playwright inicia Auth, Firestore e Functions Emulator e o Vite. |
| Gate rápido | `npm run verify:fast`: typecheck, build frontend, build Functions e unitários. |
| Gate disponível | `npm run verify:all`: gate rápido, integrações no Firestore Emulator e Playwright E2E. |

`verify:all` não contém uma suíte dedicada de Firestore Rules porque ela ainda não existe. A carga das Rules pelo Emulator/E2E não equivale a testes de autorização; essa lacuna impede considerar Rules aprovadas.

## Fluxos atuais observados

### Transactions e investimentos

- `src/modules/transactions/api.ts` lê toda a subcoleção `workspaces/{workspaceId}/transactions`, ordena no cliente e faz create/update/delete diretamente pelo SDK.
- O modelo usa `value: number`, `date: string` e um `transactionDate: Timestamp` auxiliar no payload; `goalId` é string opcional.
- `firestore.rules` aceita `receita`, `despesa`, `investimento` e `parcelado`, permite writes de owner/admin/member e permite delete.
- Não há coleção ou fonte oficial específica de investimentos. A fonte prática atual é `transactions` filtrada por `type === "investimento"`.

### Goals e `goalId`

- `src/modules/goals/api.ts` faz CRUD direto em `workspaces/{workspaceId}/goals` e persiste timestamps, mas permite delete.
- `functions/src/triggers/transactions.ts` observa writes em `transactions` e aplica delta em `goals.currentAmount` quando tipo e `goalId` correspondem.
- A trigger lê a meta e depois faz batch; não reserva uma identidade de evento. Reentrega pode repetir incremento e criar outro activity log.
- `GoalFormModal` calcula vínculos, mas `App.tsx` não fornece `onLinkTransactions`; o vínculo retroativo mostrado pelo formulário não tem write conectado nesse ponto.

### Settings catalog

- `src/modules/settings-catalog/api.ts` usa transação cliente e documento auxiliar `settings_catalog_uniques` para unicidade.
- Rules restringem create/update/delete a owner/admin e validam chaves, escopo PF/PJ, subtipo e timestamps.
- Categorias do catálogo alimentam formulários e classificações atuais; mudanças futuras precisam preservar snapshots/compatibilidade.

### Reports

- `src/modules/reports/logic.ts` calcula KPIs, fluxo de caixa e categorias no cliente sobre `transactions`; aportes são subtraídos no resultado líquido pessoal e agregados como saída no fluxo de caixa.
- O relatório também lê loans e read models de cartões. As queries de cartões possuem limites e sinalizam truncamento; a lista de `transactions` permanece sem paginação.
- Os totais são derivados por mais de um consumidor e não há reconciliação automatizada com uma fonte oficial de investimentos.

### Allocations

- `src/modules/allocations/logic.ts` classifica despesas por mapa de categorias e direciona `investimento` a aposentadoria/objetivos conforme `goalId`.
- `src/modules/business-allocations/logic.ts` trata toda transação não-receita por categoria PJ e usa `number` nos cálculos.
- Ambos são cálculos puros no frontend e recebem arrays já carregados; não há versão de algoritmo nem read model reconstruível persistido.

### Padrão equivalente de cartões

Foram inspecionados somente os pontos necessários em `functions/src/creditCards` e `src/modules/credit-cards`:

- contracts com Zod e payload base contendo workspace/idempotência;
- write plan declarando papéis, reads/writes e necessidade de transação;
- callables para writes críticos e SDK cliente para leitura;
- reserva de chave idempotente e hash do request;
- audit logs e eventos determinísticos;
- Rules com writes server-only nas coleções críticas;
- testes unitários de domínio e integrações de criação, edição, cancelamento, pagamento/estorno, replay e concorrência.

O padrão é referência arquitetural, não código a copiar sem adaptar as semânticas de investimentos.

## Firestore e cobertura de testes

- `firebase.json` declara Firestore, Functions e emuladores Auth/Firestore/Functions.
- `firestore.indexes.json` contém um índice legado de `transactions` (`userId`, `date`) e índices do domínio de cartões; não há índices próprios para investimentos, goals, reports ou allocations.
- E2E existente: smoke público, smoke autenticado e fluxo de cartão com owner/member/admin.
- Não foram encontrados `only` nem skips incondicionais. Há 18 testes de integração com skip condicional à ausência de `FIRESTORE_EMULATOR_HOST`; o script unitário foi corrigido para não selecioná-los e eles só contam quando executados pelo Emulator.
- Não há unitários frontend, suíte de Rules ou E2E de investimentos/metas/allocations.

## Correções mínimas necessárias para o baseline

O typecheck inicial falhou antes da criação do script. Foram alinhados contratos já usados pelo runtime, sem introduzir domínio novo:

- payload e leitura de recebíveis com `value` e status canônicos;
- owner/email/CNPJ explícitos ao criar workspace PJ;
- IDs temporários de metas compatíveis com IDs string do Firestore;
- campos legados de cliente refletidos no tipo;
- estado de erro do hook de relatórios exposto ao componente;
- wrappers tipados para compatibilidade React 19/Framer Motion 10.

Essas correções removem bloqueios preexistentes de compilação. Não alteram regras, índices, persistência ou cálculos do domínio de investimentos.

## Evidências do M0

Preencher/atualizar ao concluir o gate:

| Verificação | Resultado |
| --- | --- |
| Typecheck inicial | FAIL; erros preexistentes de contratos frontend e tipos Framer Motion. |
| `npm run typecheck` após correções | PASS. |
| Testes direcionados de cartões | PASS: 3 testes, 0 falhas, 0 skips. |
| `npm run verify:fast` | PASS: typechecks, builds e 3 testes unitários; 0 skips. |
| `npm run test:integration:emulator` | NÃO EXECUTADO: sandbox bloqueou bind local com `EPERM` ao iniciar Firestore Emulator. Não aprovado. |
| `npm run test:e2e` | NÃO EXECUTADO: o `webServer` do Playwright não iniciou no sandbox que bloqueia portas locais. Não aprovado. |
| Firestore Rules tests | NÃO EXECUTADO: suíte inexistente. Não aprovado. |

`npm run verify:all` confirmou o `verify:fast` verde e encerrou com exit 2 ao chegar no Firestore Emulator. O E2E não foi alcançado nessa execução agregada; a tentativa direta também falhou antes dos testes. O build produziu warnings preexistentes de imports dinâmico/estático, exports de ícones e bundle grande, sem erro de compilação; devem ser tratados fora do M0 se forem priorizados.

## Riscos e próximos marcos

Os riscos executáveis e a ordem de tratamento estão em [EXECPLAN.md](EXECPLAN.md). M1 só deve começar após o baseline rápido verde e o resultado completo disponível ser registrado sem ocultar lacunas do Emulator/Rules.
