# P5-D2.1 — vereditos das skills e do gate (2026-10-12)

Escopo comum: diff da P5-D2.1 sobre a árvore da P5-D2 (`2ddcd26f`) até o estado final do working tree (árvore `35f69312`; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`). Avaliação no escopo do milestone (produtor `receivable_overdue`, integração nas operações de recebíveis, Rules e índice das duas coleções novas); itens de milestones posteriores listados com o ID do plano. Nada publicado; nenhum acesso ao projeto de produção; Firebase só no Emulator `minhas-financas-local`.

**Validação usada por todos os vereditos:** `verify:all` integral depois da última mudança (2026-10-12, 09:28:38Z → 10:14:31Z, saída 0): typecheck, lint (0 erros; 202 avisos, os da base, nenhum em arquivo da P5-D2.1), builds, 573 unitários das Functions, 735 do frontend, 891 de integração das Functions, 17 das ferramentas, 256 de Rules e 158 E2E; 0 falhas, 0 skips. Mutações: 53/53 mortos (`mutacoes.json`). Benchmark de volume: `escala.json`. Revisão independente em três rodadas, a última "aprovável" (`revisao-independente.md`).

---

## PASS — Financial domain integrity

**Escopo:** as 5 operações de recebíveis (`functions/src/receivables/operations.ts`: criar, editar, receber, estornar, cancelar), a fila operacional e a rotina de avisos. Nenhum cálculo, saldo, relatório ou projeção alterado.

**Mapa de autoridade:**
- Recebível (saldo, status, vencimento): única fonte `workspaces/{ws}/receivables`; escritores: só `operations.ts` (5 escritas), confirmado pela guarda estática (`receivableQueue.test.ts`, lista fechada de arquivos e checagem de escrita sobre todo `functions/src`) e pelas Rules (escrita do cliente negada desde a P3-I).
- Item da fila: estado operacional, não fato financeiro; escrito só na mesma transação da operação (`receivableQueue.ts:81-112`) e pela rotina (`receivables.ts:337-397`, `:494-497`).
- Confirmação de entrega: só a rotina, no mesmo commit do aviso (`receivables.ts:394-396`).

**Semântica de movimentos:** inalterada. A transação financeira só ganhou a escrita do item (`operations.ts:263,476,656,850,933`), depois de gravar o recebível e sem leitura extra; nenhum efeito em caixa, saldo, principal, recebimento ou estorno.

**Matriz de evidência:**

| Seção | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Datas civis `YYYY-MM-DD` (`dueDate`, `runAfterDay`) pela função única `saoPauloDayKey`/`todayOf`; instantes em `Timestamp` do servidor; teste §15.22 (22h30 em São Paulo, sem offset fixo); mutante M16 |
| Semântica financeira | PASS | Nenhum valor tocado; teste §14 (instantâneo byte a byte do domínio, sem as coleções operacionais) e mutante M25 (worker gravando no recebível) |
| Autoridade e atomicidade | PASS | Fila gravada na mesma transação da operação; aviso + confirmação + remoção num commit (`receivables.ts:394-396`); mutantes M19, M22, M05 |
| Operações críticas e eventos | PASS | ID determinístico do aviso e da confirmação; retry, resposta perdida (§16.2), dois workers (§16.3), corrida real com quitações (§16.3b), replay da criação (§15.32); falha com pré-condição `lastUpdateTime` (`receivables.ts:494-497`, M29) |
| Histórico e auditoria | PASS | Nenhum hard delete de histórico financeiro; confirmação sem TTL; recebíveis nunca apagados; trilha de eventos do recebível inalterada |
| Fontes, totais e relatórios | PASS | Nenhum total ou relatório alterado; teste de reconciliação do ledger preservado (§14) |
| Substituição e remoção de legado | PASS | Janela de 7 dias, consulta de grupo de `receivables`, índice composto e cursor `system/receivable_overdue_notifications` removidos (`evidence/p5d21/prova-remocao.txt`); caminho antigo negado pelas Rules (teste); 3 testes do cursor substituídos pelos de fila |
| Testes obrigatórios | PASS | Criação (§15.1), edição (§15.5–§15.7, §15.30, §15.31), cancelamento/estorno (§15.4, §15.8, §15.28, §15.29), retry (§15.9–§15.13, §16.2), concorrência (§16.3, §16.3b, §15.14, §15.15, §15.27), autoridade (Rules), atomicidade (falha injetada antes e depois do commit, §15.11) |

**Reconciliação:** o conjunto de avisos é reconstruível da fonte oficial: para todo recebível aberto, com saldo e vencimento válido e vencido, existe item na fila do vencimento atual ou confirmação daquele episódio (invariante §15.34, verificado no Emulator depois de sequências de operações).

**Retry e concorrência:** fronteira de idempotência = confirmação por episódio na transação; repetição encontra o item removido ou a confirmação; quitação concorrente é relida na transação (§15.15, §15.27).

**Legado:** removido e provado por busca (`prova-remocao.txt`: 0 ocorrências fora do teste de negação).

**Verificação:** `verify:all` (abaixo), suíte `receivableOverdue.integration.test.ts` (56), mutações 53/53.

---

## PASS — Firestore scale/cost review

**Escopo:** consulta de grupo `receivable_overdue_queue` (`receivables.ts:473-479`), transação por item, escrita extra nas operações de recebíveis, override de índice, retenção das duas coleções.

**Evidência:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Tenant e limites da consulta | PASS | A consulta de grupo é uma fila de trabalho (só itens devidos), paginada (`limit` 100, cursor `runAfterDay`+`__name__`), limitada por execução (200 páginas, 420/480 s); o workspace sai do caminho do item (`receivables.ts:291-297`), nunca do conteúdo (M23); Rules negam o grupo ao cliente |
| Índices | PASS | Override de campo único `runAfterDay` ASC em COLLECTION e COLLECTION_GROUP (`firestore.indexes.json:1426-1438`); `__name__` como desempate; teste §17 de declaração; índice composto de `receivables` removido |
| Leituras e listeners | PASS | Sem listener; 4 leituras por transação, todas antes das escritas; execução ociosa = 2 leituras (consulta vazia + `count()`), medida |
| Escritas e modelo | PASS | Operação de domínio: ≤ 1 escrita extra, 0 leituras extras; publicação: 3 escritas num commit; sem documento crescente; fan-out constante |
| Retenção | PASS | Fila: removida ao concluir (tamanho limitado aos recebíveis abertos elegíveis); confirmação: sem TTL por decisão documentada (impede reemissão depois do TTL do aviso), limitada a 1 por episódio, eliminada com o workspace (P8) ([DATA_RETENTION_LIFECYCLE.md](../../DATA_RETENTION_LIFECYCLE.md)) |
| Jobs limitados | PASS | Rotina horária com teto de 200 páginas e orçamento de tempo, retomável sem cursor persistido, justiça em duas passadas (cota de 500 por workspace na 1ª) |
| Remoção de legado | PASS | Consulta, índice e cursor antigos removidos (`prova-remocao.txt`) |
| Custo e alto volume | PASS | Benchmark (`escala.json`): 100 a 50.000 vencidos e cenário concentrado de 20.000, conjuntos exatos; 5,1–5,5 leituras por aviso até 10.000; 7,2 no pior caso (50.000 com 3 anos de atraso acumulado); teto de 20.000 leituras de consulta por execução |
| Emulator | PASS | Fronteiras de página (§15.16, §15.26b, §15.39), cursor e salto (§15.18, §15.35, §15.40), concorrência (§16.3, §16.3b), multiworkspace (§16.4) |

**Modelo de custo:** por aviso, 5 leituras (consulta + item, recebível, confirmação, aviso) e 3 escritas; por operação de domínio, 0 leituras e ≤ 1 escrita extra; execução ociosa 2 leituras (48/dia); execução saturada ≤ 20.000 leituras de consulta + 4 por item processado (× até 5 tentativas do SDK em contenção) + ⌈pendentes/1.000⌉. Medidos no Emulator por interceptação do SDK (§11 e benchmark).

**Verificação:** suítes no Emulator `minhas-financas-local` (abaixo).

---

## PASS — Multi-tenant security review

**Escopo e fronteiras:** duas coleções operacionais novas sob `workspaces/{ws}/`; nenhuma callable nova; a rotina roda com Admin SDK, sem identidade de usuário, e deriva o workspace do caminho.

**Matriz de evidência:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Identidade, tenant e membership | PASS | Nenhuma entrada de cliente nova; as operações de recebíveis seguem com `resolveWorkspaceActor` (inalterado) |
| RBAC | PASS | Nenhum papel lê ou escreve as coleções (`firestore.rules:1050-1056`), nem o titular; inclusão em `isBackendOwnedCollection` (`firestore.rules:480-481`) evita o catch-all de leitura (mutante M35) |
| Integridade de dados | PASS | Item e confirmação só pelo backend; registro de falha com pré-condição de versão |
| Camadas independentes | PASS | Rules negam tudo ao cliente; o backend revalida o recebível pelo leitor autoritativo com o workspace do caminho (`receivables.ts:337-341`); item forjado em outro workspace não lê nem publica fora do caminho (§15.21) |
| Auditoria, segredos, Storage | PASS / N/A | Logs só com IDs e códigos; nenhum segredo; Storage não usado |
| Testes Emulator | PASS | `notifications-p5d2.rules.integration.test.mjs:668`: owner, admin, member, viewer, removido, suspenso, owner e member de outro workspace, sem autenticação, workspace arquivado; leitura, listagem, contagem, criação, alteração, marca forjada, remoção; consulta de grupo e caminho antigo negados; dados intactos. Mutantes M35, M36, M37 |

**Caminhos de ataque tentados:** IDOR por ID de recebível de outro workspace no item (§15.21), escrita direta do cliente em fila e confirmação (Rules), leitura por catch-all (M35), consulta de grupo, caminho antigo `system/…`.

---

## PASS — Privacy/LGPD data lifecycle

**Escopo:** as duas coleções novas, o conteúdo do aviso (inalterado), logs da rotina.

**Inventário:** `receivable_overdue_queue` e `receivable_overdue_deliveries` guardam só IDs (workspace, recebível, aviso), datas (vencimento, próxima tentativa, carimbos), tentativas, código de erro, origem e `runId`; nenhum nome, documento, valor, descrição ou dado de cliente ([PRIVACY_LGPD.md](../../PRIVACY_LGPD.md) linha 24; [DATA_RETENTION_LIFECYCLE.md](../../DATA_RETENTION_LIFECYCLE.md) linhas 108, 161, 170-171). Mutante M24 (confirmação com a descrição) morto.

**Matriz:** finalidade e minimização PASS (controle técnico de entrega); retenção PASS (fila enquanto há trabalho; confirmação vinculada ao recebível, eliminada com o workspace na P8); subprocessadores N/A (nenhum terceiro novo, nenhum envio externo); logs PASS (só IDs e códigos, teste §18 sem PII).

**Fora do escopo:** fluxo de exclusão/exportação de workspace (P8, PR-PRIV-*), validação jurídica (P8).

---

## PASS — Observability and incident readiness

**Escopo:** logs estruturados da rotina e o registro em [OBSERVABILITY.md](../../OBSERVABILITY.md) §2.11 e [INCIDENT_RESPONSE.md](../../INCIDENT_RESPONSE.md).

**Mapa de sinais:** resumo de toda execução (`receivable_overdue_notifications_completed`, INFO) com `runId`, contadores, `pendingDueAtEnd`, `backlog` e `outcome`; WARN `receivable_overdue_notifications_attention` em `backlog` e `recoverable_failures`; ERROR `receivable_overdue_notifications_structural_error` (relançado ao Scheduler); por item, ERROR `receivable_overdue_item_failed` com `errorCode` tipado, WARN de falha persistente, de registro não gravado e de recebível fora do contrato; WARN de contagem falha. Alerta e runbook de backlog: P7 (registrado no INCIDENT_RESPONSE).

**Correlação:** `runId = receivable-overdue-<scheduleTime>`, repetido na reexecução do Scheduler, gravado na confirmação (teste §18; mutante de correlação da P5-D2 preservado).

**Matriz:** logging estruturado PASS (logger compartilhado, só IDs); correlação PASS; erros PASS (nenhum erro engolido: estrutural relançado, M33); métricas e alertas: fora do escopo (P7, PR-OBS-*), registrados; auditoria N/A (nenhuma ação sensível nova).

**Fora do escopo:** alertas, dashboards, reconciliação periódica e drills (P7, PR-OBS-01/02).

---

## PASS — Firebase production readiness

**Escopo:** export `processReceivableOverdueNotifications` (inalterado no nome; agenda trocada para `every 60 minutes`), índice novo, Rules novas.

**Inventário de Functions (alterada):** `processReceivableOverdueNotifications`, agendada, `southamerica-east1`, 540 s, 512 MiB, `maxInstances: 1` (`SCHEDULED_FUNCTION_OPTIONS`, `functions/src/shared/runtimeOptions.ts:107-112`), `timeZone: America/Sao_Paulo` (`receivables.ts:673-684`), sem segredos, sem retry de evento (a recuperação é durável no dado); contrato de exports (`deploymentContract.test.ts:76-80`) e agenda testada (§17).

**Matriz:** região/timeout/teto PASS; função agendada idempotente e limitada por execução PASS; Rules e índices versionados PASS; ordem de implantação (índice antes da Function) registrada em [FIREBASE_PRODUCTION.md](../../FIREBASE_PRODUCTION.md) linha 69 e §5; nenhum script ou comando contra produção.

**Configuração externa pendente (inalterada pela milestone):** E-01…E-12 do plano (ambientes, App Check, budget, PITR, TTL E-07), fora do escopo e listados no plano §11.

---

## PASS — revisão de UI de produto em PT-BR

**Escopo:** nenhuma mudança de frontend (`git diff` sem arquivos em `src/` ou `e2e/`). O texto do aviso (pt-BR, datado pela detecção, sem nome nem valor) é o mesmo da P5-D2 (`receivableOverdueNotification`, contrato inalterado; testes §15.1 e `expectNotice`).

**Execução:** E2E completo no `verify:all` (abaixo), inclusive as specs de notificações da P5-D2 e da D-18.

**Mudanças de superfície:** nenhuma na interface; nenhuma mensagem nova ao usuário (logs internos não são exibidos).

---

**PASS — regression release gate** (P5-D2.1)

1. **Escopo Git:**
   - branch `integration/p4-finalization-2026-10-08`; HEAD `f0c172b6`; merge-base com `main` `37d8780d`;
   - base da milestone: árvore `2ddcd26f` (P5-D2); árvore final do working tree, por índice temporário: `35f69312` (antes deste registro);
   - diff contra a base: 10 arquivos novos e 20 alterados, nenhum removido (Functions: `receivableQueue.ts` novo, `receivables.ts`, `operations.ts`, `index.ts`; Rules; índices; testes; documentação e evidência);
   - índice real sem nada staged; sem commit, push, merge ou deploy; nada publicado.
2. **Evidências:**

   | Etapa | Comando ou inspeção | Resultado |
   | --- | --- | --- |
   | Typecheck, lint, builds | `verify:fast` | OK; lint com 202 avisos, nenhum erro, nenhum em arquivo da P5-D2.1 |
   | Unitários | `verify:fast` | 573 + 735, 0 falhas, 0 skips |
   | Integração e Rules no Emulator | `test:integration:emulator` (`minhas-financas-local`) | 891 + 17 + 256, 0 falhas, 0 skips |
   | E2E | `test:e2e` | 158/158 |
   | Diff | `git diff --check` (índice temporário) | limpo |
   | Mutações | `mutacoes.json` | 53/53 mortos, 0 inválidos |
   | Escala | `escala.json` | 100 a 50.000 e concentrado de 20.000: publicados = esperados, conjuntos exatos |
   | Legado | `prova-remocao.txt` | 0 ocorrências fora do teste de negação |
   | Dependências | `package.json` e lockfiles intocados | `npm audit` idêntico ao da base |

3. **Achados:** nenhum aberto.
   - Corrigidos antes do gate: HIGH R3-1 da revisão (salto na fronteira da página sem a 2ª passada), cota fixa não conservadora (achado próprio, pelo benchmark) e a ordem da lista de coleções do backend nas Rules, que quebrava a guarda `tests/unit/notifications-guard.test.ts:108` no 1º `verify:all` (corrigido sem tocar o teste).
4. **Skips e cobertura:**
   - 0 skips, nenhum `only`, nenhum timeout aumentado para esconder falha (a margem do §15.26b foi alargada por robustez, com asserções idênticas, e está registrada);
   - o repositório não configura métrica de cobertura;
   - removidos com o legado: os 3 testes do cursor da P5-D2 (substituídos pelos de fila e recuperação) e o teste de Rules do cursor (substituído pelo da P5-D2.1, que mantém a negação do caminho antigo); o §16.8 passou a exigir o aviso em −8 e −30 dias (D-42);
   - total de testes de 2.565 para 2.630.
5. **Mudanças de superfície:**
   - UI e textos: nenhuma (sem arquivos em `src/` ou `e2e/`; contrato e textos do aviso inalterados);
   - rotas: nenhuma;
   - contratos: duas coleções backend-only novas (`receivable_overdue_queue`, `receivable_overdue_deliveries`), override de índice de `runAfterDay`, agenda da rotina de diária para horária (mesmo nome de export), índice de grupo de `receivables` e documento de cursor em `system/` removidos.
6. **Riscos residuais:**
   - capacidade compartilhada (só atraso; prioridade estática pelo ID do workspace no mesmo dia; alerta de backlog na P7);
   - sem prazo por chamada ao Firestore (pode passar de 540 s com o Firestore degradado; trabalho não concluído segue devido);
   - ordem de implantação: índice de `runAfterDay` antes da Function;
   - recebíveis anteriores à P5-D2.1 fora da fila (sem dado real; sem backfill);
   - pendências da P5-D2 (TTL E-07, `readTime` em STAGING, decisões pendentes).
7. **Bloqueadores para PASS:** nenhum.
8. **Skills de domínio:** todas PASS, acima.
