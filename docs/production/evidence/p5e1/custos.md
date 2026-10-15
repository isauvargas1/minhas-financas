# P5-E1 — Custo de leitura e de provedor

Estimativas derivadas do código, não medidas em produção: o Emulator não mede leituras faturáveis. As premissas de leitura do relatório oficial são as de `evidence/p5c1/CUSTO.md`: 3 cartões ativos, cerca de 15 categorias usadas, agregações a 1 leitura por até 1.000 entradas de índice.

## Consultor (`analyzeFinancialQuestion`), por pergunta

| Etapa | Leituras | Escritas |
|---|---|---|
| Pré-checagem do kernel (`users`, `workspaces`, `members`) | 3 | 0 |
| Transação de contexto: releitura do ator + limite de leitura de contexto (60/h) | 3 + 1 | 1 |
| Relatório oficial, 30 dias, blocos `accounts`, `cash`, `kpis`, `categories`, `cards`, `debts`, `investments`, `alerts` (sem `series` e sem ranking de clientes PJ) | 2 + 2 + 2 + 30 + 39 + 8 + 3 ≈ **86** | 0 |
| Admissão P2B.2: releitura do ator + recibo, owner, billing, uso do mês, rate limit | 3 + 5 | 3 |
| **Total, 30 dias** | **≈ 101** | **4** |
| Total, 12 meses (relatório ≈ 121) | ≈ 136 | 4 |
| Total, todo o período com 5 anos de dados (relatório ≈ 290) | ≈ 305 | 4 |

- **Ranking de clientes (PJ).** O consultor pede o bloco `debts` com `omitTopClients`. A amostra ordenada de recebíveis, que chega a 501 leituras mais os nomes por ID, não é lida, porque o contexto da IA não usa ranking nem nomes de clientes. Isso também é minimização.
- **Teto por usuário e workspace.**
  - 60 leituras de contexto por hora: no pior caso, 60 × o custo do relatório.
  - 20 análises admitidas por hora (P2B.2).
  - Créditos do plano por mês.
  - Acima do limite de contexto, a recusa em pt-BR acontece **antes** de ler o relatório (teste `aiSecurity` C14).
- **Repetição com a mesma chave.** Relê o contexto (≈ 94 leituras) e para na admissão ("já processada"), sem provedor e sem crédito. A repetição é limitada pelos 60/h (teste `aiContext` X28).
- **Recusas sem custo de relatório:**
  - não autenticado;
  - conta suspensa;
  - sem membership;
  - workspace arquivado;
  - viewer;
  - payload inválido;
  - sem confirmação de envio;
  - segredo ausente.

  Custam no máximo as 3 leituras da pré-checagem.

## Extração (`extractTransactionFromContent`), por envio

| Etapa | Leituras | Escritas |
|---|---|---|
| Pré-checagem do kernel | 3 | 0 |
| Admissão P2B.2 | 8 | 3 |
| **Total** | **11** | **3** |

A assinatura do arquivo e a confirmação são conferidas antes da admissão, sem leitura.

## Provedor (Gemini API paga; preços [B] de 2026-10-12 a conferir ao vivo)

Tamanhos medidos nas amostras sintéticas (`contexto-amostras-sinteticas.json`):

- instrução de sistema: cerca de 2.450 caracteres;
- bloco de dados: 3.000 a 3.750;
- pergunta: até 2.000.

Entrada estimada em cerca de 1.600 a 2.300 tokens por pergunta.

| Operação | Entrada (≈ tokens) | Saída (teto) | Custo máximo com `gemini-3-flash-preview` (0,50 / 3,00 US$ por 1M) |
|---|---|---|---|
| Consultor | ≈ 2.000 | 2.048, raciocínio incluído | ≈ US$ 0,001 + US$ 0,006 = **≈ US$ 0,007** |
| Extração por texto | ≈ 600 a 1.500 | 1.024 | ≈ **US$ 0,004** |
| Extração por documento | imagem 1024×1024 ≈ 1.290 tokens [D]; PDF ≈ 560 tokens por página no Gemini 3 [B] | 1.024 | depende do arquivo; o teto local de 6 MiB em base64 limita o tamanho |

- **Créditos.** Cada operação aceita custa 1 crédito do plano do titular, provider-agnostic e independente de tokens (P2B.2, inalterado).
- **Sem repetição automática do SDK.** Uma falha não gera segunda cobrança do provedor.
- **Repetição do cliente.** Só em `unavailable` ou erro de rede, uma vez e com a mesma chave. Se a primeira tentativa foi admitida, o backend responde "já processada" sem chamar o provedor, e o cliente avisa que a tentativa pode ter sido contabilizada. Em `deadline-exceeded` não há repetição, porque o pedido chegou ao servidor.
- **Tempo limite do cliente.** 125 s, acima dos 120 s da callable e dos 90 s do provedor: o navegador não desiste antes do servidor.
