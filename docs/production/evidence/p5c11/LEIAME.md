# Evidência visual — P5-C1.1, classificação das faturas de cartão nos Relatórios (2026-10-10)

As capturas foram feitas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados em duas árvores:
- "antes": a árvore auditada da P5-C1, `a7e89e0d`;
- "depois": a P5-C1.1, snapshot do working tree `8403bc3d`, que difere da árvore final só em documentação.

**Dados (PF).** Três cartões criados pela callable real `createCreditCard`, com fechamento no dia 25 e vencimento no dia 5:
- **"Cartão Principal"**: fatura vencida de R$ 100,00 (competência atual − 2, fechada), fatura corrente de R$ 300,00 (aberta) e fatura futura de R$ 200,00 (aberta). É o exemplo adversarial da tarefa.
- **"Cartão Reserva"**: sem fatura.
- **"Cartão Arquivado"**: arquivado e com uma fatura vencida de R$ 50,00, que é o estado deixado por um estorno de pagamento depois do arquivamento (a P4-A aceita).

As faturas e o arquivamento foram gravados pelo Admin SDK no formato oficial da P4-A, porque, com o relógio real, a D-36 não deixa lançar em fatura já fechada.

Telas, em desktop 1440×900 e celular 390×844, nos temas claro e escuro:
- `relatorios-cartoes`: Visão Geral, quadro "Indicadores de Cartão de Crédito";
- `relatorios-cartoes-tabela`: a tabela por cartão;
- `relatorios-graficos-cartoes`: Gráficos, botão "Por cartão";
- `cartoes`: tela de Cartões de Crédito, sem alteração de código.

## O que mudou (`diferencas-pixels.txt`, limiar 48 por pixel)

### Antes: o defeito reproduzido na árvore auditada
- O quadro "Faturas abertas" mostra R$ 100,00, que é a fatura vencida.
- O "Futuro comprometido" mostra R$ 500,00: soma a corrente com a futura.
- Na linha do "Cartão Principal", "Vencimento atual: 05/09/2026" é o vencimento da fatura vencida, e a coluna "Fatura atual" mostra R$ 100,00.
- O "Cartão Reserva" mostra "Sem fatura aberta" e R$ 0,00 em "Fatura atual", um zero que finge haver fatura.
- O quadro "Em atraso" mostra R$ 150,00, mas as linhas da tabela somam R$ 100,00: o cartão arquivado com saldo não aparece em linha nenhuma.

### Depois
- **Quadros:**
  - "Faturas atuais": R$ 300,00;
  - "Futuro comprometido": R$ 200,00;
  - "Em atraso": R$ 150,00.
- **"Cartão Principal":** "Vencimento atual: 05/11/2026" (o da corrente), Fatura atual R$ 300,00, Futuro R$ 200,00 e Atraso R$ 100,00.
- **"Cartão Reserva":** "Sem fatura a vencer" e "—" em "Fatura atual".
- **"Cartão Arquivado":**
  - aparece com "Cartão arquivado · Sem fatura a vencer";
  - "—" em utilização, limite disponível e fatura atual;
  - Futuro R$ 0,00 e Atraso R$ 50,00.
- **Paridade:** Σ das linhas = quadros.
- **Gráficos, "Por cartão":** "Fatura atual" no lugar de "Fatura aberta", com os valores das classes. A tabela analítica (visão de consumo) lista só os cartões ativos, como na base.

### Percentuais de diferença
- **Visão Geral:**
  - desktop 0,91–0,92%;
  - celular 0,17% no quadro.
  - A tabela no celular vai a 10–20% porque a linha nova do arquivado desloca as demais, e a ordem das linhas segue o ID do cartão, gerado a cada execução.
- **Gráficos:** desktop 1,27–1,28%, celular 0,45–0,46%.
- **Tela de Cartões:** 0,00% nas quatro combinações.

## Medições (`antes-relatorio.json`, `depois-relatorio.json`)

- Rolagem horizontal da página: 0 em todas as 16 capturas de cada árvore.
- axe-core (WCAG 2.0/2.1 A e AA), no desktop claro: as mesmas violações nas duas árvores, todas pré-existentes. São 6 nós de `color-contrast` nos Relatórios (verde dos valores R$ 0,00 e título do alerta de faturas vencidas) e 6 na tela de Cartões (legendas do cartão). Nenhuma violação nova.
- Texto das linhas da tabela por cartão e do quadro "Em atraso" em cada combinação: campos `linhas-*`.

## Arquivos

- `antes/`: 16 capturas da árvore auditada;
- `depois/`: 16 capturas da P5-C1.1, com o mesmo roteiro.

O arquivo de captura (`p5c11-evidence.spec.ts`, fora da suíte) foi executado nas duas árvores e removido.
