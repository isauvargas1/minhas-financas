# P5-D2 — vereditos das skills de domínio (estado final do working tree)

Base `7c3913f6` (D-18-NOTIF). Escopo: só P5-D2. Itens atribuídos a milestones posteriores e não afetados pelo diff ficam em "Fora do escopo", com o ID do plano. Execução das suítes: `verify:all` integral de 2026-10-11, 21:49:25Z → 22:22:50Z, saída 0. Unitários: 561 das Functions e 735 do frontend. Integração: 838. Ferramentas: 17. Rules: 256. E2E: 158/158. Nenhum skip.

---

## financial-domain-integrity

**PASS — Financial domain integrity** (escopo P5-D2)

- **Escopo:** produtores de notificação (empréstimos, recebíveis, contas, metas, recorrentes, cartões), completude das condições do Relatório, contagem de não lidas. Nenhum registro financeiro novo; nenhum cálculo financeiro novo.
- **Autoridade:** o aviso só lê o documento autoritativo (antes/depois do evento ou o recebível relido por `readAuthoritativeReceivable`, que confere `workspaceId`); grava só em `workspaces/{ws}/notifications` com `create`. Rules negam create/update/delete do evento a todos os papéis (`notifications-p5d2.rules` "nenhum papel cria/altera/apaga"). Nenhum segundo escritor de dado financeiro.
- **Semântica:** borrow = "a pagar", lend = "a receber" (§16.7); `overdueFrom − 1` = vencimento; recebível aberto ⇔ saldo > 0 (§16.8 parcial avisa; §16.9 recebido e §16.10 cancelado não avisam); saldo negativo lido de `cash_accounts.balanceCents` (§16.11); recorrência pendente não vira pagamento (§16.15); divisão de contas não inventa liquidação (§16.16).
- **Dinheiro e datas:** único valor no aviso é o total da fatura fechada, `formatBrl(slot.next.totalCents)` (centavos inteiros, formatação na borda), depois de `applyInvoiceClose` (sem segundo cálculo). Dias civis por `saoPauloDayKey`/`addDaysToDayKey`; `createdAt` = instante do commit; `expiresAt` Timestamp.
- **Atomicidade:** o aviso de fechamento nasce na mesma transação do fechamento (D-18, preservado). Nos gatilhos, o aviso não é estado financeiro dependente: o documento autoritativo é o registro durável e o gatilho com `retry: true` é o consumidor idempotente.
- **Idempotência, retry e concorrência:** ID determinístico + `create` (ALREADY_EXISTS = sucesso): reentrega (§16.5), reexecução (§16.8), retry não prorroga TTL (§16.18), sem reemissão depois do TTL (§16.17), concorrência de entregas simultâneas e duas execuções simultâneas da rotina, com uma única criação (teste "§16 concorrência"), retomada da rotina e falha injetada sem perda de progresso (testes "§14"). Mutações: 38 válidas, 38 mortas.
- **Histórico:** o aviso não altera ledger, saldos, projeções nem relatórios (§16.20, `assertDomainUntouched`); Relatórios: valores inalterados (suítes `financialReport*` passam); só a completude das condições passou a incluir o caixa (`alertsCoverage.integration.test.ts`).
- **Legado removido:** `markAlertAsRead`, `readAlertIds`, botão "Marcar como lido", "Alertas e Insights", `summarizeUnread`, `UNREAD_COUNT_READ_TIME_LAG_MS` sem ocorrência (`prova-remocao.txt`).
- **Testes obrigatórios:** criação (todos os produtores), edição (transições, edição de vencimento §16.12), estorno/cancelamento (§16.6, §16.10), retry (§16.5/§16.18), concorrência, autoridade (Rules), atomicidade (fechamento transacional, D-18).
- **Fora do escopo:** detector de deriva e reconciliação agendada (PR-TX-04, P7); D-18 geral.

## firestore-scale-cost-review

**PASS — Firestore scale/cost review** (escopo P5-D2)

- **Consultas:** contagem = duas agregações `count()` com `expiresAt > t` (coleção do workspace e estados do uid), 1 leitura por bloco de 1.000 entradas de índice; nenhuma leitura do histórico no cliente; sem listener nem polling. Rotina de recebíveis: grupo de coleção com predicado seletivo (`schemaVersion`, `status == open`, `dueDate ∈ [hoje−7, hoje−1]`), ordem estável `dueDate, __name__`, 200 × 25 páginas, cursor dentro da execução e cursor persistido de retomada entre execuções, salvo a cada página, com volta na janela (`system/receivable_overdue_notifications`); testes de retomada, de limite da volta, de descarte de cursor inválido e de falha injetada no meio da execução.
- **Índices:** `expiresAt` ascendente de coleção nos overrides de TTL de `notifications` e `notification_entries`; grupo de `receivables` (`schemaVersion`, `status`, `dueDate`, `__name__`); teste §17.30 confere a declaração.
- **Escritas:** gatilhos: 1 `create` por transição, nenhuma leitura extra; rotina: 1 `create` por recebível visitado + 1 leitura e até 26 escritas do cursor; contagem: 1 escrita do limite (600/h por usuário e workspace).
- **Retenção:** TTL de 180 dias declarado nos dois overrides (publicação E-07).
- **Escala:** >25, >100 e >1.000 notificações (§17.15–17); workspace com muitos membros: custo por usuário independe do número de membros (estados por uid). Resíduo registrado: acima de ~35.000 recebíveis abertos vencidos na janela global, nem todos visitados em 7 dias (`truncated`, alerta P7).
- **Emulator:** suítes de integração e Rules (isolamento A/B, limites de lista, contagem sem limite negada ao cliente).
- **Fora do escopo:** capacidade/latência em produção (P6).

## multi-tenant-security-review

**PASS — Multi-tenant security review** (escopo P5-D2)

- **Callable `getNotificationUnreadCount`:** uid só do token (kernel `defineCallable`), payload estrito `{workspaceId}`, pré-checagem do kernel + releitura de perfil, workspace e membership na transação (`evaluateWorkspaceAccess`), todos os papéis inclusive viewer; removido, suspenso, arquivado e não membro recusados sem total (§17.18–20, §17.29); troca de workspace e de usuário (§17.21–22); limite por (workspace, uid) depois da autorização; App Check pelo kernel.
- **Gatilhos e rotina:** `workspaceId` vem do caminho do documento (`event.params`, `doc.ref.parent.parent`); o aviso é gravado no mesmo workspace; ID inclui o workspace (§16.19: mesma entidade em dois workspaces gera dois avisos).
- **Rules (inalteradas, testadas):** leitura de eventos só por membro ativo com limite ≤ 50; A→B e B→A negados (eventos, estados, contador); nenhum papel cria/altera/apaga evento (inclusive com `audienceUid`); estado só do próprio uid; `deleted` negado ao viewer; contador de frequência e cursor da rotina inacessíveis ao cliente; catch-all para caminhos inventados.
- **Privacidade de conteúdo:** nenhum dado de `client_private`, nome, documento ou valor (asserções de campos proibidos).
- **Fora do escopo:** App Check enforcement no console (PR-APPCHK-01, P6).

## privacy-lgpd-data-lifecycle

**PASS — Privacy/LGPD data lifecycle** (escopo P5-D2)

- Avisos com identificadores, datas e textos fixos; sem nome, documento, e-mail, telefone, valor de recebível/empréstimo ou descrição; não leem `client_private`. Logs só com identificadores e contagens (correlação `sourceEventId`/`runId` sem dado pessoal). Cursor da rotina com data e caminho do documento (identificadores). Retenção de 180 dias (D-18-NOTIF) com TTL declarado (ativação E-07). Nenhum envio externo. Inventário em `PRIVACY_LGPD.md` (linhas 22–23).
- **Fora do escopo:** eliminação do estado privado na exclusão de conta e exportação (PR-PRIV-01, P8); validação jurídica (P8).

## observability-incident-readiness

**PASS — Observability and incident readiness** (escopo P5-D2)

- Logs estruturados (`createOperationLogger`) em todos os produtores, na rotina e na callable; só identificadores e contagens; `notification_contract_violation` e `notification_unread_count_invariant_violated` em ERROR; `receivable_overdue_notifications_attention` em WARN com `truncated`/`failed`; correlação: `requestId` do kernel na callable, `sourceEventId` (Eventarc) nos gatilhos e `runId` na rotina, com testes (os quatro gatilhos exportados chamados com `event.id`; o corpo agendado da rotina; mutantes I20, I21 e I26 mortos); decisões registradas: WARN em `truncated` (como nas rotinas existentes; contrato de severidade na P7) e `runId` repetido na reexecução do Scheduler; erro ao usuário em pt-BR sem detalhe interno; notificação ao usuário separada de alerta interno (OBSERVABILITY §2.11).
- **Fora do escopo:** métricas e alertas de plataforma, runbooks, reconciliação agendada e detector de deriva (P7: PR-OBS-01, PR-OBS-02, PR-TX-04); DR (D-27, P6).

## firebase-production-readiness

**PASS — Firebase production readiness** (escopo P5-D2)

- **Functions novas:** `getNotificationUnreadCount` (callable, `DOMAIN_CALLABLE_OPTIONS`: southamerica-east1, 60 s, 256 MiB, até 20 instâncias, App Check pelo kernel); `onLoanWriteNotification`, `onCashAccountWriteNotification`, `onGoalWriteNotification`, `onRecurringOccurrenceCreatedNotification` (`NOTIFICATION_TRIGGER_OPTIONS`: southamerica-east1, 60 s, 256 MiB, até 20, `retry: true`, idempotentes por ID determinístico); `processReceivableOverdueNotifications` (`SCHEDULED_FUNCTION_OPTIONS`: 540 s, 512 MiB, 1 instância, `America/Sao_Paulo`, limitada por execução). Contrato de implantação testado (`deploymentContract.test.ts`); nenhuma função de teste exportada.
- **Índices/TTL:** declarados em `firestore.indexes.json`; ordem de implantação "índices antes das Functions" registrada (FIREBASE_PRODUCTION §5); TTL não publicado (E-07).
- **Dependências:** `npm audit --package-lock-only` idêntico na base e no estado final (17: 1 baixa, 3 moderadas, 11 altas, 2 críticas; mesmos pacotes); `axe-core` (devDependency) não introduz vulnerabilidade.
- **Fora do escopo:** ambientes (PR-PLAT-01), App Check no console (PR-APPCHK-01), deploy guardado (PR-REL-01), PITR/backups (D-27), budget (E-*), Hosting (PR-PLAT-03) — P6; vulnerabilidades preexistentes de dependências (registradas desde a P2C-H2).

## ptbr-product-ui-review

**PASS — revisão de UI de produto em PT-BR** (escopo P5-D2)

- **Mudanças (todas requeridas pelo contrato):** sino com o total exato e rótulo "Notificações, N não lidas"; indisponível "?" com "Notificações, total de não lidas indisponível" e chip "Total de não lidas indisponível"; Relatórios: "Condições do período", parágrafo explicativo, "Calculado em DD/MM/AAAA", sem botão de leitura; mensagens dos avisos em pt-BR no passado, datadas; erro da contagem em pt-BR (`UNREAD_COUNT_UNAVAILABLE_MESSAGE`).
- **Antes/depois:** `docs/production/evidence/p5d2/` (24/28 capturas; sino 0,00%, painel 0,01–0,33%, Relatórios só as mudanças pedidas).
- **Execução:** E2E A–F (4 combinações de viewport/tema, teclado, axe, rolagem horizontal 0).
- **Acessibilidade:** débitos anteriores e não introduzidos, restritos por seletor na spec F: contraste (`CONTRAST_DEBT`, badge) e `label-content-name-mismatch` no seletor de mês e no sino (o badge "9+" já ficava fora do rótulo na base: `Header.tsx:221` e `model.ts:215-220` da árvore `7c3913f6`).
- **Fora do escopo:** correção dos débitos de contraste e de rótulo do cabeçalho (fases de UI/UX aprovadas).

---

## regression-release-gate

**PASS — regression release gate** (P5-D2)

1. **Escopo Git:**
   - branch `integration/p4-finalization-2026-10-08`; HEAD `f0c172b6`; merge-base com `main` `37d8780d`;
   - base da milestone: árvore `7c3913f6` (D-18-NOTIF);
   - diff contra a base: 82 arquivos novos (52 deles capturas), mais este registro, e 36 alterados, nenhum removido; a árvore final do working tree, calculada por índice temporário, está no relatório do ZIP;
   - índice real sem nada staged; sem commit, push ou deploy.
2. **Evidências:**

   | Etapa | Comando ou inspeção | Resultado |
   | --- | --- | --- |
   | Typecheck, lint, builds | `verify:fast` | OK; lint com 202 avisos, nenhum erro, nenhum em arquivo da P5-D2 |
   | Unitários | `verify:fast` | 561 + 735, 0 falhas, 0 skips |
   | Integração e Rules no Emulator | `test:integration:emulator` (`minhas-financas-local`) | 838 + 17 + 256, 0 falhas, 0 skips |
   | E2E | `test:e2e` | 158/158 |
   | Diff | `git diff --check` | limpo |
   | Mutações | `mutacoes.json` | 38/38 mortos |
   | Dependências | `npm audit` | idêntico ao da base |

3. **Achados:** nenhum aberto.
   - Corrigidos durante o gate: asserção da D-18 com a semântica antiga; asserção de palavras proibidas sensível a nanossegundos; corrida de prontidão do E2E (`wait.stdout`, sem retry nem timeout maior).
   - A falha isolada de `cash-accounts`, na 4ª rodada, ficou registrada com a causa: latência de releitura do cliente sob carga, com o backend correto em 27 ms.
4. **Skips e cobertura:**
   - 0 skips, nenhum `only`;
   - o repositório não configura métrica de cobertura;
   - nenhum teste removido; dois renomeados e reforçados para a contagem exata;
   - total de testes de 2.371 para 2.565.
5. **Mudanças de superfície:**
   - UI: sino e painel com o total exato e "?"; Relatórios com "Condições do período", "Calculado em" e sem botão de leitura;
   - textos dos avisos em pt-BR;
   - rotas: nenhuma;
   - contratos: callable `getNotificationUnreadCount`, quatro gatilhos e uma rotina novos; índices novos; documento de cursor em `system/`; `markAlertAsRead` removido;
   - configuração do E2E: prontidão do emulador.
6. **Riscos residuais:**
   - TTL não publicado (E-07);
   - `readTime` em produção a conferir em STAGING;
   - ordem de implantação: índices antes das Functions;
   - rotina de recebíveis acima de cerca de 35.000 vencidos na janela;
   - latência do E2E sob carga;
   - decisões pendentes (meta pelo progresso, vencimento próximo, divisão de contas).
7. **Bloqueadores para PASS:** nenhum.
8. **Skills de domínio:** todas PASS, acima.
