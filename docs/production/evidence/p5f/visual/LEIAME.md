# P5-F — evidência visual, acessibilidade e responsividade

## Condições

- **Árvores comparadas:**
  - "antes": a base `1730a1df`, num worktree destacado temporário, já removido;
  - "depois": a árvore final da P5-F.
- **Ambiente:** mesmo roteiro (`p5f-evidence.spec.ts.txt`) e mesmos dados nas duas árvores. Emulator `minhas-financas-local`, build E2E, Chromium do Playwright e a Poppins local (a mesma fonte que o CI baixa).
- **Combinações:** 1440 × 900, 390 × 844 e 360 × 800 px, nos temas claro e escuro.
- **Dados sintéticos:**
  - usuário `e2e-p5f-ev`;
  - duas contas com saldo inicial de R$ 1.000,00 e R$ 352,00;
  - uma receita de R$ 3.000,00 e uma despesa de R$ 482,35, criadas pelas callables reais;
  - renda de referência fictícia de R$ 4.400,00 por 176 h, ou seja, hora de R$ 25,00.
- **Acessibilidade:** axe-core com as regras WCAG 2.0/2.1 A e AA, no escopo de cada captura (`main`, a seção, o Header ou o diálogo). O transbordamento é medido como `scrollWidth − clientWidth` da página.
- **Espera:** cada captura espera os valores carregados e o fim das animações CSS. Dashboard e Gráficos esperam também as animações do recharts.

## Capturas

| Pasta | Conteúdo |
| --- | --- |
| `antes/` (24) | `dinheiro-dashboard`, `dinheiro-relatorios`, `dinheiro-graficos` e `dinheiro-configuracoes`, em cada combinação, e `resultado-antes.json` |
| `depois/` (79) | As mesmas 24 do modo dinheiro e, só aqui: `tempo-configuracoes-vazia`, `-erro` e `-preenchida`, `tempo-dashboard`, `tempo-relatorios`, `tempo-graficos`, `tempo-anulacao-em-reais`, `tempo-contas` e `tempo-transferencia-em-reais`, em cada combinação, mais `tempo-header-foco` (1440 px, claro). Junto, `resultado-depois.json` |
| `comparacao-antes-depois.json` | Pixels diferentes por captura do modo dinheiro (ImageMagick `compare -metric AE`, sem tolerância) e a caixa que contém as diferenças |
| `composicoes/` | Lado a lado para leitura rápida (abaixo) |

## Resultados

**Transbordamento horizontal:** 0 px nas 103 capturas.

**axe:**
- Modo dinheiro: nenhum nó novo em relação à base nas 24 capturas. Os nós que existem (o `select-name` crítico do Dashboard, contraste em Relatórios e Configurações e `svg-img-alt` nos gráficos) são preexistentes e iguais nas duas árvores.
- Modo tempo: as mesmas regras e contagens da captura equivalente em dinheiro.
- Seção "Tempo de trabalho equivalente": 0 violação, vazia, com erro e preenchida, nos dois temas e nos três tamanhos. Também 0 no Header com o alternador, nas contas, na transferência e na confirmação de anulação.

**Pixel a pixel, modo dinheiro:**
- **Dashboard:** 0 px no celular e de 3 a 13 px no desktop. É ruído de antialias em linhas de 1 a 3 px sob o seletor de mês, igual ao medido entre capturas da mesma árvore.
- **Relatórios:** 0 px, exceto o ícone "Leitura dos indicadores". Ele tem `animate-pulse` (animação CSS infinita) e varia de 99 a 105 px numa caixa de 14 × 14 px.
- **Gráficos:** 0 px.
- **Configurações:** no desktop, a diferença fica só na área do card novo "Tempo de trabalho equivalente" (877 × 236 px). No celular o card fica abaixo da dobra: 0 px.

**Teclado:**
- Seção (1440 px, claro): interruptor "Ativar tempo de trabalho equivalente" → "Renda mensal de referência (R$)" → "Horas" → "Minutos (opcional)" → rádio "Tempo de trabalho" (o grupo tem uma parada; as setas trocam a opção) → "Salvar" → fim da sequência.
- Header: "Notificações, nenhuma não lida" → "Mostrar valores em tempo de trabalho" (`aria-pressed=true`) → "Ativar modo escuro" → "Abrir menu da conta".

**Eixos dos gráficos:**
- No modo tempo, o eixo Y mostra `0 h`, `≈ 30 h`, `≈ 60 h`, `≈ 90 h` e `≈ 120 h`, para R$ 0 a R$ 3.000 com a hora de R$ 25,00.
- No modo dinheiro, `R$0k`, `R$0.75k`, …, `R$3k`, iguais nas duas árvores.

## Composições

| Arquivo | O que mostra |
| --- | --- |
| `configuracoes-desktop-claro-antes-depois-diferenca.png` | Configurações no modo dinheiro: antes, depois e máscara de diferença. A mudança é só o card novo |
| `eixo-modo-tempo-antes-e-depois-da-correcao.png` | Eixo do fluxo de caixa no modo tempo. À esquerda, o rótulo compacto na largura padrão, com o `≈` cortado (rodada intermediária). À direita, o estado final: 80 px e margem 0 só no modo tempo |
| `modo-tempo-celular-claro.png` | Dashboard, Relatórios, Contas e a confirmação de anulação com o valor em reais, a 390 px |
| `secao-configuracoes-estados-desktop-claro.png` e `secao-configuracoes-estados-360-escuro.png` | A seção vazia, com o erro de formato (`4400.00`) e preenchida, com o valor por hora e a prévia |
| `header-foco-alternador.png` | Alternador do Header com foco de teclado, ao lado do aviso "Mostrar em R$" |

## Rodadas e o que cada uma corrigiu

| Rodada | Achado | Correção |
| --- | --- | --- |
| r1 | O "depois" foi capturado com o Dashboard ainda carregando ("Carregando…") | No roteiro: esperar o saldo e a ausência de "Carregando…" antes de capturar |
| r1 | O card novo tinha contraste insuficiente no claro (`sky-600`); "Valor estimado por hora" e "Prévia" não passavam no escuro | `sky-700` no "Acessar"; `dark:text-primary-on-dark` nos rótulos e em "Tentar de novo" |
| r1–r3 | Relatórios no modo tempo transbordavam 38 px a 390 e 68 px a 360. O `sr-only` (absoluto) de cada valor escapava da tabela com rolagem, que não é posicionada | `relative` no invólucro do valor. O E2E ganhou a asserção a 360 px, que reprovou o build sem a correção (68 px) e passou com ela. Diagnóstico em `diagnostico-transbordamento.spec.ts.txt` |
| r4 | Revisão independente, M2: o rótulo longo do eixo (`≈ 123 h 49 min`) era cortado | Rótulo compacto (`≈ 124 h`), largura de 80 px e margem esquerda 0, só no modo tempo |
| r4 | Diferenças de pixel nos gráficos e no Dashboard vinham da animação JS do recharts, que o roteiro não esperava | No roteiro: 2 s a mais antes das capturas de Dashboard e Gráficos |
| r5/r6 | Estado final: "antes" na r5 e "depois" na r6, com o código definitivo | — |

Nos roteiros copiados como `.txt`, `<scratchpad>` substitui o diretório temporário da sessão. Nenhum segredo, credencial ou dado real aparece nesta pasta.
