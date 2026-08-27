# Limites operacionais declarados

Cada teto do produto, com a prova de que é seguro, o que acontece ao ser
atingido, e a estratégia para volumes acima dele.

A regra que organiza o documento vem de `AGENTS.md`: **limite operacional
explícito é aceitável; truncamento silencioso não é.** Um limite só passa nesta
revisão se, ao ser atingido, alguém fica sabendo — por erro nomeado, por sinal
devolvido ao chamador **e** exibido na tela, ou por ambos.

---

## 1. Placar

| # | Limite | Valor | Ao atingir | Chega ao usuário? |
| - | ------ | ----- | ---------- | ----------------- |
| 1 | Aportes somados numa transação | 2.000 | Erro nomeado (vínculo em lote) / base por delta (gatilho) | Sim — e agora há rotina de volta |
| 2 | Aportes na reconstrução de meta | 100.000 | Erro nomeado, nada publicado | Sim |
| 3 | Períodos de caixa lidos | 600 | Sinal de truncamento; saldo vira "indisponível" | **Sim (novo)** |
| 4 | Janela de transações | 20.000 | `truncated: true` | **Sim (novo)** |
| 5 | Janela padrão do painel | 12 meses | Recorte deliberado | Sim, por desenho |
| 6 | Baldes diários da reconstrução | 2.000 | Erro nomeado | Sim |
| 7 | Faixas de alocação | 400 | Erro nomeado | Sim |
| 8 | Períodos de relatório | 240 | Erro nomeado | Sim |
| 9 | Períodos retroativos | 24 | Erro nomeado | Sim |
| 10 | Posições por workspace na deriva | 500 | Registro `inconclusive` | Não (operacional) |
| 11 | Escritas por transação de rebuild | 110 | Erro nomeado | Sim |
| 12 | Reinícios de rebuild | 10 | Erro nomeado | Sim |

---

## 2. Teto de 2.000 aportes numa transação

`GOAL_CONTRIBUTIONS_SCAN_LIMIT` (`functions/src/goals/operations.ts:240`) e o
espelho `GOAL_PROGRESS_SCAN_LIMIT` (`functions/src/triggers/transactions.ts:50`).

**Por que existe.** Uma transação do Firestore não lê o histórico inteiro de
uma meta grande, e refazer o vínculo de todos os aportes de uma vez estouraria
o limite de escritas da transação. É limite físico da plataforma, não escolha.

**Seguro?** Sim, e por três caminhos diferentes conforme o que se está fazendo:

- **vínculo em lote** (`setGoalTransactionLinks`) — falha explicitamente, em
  pt-BR, dizendo para ajustar aporte a aporte. Nada parcial é gravado;
- **gatilho de transações** — acima do teto o progresso passa a ser mantido
  **por delta** (`depois − antes` por escrita), que é exato para cada escrita e
  não depende de somar o histórico;
- **arquivamento** — devolve `historyTruncated` e uma contagem limitada.

**Dado incorreto?** Não. O caminho por delta é aritmeticamente exato: cada
escrita aplica sua própria diferença. O que ele perde é a autocorreção — uma
divergência acumulada não se conserta sozinha.

**Estratégia acima do teto.** A reconciliação é o item 3 abaixo, e ela agora
tem superfície: *Configurações › Cadastros › Operação do domínio patrimonial ›
Reconstruir o progresso de uma meta*. Até esta fase a callable existia sem
nenhum chamador no produto — os dois caminhos que abandonam a soma exata
apontavam para uma rotina que ninguém conseguia disparar.

---

## 3. Teto de 100.000 aportes na reconstrução

`GOAL_CONTRIBUTIONS_REBUILD_LIMIT` (`functions/src/goals/operations.ts:547`).

**Por que existe.** A reconstrução soma **fora** da transação, por páginas com
cursor ordenadas por `__name__`, então não herda o teto da transação. O teto
aqui é do produto, não da plataforma.

**Seguro?** Sim. A varredura acontece **antes** de abrir a transação, e o
estouro lança antes de qualquer escrita: *"A meta X ultrapassou 100000 aportes
vinculados. Nenhum valor parcial foi publicado."*

**Dado incorreto?** Impossível por construção: ou publica o valor absoluto
completo, ou não publica nada.

**Custo e tempo.** 100.000 aportes em páginas de 300 são ~334 consultas
sequenciais. A callable roda com 540 s e 512 MiB — perfil que ela **não tinha**
antes desta fase: herdava o padrão de 60 s da plataforma, e o corte por tempo
aconteceria justamente nas metas grandes, as únicas que precisam da rotina. A
garantia está travada por teste
(`functions/src/shared/deploymentContract.test.ts`).

**Estratégia acima do teto.** Uma meta com mais de 100.000 aportes vinculados é
sinal de modelagem errada (aportes deveriam estar agregados). O caminho é
dividir a meta ou agregar os aportes; elevar o teto só empurra o problema.

---

## 4. Teto de 600 períodos de caixa

Frontend `MAX_CASH_PERIODS` (`src/modules/transactions/cashPeriods.ts:47`),
Rules (`request.query.limit <= 600`) e backend (`functions/src/cash/rebuild.ts`,
erro nomeado).

**Por que é seguro.** O teto é **estrutural**: a projeção tem exatamente um
documento por mês com movimento. 600 meses são 50 anos de histórico contínuo —
inalcançável antes de o produto ter 50 anos.

**O que era truncamento silencioso.** A leitura pedia `limit(600)` sem sonda: no
teto, o saldo somado sairia menor que o real, e com ele o progresso das metas PJ
de caixa mínimo — sem erro, sem log, sem sinal.

**O que mudou.** A consulta detecta o corte (`truncated`), e
`cashBalanceFromPeriods` devolve `undefined` em vez de um saldo subestimado. As
duas superfícies de meta declaram a limitação: o cartão marca *"saldo
incompleto"* e a tela de detalhe exibe o aviso completo em pt-BR.

**Estratégia acima do teto.** Consolidar períodos antigos em documentos anuais e
manter os mensais só da janela recente. Não é trabalho pendente: é o desenho
para quando o produto tiver histórico que justifique.

---

## 5. Janela de 20.000 transações

`TRANSACTION_PAGE_SIZE = 500` × `MAX_TRANSACTION_PAGES = 40`
(`src/modules/transactions/api.ts:196` e `:202`).

**Por que é seguro.** É teto de páginas, não de dado: a consulta é ordenada por
`date` com cursor por `documentId()`, então nada é pulado — o que passa do teto
simplesmente não foi lido, e isso é **declarado**.

**O que era truncamento silencioso.** A faixa "tudo" do relatório já avisava. A
janela **padrão** de doze meses — que alimenta painel, metas, alocações e
relatórios de período — descartava o sinal antes de chegar à tela: um workspace
acima do teto veria agregados incompletos apresentados como totais.

**O que mudou.** `getTransactions` devolve o par `{items, truncated}`,
`useTransactions` expõe `isTruncated`, e o relatório exibe o aviso para as duas
origens.

**Estratégia acima do teto.** Um workspace com mais de 20.000 transações em doze
meses precisa de agregados no servidor, não de janela maior. A projeção mensal
de caixa já é esse padrão para o saldo; os agregados de empréstimo introduzidos
nesta fase são o mesmo padrão. Estender para categorias e centros de custo é a
continuação natural.

---

## 6. Janela padrão de 12 meses

`DEFAULT_TRANSACTION_WINDOW_MONTHS` (`src/modules/transactions/api.ts:193`).

**Não é truncamento; é recorte.** O produto pede doze meses porque é o que as
telas mostram sem pedido explícito. O histórico completo continua acessível pela
faixa "tudo" do relatório, que é paginada e sinaliza truncamento.

**Seguro?** Sim, com uma ressalva registrada: `monthsAgoDateOnly` calcula o
início da janela em UTC, enquanto os recortes do relatório foram corrigidos para
`America/Sao_Paulo` (INV-P2-048). A diferença é de até um dia na borda da
janela, e afeta apenas quais transações entram na carga padrão — nenhum
agregado publicado depende dela. Fica registrado como dívida conhecida, de
severidade baixa.

---

## 7. Tetos internos da reconstrução

| Constante | Valor | Arquivo | Ao atingir |
| --------- | ----- | ------- | ---------- |
| `MAX_DAILY_BUCKETS` | 2.000 | `investments/projectionRebuild.ts:97` | Erro nomeado, com a dimensão |
| `MAX_ALLOCATION_BUCKETS` | 400 | `:80` | Erro nomeado |
| `MAX_REPORT_PERIODS` | 240 | `:81` | Erro nomeado |
| `MAX_WRITES_PER_REBUILD_TRANSACTION` | 110 | `:104` | Erro nomeado |
| `MAX_REBUILD_RESTARTS` | 10 | `:199` | Erro nomeado |
| `MAX_RETROACTIVE_PERIODS` | 24 | `investments/reporting.ts:137` | Erro nomeado |

Todos existem pelo mesmo motivo: o checkpoint da reconstrução é **um
documento**, e um documento do Firestore tem 1 MiB. Todos falham fechado, com
mensagem em pt-BR que nomeia a dimensão estourada. Nenhum trunca.

---

## 8. Deriva: 500 posições por workspace

`DRIFT_POSITIONS_PER_WORKSPACE` (`functions/src/crons/investmentDrift.ts:61`).

Único teto da lista que **não** falha e **não** avisa o usuário — e está certo
assim: a rotina é de diagnóstico, roda por amostragem em rodízio de 50
workspaces por dia, e acima do teto marca a conferência como `inconclusive` no
próprio registro em vez de reportar uma comparação parcial como se fosse
conclusiva.

**Estratégia acima do teto.** Comparar por agregado do servidor em vez de somar
posição a posição. Enquanto isso, `inconclusive` é a resposta honesta.

---

## 9. Tetos introduzidos nesta fase

Todos com `orderBy` determinístico, `limit` e sonda `n+1` para detectar o corte.

| Coleção | Teto | Sinal |
| ------- | ---- | ----- |
| `loans` (listagem) | 100/página | `hasMore` → "Carregar mais empréstimos" |
| `loan_movements` | 100/página | `hasMore` → "Carregar movimentações anteriores" |
| `recurring_expenses` (listagem) | 100/página | `hasMore` → "Carregar mais assinaturas" |
| `recurring_expenses` (resumo, só ativas) | 500 | `truncated` → aviso em pt-BR |
| `recurring_occurrences` | 1.000 na janela | Janela de 13 meses; teto é folga |
| `split_groups` | 100/página | `hasMore` → "Carregar mais grupos" |
| `split_bills` por grupo | 300 | `truncated` → aviso em pt-BR |
| `split_shares` por grupo | 500 por bloco de 30 títulos | `truncated` propagado |
| `split_participants` | 200 | Teto de folga |
| `split_invites` | 100 | Teto de folga |

Os totais financeiros das telas de empréstimo **não** saem da lista paginada:
são agregados do servidor (`getLoanTotals`, com `sum()` e `count()`), exatos
sobre a coleção inteira e sem ler documento. Sem essa separação, paginar teria
transformado três indicadores financeiros em somas silenciosamente parciais —
trocar um problema de custo por um de correção.
