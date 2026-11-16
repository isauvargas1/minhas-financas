PASS — Multi-tenant security review

**Etapa:** P5-F.1-R3 (B03), rodada 3: confirmação documental pedida pelo gate de regressão (L-01). Ela cobre as duas linhas editadas 39 s depois do meu parecer da rodada 2.
**Revisor:** independente, só leitura.
- Nada foi alterado no WT, no repositório, no plano nem nos diretórios dos outros revisores.
- Nenhum Emulator foi iniciado e nenhum `.env*` foi lido.

**Data:** 2026-11-09, das 22:20 às 22:40 UTC.

**Veredito.**
- **O PASS da rodada 2 cobre o estado final.** O código não mudou desde ela: a parte de código do WT é a árvore `377c2f3f`, e `firestore.rules` continua com o blob `133b422e`.
- **As duas linhas editadas às 20:20:48 aplicam as minhas sugestões e são fiéis ao código:**
  - `DATA_MODEL.md:140` aplica o R2-I1;
  - a linha 26 do inventário de `PRIVACY_LGPD.md` (linha 70 do arquivo) aplica o R2-I4.
- **R2-I2, R2-I3 e o I5 da rodada 1 também estão resolvidos** no texto final.
- **O RR-R3-12 descreve corretamente o mecanismo, a idade e a evidência.** Só deixa de fora um terceiro teste com o mesmo ponto cego (R3-I1).
- **Nenhuma das mudanças previstas exige nova conferência**, nas condições do §8.

**Placar:** HIGH 0 · MEDIUM 0 · LOW 0 · INFO 2. Os dois INFO são novos, de documentação, e não bloqueiam.

---

## 1. Escopo, estado final e fronteiras de confiança

| Item | Valor | Como conferi |
| --- | --- | --- |
| WT | `wt-p5f1-r3`, `HEAD` `1730a1df0d3870ff52496933f45cb73a8dacd29b`, R3 sem commit | `git rev-parse HEAD` |
| Árvore de documentos final, o estado atual do WT | `ad1660a336f043c7331e158e9a85efdae17e277b` | Índice temporário próprio (`<scratchpad>/seg-r3-tmp/idx` e `idx2`, nunca o índice real nem o `final.index`): `read-tree HEAD`, `add -A` e `write-tree`. Deu `ad1660a3` às 22:22:25 e às 22:34:52 UTC |
| Árvore de código final | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, a do `verify:all` do executor (`exit=0`) e da reexecução do gate | `git diff --stat 377c2f3f ad1660a3 -- . ':(exclude)docs'` sai vazio |
| `firestore.rules` | blob `133b422e`, sha256 `3f6f8eb8…dd39e`, o mesmo das rodadas 1 e 2 | `git ls-tree` nas duas árvores e `git hash-object` no WT |
| `firestore.indexes.json`, `package.json`, `firebase.json` | `f4322d86`, `b207ac92` e `04e17615`, iguais nas duas árvores | idem |
| Hashes da superfície | `hashes-rodada-3.txt`, neste diretório: 24 arquivos com blob e sha256 | Tudo fora de `docs/` é igual a `377c2f3f`. Desde a rodada 1 mudaram só `package.json`, `projectionMarks.ts` e `periods.ts`, que revisei na rodada 2 |

**Documentos da superfície no estado final.**
- **`DATA_MODEL.md`** (blob `59e2056d`): desde `377c2f3f`, só a linha 140 mudou. O blob é o mesmo em `3eb6041d` e em `ad1660a3` (mtime 20:20:48).
- **`PRIVACY_LGPD.md`** (blob `de16a890`):
  - a linha 26 do inventário entrou depois de `377c2f3f` e tem o mesmo texto em `3eb6041d` e em `ad1660a3`;
  - depois de `3eb6041d`, a única mudança é a "Ordem obrigatória" da §6.4 (`:153`), que não trata de acesso.
- **`AUTH_RBAC_WORKSPACES.md:204` e `THREAT_MODEL.md:20`:** sem mudança desde `377c2f3f` (diff vazio). Valem as conferências da rodada 2.
- **§20.18 do plano** (`PRODUCTION_READINESS_PLAN.md:5086-5235`): conferi as afirmações de segurança, nas linhas 5128, 5131, 5146-5149, 5171, 5204, 5221-5224 e 5233.

**Fronteiras de confiança.** São as mesmas da rodada 1 (`PARECER.md` §1). Nenhuma foi alterada desde a rodada 2:
- **Cliente web, transação só de leitura:** `get` de até 13 meses e 100 marcas, com o workspace validado (`src/modules/work-time/projectionReads.ts:18-49`, blob igual ao da rodada 1). Camada: Rules.
- **Gatilho `onTransactionWrite` (Admin SDK):** sem usuário; workspace e lançamento vêm do caminho do evento. Ele lê a marca de entrega, o estado e a marca num `getAll` (`functions/src/cash/periods.ts:1302-1321`) e grava a marca podada na mesma transação (`:1401-1406`).
- **Callable `rebuildCashPeriods`:** owner e admin, com o ator relido na transação (`functions/src/cash/rebuild.ts:1677-1712`, blob igual ao da rodada 1). Âncoras por merge no commit da página (`:1262-1277`).
- **Estado backend-only:** `cash_period_events/projection_state` (`firestore.rules:804-806`).

---

## 2. Conferência linha a linha, contra a árvore `377c2f3f`

### 2.1 `docs/production/DATA_MODEL.md:140` (linha de `cash_projection_marks`)

| Afirmação | Código | Resultado |
| --- | --- | --- |
| "`get` por membro ativo (inclusive viewer)" | `firestore.rules:818-819` (`allow get: if canReadWorkspaceScopedData(workspaceId)`), `:66-68` (`canReadWorkspaceScopedData` = `isMember`), `:42-46` e `:32-36` (membership `active` e conta `active`). A legenda do documento já define "membro ativo" como `isMember`, com conta ativa (`DATA_MODEL.md:10`), então esta linha não precisa do acréscimo do R2-I4 | Fiel |
| "`list, create, update, delete: if false` (o cliente só lê por id)" | `firestore.rules:820-821`. A regra genérica `:1168-1173` não alcança a coleção: a leitura é barrada por `isBackendOwnedCollection` e a escrita é `false` | Fiel |
| "na lista `isBackendOwnedCollection`" | `firestore.rules:401-403,459` | Fiel |
| "sem consulta de grupo" | Nenhuma regra recursiva alcança a coleção. O único curinga `{document=**}` é o de `billing_accounts/{uid}`, com `read, write: if false` (`:1370-1372`) | Fiel |
| "suítes `…p5f1r3.rules…` e `…p5f1r3-ataques.rules…`" (R2-I1) | Ver as linhas abaixo da tabela | Fiel; **R2-I1 aplicado** |
| "Nenhum composto, e todos os campos isentos de índice de campo único (`firestore.indexes.json`): nada consulta a coleção" | Ver as linhas abaixo da tabela | Fiel. Isentar índice não concede acesso: `list` e consulta de grupo seguem negados pelas Rules |
| "o gatilho, ao regravar, guarda só as gerações vigente e preparada" | `periods.ts:1401-1406`, com as gerações do estado lido na mesma transação; `pruneMarkDoc` em `projectionMarks.ts:505-518` | Fiel |
| "Impressões são dado pseudonimizado (`PRIVACY_LGPD.md` §3, linha 26)" | A linha 26 do §3 é a das marcas: `PRIVACY_LGPD.md:70`, com o §3 começando em `:39` | Referência correta |

**As duas suítes (R2-I1).**
- Existem as duas na árvore: a oficial (blob `db81d9df`, 6 testes) e a de ataques (blob `ceafcb72`, 11 testes).
- Não há `skip`, `only` nem `todo`.
- As duas têm guarda de Emulator e de projeto local (ataques `:12-14`; oficial `:43-46`).
- O script `test:rules:projection-marks` (`package.json:70`) roda as duas com `--test-concurrency=1`. Ele está em `test:integration:emulator` (`:52`), que o CI chama (`.github/workflows/quality-gate.yml:152`), e em `predeploy:rules` (`:37`), que começa com a compilação das Functions.
- O Emulator carrega `firestore.rules` pelo `firebase.json`.

**Índices.**
- `firestore.indexes.json:1440-1469` tem 6 `fieldOverrides` com `indexes: []`: `schemaVersion`, `workspaceId`, `transactionId`, `anchors`, `chains` e `updatedAt`. Pela validação com `node`, não há índice composto nem duplicata.
- São exatamente os 6 campos de topo que os escritores gravam (`functions/src/cash/projectionMarks.ts:488-493` e `:530-534`).

**Nenhum código fora de testes consulta a coleção.**
- O cliente lê por id dentro da transação (`src/modules/work-time/projectionReads.ts:32`).
- O backend usa só referências por id (`periods.ts:1312-1314,1405-1406`; `rebuild.ts:1266-1275`).
- Não há `collectionGroup`, `listDocuments` nem `recursiveDelete` sobre ela. O único `collectionGroup` com variável é `findIntentAnchor`, e os dois chamadores passam constantes de eventos (`functions/src/receivables/clientOperations.ts:245-246`; `functions/src/receivables/operations.ts:347-348`).

### 2.2 `docs/production/PRIVACY_LGPD.md:70` (linha 26 do inventário)

| Afirmação | Código | Resultado |
| --- | --- | --- |
| "`get` por todo membro ativo com conta ativa (owner/admin/member/viewer)" (R2-I4) | `firestore.rules:32-46,66-68,819`. Conta suspensa é negada nos testes 3 de ataques e 12 da oficial, `ok` nos dois `verify:all` | Fiel; **R2-I4 aplicado**. A sugestão punha `isMember` entre parênteses; o texto põe a lista de papéis, com o mesmo sentido |
| "a mesma condição de leitura dos lançamentos" | `transactions`: `allow read: if isMember(workspaceId)` (`firestore.rules:618-619`). Marcas: `canReadWorkspaceScopedData`, que é `isMember` | Fiel: o predicado é o mesmo. A diferença é o `list`, que a frase seguinte nega |
| "`list`, consulta de grupo e escrita negadas (Rules testadas no Emulator)" | `:820-821` e `:1173`, sem regra de grupo. As duas suítes deram 17/17 nos dois `verify:all` | Fiel |
| "Backend: gatilho de caixa … e varredura da reconstrução …; nunca o cliente" | Escritores só em `periods.ts:1405-1406` e `rebuild.ts:1267-1275` (busca fora de testes). As Rules negam toda escrita do cliente | Fiel |
| "SHA-256 sem sal da serialização canônica do documento inteiro" | `transactionFingerprint` (`projectionMarks.ts:141-146`): `sha256` de `JSON.stringify(canonicalFirestoreValue(data))`, sem sal | Fiel |
| "metadados (ids do workspace e do lançamento, geração e corte, versão do esquema, `updatedAt`)" | `markDocumentData` e `markAnchorPatch` (`projectionMarks.ts:483-494,524-535`) | Fiel |
| Retenção: a poda; a posição superada até a próxima regravação; num lançamento apagado, até a eliminação do workspace | `periods.ts:1401-1406`. A reconstrução grava só a âncora, com merge e sem poda (`rebuild.ts:1266-1275`) | Fiel |
| "Risco aceito: um membro ativo com uma hipótese pode confirmar o conteúdo de uma versão anterior" | Coerente com o I1 da rodada 1 e com o R2-I2. Sem "com conta ativa", o grupo descrito é maior que o real, o que é conservador | Fiel |

### 2.3 Minhas outras sugestões e demais afirmações de segurança do estado final

| ID | Onde está no texto final | Estado |
| --- | --- | --- |
| R2-I1 | `DATA_MODEL.md:140` e `evidence/p5f1-r3/testes-e-resultados.md:19`, a linha da suíte de ataques (11) | **Resolvido** |
| R2-I2 | RR-R3-08 (`PRODUCTION_READINESS_PLAN.md:5204`): as impressões de versões antigas entram na reavaliação do PR-RULES-02 (P6), junto com `activity_logs` | **Resolvido** |
| R2-I3 | Rollback (`:5233`): as marcas são apagadas antes de publicar as Rules da R2A, porque a regra genérica as deixaria legíveis | **Resolvido**. O caso simétrico na implantação está no R3-I2 |
| R2-I4 | `PRIVACY_LGPD.md:70` | **Resolvido** |
| I5, rodada 1 | A §20.18 existe (`:5086`), com as condições de implantação e de restauração (`:5146-5149`). A resposta "Corrigido" (`revisoes/respostas-revisao-ptbr-seguranca-1.md:28`) passou a ser verdadeira | **Resolvido** |
| I1, rodada 1, com ressalva | A resposta da rodada 1 (`respostas-revisao-ptbr-seguranca-1.md:24`) ainda diz "não expõem nada além do que `activity_logs` já mostra". É registro histórico. Os registros que valem descrevem o acréscimo: `PRIVACY_LGPD.md:70`, o §3 do desenho e o plano (`:5135`, `:5204`) | Aceito, sem ação |

**Outras afirmações conferidas, todas fiéis às Rules e aos índices:**
- plano `:5128` e `:5131`;
- desenho §3: "pelo mesmo predicado de membro ativo";
- `matriz-requisitos.md:60,84`: 17/17, com a matriz (6) e os ataques (11);
- `FIREBASE_PRODUCTION.md:201`: 6 isenções, e os subcampos dos mapas herdam.

---

## 3. RR-R3-12 (L-02 do gate)

O texto está em `PRODUCTION_READINESS_PLAN.md:5221-5224`.

| Afirmação | Evidência | Resultado |
| --- | --- | --- |
| A guarda lista os arquivos com `git ls-files` sem `--others` | `tests/unit/ai-backend-only.test.ts:26-29`: `execFileSync('git', ['ls-files', ...patterns])` | Correto |
| É anterior à R3 | O blob `762fdbd3` é o mesmo no `HEAD` `1730a1df`, na R2A `f8267922` e em `377c2f3f`. O último commit que tocou o arquivo é `36cdb33`, de 2026-08-25 | Correto. É anterior também à P5-F |
| Num worktree sem commit, os arquivos não versionados ficam fora da guarda | Contei com índices temporários. Índice do `HEAD`: 228 arquivos `src` e 631 na varredura de segredos. Índice completo de `377c2f3f`: 262 e 762. São 34 e 131 a menos, como no gate | Correto. Precisão: o critério é estar fora do índice, não estar sem commit |
| No CI, com tudo versionado, a guarda vê todos | O teste está em `test:unit:investments` (`package.json:14`), que o CI chama (`.github/workflows/quality-gate.yml:72`) | Correto. Mas o CI só detecta depois do push (R3-I1) |
| O gate reexecutou com o índice completo (262 e 762) e passou | `revisoes/gate/logs/verify-all-gate.log.meta`: `arvore_indice=377c2f3f` antes e depois. Em `verify-all-gate.log:4507-4531`, os 5 testes do arquivo dão `ok` | Correto |
| A busca estática deu 0 import de SDK de IA e 0 chave | Minha busca nas árvores, que incluem os arquivos fora do índice do `HEAD`, deu 0 em três frentes: <br>• `@google/genai` e `@google/generative-ai` em `src` de `377c2f3f`; <br>• leitura de chave de IA do ambiente, no mesmo `src`; <br>• o padrão `AIza…` em toda a árvore `ad1660a3` | Correto |
| A correção é `--cached --others --exclude-standard`, como em `investment-simple-guards.test.ts` | `tests/unit/investment-simple-guards.test.ts:175-178` | Correto |

**Conclusão.** O RR-R3-12 descreve o risco corretamente. A omissão do terceiro teste está no R3-I1.

---

## 4. Matriz de evidências (checklist, estado final)

O código é o mesmo da rodada 2. A evidência de teste vem de duas execuções independentes na árvore `377c2f3f`:
- **executor:** `p5f1r3/logs/verify-all-final.log`;
- **gate:** `revisoes/gate/logs/verify-all-gate.log`, numa cópia com índice completo.

Nas duas, as suítes das marcas ficam nas linhas 35999 a 36152.

| # | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Identidade só do token verificado | PASS | As Rules usam `request.auth.uid` e o membership (`firestore.rules:5-7,28-46`), com 0 `request.auth.token`. No teste 3 de ataques, claims forjadas sem membership são negadas |
| 2 | `workspaceId` validado e coerente | PASS | O caminho decide (`:818-819`). O backend usa os ids do caminho do evento (`periods.ts:1302-1312`). No teste 5 de ataques, o conteúdo × caminho é negado ao owner de B |
| 3 | Membership ativo; removido, suspenso e token antigo | PASS | `:32-46,66-68`. Teste 12 da oficial; testes 3 e 9 de ataques (revogação no meio da transação) |
| 4 | Sem enumeração | PASS | `:820`, e nenhuma regra de grupo alcança a coleção (`:1370` é só de billing). Testes 4 e 10 de ataques (grupo; `verify` como oráculo); 13 e 15 da oficial |
| 5 | Sem leitura nem escrita cruzada, sem IDOR | PASS | Testes 1, 2 e 8 de ataques, `ok` nas duas execuções (`:36006`, `:36012`, `:36049`) |
| 6 | Matriz por papel e negação por padrão | PASS | `AUTH_RBAC_WORKSPACES.md:204` (inalterado), `DATA_MODEL.md:140` e `PRIVACY_LGPD.md:70` coerentes. Regra genérica `:1168-1173`; lista `:459` |
| 7 | Papel derivado de dado confiável | PASS | Só do membership. A reconstrução relê o ator na transação (`rebuild.ts:1703`, mesmo blob da rodada 1) |
| 8 | Escritas sensíveis só no backend | PASS | Escritores só em `periods.ts:1405-1406` e `rebuild.ts:1267-1275`. Rules em `:821` e `:1173` |
| 9–10 | Membership e convites | N/A | O diff R2A → `377c2f3f` de `functions/src/workspaces`, `src/modules/workspaces` e `storage.rules` sai vazio |
| 11 | Helpers entre servidores | PASS | `applyCashPeriodWriteOnce` recebe os ids do caminho. `pruneMarkDoc` recebe as gerações do estado lido na transação (`periods.ts:1401-1406`) |
| 12–13 | Campos imutáveis e atribuição em massa | PASS | O backend monta campos explícitos (`projectionMarks.ts:483-494,524-535`). O cliente não escreve: testes 2, 3 e 11 de ataques; 14 da oficial |
| 14 | Validação na fronteira confiável | PASS | Inalterada desde a rodada 2 (mesmos blobs) |
| 15 | Atomicidade e TOCTOU | PASS | A poda acontece dentro da transação do delta. A corrida âncora × gatilho passa nas duas execuções (`ok 369`, `:17877`) |
| 16 | Idempotência e reentrega | PASS | A marca de entrega é conferida antes de qualquer escrita (`periods.ts:1313-1321`). "Reentrega e entregas simultâneas: um delta, uma mudança de marca" passa nas duas execuções (`ok 356`, `:17707`) |
| 17–19 | Camadas independentes | PASS | Rules: 17/17 nas duas execuções. Backend: integração das marcas `ok`, inclusive a poda (`ok 368`, `:17869`). Nenhum `not ok` nos dois logs |
| 20 | Auditoria | PASS | Nenhuma ação de usuário nova desde a rodada 1 |
| 21 | Segredos | PASS | Nenhum padrão de segredo nas 5.685 linhas adicionadas a `docs/` desde `377c2f3f`. Nenhum `AIza…` na árvore final. Nenhum SDK de IA nem leitura de chave em `src`. O projeto de produção aparece em 2 das linhas adicionadas, as duas como texto do parecer de plataforma (`revisoes/obs-plataforma/PARECER-PLATAFORMA.md`). Ressalva de processo no R3-I1 |
| 22–23 | Storage e URLs assinadas | N/A | Sem mudança |
| 24 | Dois tenants, nos dois sentidos, para toda operação alterada | **PASS** | Testes 1 e 2 de ataques, no repositório e no script oficial, `ok` nas duas execuções |
| 25 | Não autenticado, não membro, removido, papéis, caminho × conteúdo, papel forjado, campos imutáveis e escrita privilegiada | **PASS** | Testes 3, 5, 6, 7 e 11 de ataques; 12 a 16 da oficial |
| 26 | Concorrência e reentrega, com estado final | PASS | Teste 9 de ataques; integrações 356 e 369 |
| 27 | Suíte executada | PASS | 17/17, `fail 0`, `skipped 0` e `Script exited successfully (code 0)` (`:36152`) nas duas execuções |

---

## 5. Caminhos de ataque

Esta rodada não tem código novo. Revisitei os caminhos que as edições de documentos tocam:

- **Usar as isenções de índice para consultar a coleção:** não há como. Isenção não concede acesso, e as Rules negam `list` e a consulta de grupo (testes 13 e 15 da oficial, 4 de ataques).
- **Functions da R3 sob Rules anteriores, na implantação:** só dentro do tenant (R3-I2). As escritas seguem negadas, e o predicado é `isMember` do workspace do caminho.
- **Rollback para a R2A com as marcas ainda gravadas:** a instrução de apagá-las antes das Rules da R2A continua no texto (R2-I3).
- **Segredo ou SDK de IA num arquivo novo fora do índice:** a minha busca nas árvores deu 0. O gate reexecutou a guarda com índice completo (RR-R3-12).
- **Enumeração e oráculo de existência:** sem mudança desde a rodada 1 (testes 4 e 10 de ataques).

Não encontrei nenhum caminho de isolamento, IDOR, escalonamento, atribuição em massa, reentrega ou concorrência.

---

## 6. Achados (rodada 3)

**Bloqueantes:** nenhum. HIGH 0, MEDIUM 0, LOW 0. Nenhum achado de isolamento entre tenants.

**R3-I1 — INFO, documentação. O RR-R3-12 conta dois testes cegos, mas são três.**
- **Onde:** `sourceFiles` (`tests/unit/ai-backend-only.test.ts:31`) alimenta dois testes:
  - "nenhum arquivo do cliente importa SDK de IA" (`:33-44`);
  - "nenhum arquivo do cliente lê chave de IA do ambiente" (`:46-53`).
  Com a varredura de segredos (`:76-90`), são três testes que não veem arquivos fora do índice. O RR-R3-12 e o L-02 citam dois.
- **Evidência:** cobre os três. O gate rodou o arquivo inteiro com índice completo (5/5 `ok`, `verify-all-gate.log:4507-4531`), e a minha busca deu 0 leitura de chave de IA em `src`.
- **Precisão:** o critério é "fora do índice", não "sem commit". E o CI só detecta depois do push, quando o segredo já está no remoto.
- **Sugestão (opcional):** no RR-R3-12, escrever "três testes (`:33`, `:46` e `:76`)" e acrescentar "até a correção, o gate de cada etapa feita sem commit reexecuta o arquivo com índice completo, como nesta".

**R3-I2 — INFO, documentação, só dentro do tenant. A condição de implantação não cita as Rules.**
- **Onde:** `PRODUCTION_READINESS_PLAN.md:5147` e `FIREBASE_PRODUCTION.md:201` pedem só "índices antes das Functions, ou junto".
- **Cenário:** com as Functions da R3 publicadas antes das Rules da R3, valem as Rules anteriores. Nas da R2A (`f8267922`, `firestore.rules:1148-1153`), a coleção não tem bloco próprio nem está na lista, então cai na regra genérica de subcoleção. Qualquer membro ativo do próprio workspace, viewer inclusive, teria `get` e `list` sem teto das marcas.
- **Limite:** a escrita continua negada, e não há caminho entre tenants, porque o predicado é `isMember` do workspace do caminho.
- **Por que é só de redação:** os scripts do projeto publicam Rules e índices juntos (`deploy:firestore` e `deploy:safe`, `package.json:38,40`). Quem segue a condição atual por eles já publica as Rules antes das Functions, ou junto. É o espelho, na implantação, do R2-I3 do rollback.
- **Sugestão (opcional):** escrever "publicar as Rules e os índices da R3 antes das Functions, ou junto". Pode ficar para a P6, junto com o CD (`FIREBASE_PRODUCTION.md:202`).

---

## 7. Verificação

**Comandos, todos só de leitura:**
- **Árvores:**
  - `git rev-parse HEAD`;
  - índice temporário próprio (`read-tree HEAD`, `add -A`, `write-tree`), que deu `ad1660a3` duas vezes;
  - `git diff --stat 377c2f3f ad1660a3 -- . ':(exclude)docs'`, vazio;
  - `git ls-tree` e `git hash-object` das Rules, dos índices e dos scripts.
- **Histórico das duas linhas:** `git diff` de `DATA_MODEL.md` e `PRIVACY_LGPD.md` entre `377c2f3f`, `3eb6041d` e `ad1660a3`.
- **Código lido da árvore, com `git show 377c2f3f:<arquivo>`:**
  - Rules e índices;
  - `projectionMarks.ts`, `periods.ts` e `rebuild.ts`;
  - as duas suítes;
  - `package.json`, `firebase.json` e o CI;
  - a guarda de IA.
  Para comparar o rollback, li também `f8267922:firestore.rules`.
- **Validação do JSON dos índices** com `node`.
- **Buscas com `git grep` nas árvores:**
  - escritores e consultas da coleção;
  - `collectionGroup`;
  - SDK de IA e leitura de chave;
  - `AIza…`;
  - padrões de segredo nas linhas adicionadas de `docs/`.
- **Arquivos vistos pela guarda,** com índices temporários de `HEAD`, `377c2f3f` e `ad1660a3`: 228/631, 262/762 e 262/763.
- **Logs:**
  - `p5f1r3/logs/verify-all-final.log`, com o `.meta` em `arvore=377c2f3f` e `exit=0`;
  - `revisoes/gate/logs/verify-all-gate.log`, com o `.meta` em `arvore_indice=377c2f3f` antes e depois. O `exit=1` vem só do E-01, no E2E.

**Tenants e operações negadas,** pelas duas suítes nas duas execuções:
- **Sujeitos:** os tenants A e B, com os quatro papéis cada; um membro dos dois; removido, conta suspensa, sem perfil, sem `status`, sem membership, claims forjadas e anônimo.
- **Leitura negada:** `get`, consulta, listagem, contagem e transação cruzadas, nos dois sentidos; consulta de grupo; `verify` como oráculo; `projection_state`.
- **Escrita negada:** create, overwrite, merge, update, delete, lote e transação cruzados, nos dois sentidos; subcaminhos e nomes vizinhos; escrita em workspace arquivado; `projectionGeneration` forjado.
- **Resultado:** 17/17 nas duas execuções.

**Por que não subi um Emulator.** Não era indispensável:
- as Rules, as suítes e o código são os mesmos blobs das duas execuções independentes, a do executor e a do gate;
- são também os da minha execução da rodada 1 (11/11 + 6/6, com as Rules de sha256 `3f6f8eb8…`).

Nada foi feito em Firebase real nem no projeto de produção. Sem commit, push nem deploy.

---

## 8. Mudanças previstas e condição de reconferência

| Mudança prevista | Exige reconferência? | Condição |
| --- | --- | --- |
| Cópia dos pareceres da rodada 3 em `docs/production/evidence/p5f1-r3/revisoes/seguranca/` | Não | A cópia deve ter o mesmo sha256 deste arquivo, registrado em `hashes-rodada-3.txt`. O `copiar-pareceres.sh` só troca caminhos temporários, e este parecer não tem nenhum. O script também copia o `hashes-rodada-3.txt`, e vale o mesmo para ele |
| Marcadores de estado: `[[R3-SEG]]` em `revisoes/LEIAME.md` e `[[REVISOES-ESTADO]]` em `matriz-requisitos.md` | Não | Devem dizer PASS, com 0 HIGH, 0 MEDIUM, 0 LOW e 2 INFO (R3-I1 e R3-I2) |
| Linhas de revisão e do gate da §20.18 | Não | Só estado. A linha de `multi-tenant-security-review` (`:5171`) ganha a rodada 3 |
| Depois do gate: marcadores de veredito, linha da P5 e histórico do plano | Não | Só estado |

**Reconferência obrigatória** se, depois deste parecer, mudar qualquer um destes:

1. **Qualquer arquivo fora de `docs/`.** A parte de código do WT tem de continuar igual a `377c2f3f`. Isso vale em especial para:
   - `firestore.rules` (`133b422e`);
   - `firestore.indexes.json` (`f4322d86`);
   - `package.json` (`b207ac92`);
   - `firebase.json` (`04e17615`);
   - as duas suítes de Rules das marcas;
   - o caminho de leitura do cliente e os escritores do backend.

   Os blobs estão em `hashes-rodada-3.txt`.
2. **Um destes documentos:** `DATA_MODEL.md` (`59e2056d`), `PRIVACY_LGPD.md` (`de16a890`), `AUTH_RBAC_WORKSPACES.md` (`7c12f7cf`) ou `THREAT_MODEL.md` (`39cca036`).
3. **O conteúdo de segurança da §20.18 do plano.** Os números de linha vão mudar, então a referência é pelo conteúdo:
   - a linha das Rules das marcas e a dos índices;
   - as "Condições de implantação e de restauração";
   - o RR-R3-08 e o RR-R3-12;
   - o "Rollback".

   A exceção é aplicar o R3-I1 ou o R3-I2 com o sentido do §6. O gate pode conferir isso contra este texto, sem nova rodada.
