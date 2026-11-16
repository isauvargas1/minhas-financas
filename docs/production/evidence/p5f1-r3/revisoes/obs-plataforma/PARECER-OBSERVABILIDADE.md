FAIL — Observability and incident readiness

Parecer independente e somente leitura da etapa P5-F.1-R3, emitido em 2026-11-09 (leitura encerrada às 20:40 UTC).

O veredito vale para o escopo do diff da R3, pela "Política de decisão" da skill. **Um único achado bloqueia: OBS-B1, de severidade MEDIUM.** Ele é de registro documental e se resolve sem mudar código. O restante do escopo passa.

## Escopo

- **Árvores:**
  - worktree `wt-p5f1-r3`, branch `feat/p5-f1-r3-2026-11-09`, commit-base `1730a1df`;
  - árvore de partida `f82679226ec93e18f906731be09d0675326fd764`;
  - árvore de código final `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`.
  - O delta de código tem 40 arquivos fora de `evidence/` e 88 de evidência novos.
  - Depois de `377c2f3`, só mudou `docs/`: às 20:37:24 UTC havia zero diferença fora de `docs/`.
- **Pontos de entrada e jobs avaliados:**
  - gatilho `onTransactionWrite`: `functions/src/triggers/transactions.ts`, `functions/src/cash/periods.ts`, `functions/src/cash/projectionMarks.ts`;
  - callable `rebuildCashPeriods`: `functions/src/cash/rebuild.ts`;
  - leitura da prova no cliente: `src/modules/work-time/projectionReads.ts`, `useIncomeEstimateWith.ts`, `messages.ts`.
- **Documentos avaliados:**
  - `docs/production/BACKUP_RESTORE_DR.md` §3 e §6, alterado pela R3;
  - `OBSERVABILITY.md`, `RUNBOOKS.md`, `INCIDENT_RESPONSE.md` e o plano mestre, os quatro sem alteração da R3;
  - `docs/production/evidence/p5f1-r3/` e o rascunho, fora da árvore, `$S/p5f1r3/evidencia/plano-20-18.md`.
- **Integrações externas:** nenhuma é tocada (Stripe, IA e e-mail ficam fora do diff).

## Mapa de sinais

| Sinal crítico | Log / métrica | Alerta | Destinatário | Runbook | Lacuna |
| --- | --- | --- | --- | --- | --- |
| Cadeia de marca quebrada (prova da estimativa indisponível até uma reconstrução) | Log `cash_projection_mark.broken` em ERROR (`transactions.ts:307-313`). Estado durável na mesma transação do delta: `markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime`, `lastMarkIssueCode`, `lastMarkIssueTransactionId` e `lastMarkIssueAt` em `cash_period_events/projection_state` (`periods.ts:1194-1213, 1407-1413`). Sem métrica | Nenhum. **Sem entrada** na matriz-alvo de alertas (`OBSERVABILITY.md:255-276`, A01–A20) nem na linha "Caixa" da §9 (`OBSERVABILITY.md:378`), que só cita `.needs_rebuild`/`.failed`. O sinal **não liga** `needsRebuild` (`periods.ts:1188-1193`), então nenhum alvo existente o cobre | Nenhum registrado | Nenhum. `RUNBOOKS.md:193` descreve a reconstrução, mas não diz que o aviso só desliga com corte posterior a `markIssueMaxEventTime` (`rebuild.ts:1633-1634`) | **OBS-B1 (bloqueante)** |
| Conteúdo fora da impressão digital, no gatilho (`content`) | `cash_projection.failed` com `errorCode` `CashContractViolationError`, mais `cash_projection.needs_rebuild` com `reason: contract_violation` e `needsRebuild` (`periods.ts:1375-1384`; `transactions.ts:314-342`) | A05 e linha 378, TARGET/E-08 | Plantão técnico | "Projeção de caixa divergente e rebuild" | Alerta só TARGET (P7, herdado) |
| Conteúdo fora da impressão digital, na reconstrução (`content`) | `cash_rebuild_contract_violation` com `workspaceId`, `transactionId` e `field: "content"` (`rebuild.ts:1206-1215`), e `callable.end` com `domain_precondition_failed` | Nenhum específico (herdado da P5-C2) | — | — | Herdado; o diff só acrescenta o valor `content` |
| Recomeço `post_cutoff_event_missed_staging` | Resposta `{restarted: true, reason}` (`rebuild.ts:1140-1146`) e `lastRestartReason` no checkpoint (`rebuild.ts:312-314`). Sem log e sem teto de recomeços | Nenhum | — | `RUNBOOKS.md:193` cita `restarted` com o motivo | Herdado (padrão de todos os motivos). RR-R3-05 está só no rascunho |
| Estado pendente persistente no cliente (A04) | Nenhum sinal no servidor. O cliente mostra só `ESTIMATE_UPDATING` (`messages.ts`) | Nenhum | — | — | RR-R3-01 está só no rascunho (ver OBS-B1) |

## Correlação

Caminho de uma entrega do gatilho, com evidência:

1. **Chave da entrega.** O `event.id` do Eventarc vira `eventKey = sha256(event.id)[:40]` (`periods.ts:952-953`).
2. **Contexto do log.** O logger da entrega é criado com `{operation: "onTransactionWrite", requestId: eventKey, workspaceId, transactionId, action}` (`transactions.ts:262-268`). Todo log da entrega leva o mesmo `requestId`: `cash_projection.processed`, `cash_projection_mark.broken`, `.needs_rebuild` e `activity_log.*`.
3. **Registros duráveis.** O mesmo valor identifica:
   - o marcador de entrega `cash_period_events/{eventKey}`, criado com `transaction.create` na transação que grava delta, marca e estado (`periods.ts:1417`);
   - a trilha `activity_logs/transaction_{eventKey}` (`transactions.ts:200-201`).
4. **Estado durável.** `projection_state` guarda `lastMarkIssueTransactionId` e `markIssueMaxEventTime`, mas não a chave da entrega. É o mesmo padrão do `issuePatch` pré-existente (`periods.ts:1167-1186`). A ligação estado → log se faz por `workspaceId`, `transactionId` e instante.
5. **Evidência executada.** No log do `verify:all` da árvore final, as linhas 17750, 17775 e 17846 mostram o evento com `requestId`, `workspaceId`, `transactionId`, `action` e `reason`. Nos logs de `$S/p5f1r3/logs/`, que incluem execuções anteriores e de mutantes, há 55 ocorrências, todas com exatamente as mesmas 9 chaves: `action`, `event`, `message`, `operation`, `reason`, `requestId`, `severity`, `transactionId` e `workspaceId`.
6. **Limite herdado.** A correlação com a callable que gravou o lançamento não é transportada pelo gatilho (`OBSERVABILITY.md:220`, TARGET, PR-OBS-01, P7).

## Auditoria

- **Ações sensíveis:** a R3 não cria ação sensível nem altera trilha.
- **`cash_projection_marks`:** é estado derivado, não auditoria. Só o backend grava. Nas Rules, membro ativo tem `get`; `list` e escrita são negados para todos (`firestore.rules:459, 818-822`). As duas suítes de Rules passaram com 17 de 17 testes.
- **Campos do sinal:** estão em `cash_period_events`, coleção backend-only nos dois sentidos (`firestore.rules:455`).
- **Trilha da reconstrução (TX-15):** a reconstrução segue sem evento de auditoria, `reason` ou `correlationId`. O item está aberto desde a P3-B (plano, linha 1755) e o diff não o altera (ver "Fora do escopo").

## Matriz de evidência

| § | Seção | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Logging estruturado | PASS | O log novo passa pelo logger compartilhado (`logger.ts:107-132`), com JSON, `severity` ERROR e campos fixos. `reason` é um código constante (`projectionMarks.ts:278-320, 425-436`). Sem valor, descrição, categoria ou impressão digital: 55 ocorrências com 9 chaves. A sanitização é testada (`kernel.test.ts:450-530`; `ok 406`–`ok 411` no `verify:all`). O diff não acrescenta `console.*` em backend nem cliente. Volume: um log por primeira quebra de cada cadeia; nos três workspaces com quebra no `verify:all` houve um log cada, sem repetição nos eventos seguintes. Os campos-alvo da §3.1 (`outcome`, `sourceEventId`) são adoção da P7 (PR-OBS-01) |
| 2 | Correlação | PASS | Ver "Correlação" acima |
| 3 | Métricas | Fora do escopo | P7 (PR-OBS-01, E-08). O registro do sinal para a P7 está em OBS-B1 |
| 4 | Erros | PASS | `FingerprintTypeError` nunca é engolido. No gatilho vira `contract_violation`, sem aplicar delta (`periods.ts:1375-1384`). Na reconstrução, para com log e devolve mensagem pt-BR (`rebuild.ts:177-179, 779-781, 1206-1215`). O cliente só mostra mensagens pt-BR: `ESTIMATE_UPDATING`, e falha da leitura da prova vira `ESTIMATE_EXCLUDED_READ_FAILED` (`useIncomeEstimateWith.ts:226-234, 397`). Ver OBS-L2 |
| 5 | Alertas | **FAIL** | OBS-B1: o sinal novo não está na matriz-alvo nem no plano. A configuração dos alertas em si é P7/E-08 |
| 6 | Auditoria | Fora do escopo | O diff não toca. TX-15 é herdado (ver abaixo) |
| 7 | Eventos de segurança | Fora do escopo | P7 (A12/A13, PR-OBS-01) |
| 8 | Reconciliação financeira | PASS | A reconciliação da reconstrução não muda: nenhuma linha do diff cita `reconciliation`/`totals`, e `reconciliationOf` (`rebuild.ts:1031`) fica fora dos hunks. O detector novo de quebra é testado no Emulator: `ok 359` e `ok 366` (`projectionMarks.integration.test.ts:295-317, 524-562`). O detector agendado de deriva é P7 (PR-TX-04) |
| 9 | Webhooks | Fora do escopo | Não tocado (P7, A08–A10) |
| 10 | Resposta a incidentes | Fora do escopo | `INCIDENT_RESPONSE.md` não muda (PR-OBS-02, P7) |
| 11 | Evidência e forense | Fora do escopo | P7 |
| 12 | Disaster recovery | PASS (texto da R3) | Ver detalhe abaixo da tabela. O alvo de RTO/RPO, a aprovação e o exercício são P7/P10. Ver OBS-L3 |
| 13 | Testes obrigatórios | PASS | Ver detalhe abaixo da tabela, e OBS-L1 |

Detalhe do §12. `BACKUP_RESTORE_DR.md:52, 117, 123` é coerente com o código:
- a reconstrução grava a âncora de todo documento da base (`rebuild.ts:1262-1277`);
- a publicação etiqueta todos os meses e órfãos e troca `markSlot` (`rebuild.ts:1585-1610, 1630-1634`);
- PITR ou backup do banco inteiro num instante único mantém meses e marcas consistentes entre si.

Detalhe do §13:
- logger e sanitização: `ok 406`–`ok 411`;
- divergência injetada detectada e registrada: `ok 359` e `ok 366`;
- contrato de implantação: `ok 547`, `ok 551` e `ok 565`;
- correlação do log novo: evidência só empírica (OBS-L1).

## Exercícios

- **Alertas:** nenhum configurado em nenhum ambiente (`OBSERVABILITY.md:253`: "Nenhum destes alertas existe no HEAD").
- **Drills de incidente:** nenhum.
- **Restore e DR:** nunca exercitados; a tabela está vazia (`BACKUP_RESTORE_DR.md:173-179`).
- Tudo isso é P7/P10 e fica fora do escopo. O que se exercitou foi o `verify:all` da árvore final, encerrado com saída 0.

## Achados bloqueantes

### OBS-B1 — MEDIUM — Sinal novo de quebra de marca sem registro para a P7

**O que falta.** O diff cria um sinal operacional separado de `needsRebuild`: o log `cash_projection_mark.broken` e o estado `markRecoveryNeeded`. Esse sinal não tem leitor, métrica nem alerta. A etapa adia leitor e alerta para a P7 (RR-R3-01, A04), mas o adiamento não está registrado onde a P7 trabalha:

- **`OBSERVABILITY.md`** não muda na R3.
  - A linha CURRENT do `onTransactionWrite` (`OBSERVABILITY.md:50`) enumera os eventos de log do gatilho e fica incompleta, sem `cash_projection_mark.broken` e sem os campos do estado.
  - A matriz-alvo §6 (A01–A20) e a linha "Caixa" da §9 (`:378`) não citam o sinal.
  - O critério de saída da P7 é a "matriz de sinais da §6 fechada" (`OBSERVABILITY.md:508`). Do jeito que está, a P7 pode fechar sem esse alerta.
- **O plano mestre** é idêntico na base, na árvore final e no WT, e não tem §20.18 nem RR-R3-01. O RR-R3-01, com "alerta e exibição a owner/admin: P7", existe só no rascunho fora da árvore (`$S/p5f1r3/evidencia/plano-20-18.md:70-73`), aplicado por `aplicar-plano.py` no fechamento. Mesmo assim, estes documentos da árvore afirmam que a §20.18 ou o RR-R3-01 já estão no plano:
  - `revisoes/respostas-revisao-arquitetura-1.md:11`;
  - `revisoes/respostas-revisao-financeiro-escala-privacidade-1.md:14, 45`;
  - `revisoes/respostas-revisao-ptbr-seguranca-1.md:28`;
  - `matriz-requisitos.md:3, 42, 99`;
  - `DESENHO-MARCAS-B03.md:144, 151, 152`;
  - `LEIAME.md:3`.

**Cenário.**
1. Uma entrega do gatilho se perde (`retry_window_exhausted`), ou acontece um conflito com a base.
2. As edições seguintes de uma receita desconsiderada se acumulam como pendências até passar de 16.
3. A cadeia fica `broken` e o estado registra `markRecoveryNeeded=true`.

**Impacto operacional.**
- A estimativa de tempo de trabalho daquele workspace fica em reais, com "A estimativa está em atualização…", por tempo indeterminado.
- O cliente relê 34 vezes na primeira hora e depois 31 por hora por estimativa montada: cerca de 775 leituras/h no PF típico e 13,8 mil/h no teto, pelo §9 do desenho.
- Ninguém é avisado. A recuperação exige que owner/admin rode a reconstrução, que não tem tela.
- O valor financeiro continua correto; o problema é de operação e de custo.

**Remediação (só documentação):**
1. Aplicar ao plano, antes do fechamento, a §20.18 já preparada, com RR-R3-01.
2. Em `OBSERVABILITY.md` §2.1, linha 50, acrescentar:
   - `cash_projection_mark.broken` em ERROR, com `reason` ∈ {`pending_overflow`, `anchor_after_absent`, `anchor_mismatch`, `base_without_anchor`, `anchor_missing`, `invalid_chain`};
   - os campos de `projection_state` (`markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime`, `lastMarkIssue*`);
   - a observação de que o sinal não liga `needsRebuild`.
3. Na §6 de `OBSERVABILITY.md`, criar uma linha de alerta, por exemplo A21 "Prova de aplicação da projeção quebrada":
   - condição: qualquer `cash_projection_mark.broken`, ou `markRecoveryNeeded=true` há mais de N h, usando o estado durável como fonte (ver OBS-I1);
   - destinatário: plantão técnico;
   - runbook: "Projeção de caixa: reconstrução", com a condição de desligamento;
   - milestone P7, classificação TARGET/E-08.
   - Alternativamente, estender a linha 378 da §9.
4. Opcional: acrescentar essa condição de desligamento em `RUNBOOKS.md:193`.

Com os itens 1 a 3 na árvore e o resto inalterado, este parecer passa a PASS.

## Achados não bloqueantes

- **OBS-L1 — LOW. Nenhum teste automatizado verifica o log novo.**
  - **Situação:** a evidência é só empírica, nas linhas 17750, 17775 e 17846 do `verify:all`. Uma regressão passaria sem ser vista: renomear o evento, remover o log ou acrescentar campo com conteúdo.
  - **Remediação:** em `projectionMarks.integration.test.ts`, nos casos das linhas 295 e 524, espionar `functionsLogger.write`, como as suítes da P5-D2 (`ok 594`). Verificar:
    - exatamente as 9 chaves e `severity: ERROR`;
    - `requestId === cashPeriodEventKey(eventId)`;
    - nenhuma emissão no evento seguinte.
- **OBS-L2 — LOW. O mapeamento `content` não tem teste de integração.** O caminho é `FingerprintTypeError` → `contract_violation` no gatilho, e `RebuildContractViolation(..., "content")` → `cash_rebuild_contract_violation` na reconstrução. Só há o teste de unidade da impressão digital (`projectionMarks.test.ts:82-90`).
  - **Risco:** perda de especificidade do diagnóstico, não de visibilidade. Sem a conversão, o erro viraria `permanent_failure` no gatilho ou `internal` na callable; não seria engolido.
  - **Remediação:** um teste de integração com um valor que a serialização canônica recuse.
- **OBS-L3 — LOW. O DR passou a condicionar a reabertura à reconstrução, sem registrar o efeito no RTO.**
  - **Situação:** pelo §9 do desenho, um workspace com N = 200 mil leva cerca de 930 chamadas, ou cerca de 9,3 h, no limite de 100 chamadas por hora por ator (`rebuild.ts:1678-1682`); antes da R3 eram cerca de 670. O RTO proposto para restauração parcial é de até 4 h (`BACKUP_RESTORE_DR.md:92`, D-27, a aprovar na P7). O runbook também não diz como o operador reconstrói um workspace do qual não é owner/admin (PR-ADMIN-01).
  - **Remediação:** registrar a duração da reconstrução como componente do RTO na §5/§6, como insumo da D-27, e apontar a dependência de PR-ADMIN-01.
- **OBS-I1 — INFO. A fonte confiável do sinal é o estado, não o log.** O estado em `projection_state` é atômico com o delta. O log sai depois do commit: se a instância morrer entre os dois, a reentrega cai em `duplicate` e não loga de novo. O alerta da P7 deve ler o estado, ou o estado e o log.
- **OBS-I2 — INFO. `requestId` do gatilho e o contrato da §3.1.** O `requestId` é um hash do `event.id`, não `sourceEventId`. É o padrão da P3-B, coerente com a linha CURRENT do gatilho; a §3.1 é adoção da P7.
- **OBS-I3 — INFO. Contagem quando as duas gerações quebram na mesma entrega.** Se a geração vigente e a preparada quebram juntas, `markIssueCount` sobe 1 e o log traz um só `reason`. Irrelevante para um sinal booleano.
- **OBS-I4 — INFO. `cash_period_events` está classificada como descartável no DR.** `BACKUP_RESTORE_DR.md:62` trata a coleção como operacional, "Descartáveis após o prazo". Mas o `projection_state` não tem `expiresAt` (`periods.ts:981`) e guarda o ponteiro da geração (`categoryGeneration`, `baselineCutoff` e, agora, `markSlot`) e os sinais. A imprecisão é anterior à R3, e a regra nova de reconstruir antes de reabrir recria esse estado. Convém uma linha própria para ele.
- **OBS-I5 — INFO. Passo 8 do DR e restauração total.** O passo 8 (`BACKUP_RESTORE_DR.md:123`) não separa a restauração total consistente (6b), que a §3 já declara consistente. Isso não traz risco; só pode alongar a reabertura.
- **OBS-I6 — INFO. TX-15 ficou mais relevante com a R3.** A trilha de auditoria e a correlação da reconstrução seguem abertas desde a P3-B. Com a R3, a reconstrução vira pré-condição de DR e o único jeito de desligar o sinal. Convém priorizar na P7.

## Fora do escopo desta avaliação

| Item do checklist | Motivo | ID do plano |
| --- | --- | --- |
| Logger global e campos-alvo (`outcome`, `sourceEventId`) | Adoção global na P7 | PR-OBS-01 |
| Correlation ID de servidor de ponta a ponta (callable → gatilho) | Alvo da P7 | PR-OBS-01 |
| Métricas, dashboards e configuração de alertas (A01–A20 e o alerta novo de OBS-B1) | Configuração externa | PR-OBS-01, E-08 |
| Processo de incidente, contenção (modo somente leitura, interruptor por funcionalidade) e drills | Alvo da P7 | PR-OBS-02 |
| Detector agendado de deriva da projeção de caixa | O restante do PR-TX-04 é atribuído à P7 | PR-TX-04 |
| Auditoria e correlação da reconstrução: anterior, não alterada pelo diff. Item aberto e carregado desde a P3-B (plano, linha 1755); a P5-C2, que também mexeu em `rebuild.ts`, o tratou do mesmo modo | Ver OBS-I6 | TX-15 (parte do PR-TX-04) |
| PITR, backups, restore ensaiado, DR exercitado, RTO/RPO aprovados | P7, com exercício completo na P10 | PR-BKP-01, E-07, D-27 |
| Capacidade administrativa auditada para restauração parcial e reconstrução por operador | Alvo da P7 | PR-ADMIN-01 |
| Eventos de segurança, webhooks, forense, captura de erros do frontend | Alvo da P7 | PR-OBS-01 (A08–A13, A19) |
| Leitor e condição de parada do estado pendente; vivacidade do recomeço; custo do estado persistente | Só no rascunho da §20.18 | RR-R3-01, RR-R3-05, RR-R3-09 |

## Verificação

Nada foi alterado no WT nem no repositório. Não subi o Emulator, não compilei `functions/lib` e não acessei Firebase real.

1. **Delta.**
   - `git diff --stat f8267922… 377c2f3f…`: 40 arquivos fora de `evidence/` e 88 de evidência novos.
   - Hashes do WT contra a árvore `377c2f3` com `git hash-object` sem `-w`: só `docs/` difere; às 20:37:24 UTC, zero diferença fora de `docs/`.
   - Plano, `OBSERVABILITY.md`, `RUNBOOKS.md`, `INCIDENT_RESPONSE.md` e `FIREBASE_PRODUCTION.md` têm o mesmo hash na base, no final e no WT; `### 20.18` aparece 0 vez no plano.
2. **Leitura dos diffs.** `transactions.ts`, `periods.ts`, `rebuild.ts`, `projectionMarks.ts` (novo), `firestore.rules` e `BACKUP_RESTORE_DR.md`. Logger lido sem alteração (`git diff --stat … -- functions/src/shared/` vazio).
3. **Buscas.**
   - `cash_projection_mark.broken`, `markRecoveryNeeded` e `markIssue*` em código e testes: nenhum teste referencia o evento de log.
   - `console.*` e chamadas de logger acrescentadas no diff: nenhuma além da nova.
   - Menções às marcas ou à P5-F em `OBSERVABILITY`, `RUNBOOKS`, `INCIDENT_RESPONSE` e `FIREBASE_PRODUCTION`: 0.
   - `20.18` e `RR-R3-01` no plano: 0.
4. **Logs emitidos.** Varredura em Python (`-I`) dos JSON de `cash_projection_mark.broken` em `$S/p5f1r3/logs/*.log`: 55 entradas, um único conjunto de 9 chaves, `reason` ∈ {`pending_overflow` ×38, `anchor_after_absent` ×17}. No `verify-all-final.log`: 3 entradas, uma por workspace, sem repetição nos eventos seguintes.
5. **`verify:all` da árvore `377c2f3`.** Conferi o `.meta` eu mesmo: `fim=2026-11-09T20:22:55Z exit=0`, limpeza 0. O resumo (`verify-all-final.resumo.json`) dá 1.746 testes node do `verify:fast`, 1.289 de integração e 215 do Playwright, sem falha ou skip. No log:
   - `test:rules:projection-marks`: 17/17 (linhas 35999–36150);
   - `ok 169` (isenções), `ok 359`, `ok 366`, `ok 406`–`ok 411`, `ok 547`, `ok 551`, `ok 565`.
   - Nenhuma conclusão depende de execução em curso.
