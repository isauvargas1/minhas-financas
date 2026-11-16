PASS — Firebase production readiness

Rodada 4 da etapa P5-F.1-R3, somente leitura. É a conferência das mudanças de documentos que tocam a plataforma depois da rodada 3. Emitida em 2026-11-09, com leitura encerrada às 23:12 UTC.

O veredito vale **no escopo da R3**, pela "Política de decisão" da skill. O checklist global continua FAIL pelos itens herdados listados em "Fora do escopo"; a R3 não introduz nem agrava nenhum deles.
- A condição de implantação agora pede as Rules e os índices da R3 antes das Functions, ou junto. Isso confere com os scripts e com a ordem de publicação do `firebase-tools`.
- O efeito declarado de Rules anteriores confere com as Rules da R2A e do HEAD.
- O RR-R3-11 aplica o PLAT-R3-I1, com contagens que conferi nos logs.
- Não há achado bloqueante. Há dois INFO novos (PLAT-R4-I1 e PLAT-R4-I2).

## Escopo

- **Árvores:**
  - documentos `998177124585f0e4ab478f2ddc0d42e421cbcb5f`, o W atual, conferido com índice temporário próprio às 22:57 e às 23:11 UTC;
  - código `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, com diff vazio fora de `docs/` e `verify:all` com `exit=0`;
  - base desta rodada: `ad1660a336f043c7331e158e9a85efdae17e277b` (rodada 3).
- **Configuração versionada:** igual à das rodadas anteriores, porque nada mudou fora de `docs/`. Isso vale para `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `package.json`, `functions/package.json`, `functions/src/index.ts`, `runtimeOptions.ts` e `quality-gate.yml`.
- **Documentos desta superfície que mudaram:**

| Arquivo | Blob anterior → atual | Trecho |
| --- | --- | --- |
| `FIREBASE_PRODUCTION.md` | `111e05b7` → `9f81074fa3f64f6c913b774831c6e33d6086b3ea` | §5, linha 201 (P5-F.1-R3), e nada mais |
| `PRODUCTION_READINESS_PLAN.md` | `028b12ef` → `c7b0fe2c8a28ab2e7638d55f63d2d9f02ed4e12c` | §20.18: condição de implantação (`:5148`) e RR-R3-11 (`:5219-5223`). O rollback e a linha de plataforma (`:5176`) não mudaram |
| `testes-e-resultados.md` | `5eae6580` → `8ef8849e0ad3b702ebf2d2576c4bc7adac9563c2` | §3, linha 102 (PLAT-R3-I1) |
| `BACKUP_RESTORE_DR.md` | `61edcdb6`, igual | — |

## Mapa de ambientes

Sem mudança desde a rodada 1 (`PARECER-PLATAFORMA.md`).
- **Destinos:** produção só nos `deploy:*`, com `--project` explícito (herdado, PR-PLAT-01). Testes e suítes usam o Emulator `minhas-financas-local`. DEV e STAGING não existem.
- **Citação dos scripts:** a linha nova de `FIREBASE_PRODUCTION.md` e o plano citam `deploy:firestore` e `deploy:safe` como os scripts que publicam Rules e índices juntos. Ver o PLAT-R4-I1.
- **Projeto de produção:** 0 ocorrência nas linhas acrescentadas em `docs/` desde `ad1660a3`.

## Inventário de Functions

Sem mudança desde a rodada 1. A árvore de código é a mesma, e o `functions/src/index.ts` e o `firebase.json` são iguais aos da R2A (`cd95e1cb`). Nenhuma Function nova. O `onTransactionWrite` e o `rebuildCashPeriods` mantêm região, timeout, memória, `maxInstances`, retry e App Check como no inventário da rodada 1.

## Conferência

| # | Afirmação (texto atual) | Evidência | Resultado |
| --- | --- | --- | --- |
| 1 | Publicar as Rules da R3 (com o bloco de `cash_projection_marks`) e os índices (com as 6 isenções) antes das Functions, ou junto | O bloco está em `firestore.rules:459, 818-822`; as isenções em `firestore.indexes.json:1440-1469` (árvore `377c2f3f`) | Confere |
| 2 | `deploy:firestore` e `deploy:safe` publicam os dois | `package.json:38`: `predeploy:rules` e depois `--only firestore:rules,firestore:indexes`. `package.json:40`: `predeploy:check` e depois `--only firestore:rules,firestore:indexes,functions` | Confere |
| 3 | "Ou junto" mantém a ordem | No `firebase-tools` 15.32.1, os alvos seguem a ordem fixa `database`, `storage`, `firestore`, `functions` (`lib/deploy/index.js:30-42`; `lib/filterTargets.js:6-17`). Todas as fases de implantação rodam antes de todas as de liberação (`deploy/index.js:191-197`). O Firestore envia o ruleset e os índices na fase de implantação (`deploy/firestore/deploy.js:10-16, 17-52`) e libera as Rules primeiro na fase de liberação (`deploy/firestore/release.js:5-18`). Só depois as Functions são criadas ou atualizadas (`deploy/functions/release/index.js:22, 80-89`). Se a liberação das Rules falhar, a cadeia para antes das Functions | Confere |
| 4 | Com Rules anteriores, a coleção cairia na regra genérica de subcoleção: `get` e `list` sem teto das marcas para qualquer membro ativo do próprio workspace, sem caminho entre tenants e com a escrita negada | Nas Rules da R2A (`cd95e1cb`) e do HEAD (`1730a1df`), a regra genérica é a mesma (`firestore.rules:1148-1154`): `read` se a coleção não é do backend e `canReadWorkspaceScopedData`, e `write: if false`. A lista do backend (`:401-455`) não tem `cash_projection_marks`. `canReadWorkspaceScopedData` é `isMember`, conta e membership ativos naquele workspace (`:42-46, 66-68`) | Confere. A semântica é do revisor de segurança (R3-I2 dele); aqui conferi a exatidão do texto de plataforma |
| 5 | `predeploy:rules` compila as Functions antes das suítes; versionado não é publicado | `package.json:37`; linha 201 sem mudança nesses pontos | Confere |
| 6 | Rollback (`:5237`) e itens de restauração da condição de implantação | Iguais aos da rodada 3, byte a byte. O PLAT-I2 continua resolvido (`firebase-tools`, `lib/firestore/api.js:122-160`) | Sem mudança |
| 7 | RR-R3-11: o emulador cria um processo `node` por chamada concorrente de cada função e não encerra os ociosos; 96 workers na R2A e na R3 (executor) e 98 no gate; de `getFinancialReport`, 6, 7 e 10; o total foi o mesmo na R2A e na R3 | O pool só cria worker quando não há um ocioso para aquela função e só encerra os ociosos ao recarregar o código ou sair (`lib/emulator/functionsRuntimeWorker.js:242-268, 284-308`). No `firebase-debug.log` do W da R3 (fim do `verify:all`, 20:22:55) há 96 `addWorker(`, 7 deles de `getFinancialReport`; no da R2A, 96 e 6. Os 98 e 10 do gate vêm do parecer dele | Confere. "Não encerra os ociosos" vale para uma execução sem recarga de código, que é o caso do E2E |
| 8 | `testes-e-resultados.md:102`, mesmo texto do RR-R3-11 | Diff de uma frase | Confere |

## Matriz de evidência

| § | Seção | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Ambientes DEV/STAGING/PROD | PASS (escopo da R3) | Nenhum script, CI ou default novo. Nenhuma linha nova cita o projeto de produção. O isolamento de ambientes é herdado (fora do escopo; ver PLAT-R4-I1) |
| 2 | App Check | Fora do escopo | Não tocado |
| 3 | Security Rules e índices | PASS | A condição de ordem cobre Rules e índices, com o efeito de Rules anteriores declarado corretamente (itens 1 a 5). A configuração versionada e o gate `predeploy:rules` são os da rodada 1 |
| 4 | Cloud Functions | PASS | Sem mudança (inventário da rodada 1) |
| 5 | IAM | Fora do escopo | Não tocado |
| 6 | Segredos | PASS | Linhas acrescentadas desde `ad1660a3`: 0 com chave do Google, Stripe, webhook ou chave privada. Em todo o `docs/` atual, 0 arquivo com o padrão de chave do Google. As ocorrências antigas em `FIREBASE_PRODUCTION.md` e no plano são todas valores de exemplo (o prefixo de chave de teste do Stripe ou o de segredo de webhook, seguido da palavra "placeholder"), iguais às da rodada 3. As sondas novas (`sonda-r3-liberacao.test.mts`, `sonda-r3-marca-intocada.cjs`, `sonda-r3-ordem-p8.cjs`) não iniciam o Admin SDK contra projeto nenhum, não usam rede e trabalham com funções puras e dados sintéticos |
| 7 | Authentication | Fora do escopo | Não tocado |
| 8 | Hosting | Fora do escopo | Não tocado |
| 9 | Custos e quotas | Fora do escopo | O custo da liberação por volta da projeção (R3-M1) é tema de `firestore-scale-cost-review` e está no RR-R3-09. Os tetos de instância não mudam |
| 10 | Monitoramento de plataforma | Fora do escopo | P7 |
| 11 | Backup, PITR e restore | PASS (texto da R3) | `BACKUP_RESTORE_DR.md` sem mudança. O R3-I4 de escala confirma os 9,3 h do passo 8 nas duas páginas |
| 12 | Emulator | PASS | O RR-R3-11 descreve corretamente o pool de workers (item 7). Nenhum teste lê `docs/`, salvo a varredura de segredos (0 ocorrência). O único `.test.mts` novo, em `docs/`, não é encontrado por nenhum executor: todos os `node --test` têm lista explícita, o Playwright usa `./e2e` e os testes das Functions usam `functions/lib` |
| 13 | Registro de configuração externa | Fora do escopo | Nenhum item externo novo |

## Configuração externa pendente

Sem mudança: E-01, E-02, E-03, E-04, E-05, E-07, E-08 e E-12, todos em `FIREBASE_PRODUCTION.md` §16 como `NÃO VERIFICADO`, e a rotação da chave Gemini (PR-AI-02/E-00). A R3 não acrescenta item.

## Achados bloqueantes

Nenhum.

## Observações (INFO; nenhuma é falha do escopo)

- **PLAT-R4-I1 — Os scripts citados na condição de implantação continuam fixos em produção.**
  - `deploy:firestore` e `deploy:safe` (`package.json:38, 40`) têm o projeto de produção como destino fixo. Isso é herdado (PR-PLAT-01/E-01, P6).
  - A citação é factual e não muda isso: nenhum agente executa `deploy:*`, e a D-ORD-04 (plano `:602`) proíbe publicar artefatos da P1 a P5 antes do fim da P6.
  - A condição de ordem vale para qualquer forma de publicação, inclusive o CD da P6 (RB-T01). Executar `deploy:functions` sozinho antes de `deploy:firestore` violaria a ordem, e o texto já diz "antes das Functions, ou junto".
- **PLAT-R4-I2 — Alcance de "Rules anteriores".**
  - A frase vale para as Rules do HEAD e da R2A, que têm a mesma regra genérica.
  - Um ambiente com Rules de antes da P1 teria efeito diferente. A D-ORD-04 impede publicar Functions da P1 a P5 sobre Rules tão antigas, e nada foi publicado.
  - Sem ação.
- **Nome do arquivo no `revisoes/LEIAME.md`:** a linha da rodada 4 cita `obs-plataforma/PARECER-RODADA-4.md`, mas os arquivos são este e `PARECER-OBSERVABILIDADE-RODADA-4.md` (R4-I3 do parecer de observabilidade). Corrigir ao preencher o marcador.

**Estado dos anteriores:**
- PLAT-I1: mantido. As sondas novas não acessam Firestore, então não precisam de guarda.
- PLAT-I2, PLAT-I3, PLAT-I4 e PLAT-R3-I1: resolvidos. O PLAT-I3 foi estendido às Rules pelo R3-I2 de segurança.
- PLAT-I5: mantido, como ponto positivo.

## Fora do escopo desta avaliação

| Item do checklist | Motivo | ID do plano |
| --- | --- | --- |
| Projetos DEV/STAGING/PROD isolados; `default` diferente de PROD; `deploy:*` sem produção fixa | Herdado; P6 | PR-PLAT-01, E-01 |
| Deploy de Rules e índices só por pipeline com gate; versão implantada por ambiente | Herdado; P6 | PR-REL-01, E-12 |
| App Check no cliente e enforcement | P6 | PR-APPCHK-01, D-33, E-02 |
| `concurrency` declarada | Herdado; P6 | P6 (§8) |
| IAM, Secret Manager por ambiente, Authentication, Hosting e headers | P6 | E-03, E-04, E-05, PR-PLAT-03 |
| Rotação da chave Gemini | Ação externa herdada da P0 | PR-AI-02, E-00 |
| Budget, quotas, interruptor e monitoramento de plataforma | P7 | E-08, PR-OBS-02 |
| PITR, backups agendados, delete protection e restore ensaiado | P7, repetido na P10 | PR-BKP-01, E-07 |
| Execução da reconstrução por operador em DR | P7 | PR-ADMIN-01 |

## Condição de reconferência

Este parecer vale para a árvore de documentos `99817712` com o código `377c2f3f`.

**Nenhuma das mudanças previstas exige reconferência**, desde que:
- a cópia deste parecer pelo `copiar-pareceres.sh` seja idêntica ao original (ele não tem caminho temporário);
- os marcadores e as linhas do plano, do `revisoes/LEIAME.md` e da matriz registrem com fidelidade o veredito "PASS no escopo da R3", estes INFO e o nome real do arquivo;
- nenhuma outra frase desta superfície mude. Isso inclui:
  - a condição de implantação e os itens de restauração;
  - o rollback, o RR-R3-11 e a linha de plataforma do plano;
  - o §5 de `FIREBASE_PRODUCTION.md`;
  - `BACKUP_RESTORE_DR.md`.

**Exigem reconferência:**
- qualquer mudança fora de `docs/`, como configuração, scripts, Rules, índices ou código;
- qualquer mudança em `FIREBASE_PRODUCTION.md` ou `BACKUP_RESTORE_DR.md`;
- uma sonda nova em `docs/` que inicie o Admin SDK ou acesse a rede.

## Verificação

Somente leitura. Não usei Emulator, build nem `deploy`, não acessei projeto remoto e não li segredos. As correspondências de padrões de segredo foram mostradas mascaradas, e a conferência de que são exemplos foi feita por comparação, sem imprimir o valor.

1. **Árvores:** índice temporário próprio (`sandbox/r4/`) → `99817712`, duas vezes. Diff fora de `docs/` contra `377c2f3f`: vazio. `--name-status` de `ad1660a3` → `99817712`: 17 arquivos, todos em `docs/`.
2. **Diffs:** `FIREBASE_PRODUCTION.md` (1 linha); plano (`sandbox/r4/diff-plano.patch`), com comparação byte a byte do rollback, dos itens de restauração, do RR-R3-01, do subitem de DR do RR-R3-09 e da linha de plataforma; `testes-e-resultados.md` (1 frase).
3. **Configuração lida:**
   - `package.json:36-42`;
   - `firestore.rules` da R2A e do HEAD (`:42-46, 66-68, 401-455, 1148-1154`) e de `377c2f3f` (`:459, 818-822`);
   - `firestore.indexes.json:1440-1469`;
   - `playwright.config.ts:39`;
   - scripts de teste de `functions/package.json`.
4. **`firebase-tools` 15.32.1 instalado:**
   - `lib/deploy/index.js:30-42, 172-197`;
   - `lib/filterTargets.js:6-17`;
   - `lib/deploy/firestore/deploy.js:10-52` e `release.js:5-18`;
   - `lib/deploy/functions/release/index.js:22, 80-89`;
   - `lib/firestore/api.js:122-160`;
   - `lib/emulator/functionsRuntimeWorker.js:228-320`.
5. **Contagens nos `firebase-debug.log` dos W da R3 e da R2A:** só linhas com `addWorker(`, sem imprimir conteúdo.
6. **Buscas:**
   - projeto de produção nas linhas acrescentadas;
   - padrões de segredo nas linhas acrescentadas e em todo o `docs/`;
   - scripts com `node --test` sem arquivos;
   - `initializeApp`, `projectId`, rede e credenciais nas três sondas novas.
