# Parecer de arquitetura — P5-F.1-R3 (B03, marcas de aplicação)

Esta é uma revisão independente e adversarial do desenho implementado.

**Objetivo verificado:** a estimativa convertida em tempo de trabalho só pode aparecer quando houver prova de que os lançamentos usados e as projeções consultadas representam um estado consistente. Prova verdadeira com valor errado bloqueia; recusar a mais é aceitável.

## Veredito: FAIL na versão entregue à revisão; PASS na árvore final das 18:37 UTC, quanto à solidez da prova

**Versão entregue à revisão** (instantâneo até 18:23 UTC; hashes em `hashes-revisados.txt`): **FAIL.** Duas sequências alcançáveis devolvem prova verdadeira com valor errado:
- **A01 (HIGH):** o corte por `serverTimestamp` é anterior ao commit do checkpoint.
- **A02 (MEDIUM):** a visão "ausente" é aceita mesmo com o lançamento presente.

**Mudanças feitas na mesma árvore durante a revisão.** Conferi cada uma por leitura, rodando de novo as sondas contra o código atual (pacotes recompilados) e com o modelo aleatório:

| Achado | Arquivo | Horário (UTC) | O que mudou |
| --- | --- | --- | --- |
| A01 | `rebuild.ts` | 18:25 | motivo de recomeço `post_cutoff_event_missed_staging` |
| A01 | teste de integração | 18:26 | teste novo |
| A01 | §6 do desenho | 18:32 | texto da correção |
| A03 | `periods.ts` | 18:30 | correção |
| A02 | `projectionProof.ts` | 18:35 | defesa no cliente |
| A06 | `firestore.rules` | 18:37 | só o comentário |
| A02 | `BACKUP_RESTORE_DR.md` | 18:37 | linha nova: `cash_projection_marks` é derivada; nunca copiar; reconstruir |
| A05 | §3 e §7, item 5, do desenho | 18:38 | corte descrito como `serverTimestamp`; item 5 com a defesa do cliente |

**Árvore final** (hashes no fim de `hashes-revisados.txt`): **PASS.** Não encontrei mais caminho para prova verdadeira com valor errado na operação normal nem seguindo os procedimentos documentados.
- No modelo, com o backend corrigido e o cliente real, foram 0 violações em todas as variantes.
- Sem a correção do backend, a defesa do cliente sozinha ainda deixa 2 violações em 20.000 cenários. Por isso a correção do A01 no backend é a necessária.

**Ressalvas.** Ficam abertos itens LOW e INFO, nenhum bloqueante:
- o resíduo operacional do A02: depois de uma importação inconsistente e antes da reconstrução, a prova **não** recusa. A frase nova do runbook de DR diz o contrário (sonda `sonda-a02-importacao-inconsistente.cjs`);
- recusas permanentes sem sinal (A04);
- a §20.18 do plano mestre, que o desenho e as respostas do executor dão como existente. Às 18:42 UTC, ela não existe;
- efeito da impressão digital do documento inteiro (A07).

O PASS é arquitetural. Ele depende de a suíte do executor passar, inclusive o teste novo do A01. Não a rodei aqui porque o pedido proíbe o Emulator.

## Escopo e método

- **Código lido:**
  - backend: `functions/src/cash/projectionMarks.ts`, `periods.ts`, `rebuild.ts` e `functions/src/triggers/transactions.ts`;
  - cliente: `src/modules/work-time/{projectionProof,projectionReads,receivableReversal,consistency,useIncomeEstimateWith,useIncomeEstimate,incomeBasis}.ts`, `src/modules/transactions/{api,incomeReads,contract}.ts` e `src/modules/reports/{queryKeys,hooks,basisRefresh,liveRefresh}.ts`;
  - Rules: o bloco `cash_projection_marks` e `isBackendOwnedCollection` em `firestore.rules`;
  - documentos e testes: `DESENHO-MARCAS-B03.md`, `sondas/*.log`, os testes `functions/src/cash/__tests__/projectionMarks*.ts` e `BACKUP_RESTORE_DR.md`.

  A árvore foi regravada várias vezes durante a revisão. Reli cada trecho alterado.
- **Sondas:** ficam todas neste diretório e rodam com `node`, sem Emulator, porta de rede ou Firebase real.
  - As funções **reais** do repositório foram empacotadas com o `esbuild` do próprio repositório. O backend está em `build/backend.cjs` (o do instantâneo é `build/backend-instantaneo-1823.cjs`) e o cliente em `build/client.cjs` (o do instantâneo é `build/client-instantaneo-1823.cjs`). As funções usadas são `applyCashPeriodWriteOnce`, `markViewOf`, `applyMarkEvent`, `markAnchorPatch`, `transactionFingerprint`, `cashWritePlanFor`, `readCashProjectionState`, `proveProjectionExclusions` e `excludedItemOf`.
  - Elas rodam sobre um Firestore em memória (`memfs.cjs`). Nele, o `serverTimestamp` resolve no instante do pedido, com precisão de milissegundo, e o commit grava `updateTime` em microssegundos. É o comportamento que a sonda da R3 mediu no Emulator.
  - `mundo.cjs` reproduz, linha a linha, `writeNewCheckpoint`, `processPage`, o commit da página e `publishRebuild`. A opção `checkStaging` reproduz a correção do A01 feita às 18:25, que eu conferi por leitura.
  - Para rodar: `NODE_PATH=<wt>/functions/node_modules node <sonda>.cjs`.
- **Verificação aleatória:** `modelo-aleatorio.cjs`; `modelo-aleatorio-duas.cjs` admite até três reconstruções seguidas. Cada cenário tem:
  - um lançamento estável U;
  - um lançamento T com 1 a 9 escritas (criação, valor, mês, pendente, anulada e, rara, exclusão física com recriação do mesmo id);
  - entregas do gatilho atrasadas, fora de ordem e repetidas;
  - reconstrução em etapas separadas: checkpoint, leitura da página fora da transação, commit da página e publicação, com recomeços;
  - leitura do cliente por id e, depois, a transação de leitura.

  A propriedade conferida é: **prova verdadeira ⇒ a estimativa tira de cada mês exatamente a parte de T na projeção lida.** Com `needsRebuild`, a estimativa conta como indisponível (`functions/src/reports/report.ts:255`). Resultados em `resultado-*.log`, `atual-*.log`, `final-*.log` e `rodar-modelos*.out`.

Nas tabelas abaixo, cada variante tem 20.000 cenários. Nas colunas "1 / até 3", o primeiro número vale para uma reconstrução e o segundo para até três.

**Instantâneo das 18:23:**

| Variante | Provas verdadeiras (1 / até 3) | Violações, em cenários (1 / até 3) |
| --- | ---: | ---: |
| Corte = commit do checkpoint (o que a cerca supõe) | 129.553 / 127.087 | **0 / 0** |
| Commit até 8 ms depois do corte (valor medido no Emulator) | 129.681 / 127.179 | **24 (4) / 6 (1)** |
| Commit até 50 ms depois do corte (espera de trava) | 127.796 / 126.174 | **552 (93) / 175 (54)** |
| 50 ms + correção do A01 (a publicação recusa marca de entrega que não alimentou a preparação) | 130.229 / 127.410 | **0 / 0** |
| 50 ms + só a defesa do A02 no cliente | 124.625 / 123.698 | 0 / **2 (2)** |
| 50 ms + as duas | 127.754 / 125.050 | **0 / 0** |

**Árvore final** (backend com A01 e A03; cliente real com a defesa do A02):

| Variante | Provas verdadeiras (1 / até 3) | Violações (1 / até 3) |
| --- | ---: | ---: |
| Corte = commit do checkpoint | 126.993 / 125.072 | **0 / 0** |
| Commit até 50 ms depois do corte, com a correção do A01 | 127.285 / 125.007 | **0 / 0** |
| Commit até 50 ms depois do corte, sem a correção do A01 (só a defesa do cliente) | 124.521 / 123.604 | 0 / **2 (2)**: a leitura por id antecede a criação; a correção do A01 elimina o caso |

## Achados

### A01 — HIGH — corrigido na árvore final

**Problema:** o corte é um `serverTimestamp` anterior ao commit do checkpoint. Uma criação nessa janela entra na projeção publicada, mas não na cadeia da geração nova, e a prova sai verdadeira com o valor errado.

**Causa.**
- O corte é `FieldValue.serverTimestamp()` no checkpoint (`rebuild.ts:308`) e em `categoryStaging.cutoff` (`rebuild.ts:351`). As linhas são as da árvore final.
- A sonda da própria R3 mediu, no Emulator, que esse valor tem precisão de milissegundo e fica 2 a 8 ms antes do `updateTime` do commit, sem contenção (40 de 40 em `sondas/sonda-updatetime.log`).
- Mesmo assim, o corte é comparado com `updateTime`, `createTime` e `eventTime` de outros commits:
  - em `processPage` (`rebuild.ts:758-768`);
  - em `markGenerationsFor` e `categoryGenerationsFor` (`periods.ts:1107` e `:1133`);
  - na cerca `covered_by_rebuild`;
  - na raiz `event`;
  - na consulta `eventTime > corte` da publicação.
- O desenho se contradiz: a §1 diz que "comparações de ordem por `serverTimestamp` entre commits diferentes não são confiáveis", e a §3 diz que "ordem e corte continuam no `updateTime`/`eventTime` … exatos".

**Sequência** (`sonda-a01-corte-antes-do-commit.cjs`; saídas `sonda-a01.log`, `sonda-a01-arvore-atual.log` e `sonda-a01-arvore-final.log`):
1. U (receita de R$ 1.000,00, 2026-10) já foi aplicado na geração `g0`, posição `a`.
2. A transação do checkpoint da reconstrução R lê `projection_state`. O `serverTimestamp` resolve no instante `s`, mas o commit só acontece em `C = s + 8 ms`. Se o commit esperar a trava de `projection_state`, que todo gatilho lê, o intervalo é maior.
3. Em `s + 4 ms`, um escritor do backend cria T (receita de R$ 500,00, 2026-10-10). O gatilho de T lê o estado **antes** do commit do checkpoint, quando ainda não há `categoryStaging`. Ele aplica o delta só na `g0`, grava a cadeia só na posição `a` e cria a marca de entrega com `eventTime > s` e `categoryGenerations: ["g0"]`.
4. O checkpoint commita.
5. A varredura vê `createTime(T) > corte`, pula T e não grava âncora (`rebuild.ts:758-764`).
6. No instantâneo, a publicação somava **toda** marca de entrega `applied` com `eventTime > corte`, inclusive a de T. O mês publicado fica em R$ 1.500,00, com a etiqueta R.
7. O cliente desconsidera T:
   - `markViewFor` não acha componente de R e devolve "ausente";
   - `appliedOf` devolvia `document: null`;
   - as bases coincidem com o mês.

   Resultado: **prova VERDADEIRA**, nada é tirado, e a receita elegível fica em R$ 1.500,00 em vez de R$ 1.000,00.

**Variantes que o modelo encontrou:**
- recriação com o mesmo id dentro da janela;
- recusa permanente quando T é alterado depois: a alteração fica pendente para sempre, ou o nó não é o conteúdo lido (rastro em `depurar.out`);
- a mesma perda na projeção por categoria da P5-C1, onde o defeito já existia.

**Por que os testes da R3 não pegavam o caso.**
- O teste de propriedade modela o corte como um `tick()` exato.
- Ele soma os eventos posteriores só pelo caminho do gatilho com a preparação visível (`rebuild.postCut`). O código soma por `eventTime`.
- Os testes de integração só injetavam escritas depois do commit do checkpoint.

**Na árvore final.**
- `summarizePostCutoffEvents(docs, cutoff, stagingGeneration)` (`rebuild.ts:1078-1126`) recomeça com `post_cutoff_event_missed_staging` quando uma marca `applied` não traz `current.rebuildId` em `categoryGenerations`. A publicação passa o `rebuildId`; a simulação passa `null`.
- A regra é a mesma que alimenta a cadeia de marcas, na mesma transação (`markGenerationsFor` ≡ `categoryGenerationsFor`). Ela fecha também a projeção por categoria.
- O teste de integração novo, "entrega com commit depois do corte que leu o estado antes do checkpoint…", reproduz a janela tirando a preparação do estado durante a entrega.
- O modelo com essa regra dá 0 violação, sem nenhum final sem prova que não tenha exclusão física.
- A defesa do cliente (A02) também recusa o caso, exceto quando a leitura por id antecede a criação (as 2 violações da tabela do instantâneo). Por isso a correção no backend é a necessária.

**Resíduos:**
- a §3 do desenho, que dizia que o corte é exato, foi corrigida às 18:38 (A05);
- o modelo de propriedade continua sem a janela, mas o teste de integração novo cobre o caso;
- sob escrita contínua, os recomeços podem se repetir, porque o corte do recomeço também é um `serverTimestamp`. É uma questão de vivacidade, não de solidez.

### A02 — MEDIUM — mitigado na árvore final; resíduo LOW, operacional e documental

**Problema:** a regra "sem âncora e sem cadeia = ausente" pressupõe que toda a história do workspace passou pelo gatilho com marcas.

**Sequência** (`sonda-a02-historico-sem-marca.cjs`; saídas `sonda-a02.log`, `sonda-a02-arvore-atual.log` e `sonda-a02-arvore-final.log`):
1. L (R$ 800,00, 2026-10) foi gravado antes da R3. Está na projeção, sem marca, e o mês não tem etiqueta.
2. Uma receita do mesmo mês (R$ 200,00) passa pelo gatilho da R3, e o mês recebe `projectionGeneration = g0`.
3. O cliente desconsidera L. No instantâneo, a visão era "ausente", a **prova saía VERDADEIRA** e nada era tirado: R$ 1.000,00 em vez de R$ 200,00.

O mesmo vale para uma geração publicada por reconstrução anterior à R3 (sem âncoras) e para restauração ou importação que não passe pelo gatilho.

**Na árvore final.**
- `appliedOf` (`projectionProof.ts`, 18:35) recusa um nó ausente ou apagado quando o lançamento aparece na leitura por id (motivo `content`, passageiro).
- A sonda contra o cliente atual dá `recusada (content)`. Na criação ainda não aplicada, o caso legítimo, a recusa é passageira.

**Resíduo (LOW).** A defesa não cobre uma importação cujos meses e marcas sejam de instantes diferentes, como uma exportação gerenciada sem `--snapshot-time`. Também não cobre a cópia de `cash_report_periods` ou de `cash_projection_marks` de um banco restaurado sem reconstrução. Nesses casos o nó pode estar "vivo" e igual ao conteúdo lido, enquanto a projeção é de outro instante.

A sonda `sonda-a02-importacao-inconsistente.cjs` (saída `sonda-a02-importacao.log`, cliente da árvore final) monta exatamente isso: o mês vem do instante t1, com T a R$ 300,00, e as marcas e o lançamento vêm do instante t2, com T a R$ 700,00. A **prova sai VERDADEIRA**, e a receita elegível fica em R$ 600,00 em vez de R$ 1.000,00.

O runbook de DR, atualizado às 18:37, manda reconstruir depois de restauração, importação ou implantação sobre dados existentes, e isso está certo. A mesma linha, porém, afirma que "até ela … a prova recusa; nunca converte errado", o que é falso nesse caso.

**Correção:**
- no runbook, trocar a frase por "até a reconstrução a conversão pode estar errada" e mandar reconstruir antes de reabrir o acesso;
- criar a §20.18 do plano. A §10 do desenho e as respostas do executor a dão como existente, mas às 18:42 UTC o plano não tem essa seção (arquivo de 16:26).

### A03 — LOW — corrigido na árvore final

**Problema:** conflito com a base não registrava `markRecoveryNeeded` nem log.

- **No instantâneo**, a quebra só era registrada quando `next.kind === "broken" && previous.kind !== "broken"`. Os conflitos (`anchor_after_absent`, `anchor_mismatch`, `base_without_anchor`, `anchor_missing`) já aparecem na visão anterior, então só `pending_overflow` ficava registrado (`sonda-a03.log`: `markBroken: null` nos três).
- **Na árvore final**, o registro compara com a cadeia gravada da geração. Rodei a sonda contra o código atual: os três conflitos registram `markRecoveryNeeded: true` (`sonda-a03-arvore-final.log`).

### A04 — LOW — aberto

**Problema:** recusas que ficam para sempre, sem sinal para ninguém, e releitura automática sem fim.

**Casos:**
- **Pendência nunca absorvida, sem registro nenhum.** Exclusão física e recriação com o mesmo id, entregues com a recriação primeiro (`sonda-a04-pendencia-eterna.cjs`; `sonda-a04-arvore-final.log`). Todas as entregas chegam e a projeção fica certa, mas o estado é `mark_pending` para sempre, com `markRecoveryNeeded`, `needsRebuild` e `markIssueCount` em `false`/0.
- Conteúdo ABA, se algum escritor deixar de gravar `updatedAt`.
- Na árvore final, também os lançamentos sem marca do A02, agora recusados com `content` para sempre.
- **`markRecoveryNeeded` não tem leitor:** nenhum relatório, alerta ou tela.

**Efeitos:**
- a tela mostra para sempre "A estimativa está em atualização…";
- para `content` e `mark_pending`, o agendador relê sem fim: 5 seguidas e depois uma a cada 120 s. São até 100 documentos por id, 13 meses e 100 marcas por releitura, ou cerca de 6 mil leituras por hora em cada sessão aberta.

**Resposta do executor:** classificado sem mudança. Os casos só aparecem fora do produto: o produto não apaga lançamentos, todo escritor grava `updatedAt` e a política de legado afasta os dados sem marca. O alerta fica para a P7. Aceito como não bloqueante. O registro do risco que a resposta cita (§20.18 do plano) ainda não existe.

**Correção sugerida:**
- registrar a recuperação quando a pendência mais antiga passar da janela de entrega (24 h);
- expor `markRecoveryNeeded` a owner/admin, como `needsRebuild`;
- parar a releitura depois de N tentativas com a mesma marca lida;
- usar uma mensagem própria para "precisa de reconstrução".

### A05 — INFO — documentação do desenho: corrigida em parte na árvore final

- Corrigido às 18:38: a §3 descreve o corte como `serverTimestamp`, a §6 descreve a conferência da publicação e o item 5 da §7 descreve a defesa do cliente.
- Continua aberto: a §10 cita a §20.18 do plano, que não existe.

### A06 — INFO — corrigido na árvore final

O comentário de `isBackendOwnedCollection` ("consulta com teto de 30") contradizia `allow list: if false`. Às 18:37 o comentário foi corrigido. Conferi a lista e o bloco: a regra continua a mesma.

### A07 — INFO

A impressão digital cobre o documento inteiro. Assim, um tipo desconhecido, como `VectorValue`, deixa permanente a falha do gatilho daquele lançamento (`contract_violation`) e aborta a reconstrução. É fail-closed e nenhum escritor grava esses tipos, mas vale registrar no contrato de `transactions`.

## Verificado sem encontrar problema

1. **INV-M nas funções puras.** Testei `applyMarkEvent`, `absorbPending` e `markViewOf` com:
   - entregas fora de ordem e repetidas;
   - mudança de mês, pendente e anulação;
   - exclusão física e recriação;
   - recomeços e preparação abandonada;
   - posições reutilizadas em reconstruções seguidas.

   Com o corte igual ao commit, deu 0 violação no instantâneo (256.640 provas verdadeiras) e na árvore final (252.065).
2. **Corrida entre a leitura da página e o commit.** A âncora feita com a página velha concilia com a raiz `event` ou com a pendência absorvida. Uma exclusão nesse intervalo leva a recomeço ou a `ambiguous_delete` com `needsRebuild`.
3. **Evento entregue antes do checkpoint, com `eventTime ≤ corte`.** Está na base e não alimenta a preparação, como deve.
4. **Preparação abandonada e posições `a`/`b`.** O backend ignora os restos pelo `g`. A regra `superseded` do cliente só recusa a mais.
5. **Primeiro evento depois da publicação.** Usa a âncora e a cadeia preparada do `g` novo, na posição de `markSlot`.
6. **`covered_by_rebuild` e `ambiguous_delete`.** Não mexem em cadeia nem em mês. `ambiguous_delete` liga `needsRebuild`, e o relatório deixa de ser exato.
7. **Meses.**
   - Mês sem documento vale zero.
   - Mês sem etiqueta recusa.
   - A publicação etiqueta todos os meses e os órfãos num único commit, e cada delta do gatilho regrava a etiqueta.
   - Os únicos escritores são o gatilho e a publicação.
8. **Impressão digital entre os dois SDKs** (`sonda-paridade-tipos.cjs`, `sonda-paridade.log`). Com objetos reais de cada SDK, o resultado é igual para:
   - `Timestamp` (também negativo), `GeoPoint` e `DocumentReference`;
   - bytes (`Buffer` × `Bytes`);
   - `-0`, `NaN`, `±Infinity` e inteiros acima de 2^53;
   - mapas aninhados, chave `$t` e chave vazia.

   `VectorValue` é recusado nos dois lados.
9. **Transação só de leitura do SDK web** (`@firebase/firestore` 4.10.0). Cada documento lido vira `VerifyMutation` com pré-condição `updateTime` ou `exists: false`, então meses e marcas valem no instante do commit. A leitura por id em outro instante continua correta: a impressão é a mesma, e a INV-M vale no instante da transação.
10. **React Query.**
    - A chave inclui o workspace, os ids ordenados e a janela.
    - A prova confere `read.window`.
    - Não há `placeholderData`.
    - Respostas canceladas ou de outra chave são descartadas.
11. **Recebimento e estorno.**
    - As duas marcas vêm na mesma transação.
    - O estorno na projeção sem o recebimento recusa.
    - Na árvore final, o estorno existente que ainda não foi aplicado também recusa, de forma passageira.
12. **Limites.**
    - 16 pendências viram `broken` com registro.
    - As Rules limitam as desconsideradas a 50; com até 50 espelhos, são no máximo 100 marcas.
    - A janela tem no máximo 13 meses.
    - Acima de qualquer teto, o resultado é erro, nunca prova.
13. **Rules.** Só `get` para membro ativo; `list`, `create`, `update` e `delete` falsos; a coleção está em `isBackendOwnedCollection`.
14. **RR-R2A-04** (`reports/queryKeys.ts` e `hooks.ts`): nenhuma atualização perdida.
    - A ordem da mudança e a do começo das leituras vêm de um contador único.
    - A leitura em curso só é poupada quando começou depois do retorno da escuta.
    - A primeira leitura é relida depois de terminar.
    - O primeiro retorno da escuta conta, inclusive quando ela reabre por troca de mês ou de workspace.
15. **A correção do A01 não afeta a simulação** (`dryRun` com `stagingGeneration = null`).

## Resumo

| ID | Severidade | Estado na árvore final | Tema |
| --- | --- | --- | --- |
| A01 | HIGH | corrigido (18:25), conferido | corte por `serverTimestamp` anterior ao commit do checkpoint, que leva a prova verdadeira com valor errado |
| A02 | MEDIUM | mitigado no cliente (18:35) e no runbook (18:37); resíduo LOW | lançamento sem marca aceito como "ausente"; importação inconsistente prova errado até a reconstrução, ao contrário do que o runbook afirma |
| A03 | LOW | corrigido (18:30), conferido | conflitos com a base não registravam `markRecoveryNeeded` nem log |
| A04 | LOW | aberto | recusas permanentes sem sinal, `markRecoveryNeeded` sem leitor e releitura sem fim |
| A05 | INFO | corrigido em parte (18:38) | §3, §6 e §7, item 5, corrigidos; §10 cita a §20.18, que não existe |
| A06 | INFO | corrigido (18:37) | comentário de `isBackendOwnedCollection` |
| A07 | INFO | aberto | impressão do documento inteiro deixa permanente a falha por tipo desconhecido |

**Veredito.**
- **Versão entregue à revisão: FAIL** (A01 e A02).
- **Árvore final das 18:37 (documentos até 18:42): PASS** quanto à solidez da prova, sem achado bloqueante, desde que a suíte do executor passe com o teste novo do A01. Ficam como pendências não bloqueantes:
  - corrigir a frase do runbook de DR (o resíduo do A02);
  - criar a §20.18 do plano;
  - o A04.
