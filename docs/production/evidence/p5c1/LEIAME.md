# Evidência visual — P5-C1, relatórios financeiros e Dashboard autoritativos (2026-10-10)

Capturas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados na árvore da P5-B.1 (`8befe373`, "antes") e na P5-C1 ("depois", snapshot do working tree `e3a4c4f7`). Os lançamentos passam pelas callables reais de cada árvore; a única diferença de payload é a categoria (nome na base, ID do catálogo na P5-C1). Dados: PF com receita de R$ 8.000,00 (D-2), despesas de R$ 1.200,00 (D-1) e R$ 2.500,00 (D-12), bônus de R$ 500,00 (D-45) e conta "Reserva" com saldo inicial de R$ 1.500,00; PJ com recebimento de R$ 15.000,00 (D-3), pagamentos de R$ 4.000,00 (D-2) e R$ 1.800,00 (D-20) e a mesma conta. A captura espera não haver "Carregando" visível e o fim da animação dos gráficos.

- **Telas** (desktop 1440×900 e celular 390×844, claro e escuro), PF e PJ: `dashboard`; `relatorios-visao` (Visão Geral, "Últimos 30 dias"); `relatorios-fluxo` (Resumo de Fluxo de Caixa Mensal); `relatorios-graficos`; `relatorios-teclado` (desktop claro, depois da sequência de teclado).
- **Comparação:** `diferencas-pixels.txt` — antes × depois por captura (limiar 48 por pixel). Toda diferença decorre do contrato do relatório oficial (D-37):
  - **Dashboard (0,17–0,65%)**: o card "Saldo Atual" mostra a soma dos saldos das contas (D-37.1: R$ 6.300,00 = conta padrão + "Reserva"; a base mostrava R$ 6.800,00, fórmula do navegador) e a legenda "Em contas" em vez de "Mensal", porque o número não é do mês; a legenda do gráfico "Parceladas" vira "Faturas de cartão" (D-37.3, visão de caixa: o que sai do caixa é o pagamento da fatura); o widget "Diagnóstico" troca "Saldo"/"Poupança 0.0%" por "Resultado"/"Aportes líq. 0,00%" (nomes aprovados na D-37 e percentual em pt-BR).
  - **Relatórios, Visão Geral**: "Resultado líquido" vira "Resultado operacional", com a nota "Fluxo líquido total" (D-37.2: os cinco componentes separados); a tabela mensal cobre só os meses da janela exata de 30 dias, marcados "(Parcial)" (D-37.7; a base listava seis meses fixos, fora do filtro); "Utilização do Crédito" mostra "—" sem limite cadastrado em vez de "0.0%" (D-37.10: ausência não é zero); a caixa "Grau de Endividamento: BAIXO" sai, porque classificava por limiares inventados no navegador (D-37.9); "Insight Financeiro IA" vira "Leitura dos indicadores", com texto objetivo e sem limiar (D-37.9). PJ: "Faturamento" → "Recebimentos operacionais realizados" e "Margem líquida 61.3%" → "Margem operacional de caixa 61,33%" (pontos-base, sem o selo "Positivo" do limiar de 15% e com resultado e pagamentos operacionais na nota, D-37.4); os cards PJ ganham o selo de regime ("Caixa", "Indicador") que o PF já tinha. Sem investimento nenhum, o painel "Patrimônio de investimentos" continua oculto, como na base.
  - **Relatórios, Gráficos**: "Fluxo de Caixa (6 Meses)" vira "Fluxo de Caixa Mensal" e segue a janela escolhida, com os meses parciais marcados "*" e a nota "Mês parcial: o período não cobre o mês inteiro." (D-37.7, D-37.10); o restante da tela desce essa nota.
  - Sem diferença: Visão Geral PF no celular (0,00%).
- **Medições:** `antes-relatorio.json` e `depois-relatorio.json`:
  - rolagem horizontal 0 em todas as 32 capturas, nas duas árvores;
  - axe-core (WCAG 2.0/2.1 A e AA) nas telas em desktop claro: nenhuma violação nova; as existentes são as mesmas da base (contraste da paleta, `select` do filtro de transações sem nome, setores do gráfico sem texto alternativo), com menos nós na Visão Geral porque a tabela tem menos linhas;
  - teclado (mesma sequência nas duas árvores, PF e PJ): foco no seletor de período; Tab leva à aba ativa; setas trocam de aba e movem o foco; Tab entra no painel; Shift+Tab volta à aba. Enter e Espaço não abrem o seletor de período em nenhuma das duas árvores (componente `ReportPeriodSelect`, não alterado pela P5-C1; registrado como pendência anterior).

Arquivos:

- `antes/` — 34 capturas da árvore da P5-B.1;
- `depois/` — 34 capturas da P5-C1 (mesmo roteiro);
- `CUSTO.md` — tabela de custo do relatório.

O arquivo de captura (`p5c1-evidence.spec.ts`, fora da suíte) foi executado nas duas árvores e removido.
