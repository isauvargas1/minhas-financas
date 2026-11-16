PASS — Observability and incident readiness

Rodada 3 da etapa P5-F.1-R3, somente leitura. É a confirmação documental pedida pelo gate (L-01). Emitida em 2026-11-09, com leitura encerrada às 22:45 UTC.

O veredito vale para o escopo do diff da R3, pela "Política de decisão" da skill, e para o estado final descrito abaixo.
- As edições das 20:57:07 aplicam corretamente o R2-I1 e o R2-I2 e batem com o código.
- O PASS da rodada 2 e o PASS de plataforma cobrem o estado final dos documentos desta superfície.
- Há um achado novo LOW (R3-L1), que não bloqueia, e quatro INFO. Nenhum deles exige mudança de código.

## Escopo

**Estado final avaliado.**
- **Árvore de documentos:** `ad1660a336f043c7331e158e9a85efdae17e277b`. É o estado atual do W. Conferi com um índice temporário próprio (`read-tree HEAD`, `add -A`, `write-tree`) duas vezes, às 22:22 e às 22:42 UTC. Não usei o índice real nem o `final.index`.
- **Árvore de código:** `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`. O `git diff --stat 377c2f3f ad1660a3 -- . ':(exclude)docs'` sai vazio. O `verify:all` dessa árvore terminou com `fim=2026-11-09T20:22:55Z exit=0` (`.meta`), com 0 `not ok` no log.
- **Base do W:** HEAD `1730a1df`, com a R3 sem commit.

**O que mudou desde a minha leitura da rodada 2 (20:49:19).** Comparei, blob a blob, o instantâneo de hashes daquela leitura (`sandbox/r2/wt-hashes.txt`) com a árvore final. Não usei mtime como prova.

- **`OBSERVABILITY.md`: `34b764bf` → `20b3fcc2`.**
  - O blob da rodada 2 não está no repositório, então o reconstruí. O texto final com três trechos revertidos tem exatamente o hash `34b764bf` (`sandbox/r3/scripts/reconstruir-r2.py`).
  - Portanto, a edição das 20:57:07 foi só esta:
    - **linha 50, motivos:** a lista que terminava em "`base_without_anchor` ou `anchor_missing`" passou a terminar em "`anchor_missing` ou `invalid_chain`, este quando a cadeia gravada está fora do formato";
    - **linha 50, campos:** "`markRecoveryNeeded`, `markIssueCount` e `markIssueMaxEventTime`, gravados na primeira quebra de cada geração" virou a lista com os seis campos, mais "de cada cadeia (lançamento × geração)";
    - **linha 277, coluna Runbook do A21:** "Projeção de caixa divergente e rebuild:" virou "RB-T04 (Reconciliação e rebuild financeiro por domínio, linha Caixa; TARGET em RUNBOOKS.md):".
  - A linha do Caixa (379) já citava o A21 na rodada 2 e não mudou depois. O pedido a inclui entre as edições das 20:57:07, mas ela não estava entre elas.
  - O patch `r3-diff-observabilidade.patch` é idêntico, byte a byte (`cmp`), ao `git diff 3eb6041d ad1660a3` que recalculei.
    - Ele tem três trechos, os mesmos do diff `377c2f3f` → final, porque `OBSERVABILITY.md` é igual nas duas árvores de partida.
    - `RUNBOOKS.md` não muda.
- **Plano: `de6216a9` → `028b12ef`.**
  - Também reconstruí o blob da rodada 2. A §20.18 que extraí às 20:50:24 (`sandbox/r2/s2018.md`), sobre o resto do texto final, dá exatamente `de6216a9` (`reconstruir-plano-r2.py`).
  - Depois da rodada 2, mudou só a §20.18:
    - as linhas de revisão de plataforma, observabilidade e gate;
    - os riscos RR-R3-11 a RR-R3-14;
    - o parágrafo de rollback.
  - A linha da P5 (`:56`) e a do histórico (`:816`) não mudaram depois da rodada 2.
- **Iguais à leitura da rodada 2:** `BACKUP_RESTORE_DR.md` (`61edcdb6`) e `FIREBASE_PRODUCTION.md` (`111e05b7`). A edição deles, às 20:47:37 e 20:47:27, é a que conferi na rodada 2.
- **Iguais desde `377c2f3f`:** `RUNBOOKS.md` (`e3211d04`), `INCIDENT_RESPONSE.md` (`344dcf8d`), `ARCHITECTURE.md` e `FINANCIAL_DOMAIN_MODEL.md`.
- **Outros documentos mudados depois da rodada 2:** só evidência.
  - São eles: `matriz-requisitos.md`, `revisoes/LEIAME.md`, `testes-e-resultados.md`, `testes-substituidos.md`, `respostas-gate-1.md` e as cópias de pareceres.
  - Nenhum muda afirmação desta superfície.
  - As cópias dos meus três pareceres em `evidence/p5f1-r3/revisoes/obs-plataforma/` são idênticas aos originais.

**Pontos de entrada e documentos.** São os mesmos das rodadas 1 e 2:
- **pontos de entrada:** gatilho `onTransactionWrite`, callable `rebuildCashPeriods` e leitura da prova no cliente;
- **documentos:** `OBSERVABILITY.md`, `RUNBOOKS.md`, `INCIDENT_RESPONSE.md`, `BACKUP_RESTORE_DR.md`, `FIREBASE_PRODUCTION.md` e a §20.18 do plano.

Nenhuma integração externa é tocada.

## Conferência linha a linha

Li o código do objeto da árvore `377c2f3f`. Cada arquivo citado tem o mesmo hash no W.

### `OBSERVABILITY.md:50` (§2.1, `onTransactionWrite`)

| # | Afirmação do texto final | Evidência | Resultado |
| --- | --- | --- | --- |
| 1 | `cash_projection_mark.broken` em ERROR | Emissão em `transactions.ts:307-313`. `log.error` grava `severity: "ERROR"` (`shared/logger.ts:101-105, 131-132`). Saída real nas linhas 17750, 17775 e 17846 do `verify-all-final.log` | Confere |
| 2 | Com `requestId` da entrega, `workspaceId`, `transactionId` e ação | Contexto do logger em `transactions.ts:260-268`; `requestId = sha256(event.id)[:40]` (`periods.ts:952-953`). Nenhuma chave casa com o filtro de nomes sensíveis (`logger.ts:22-48`). As três linhas do log têm exatamente `operation`, `requestId`, `workspaceId`, `transactionId`, `action` e `reason`, sem valor nem texto | Confere |
| 3 | `reason` é um de seis códigos | `anchor_after_absent` (`projectionMarks.ts:284`), `anchor_mismatch` (`:291`), `base_without_anchor` (`:301`), `anchor_missing` (`:310`), `pending_overflow` (`:320`) e `invalid_chain` (`:425`, `:431`, `:436`), que `markViewOf` repassa (`:278`). Uma cadeia já gravada como `broken` não é registrada nem logada de novo (`periods.ts:1395-1398`). Por isso o backend não leva outro valor ao log | Confere |
| 4 | `invalid_chain`, "quando a cadeia gravada está fora do formato" | `readChain` (`projectionMarks.ts:413-439`): raiz fora de `anchor`, `event`, `absent` ou `null`; `pending` que não é lista; pendência ilegível; ou raiz sem nó. Teste: `projectionMarks.test.ts:309-318` (`ok 170`, linha 1697 do log) | Confere. Uma cadeia com `g` ou `cut` ilegível é ignorada como se fosse de outra geração (`:417`), sem quebra. Isso só acontece com dado escrito fora do backend, e as Rules negam essa escrita (`firestore.rules:818-822`) |
| 5 | O log sai quando a prova quebra, com o delta já aplicado | `markBroken` só existe no resultado `applied` (`periods.ts:1407-1429`). O log vem depois do commit (`transactions.ts:278-313`) | Confere |
| 6 | Registro durável em `cash_period_events/projection_state`, com os seis campos | `cashProjectionStateRef` (`periods.ts:985-991`). `markIssuePatch` (`:1194-1213`) grava `lastMarkIssueCode`, `lastMarkIssueTransactionId` e `lastMarkIssueAt` em `:1209-1211` | Confere |
| 7 | Gravados na primeira quebra de cada cadeia (lançamento × geração) | A marca é uma por lançamento (`cash_projection_marks/{transactionId}`), com uma cadeia por geração. Só conta como já registrada a cadeia com o mesmo `g` e `broken` gravado (`periods.ts:1387-1413`) | Confere. Se duas gerações quebram na mesma entrega, o registro sai uma vez (OBS-I3, mantido) |
| 8 | A publicação só desliga `markRecoveryNeeded` quando o corte cobre `markIssueMaxEventTime` | `rebuild.ts:1633-1634`: o aviso continua ligado só se o máximo for posterior ao corte. Teste: integração 7, `ok 360` (linha 17778 do log) | Confere |
| 9 | Não liga `needsRebuild` | `markIssuePatch` não tem esse campo, ao contrário de `issuePatch` (`periods.ts:1167-1186`) | Confere |
| 10 | Coluna Evidência | `transactions.ts:270-411` passa do fim do arquivo, que tem 406 linhas. `periods.ts:430-577` não cobre o código das marcas (`:1371-1430`). As faixas vêm de antes da R3 (commit `0d97901`). Os nomes citados (`markIssuePatch` e a publicação em `rebuild.ts`) localizam o código | Aceitável (R3-I3) |

### `OBSERVABILITY.md:277` (A21)

| # | Afirmação | Evidência | Resultado |
| --- | --- | --- | --- |
| 11 | Condição: `markRecoveryNeeded = true` em qualquer workspace por mais de 1 h; a fonte é o estado durável | `periods.ts:1202`; `rebuild.ts:1633-1634` | Confere. A medida da duração precisa de uma fonte na P7 (R3-I2) |
| 12 | O log pode faltar se a instância cair depois do commit | O log vem depois do commit. A reentrega encontra a marca de entrega e devolve `duplicate`, sem `markBroken` (`periods.ts:1315-1321`) | Confere |
| 13 | Enquanto durar, a estimativa fica em reais, sem valor errado, e o cliente relê dentro do orçamento | A cadeia quebrada vira `mark_broken` (`projectionProof.ts:327`) e depois `projection_marks` (`consistency.ts:71`). Sem prova não há conversão, e aparece o `ESTIMATE_UPDATING` (`messages.ts:88`). As releituras passam pelo agendador com orçamento (§20.18, "Fallback monetário" e RR-R3-01) | Confere. A frase é conservadora (R3-I1) |
| 14 | Destinatário: plantão técnico e responsável pelo domínio financeiro | O dono da RB-T04 é o "Responsável do domínio financeiro" (`RUNBOOKS.md:141`) | Confere |
| 15 | Runbook RB-T04 (Reconciliação e rebuild financeiro por domínio, linha Caixa; TARGET) | Índice TARGET (`RUNBOOKS.md:132-141`), seção (`:188`) e linha Caixa (`:193`), com o mesmo nome | Confere. Aplica o R2-I2 |
| 16 | Reconstruir; o aviso só desliga com corte posterior a `markIssueMaxEventTime` | `rebuild.ts:1633-1634` também desliga com corte igual ao máximo | Confere. A igualdade é caso de borda sem efeito operacional, e a linha 50 tem a forma exata (R3-I1) |
| 17 | Quem reconstrói sem ser owner/admin depende do PR-ADMIN-01 | `CASH_REBUILD_ROLES = ["owner", "admin"]` (`rebuild.ts:1685, 1697`) | Confere |
| 18 | P7, TARGET / E-08 | Cabeçalho e introdução da §6 (`OBSERVABILITY.md:251-253`) | Confere |

### `OBSERVABILITY.md:379` (§9, Caixa)

| # | Afirmação | Evidência | Resultado |
| --- | --- | --- | --- |
| 19 | O TARGET inclui alerta sobre `markRecoveryNeeded` (A21, P5-F.1-R3) | O texto é igual ao da rodada 2 e casa com a linha 277 | Confere |

### `RUNBOOKS.md` (sem alteração)

| # | Ponto | Evidência | Resultado |
| --- | --- | --- | --- |
| 20 | A linha Caixa da RB-T04 (`:193`) cita só `needsRebuild` | A segunda parte do R2-I2, acrescentar a condição de desligamento na RB-T04, fica para quando a P7 escrever os runbooks, como a própria sugestão previa. A condição já está na linha do A21, que aponta para a RB-T04 | Aceitável (R3-I1) |

### Plano, §20.18: o que mudou depois da rodada 2, nesta superfície

| # | Texto final | Evidência | Resultado |
| --- | --- | --- | --- |
| 21 | Plataforma: "PASS no escopo da R3", pelo diff de índices, scripts, runtime e exports das Functions e DR. Ficam fora E-00 a E-12, PR-AI-02 e PR-PLAT-01 | `PRODUCTION_READINESS_PLAN.md:5175`. Aplica a recomendação da minha rodada 2. É um resumo; a lista completa está no `PARECER-PLATAFORMA.md` | Confere |
| 22 | Observabilidade: rodada 1 FAIL (OBS-B1), rodada 2 PASS | `:5176` | Confere |
| 23 | Rollback: publicar o arquivo de índices da R2A não apaga as isenções sozinho; o CLI pergunta, com "não" como padrão, ou exige `--force`. A sobra é inofensiva, e as marcas são apagadas antes das Rules da R2A | `:5233`. Comportamento conferido no `firebase-tools` 15.32.1 (`lib/firestore/api.js:122-160`) | Confere. PLAT-I2 resolvido |
| 24 | RR-R3-11 a RR-R3-14 | `:5216-5232` | Fora desta superfície. Não mudam os vereditos (ver o anexo) |
| 25 | Resumo do modelo: "A primeira gravação `broken` de uma geração registra `markRecoveryNeeded`, `markIssueCount`, `markIssueMaxEventTime` e o log" | `:5111`, igual à rodada 2 | Aceitável (R3-I3) |

## Mapa de sinais

Só muda a linha do sinal novo. As demais ficam como na rodada 1.

| Sinal crítico | Log / métrica | Alerta | Destinatário | Runbook | Lacuna |
| --- | --- | --- | --- | --- | --- |
| Cadeia de marca quebrada | Log `cash_projection_mark.broken` em ERROR (`transactions.ts:307-313`) e estado durável com os seis campos (`periods.ts:1194-1213, 1407-1413`). Os dois estão no inventário (`OBSERVABILITY.md:50`) | A21, TARGET/E-08 na P7 (`:277`), sobre o estado durável | Plantão técnico e responsável pelo domínio financeiro | RB-T04, linha Caixa (`RUNBOOKS.md:141, 188-193`). O procedimento e a condição de desligamento estão na linha do A21 | A configuração do alerta e a métrica são P7/E-08 (fora do escopo). A §13 ainda diz "A01–A20" (R3-L1) |

## Correlação

Sem mudança desde a rodada 1. O `requestId` da entrega é `sha256(event.id)[:40]` (`periods.ts:952-953`). Ele é o mesmo em todos os logs da entrega, no marcador `cash_period_events/{eventKey}` e em `activity_logs/transaction_{eventKey}`. As linhas 17750, 17775 e 17846 do log mostram o campo nos três eventos de quebra. Agora o §2.1 também documenta esse `requestId`.

## Auditoria

Sem mudança. A R3 não cria ação sensível. A marca é estado derivado, só do backend (`firestore.rules:818-822`). A trilha da reconstrução (TX-15, parte do PR-TX-04, que o plano põe na P7) segue herdada e fora do escopo.

## Matriz de evidência

| § | Seção | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Logging estruturado | PASS | Igual à rodada 2. O inventário do §2.1 agora traz os seis códigos e os seis campos, conferidos no código e nas três linhas reais do log |
| 2 | Correlação | PASS | Igual à rodada 1 |
| 3 | Métricas | Fora do escopo | P7 (PR-OBS-01, E-08) |
| 4 | Erros | PASS | Igual à rodada 1 |
| 5 | Alertas | PASS | O A21 tem condição, destinatário, runbook existente (RB-T04), milestone e classificação. Nenhum alerta está configurado fora do repositório. A faixa da §13 está desatualizada (R3-L1, LOW, não bloqueia) |
| 6 | Auditoria | Fora do escopo | Herdado (TX-15, PR-TX-04, P7) |
| 7 | Eventos de segurança | Fora do escopo | P7 |
| 8 | Reconciliação financeira | PASS | Igual à rodada 2 (`ok 359`, `ok 360`, `ok 366`) |
| 9 | Webhooks | Fora do escopo | P7 |
| 10 | Resposta a incidentes | Fora do escopo | PR-OBS-02 |
| 11 | Evidência e forense | Fora do escopo | P7 |
| 12 | Disaster recovery | PASS (texto da R3) | `BACKUP_RESTORE_DR.md` é igual ao da rodada 2. O rollback da §20.18 agora trata as isenções e a ordem das marcas (PLAT-I2). RTO/RPO aprovados e exercício de DR são P7/P10 |
| 13 | Testes obrigatórios | PASS | Igual à rodada 2: `ok 406` a `ok 411` (logger e sanitização); `ok 359`, `ok 360` e `ok 366` (detecção e registro); `ok 170` (`invalid_chain`). OBS-L1 mantido |

## Exercícios

Sem mudança. Nenhum alerta está configurado. Não houve drill nem exercício de DR ou de restore (`BACKUP_RESTORE_DR.md:173-179`). Isso é P7/P10 e fica fora do escopo. O exercício executado continua sendo o `verify:all` da árvore de código final, com saída 0.

## Achados bloqueantes

Nenhum.

## Achados por severidade

### LOW

**R3-L1 — O registro de configuração externa (§13) não inclui o A21.**
- **Cenário:** em `OBSERVABILITY.md:471`, a linha "Políticas de alerta" diz "A01–A20, com condição, dono e link de runbook".
  - O A21 entrou na §6 com a correção do OBS-B1, antes da minha leitura da rodada 2, e a faixa não foi atualizada.
  - Não percebi isso na rodada 2. A edição das 20:57:07 não tem relação com o problema.
- **Impacto:** o critério de saída da P7 pede a coluna "Última verificação" da §13 preenchida com evidência de STAGING (`:509`). Quem usar só a §13 como lista pode deixar o A21 sem verificação. O risco é baixo, porque há três outras referências:
  - a §6 diz que todo alerta precisa dessa evidência (`:253`);
  - o mesmo critério de saída pede a matriz da §6 fechada;
  - o RR-R3-01 do plano põe o A21 na P7.
- **Por que não bloqueia:** nenhum alerta está configurado fora do repositório. O A21 tem condição, destinatário, runbook, dono e milestone na §6. Nenhum critério de FAIL da skill se aplica.
- **Remediação:** trocar "A01–A20" por "A01–A21" na linha 471, ou registrar a lacuna na §20.18. A condição de reconferência está no fim deste parecer.

### INFO

**R3-I1 — Nuances de redação, sem ação.**
- **A21, coluna Runbook:** o texto diz "corte posterior a `markIssueMaxEventTime`", mas o código também desliga com corte igual ao máximo (`rebuild.ts:1633-1634`). Isso não muda a operação, e a linha 50 usa a forma exata ("cobre").
- **A21, coluna Condição:** "a estimativa de tempo de trabalho fica em reais" vale só para a estimativa que depende da marca quebrada, ou seja, uma desconsiderada ou um espelho de estorno na janela (`consistency.ts:62, 71`). As outras continuam provadas. A frase superestima o impacto, o que é o lado seguro.
- **RB-T04:** a linha Caixa (`RUNBOOKS.md:193`) ainda não tem a condição de desligamento. Isso fica para a P7, como o R2-I2 previa. Enquanto isso, a condição está na linha do A21.

**R3-I2 — Fonte da duração do A21, para a P7. Corrige uma observação minha da rodada 2.**
- No R2-I1, escrevi que os campos `lastMarkIssue*` serviam de referência de tempo para o "por mais de 1 h". Como início, não servem: `lastMarkIssueAt` é regravado a cada quebra nova (`periods.ts:1211`), e nenhum campo guarda desde quando `markRecoveryNeeded` está ligado.
- Um alerta que medisse a idade por `lastMarkIssueAt` ficaria mudo enquanto chegassem quebras novas.
- **Para a P7:** a duração precisa vir de uma de duas fontes:
  - a varredura agendada de caixa (§9, linha 379), que observa a presença contínua do estado;
  - um campo de início, gravado só quando o aviso liga.
- A §5 não tem métrica para esse estado. Isso é esperado, porque a §5 é toda TARGET.
- O texto final do `OBSERVABILITY.md` não afirma o contrário.

**R3-I3 — Resumos e referências antigas, sem ação na R3.**
- **Plano:** `PRODUCTION_READINESS_PLAN.md:5111` ainda diz "a primeira gravação `broken` de uma geração" e lista três campos. A forma exata está no §2.1, que o RR-R3-01 indica para "o evento e os campos".
- **Faixas de linha:** as da coluna Evidência da linha 50 são anteriores à R3 (item 10).

**R3-I4 — Correção de uma frase minha da rodada 2, apontada pelo gate.**
- **O que escrevi:** que nenhum teste lê `docs/`.
- **O que acontece:** a varredura de segredos lê (`tests/unit/ai-backend-only.test.ts:76-90`). Os pathspecs `*.json` e `*.ts` do `git ls-files` casam em qualquer profundidade e incluem os `.json` versionados de `docs/`.
- **A conclusão não muda.** Conferi na árvore final:
  - `docs/` tem 137 arquivos `.json` e nenhum `.ts`;
  - `git grep -l -E 'AIza[0-9A-Za-z_-]{35}'` em todo o `docs/` de `ad1660a3` não acha arquivo nenhum (pedi só os nomes);
  - o lint roda só em `functions/`;
  - o `tsconfig.json` da raiz não inclui `docs/`;
  - as nove menções a `docs/` no código são comentários.
- **Consequência:** o `verify:all` de `377c2f3f` continua valendo para a árvore de documentos final, tanto neste W quanto depois do commit, no CI.

### Estado dos achados anteriores

| ID | Severidade | Estado |
| --- | --- | --- |
| OBS-B1 | MEDIUM | Resolvido na rodada 2; continua resolvido |
| OBS-L1, OBS-L2 | LOW | Mantidos, sem bloquear, registrados no RR-R3-01 |
| OBS-L3 | LOW | Resolvido (RR-R3-09 e passo 8 do DR) |
| OBS-I1 | INFO | Resolvido |
| OBS-I2 a OBS-I6 | INFO | Mantidos |
| R2-I1 | INFO | Resolvido às 20:57:07 (itens 3, 4, 6 e 7). A observação sobre a duração foi corrigida em R3-I2 |
| R2-I2 | INFO | Resolvido no `OBSERVABILITY.md` (item 15). A parte da RB-T04 fica para a P7 (R3-I1) |

## Fora do escopo desta avaliação

Igual à rodada 2:

| Item | ID do plano |
| --- | --- |
| Logger global e campos-alvo | PR-OBS-01 |
| Correlação de ponta a ponta | PR-OBS-01 |
| Métricas, dashboards e configuração dos alertas, inclusive o A21 e a fonte da duração dele | PR-OBS-01, E-08 |
| Processo de incidente, contenção e drills | PR-OBS-02 |
| Detector agendado de deriva | PR-TX-04, P7 |
| Auditoria e correlação da reconstrução (herdado, não alterado pelo diff) | TX-15 (parte do PR-TX-04) |
| PITR, backups, restore e DR exercitados; RTO/RPO aprovados | PR-BKP-01, E-07, D-27; P7/P10 |
| Capacidade administrativa do operador | PR-ADMIN-01 |
| Eventos de segurança, webhooks, forense, frontend | PR-OBS-01 (A08–A13, A19) |
| Leitor e condição de parada do estado pendente, vivacidade do recomeço, custo | RR-R3-01, RR-R3-05, RR-R3-09 |

## Anexo — plataforma: `PASS — Firebase production readiness` mantido

- **Documentos e código:** os documentos de plataforma não mudaram depois da rodada 2 (hashes no Escopo), e nada mudou fora de `docs/`.
- **Registro no plano:** o plano agora diz "PASS no escopo da R3" (item 21), como recomendei.
- **Projeto de produção:** nas linhas acrescentadas em `docs/` desde `3eb6041d`, o identificador do projeto aparece só em duas linhas da cópia do meu `PARECER-PLATAFORMA.md`. As duas descrevem a configuração herdada e a busca feita; nenhuma registra uso novo do projeto.
- **PLAT-I2:** resolvido (item 23).
- **Demais INFO:** PLAT-I1 e PLAT-I5 mantidos; PLAT-I3 e PLAT-I4 resolvidos na rodada 2.
- **PLAT-R3-I1 (INFO) — precisão do RR-R3-11.**
  - O plano diz que o emulador de Functions "mantém um processo `node` por função".
  - No `firebase-tools` 15.32.1, o pool abre um worker para cada chamada concorrente de uma função e só encerra os ociosos quando o código é recarregado ou o emulador sai (`lib/emulator/functionsRuntimeWorker.js:242-268, 284-308`). Por isso o gate contou 10 workers de `getFinancialReport`.
  - A conclusão e a mitigação continuam valendo, e a R3 não muda as exportações: `functions/src/index.ts` e `firebase.json` são iguais entre `cd95e1cb` (R2A) e `377c2f3f`.
- **RR-R3-12 a RR-R3-14:** não mudam o escopo de plataforma. Entre `cd95e1cb` e `377c2f3f`, de `.github`, `firebase.json`, `.firebaserc`, `package.json` e `functions/package.json`, só mudaram scripts do `package.json`, já conferidos no `PARECER-PLATAFORMA.md`.

## Condição de reconferência

Este parecer vale para a árvore de documentos `ad1660a3` com o código `377c2f3f`.

**Nenhuma das mudanças previstas exige reconferência**, desde que:
1. a cópia deste parecer em `docs/production/evidence/p5f1-r3/revisoes/obs-plataforma/` seja idêntica ao original (mesmo hash);
2. os registros só anotem vereditos e achados, fiéis a este parecer: PASS, R3-L1 LOW e os INFO. Isso vale para:
   - os marcadores (`[[R3-OBS]]`, `[[REVISOES-ESTADO]]`, `[[VEREDITO]]` e `[[GATE]]`);
   - as linhas de revisão e do gate da §20.18;
   - a linha da P5 e o histórico;
3. não mude nenhuma outra frase da §20.18 nesta superfície: RR-R3-01, RR-R3-09, "Condições de implantação e de restauração", "Rollback" e a linha de plataforma.

**Exigem reconferência:**
- **qualquer mudança fora de `docs/`** (código, testes ou configuração): reconferência completa, com novo `verify:all`;
- **qualquer mudança** em `OBSERVABILITY.md`, `RUNBOOKS.md`, `INCIDENT_RESPONSE.md`, `BACKUP_RESTORE_DR.md` ou `FIREBASE_PRODUCTION.md`.
  - **Exceção:** se a única mudança em `OBSERVABILITY.md` for trocar "A01–A20" por "A01–A21" na linha 471 (R3-L1), o veredito se mantém.
  - Nesse caso, basta conferir que o diff contra o blob `20b3fcc2` é só essa troca, numa única linha;
- **um `.json` ou `.ts`, novo ou alterado, em `docs/`** que case com o padrão da varredura de segredos (R3-I4).

## Verificação

Somente leitura. Não usei Emulator, build nem testes, não acessei Firebase real e não li segredos. Escrevi só neste diretório (`sandbox/r3/` e este parecer).

1. **Árvores:**
   - índice temporário próprio em `sandbox/r3/`, que deu `ad1660a3` às 22:22 e às 22:42 UTC;
   - diff fora de `docs/` entre `377c2f3f` e `ad1660a3`, vazio;
   - `--name-status` de `3eb6041d` → `ad1660a3` idêntico a `gate-r1/docs-3eb6041d-para-X.name-status.txt`: 85 linhas, nenhuma fora de `docs/`.
2. **Mudanças desde a rodada 2:**
   - hashes da rodada 2 comparados com os da árvore final, documento a documento;
   - reconstrução dos blobs `34b764bf` (`OBSERVABILITY.md`) e `de6216a9` (plano), com `sandbox/r3/scripts/reconstruir-r2.py` e `reconstruir-plano-r2.py`;
   - diff palavra a palavra da edição das 20:57:07 (`sandbox/r3/diff-r2-para-final.wdiff`);
   - diff da §20.18 contra o extrato da rodada 2.
3. **Patch fornecido:** idêntico, por `cmp`, ao `git diff 3eb6041d ad1660a3 -- OBSERVABILITY.md RUNBOOKS.md`.
4. **Código lido da árvore `377c2f3f`:**
   - `projectionMarks.ts:150-548`;
   - `periods.ts:952-991, 1017-1078, 1152-1213, 1256-1266, 1302-1430`;
   - `transactions.ts:255-342`;
   - `rebuild.ts:1612-1660, 1685-1704`;
   - `shared/logger.ts:1-134`;
   - no cliente: `projectionProof.ts:327`, `consistency.ts:51-72` e `messages.ts:88`;
   - `firestore.rules:818-822`;
   - `tests/unit/ai-backend-only.test.ts:18-90`.
5. **Documentos:**
   - `RUNBOOKS.md:132-147, 186-205`;
   - `OBSERVABILITY.md` §2.1, §5, §6, §9 e §13, e o critério de saída da P7 no fim da §15 (`:505-509`);
   - §20.18 do plano, linhas 5086-5235.
6. **Log do `verify:all`** (`p5f1r3/logs/verify-all-final.log`):
   - as três linhas de `cash_projection_mark.broken` (17750, 17775 e 17846);
   - `ok 359`, `ok 360` e `ok 366` (17752, 17778 e 17851);
   - `ok 406` a `ok 411` (3113 a 3143);
   - `ok 170` (1697);
   - 0 `not ok`, e o `.meta` com `exit=0`.
7. **`firebase-tools` 15.32.1 instalado:** `lib/firestore/api.js:122-160` e `lib/emulator/functionsRuntimeWorker.js:228-320`.
8. **Buscas:**
   - identificador do projeto de produção nas linhas acrescentadas em `docs/`: 2 ocorrências, só na cópia do meu parecer de plataforma;
   - padrão de chave do Google em `docs/` da árvore final: 0 arquivo (pedi só nomes);
   - menções a `docs/` no código: 9, todas em comentários;
   - faixas de alertas (`A01–A2…`) e `A21` nos documentos de produção;
   - `RB-T04` no plano: 0 ocorrência.
9. **Cópias dos meus pareceres na evidência:** idênticas aos originais.
