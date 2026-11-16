# P5-F.1 — evidência visual, acessibilidade, teclado e antes × depois

## Condições

- **Ambiente:** build E2E (`npm run build:e2e`) contra o Emulator `minhas-financas-local`, Chromium do Playwright com `--lang=pt-BR` (campos nativos de data e hora como os de um navegador em português; sem isso, o Chromium do contêiner mostrava 12 h e `mm/dd/yyyy`), `locale` `pt-BR` e fuso `America/Sao_Paulo`, `deviceScaleFactor` 1.
- **Combinações:** 1440 × 900, 390 × 844 e 360 × 800 px, nos temas claro e escuro (o tema segue `prefers-color-scheme`).
- **Dados sintéticos:** um usuário de teste, um workspace PF "Pessoal (exemplo)", uma conta com saldo inicial de R$ 1.000,00 e três salários fictícios (dias do mês × 8 h × R$ 25,00) criados pela callable real, nos três meses completos anteriores. Nenhum dado real.
- **Acessibilidade:** axe-core com as regras WCAG 2.0/2.1 A e AA, no escopo de cada captura (a seção, o assistente, o diálogo ou a página). Transbordamento horizontal: `scrollWidth − clientWidth` da página.
- **Roteiros temporários** (copiados em `e2e/` só durante a execução e apagados depois; aqui como `.txt`): `p5f1-evidence.spec.ts.txt` e `p5f1-antes-depois.spec.ts.txt`.

## Capturas (`capturas/`, 78, e `capturas/resultados.json`)

Para cada combinação (`desktop`, `mobile`, `small` × `light`, `dark`):

| Arquivo | Tela |
| --- | --- |
| `00-intro` | Configurações → Tempo de trabalho equivalente, antes da primeira ativação |
| `01-etapa-a` | Assistente, etapa A: o texto de apresentação pedido e os pontos (aproximado, valores originais intactos, pode ser desligado, alterável, nada compartilhado) |
| `02-etapa-b-rotina` | Etapa B: dias da semana, jornada para aplicar a vários dias, cada dia, total da semana e horas do mês (8 h todos os dias) |
| `03-etapa-c-feriados` | Etapa C: UF, município, trabalho em feriados, aviso de cobertura, feriados nacionais do ano, feriados locais e atalhos (Carnaval, Paixão, Corpus Christi, eleições) |
| `04-etapa-d-excecoes` | Etapa D: calendário mensal de exceções (horas por dia, feriados marcados) e o formulário |
| `05-etapa-e-receitas` | Etapa E: fonte da renda, modo, meses, contagem e a prévia da hora (R$ 25,00) |
| `06-resumo` | Resumo e escolha da exibição |
| `07-configuracoes` | Configurações depois de salvar: todas as seções editáveis e a prévia lateral |
| `08-memoria-de-calculo` | "Como este valor foi calculado?" (janela visível) |
| `09-receitas-consideradas` | "Receitas consideradas" (janela visível) |
| `10-configuracoes-excecoes` | Configurações na seção de exceções |
| `11-dashboard-modo-tempo` e `12-dashboard-modo-dinheiro` | Dashboard nos dois modos, para comparar o axe da página |

## Resultados

- **Transbordamento horizontal:** 0 px nas 78 capturas.
- **axe nas superfícies da P5-F.1** (assistente, Configurações, memória de cálculo, receitas consideradas): **0 violação** nas 60 capturas.
- **axe no Dashboard (página inteira):** as mesmas regras e os mesmos nós nos modos tempo e dinheiro, e iguais aos da árvore da P5-F (abaixo). São débitos preexistentes, fora do escopo: `select-name` (seletor do Dashboard), `label-content-name-mismatch` (botão do mês no Header) e `color-contrast` (células verdes de receita e etiquetas de categoria).
- **Teclado** (registrado em `resultados.json`, `notes`):
  - a cada etapa do assistente, o foco vai para o título da etapa (`headingFocused`: verdadeiro nas 6 combinações);
  - no calendário de exceções, a partir de 01/11/2026, seta para a direita e seta para baixo levam a 09/11/2026 nos três tamanhos (`calendarFocus`); o foco acompanha cada tecla, sem perder passos;
  - na memória de cálculo, o foco vai para o título, Tab fica preso no diálogo (`detailsTitleFocused`, `focusInside`) e Escape fecha.
- **Rodadas e correções:**
  - 1ª rodada: título do mês com "De" e "H" maiúsculos (classe `capitalize`; agora só a primeira letra), seletor "Horário de início e fim" cortado (rótulo "Início e fim"), foco das setas dependente do próximo quadro (perdia passos a 390 e 360 px; agora segue a renderização), região rolável da tabela de meses sem foco (agora focável e nomeada);
  - 2ª rodada: tudo acima corrigido;
  - 3ª rodada, depois das correções da revisão independente 1;
  - 4ª rodada (`evidence-r4`), depois das correções da revisão 2 (painel sem fonte, textos de estorno dentro e fora da janela, nome próprio da região rolável, eleições de 2020);
  - 5ª rodada (`evidence-r5`), depois das correções da revisão 3 (textos do painel para itens depois do período, aviso da atualização que falhou, "Tentar de novo" no relatório indisponível): os números acima, iguais aos da 3ª e da 4ª rodadas (0 transbordamento, 0 violação nas superfícies novas, as mesmas violações preexistentes no Dashboard e as mesmas notas de teclado). Os estados de borda que só aparecem com dados específicos (sem fonte escolhida, recebimento estornado, eleição de 2020, releitura que falha, leitura dos desconsiderados que falha) têm asserções no E2E e nos unitários, não capturas;
  - rodada final (`evidence-r6`, build novo), sobre a árvore final, depois das correções da revisão 4 (o estorno de recebimento descrito na data do recebimento, na memória de cálculo e no painel): os mesmos números (0 transbordamento, 0 violação nas superfícies novas, as mesmas violações preexistentes no Dashboard, as mesmas notas de teclado nas 18 capturas que as têm; axe e notas iguais aos da 5ª rodada nas 78). Pixel a pixel contra a 5ª rodada (`comparacao-r5-r6.txt`): 71 idênticas; as 6 da memória de cálculo mudam no texto do estorno e no horário de "Atualizado em"; e `desktop-dark-01-etapa-a` difere em 8 px numa faixa de 102 × 3 px na suavização da saudação do Header (sem diferença visível e sem mudança de código ali).

## Antes × depois (`antes/`, `depois/`, `comparacao-antes-depois.json`)

Mesmo roteiro e mesmos dados nas duas árvores: "antes" é a árvore da P5-F (`455086e0`, extraída num diretório temporário, com `node_modules` por link), com a preferência v1 de R$ 4.400,00 por 176 h; "depois" é a P5-F.1, com 8 h todos os dias e os salários fictícios. As duas dão R$ 25,00 por hora, então todo valor convertido deve coincidir. O "depois" final (`ad-depois-6`) foi capturado no mesmo build da rodada final de capturas, sobre a árvore final (o resultado é o mesmo das rodadas anteriores). Dashboard e Relatórios, em reais e em tempo, nos 3 tamanhos e 2 temas: 24 capturas por árvore, cada uma depois do fim do carregamento (sem "Carregando…", sem indicador girando e altura estável).

| Resultado | Detalhe |
| --- | --- |
| Pixel a pixel (ImageMagick `compare -metric AE`, sem tolerância) | **23 de 24 idênticas** (também byte a byte). A outra, `tempo-relatorios-mobile-light`, difere em 14 px numa faixa de 3 × 34 px na borda do botão de menu do celular: o estado de foco que sobra do clique de navegação. O componente não mudou no diff |
| axe da página inteira | **igual nas 24** (mesmas regras e mesmos nós) |
| Conclusão | fora da seção de Configurações, a P5-F.1 não muda nada visível no modo dinheiro nem no modo tempo; a estimativa automática converte exatamente como a renda digitada da P5-F quando a hora é a mesma |

A primeira comparação (antes de esperar o fim do carregamento) achou 2 Dashboards com alturas diferentes: a captura "antes" fora tirada com os cartões ainda em "Carregando…". O roteiro passou a esperar o carregamento e as duas árvores foram capturadas de novo.

Nenhum segredo, credencial ou dado real aparece nestes arquivos.
