# FIRESTORE-01 — leituras de lançamentos sem a janela de 12 meses (P5-GATE-FINAL)

Correção autorizada pelo usuário na P5, sem reatribuir à P10. Este documento separa **medições** (contagens tiradas
de execuções no Emulator ou do modelo em memória dos testes) de **estimativas** (fórmulas aplicadas a cenários, sem
medição em produção). O Emulator não mede leitura faturável: as contagens abaixo são **documentos devolvidos pelas
consultas**, que é a base da cobrança de leitura do Firestore. Cada consulta ainda custa cerca de 2 acessos das Rules
(`isMember` lê a conta e o vínculo do membro), que **não estão contadas** nas tabelas (FIRESTORE-09).

**2ª rodada de revisões (árvore `201749e8`; correções feitas depois).** A revisão de Firestore deu PASS e registrou o
FIRESTORE-08 (LOW, teto da lista e avisos de truncamento sem prova na guarda), corrigido, e o FIRESTORE-09 (INFO,
imprecisões desta evidência), corrigido neste texto. A legenda do widget, o estado de carregamento e a nota do FIN-08
estão na §3. As correções foram aprovadas pela execução oficial `verify-all-p5gate-4` (saída 0; a medição da §4 e o E2E novo do
teto do widget no log) e pela 3ª rodada de revisões; aprovado no código pelo gate final (a P5 aguarda só a evidência do E-00).

## 1. Consumidores, finalidade e uso dos documentos (antes)

Árvore antes da correção: `2c60abca` (execução oficial `verify-all-p5gate-1`).

| Consumidor | O que lia | O que mostrava |
| --- | --- | --- |
| Carga do aplicativo (`App.tsx`, `useTransactions`) em **qualquer tela** | Todos os lançamentos com `date` a partir do mesmo dia de 12 meses atrás, em páginas de 500 por cursor (`date` desc, id desc), até 40 páginas (**até 20.000 documentos**); anulados e inválidos descartados no navegador | Nada por si: alimentava os dois consumidores abaixo |
| "Transações Recentes" (Dashboard) | A janela inteira, filtrada por tipo e ordenada por coluna no navegador | 9 itens |
| Lista de Receitas ou Despesas | A janela inteira, filtrada no navegador pelo mês do Header e pelo tipo | O mês e o tipo; um mês anterior à janela aparecia **vazio**; acima de 20.000 documentos a lista saía **truncada sem aviso** (o `isTruncated` existia e nenhuma tela o lia) |
| Mutação nesta aba (caixa, empréstimos, recebíveis, contas e os demais domínios que chamam `invalidateTransactionDependents`) | A janela inteira de novo (consulta sempre ativa) | — |

Finalidade da janela: comentário de `api.ts` ("cobre tudo que o produto consulta sem pedido explícito"). Depois da
P5-C1, Dashboard, gráficos, relatórios e metas passaram ao relatório oficial (`getFinancialReport`) e às projeções;
os únicos consumidores restantes eram os dois acima.

## 2. Abordagens avaliadas

| Abordagem | Decisão |
| --- | --- |
| Consulta por período com cursor (lista do mês) | **Adotada.** O mês e o tipo pedidos, inteiros, por cursor: busca, filtros, total, média e ordenação da tela continuam sobre o conjunto completo do mês |
| Consulta limitada às mais recentes (widget) | **Adotada.** Até as 9 mais recentes do tipo do filtro na janela de 12 meses, pela ordem do próprio widget (`date` desc, id desc), em páginas de 10 até juntar 9 válidas (no máximo 10 páginas) |
| Ordenação por coluna no Firestore sobre os 12 meses (preservaria o "top 9 por valor em 12 meses") | **Não adotada.** Exige `orderBy` por valor, descrição ou categoria com filtro de intervalo em `date`. O Emulator aceitou (sonda `p5gate/sondas/probe-orderby.cjs`; a saída não foi arquivada). A regra da documentação oficial do Firestore sobre a ordem das ordenações com filtro de intervalo **não foi conferida nesta sessão** (o host da documentação ficou bloqueado), e não há STAGING para confirmar. **A decisão não depende dela:** a abordagem exigiria 12 índices compostos novos (3 colunas × 2 direções × com ou sem tipo) na coleção de maior volume de escrita, sem como conferi-los antes da P6 (o Emulator não exige índice composto, READ-11). O widget passou a dizer na tela que a ordenação vale para as exibidas (critério do usuário) |
| Agregação (`count`/`sum`) | Não se aplica: as telas mostram itens, não totais oficiais (os totais oficiais já vêm do relatório) |
| Projeção consolidada | Não se aplica: seria uma segunda fonte de verdade dos lançamentos |
| Compartilhar uma consulta entre os dois consumidores | Não adotada: os dois recortes são diferentes (9 mais recentes × mês inteiro de um tipo); juntar voltaria a ler mais do que cada tela mostra |
| `limit` fixo na lista do mês | Recusado: um mês cortado seria apresentado como completo. A lista lê o mês inteiro; acima de 40 páginas (20.000 do mesmo tipo no mês) avisa que a lista e os totais não incluem tudo |

## 3. Comportamento depois

| Superfície | Consulta | Ordem | Atualização |
| --- | --- | --- | --- |
| Abertura do app | Nenhuma leitura de lançamentos | — | — |
| "Transações Recentes" | `type ==` (se filtrado), `date >=` início da janela, `date` desc, id desc, `limit(10)` por cursor, até 10 páginas; anulados e inválidos pulados | A mesma de antes; a ordenação por coluna reorganiza só as exibidas e a legenda diz isso, com menos de 9 e em qualquer estado: "Mostra até as 9 mais recentes dos últimos 12 meses. Ordenar por coluna reorganiza só as exibidas." (`src/components/RecentTransactions.tsx:122`) | Relida na mutação desta aba só se estiver na tela |
| Lista de Receitas ou Despesas | `type ==`, `date` do dia 01 ao 31 do mês do Header, `date` desc, id desc, páginas de 500 com um documento de sonda, até 40 páginas | A mesma de antes (a tela ordena o conjunto completo) | Relida na mutação desta aba só se estiver na tela; ao trocar de mês, lê o mês novo |
| Estados | Carregando: "Carregando os lançamentos do mês…", sem contagem, total nem "nenhuma transação". Falha: "Não foi possível carregar os lançamentos deste mês." com "Tentar novamente". Teto: "Este mês tem mais lançamentos do que a lista consegue carregar: a lista, o total e a média não incluem todos." Widget: ao trocar o filtro, enquanto a consulta carrega, a tabela mostra "Carregando transações recentes…" (PTBR2-05; `RecentTransactions.tsx:196`) e não fica vazia; falha: "Não foi possível carregar as transações recentes." com "Tentar novamente"; teto de páginas antes das 9: "Não foi possível reunir as 9 mais recentes: veja a lista completa em Receitas ou Despesas." (`RecentTransactions.tsx:200-205`) | | |

Isolamento, Rules, filtros, pendentes, estornos e valores: as consultas são do mesmo `workspaces/{id}/transactions`,
lidas pelo SDK do cliente com as Rules de sempre (todo membro ativo; removido e outro workspace negados, suíte
`tests/firestore/transactions-reads-p5gate.rules.integration.test.mjs`). Pendentes entram como antes (nenhum filtro
de estado); estornos de recebível entram na lista de Despesas como antes; anulados ficam de fora como antes; a
normalização é a mesma (`normalizeTransactionData`). Índices: o simples de `date` e o composto já declarado
(`type`, `date` desc, `__name__` desc). Nenhuma migração nem compatibilidade com dado legado.

**Nota do FIN-08 (INFO, nenhum valor afetado).** O aviso "lançamentos com dados inconsistentes não exibidos neste mês" conta
agora só o tipo e o mês exibidos (`invalidCount` de `pagedWindow`, `src/modules/transactions/api.ts:210-217`;
`TransactionsView.tsx:560-565`). Um documento fora do contrato com tipo desconhecido, dia sem zero ou dia acima de 31 deixa
de ser avisado em qualquer lista, porque nenhuma consulta o alcança. Nenhum valor é afetado: o gatilho do caixa marca
`contract_violation` e nenhum escritor produz esse documento. Registrado no plano §20.21.

## 4. Medições

**Emulator** (`tests/firestore/transactions-reads-p5gate.rules.integration.test.mjs`, conjunto determinístico de
4.635 lançamentos de 2024-10 a 2026-12, 3.075 na janela; linha `MEDICAO-FIRESTORE-01` do log):

| Leitura | Documentos devolvidos |
| --- | --- |
| Carga antiga (janela de 12 meses) | **3.075** |
| "Transações Recentes" | **10** |
| Lista de Despesas do mês movimentado (1.243 despesas) | **1.245** (as 1.243 e um documento de sonda por página cheia) |
| Lista de Receitas de um mês comum (40 receitas) | **40** |

**Simulação em memória (não é medição do Firestore)** (`tests/unit/transactions-reads.test.ts`, o mesmo algoritmo de
paginação do app, com a fonte ordenada como a consulta; conta os documentos que a simulação devolveria): com 20.000
lançamentos na janela, o widget lê 10 e a carga antiga lia 20.000; com 1.203 despesas no mês e 18.000 outros
lançamentos, a lista lê 1.205; com 20.001 do mesmo tipo no mês, a lista volta truncada com **20.040** documentos lidos, o
teto real (40 páginas de 500 mais o documento de sonda de cada uma).

## 5. Estimativas (não são medições)

Fórmulas, com `N12` = lançamentos com `date` na janela de 12 meses (inclusive espelhos de investimento, de fatura, de
recebível e de empréstimo) e `M` = lançamentos do tipo da tela no mês do Header:

- **Antes:** cada abertura do app e cada mutação nesta aba: `min(N12, 20.000)`, em qualquer tela.
- **Depois:** abertura no Dashboard: 10 (até 100 se houver anuladas demais entre as recentes); outras telas: 0; lista
  aberta: `M + max(0, ⌈M/500⌉ − 1)` (cada página cheia de 500 traz um documento de sonda, menos a última); teto de
  **20.040** documentos (40 páginas de 501); mutação nesta aba: só a consulta da tela visível (10 no Dashboard,
  `M + max(0, ⌈M/500⌉ − 1)` na lista). Fora destas contagens: cerca de 2 acessos das Rules por consulta (+2 no widget e
  cerca de +6 na lista de 3 páginas), não contados.

| Cenário (estimativa) | Antes, por carga e por mutação | Depois: Dashboard | Depois: lista do mês |
| --- | --- | --- | --- |
| PF com 120 lançamentos por mês (premissa: 20 receitas, 90 despesas e 10 de outros tipos) | ≈ 1.440 a 1.560 | 10 | Receitas ≈ 20; Despesas ≈ 90 |
| PJ com 2.000 lançamentos por mês (premissa: 1.500 despesas e 500 receitas) | 20.000 (teto; a lista podia sair truncada sem aviso) | 10 | Despesas de 1.500: 1.502; Receitas de 500: 500 |
| Sessão com 20 mutações no Dashboard (PJ acima) | ≈ 420.000 | ≈ 210 | — |

## 6. Testes

| Critério do usuário | Prova |
| --- | --- |
| Paginação sem duplicidade nem omissão | Unidade (bordas de página com anuladas, 3 páginas de 1.203) e Emulator (3 páginas, `[501, 501, 243]`); E2E com 520 receitas num mês: 520 descrições distintas |
| Ordenação correta e estável | 300 conjuntos aleatórios com semente fixa, nos 4 filtros, iguais ao resultado antigo; empate por id no Emulator |
| Filtros e períodos | Todo dia válido de 1999 a 2101 no intervalo do mês e nenhum dia vizinho; bordas 30/09 e 01/11 fora; mês anterior à janela completo (antes vazio) |
| Atualização após inclusão, edição e exclusão (anulação) | E2E `transactions-reads-p5gate.spec.ts`: lista e widget conferidos contra o Firestore depois de cada operação, sem recarregar |
| Grandes volumes | 20.000 na janela (widget lê 10); 20.001 no mês (volta truncada, com 20.040 documentos lidos na simulação) |
| "A tela avisa" no teto (FIRESTORE-08) | Lista: a guarda `tests/unit/transactions-reads.test.ts:289-300` prende os tetos (`TRANSACTION_PAGE_SIZE = 500`, `MAX_TRANSACTION_PAGES = 40`), os dois filtros de data da janela paginada e as ligações do teto às telas (`isTruncated` nos dois ganchos, `App.tsx:578` e o aviso de `TransactionsView.tsx:554`). Widget: a mesma guarda (aviso de `RecentTransactions.tsx:200`) e o E2E novo `e2e/transactions-reads-p5gate.spec.ts:281`: com 100 anuladas entre as recentes, o widget mostra os 3 válidos que reuniu e o aviso "Não foi possível reunir as 9 mais recentes: veja a lista completa em Receitas ou Despesas." |
| Isolamento nos dois sentidos (MT-04) | `tests/firestore/transactions-reads-p5gate.rules.integration.test.mjs:325-345`: removido de A e owner de B recusados em A; owner, member e viewer de A recusados em B, nas duas formas de consulta; B lê só o que é de B |
| Redução das leituras | Medições da §4 |
| Sem regressão no Dashboard e nas transações | E2E `cash-manual-entries`, `cash-pending-entries`, `regression-smoke`, `ux-navigation-a11y`, `workspace-membership` (20/20) e o `verify:all` oficial |
| Provas vermelhas | F1 a F4 (guardas e algoritmo) e E1 (o E2E reprova a árvore anterior: widget e lista do mês). 2ª rodada (FIRESTORE-08): 9 mutantes (5 em `api.ts`: teto e tamanho de página e filtro de data; 4 na ligação do aviso: `hooks.ts`, `App.tsx`, `TransactionsView.tsx` e `RecentTransactions.tsx`), **9 de 9 vermelhos** na guarda (`p5gate/logs/mutantes-fs08.log`); antes da correção, 4 de 6 mutantes do revisor sobreviviam |

**Contagem de testes da 2ª rodada:** unidade `transactions-reads.test.ts` 15 (eram 14), Rules `transactions-reads-p5gate` 5, E2E `transactions-reads-p5gate.spec.ts` 4 (eram 3). A execução oficial da árvore final e o gate final vêm depois destas correções: aguardando a execução oficial e o gate final.
