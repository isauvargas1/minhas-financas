PASS — Observability and incident readiness

Rodada 2, somente leitura, da etapa P5-F.1-R3, emitida em 2026-11-09 (leitura encerrada às 20:55 UTC).

O veredito vale para o escopo do diff da R3, pela "Política de decisão" da skill. **O OBS-B1 está resolvido.** Os três itens pedidos estão na árvore, e nenhum outro achado do escopo bloqueia. Itens de milestones posteriores seguem em "Fora do escopo", com o ID do plano.

## Escopo

- **O que mudou desde a rodada 1:** só documentos.
  - Às 20:49:19 UTC, havia zero diferença fora de `docs/` em relação à árvore de código `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` (comparação por `git hash-object` sem `-w`).
  - Documentos alterados depois dela: `PRODUCTION_READINESS_PLAN.md`, `OBSERVABILITY.md`, `BACKUP_RESTORE_DR.md`, `FIREBASE_PRODUCTION.md`, `DATA_MODEL.md`, `PRIVACY_LGPD.md` e `DATA_RETENTION_LIFECYCLE.md`, além de 79 arquivos de `docs/production/evidence/`.
- **O `verify:all` da árvore final continua válido.** Terminou com `fim=2026-11-09T20:22:55Z exit=0`, conferido no `.meta`. Nenhum teste, ferramenta ou E2E lê `docs/` em execução: as quatro ocorrências de caminhos de `docs/` em código são comentários (`work-time-p5f.rules.integration.test.mjs:377`, `retention.ts:20`, `ai/policy.ts:17` e `notifications-exit-race.spec.ts:8`).
- **Pontos de entrada, integrações e o restante do escopo:** os mesmos da rodada 1 (`PARECER-OBSERVABILIDADE.md`).

## Conferência do OBS-B1

| Item pedido | Onde está | Conferência |
| --- | --- | --- |
| 1. Plano mestre com a §20.18 e o RR-R3-01, atribuindo o sinal à P7 | `PRODUCTION_READINESS_PLAN.md:5086` | A seção aparece uma única vez, com a linha da P5 e a do histórico de 2026-11-09. O RR-R3-01 diz: "A P7 recebe o sinal". Ele cita o A21 da §6, sobre o estado durável, como critério de saída da P7; o evento e os campos no §2.1; e a exibição a owner/admin junto com a condição de parada das releituras. O OBS-L3 está no RR-R3-09. As condições de implantação põem os índices antes das Functions, ou junto, e o rollback trata as 6 isenções. Com a seção aplicada, as afirmações dos documentos de evidência ("a §20.18 existe") passaram a ser verdadeiras |
| 2. `OBSERVABILITY.md` §2.1, linha do `onTransactionWrite` | `OBSERVABILITY.md:50` | Traz `cash_projection_mark.broken` em ERROR, com `requestId` da entrega, `workspaceId`, `transactionId`, ação e `reason`. Diz que o delta já foi aplicado. Registra o estado durável (`markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime`). Diz que a publicação só desliga o sinal quando o corte cobre `markIssueMaxEventTime`, o que confere com `rebuild.ts:1633-1634`, e que o sinal não liga `needsRebuild`, o que confere com `periods.ts:1188-1213`. Pequenas imprecisões em R2-I1 |
| 3. `OBSERVABILITY.md` §6, alerta A21, e a §9 | `OBSERVABILITY.md:277` (A21) e `:379` (Caixa) | O A21 usa como condição `markRecoveryNeeded = true` por mais de 1 h, e a fonte é o estado durável. O log aparece como diagnóstico que pode faltar, o que absorve o OBS-I1. Destinatário: plantão técnico e responsável pelo domínio financeiro. O runbook diz que o aviso só desliga com corte posterior a `markIssueMaxEventTime` e cita o PR-ADMIN-01. Milestone P7, TARGET/E-08. A linha "Caixa" da §9 cita o A21 |

O estado que o A21 lê é verificado no Emulator pelas integrações 6, 7 e 13 de `testes-e-resultados.md`. Todas passaram no `verify:all`:
- integração 6: `ok 359` (`projectionMarks.integration.test.ts:295`);
- integração 7: `ok 360` (`:323`), linha 17778 do log;
- integração 13: `ok 366` (`:524`).

## Mapa de sinais

Só muda a linha do sinal novo; as demais ficam como na rodada 1.

| Sinal crítico | Log / métrica | Alerta | Destinatário | Runbook | Lacuna |
| --- | --- | --- | --- | --- | --- |
| Cadeia de marca quebrada | Log `cash_projection_mark.broken` em ERROR (`transactions.ts:307-313`). Estado durável `markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime` e `lastMarkIssue*` (`periods.ts:1194-1213, 1407-1413`). Registrados em `OBSERVABILITY.md:50` | A21, TARGET/E-08 na P7 (`OBSERVABILITY.md:277`), sobre o estado durável | Plantão técnico e responsável pelo domínio financeiro | Na própria linha do A21: reconstruir, condição de desligamento, PR-ADMIN-01 | A configuração do alerta é P7/E-08 (fora do escopo). O nome do runbook não casa com uma seção de `RUNBOOKS.md` (R2-I2) |

## Correlação

Sem mudança desde a rodada 1. O `requestId` da entrega é `sha256(event.id)[:40]` (`periods.ts:952-953`). É o mesmo em todos os logs da entrega, no marcador `cash_period_events/{eventKey}` e em `activity_logs/transaction_{eventKey}`. A evidência está no `verify:all`, nas linhas 17750, 17775 e 17846. O `OBSERVABILITY.md:50` agora documenta esse `requestId`.

## Auditoria

Sem mudança. A R3 não cria ação sensível. A marca é estado derivado e backend-only (`firestore.rules:818-822`). A trilha da reconstrução (TX-15) é herdada e segue em "Fora do escopo".

## Matriz de evidência

| § | Seção | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Logging estruturado | PASS | Igual à rodada 1. Agora o evento também está no inventário CURRENT (`OBSERVABILITY.md:50`) |
| 2 | Correlação | PASS | Igual à rodada 1 |
| 3 | Métricas | Fora do escopo | P7 (PR-OBS-01, E-08) |
| 4 | Erros | PASS | Igual à rodada 1 |
| 5 | Alertas | **PASS** | O sinal novo está na matriz-alvo (A21), com condição, destinatário, runbook, milestone e classificação. A §9 e o plano (RR-R3-01) apontam para ele. Não há alerta configurado fora do repositório, então a exigência de registro de alertas configurados não se aplica. A configuração é P7/E-08 |
| 6 | Auditoria | Fora do escopo | Herdado (TX-15) |
| 7 | Eventos de segurança | Fora do escopo | P7 |
| 8 | Reconciliação financeira | PASS | Igual à rodada 1. A reconciliação da reconstrução não muda, e o detector novo é testado (`ok 359`, `ok 360`, `ok 366`) |
| 9 | Webhooks | Fora do escopo | P7 |
| 10 | Resposta a incidentes | Fora do escopo | PR-OBS-02 |
| 11 | Evidência e forense | Fora do escopo | P7 |
| 12 | Disaster recovery | PASS (texto da R3) | O texto continua coerente com o código. O passo 8 (`BACKUP_RESTORE_DR.md:123`) agora registra a duração da reconstrução: cerca de 930 chamadas, ou 9,3 h no limite de 100 chamadas por hora (`rebuild.ts:1678-1682`). Ele a aponta como insumo da D-27 e indica a dependência do PR-ADMIN-01; o RR-R3-09 repete isso no plano. RTO/RPO aprovados e o exercício de DR são P7/P10 |
| 13 | Testes obrigatórios | PASS | O logger e a sanitização são testados (`ok 406`–`ok 411`). A detecção injetada e o registro também (`ok 359`, `ok 360`, `ok 366`). A ausência de teste dos campos do log é LOW e não bloqueia (OBS-L1) |

## Exercícios

Sem mudança. Nenhum alerta está configurado; não houve drill nem exercício de DR ou restore (`BACKUP_RESTORE_DR.md:173-179`). Isso é P7/P10 e fica fora do escopo. O exercício executado foi o `verify:all` da árvore final, com saída 0.

## Achados bloqueantes

Nenhum. O OBS-B1, de severidade MEDIUM, está resolvido conforme a conferência acima.

## Classificação dos achados não bloqueantes

| ID | Severidade | Estado na rodada 2 | Motivo |
| --- | --- | --- | --- |
| OBS-L1 | LOW | **Mantido, sem bloquear** | Os campos do log continuam sem teste automatizado. O risco residual está no plano (RR-R3-01, "Testes do log"). Continua LOW porque o A21 lê o estado durável, coberto por três integrações; o log é diagnóstico; e o mecanismo de sanitização é testado no logger compartilhado |
| OBS-L2 | LOW | **Mantido, sem bloquear** | O mapeamento `content` continua sem teste de integração, e isso está registrado no mesmo item do plano. Sem a conversão, o erro viraria `permanent_failure` no gatilho ou `internal` na callable; nunca seria engolido |
| OBS-L3 | LOW | **Resolvido** | Pela linha do passo 8 do DR e pelo RR-R3-09 do plano |
| OBS-I1 | INFO | **Resolvido** | O A21 usa o estado como fonte e diz que o log pode faltar |
| OBS-I2 | INFO | Mantido | O `requestId` do gatilho é hash do `event.id`, não `sourceEventId`. A adoção da §3.1 é P7 |
| OBS-I3 | INFO | Mantido | Se as duas gerações quebram na mesma entrega, a contagem sobe só 1 |
| OBS-I4 | INFO | Mantido | `BACKUP_RESTORE_DR.md:62` ainda trata `cash_period_events` como descartável. O `projection_state` (sem `expiresAt`, `periods.ts:981`) guarda o ponteiro da geração e os sinais. É anterior à R3 e fica coberto pela regra de reconstruir antes de reabrir |
| OBS-I5 | INFO | Mantido | O passo 8 não separa a restauração total consistente (6b). Não há risco; só pode alongar a reabertura |
| OBS-I6 | INFO | Mantido | O TX-15 ficou mais relevante com a R3: a reconstrução é pré-condição de DR e o único jeito de desligar o A21 |
| R2-I1 | INFO | **Novo** | Ver detalhe abaixo da tabela |
| R2-I2 | INFO | **Novo** | Ver detalhe abaixo da tabela |

**R2-I1 — imprecisões na linha 50 do `OBSERVABILITY.md`:**
- A lista de `reason` tem 5 códigos e omite `invalid_chain`, que também pode sair. Quando a cadeia gravada está fora do formato, `readChain` devolve `broken("invalid_chain")` (`projectionMarks.ts:425-436`). `markViewOf` repassa o código (`:278`). Como o `broken` cru não é string, o gatilho registra e loga (`periods.ts:1395-1398`). No produto isso só ocorre com dado corrompido ou escrito fora do backend.
- Faltam os campos `lastMarkIssueCode`, `lastMarkIssueTransactionId` e `lastMarkIssueAt` (`periods.ts:1209-1211`). São o registro durável do código e do lançamento quando o log falta, e servem de referência de tempo para o "por mais de 1 h" do A21.
- "Na primeira quebra de cada geração" quer dizer, na verdade, "na primeira quebra gravada de cada cadeia (lançamento × geração)".
- O alerta não depende de nada disso, porque lê `markRecoveryNeeded`.
- **Sugestão:** acrescentar `invalid_chain` e os três campos, e precisar a frase.

**R2-I2 — o runbook citado não existe com esse nome.** A coluna "Runbook" do A21, assim como a do A05, que é anterior, cita "Projeção de caixa divergente e rebuild". `RUNBOOKS.md` não tem seção com esse nome; a mais próxima é a RB-T04, "Reconciliação e rebuild financeiro por domínio" (TARGET, `RUNBOOKS.md:188-193`). Os passos essenciais estão na própria linha do A21.
- **Sugestão:** citar a RB-T04 e acrescentar nela a condição de desligamento, quando a P7 escrever os runbooks.

## Fora do escopo desta avaliação

Igual à rodada 1:

| Item | ID do plano |
| --- | --- |
| Logger global e campos-alvo | PR-OBS-01 |
| Correlação de ponta a ponta | PR-OBS-01 |
| Métricas, dashboards e configuração dos alertas, inclusive o A21 | PR-OBS-01, E-08 |
| Processo de incidente, contenção e drills | PR-OBS-02 |
| Detector agendado de deriva | PR-TX-04, P7 |
| Auditoria e correlação da reconstrução (herdado, não alterado pelo diff) | TX-15 |
| PITR, backups, restore e DR exercitados, RTO/RPO aprovados | PR-BKP-01, E-07, D-27; P7/P10 |
| Capacidade administrativa do operador | PR-ADMIN-01 |
| Eventos de segurança, webhooks, forense, frontend | PR-OBS-01 (A08–A13, A19) |
| Leitor e condição de parada do estado pendente, vivacidade do recomeço, custo | RR-R3-01, RR-R3-05, RR-R3-09 |

## Anexo — plataforma: o veredito continua `PASS — Firebase production readiness`

Nenhum dos documentos alterados cria falha no escopo de plataforma. Não citam o projeto de produção em linha nova: 0 ocorrências nas linhas acrescentadas ao plano, ao `BACKUP_RESTORE_DR.md` e ao `FIREBASE_PRODUCTION.md`. Também não mudam configuração versionada. Por isso não há `PARECER-PLATAFORMA-RODADA-2.md`.

Classificação dos INFO de plataforma:
- **PLAT-I1 — mantido.** Ver detalhe abaixo.
- **PLAT-I2 — parcialmente resolvido.** Ver detalhe abaixo.
- **PLAT-I3 — resolvido.** A ordem "índices antes das Functions, ou junto" está nas condições de implantação da §20.18 e no `FIREBASE_PRODUCTION.md` §5.
- **PLAT-I4 — resolvido.** O `FIREBASE_PRODUCTION.md` §5 tem a linha da R3: as 6 isenções, a herança nos subcampos, nenhum composto novo, a ordem de publicação, o `predeploy:rules` com build e "nada publicado". As contagens da seção já estavam defasadas antes da R3 e continuam assim.
- **PLAT-I5 — mantido, como ponto positivo.**

**PLAT-I1 — mantido.** `sonda-updatetime.cjs:7` e `sonda-transacao-leitura.cjs:13-14` seguem sem exigir `FIRESTORE_EMULATOR_HOST`, mas só apontam para `minhas-financas-local`. Os três scripts novos de revisores que chamam `initializeApp` usam projeto fictício e não fazem chamada remota: `mundo.cjs:7`, `sonda-paridade-tipos.cjs:10,18` e `sonda-custo-gatilho.cjs:3,9`.

**PLAT-I2 — parcialmente resolvido.** O rollback da §20.18 agora trata as 6 isenções, mas republicar o arquivo da R2A não as apaga sozinho:
- o `firebase-tools` lista as isenções ausentes do arquivo e pergunta antes de apagar, com "não" como padrão; em modo não interativo, só apaga com `--force` (`firebase-tools/lib/firestore/api.js:123-158`);
- a sobra é inofensiva;
- **sugestão:** dizer "confirmando a exclusão no prompt do CLI, ou com `--force`". Neste caso o `--force` não apagaria nenhum composto, porque os compostos são idênticos;
- **sugestão:** dizer também que as marcas devem ser apagadas antes de publicar as Rules da R2A, ou o bloco da R3 deve ser mantido até lá.

**Nota de escopo.** Na rodada 1, deixei de listar o PR-AI-02/E-00 (rotação da chave Gemini; P0, ação externa) em "Fora do escopo".
- Ele não é afetado pelo diff. Segui a prática das etapas da P5 (P5-C1, P5-D2, P5-D2.1, P5-E1), que listam esse item e o E-01…E-12 como configuração externa herdada e pendente.
- Registro, para quem decidir o gate da P5: no gate da P2 (plano, linhas 1224 e 1355), o veredito desta skill foi FAIL justamente por esse item ("item de milestone anterior, que a skill não deixa fora do escopo").
- Recomendo que a §20.18 registre a plataforma como "PASS no escopo da R3", como fez a P5-C1 na linha 3449.

## Verificação

Somente leitura, sem Emulator, sem build e sem acesso a Firebase real.

1. **Comparação do WT com `377c2f3`** por `git hash-object --no-filters`: 0 diferença fora de `docs/` às 20:49:19 UTC; lista dos documentos alterados.
2. **Diffs dos documentos contra `377c2f3`:**
   - `OBSERVABILITY.md`: linha 50, A21 em `:277`, Caixa em `:379`;
   - `BACKUP_RESTORE_DR.md`: passo 8 em `:123`;
   - `FIREBASE_PRODUCTION.md`: linha nova em `:201`;
   - plano: 137 linhas acrescentadas e 1 trocada; §20.18 na linha 5086, uma única vez.
3. **Leitura da §20.18:** custos, condições de implantação, RR-R3-01, RR-R3-09 e rollback. Integrações 6, 7 e 13 casadas com `ok 359`, `ok 360` e `ok 366` no `verify-all-final.log`.
4. **Código, para conferir as afirmações dos documentos:**
   - `projectionMarks.ts:258-440`: códigos alcançáveis de `reason`, inclusive `invalid_chain`;
   - `periods.ts:1194-1213, 1388-1413`: gravação e campos;
   - `rebuild.ts:1633-1634`: condição de desligamento;
   - `firebase-tools/lib/firestore/api.js:73-158`: comportamento das isenções no rollback.
5. **Buscas:**
   - projeto de produção nas linhas acrescentadas: 0;
   - leitura de `docs/` por testes: nenhuma, só comentários;
   - projetos e guardas nos scripts de `evidence/p5f1-r3/**`;
   - seções de `RUNBOOKS.md`.
