PASS — Multi-tenant security review

**Etapa:** P5-F.1-R3 (B03), rodada 2. Conferência das respostas a M1, L1 e I1 a I5 na árvore final de código.
**Revisor:** independente, só leitura. Nada foi alterado no WT nem no repositório, e nenhum Emulator foi iniciado nesta rodada.
**Data:** 2026-11-09, das 20:12 às 20:20 UTC.

**Árvore.** O código está congelado na árvore `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`. Conferi o WT contra ela arquivo a arquivo, fora de `docs/`:

- `git hash-object` de cada arquivo comparado ao blob da árvore: 797 blobs iguais e 10 symlinks `.claude/skills/*` iguais; nenhum arquivo a mais no WT.
- `firestore.rules`: mesmo blob da rodada 1 (`133b422e`, sha256 `3f6f8eb8…dd39e`). As Rules não mudaram entre a árvore da rodada 1 (`90c06358`) e a congelada.
- Inalterados também desde a rodada 1 (mesmo blob): a suíte oficial das marcas, `projectionReads.ts`, `transactions/api.ts`, `useIncomeEstimateWith.ts`, `projectionProof.ts`, `rebuild.ts`, `triggers/transactions.ts` e `work-time-guard.test.ts`.

**Veredito.** M1 e L1 estão resolvidos. I4 está resolvido. I1, I2 e I3 foram classificados e os aceito. I5 fica pendente até o fechamento, sem bloquear.

As mudanças desde a rodada 1 não afetam isolamento nem autorização:

- poda da marca pelo gatilho;
- isenções de índice da coleção;
- testes de integração 15 e 16;
- remoção de `observeDependentRead`.

Achados novos: nenhum HIGH, MEDIUM ou LOW. São 4 INFO, todos de documentação.

**Placar:** HIGH 0 · MEDIUM 0 · LOW 0 · INFO 4 novos, mais 5 da rodada 1 classificados.

---

## 1. Estado dos achados da rodada 1

| ID | Sev. | Estado | Evidência conferida |
| --- | --- | --- | --- |
| M1 | MEDIUM | **Resolvido** | Ver os quatro pontos logo abaixo da tabela |
| L1 | LOW | **Resolvido** | `docs/production/AUTH_RBAC_WORKSPACES.md:204` é fiel às Rules: `get` para os quatro papéis ("sim" nas quatro colunas); nenhuma consulta, consulta de grupo ou escrita do cliente; escritores só o gatilho e a reconstrução de owner/admin; cita as duas suítes. `docs/production/THREAT_MODEL.md:20` (ativo A2) inclui `cash_projection_marks` e o risco de marca forjada |
| I1 | INFO | **Classificado; aceito, com ressalva** | Na rodada 1 escrevi que as impressões antigas "não expõem nada novo". A revisão de privacidade (M-PRI-01, `DESENHO-MARCAS-B03.md` §3) quantificou um acréscimo: confirmar por hipótese valores antigos de campos que não vão ao `activity_logs` (categoria, data, conta, fornecedor, editor), mesmo depois do prazo do log e de uma correção. Continua dentro do tenant e para quem já lê os lançamentos. A poda (abaixo) reduz o que fica guardado. O risco residual está no inventário (`PRIVACY_LGPD.md` §3, linha 26) e no passo da P8 (§6.4). A resposta diz "reavaliar com o PR-RULES-02 (registrado no plano)", mas nem o plano nem o rascunho da §20.18 citam o PR-RULES-02 junto das marcas (R2-I2) |
| I2 | INFO | Classificado; aceito | Custo da reconstrução: tema da revisão de escala. Sem efeito entre tenants |
| I3 | INFO | Classificado; aceito | O checkpoint em `cash_report_periods` é anterior à R3; `markSlot` não é sensível |
| I4 | INFO | **Resolvido** | `package.json:37`: `predeploy:rules` começa com `npm --prefix functions run build &&` antes do `emulators:exec`, e a paridade da impressão confere o código atual |
| I5 | INFO | **Pendente até o fechamento** (não bloqueia) | A resposta diz "Corrigido. A §20.18 existe no plano mestre", mas no WT o plano ainda termina na §20.17 (`PRODUCTION_READINESS_PLAN.md:4996`). O rascunho está em `$S/p5f1r3/evidencia/plano-20-18.md` e tem a condição de implantação e de restauração (linhas 61–63). `DESENHO-MARCAS-B03.md:150-151` cita a §20.18. Ao inserir a seção, corrigir também o estado de I5 na resposta. Até a reconstrução, a prova recusa: é fail-closed |

**Evidência de M1:**

- **Suíte no repositório.** `tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs` (testes em `:215,233,249,261,272,283,293,301,324,341,377`). Um `diff -u` contra o meu `ataques-marcas-r3.test.mjs` mostra só o cabeçalho e a resolução de módulos (`WT_DIR` virou `createRequire(new URL('../../…', import.meta.url))`). Os 11 testes, as asserções e as guardas de Emulator e de projeto local (`:12,14`) são idênticos: nada foi enfraquecido.
- **Scripts.** `package.json:70`: `test:rules:projection-marks` roda as duas suítes com `--test-concurrency=1`. Ele está em `test:integration:emulator` (`:52`, que o CI chama) e em `predeploy:rules` (`:37`).
- **Na árvore congelada.** `logs/verify-all-final.log:36006-36146`: 17/17 (1 a 11 dos ataques, 12 a 17 da oficial), `fail 0`, `skipped 0`. Em `:36152`: `Script exited successfully (code 0)`, que é o fim da integração e de todas as suítes de Rules.
- **Execução dirigida.** `logs/rules-marcas-oficial-3.log`: 17/17.

---

## 2. Mudanças desde a rodada 1: impacto em segurança

| Mudança | Análise | Resultado |
| --- | --- | --- |
| `firestore.rules` | Mesmo blob (`133b422e`) | Sem mudança |
| Poda da marca (`pruneMarkDoc`, `functions/src/cash/projectionMarks.ts:505`; uso em `functions/src/cash/periods.ts:1402-1406`) | Em cada regravação, o gatilho guarda só as componentes cujo `g` é a geração vigente (`state.categoryGeneration`) ou a preparada (`state.categoryStaging.generation`). As duas vêm do estado lido na mesma transação. `workspaceId` e `transactionId` continuam saindo do caminho do evento (`markDocumentData`), e a escrita continua no ref derivado do caminho. Nada vem do cliente. Uma âncora removida por engano daria visão sem âncora: o cliente então recusa (`content`), porque o lançamento é encontrado. Fail-closed. Integração 15 (`projectionMarks.integration.test.ts:603`): depois da publicação e da regravação seguinte, só sobra a posição vigente. Integração 16 (`:678`): âncora e gatilho concorrentes, as duas preservadas. Ambas `ok` no `verify:all` (`:17869`, `:17877`) | Sem efeito em isolamento ou autorização; reduz o que fica de impressões antigas (I1) |
| `firestore.indexes.json:1440-1469` | Seis `fieldOverrides` da coleção (`schemaVersion`, `workspaceId`, `transactionId`, `anchors`, `chains`, `updatedAt`) com `indexes: []`. JSON válido, sem duplicata, nenhum índice composto da coleção. Isentar índice não concede acesso; `list` e consulta de grupo seguem negados pelas Rules | Sem efeito em autorização |
| `observeDependentRead` (`src/modules/reports/basisRegistry.ts`) | Removida sem nenhuma referência restante em `src` e `tests` (busca vazia). Só leitura e estado em memória | Sem efeito |
| `src/modules/work-time/messages.ts`, `e2e/work-time-b03.spec.ts`, `tests/unit/work-time-consistency.test.ts` | Texto pt-BR e testes (M-01, M-02 e L-03 da revisão pt-BR). Nenhuma leitura ou escrita nova | Fora desta superfície |
| `PRIVACY_LGPD.md` §3, linha 26 do inventário (linha 70 do arquivo) | "`get` por todo membro ativo (owner/admin/member/viewer), a mesma condição de leitura dos lançamentos; `list`, consulta de grupo e escrita negadas" **é fiel às Rules**: `allow get: if canReadWorkspaceScopedData(workspaceId)`, que é o mesmo `isMember` de `transactions` (`firestore.rules:618-621,818-822`). A precisão sugerida está em R2-I4 | Fiel |
| `PRIVACY_LGPD.md` §6.4 (linhas 149–155) | Coerente com o código. A poda só acontece quando o gatilho regrava a marca. A reconstrução só grava a âncora, com merge e sem poda (`rebuild.ts:1266-1276`). Por isso "duas reconstruções não bastam" | Coerente |

---

## 3. Achados novos (rodada 2)

| ID | Sev. | Achado | Correção sugerida |
| --- | --- | --- | --- |
| R2-I1 | INFO | Dois documentos citam só a suíte oficial: `docs/production/evidence/p5f1-r3/testes-e-resultados.md:19` (tabela de testes novos, 6) e `docs/production/DATA_MODEL.md:140`. A suíte de ataques (11) só aparece na linha da execução às 19:13 (`:75`) e em `AUTH_RBAC_WORKSPACES.md:204` | Uma linha para `cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs` (11) na tabela §1 e o nome das duas suítes em `DATA_MODEL.md:140` |
| R2-I2 | INFO | A resposta a I1 diz que a reavaliação junto com o PR-RULES-02 está "registrada no plano". Não está: `PRODUCTION_READINESS_PLAN.md:392`, `PRIVACY_LGPD.md:331` e o rascunho da §20.18 (RR-R3-08) não ligam o PR-RULES-02 às impressões antigas das marcas | No RR-R3-08 da §20.18, ou no registro do PR-RULES-02: quando o histórico de edição ficar só com owner/admin, considerar também a confirmação por hipótese pelas marcas (`DESENHO-MARCAS-B03.md` §3) |
| R2-I3 | INFO | O rollback do rascunho da §20.18 (linha 92) manda apagar `cash_projection_marks` ao voltar à R2A: sem o bloco próprio, a catch-all daria a qualquer membro, viewer inclusive, listagem sem teto. A instrução está correta e é necessária. A exposição seria só dentro do tenant | Manter a instrução no texto final, ou, como alternativa, manter o bloco das marcas nas Rules num rollback parcial |
| R2-I4 | INFO | A linha 26 do inventário diz "membro ativo". Nas Rules, `isMember` exige membership `active` **e** conta `active` (`firestore.rules:32-46`): uma conta suspensa não lê, como provam a suíte oficial e o teste 3 de ataques | Opcional: escrever "membro ativo com conta ativa (`isMember`)" |

Nenhum achado novo de isolamento, IDOR, escalonamento, atribuição em massa, reentrega ou concorrência.

---

## 4. Matriz de evidências (checklist, árvore congelada)

| # | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1–5 | Identidade, `workspaceId`, membership, enumeração, acesso cruzado | PASS | Rules e caminho de leitura do cliente inalterados desde a rodada 1 (mesmos blobs). Testes 1, 3, 4, 5, 9 e 10 de ataques e 12 a 16 da oficial passam na árvore congelada (`verify-all-final.log:36006-36146`) |
| 6–8 | Matriz por papel, papel de dado confiável, escrita só no backend | PASS | Matriz fiel em `AUTH_RBAC_WORKSPACES.md:204`. Escritores continuam só em `periods.ts:1406` (agora com a poda) e `rebuild.ts:1268` |
| 9–10 | Membership e convites | N/A | Não tocados |
| 11 | Helpers entre servidores | PASS | `pruneMarkDoc` recebe as gerações do estado lido na transação, não do cliente |
| 12–13 | Campos imutáveis e atribuição em massa | PASS | O documento continua montado pelo backend com campos explícitos; a poda só remove componentes. O cliente não escreve (testes 2, 3 e 11 de ataques; 14 da oficial) |
| 14 | Validação | PASS | Inalterada |
| 15 | Atomicidade e TOCTOU | PASS | Poda dentro da transação do delta. Corrida âncora × gatilho coberta pela integração 16 (`ok`, `verify-all-final.log:17877`) |
| 16 | Idempotência e reentrega | PASS | Inalterada; integração das marcas toda `ok` no `verify:all` (nenhum `not ok` em todo o log até 20:19 UTC) |
| 17–19 | Camadas independentes | PASS | Rules: 17/17. Backend: integração `ok` |
| 20–21 | Auditoria e segredos | PASS | Sem mudança de auditoria; nenhum segredo no delta |
| 22–23 | Storage | N/A | Sem mudança |
| 24 | Dois tenants, nos dois sentidos, para toda operação alterada | **PASS** | Testes 1 e 2 de ataques (A→B e B→A, leitura e escrita), no repositório e em `test:rules:projection-marks` |
| 25 | Não autenticado, não membro, removido, papéis, caminho × conteúdo, papel forjado, campos imutáveis, escrita privilegiada | **PASS** | Testes 3 (não membros, claims forjadas e anônimo em leitura e escrita), 5 (caminho × conteúdo), 6 (subcaminhos), 7 (arquivado) e 11 (estado backend-only) de ataques |
| 26 | Concorrência e reentrega | PASS | Teste 9 de ataques (revogação na transação) e integração herdada |
| 27 | Suíte executada | PASS | `verify:all` na árvore congelada: 17/17 e `Script exited successfully (code 0)` (`:36152`) |

---

## 5. Caminhos de ataque

Os da rodada 1 (PARECER.md §3) estão agora na suíte do repositório e passaram na árvore congelada.

Nas mudanças da rodada 2, tentei:

- **Poda pelo cliente.** Fazer a poda apagar algo de outro tenant ou de outra geração viva: não há como. Os ids vêm do caminho, as gerações vêm do estado na transação, e o cliente não escreve.
- **Índices.** Usar as isenções de índice para consultar a coleção: não há como. Isenção não concede acesso, e as Rules negam `list` e a consulta de grupo.
- **Rollback.** Expor as marcas ao voltar para as Rules da R2A: só dentro do tenant, e o rascunho já manda apagar a coleção (R2-I3).

---

## 6. Verificação

Comandos só de leitura no WT:

- comparação de blobs (`git hash-object` × `git ls-tree` da árvore `377c2f3`);
- `git diff` entre as árvores `90c06358` e `377c2f3`;
- `diff -u` da suíte de ataques;
- validação do JSON de índices com `node`;
- buscas e leitura dos logs.

**Arquivos auxiliares:**

- `rodada2-arvore-codigo.txt`
- `rodada2-wt-codigo.txt`
- `rodada2-arvore-nomes.txt`

**Sem nova execução no Emulator.** As Rules e a lógica dos 11 testes são as mesmas da minha execução da rodada 1: 6/6 + 11/11, com Rules de sha256 `3f6f8eb8…`. O `verify:all` já rodou as duas suítes na árvore congelada (17/17). Não subi um Emulator em portas próprias para não disputar CPU com os E2E em curso, que são sensíveis a latência (RR-R3-03).

**Logs inspecionados diretamente:**

- `p5f1r3/logs/verify-all-final.log`, iniciado às 19:42:32Z com `arvore=377c2f3…`:
  - unidade work-time: 213/213;
  - integração das marcas, inclusive a poda (`ok 368`) e a corrida (`ok 369`);
  - suítes de Rules das marcas: 17/17;
  - `test:integration:emulator` terminou com `exit 0`;
  - nenhum `not ok` até 20:19 UTC.
- `p5f1r3/logs/rules-marcas-oficial-3.log`: 17/17.

**O que ainda depende do `verify:all` em curso:** nada deste veredito. As duas suítes de Rules das marcas e a integração já terminaram com sucesso dentro dele. Só os E2E seguem, e a saída final (`fim=` e `exit=` no `.meta`) é do gate de regressão, não desta revisão.

Nada foi feito em Firebase real nem no projeto de produção. Nenhum `.env*` foi lido. Sem commit nem push.
