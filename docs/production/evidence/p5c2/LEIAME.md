# Evidência — P5-C2, contrato único de Transações e pendências M2, M3, L5 e L8 (2026-10-11)

As capturas foram feitas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados em duas árvores:
- "antes": a árvore auditada da P5-C1.1, `57070629`;
- "depois": a P5-C2, snapshot do working tree com o código final (difere da árvore final só em documentação).

Os lançamentos passam pela callable real `createCashTransaction` de cada árvore (o "antes" grava `value` e `transactionDate`; o "depois" grava só o contrato canônico). Cartões pela callable `createCreditCard`; faturas e arquivamento gravados pelo Admin SDK no formato oficial da P4-A (a D-36 não deixa lançar em fatura já fechada com o relógio real).

**Dados.**
- **PF:** receitas de R$ 8.000,00 e R$ 123,45; despesas de R$ 1.200,99 e R$ 2.500,00; despesa pendente de R$ 99,90 com vencimento futuro.
  - "Cartão Principal": fatura vencida de R$ 100,00, corrente de R$ 300,00 e futura de R$ 200,00.
  - "Cartão Crédito": fatura do ciclo aberto com total de −R$ 150,00 (crédito ainda não transportado).
  - "Cartão Arquivado": arquivado, com fatura vencida de R$ 50,00.
- **PJ:** receita de R$ 15.000,00 e despesa de R$ 4.000,50.
- **Indisponível:** workspace PF com uma fatura candidata fora do schema (bloco de cartões indisponível).

**Telas** (desktop 1440×900 e celular 390×844, temas claro e escuro, 48 capturas por árvore):
- `transacoes-pf-despesas`, `transacoes-pj-receitas`: listas de lançamentos;
- `modal-nova`, `modal-compra-parcelada` (aba "Cartão"), `modal-editar`: formulário;
- `relatorios-cartoes`, `relatorios-cartoes-tabela`: Visão Geral;
- `relatorios-graficos-cartoes`: Gráficos, "Por cartão";
- `cartoes`, `cartoes-vencida`, `cartoes-credito`: tela e detalhe dos cartões;
- `relatorios-indisponivel`: cartões indisponíveis.

## Diferenças (`diferencas-pixels.txt`, limiar 48 por pixel)

- **0,00% em 28 telas:** listas PF e PJ, os três estados do formulário (inclusive a aba de compra parcelada), a tela de Cartões e o estado indisponível.
- **Relatórios (M2, M3, L5):**
  - "Fatura atual" passa a "Próxima fatura a pagar";
  - a linha do "Cartão Principal" diz "Vence em 05/11/2026 · ciclo aberto";
  - o "Cartão Crédito" diz "Sem fatura a vencer · crédito de R$ 150,00 a compensar", sem abater nada;
  - em Gráficos, "Por cartão" ganha a coluna "Em atraso" (R$ 100,00 no Principal, R$ 0,00 no Crédito) e a nota "Não inclui R$ 50,00 em atraso de cartões arquivados, exibidos na Visão Geral.".
- **Detalhe do cartão (M2, M3):**
  - "Fatura atual" passa a "Fatura do ciclo aberto" e "Próxima fatura" passa a "Fatura do ciclo seguinte";
  - na fatura aberta com crédito, a nota "Crédito de R$ 150,00 a transportar para a próxima fatura no fechamento.".
- **Valores:** iguais nas duas árvores. O "antes" lê `value`; o "depois", `valueCents`. São os mesmos centavos, sem arredondamento: R$ 1.200,99 e R$ 99,90 (pendente, "•") na lista PF do mês, R$ 15.000,00 na lista PJ e `1200.99` no campo de edição.

## Acessibilidade e responsividade (`*-relatorio.json`)

- **Rolagem horizontal da página:** 0 em todas as telas. A tabela "Por cartão" rola dentro do próprio contêiner.
- **axe-core (WCAG 2.0/2.1 A e AA, desktop claro):** os mesmos achados da base, sem violação nova (contraste e nomes de `select` pré-existentes).
  - Na primeira rodada, a nota de crédito nova usava o tom dos vizinhos e somava 1 nó de contraste.
  - O tom foi corrigido (`text-gray-600`/`dark:text-gray-300`) antes da captura final.
- **Teclado:**
  - o diálogo de lançamento mantém o foco depois de 6 Tabs;
  - Escape fecha o diálogo nas quatro combinações;
  - a aba "Cartão" e o botão "Por cartão" foram acionados por teclado (Enter).

## Outros arquivos

- `mutacoes.json`: 38 mutantes válidos, 38 mortos, todos restaurados por SHA-256. Integração no Emulator 18, frontend 10, unitários das Functions 8, E2E 2.
- `prova-remocao.txt`: busca no código por `value` em reais, `transactionDate` e `parcelado` persistidos. Também lista as guardas executáveis.
