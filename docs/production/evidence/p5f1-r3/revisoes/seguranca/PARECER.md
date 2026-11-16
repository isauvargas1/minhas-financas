FAIL — Multi-tenant security review

**Etapa:** P5-F.1-R3 (B03): marcas de aplicação da projeção.
**Revisor:** independente, só leitura. Nada foi alterado no WT nem no repositório.
**Data:** 2026-11-09.

**Código revisado.** Worktree `wt-p5f1-r3`, delta sobre a árvore R2A `f82679226ec93e18f906731be09d0675326fd764`.

- Árvore da R3 no início da revisão: `905ed3d67ecb9cdff2dfd01e81271e241809e29b`.
- Árvore no fim da revisão: `90c06358acc7175be310f2c3c515066e0f97744d`.
- Entre as duas mudaram só evidências, `BACKUP_RESTORE_DR.md`, um teste de integração de backend e asserções de um teste de unidade.
- A superfície de segurança tem o mesmo blob nas duas árvores (`git rev-parse` por arquivo): `firestore.rules`, `projectionReads.ts`, `transactions/api.ts`, `projectionMarks.ts`, `periods.ts`, `rebuild.ts`, a suíte de Rules das marcas e `package.json`.
- Hashes dos arquivos revisados: `hashes-superficie.txt`. A sha256 de `firestore.rules` é `3f6f8eb8…dd39e`.

**Veredito em uma linha.** Nenhum caminho explorável foi encontrado: não há acesso cruzado, IDOR, escalonamento de privilégio, escrita do cliente nem oráculo de existência. Rules e backend estão corretos.

- Suíte oficial: 6/6 no Emulator.
- Ataques independentes do revisor: 11/11 no Emulator.

O gate dá **FAIL** por um item obrigatório da skill: a suíte de Rules entregue não tem a cobertura negativa de dois tenants nos dois sentidos, nem tentativas de escrita cruzada ou de não membro (M1). Pela política da skill, essa falta sempre bloqueia, mesmo sem exploração possível hoje. A correção é pequena: incorporar à suíte oficial os cenários que o revisor já executou com sucesso.

**Achados:** HIGH 0 · MEDIUM 1 · LOW 1 · INFO 5.

---

## 1. Escopo e fronteiras de confiança

| Entrada | Identidade | Recurso | Camadas | Evidência |
| --- | --- | --- | --- | --- |
| Cliente web: transação só de leitura do SDK | Usuário autenticado; o workspace-fonte vem da preferência privada (`incomeWorkspaceId`, Rules `[A-Za-z0-9_-]{1,128}`) | `workspaces/{ws}/cash_report_periods/{mês}` (até 13) e `workspaces/{ws}/cash_projection_marks/{id}` (até 100) | Rules (get por documento; membership e conta ativos) | `src/modules/work-time/projectionReads.ts:18-49` (workspace validado em :23, tetos em :26-28, caminhos em :31-32); chamada em `src/modules/work-time/useIncomeEstimateWith.ts:221-234`; Rules da preferência em `firestore.rules:1214-1216,1275,1279` |
| Cliente web: lançamentos por id | Idem | `workspaces/{ws}/transactions` (`in`, lotes de 30), agora com o documento bruto (`raw`) | Rules `transactions` (`allow read: if isMember`) | `src/modules/transactions/api.ts:160-181` (`raw` em :177, retorno em :181); `firestore.rules:618-621`; impressão digital em `src/modules/work-time/receivableReversal.ts:96-134` |
| Gatilho `onTransactionWrite` (Admin SDK) | Sistema, sem usuário. Workspace e lançamento vêm só do caminho do evento | Marca gravada na mesma transação do delta, depois da conferência da marca de entrega (idempotência) | Backend | `functions/src/triggers/transactions.ts:363-405` (`event.params` em :370); `functions/src/cash/periods.ts:1301-1424` (ref em :1311, duplicada em :1314-1320, `set` em :1400-1401); `functions/src/cash/projectionMarks.ts:469-476,483-497` |
| Callable `rebuildCashPeriods` | Owner/admin. Kernel com `workspaceRoles`, ator relido na transação, limite de 100 chamadas por hora | Âncoras `anchors.{a,b}` no commit de cada página; publicação com `projectionGeneration` e `markSlot` | Backend | `functions/src/cash/rebuild.ts:1677-1712` (papéis em :1697, releitura em :1703); âncoras em :1262-1277; publicação em :1588 e :1632 |
| Estado backend-only | — | `cash_period_events/projection_state`: `markSlot`, `markRecoveryNeeded`, `markIssue*`, `lastMarkIssue*` | Rules `read, write: if false` | `firestore.rules:804-806`; `functions/src/cash/periods.ts:1193-1212` |

Duas fronteiras não concedem nada:

- **Prova da estimativa no cliente.** Decide só se a conversão em tempo aparece na tela do próprio usuário. Não autoriza nada, não é persistida e nenhum backend a consome (guardas em `tests/unit/work-time-guard.test.ts:295-343`).
- **Claims do token.** As Rules não leem `request.auth.token` em lugar nenhum (busca em `firestore.rules`): papel e tenant vêm só do membership.

### Matriz de papéis da superfície nova

| Operação | owner | admin | member | viewer | removido, suspenso, sem perfil, sem `status`, sem membership, claims forjadas | anônimo | Evidência |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `get` de marca por id (no próprio workspace, inclusive arquivado) | sim | sim | sim | sim | não | não | `firestore.rules:818-819`; oficial t1; revisor t1, t3, t7 |
| Consulta, listagem, `in` por id ou contagem na coleção (com ou sem `limit`) | não | não | não | não | não | não | `firestore.rules:820`, lista `:459`, catch-all `:1168-1173`; oficial t2; revisor t1, t3 |
| Consulta de grupo `cash_projection_marks` (com ou sem filtro, contagem) | não | não | não | não | não | não | Não existe regra `{path=**}` no escopo do workspace; oficial t4; revisor t4 |
| create, set, merge, update, delete, lote ou escrita dentro de transação | não | não | não | não | não | não | `firestore.rules:821` e `:1173`; oficial t3, t5; revisor t2, t3, t6, t7 |
| `verify` no commit (é o que fecha a transação só de leitura) | sim | sim | sim | sim | não (403, igual para documento existente e inexistente) | não | revisor t10 |
| `projection_state` (leitura ou `verify`) | não | não | não | não | não | não | `firestore.rules:804-806`; revisor t10, t11 |
| Escrita em `cash_report_periods`, inclusive forjar `projectionGeneration` | não | não | não | não | não | não | `firestore.rules:792-799`; revisor t11 |
| Escrita da marca no backend | — | — | — | — | — | — | Só o gatilho (`periods.ts:1400`) e a reconstrução de owner/admin (`rebuild.ts:1268`). Busca em `functions/src` e `src`, fora de testes: nenhum outro escritor |

---

## 2. Matriz de evidências (checklist)

| # | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Identidade só do token verificado; nada afirmado pelo cliente | PASS | Rules usam `request.auth.uid` e o membership (`firestore.rules:5-7,28-53`), sem nenhum `request.auth.token`. O gatilho não tem usuário. A callable usa o ator resolvido pelo kernel (`rebuild.ts:1693-1712`). Revisor t3: custom token com `role: owner`, `workspaceId: A` e `admin: true`, sem membership, é negado em tudo |
| 2 | `workspaceId` não vazio, validado e coerente com caminho e conteúdo | PASS | Rules decidem pelo caminho (`:818-819`). Cliente recusa vazio e `loading` (`projectionReads.ts:23`). Backend usa os parâmetros do caminho do gatilho (`transactions.ts:370`) e `actor.workspaceId`; `workspaceId` e `transactionId` gravados na marca saem dos mesmos valores (`projectionMarks.ts:483-515`). Revisor t5: marca de A com `workspaceId = B` é negada ao owner de B e lida pelo owner de A |
| 3 | Membership ativo conferido em toda leitura; removido, suspenso e token antigo | PASS | `canReadWorkspaceScopedData` chama `isMember`, que exige perfil `active` e membership `active` (`firestore.rules:32-46,66-68`). Oficial t1/t2: removido e suspenso negados. Revisor t3: também sem perfil e sem `status`. Revisor t9: membro removido entre dois `get` da mesma transação tem a segunda leitura negada e a transação falha (1 tentativa). Convidado não existe como membership (`functions/src/workspaces/model.ts:36`: só `active` ou `removed`) |
| 4 | Sem enumeração entre workspaces (consultas, grupo, contagem, oráculos, erros) | PASS | `list: false` e nenhuma regra de grupo. Revisor t1/t3/t4: `in`, listagem e contagem negadas. Revisor t10: `verify` sem leitura dá 403 tanto para marca existente quanto inexistente. Erros do SDK nunca chegam à tela (`src/modules/work-time/messages.ts:69-75`) |
| 5 | Nenhuma leitura cruzada, escrita cruzada, vazamento de metadado ou IDOR | PASS (nenhum caminho encontrado) | Revisor t1 (A→B e B→A, quatro papéis, cinco formas de leitura) e t2 (escrita cruzada nos dois sentidos, sete formas, marcas intactas conferidas pelo Admin SDK). Revisor t8: mês de B e marca de A na mesma transação é negado, sem resultado |
| 6 | Matriz owner/admin/member/viewer por operação e negação por padrão | PASS (documentação: L1) | Matriz acima. Negação por padrão: catch-all `write: false` e coleção na lista `isBackendOwnedCollection`. A matriz canônica `docs/production/AUTH_RBAC_WORKSPACES.md` não ganhou a linha (L1) |
| 7 | Papel derivado de dado confiável | PASS | Só do membership (Rules); kernel e releitura na transação (`rebuild.ts:1703`) |
| 8 | Escritas sensíveis só no backend | PASS | Escritores só em `periods.ts:1400` e `rebuild.ts:1268` (busca fora de testes); Rules negam toda escrita do cliente (`:821`, `:1173`) |
| 9 | Autopromoção, último owner, convites, reatribuição | N/A | A R3 não toca membership: nenhum arquivo em `functions/src/workspaces` no delta (`git diff --stat`) |
| 10 | Convites com token de uso único | N/A | Idem |
| 11 | Helpers entre servidores como fronteira de confiança | PASS | `applyCashPeriodWriteOnce(transaction, workspaceId, eventKey, before, after, context)` recebe os ids do caminho do evento. `executeRebuildCashPeriods(actor.workspaceId, actor.uid, payload)` recebe o ator verificado. Nenhum id da marca vem do cliente |
| 12 | Campos imutáveis ou críticos protegidos | PASS | Nenhuma escrita do cliente. O backend grava o documento inteiro a partir de dados derivados (`markDocumentData`) ou só a posição da âncora (`markAnchorPatch`, com merge) |
| 13 | Atribuição em massa | PASS | Campos construídos explicitamente (`projectionMarks.ts:483-515`). Leitura defensiva: formato inválido vira `broken`, nunca uma cadeia inventada (`projectionMarks.ts:413-465`). Revisor t2/t3: `overwrite`, `merge` e `update` (inclusive com troca de `workspaceId`) negados |
| 14 | Validação na fronteira confiável | PASS | Tipos fora da serialização canônica dão `FingerprintTypeError`: o gatilho trata como violação de contrato e a reconstrução para (`periods.ts:1374-1382`; `rebuild.ts:774-781`). Pendências limitadas a 16 (`projectionMarks.ts:43`). Ids do cliente limitados pelas Rules da preferência. Tetos de 13 meses e 100 marcas no cliente |
| 15 | Atomicidade e TOCTOU | PASS | Marca, delta, marca de entrega e incidente gravados na mesma transação (`periods.ts:1301-1424`). Âncoras no commit da página que avança o cursor (`rebuild.ts:1248-1287`). Autorização da reconstrução relida na transação. A transação do cliente é otimista e sem trava (não bloqueia o gatilho); o `verify` exige leitura (revisor t10) |
| 16 | Idempotência e reentrega | PASS (herdado) | A marca de entrega é conferida antes de qualquer escrita; duplicada não toca a marca (`periods.ts:1314-1320`). Teste "reentrega e entregas simultâneas: um delta, uma mudança de marca" (`functions/src/cash/__tests__/projectionMarks.integration.test.ts:210`), 13/13 em `logs/int-copia-marcas-fix-2.log`; **herdado, não reexecutado nesta revisão** |
| 17 | Rules avaliadas como se não houvesse backend | PASS | Negação por padrão, coerência de caminho, membership, sem consulta, sem grupo, sem escrita (Emulator: oficial 6/6, revisor 11/11) |
| 18 | Backend avaliado como se não houvesse Rules | PASS | O gatilho não aceita entrada de usuário. A callable exige autenticação, membership, papel owner/admin, releitura e limite. A R3 não cria callable nem HTTP novos |
| 19 | Uma camada não compensa a outra | PASS | As duas camadas provadas separadamente: itens 17 e 18 |
| 20 | Auditoria de ações sensíveis | PASS | Nenhuma ação de usuário nova: as marcas são derivadas pelo sistema. Quebra de marca registrada em log (`cash_projection_mark.broken`, `transactions.ts:307-313`, só código) e nos contadores backend-only (`periods.ts:1193-1212`). A reconstrução já grava `updatedBy` (pré-existente) |
| 21 | Segredos e material sensível | PASS | Busca no delta (fora de evidências) por chaves, tokens, PEM e projeto de produção: só valores de Emulator e teste (`rules-test`, senhas de teste) |
| 22 | Storage | N/A | Nenhuma mudança em Storage, nem regras de Storage no delta |
| 23 | Downloads e URLs assinadas | N/A | Idem |
| 24 | Testes negativos no Emulator com tenants A e B, **nos dois sentidos**, para toda operação alterada | **FAIL (M1)** | A suíte oficial tenta só B→A (`get`, consulta e transação: `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:205,229,297`). Não tem nenhuma tentativa A→B (`wsB` só aparece como o próprio workspace do owner de B, `:207`) e nenhuma escrita cruzada em sentido algum (escrita só de membros ativos de A em A, `:235-255`) |
| 25 | Não autenticado, não membro, removido, fronteiras de papel, workspace forjado, caminho divergente do conteúdo, papel forjado, campos imutáveis, escrita privilegiada | **FAIL (M1)** | Coberto na oficial: leitura de anônimo, removido, suspenso e outro workspace; escrita dos quatro papéis ativos. Falta: escrita de não membro, removido, suspenso e anônimo; caminho divergente do conteúdo; workspace arquivado (semeado em `:61,127,133` e **nunca usado**). Claims forjadas: N/A por código (Rules não leem claims), mas provado no revisor t3 |
| 26 | Concorrência e reentrega, com estado final | PASS | Backend: reentrega, simultâneas e falha antes e depois do commit, herdado (`projectionMarks.integration.test.ts:210,235`). Rules: sem escrita do cliente; revogação no meio da transação provada (revisor t9) |
| 27 | Suíte relevante executada | PASS | Uma execução no Emulator (`minhas-financas-local`), no lock: oficial 6/6 e revisor 11/11 (`rules-reexecucao.log`) |

---

## 3. Caminhos de ataque tentados

Todos no Emulator, contra as Rules do WT (sha256 `3f6f8eb8…`).

- "oficial tN": teste N da suíte da R3.
- "revisor tN": teste N de `ataques-marcas-r3.test.mjs`, deste diretório.

| Classe | Cenário | Resultado | Evidência |
| --- | --- | --- | --- |
| IDOR / tenant cruzado | Owner, admin, member e viewer de B leem `workspaces/A/cash_projection_marks/t1` | Negado | oficial t1 (só owner de B); revisor t1 (os quatro papéis) |
| IDOR / tenant cruzado | Owner, admin, member e viewer de A leem as marcas de B: `get`, `in` por id, listagem, contagem e transação | Negado | revisor t1 (**não coberto pela suíte oficial**) |
| Tenant cruzado | Transação que lê o mês de B (permitido) e depois a marca de A | Negada inteira, sem resultado | revisor t8 |
| Escrita cruzada | Papéis de A escrevem em B e de B em A: create, overwrite, merge, update com troca de `workspaceId`, delete, lote e `set` dentro de transação | Negado; marcas intactas pelo `updateTime` e pelo conteúdo, nenhuma forjada | revisor t2 (**não coberto pela suíte oficial**) |
| Não membro | Removido, suspenso, sem perfil, sem `status`, sem membership, claims forjadas e anônimo: as cinco leituras e as sete escritas | Negado | revisor t3 (oficial: só leituras de removido, suspenso, outro workspace e anônimo) |
| Enumeração | Consulta de grupo com e sem `where('workspaceId','==',A)` e contagem do grupo (owner A, owner B, membro dos dois, anônimo) | Negado | oficial t4 (owner A e anônimo, sem filtro); revisor t4 |
| Oráculo de metadado | Commit REST só com `verify` (`exists: true/false`) sobre marca existente e inexistente de A, por owner de B; `verify` do `projection_state` por owner de A | 403 `PERMISSION_DENIED` nos quatro casos, sem distinção. Controle positivo: viewer de A recebe 200 e 409 | revisor t10 |
| Conteúdo × caminho | Marca de A com `workspaceId = B` | Negada ao owner de B; lida pelo owner de A; membro dos dois lê o conteúdo certo em cada caminho | revisor t5 |
| Caminho | Subcoleção sob a marca, coleção com outra caixa (`Cash_Projection_Marks`) e nome vizinho (`cash_projection_marks_v2`) | Negado | revisor t6 |
| Escalonamento | Owner e admin criam, sobrescrevem, alteram ou apagam marca do próprio workspace | Negado | oficial t3; revisor t2 e t3 por outros sujeitos |
| Escalonamento | Forjar `projectionGeneration` (`update` e merge) e escrever no mês dentro da transação de leitura (owner e viewer de A) | Negado; mês intacto | revisor t11 |
| Estado backend-only | Ler `cash_period_events/projection_state` (`markSlot`, `lastMarkIssueTransactionId`) | Negado | revisor t11 |
| Arquivado | Membro de workspace arquivado: lê por id, não escreve, não lista | Conforme | revisor t7 |
| Token antigo | Membro removido entre dois `get` da mesma transação | Segunda leitura negada; transação falha sem repetir | revisor t9 |
| Tetos | Viewer lê 13 meses e 100 marcas numa transação só de leitura (o teto do cliente) | 13 + 100 lidos, commit aceito, 494 ms | revisor t8 |
| Reentrega e concorrência (backend) | Entrega duplicada e simultânea; falha antes e depois do commit | Um delta e uma mudança de marca (herdado) | `projectionMarks.integration.test.ts:210,235` |
| Atribuição em massa no backend | Campos especiais no lançamento para quebrar a impressão digital | Sem vetor: o cliente não escreve `transactions` (`firestore.rules:618-621`) e as callables recebem JSON validado. Tipo desconhecido não soma (fail-closed) | Código |
| Indisponibilidade induzida | Rajada de edições para estourar 16 pendências e deixar a marca `broken` | Só indireto, por edições legítimas com papel de escrita. Efeito fail-closed: a estimativa fica em reais. `markRecoveryNeeded` não tem leitor fora da publicação (busca), então não aciona `needsRebuild` nem bloqueia outra operação | `periods.ts:1193-1212`; busca por `markRecoveryNeeded` |

---

## 4. Achados

### M1 — MEDIUM (bloqueante pelo gate)

**Falha de cobertura de isolamento de tenant, sem vulnerabilidade explorável.** A suíte de Rules entregue não tenta o sentido A→B nem nenhuma escrita cruzada ou de não membro.

**Onde.** `tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs`:

- **Cross-tenant só B→A:** `:203-207` (get), `:229` (consulta) e `:297` (transação).
- **Escritas só de membros ativos de A em A:** `:235-255`.
- **Arquivado semeado e não usado:** `wsArchived` em `:61,127,133`.

A suíte P5-C1 do mesmo padrão faz os dois sentidos, a escrita cruzada e o arquivado (`tests/firestore/reports-p5c1.rules.integration.test.mjs:233-244,269`). A R3 ficou abaixo do padrão já estabelecido no projeto. O pedido (§9) exige "usuário de outro workspace", "usuário desligado", "não autenticado" e "escrita direta pelo cliente". A skill exige "both directions of cross-tenant access for every changed Firestore operation".

**Cenário de ataque não protegido contra regressão.**

- **Atacante e pedido:** usuário autenticado e ativo do tenant A pede `get`, consulta ou escrita em `workspaces/B/cash_projection_marks/*`. Ou um não membro, removido, suspenso ou anônimo pede escrita em `workspaces/A/cash_projection_marks/*`.
- **Hoje:** a decisão é negar (revisor t1–t3).
- **Lacuna:** nenhuma asserção do repositório prende esse resultado. Uma refatoração das Rules que altere a ligação de `workspaceId` (por exemplo, sombra de variável num `match` aninhado), o helper de leitura ou a regra de escrita para um desses sujeitos passaria pelo CI (`test:integration:emulator`) e pelo `predeploy:rules`.
- **Impacto potencial:** vazamento entre tenants da existência de ids de lançamentos, das impressões digitais de conteúdo e da geração e corte da projeção. Ou forja de marca, que transforma a prova da estimativa em "verdadeira com valor errado".

**Correção exigida.** Acrescentar à suíte oficial, ou a uma suíte incluída em `test:rules:projection-marks`, no mínimo:

1. A→B para os quatro papéis de A: `get`, `in` por id, listagem, contagem e transação.
2. Escrita cruzada nos dois sentidos, com o estado conferido depois.
3. Escrita de removido, suspenso, sem membership e anônimo.
4. Workspace arquivado: lê por id e não escreve.

Os cenários t1, t2, t3 e t7 de `ataques-marcas-r3.test.mjs` já passam contra as Rules atuais e podem ser portados como estão. Recomendado também: t5 (caminho × conteúdo), t9 (revogação na transação), t10 (`verify`) e t8 (teto 13 + 100). Reexecutar no Emulator e submeter de novo a esta revisão.

### L1 — LOW

**A matriz canônica de papéis e o modelo de ameaças não citam a coleção nova.**

- **Onde.** `docs/production/AUTH_RBAC_WORKSPACES.md` (a linha vizinha da P5-C1 está em `:203`) e `docs/production/THREAT_MODEL.md` não citam `cash_projection_marks`. `SECURITY_MODEL.md:124`, `DATA_MODEL.md:52,140` e `DATA_RETENTION_LIFECYCLE.md:104` citam.
- **Risco.** A matriz por operação é a referência que os próximos milestones e revisões consultam. Sem a linha, uma mudança futura de papel na coleção não tem alvo documentado.
- **Correção.** Uma linha na matriz, no formato da linha `:203` do mesmo arquivo: `get` para os quatro papéis; nenhuma consulta, consulta de grupo nem escrita do cliente; escritores só o gatilho e a reconstrução de owner/admin; suíte de Rules. E uma menção no ativo A2 do modelo de ameaças.

### Achados INFO (risco residual registrado, sem bloqueio)

**I1 — Impressões de versões antigas ficam na marca.** `anchors.*.fp`, `chains.*.base` e `pending[].b/a` (`projectionMarks.ts:150-192`) são legíveis por todo membro, viewer inclusive. Servem de oráculo de confirmação de palpite sobre conteúdo anterior de um lançamento: quem conhece o documento anterior quase inteiro testa o resto. Hoje isso não expõe nada novo. `activity_logs` (catch-all, todo membro) já entrega `netCentsBefore`, `netCentsAfter` e `changedFields` de cada edição (`functions/src/triggers/transactions.ts:200-224`; `DATA_MODEL.md`, linha `activity_logs`, PR-RULES-02). Se o PR-RULES-02 restringir o histórico de edição a owner e admin, como já é em `cash_events`, reavaliar também as impressões históricas das marcas.

**I2 — Custo da reconstrução.** Cada reconstrução grava uma âncora por lançamento da base (`rebuild.ts:1262-1277`). Ela é acionável por owner e admin do próprio workspace com 100 chamadas por hora (`rebuild.ts:1677-1681`). É abuso por papel privilegiado do próprio tenant, sem efeito cruzado; o tema é da `firestore-scale-cost-review`.

**I3 — Checkpoint legível por membros (pré-existente).** O checkpoint da reconstrução fica em `cash_report_periods/cash_periods_rebuild` (`rebuild.ts:146-156`), legível por todo membro. Ele traz `updatedBy` e `periods` parciais. A R3 só acrescenta `markSlot`, que não é sensível.

**I4 — Gate de Rules depende de um build que não faz.** `predeploy:rules` roda o teste 6 da suíte, que importa `functions/lib/cash/projectionMarks.js` (`:305`) sem compilar as Functions antes (`package.json`, script `predeploy:rules`). Sem o build, falha (fail-closed). Com um build antigo, confere a paridade contra código velho. A paridade não é controle de segurança. No CI, `test:integration:emulator` compila antes.

**I5 — Condição de implantação sem registro no plano.** O desenho diz que a condição de implantação (reconstrução de cada workspace com dados anteriores) está registrada no plano mestre §20.18 (`docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md:110`). O plano da árvore atual termina na §20.17 (`PRODUCTION_READINESS_PLAN.md:4996`). Sem a reconstrução, a prova recusa (fail-closed); o registro é para o gate de regressão e para o fechamento.

---

## 5. Verificação

**Execução no Emulator**, projeto `minhas-financas-local`, dentro do lock `p5f1r3/wt-r3-runtime.lock`, com `with-proxy-safe.sh 38839`:

```bash
cd $S/wt-p5f1-r3 && flock $S/p5f1r3/wt-r3-runtime.lock bash $R/rodar-sob-lock.sh
# rodar-sob-lock.sh confere as portas 8080, 9099, 4400, 4500 e 9150 livres, grava hashes antes e depois e executa:
timeout 1200 bash $S/with-proxy-safe.sh 38839 firebase emulators:exec --only auth,firestore \
  --project minhas-financas-local "bash $R/rodar-revisao-seguranca.sh" > $R/rules-reexecucao.log 2>&1
# rodar-revisao-seguranca.sh: confere GCLOUD_PROJECT=minhas-financas-local e roda, uma vez cada,
#   npm run test:rules:projection-marks
#   WT_DIR=$WT node --test --test-concurrency=1 $R/ataques-marcas-r3.test.mjs
```

**Resultado.**

- Suíte oficial: `tests 6 · pass 6 · fail 0 · skipped 0`.
- Ataques do revisor: `tests 11 · pass 11 · fail 0 · skipped 0`.
- `exit=0`, das 19:02:04Z às 19:02:25Z.
- `firestore.rules`, `functions/lib/cash/projectionMarks.js` e a suíte oficial com o mesmo sha256 antes e depois (`rules-reexecucao.meta`).
- Emuladores encerrados; nenhuma JVM órfã desta execução.

**Primeira tentativa: o Emulator não subiu.** A porta 8080 estava ocupada pela JVM órfã da execução E2E do revisor pt-BR. A limpeza daquela execução recusou encerrá-la porque contou o meu comando, que esperava na fila do lock, como processo ativo. Nenhum teste rodou (`rules-reexecucao-tentativa1-porta-ocupada.log`). A própria limpeza pt-BR encerrou a JVM às 19:01:07Z (`p5f1r3/logs/emulator-cleanup.log`). Não enviei sinal a nenhum processo. A segunda tentativa foi a única execução da suíte.

**Identidades e recursos.**

- **Suíte oficial:**
  - Workspaces `p5f1r3-workspace-a`, `-b` e `-arquivado`.
  - Usuários: owner, admin, member e viewer de A; removido e suspenso de A; owner de B.
- **Revisor:**
  - Workspaces `sec3-ws-a`, `sec3-ws-b` e `sec3-ws-arquivado`.
  - Os quatro papéis de A e os quatro de B.
  - Em A: removido, suspenso, sem perfil, membership sem `status`, sem membership e claims forjadas (custom token com `role: owner`, `workspaceId: A`, `admin: true`).
  - Também: membro dos dois workspaces, membro revogado no meio da transação e anônimo.
  - Marcas: 2 em B, 103 em A (inclusive `mismatch`) e 1 no arquivado; 13 meses em A e em B; `projection_state` em A.
- **Operações negadas e conferidas por código `permission-denied`/`PERMISSION_DENIED`:**
  - Leituras: `get`, `in` por id, listagem, contagem e transação.
  - Escritas: create, overwrite, merge, update, delete, lote e `set` dentro de transação.
  - Consulta de grupo com e sem filtro, e contagem do grupo.
  - `verify` REST: 403 igual para documento existente e inexistente.
  - Subcaminho e coleções vizinhas.
  - `projection_state`; forja de `projectionGeneration`; escrita no mês dentro da transação.
  - Estado final conferido pelo Admin SDK (marcas e mês intactos).

**Outras verificações.**

- `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/work-time-guard.test.ts` no WT: 18/18 (`unit-guard.log`).
- `npx tsc --noEmit` na raiz e em `functions/`: exit 0 nos dois (`tsc-raiz.log`, `tsc-functions.log`).
- WT intacto: sha256 de `src`, `tests`, `functions/src`, `firestore.rules` e `package.json` iguais antes e depois da revisão (`wt-sha-antes.txt` = `wt-sha-depois.txt`, 675 arquivos).
- Nada foi feito em Firebase real nem no projeto de produção. Nenhum `.env*` foi lido.

**Testes herdados, não reexecutados nesta revisão:** integração de backend das marcas (13/13 em `p5f1r3/logs/int-copia-marcas-fix-2.log`) e a suíte completa (`verify:all`).

**Artefatos** em `$S/p5f1r3/revisoes/seguranca/`:

- `PARECER.md` (este arquivo);
- `ataques-marcas-r3.test.mjs`, `rodar-revisao-seguranca.sh` e `rodar-sob-lock.sh`;
- `rules-reexecucao.log` e `rules-reexecucao.meta`;
- `rules-reexecucao-tentativa1-porta-ocupada.log` e `rules-reexecucao-tentativa1.meta`;
- `unit-guard.log`, `tsc-raiz.log` e `tsc-functions.log`;
- `hashes-superficie.txt`, `wt-sha-antes.txt` e `wt-sha-depois.txt`.

`$S` = `<scratchpad>`.

---

## 6. Condição para PASS

Para esta revisão virar PASS:

1. Corrigir M1 no WT, com os cenários listados.
2. Rodar `npm run test:rules:projection-marks` no Emulator com todos os testes passando.
3. Reapresentar a árvore à revisão.

L1 deve ser corrigido no mesmo ciclo. Os INFO ficam como risco residual registrado. Com a superfície de código atual, não há outra mudança de Rules ou de backend exigida.
