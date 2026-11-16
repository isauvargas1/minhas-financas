# P5-C1 — tabela de custo do relatório oficial

Estimativas derivadas do código (revistas após a revisão independente: o widget do Dashboard deixou de pedir `cards`/`debts` e o ranking PJ só é lido com `debts` pedido) (`functions/src/reports/*.ts`, `functions/src/cash/periods.ts`), não medidas em produção: o Emulator não mede leituras faturáveis. Agregações (`sum`/`count`) contam como 1 leitura por até 1.000 entradas de índice casadas. "Realista" assume 3 cartões ativos, 15 categorias usadas, até 1.000 contas/faturas/recebíveis por filtro; "teto" é o limite imposto pelo código.

## Custo fixo por chamada de `getFinancialReport`

| Etapa | Leituras | Escritas |
| --- | --- | --- |
| Resolução do ator no kernel (`users`, `workspaces`, `members`) | 3 | 0 |
| Releitura do ator na transação do limite de taxa | 3 | 0 |
| Limite de taxa (300 por hora por usuário e workspace) | 1 | 1 |
| Workspace + estado da projeção (`getAll`) | 2 | 0 |
| **Subtotal** | **9** | **1** |

## Por bloco

| Bloco | Fonte | Leituras (realista) | Teto |
| --- | --- | --- | --- |
| `accounts` | `cash_accounts` (soma + contagem; contagem de negativas) | 2 | 2 por 1.000 contas |
| `cash`, `kpis`, `series` | `cash_report_periods` dos meses da janela (`getAll`); "tudo": consulta ordenada + primeira compra no cartão e primeiro período de investimento (2 leituras de 1 documento, para o início do período) | 7d: 1–2 · 30d: 2 · 90d: 3–4 · 12m: 12 · ano: ≤ 12 · mês: 1 · tudo: nº de meses com dado + 2 | 601 + 2 documentos ("tudo") |
| `categories` | `cash_category_years` por prefixo de ID (1 consulta por ano da janela) + nomes do catálogo por ID | 30d: ~15 + 15 · 12m: ~30 + 15 | 2.000 documentos (acima: `truncated`) + nomes |
| `cards` | numa transação somente leitura (P5-C1.1): lista de cartões, 4 agregações de obrigações, lista de vencimentos (≤ 151) e, por cartão (ativo ou arquivado), 4 leituras de classificação — pendente, atraso e as duas candidatas à fatura atual (consultas limitadas a 1 documento); fora dela, 3 agregações globais da janela e, por cartão listado (ativos e arquivados com saldo), compras, pagamentos e estornos da janela; série de compras (1 agregação por mês, ≤ 36 meses); +1 agregação por cartão (P5-C2 (§20.7), aguardando auditoria independente, crédito não aplicado: `sum(totalCents)` das abertas com total negativo) | 30d: ~3 + 7 + 3 + 21 + 2 + 3 (crédito, P5-C2) ≈ 39 · 12m: ≈ 49 · tudo: ≈ 73 (+4 por cartão arquivado; +3 se ele tiver saldo) | 51 cartões, 50 × 8 leituras, 151 vencimentos, 36 agregações de série |
| `debts` | empréstimos (2 tipos × 2 agregações); recebíveis (4 agregações); ranking de clientes **só PJ e só com o bloco `debts` pedido** (amostra ordenada por vencimento, sonda de 501 + nomes por ID) | PF: 8 · PJ (Relatórios): 8 + amostra + 5 · alertas sem o bloco: 8 | PJ: 8 + 501 + 5 |
| `investments` | `investment_summaries/current` (não para viewer) + `investment_report_periods` dos meses da janela | 30d: 1 + 2 · 12m: 1 + 12 | 1 + 601 ("tudo") |
| `alerts` | derivados dos blocos acima | 0 | 0 |

Isolamento de falhas (L8, P5-C2 (§20.7), aguardando auditoria independente): os blocos `accounts`, `cards`, `investments` e `debts` são lidos isoladamente; uma falha passageira só substitui o bloco por `unavailable`, sem leitura extra. Blocos isolados não mudam leituras; o caixa não é isolado.

## Cenários

| Cenário | Leituras (estimativa) | Observação |
| --- | --- | --- |
| Dashboard: cards e gráfico do mês (`accounts`, `cash`, `investments`, `kpis`) | 9 + 2 + 1 + 2 = **14** | Só com o Dashboard visível; cache de 30 s por usuário, workspace, papel, faixa e blocos |
| Dashboard: widget "Diagnóstico", 30 dias (`cash`, `kpis`, `alerts`; os alertas leem contas, cartões e dívidas no servidor, sem ranking) | 9 + 2 + 3 + 2 + 39 + 8 ≈ **63** (P5-C2: +3 do crédito não aplicado) | Mesmo cache; PF e PJ iguais |
| **Dashboard, total por carga (relatório)** | ≈ **77** | Duas chamadas; **não inclui** "Transações Recentes" (próxima linha) |
| Dashboard: "Transações Recentes" (P5-GATE-FINAL, FIRESTORE-01) | **10** documentos por carga, medidos no Emulator; até 100 se houver anuladas ou inválidas demais entre as mais recentes | Leitura direta de `transactions` pelo cliente (9 mais recentes, páginas de 10, até 10 páginas), fora da callable. Com ela, o Dashboard por carga soma ≈ **87** (77 + 10). Em outras telas, 0 |
| Listener do Dashboard (`cash_report_periods/{mês corrente}` e, se outro, `{mês escolhido}`) | 1–2 ao montar + 1 por mudança | Mudanças agrupadas em 2 s numa só releitura das consultas ativas (até 2 chamadas no Dashboard). Orçamento por montagem (`src/modules/reports/liveRefresh.ts`): 40 releituras seguidas e reposição de 1 por minuto, no máximo 100 por hora; com escrita contínua de outros membros, ≤ 200 chamadas/h no Dashboard, abaixo do limite de 300/h da callable |
| Pior caso por usuário e workspace | ≤ 300 chamadas/h × custo da chamada | Limite de frequência da callable (300 por hora), relido na transação; acima dele, recusa em pt-BR sem leitura de relatório |
| Relatórios PF, 30 dias | 9 + 2 + 2 + 30 + 39 + 8 + 3 ≈ **93** | Todos os blocos |
| Relatórios PJ, 30 dias | ≈ 93 + amostra de recebíveis (≤ 501) + 5 | Ranking marcado como `sample` |
| Relatórios PF, 12 meses | 9 + 2 + 12 + 45 + 49 + 8 + 13 ≈ **138** | |
| Relatórios PF, todo o período (5 anos de dados) | 9 + 4 + 60 + 90 + 73 + 8 + 61 ≈ **305** | Teto de 601 meses por projeção; +2 leituras para o início do período |
| Antes da P5-C1 (referência documental, PR-RPT-02) | até 20.000 transações por carga, relidas a cada mutação | `docs/production/PRODUCTION_READINESS_PLAN.md` §6 |
| Janela de 12 meses de `transactions` (P5-C1 a P5-GATE-FINAL) | até 20.000 documentos por carga do app, em qualquer tela, e de novo a cada mutação nesta aba (medido no Emulator: 3.075) | **Removida no P5-GATE-FINAL (FIRESTORE-01):** a abertura do app não lê lançamentos; a lista de Receitas/Despesas lê só o tipo e o mês do Header, por cursor, só com a tela aberta (medido: 1.245 no mês movimentado, 40 num mês comum). Detalhe, estimativas e testes em `docs/production/evidence/p5-gate-final/FIRESTORE-01-LEITURAS.md` |

## Escrita (gatilho de caixa, por evento de lançamento)

| Evento | Antes (v4) | Agora (v5) | Durante reconstrução com geração em preparação |
| --- | --- | --- | --- |
| Criação / confirmação / anulação | 1 mês + marca = 2 | 1 mês (com `days`) + 1 categoria-ano + marca = 3 | + 1 categoria-ano = 4 |
| Correção que troca mês e categoria | 2 meses + marca = 3 | 2 meses + 2 categorias-ano + marca = 5 | + 2 = 7 |
| Troca de dia no mesmo mês | 1 marca (mês sem delta) | 1 mês (só `days`) + 1–2 categorias-ano + marca | + 1–2 |
| Leituras do gatilho | estado + marca | estado + marca (+0) | idem |

**Atualização da P5-F.1-R3 (FIRESTORE-03 do gate da P5):** as colunas acima não incluem a marca de aplicação da projeção (`cash_projection_marks`). Por entrega aplicada, o gatilho faz +1 leitura (a marca, no mesmo `getAll`) e +1 escrita (a marca); a reentrega ou entrega coberta faz +1 leitura e nenhuma escrita; a primeira quebra de uma cadeia faz +1 escrita no estado. Exemplos medidos, em leituras/escritas: criação 2/3 → 3/4; edição sem efeito de caixa 2/1 → 3/2. Desenho e medições: `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md` §9.

Tamanho por documento: mês ≤ 31 dias × 11 campos (~11 KB); categoria-ano ≤ 366 dias × 4 campos (valores e contagens por lado, ~35 KB). Índice do mapa `days` desligado (`fieldOverrides`) nas três coleções.

## Reconstrução

Por página: até 400 documentos tocados e 450 transformações por documento (página cortada antes). Publicação: até 500 escritas e ~9 MiB, recusada antes de escrever. Limpeza: até 400 documentos da geração descartada por invocação; shards com TTL de 7 dias (`expiresAt`).
