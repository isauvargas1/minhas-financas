# P5-F.1-R2A, Frente B — Proposta arquitetural do B03: provar quais escritas financeiras a projeção mensal já aplicou

**Data:** 2026-11-06 · **Estado:** DESENHO, somente leitura. Nada do backend financeiro foi alterado nesta etapa (pedido P5-F.1-R2A, Frente B; parecer independente de 2026-11-06, §5 e "Critérios do desenho B03").
**Árvore lida:** P5-F.1-R1, `08d8c5a2f5141f19d06968737c5f7fdc71c4a45f` (base de commit `1730a1d`). As referências `arquivo:linha` são dessa árvore.
**Decisão pedida:** escolher a alternativa e autorizar, em etapa própria e com revisão, a mudança no gatilho de caixa, nas Rules e na prova da estimativa. A recomendação está na §7.
**Revisão independente:** a 1ª rodada achou na prova do cliente uma falha que aceitava leitura velha com evento fora de ordem e mudança de mês (T02), e as imprecisões menores do T11. A §5.A e as §0, §6, §8, §9 e §10 foram corrigidas. Na 2ª rodada, a revisão conferiu a correção com um modelo executável: 0 provas falsas em 234.791. Com a regra antiga, o mesmo modelo dá 71 provas falsas, o que mostra que ele detecta o defeito (`revisoes/`).

---

## 0. Resumo

- **O defeito.** A estimativa de tempo de trabalho junta duas leituras:
  - a receita mensal da projeção oficial (`cash_report_periods`);
  - os lançamentos que a pessoa desconsiderou, lidos por id em `transactions`.

  A projeção não registra quais escritas de cada lançamento já somou. A R1 usa como versão o `updatedAt` do mês e, depois de 30 s, presume que a escrita não pendente não tem impacto (`expired`). O parecer confirmou essa presunção (§4). Ela falha em três casos:
  - (a) o gatilho atrasa mais que a espera;
  - (b) eventos chegam fora de ordem;
  - (c) uma mudança de data tira o lançamento do mês.
- **O que não resolve.**
  - Aumentar a espera: o Eventarc reentrega por até 24 h, e o gatilho desiste com 23 h (`functions/src/triggers/transactions.ts:30-45`). Qualquer prazo finito é uma presunção.
  - Pôr mais um `updatedAt`: qualquer escrita do mês o avança, inclusive a de outro lançamento que chegou antes de uma escrita anterior (caso b). A edição sem efeito monetário não grava o mês (`periods.ts:651-689`). E o mês antigo de uma mudança de data não aparece no documento lido (caso c).
- **Recomendação.**
  - **Alternativa A:** uma **marca de aplicação por lançamento** (`cash_projection_marks/{transactionId}`), gravada pelo gatilho na **mesma transação** que soma o delta. Ela encadeia as versões aplicadas pelo `updateTime` de antes e depois. Guarda os eventos que chegaram fora de ordem até o anterior chegar. Para cada mês tocado, registra o commit que o tocou.
  - **O cliente prova** que a projeção que a escuta mostra contém exatamente a versão lida de cada desconsiderada. A marca, lida depois da escuta, tem o prefixo aplicado igual a essa versão e nenhuma pendência, e a escuta dos meses é posterior aos commits que tocaram o lançamento (§5.A, corrigida depois da revisão independente da R2A, T02). Sem prova, a estimativa **não converte** (fica em reais), sem prazo que vire presunção.
  - **O que não muda:** a reconstrução, a idempotência, os centavos, os escritores e as projeções oficiais.

## 1. Escopo e limites desta proposta

- Entra: a consistência entre as escritas em `workspaces/{ws}/transactions`, o gatilho `onTransactionWrite`, as projeções `cash_report_periods`, a reconstrução e as leituras da estimativa (desconsideradas e espelhos de estorno).
- Não entra: refatoração do ledger, billing, funcionalidade nova, deploy, mudança nos escritores financeiros (o parecer pede autorização separada antes de mexer neles).
- O que vale: o código, não a documentação. Onde a documentação de evidência diverge do código, a divergência está registrada na §2.7.

## 2. Estado atual (fatos, com referência)

### 2.1 Escritores de `transactions`

Todos usam o Admin SDK, todos gravam `updatedAt: serverTimestamp()`, e o cliente não escreve (`firestore.rules:614-618`: `create, update, delete: if false`).

| Escritor | Onde | Transação, idempotência e versão |
| --- | --- | --- |
| Caixa: criar | `functions/src/cash/createTransaction.ts:292-431` | `runTransaction` (`:298`), `reserveActorIdempotency` (`:312`), `create` (`:396`); id `cash_` + sha256 |
| Caixa: editar | `functions/src/cash/mutateTransaction.ts:558` (`update` em `:688`) | versão esperada por `updatedAt` (`assertExpectedVersion`, `:255-270`); intenção (`:193`, `:318`, `:336-345`) |
| Caixa: confirmar | `mutateTransaction.ts:749` (`:839`) | `isPaid: true`, `cashEntry.confirmedAt` (`:417`) |
| Caixa: anular | `mutateTransaction.ts:870` (`:926`) | anulação lógica (`voidedAt`, `cashEntry.status = voided`), sem exclusão |
| Importação | `functions/src/cash/importTransactions.ts:222` (`create` em `:344`) | até 50 linhas por lote (`functions/src/cash/contracts.ts:371`); id `cashimp_` |
| Recorrentes | `functions/src/recurring/facts.ts:257`; `generation.ts:125-150`; `occurrenceOperations.ts:294-308, 436-449` | id derivado da ocorrência (`recurring/model.ts:125-129`) |
| Empréstimos | `functions/src/loans/operations.ts:366, 725, 892, 1041` | espelho só de criação (`loans/model.ts:374-404`) |
| Recebíveis | `functions/src/receivables/operations.ts:631, 825` | espelho do recebimento e do estorno (`receivables/cashEffect.ts:37, 83`) |
| Cartões | `functions/src/cards/invoiceOperations.ts:358, 555` | pagamento e estorno de fatura (`cards/cashEffect.ts:90-118`) |
| Divisão de contas | `functions/src/splitBills/cash.ts:139, 253` | título, reembolso e compensação |
| Investimentos | `functions/src/investments/cash.ts:221-262` | `transaction.set` sem `create` (sobrescreve o espelho) |
| Ferramenta de desenvolvimento | `tools/investments/limpar-investimentos.mjs:361-419` | exclusão física, só com `--apply --confirmar` (o produto não apaga) |

### 2.2 O gatilho das projeções

- **Função.** `onTransactionWrite` (`functions/src/triggers/transactions.ts:350-392`), com `retry: true`, 60 s, `maxInstances: 20` e região `southamerica-east1` (`functions/src/shared/runtimeOptions.ts:144-150`).
- **Instante do evento.** `after.updateTime` na criação e na alteração; `event.time` na exclusão (`transactions.ts:359-365`). `before.createTime` também é lido (`:389`).
- **Delta.** `cashWritePlanFor(before, after)` (`functions/src/cash/periods.ts:697-722`): tira o efeito de `before` e soma o de `after` por mês, dia e categoria.
  - Mudança de mês sai de um mês e entra no outro.
  - Anulado não soma.
  - Delta zero não grava (`addToPlan`, `:651-689`).
  - Valores em centavos.
- **Idempotência.** O `event.id` vira a chave da marca de entrega `cash_period_events/{sha256}`. `applyCashPeriodWriteOnce` (`periods.ts:1169-1251`) lê a marca e o estado com `getAll`. Se a marca existe, devolve `duplicate`. Senão, aplica o delta e cria a marca, tudo na mesma transação.
- **Ordem.** Não há comparação de versão por documento. Cada entrega soma o delta do próprio par `before/after` com `FieldValue.increment`, que é comutativo. A ordem só é confrontada com o corte da reconstrução (`periods.ts:1204-1234`).
- **Mês gravado.** `writeCashMonth` (`periods.ts:809-832`): `increment` nos totais e nos dias, `schemaVersion` e `updatedAt: serverTimestamp()`. Não há campo de versão aplicada, `lastEventId` nem contador.
- **Falhas.**
  - A falha passageira é relançada até 23 h de idade (`transactions.ts:30-45`, `:305-307`).
  - Depois disso, ou na falha permanente, o gatilho registra `needsRebuild` no estado (`recordCashProjectionIssue`, `periods.ts:1101-1110`; `transactions.ts:310-330`).

### 2.3 A reconstrução

- **Como roda.** `rebuildCashPeriods` (`functions/src/cash/rebuild.ts:1610-1631`, owner/admin, 100 por hora) varre `transactions` com cursor e publica numa transação (`publishRebuild`, `:1350`).
- **O que publica.**
  - meses completos com `rebuildId`, `rebuiltAt` e `updatedAt` (`:1513-1522`);
  - órfãos zerados (`:1525-1535`);
  - no estado, `baselineCutoff`, `baselineRebuildId` e `lastPublishedAt` (`:1537-1545`).
- **A cerca** (`rebuild.ts:60-87`):
  - a base contém exatamente as escritas com commit `<= cutoff`;
  - a publicação soma as entregas posteriores ao corte já aplicadas;
  - depois dela, o gatilho ignora eventos com commit `<= cutoff` (`covered_by_rebuild`, `periods.ts:1204-1213`).

### 2.4 A leitura da estimativa

- **Escuta.** Os meses da janela são escutados por `onSnapshot` em `cash_report_periods`, com até 13 documentos (`src/modules/reports/basisSync.ts:99`). A versão de cada mês é `serverVersionOf(updatedAt)` (`basisSync.ts:524`).
- **Desconsideradas.** Até 50 ids, gravados na preferência privada (`src/modules/work-time/grammar.ts:93`). São lidas do servidor por id, em lotes de 30 (`src/modules/transactions/api.ts:149-175`), junto com o espelho do estorno de cada recebimento (B01, `src/modules/work-time/receivableReversal.ts:36-78`).
- **Prova** (`src/modules/work-time/consistency.ts:1-46`, regras 1 a 5; `:214-224`). A regra 5 segura a estimativa enquanto uma escrita conhecida de uma desconsiderada é posterior à versão do mês dela.
- **Espera limitada.** Para a escrita "limitada" (`bounded`), a espera termina em `ESTIMATE_PENDING_WAIT_MS = 30_000` (`src/modules/work-time/useIncomeEstimateWith.ts:64`). A chave entra em `expired` (`:365-374`), e a escrita deixa de segurar (`consistency.ts:220`). É a presunção que o parecer reproduziu (§4).

### 2.5 Rules envolvidas

- `transactions`: leitura por membro ativo, nenhuma escrita (`firestore.rules:614-618`).
- `cash_report_periods`: `get` por quem lê o workspace, `list` com `limit` de 1 a 600, nenhuma escrita (`firestore.rules:788-797`).
- `cash_period_events` (marcas de entrega e estado): nem leitura nem escrita pelo cliente (`firestore.rules:800-802`).

### 2.6 Testes do gatilho que existem

- **Reentrega e concorrência.** `functions/src/cash/__tests__/projectionRecovery.integration.test.ts:155` cobre a reentrega e 6 entregas simultâneas: só uma aplica.
- **Falhas antes e depois do commit.** O mesmo arquivo, em `:175-270`.
- **Cerca da reconstrução.** `rebuildFence.integration.test.ts:463-598`.
- **Lacuna.** Não há teste que entregue dois `UPDATE` do mesmo lançamento fora da ordem de commit (busca `fora de ordem|out.of.order|invers` sem resultado).

### 2.7 Divergências documentais encontradas (só registro)

- **Janela de reentrega.** `docs/investments/TTL_MANIFEST.md:49` fala em 7 dias de reentrega. O código assume 24 h (2ª geração) e desiste com 23 h (`transactions.ts:33-45`).
- **Versão da base.** Na base da estimativa, `versions` é o `dataUpdatedAt` do React Query (`useIncomeEstimateWith.ts:214`). O `updatedAt` da projeção só entra pela escuta (`basisSync.ts:524`).

## 3. O defeito, de forma precisa

**Modelo.**
- **Versões.** Cada lançamento `T` tem uma cadeia de versões `v0 → v1 → … → vk`, que são os commits das escritas. Cada escrita `vi−1 → vi` gera um evento `ei` com o par `before/after` exato.
- **A projeção.** `P(m)` num instante é a soma dos deltas dos eventos já aplicados. A soma é comutativa, e cada evento entra uma vez (pela marca de entrega). Com todos os eventos aplicados, os deltas se telescopam e `P(m)` é exata, em qualquer ordem de entrega.
- **A estimativa.** Calcula `E(m) = P(m) − Σ valor(T@v)` sobre as desconsideradas `T` cujo mês em `T@v` é `m`. Aqui `v` é a versão lida.

**Condição de consistência.**
- Para cada desconsiderada `T`, os eventos de `T` somados em `P` são **exatamente** os da cadeia até `v`, um prefixo contíguo.
- A leitura de `P` é posterior ao commit que os aplicou, em todos os meses que esses eventos tocaram, inclusive o mês de antes de uma mudança de data.

**Por que a regra atual não garante isso:**

| Caso | Sequência (valores em centavos) | O que a R1 vê | Erro |
| --- | --- | --- | --- |
| (a) gatilho lento | `T` (desconsiderada, março) passa de 10.000 para 30.000; o gatilho atrasa 5 min (início a frio e retentativa) | depois de 30 s, `expired` solta a espera; `P(março)` ainda tem 10.000 de `T` e a estimativa tira 30.000 | −20.000 no mês, renda menor que a real |
| (b) fora de ordem | `T` passa de 10.000 para 30.000 (e1, commit 10:00:00); outro lançamento `U` do mesmo mês é criado (e2, commit 10:00:01); e2 é processado antes de e1 | `P(março).updatedAt` passa de e1, e a regra 5 considera e1 aplicado | −20.000, sem limite de tempo |
| (c) mudança de data | `T` (desconsiderada) muda de março para janeiro do ano anterior, fora da janela | a leitura por id mostra `T` fora da janela, e nada é tirado; `P(março)` ainda tem `T` | +10.000 em março, renda maior que a real (a exclusão foi ignorada) |
| edição sem delta | só a descrição de `T` muda | o gatilho não grava o mês (delta zero), e a versão do mês nunca passa da escrita | sem a espera, a estimativa ficaria em reais para sempre; com ela, presume |

Aumentar a espera muda só a duração da presunção do caso (a). Os casos (b) e (c) não dependem de tempo.

## 4. Requisitos de qualquer solução

| Requisito | Origem |
| --- | --- |
| RQ1 | Provar, por lançamento, quais escritas a projeção aplicou, sem inferir pela igualdade dos totais nem pelo `updatedAt` do mês | parecer, critério 1 |
| RQ2 | Cobrir a mudança de mês e os eventos fora de ordem | critério 2 |
| RQ3 | Preservar a idempotência (reentrega), a reconstrução, os centavos, as projeções oficiais e os vários escritores | critério 3 |
| RQ4 | Sem prova, não converter: o valor em reais continua a fonte de verdade | critério 4 |
| RQ5 | Transação, isolamento por workspace, custo do Firestore, janela de 12 meses, alteração retroativa e exclusões | critério 5 |
| RQ6 | Nenhuma refatoração do ledger, billing, funcionalidade nova ou deploy no mesmo ciclo | critério 6 |
| RQ7 | Nenhuma Function lê ou menciona a preferência privada | guarda `tests/unit/work-time-guard.test.ts` |
| RQ8 | Falha do gatilho nunca vira presunção: fica registrada (`needsRebuild`) e a prova falha até a reconstrução | D-38 do plano |

## 5. Alternativas

Como cada mecanismo pedido aparece aqui:

| Mecanismo pedido | Alternativa |
| --- | --- |
| **Checkpoint de aplicação** | A: uma marca por lançamento, gravada na transação que aplica o delta |
| **Revisão transacional** | A′: a revisão gravada pelo escritor, por documento; E: a sequência por workspace. A cadeia de `updateTime` de A é a revisão transacional sem mudar os escritores |
| **Leitura consistente no backend** | C |
| **Fallback seguro** | D, que também é o comportamento de A sem prova |

### A. Marca de aplicação por lançamento, gravada pelo gatilho (recomendada)

**Dado novo:** `workspaces/{ws}/cash_projection_marks/{transactionId}`. É metadado operacional, sem valor monetário nem dado pessoal.

```
{
  schemaVersion: 1,
  transactionId,
  appliedVersion: Timestamp | null,  // updateTime da última escrita do prefixo contíguo aplicado
  state: 'open' | 'deleted' | 'broken',
  pending: { [beforeVersionKey]: { after: Timestamp | 'deleted', at: Timestamp } }, // aplicados fora de ordem (até 32)
  monthCommits: { 'AAAA-MM': Timestamp },  // por mês tocado: commit do último evento de T que o tocou
  updatedAt: Timestamp
}
```

**No gatilho** (dentro de `applyCashPeriodWriteOnce`, na mesma transação do delta):
- **Leitura.** A marca entra no `getAll` que já lê a marca de entrega e o estado: +1 leitura endereçada.
- **Versões.** `bv` é o `before.updateTime` (ou `CREATE`) e `av` é o `after.updateTime` (ou `DELETED`).
- **Contrato.** O gatilho confere `after.data().updatedAt == after.updateTime`. Todo escritor grava `serverTimestamp`, que resolve para o commit. Se diferir, o gatilho registra `contract_violation` e põe a marca em `broken`.
- **Encadeamento:**
  - se `bv == appliedVersion`, ou se é a criação e `appliedVersion == null`, ou se `bv <= baselineCutoff` (o estado de antes está na base da reconstrução), o prefixo avança: `appliedVersion = av`, e as pendências que começam em `av` são absorvidas em sequência;
  - senão, o evento chegou antes do anterior e fica em `pending[bv] = av`.
- **Meses tocados.** Para cada mês do plano do evento, e para os dois meses numa mudança de data, `monthCommits[m] = serverTimestamp()`. O sentinela resolve para o commit da transação, o mesmo valor que o `updatedAt` do mês recebe ali.
- **Limite.** Mais de 32 pendências põem a marca em `broken` e registram a pendência no estado (`needsRebuild`).
- **Marca de entrega.** `duplicate` não toca a marca de aplicação. `covered_by_rebuild` só avança o prefixo, porque o estado já está na base. O avanço é monótono: `appliedVersion` nunca recua. `ambiguous_delete` põe `broken`, como hoje com `needsRebuild`.

**Na reconstrução** (`publishRebuild`), uma mudança aditiva: gravar `rebuildCutoff: cutoff` em cada mês publicado e nos órfãos. As marcas não são reescritas.

**No cliente** (nova regra 5, que substitui a espera limitada e o conjunto `expired`). Corrigida depois da revisão independente da R2A (T02): a versão anterior desta regra aceitava uma leitura velha quando um evento de `T` chegava fora de ordem e mudava `T` de mês.

**Ordem das leituras.** A prova usa três leituras:
- a escuta dos meses da janela, com o `updatedAt` de cada mês;
- `T`, na versão `v` (o `updatedAt` dela, igual ao `updateTime`);
- a marca de `T`.

A marca é lida do servidor **depois** do instantâneo da escuta usado na conta, para todos os meses da janela, e não só os de `monthCommits`. O gatilho grava a marca e os meses no mesmo commit. Assim, toda aplicação de evento de `T` que a escuta mostra já está na marca lida. Se um mês da janela muda na escuta depois da leitura da marca, a prova é refeita: lê a marca de novo e, se a marca mudou, `T` também.

**Releitura exigida.** Hoje o cliente já relê as desconsideradas sempre que a receita de uma base muda (`basisSync.ts:421-429` e `:476-490`). A regra 5 passa a exigir isso: toda mudança de um mês da janela na escuta refaz a prova, com as marcas relidas e, se alguma mudou, as desconsideradas também.

**A condição.** `T` está provada quando a projeção que a escuta mostra contém exatamente o estado `T@v`, nem mais nem menos. Vale **uma** das duas:
1. **Coberta pela reconstrução.** Todas estas:
   - `v <= rebuildCutoff` dos meses da escuta, e a escuta é posterior à publicação. A consulta devolve todos os meses no mesmo instante de leitura, então todos têm o mesmo `rebuildId`;
   - a marca, lida como acima, não mostra nenhum evento de `T` aplicado depois do corte. Ou não há marca, ou `appliedVersion <= rebuildCutoff`, com `pending` vazio e o estado diferente de `broken`.
2. **Aplicada pelo gatilho.** Todas estas:
   - a marca de `T` não está em `broken`;
   - `pending` está **vazio**. Uma pendência é um evento posterior a `appliedVersion` já somado à projeção fora de ordem, então a projeção não é `T@appliedVersion`;
   - `appliedVersion == v`;
   - para cada mês `m` de `monthCommits` que está na janela, o `updatedAt` do mês na escuta é `>= monthCommits[m]`.

**O que a prova cobre:**
- **Versão mais nova.** `T` pode ganhar uma versão `v' > v` depois da leitura:
  - se o evento de `v'` ainda não foi aplicado, a escuta e a marca mostram `T@v`, e a prova vale para o que foi lido;
  - se já foi aplicado, a marca, lida depois da escuta, mostra `appliedVersion = v'` ou uma pendência, e a prova falha. `T` é lido de novo.
- **Fora de ordem com mudança de mês** (o contraexemplo do T02):
  - `T` é lida em `v1`, em março;
  - `e2` (março → fevereiro) e `e3` (o valor) são gravados, e `e3` é aplicado antes de `e2`;
  - fevereiro, na escuta, ganha o delta de `e3`, e a marca mostra `pending = {v2: v3}`;
  - com `pending` não vazio, a prova falha. Depois de `e2`, a marca mostra `appliedVersion = v3`, diferente de `v1`, e `T` é lido de novo.
- **Fora da janela.** `T` que saiu da janela (caso c) continua lido por id, e `monthCommits` aponta o mês de antes.
- **Lançamento apagado.** Inclui a exclusão física pela ferramenta de limpeza. Se `T` não existe na leitura por id, a prova exige a marca em `state: 'deleted'`, com `pending` vazio e os meses de `monthCommits` na escuta. Sem marca, não há prova.
- **Sem prova.** A estimativa não converte. A interface mostra o estado "calculando" e depois o aviso de que a estimativa está em atualização, com os valores em reais. **Não existe prazo que vire aceitação.**

**Leitura das marcas.**
- **Como:** pelos mesmos ids das desconsideradas e dos espelhos de estorno, com `where(documentId(), 'in', lote)` e `limit(lote.length)`, em lotes de até 30, do servidor.
- **Quando:** depois do instantâneo da escuta, como acima.
- **Sem leitura atômica:** a leitura não precisa ser atômica com a de `T`. As versões só avançam, e a marca lida depois da escuta mostra tudo o que a escuta mostra. Uma divergência leva a ler de novo, nunca a uma prova falsa.

**Rules** (nova): `match /cash_projection_marks/{id}`, com:
- `get` para quem lê o workspace (`canReadWorkspaceScopedData`);
- `list` só com `request.query.limit <= 30`. A consulta do cliente põe `limit` igual ao tamanho do lote; a leitura atual por ids (`getTransactionsByIds`) não põe, e a das marcas terá de pôr;
- `write: false`;
- entrada em `isBackendOwnedCollection`.

A marca não tem valor nem texto do lançamento. Quem já lê `transactions` só ganha um metadado menor: os meses por onde o lançamento passou (`monthCommits`), um histórico de datas.

**Custo:**

| Onde | Custo |
| --- | --- |
| Gatilho | +1 leitura e +1 escrita por evento. Com 1.000 escritas por mês num workspace, +1.000 leituras e +1.000 escritas |
| Prova | +k leituras por id (k = desconsideradas e estornos, no máximo 100; na prática 0 a 5) a cada releitura |
| Armazenamento | uma marca por lançamento (algumas centenas de bytes) |
| Índices | nenhum composto (leitura por id; `documentId` é automático) |
| TTL | nenhum: a marca vive enquanto o lançamento existir e é apagada com o workspace (registrar em `DATA_RETENTION_LIFECYCLE.md`) |

**Riscos e mitigações:**

| Risco | Mitigação |
| --- | --- |
| Um defeito na marca bloqueia a projeção, porque a transação falha junto | o encadeamento fica em função pura, total e testada; estado inesperado vira `broken` com registro, nunca exceção |
| Escritor que não grava `updatedAt` | teste de contrato sobre todos os escritores e conferência no gatilho; a falha deixa a prova falhar, nunca passar |
| Concorrência na marca: duas entregas do mesmo lançamento | a transação serializa as duas; a disputa nos meses já existe hoje |
| Lançamento antigo sem marca | só depois da reconstrução (condição 1). A próxima escrita só avança o prefixo se `bv <= baselineCutoff`; senão, fica pendente até a reconstrução, e a prova falha até lá |

**Arquivos afetados:**

| Camada | Arquivos |
| --- | --- |
| Backend | `functions/src/cash/periods.ts` (`applyCashPeriodWriteOnce`); novo `functions/src/cash/projectionMarks.ts` (encadeamento puro); `functions/src/triggers/transactions.ts` (passar `before.updateTime`); `functions/src/cash/rebuild.ts` (`rebuildCutoff`) |
| Regras | `firestore.rules`; `tests/firestore/*` (suíte nova da coleção) |
| Cliente | `src/modules/work-time/consistency.ts`, `useIncomeEstimateWith.ts` e `receivableReversal.ts` (leitura das marcas); `src/modules/transactions/incomeReads.ts`; `src/modules/reports/basisSync.ts` (ler `rebuildCutoff`) |
| Documentação | `docs/production/DATA_MODEL.md`, `FIRESTORE_RULES`/`SECURITY_MODEL.md`, `DATA_RETENTION_LIFECYCLE.md`, `evidence/.../consistencia-estimativa.md` e o plano |

**Rollback:**
- **Cliente:** volta à alternativa D (prova estrita sem marca): nada é aceito sem prova, e a estimativa fica em reais.
- **Gatilho:** volta a não gravar marcas. As marcas ficam velhas e a prova falha: é fail-closed.
- **Dados e Rules:** a coleção é aditiva e só do backend, pode ficar ou ser apagada. Não há migração, porque não há dados reais de produção (CLAUDE.md, "Legado").

**Testes que provam:** §8.

### A′. Revisão por documento gravada pelos escritores

**Ideia:** cada escrita em `transactions` incrementa `revision` na mesma transação do escritor. O gatilho guarda, na marca de A, a última revisão contígua aplicada. O cliente compara com `T.revision`.

**O que já existe.**
- `cashEntry.revision` é avançada só pelas mutações do caixa (`functions/src/cash/mutateTransaction.ts:405-417`, `cashEntryPatch`).
- Os espelhos não a gravam: empréstimos, recebíveis, cartões, divisão de contas e investimentos, que sobrescreve com `set` (§2.1).

**Vantagens:**
- um inteiro é mais simples de comparar que o `updateTime`;
- a contiguidade fica explícita (`n − 1 → n`).

**Riscos:**
- exige mudar todos os escritores para incrementar a revisão (RQ3 e RQ6);
- uma escrita que esqueça a revisão quebra a cadeia: o mesmo risco do `updatedAt`, com menos proteção, porque o `updateTime` vem do próprio Firestore;
- `investments/cash.ts` sobrescreve o documento: a revisão teria de ser lida e incrementada ali.

**Arquivos:** os de A, mais todos os escritores da §2.1.

**Rollback:** reverter os escritores.

**Testes:** os de A, mais o contrato de revisão em cada escritor.

**Veredito:** não traz garantia além da do `updateTime` e muda os escritores. Fica como variante de A, só se o `updateTime` não puder ser usado.

### B. Projeção síncrona nos escritores

**Ideia:** cada escritor calcula `cashWritePlanFor` e grava os meses, os dias, as categorias e a marca na própria transação. O gatilho vira só conferência.

**Vantagens:**
- a projeção inclui toda escrita confirmada no mesmo commit;
- a prova fica trivial.

**Riscos:**
- muda mais de dez caminhos de escrita em oito domínios (§2.1), justamente o que o parecer pede para não tocar sem autorização separada;
- a disputa pelos meses passa para a transação da pessoa: o limite sustentado de cerca de 1 escrita por segundo no mesmo documento vira latência e erro de contenção na operação do usuário;
- a importação de 50 linhas multiplica as escritas por mês, dia e categoria por commit (limite de 500);
- a cerca da reconstrução precisa ser refeita para escritores concorrentes, e o espelho de investimentos sobrescreve com `set`.

**Arquivos:** todos os da §2.1, `periods.ts`, `rebuild.ts`, o gatilho, as Rules e os testes de cada domínio.

**Rollback:** caro, porque reverte escritores de vários domínios.

**Testes:** os da alternativa A mais concorrência e limite de commit em cada escritor.

**Veredito:** não recomendado neste ciclo (RQ3 e RQ6).

### C. Leitura consistente no backend (callable)

**Ideia:** uma callable genérica (sem menção à estimativa, RQ7) recebe os meses e os ids. Numa transação só de leitura do Admin SDK, com instante único, ela lê:
- os meses;
- os lançamentos;
- as marcas.

Depois aplica as regras de A no servidor e devolve a receita por mês, o valor de cada id e `proven`.

**Vantagens:**
- uma ida e volta;
- instante de leitura único;
- as marcas podem ficar sem leitura pelo cliente;
- a lógica da prova fica num lugar só.

**Riscos:**
- **sozinha, não prova nada:** um instante único não diz quais eventos o gatilho aplicou, então ela precisa das marcas de A;
- a alternativa de calcular a receita direto de `transactions` cria uma segunda fonte de receita, paralela à projeção que o relatório oficial usa (fonte concorrente, RQ3);
- perde a atualização em tempo real da escuta, porque precisa chamar de novo;
- traz início a frio, limite de taxa e App Check.

**Arquivos:** nova callable e contrato em `functions/src/reports/`, exportação, teste de contrato de deploy, cliente da estimativa.

**Rollback:** remover a callable; o cliente volta à prova local.

**Veredito:** complemento opcional de A, se a prova no cliente crescer. Não é a correção.

### D. Fallback estrito no cliente (sem backend)

**Ideia:** tirar o `expired`. A escrita limitada segura a estimativa até a versão do mês passar dela, sem prazo.

**Vantagem:** elimina a presunção do caso (a) imediatamente, sem tocar no backend.

**Riscos:**
- **não corrige (b) nem (c):** outra escrita do mês avança a versão, e o mês antigo continua desconhecido. D sozinho deixa o B03 aberto;
- depois de uma edição sem efeito na renda, a estimativa fica em reais até outra escrita tocar o mês, às vezes por meses (é o motivo de a R1 não o ter adotado).

**Arquivos:** `consistency.ts` e `useIncomeEstimateWith.ts`.

**Rollback:** trivial.

**Veredito:** é o comportamento **sem prova** de A (RQ4) e uma mitigação provisória, não a correção.

### E. Sequência contígua por workspace

**Ideia:** cada escritor pega um número sequencial de `workspaces/{ws}/cash_sequence` na própria transação. O gatilho mantém a marca d'água `appliedSeq`, contígua, com pendências. O cliente prova com `appliedSeq >= T.seq`.

**Vantagem:** um número só prova a inclusão de todas as escritas anteriores, cobre fora de ordem e mudança de mês, e a prova no cliente é mínima.

**Riscos:**
- todos os escritores mudam (RQ6);
- o contador é um ponto quente do workspace inteiro, com cerca de 1 escrita por segundo sustentada;
- um único evento travado (retentativa por até 23 h) bloqueia a prova de todos os lançamentos do workspace, não só do lançamento afetado;
- a reconstrução precisa redefinir a marca d'água.

**Arquivos:** os de B, mais o contador.

**Rollback:** caro.

**Veredito:** não recomendado (escala e disponibilidade).

## 6. Comparação

| Critério | A. marca por lançamento | A′. revisão do escritor | B. síncrona | C. callable (+A) | D. estrito | E. sequência |
| --- | --- | --- | --- | --- | --- | --- |
| Prova quais escritas entraram (RQ1) | sim, por lançamento, com a prova corrigida (`pending` vazio e a marca lida depois da escuta) | sim, por lançamento, com a mesma prova corrigida | sim | sim, com A e a prova corrigida | não | sim, por workspace |
| Fora de ordem e mudança de mês (RQ2) | sim (cadeia, `pending` vazio e `monthCommits`) | sim (idem) | sim | sim, com A | não | sim |
| Escritores intocados (RQ3, RQ6) | sim | não | não | sim | sim | não |
| Sem prova, sem conversão (RQ4) | sim | sim | sim | sim | sim | sim |
| Custo extra | +1 leitura e +1 escrita por evento; +k leituras por prova | o de A | contenção no caminho do usuário | +1 callable por atualização | nenhum | ponto quente por workspace |
| Falha isolada | por lançamento | por lançamento | por operação | por chamada | — | o workspace inteiro |
| Esforço e risco | médio | alto (todos os escritores) | alto | médio (sobre A) | baixo | alto |

## 7. Recomendação

1. **Adotar A**, com o comportamento de D quando não houver prova. A interface mostra "estimativa em atualização" e mantém os valores em reais. Não há presunção.
2. **Ordem de implementação**, numa etapa própria (P5-F.1-R3) e depois desta revisão:
   - (i) função pura do encadeamento, com testes de propriedade (ordem aleatória de entrega, reentrega e corte);
   - (ii) gravação da marca no gatilho e `rebuildCutoff` na publicação, com os testes de integração no Emulator da §8;
   - (iii) Rules e suíte;
   - (iv) nova regra 5 no cliente, com remoção do `expired` e da espera que vira aceitação (a espera fica só como tempo de "calculando");
   - (v) E2E;
   - (vi) `regression-release-gate`, com `financial-domain-integrity`, `firestore-scale-cost-review` e `multi-tenant-security-review`.
3. **Até lá:** a etapa global segue em **FAIL**. Fica decidido se D entra antes como mitigação provisória, porque fecha (a) mas não (b) nem (c), à custa de mais tempo em reais.

## 8. Testes que provam (determinísticos, no Emulator)

Os eventos são entregues pela função do gatilho (`handleTransactionWrite` ou `applyCashPeriodWriteOnce`), com pares `before/after` e `updateTime` explícitos, como as suítes atuais já fazem (§2.6).

| Cenário | Como | Esperado |
| --- | --- | --- |
| Fora de ordem | e1 (10.000 → 30.000) e e2 (30.000 → 50.000) de `T`, entregues e2 e depois e1 | depois de e2: `appliedVersion = v0`, `pending = {v1: v2}`, prova de `T@v2` falha; depois de e1: `appliedVersion = v2`, prova passa; o total de `P` é igual ao da ordem de commit |
| Permutações | propriedade: 3 a 6 escritas de vários lançamentos, todas as ordens de entrega, com reentregas e leituras de `T` em qualquer ponto | prova verdadeira ⇒ a estimativa é igual ao valor exato (a receita da projeção com `T@v` tirado); projeção final igual à da ordem de commit |
| Fora de ordem com mudança de mês e leitura velha (revisão independente da R2A, T02) | `T` desconsiderada lida em `v1` (março, 10.000); outra sessão grava `e2` (março → fevereiro) e `e3` (10.000 → 30.000); o gatilho entrega `e3` antes de `e2` | com `pending = {v2: v3}`, a prova de `T@v1` falha, inclusive com a marca relida; depois de `e2`, `appliedVersion = v3`, e `T` é lida de novo; em nenhum ponto a estimativa provada difere do valor exato |
| Reentrega idempotente | o mesmo `event.id` 2 vezes, e 6 em paralelo | um delta aplicado, marca inalterada na reentrega |
| Data retroativa e mudança de mês | `T` de março para dezembro do ano anterior, dentro e fora da janela | `monthCommits` com os dois meses; a prova exige a escuta de março posterior ao commit; antes disso, a estimativa não converte |
| Valor, tipo e liquidação | 10.000 → 30.000; receita → despesa; pendente → pago e pago → anulado | delta certo e prova só com o prefixo aplicado |
| Estorno de recebimento | recebimento desconsiderado e espelho do estorno criado por outra sessão | prova exige as duas marcas (o par do B01) |
| Exclusões pessoais | mudar a lista de desconsideradas (só no cliente) | prova refeita com as marcas dos novos ids; nada no backend lê a preferência (guarda) |
| Reconstrução | corte entre e1 e e2; publicação com e2 já aplicado e com e2 depois; e, depois da publicação, `e3` entregue antes de `e2` | `T@v1` provado pela condição 1 (`rebuildCutoff`) só enquanto a marca não mostra evento depois do corte; `T@v2` pela cadeia que começa no corte; com `e3` pendente, nenhuma das duas condições vale |
| Ordem das leituras | a marca lida antes de a escuta mostrar um mês com o delta de `T` | a prova é refeita quando a escuta muda; a marca lida antes da escuta nunca prova nada |
| Falha do gatilho | falha injetada antes e depois do commit (ganchos `faults` já existentes) e janela esgotada | sem marca nova; prova falha (sem conversão); depois da reconstrução, passa |
| Contrato de versão | escritor de teste sem `updatedAt` | `contract_violation`, marca `broken`, prova falha |
| Concorrência entre pessoas | duas sessões editam desconsideradas diferentes do mesmo mês ao mesmo tempo | duas marcas; a prova espera as duas |
| Contas e workspaces | marca lida por membro, por não membro e por outro workspace; cliente tenta escrever | `get` permitido só a quem lê o workspace; `list` só com `limit <= 30`; escrita negada (suíte de Rules com dois tenants) |
| 12 meses | janela de 12 meses mais o mês extra (13 documentos), desconsideradas em vários meses | uma consulta escutada e no máximo 100 leituras por id por prova |
| Custo | contagem de leituras e escritas por evento no teste de integração | +1 leitura e +1 escrita por evento, sem consulta nova |
| E2E | editar em outra sessão o valor de uma desconsiderada | a estimativa nunca mostra valor convertido com as fontes divergentes; volta a converter quando a marca e a escuta conferem |

## 9. Riscos residuais e decisões pendentes

| ID | Decisão ou risco | Recomendação |
| --- | --- | --- |
| D-B03-1 | Marcar todos os eventos ou só os de documentos com efeito em receita | todos: sem acoplar o gatilho à classificação de receita; otimizar depois, se o custo pesar |
| D-B03-2 | Adotar D como mitigação provisória antes de A | só se a próxima etapa demorar; troca a presunção por mais tempo em reais |
| D-B03-3 | Limite de pendências por marca (32) | medir no teste de propriedade; acima dele, `broken` com `needsRebuild` |
| D-B03-4 | Lançamento antigo sem marca e sem reconstrução | fica sem prova até a próxima escrita ou reconstrução; não há dado real em produção, e o seed recria |
| R-B03-1 | A transação do gatilho fica maior: +1 leitura, +1 escrita | dentro dos limites; teste de custo |
| R-B03-2 | A reconstrução não reescreve marcas: a prova depende de `rebuildCutoff` nos meses e de a marca não mostrar evento depois do corte | teste dedicado (§8, reconstrução) |
| R-B03-3 | Uma pendência longa (o evento anterior em retentativa por horas) deixa a estimativa em reais nesse tempo | é o comportamento fail-closed pedido; o aviso de "estimativa em atualização" explica, e a reconstrução encerra a espera |

## 10. Rastreabilidade com os critérios do parecer

| Critério do parecer | Onde a proposta atende |
| --- | --- |
| Não inferir consistência só pela igualdade dos totais ou pelo `updatedAt` da projeção | §3; A usa a cadeia de versões por lançamento e o commit de cada mês tocado |
| Demonstrar quais escritas foram aplicadas; mudança de mês e fora de ordem | §5.A: `appliedVersion`, `pending` vazio, `monthCommits` e a marca lida depois da escuta. §8, com o contraexemplo da revisão independente da R2A (T02) como cenário |
| Preservar idempotência, reconstrução, centavos, projeções oficiais e vários escritores | §5.A: a marca de entrega continua decidindo a aplicação; a reconstrução só ganha `rebuildCutoff`; nenhum escritor muda |
| Recusar a conversão sem reconciliação; BRL como fonte de verdade | §5.A (prova falha leva a não converter) e §7 |
| Transação, workspace, custo, 12 meses, retroativa e exclusões | §5.A (Rules, custo) e §8 |
| Nada de refatoração do ledger, billing, funcionalidade nova ou deploy | §1 e §7 (etapa própria, com revisão) |
