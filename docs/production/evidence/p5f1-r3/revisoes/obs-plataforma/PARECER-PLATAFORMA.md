PASS — Firebase production readiness

Parecer independente e somente leitura da etapa P5-F.1-R3, emitido em 2026-11-09 (leitura encerrada às 20:40 UTC).

O veredito vale para o escopo do diff da R3, pela "Política de decisão" da skill. O checklist global continua FAIL pelos itens herdados listados em "Fora do escopo". A R3 não introduz nem agrava nenhum deles. Nenhum achado bloqueia.

## Escopo

- **Árvores:**
  - worktree `wt-p5f1-r3`, commit-base `1730a1df`;
  - árvore de partida `f82679226ec93e18f906731be09d0675326fd764`;
  - árvore de código final `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`.
  - Depois de `377c2f3`, só mudou `docs/`: zero diferença fora de `docs/` às 20:37:24 UTC.
- **Arquivos de plataforma avaliados:**
  - `firestore.indexes.json`: 6 `fieldOverrides` novos;
  - `package.json`: `test:rules:projection-marks`, `test:integration:emulator` e `predeploy:rules`;
  - `firestore.rules`, só como existência de bloco e de suíte (a semântica fica com `multi-tenant-security-review`);
  - `functions/src/triggers/transactions.ts`, `functions/src/cash/rebuild.ts` e `functions/src/cash/periods.ts`, para runtime, exports e retry;
  - `docs/production/BACKUP_RESTORE_DR.md` §3 e §6, como mecanismo de restore.
- **Sem alteração da R3, conferidos:** `firebase.json`, `.firebaserc`, `.github/workflows/quality-gate.yml`, `functions/src/index.ts`, `functions/src/shared/runtimeOptions.ts`, `functions/package.json` e `FIREBASE_PRODUCTION.md`.
- **Serviços:** Firestore (Rules, índices, Emulator), Cloud Functions (gatilho e callable existentes) e restore do Firestore.

## Mapa de ambientes

| Ambiente / projeto | Onde aparece | Destino padrão | Efeito da R3 |
| --- | --- | --- | --- |
| Produção `sistema-financeiro-pesso-20698` | `.firebaserc`, com `default` como único alias. Scripts `deploy:firestore`, `deploy:functions`, `deploy:safe`, `deploy:hosting` e `deploy:webhook` (`package.json:38-42`), com `--project` explícito | Produção (herdado, PR-PLAT-01) | Nenhum. Os `deploy:*` têm o mesmo hash na base e no final. Nenhuma linha `+`/`-` do delta cita o projeto. O log do `verify:all` também não o cita (0 ocorrências) |
| Emulator `minhas-financas-local` | `test:integration:emulator` (`package.json:52`) e `predeploy:rules` (`:37`), os dois com `firebase emulators:exec --only auth,firestore --project minhas-financas-local`. `test:rules:projection-marks` (`:70`). `functions:test:integration:emulator` com `GCLOUD_PROJECT=minhas-financas-local` | Emulator | As suítes novas exigem `FIRESTORE_EMULATOR_HOST` (`cash-projection-marks-p5f1r3.rules.integration.test.mjs:43-44`). A de ataques recusa projeto diferente de `minhas-financas-local` (`…-ataques…:12-14`). O E2E novo usa os helpers do Emulator (`e2e/support/workspaceSeed.ts:35-39`) |
| DEV / STAGING | Não existem | — | Fora do escopo (PR-PLAT-01, E-01) |
| CI | `quality-gate.yml`, em push e PR: o job "Integração e Firestore Rules" roda `npm run test:integration:emulator` (`:152`), sem credenciais e sem job de deploy | Emulator | Inalterado. Passa a rodar a suíte nova, porque ela entra em `test:integration:emulator`. `functions/lib` é compilado antes dentro da mesma cadeia: o `test:integration` das Functions começa com `npm run build` |

Credenciais: a R3 não acrescenta nenhuma. As suítes usam `apiKey` fictícia contra o Emulator, e a varredura de segredos no delta deu 0 ocorrências.

## Inventário de Functions

A R3 não exporta Function nova:
- não há `export` acrescentado nos módulos que `index.ts` reexporta;
- `projectionMarks.ts` não é reexportado;
- nenhuma linha `+` do delta contém `onCall`, `onDocument*`, `onSchedule`, `onRequest`, `defineSecret`, `enforceAppCheck`, `region:`, `timeoutSeconds`, `memory:`, `maxInstances`, `retry:` ou `concurrency`.

As duas funções tocadas, só no handler:

| Função | Tipo | Região | Timeout | Memória | maxInstances | concurrency | Retry | Segredos | App Check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `onTransactionWrite` | `onDocumentWritten` em `workspaces/{ws}/transactions/{id}` | `southamerica-east1` | 60 s | 256MiB | 20 | não declarada (padrão; herdado) | `true` (`runtimeOptions.ts:144-150`) | nenhum | N/A: gatilho, sem requisição de cliente |
| `rebuildCashPeriods` | callable do kernel; owner/admin; 100 chamadas/h por ator e workspace | `southamerica-east1` | 540 s | 512MiB | 3 (`runtimeOptions.ts:78-83`) | não declarada (herdado) | N/A | nenhum | `APP_CHECK_CALLABLE_OPTIONS = {}` (`callable.ts:70-81`; enforcement na P6) |

**Opções globais:** `GLOBAL_FUNCTION_OPTIONS` define região e `maxInstances: 20` (`runtimeOptions.ts:41-44`).

**Contrato de deploy executado no `verify:all`:**
- `ok 547`: toda função na região do Firestore;
- `ok 551`: perfil pesado do `rebuildCashPeriods`, 540 s e 512 MiB (`deploymentContract.test.ts:114-121`);
- `ok 565`: o gatilho de caixa mantém retry e perfil (`deploymentContract.test.ts:447-455`).

**Retry continua idempotente.** A marca e o estado são gravados na mesma transação que cria o marcador de entrega com `transaction.create` (`periods.ts:1402-1424`). A reentrega cai em `duplicate` sem escrever nada, coberto pelo teste "reentrega e entregas simultâneas" (`projectionMarks.integration.test.ts:213-226`).

**Testes fora do pacote.** Os testes novos ficam fora do bundle (`firebase.json:13-26`, `ignore` de `__tests__` e `testSupport`).

## Matriz de evidência

| § | Seção | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Ambientes DEV/STAGING/PROD | PASS | Nenhum script, CI ou default novo aponta para produção. Os `deploy:*` estão idênticos (hash). Scripts e suítes novas só usam o Emulator `minhas-financas-local`. O isolamento de ambientes em si é herdado (fora do escopo) |
| 2 | App Check | Fora do escopo | O diff não muda App Check (0 linhas com `enforceAppCheck`/`consumeAppCheckToken`). A leitura nova do cliente fica coberta pelo enforcement de serviço quando ele for ligado |
| 3 | Security Rules e índices | PASS | Ver detalhe abaixo da tabela |
| 4 | Cloud Functions | PASS | Ver "Inventário de Functions". Sem dependência nova: o diff de `package.json` só mexe em scripts, e `functions/package.json` e os lockfiles não mudam |
| 5 | IAM | Fora do escopo | Não tocado |
| 6 | Segredos | PASS | Varredura das linhas `+` do delta (chaves Google, Stripe, webhook, chave privada, GitHub, Slack, AWS): 0. Sem `process.env` nem `defineSecret` novos |
| 7 | Authentication | Fora do escopo | Não tocado |
| 8 | Hosting | Fora do escopo | `firebase.json` não muda |
| 9 | Custos e quotas | Fora do escopo | Os tetos de instância não mudam. O custo de leitura da prova é tema de `firestore-scale-cost-review`. Budget, alertas e interruptor são P7 |
| 10 | Monitoramento de plataforma | Fora do escopo | P7 |
| 11 | Backup, PITR e restore | PASS (texto da R3) | Ver detalhe abaixo da tabela. O mecanismo (PITR, backups, restore ensaiado) é P7 |
| 12 | Emulator | PASS | `firebase.json:66-84` define os emuladores, com `singleProjectMode: true`. As suítes novas exigem o Emulator e rodam na CI em todo PR. Ver PLAT-I1 |
| 13 | Registro de configuração externa | Fora do escopo | Nenhum item externo novo. As isenções são configuração versionada. O estado publicado por ambiente é herdado ("Versionado não significa publicado", `FIREBASE_PRODUCTION.md` §5) |

Detalhe do §3:
- **Referência:** `firebase.json:5-6` aponta Rules e índices.
- **Bloco explícito:** a coleção nova tem bloco próprio e entra em `isBackendOwnedCollection` (`firestore.rules:459, 818-822`).
- **Gate de deploy:** `predeploy:rules` (`package.json:37`) roda as mesmas 19 suítes de Rules de `test:integration:emulator`, inclusive `test:rules:projection-marks`, no mesmo `emulators:exec`. Ele agora compila as Functions antes com o mesmo comando de `functions:build`, já executado no `verify:fast`. As duas suítes novas passaram com 17 de 17 testes. Ver PLAT-I5.
- **Isenções em `firestore.indexes.json:1440-1469`:**
  - a mudança é só aditiva: 6 isenções novas, nenhuma removida, os 72 índices compostos idênticos e os 16 TTL intactos;
  - cobrem os 6 campos de topo que os escritores gravam (`projectionMarks.ts:483-495, 524-536`);
  - nenhuma consulta lê a coleção: o backend lê por referência e o cliente por `transaction.get` (`projectionReads.ts:32`);
  - o validador do `firebase-tools` 15.32.1 aceitou o arquivo (`validateSpec`/`validateField`), e o controle negativo, sem `indexes`, falhou com `Must contain "indexes"`.
- **Efeito oficial:**
  - o deploy envia `PATCH …/fields/{campo}` com `indexConfig.indexes = []` e `updateMask=indexConfig`, sem tocar em TTL (`firebase-tools/lib/firestore/api.js:316-349`);
  - o proto da Admin API diz que, para remover explicitamente todos os índices de um campo, usa-se index config com lista vazia (`@google-cloud/firestore` 7.11.6, `protos/google/firestore/admin/v1/field.proto:127-131`);
  - subcampos de `anchors` e `chains` herdam a configuração do campo ancestral (`field.proto:47-56`, `uses_ancestor_config`/`ancestor_field`).
- **Testes:** contrato `projectionMarks.test.ts:292-307` (`ok 169`).
- **Inventário canônico:** registrado em `DATA_MODEL.md:140`.
- **TTL:** nenhum; a retenção está documentada em `DATA_RETENTION_LIFECYCLE.md`. Os itens herdados ficam fora do escopo.

Detalhe do §11. O texto da R3 (`BACKUP_RESTORE_DR.md:52, 117, 123`) é coerente com o código:
- marcas e meses nunca vêm do banco restaurado;
- a reconstrução recria âncoras de toda a base e etiqueta todos os meses (`rebuild.ts:1262-1277, 1585-1610, 1630-1634`);
- PITR ou backup do banco inteiro num instante único é consistente;
- a reconstrução vem antes de reabrir.

## Configuração externa pendente

A R3 não acrescenta nenhum item. Os itens herdados abaixo ficam fora do escopo; todos estão em `FIREBASE_PRODUCTION.md` §16, com estado `NÃO VERIFICADO` e responsável "a designar":

| ID | Item | Forma de verificação registrada |
| --- | --- | --- |
| E-01 | Projetos DEV, STAGING e PROD, e aliases | `firebase projects:list`; leitura do `.firebaserc` implantado |
| E-02 | App Check | Console › App Check |
| E-03 | Authentication | Console › Authentication |
| E-04 | IAM | `gcloud projects get-iam-policy` |
| E-05 | Secret Manager | `gcloud secrets list`, só nomes |
| E-07 | PITR, backups, delete protection, TTL | — |
| E-08 | Monitoramento e alertas | — |
| E-12 | Proteção de branch e CD | — |

## Achados bloqueantes

Nenhum.

## Observações (informativas; nenhuma é falha do escopo)

- **PLAT-I1 — INFO. Sondas de evidência sem guarda própria de Emulator.**
  - **Situação:** as sondas versionadas em `docs/production/evidence/p5f1-r3/sondas/` (`sonda-updatetime.cjs:7`, `sonda-transacao-leitura.cjs:13-14`) iniciam o Admin SDK com `projectId: 'minhas-financas-local'` sem exigir `FIREBASE_EMULATOR_HOST`. Rodaram sob `emulators:exec`, como mostram as saídas, e nunca apontam para produção. Também não entram em nenhum script npm nem na CI.
  - **Sugestão:** a mesma guarda das suítes de Rules (`if (!process.env.FIRESTORE_EMULATOR_HOST) throw`).
- **PLAT-I2 — INFO. O rollback ainda não está na árvore.** O parágrafo de rollback da R3 (apagar `cash_projection_marks`, que as Rules da R2A deixariam legível pela regra genérica) existe só no rascunho da §20.18, fora da árvore. Ele também não cita as 6 isenções.
  - **Efeito do rollback:** ao publicar o arquivo de índices da R2A, o `firebase-tools` as lista como "not present in your file" e pergunta antes de apagar. Em modo não interativo sem `--force`, as mantém (`api.js:73-83, 123-158`). A sobra é inofensiva.
  - **Sugestão:** a mesma remediação do OBS-B1 do parecer de observabilidade (aplicar a §20.18), acrescentando as isenções.
- **PLAT-I3 — INFO. Ordem de implantação.** Enquanto as isenções não forem publicadas, cada gravação de marca gera entradas de índice de campo único: o revisor de escala estimou 22 a 78 por documento. `deploy:safe` publica índices e Functions juntos; `deploy:functions` sozinho não. Convém registrar como condição de implantação "índices antes ou junto das Functions".
- **PLAT-I4 — INFO. `FIREBASE_PRODUCTION.md` §5 sem a linha da R3.** O documento não ganhou a linha CURRENT da R3 (isenções e gate com build), como fizeram a P5-C1, a P5-D2 e a P5-D2.1. As contagens da seção já estavam defasadas antes da R3. O inventário canônico de índices (`DATA_MODEL.md:140`) está atualizado.
- **PLAT-I5 — INFO, positivo. O build no `predeploy:rules` fecha uma lacuna latente.** Desde a P5-D2, `notifications-p5d2.rules.integration.test.mjs:58-59` carrega `functions/lib/…`. Sem build, o gate falhava num checkout limpo ou testava um `lib` antigo.

## Fora do escopo desta avaliação

| Item do checklist | Motivo | ID do plano |
| --- | --- | --- |
| Projetos DEV/STAGING/PROD isolados; `default` ≠ PROD; `deploy:*` sem produção fixa | Herdado; P6 | PR-PLAT-01, E-01 |
| Deploy de Rules/índices só por pipeline com gate | Herdado; P6. Hoje um `firebase deploy` direto pula a suíte: o único hook `predeploy` do `firebase.json` é o build das Functions (`:27-29`) | PR-REL-01, E-12 |
| Versão implantada por ambiente igual a commit aprovado | Herdado; P6 | PR-REL-01 |
| App Check no cliente e enforcement | P6 | PR-APPCHK-01, D-33, E-02 |
| `concurrency` declarada global ou por função | Herdado, não alterado pela R3; hardening da P6 | P6 (escopo da §8) |
| IAM, Secret Manager por ambiente, Authentication, Hosting e headers | P6 | E-03, E-04, E-05, PR-PLAT-03 |
| Budget, quotas, interruptor e monitoramento de plataforma | P7 | E-08, PR-OBS-02 |
| PITR, backups agendados, delete protection e restore ensaiado | P7, com repetição na P10 | PR-BKP-01, E-07 |
| Execução da reconstrução por operador em DR (capacidade administrativa) | P7 | PR-ADMIN-01 |

## Verificação

Nada foi alterado no WT nem no repositório. Não subi o Emulator, não compilei `functions/lib` e não acessei Firebase real.

1. **Delta e árvores.**
   - `git diff --stat` e `--name-status` de `f8267922…` para `377c2f3f…`.
   - Comparação por `git hash-object` (sem `-w`) do WT contra `377c2f3`: só `docs/` difere.
   - `git diff` de `firestore.indexes.json`, `firestore.rules`, `package.json`, `transactions.ts`, `periods.ts`, `rebuild.ts` e `BACKUP_RESTORE_DR.md`.
   - `git diff --stat … -- firebase.json .firebaserc .github functions/src/index.ts functions/src/shared/runtimeOptions.ts functions/package.json`: vazio.
2. **Índices.**
   - Script Python (`-I`) comparando os dois `firestore.indexes.json`: compostos idênticos, 6 acréscimos, 0 remoções, 0 duplicatas; total de 26 `fieldOverrides`.
   - `node $S/p5f1r3/revisoes/obs-plataforma/sandbox/scripts/validar-indices.cjs` sobre uma cópia, com o validador do `firebase-tools` 15.32.1 e sem rede: válido; controle negativo rejeitado.
   - Leitura de `firebase-tools/lib/firestore/api.js` (deploy, `validateField`, `patchField`, `fieldMatchesSpec`) e de `field.proto`.
3. **Scripts.**
   - Script Python sobre `package.json`: as 19 suítes de `predeploy:rules` são o mesmo conjunto de `test:integration:emulator`, com o mesmo `emulators:exec --project minhas-financas-local`; `functions:build` é `npm --prefix functions run build`.
   - Hash dos `deploy:*` igual na base e no final.
4. **Buscas.**
   - Construtores e opções de Function no delta: 0.
   - Reexport de `projectionMarks`: 0.
   - Consultas a `cash_projection_marks` fora de testes: 0.
   - `sistema-financeiro-pesso-20698` nas linhas `+`/`-` do delta e no log do `verify:all`: 0.
   - Padrões de segredo no delta: 0.
5. **`verify:all` da árvore `377c2f3`.** Conferi o `.meta`: `fim=2026-11-09T20:22:55Z exit=0`. Encontrei:
   - `test:rules:projection-marks` com 17/17 (linhas 35999–36150 do log);
   - `ok 169`, `ok 547`, `ok 551` e `ok 565`;
   - a cadeia `emulators:exec … && npm run test:rules:projection-marks` (linha 11156).
   - Nenhuma conclusão depende de execução em curso.
6. **Documentação web.** O WebFetch em `firebase.google.com` e `docs.cloud.google.com` falhou com `ENOTFOUND`, porque os domínios estão fora da rede da sessão. Usei como fontes primárias o proto oficial da Admin API e o código do CLI que faz o deploy. Para citar a página web, os dois domínios precisam ser liberados.
