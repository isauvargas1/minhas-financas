FAIL — Financial domain integrity

# Parecer de integridade do domínio financeiro — P5-F.1-R3 (B03, marcas de aplicação, e RR-R2A-04)

Revisor independente, adversarial, só leitura. O revisor não alterou nenhum arquivo do WT nem do repositório, não fez commit nem push, não usou Firebase real e não subiu o Emulator.

**Veredito em uma frase.** Não encontrei caminho para prova verdadeira com valor errado na árvore final. O desenho das marcas, a cerca da reconstrução com a correção A01 e a prova do cliente com a defesa A02 resistiram à leitura do código e a quatro sondas próprias com as funções reais: 0 violações em cerca de 90 mil provas verdadeiras do modelo de ponta a ponta, que acha o A01 quando a correção é retirada. A poda das marcas, acrescentada no gatilho às 19:21, também passou. O **FAIL** vem só da evidência de verificação (F-01, MEDIUM). O gatilho mudou às 19:21, depois de toda a evidência de Emulator e E2E do executor. Os testes de unidade da poda chegaram às 19:24, mas a integração das marcas e as suítes de integração do escritor financeiro não rodaram na árvore final. Os E2E do cliente final também não rodaram completos, e o `verify:all` está pendente. A política do gate não aceita PASS sem essa evidência.

**Árvore revisada.**
- WT: `<scratchpad>/wt-p5f1-r3`.
- Árvores: partida R2A `f82679226ec93e18f906731be09d0675326fd764`; leitura completa do código financeiro em `36d51950408482e86badee37652d0e20db986236` (18:56 UTC); **árvore final revisada** `9961d45badb40bfdc9f6c1cafb1b590def9de5d5` (19:27 UTC).
- Entre as duas árvores, no código financeiro, só mudou a poda das marcas no gatilho (`pruneMarkDoc`, 19:21; ordem do import ajustada às 19:24): `functions/src/cash/projectionMarks.ts:497-520` e `functions/src/cash/periods.ts:1401-1406`. Às 19:24 vieram os testes dela em `projectionMarks.test.ts`. Também revisei essa mudança (F-01, item 1, e sonda F3 com poda).
- Fora do código financeiro mudaram o texto de `ESTIMATE_UPDATING` em `messages.ts`, testes novos de pt-BR e de Rules, o E2E B03 e o `package.json`.
- SHA-256: `hashes-revisados.txt` (18:56), `hashes-poda.txt` (19:21), `hashes-poda-2.txt` (19:24) e `hashes-final.txt` (21 arquivos, árvore `9961d45badb40bfdc9f6c1cafb1b590def9de5d5`, 19:27). Os demais arquivos financeiros não mudaram desde as 18:56.

Nas referências abaixo, os caminhos são relativos ao WT.

## Escopo

- **Fluxo coberto:** `transactions` → `onTransactionWrite` → `applyCashPeriodWriteOnce` (delta mensal, marca de entrega, marca de aplicação, etiqueta `projectionGeneration`) → `cash_report_periods` → reconstrução (`rebuildCashPeriods`: corte, varredura com âncoras, publicação com troca de posição e recomeço `post_cutoff_event_missed_staging`) → leitura da estimativa no cliente (transação só de leitura de meses e marcas, leitura por id com impressão digital, prova, exclusões, estimativa).
- **Armazenamento novo:**
  - `workspaces/{ws}/cash_projection_marks/{transactionId}`;
  - campo `projectionGeneration` nos meses;
  - campos `markSlot`, `markRecoveryNeeded`, `markIssue*` e `lastMarkIssue*` em `cash_period_events/projection_state`;
  - checkpoint da reconstrução na versão 3, com `markSlot`.
- **Cálculos afetados:** nenhum valor de ledger, saldo, delta em centavos ou arredondamento mudou. A estimativa tira, mês a mês, a contribuição do lançamento desconsiderado para o `incomeCents` oficial (`incomeBasis.ts`, sem mudança na R3). O que mudou foi a condição para essa subtração aparecer convertida.
- **Relatórios:** releitura do relatório do Dashboard (RR-R2A-04, `src/modules/reports/queryKeys.ts:80-133` e `hooks.ts:138-180`). A mudança só afeta quando reler; nenhum valor é calculado no cliente.
- **Substituição:** a regra 5 da R1/R2A (escritas pendentes por `updatedAt` com espera limitada e `expired`) foi substituída pela prova por marcas.
- **Migração:** não há (sem dados reais, política de legado).
- **PF/PJ:** sem mudança. A fonte PJ continua exigindo `allowBusinessIncome` (`src/modules/work-time/estimate.ts:159-162`). As marcas são por workspace e não carregam natureza PF/PJ.

## Mapa de autoridade

| Figura / registro | Fonte oficial | Escritores | Fronteira confiável |
| --- | --- | --- | --- |
| `cash_report_periods/{AAAA-MM}` (`incomeCents`, demais campos em centavos e `projectionGeneration`) | `transactions` (ledger) | (1) Gatilho: `writeCashPlan` na transação do delta, da marca de entrega e da marca de aplicação (`functions/src/cash/periods.ts:1373-1426`; etiqueta em `:861`). (2) Publicação da reconstrução: meses e órfãos com a etiqueta nova, num commit (`functions/src/cash/rebuild.ts:1585-1614`) | Admin SDK. Rules `write: false` (`firestore.rules:792-799`). A busca em `functions/src` fora de testes não acha outro escritor. `applyCashPeriodWrite` (`periods.ts:931`) só é usado em `periods.integration.test.ts` |
| `cash_projection_marks/{id}` (impressões e geração, sem valor) | Derivada: o que a projeção contém de cada lançamento | (1) Gatilho: `set` sem merge do documento inteiro lido na mesma transação, só com as componentes da geração vigente e da preparada (`periods.ts:1384-1406`; `pruneMarkDoc` em `projectionMarks.ts:505-520`). (2) Commit da página da varredura: `set` com merge só de `anchors.{posição}`, na transação que avança o cursor (`rebuild.ts:1262-1277`) | Admin SDK. Rules: `get` de membro ativo; `list`, `create`, `update` e `delete` falsos; coleção em `isBackendOwnedCollection` (`firestore.rules:459,818-822`) |
| `projection_state.markSlot` e `markRecoveryNeeded` / `markIssue*` | Estado operacional da projeção | Checkpoint (preparação, `rebuild.ts:375-384`); publicação (`rebuild.ts:1615-1636`); gatilho, só quando uma cadeia passa a `broken` (`periods.ts:1407-1413`, `markIssuePatch` em `:1194-1213`) | Admin SDK; `cash_period_events` com `read, write: false` |
| Marca de entrega (`categoryGenerations`, usada pela conferência A01) | Idempotência do gatilho | Só o gatilho (`periods.ts:1417-1426`) | Admin SDK |
| Estimativa (valor da hora) | Derivada em memória: relatório oficial menos as desconsideradas | Nenhum: não é persistida (`useIncomeEstimateWith.ts:274-328`) | O cliente só lê. Guarda de "nenhuma escrita" em `projectionReads.ts` (`tests/unit/work-time-guard.test.ts`) |
| `transactions` | É a fonte | Só callables e espelhos do backend | Rules `create, update, delete: false` (`firestore.rules:618-621`). Sem mudança na R3 |

Nenhum segundo escritor nem segunda fonte de receita. As marcas não têm valor e não substituem a projeção. A prova só decide se a subtração da projeção oficial pode ser exibida.

## Semântica dos movimentos

A R3 não cria nem reclassifica movimento. A estimativa usa a contribuição de cada lançamento para `incomeCents`, com a mesma ordem de decisão do backend. As referências são `incomeBasis.ts:67-87` no cliente e `periods.ts:270-360` no backend.

| Movimento | Efeito em `incomeCents` | Na estimativa |
| --- | --- | --- |
| Receita comum liquidada | +valor | Excluível; tira o valor no mês de `date` |
| Pendente ou agendada (`isPaid: false` ou `cashEntry.status: pending`) | 0 | Ignorada |
| Anulada (`voidedAt`) | 0 | Ignorada |
| Despesa | 0 | Ignorada |
| Recebimento de recebível | +principal; juros e multa vão para `financialIncomeCents` | Excluível pelo principal |
| Estorno do recebimento | −principal, no mesmo mês e na mesma data | Com o estorno confirmado na projeção, o par soma zero e a exclusão não tira nada (`incomeBasis.ts:126-146`) |
| Estorno na projeção sem o recebimento | — | Recusa (`projectionProof.ts:363`) |
| Empréstimo (principal e juros), pagamento de fatura, divisão de contas, investimento (aporte, resgate e rendimento) | 0 | Ignorados |

Nada disso move caixa, ativo, passivo, principal, rendimento realizado ou valorização: é leitura derivada.

## Matriz de evidências

| Seção do checklist | Estado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | <ul><li>As marcas não têm valor nem data civil (`projectionMarks.ts:150-192`).</li><li>Os meses continuam em centavos inteiros por `FieldValue.increment` (`periods.ts:841-866`).</li><li>Corte e geração são `Timestamp` do servidor (`rebuild.ts:308,1588`; `periods.ts:1082-1087`).</li><li>O mês vem de `date.slice(0, 7)` nos dois lados (`periods.ts:377-379`; `incomeBasis.ts:128`; a normalização exige `isDayKey`).</li><li>Nenhum ponto flutuante.</li></ul> |
| Semântica financeira | PASS | <ul><li>Classificação sem mudança. Paridade pela fixture compartilhada (15 casos).</li><li>Sonda F1: 200.000 documentos sorteados, 18.729 aceitos pelo backend, 5.196 normalizados pelo cliente e comparados, **0 divergências** entre `cashPeriodDeltaFor(...).incomeCents` e `classifyIncomeDocument(normalizeTransactionData(...))`.</li><li>A regra do par recebimento/estorno foi conferida no modelo F3.</li><li>PF/PJ sem mudança.</li></ul> |
| Autoridade e atomicidade | PASS | <ul><li>A marca muda na mesma transação do delta e da marca de entrega (`periods.ts:1373-1426`). A âncora é gravada na transação da página (`rebuild.ts:1248-1287`). Etiqueta e meses vão no mesmo `set` (`periods.ts:841-866`) e no commit da publicação.</li><li>Rules no Emulator: 6/6 às 18:32 (a diferença para as Rules finais é só um comentário, conferida por `diff`) e 17/17 às 19:13 (`rules-marcas-oficial-3.log`, com a suíte de ataques nova).</li><li>Falha injetada dentro da transação: não sobra marca nem delta (integração 4).</li></ul> |
| Operações críticas e eventos | PASS no desenho; evidência final parcial (F-01) | <ul><li>Reentrega encontra a marca de entrega e não reescreve a marca de aplicação (`periods.ts:1315-1321`; integração 3).</li><li>Fora de ordem: até 16 pendências, depois `broken` com registro (`projectionMarks.ts:315-356`; integração 2 e 6).</li><li>Cerca do corte e recomeço A01 (`rebuild.ts:1106-1112`; integração 9).</li><li>Concorrência: 6 entregas paralelas e lançamentos paralelos (integração 3).</li><li>A corrida entre a âncora cega e o `set` do gatilho não tem teste intercalado (F-02).</li></ul> |
| Histórico e auditabilidade | PASS | <ul><li>Nenhum fato financeiro é apagado ou reescrito.</li><li>Marcas são metadado operacional.</li><li>Incidente de marca registrado no estado e no log `cash_projection_mark.broken` (`periods.ts:1194-1213`; `triggers/transactions.ts:307-313`).</li><li>O sinal não tem leitor (F-05).</li></ul> |
| Fontes, totais, projeções e relatórios | PASS (com F-03 e F-05, LOW) | <ul><li>Fonte oficial única.</li><li>A projeção e as marcas são reconstruíveis a partir de `transactions`. A publicação etiqueta todos os meses e órfãos e troca a posição das marcas (`rebuild.ts:1585-1636`).</li><li>Propriedade INV-M: 4.000 cenários e 79.796 conferências (minha execução).</li><li>A prova recusa geração ausente ou mista, bases diferentes, pendência, quebra e conteúdo diferente (`projectionProof.ts:339-368`).</li><li>O relatório do Dashboard só ganhou critério de releitura.</li></ul> |
| Substituição de domínio e remoção de legado | PASS no código; documentação pendente (F-06) | <ul><li>Regra 5 antiga removida (busca abaixo). Guarda: `tests/unit/work-time-guard.test.ts:471-476`.</li><li>Campos da proposta R2A (`appliedVersion`, `monthCommits`) nunca implementados (busca vazia).</li><li>Sem migração nem compatibilidade.</li><li>A condição de implantação sobre dados existentes está no desenho §10 e no runbook de DR (`docs/production/BACKUP_RESTORE_DR.md:52,117,123`). Não está no plano mestre.</li></ul> |
| Migração com dados reais | N/A | Não há dados reais (política de legado, `CLAUDE.md`, plano §1); a R3 não migra nada |
| Testes obrigatórios | FAIL (F-01) | <ul><li>Criação, edição, anulação, exclusão, mudança de mês, retry, duplicidade, concorrência, atomicidade e reconstrução com marcas: integração 14/14 (`int-copia-marcas-fix-3.log`, 18:47, cópia com o mesmo SHA-256 do código das 18:37, anterior à poda das 19:21).</li><li>Autoridade: Rules 17/17.</li><li>Cliente: 211/211 e 107/107 (minha execução).</li><li>**Na árvore final, faltam:**<ul><li>a integração das marcas no Emulator com a poda: só a unidade e a propriedade a cobrem, 676/676 na minha execução;</li><li>as 7 suítes de integração do mesmo escritor (cerca, períodos, recuperação, categorias, D29, mutação, acesso ao relatório; 108 testes), rodadas antes da última mudança de `periods.ts`;</li><li>os E2E de tempo de trabalho completos: o B03-b falhou às 19:16 e o `work-time-p5f`, com o estorno real por callable, rodou só às 17:50;</li><li>o `verify:all`.</li></ul></li></ul> |

## Reconciliação

**Fórmula provada.** Numa transação só de leitura no instante *t*: os meses *m* da janela, todos com a geração *G*, e as marcas. Para cada desconsiderada T, com o estorno R_T quando T é recebimento:

> elegível[m] = `incomeCents`(P_G(t), m) − contrib(T@fp)[m] − contrib(R_T@fp)[m]

com `fp` igual ao nó da marca de T (e de R_T) em *t*, sem pendência. Pela INV-M, a parte de T em P_G é efeito(nó) + Σ pendências. Com pendência zero, a parte de T é exatamente o efeito do conteúdo lido. A base do relatório tem de ser igual aos meses da transação (`projectionProof.ts:348-351`) e à escuta (regra 3, `consistency.ts:61`).

**Controle de dupla contagem.**
- Marca de entrega por evento.
- Cerca do corte (`covered_by_rebuild`, `ambiguous_delete`).
- A publicação soma só entregas `applied` posteriores ao corte que alimentaram a geração preparada (A01).
- O par recebimento/estorno soma zero.
- Um lançamento sem marca, ou com marca ausente e encontrado na leitura por id, recusa (A02).

**Comparação independente** (sonda F3, oráculo que não usa as marcas: soma das entregas aplicadas por lançamento, recalculada na publicação; o próprio oráculo confere Σ partes = mês a cada leitura):

| Variante | Cenários | Leituras | Provas verdadeiras | Violações |
| --- | ---: | ---: | ---: | ---: |
| Código das 18:37 (sem poda), semente 11 | 3.000 | 14.121 | 6.249 | **0** |
| Código das 18:37 (sem poda), semente 101 | 8.000 | 37.540 | 16.898 | **0** |
| Código das 18:37 (sem poda), ABA (sem `updatedAt`), semente 202 | 8.000 | 37.355 | 16.453 | **0** |
| Código das 18:37 (sem poda), semente 303 | 8.000 | 37.607 | 16.746 | **0** |
| Código final (19:21, com a poda), semente 404 | 8.000 | 37.736 | 16.805 | **0** |
| Código final (19:21, com a poda), ABA, semente 505 | 8.000 | 37.442 | 16.413 | **0** |
| Sem a conferência A01 da publicação (sensibilidade; com e sem poda) | 3.000 | 13.801 | 5.450 | **2**: o caso A01, com a leitura por id anterior à criação |

As provas recusadas se distribuem entre `content`, `mark_pending` e alguns `mark_broken`. Detalhe em `sonda-f3-*.log`.

## Retentativa e concorrência

- **Idempotência.** A marca de entrega (hash do `event.id`) é criada na mesma transação do delta e da marca de aplicação. A reentrega devolve `duplicate` e não reescreve a marca (`periods.ts:1315-1321`; integração 3, que confere o `updateTime` da marca).
- **Falha parcial.**
  - Exceção dentro da transação: nada muda.
  - Falha depois do commit, na trilha: a reentrega é `duplicate` (integração 4).
  - Janela de retry esgotada ou violação de contrato: `needsRebuild`, o relatório deixa de ser exato (`functions/src/reports/report.ts:255`), a estimativa fica indisponível e a cadeia fica sem prova até a reconstrução (integração 5).
- **Corridas.**
  - Gatilho × publicação: serializados pela leitura e escrita de `projection_state` nas duas transações.
  - Entrega lida antes do commit do checkpoint, com commit depois do corte: recomeço `post_cutoff_event_missed_staging` (integração 9; sonda F3).
  - Leitura da página fora da transação × entrega posterior ao corte: raiz `event` conferida com a âncora (integração 10; F3 com páginas de 1, 2 e 4).
  - Cliente: a transação só de leitura do SDK web gera `VerifyMutation` para cada documento lido e repete até 5 vezes. Meses e marcas valem no mesmo instante (sonda da R3 e parecer de arquitetura, item 9).
  - Âncora gravada sem ler a marca × `set` sem merge do gatilho: depende do isolamento de transação do Firestore, sem teste intercalado (F-02).
- **Visão do cliente × backend** (sonda F2): 300.000 documentos de marca realistas, com gerações alternando de posição, preparações abandonadas e restos de gerações antigas. Em 155.066 visões "enraizada e sem pendência" do cliente, **0** casos em que o backend diz outra coisa: o cliente nunca é menos conservador.

## Remoção de legado

- **Substituído:** a regra 5 da R1/R2A (`inherentWritesOf`, `observeExcludedRead`, `pendingWriteKey`, `unappliedWrites`, `PendingWrite`, `ExcludedObservation`, `bounded`, `expired`, motivo `projection_pending`).
- **Busca** em `src`, `tests`, `e2e` e `functions/src`:
  - nenhuma ocorrência no código de produção;
  - em `tests/unit/work-time-consistency.test.ts:133-140`, os campos antigos só aparecem como entrada ignorada, num teste que prova que eles não aprovam;
  - `ESTIMATE_PENDING_WAIT_MS` ficou só como tempo de interface. A guarda prova que não entra na prova (`work-time-guard.test.ts:471-480`).
- **Proposta R2A:** `appliedVersion` e `monthCommits` não aparecem em lugar nenhum.
- **Rules, índices e Functions:** nada órfão. A coleção nova não tem índice composto. A suíte `test:rules:projection-marks` entrou no `test:integration:emulator` e no `predeploy:rules` (`package.json`).
- **Documentação:** `DATA_MODEL`, `ARCHITECTURE`, `SECURITY_MODEL`, `DATA_RETENTION_LIFECYCLE` e `BACKUP_RESTORE_DR` foram atualizados. O plano mestre ainda não tem a seção da R3 (F-06).

## Achados

### Bloqueante

**F-01 — MEDIUM — evidência de verificação desatualizada ou incompleta na árvore final.**

- **Invariante:** o gate só aprova com evidência da árvore atual. A política da skill diz que evidência ausente é FAIL e que lacuna de verificação bloqueia o PASS.
- **Fatos:**
  1. **O gatilho mudou às 19:21:00**, depois de toda a evidência de Emulator e E2E do executor: a marca regravada passa a guardar só as componentes da geração vigente e da preparada (`pruneMarkDoc`, `functions/src/cash/projectionMarks.ts:505-520`; chamada em `functions/src/cash/periods.ts:1401-1406`). Às 19:24, o executor acrescentou em `functions/src/cash/__tests__/projectionMarks.test.ts`:
     - o teste de unidade "poda (L-PRI-02)";
     - a poda no simulador da propriedade INV-M, com asserção de que a âncora da preparada sobrevive às entregas.

     Na minha execução, a suíte deu 676/676 e a propriedade fez 954 podas, com as demais estatísticas idênticas. Nenhum teste de integração no Emulator exercita a poda, e a integração das marcas não foi reexecutada depois dela. Pela minha análise, a poda é segura:
     - na transação do gatilho, estado e marca são lidos juntos (`getAll`, `periods.ts:1313-1314`). Por isso a âncora de uma preparação só aparece na marca lida se o estado lido já registra essa preparação, como vigente ou em preparação;
     - o cliente só usa a geração dos meses, e a publicação etiqueta todos de uma vez;
     - a regra `superseded` só depende de componentes da preparação, que ficam.

     A sonda F3 com a poda deu 0 violações em 33.218 provas verdadeiras e continua achando o A01 sem a correção. Isso não substitui a reexecução da integração das marcas no Emulator (14 testes, última às 18:47).
  2. As 7 suítes de integração do mesmo escritor financeiro rodaram às 18:25–18:27 (`logs/int-copia-cash-fix-1.log`, 108/108): `rebuildFence`, `periods`, `projectionRecovery`, `categoryLink`, `d29Lifecycle`, `mutateTransaction` e `financialReportAccess`. Foi antes da correção A03 em `functions/src/cash/periods.ts`, gravada às 18:30:29 e que mudou `applyCashPeriodWriteOnce` (`periods.ts:1384-1413` na numeração final). Depois disso, só a suíte das marcas foi reexecutada (14/14, 18:47).
  3. O E2E `work-time-p5f.spec.ts` rodou pela última vez às 17:50 (`t1.log`), antes de A01 (18:25), A03 (18:30) e A02 (18:35). É o único com recebimento e estorno reais por callable (`e2e/work-time-p5f.spec.ts:1262-1294`).
  4. O E2E `work-time-b03.spec.ts` rodou às 19:14–19:16 (`logs/r3-b03-teclado.log`): 4 passaram e o B03-b falhou na etapa de teclado (`e2e/work-time-b03.spec.ts:399`, chamada em `:435`). A conferência final dele, "nenhum valor convertido sem prova" (`:467-470` na numeração atual), não chegou a rodar. As linhas `:399` e `:435` são as da execução das 19:16; o arquivo mudou depois. A reexecução só do B03-b, às 19:17–19:18 (`logs/r3-b03-teclado-2.log`), passou (1/1), ainda antes da poda das 19:21.
  5. `docs/production/evidence/p5f1-r3/testes-e-resultados.md` ainda tem os marcadores `[[EXECUCOES]]`, `[[VERIFY]]` e `[[COMPARACAO]]`. O `verify:all` final não foi registrado.
- **Cenário de falha:** uma regressão do gatilho passaria sem ser vista, seja em cerca, recuperação, D29 ou mutação (pela mudança das 18:30), seja na interação poda × âncora × publicação (pela mudança das 19:21). O mesmo vale para uma regressão do cliente final no fluxo de estorno.
- **Risco técnico estimado: baixo.**
  - A mudança das 18:30 só grava o estado quando uma cadeia passa a `broken`, e nenhuma das 7 suítes referencia marcas (busca).
  - A poda só remove componentes de gerações que ninguém mais lê.
  - A política, porém, não aceita a estimativa no lugar da execução.
- **Remediação:** sem mudança de código financeiro.
  - A unidade da poda já existe (19:24). Falta um caso de integração no Emulator: âncora → evento → publicação → evento → visão do cliente igual à anterior, com a âncora da preparada preservada.
  - Rodar na árvore final, com os SHA-256 de `hashes-final.txt` (ou os novos, se o código mudar de novo), e registrar com horário e árvore:
    - as 14 de integração das marcas;
    - as 7 suítes de integração do escritor;
    - `test:rules:projection-marks`;
    - `work-time-b03` (os 5 testes até o fim) e `work-time-p5f`;
    - de preferência, o `verify:all` completo.

  Com tudo verde, este parecer passa a PASS sem outra condição de código.

### Não bloqueantes

**F-02 — LOW — corrida entre a âncora da varredura e o `set` sem merge do gatilho, sem teste determinístico.**
- **Onde:** `functions/src/cash/rebuild.ts:1266-1276` (âncora com merge, sem ler a marca) e `functions/src/cash/periods.ts:1384-1406` (o gatilho lê a marca e regrava o documento inteiro).
- **Premissa:** a correção depende do isolamento da transação do Firestore. A marca foi lida pelo gatilho, então a escrita da página espera ou aborta (comentário em `projectionMarks.ts:478-482`). Nenhum teste pausa a transação do gatilho (`faults.insideProjection`) enquanto a página faz o commit.
- **Cenário, se a premissa falhar:**
  - a âncora da geração nova se perde;
  - o lançamento passa a ser visto como "fora da base";
  - com o lançamento encontrado pela leitura por id, `content` recusa;
  - o próximo evento fica pendente para sempre.

  Pela minha análise, o efeito é fail-closed, sem prova falsa.
- **Remediação:** teste de integração intercalado (pausar dentro da transação do gatilho e fazer o commit da página no meio), ou ler a marca no commit da página.

**F-03 — LOW — a geração não carrega a versão da regra de efeito.**
- **Onde:** `functions/src/cash/periods.ts:823-835,861`; `src/modules/work-time/projectionProof.ts:306-315`.
- **Premissa e falha:** a prova supõe que conteúdos iguais têm o mesmo efeito. Isso só vale com a mesma `cashPeriodDeltaFor` no backend e a mesma `classifyIncomeDocument` no cliente. Uma mudança futura de regra (como a D-29), ou uma implantação de Functions e Hosting fora de passo durante essa mudança, deixa a projeção com contribuições calculadas pela regra antiga. Nesse caso a marca diz "vivo@fp", o cliente tira a contribuição pela regra nova e a prova sai verdadeira com o valor errado até a reconstrução.
- **Procedimento:** não está documentado no desenho nem no plano.
- **Remediação:** incluir uma versão da regra de efeito em `projectionGeneration` (constante comum ao backend e ao cliente, com fixture) e exigir igualdade no cliente. Alternativa: registrar no plano que toda mudança de regra exige reconstrução de todos os workspaces antes de publicar o cliente.

**F-04 — LOW — a leitura por id acontece antes da transação de leitura.**
- **Onde:** `src/modules/work-time/useIncomeEstimateWith.ts:221-230`, com `readExcludedIncome` e depois `readProjectionMarks`.
- **Limite:** a defesa A02 (`projectionProof.ts:333`) só vê o lançamento se ele já existia na leitura por id. Sem a correção A01 do backend, a sonda F3 achou exatamente 2 violações nesse modo (leitura anterior à criação); o parecer de arquitetura achou o mesmo.
- **Hoje:** com A01, não há contraexemplo. A janela continua sendo o único ponto em que a prova depende de duas leituras em instantes diferentes.
- **Remediação (defesa em profundidade):** ler os lançamentos desconsiderados e os espelhos na mesma transação só de leitura (até 100 `get`, dentro do teto de mutações de verificação), ou pelo menos depois dela.

**F-05 — LOW — recuperação sem sinal nem caminho no produto.**
- **Onde:** `markRecoveryNeeded` não tem leitor (busca em `src` e `functions/src`). `rebuildCashPeriods` não tem interface montada (`docs/production/BACKUP_RESTORE_DR.md:51`).
- **Pendência permanente sem registro:** exclusão física e recriação, ou predecessor perdido (`projectionMarks.ts:236-249`).
- **Cenário:** a estimativa fica para sempre "em atualização", em reais, e ninguém é avisado. Para `content` e `mark_pending`, o agendador relê dentro do orçamento.
- **Efeito financeiro:** fail-closed, sem valor errado. Confirma o A04 da arquitetura.
- **Remediação:** expor o sinal a owner/admin e registrar a pendência mais antiga que passar da janela de entrega (P7, observabilidade).

**F-06 — LOW — documentação da etapa incompleta e afirmação inexata.**
- **O que falta:** a seção §20.18 da R3 no `docs/production/PRODUCTION_READINESS_PLAN.md` (última gravação às 16:26). No plano, o B03 segue "aberto" pela §20.17.
- **Afirmação inexata:** o desenho (`docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md`, §10) e `revisoes/respostas-revisao-arquitetura-1.md` (A04 e A05) dizem que a §20.18 existe.
- **Por que importa:** é lá que fica a condição de implantação sobre dados existentes (reconstruir antes do uso).
- **Remediação:** escrever a §20.18 com estado, riscos (F-02 a F-05) e a condição de implantação; preencher os marcadores de `testes-e-resultados.md`.

**F-07 — INFO — com conteúdo repetido (ABA), um evento posterior casa antes dos predecessores.**
- **Onde:** casamento por impressão (`projectionMarks.ts:231-234`).
- **Sonda F4:** com X→Y, Y→X e X→Y entregues na ordem e3, e1, e2, a cadeia fica limpa (nó Y, sem pendência) logo depois de e3, sem e1 nem e2.
- **Por que não é defeito financeiro:** a INV-M continua valendo, porque a parte de T na projeção é o efeito de Y. É inalcançável no produto, porque todo escritor grava `updatedAt`.
- **Registro:** diverge da letra do B03-02 ("evento posterior aplicado antes do predecessor deverá impedir a comprovação"), não da garantia.

**F-08 — INFO — retenção da última estimativa provada (desenho da R1, fora do delta).**
- **Onde:** `holdEstimate` (`useIncomeEstimateWith.ts:145-163`).
- **Comportamento:** enquanto o estado atual não é provado, mostra convertida a última estimativa provada da mesma identidade. O valor é consistente com um estado anterior e pode estar desatualizado; o aviso só aparece depois de 30 s (`:435-454`).
- **Registro:** a R3 manteve esse comportamento, e o E2E B03-a o assume.

**F-09 — INFO — modo "mês atual" com receita liquidada datada depois de hoje.**
- **Onde:** relatório parcial (Σ dias até hoje, `functions/src/reports/cash.ts:106-119,172-183`) contra o `incomeCents` do mês inteiro nos meses lidos (`projectionProof.ts:348-351`) e na escuta (regra 3).
- **Cenário:** com desconsideradas, nunca prova até a data passar.
- **Avaliação:** é conservador e a regra 3 já fazia isso desde a R1.

**F-10 — INFO — tipo desconhecido na impressão digital vira `contract_violation`.**
- **Onde:** `periods.ts:1375-1383`; `rebuild.ts:779-781`.
- **Efeito:** o lançamento sai da projeção (`needsRebuild`) e a reconstrução para.
- **Avaliação:** é fail-closed e inalcançável pelos escritores atuais (A07 da arquitetura). Registrar no contrato de `transactions`.

**F-11 — INFO — `applyCashPeriodWrite` exportado grava meses sem marca e com etiqueta `g0` por omissão.**
- **Onde:** `periods.ts:931-941`, com o padrão `INITIAL_PROJECTION_GENERATION` em `writeCashPlan` (`:910`).
- **Uso atual:** só em teste.
- **Risco:** um uso futuro em produção quebraria a INV-M. Recomenda-se torná-lo interno ao teste ou exigir a etiqueta explicitamente.

**F-12 — INFO — histórico de E2E.**
- **Falhas intermediárias registradas:**
  - `t2.log`: 5 falhas do B03;
  - `t3.log`: B03-b, tempo esgotado ao procurar o link "Dashboard" (`e2e/work-time-b03.spec.ts:240`);
  - `r3-b03-teclado.log`: B03-b, foco de teclado.
- **Pedido §11:** "uma falha intermitente não desaparece do histórico". Elas devem constar do relatório final mesmo com execuções verdes depois. Pelos logs, nenhuma delas foi valor convertido errado.

### O que a revisão procurou e não encontrou

- Prova verdadeira com:
  - geração mista ou ausente;
  - mês inexistente com parte não nula;
  - âncora de outra geração ou de preparação abandonada;
  - posição trocada;
  - pendência absorvível;
  - estorno sem recebimento;
  - recebimento sem estorno aplicado mas lido;
  - leitura por id antiga;
  - base coincidente;
  - cache do React Query na remontagem;
  - lançamento movido para fora da janela;
  - exclusão e recriação.

  Em todos os casos a prova recusa, ou a INV-M garante o valor.
- Poda (19:21) removendo componente de que a prova precisa: não encontrei.
  - Na transação do gatilho, estado e marca vêm do mesmo `getAll`: uma âncora da preparação vigente só existe se o estado lido já lista essa preparação.
  - A geração superada some só depois de a publicação etiquetar todos os meses.
  - A sonda F3 com a poda não teve violação.
  - Se o isolamento da transação falhasse, a âncora se perderia mesmo sem a poda (F-02).
- Valor de ledger, delta, arredondamento ou classificação alterado pela R3: nenhum. O diff do gatilho e da reconstrução só acrescenta marca, etiqueta, registro e recomeço. O orçamento da página passou a contar as âncoras (`rebuild.ts:802-811`), sem mudar os totais. O teste de 500 meses manteve as asserções (`rebuildFence.integration.test.ts:757-770`).
- Escritor financeiro novo no cliente: nenhum. `projectionReads.ts` só lê, numa transação sem escrita, e as Rules negam escrita.

## Verificação

**Executado pelo revisor** (saídas neste diretório: `<scratchpad>/p5f1r3/revisoes/financeiro/`):

| Comando | Resultado | Log |
| --- | --- | --- |
| `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test` nos 10 arquivos de `test:unit:work-time` | 211/211 | `unit-work-time-revisor.log` |
| idem, nos 7 arquivos de `test:unit:reports` | 107/107 | `unit-reports-revisor.log` |
| `npx tsc --noEmit` (raiz) | 0 erro | `tsc-revisor.log` |
| `flock …/wt-r3-runtime.lock npm --prefix …/functions run test:unit` (19:00, sem a poda) | 675/675; INV-M: 4.000 cenários, 79.796 conferências, 2.502 publicações, 1.995 recomeços | `functions-unit-revisor.log` |
| idem, às 19:22, com a poda e sem o teste dela | 675/675; INV-M idêntica (o simulador ainda não chamava a poda) | `functions-unit-revisor-2.log` |
| idem, às 19:25, com os testes da poda (19:24) | 676/676; "poda (L-PRI-02)" ok; INV-M com 954 podas e as demais estatísticas idênticas | `functions-unit-revisor-3.log` |
| Sonda F1, paridade de classificação (`sondas/sonda-f1-paridade-classificacao.mjs`) | 0 divergências em 5.196 comparações | `sonda-f1.log` |
| Sonda F2, visão do cliente × backend (`sondas/sonda-f2-visao-cliente-backend.mjs`) | 0 casos menos conservadores em 300.000 | `sonda-f2.log` |
| Sonda F3, mundo de ponta a ponta (`sondas/sonda-f3-mundo-recebivel.mjs`) | sem poda: 0 violações em 56.346 provas verdadeiras; com poda (`poda`): 0 em 33.218; 2 sem a correção A01 nas duas versões | `sonda-f3-*.log` |
| Sonda F4, ABA (`sondas/sonda-f4-aba.mjs`) | cadeia limpa com predecessores ausentes e INV-M preservada | `sonda-f4.log` |
| Busca de legado e de escritores (`grep` descrito acima) | sem resto | — |
| `diff` das Rules usadas no teste × finais; SHA-256 das cópias dos mutantes × WT | só comentário; código idêntico | `hashes-revisados.txt` |

As sondas usam o backend compilado em `functions/lib` (após a minha execução da suíte, dentro do lock) e os módulos TypeScript reais do cliente, em Node puro, sem rede, Emulator ou Firebase. F1, F2, F4 e F3 sem poda rodaram sobre o código das 18:37; F3 com poda, sobre o código das 19:21, recompilado. A poda não muda a classificação (F1) nem a visão de um documento dado (F2).

**Evidência do executor consultada** (não reexecutada: o Emulator é proibido ao revisor):
- integração das marcas: 14/14 às 18:47, no código das 18:37 (antes da poda das 19:21);
- Rules: 6/6 às 18:32 e 17/17 às 19:13;
- cash: 108/108 às 18:27, **anterior** à última mudança de `periods.ts`;
- E2E:
  - `t1` (21/21, 17:50, árvore anterior às correções);
  - `t4` (15/15, 18:15, idem);
  - `t5` e `t6` (`cash-pending-entries`, 20/20 e 10/10, RR-R2A-04);
  - `r3-b03-teclado` (4/5, 19:16; o B03-b falhou na etapa de teclado);
  - `r3-b03-teclado-2` (B03-b, 1/1, 19:18; antes da poda);
- mutantes do backend: 11/12 e depois 12/12 com o B09.

**Cobertura obrigatória:**

| Item | Estado |
| --- | --- |
| Criação | coberto |
| Edição, inclusive sem efeito e mudança de mês retroativa | coberto |
| Anulação | coberto |
| Exclusão | coberto |
| Estorno | unidade e F3; o E2E real está desatualizado |
| Retry e duplicidade | coberto |
| Concorrência | coberto, exceto F-02 |
| Autoridade (Rules no Emulator) | coberto |
| Atomicidade (falha injetada dentro da transação e entre preparação e publicação) | coberto |
| Remoção de legado | busca e guarda |
| Migração | N/A |
| Regressão das suítes do mesmo escritor e E2E finais na árvore final | **pendente** (F-01) |
