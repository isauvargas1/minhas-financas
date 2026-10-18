# P5-E2 — evidência visual do Header (antes × depois)

## Condições

- **Roteiro:** [`p5e2-evidence.spec.ts.txt`](p5e2-evidence.spec.ts.txt). Arquivo temporário de evidência: copiado para `e2e/`, rodado fora da suíte e devolvido.
- **Dados e ambiente:**
  - os mesmos nas duas árvores: um titular PF com 3 notificações não lidas;
  - Emulator `minhas-financas-local` e build E2E de cada árvore;
  - Chromium do Playwright com a Poppins local, a mesma fonte que o CI baixa;
  - `deviceScaleFactor` 1, `pt-BR`, America/Sao_Paulo.
- **Combinações:**
  - 1440×900 (desktop);
  - 390×844 e 360×740 (celular, com toque);
  - temas claro e escuro.
- **Árvores comparadas:**
  - "antes" = base `92e5a9c`;
  - "depois" = árvore final;
  - "ruído" = segunda execução do "depois", para medir a variação da própria captura.

## Estado do Header (`antes/relatorio-antes.json`, `depois/relatorio-depois.json`)

| Item | Antes | Depois |
| --- | --- | --- |
| Controles visíveis (desktop) | Mês anterior, Selecionar Mês e Ano, Hoje, Próximo mês, "Notificações, 3 não lidas", **Mensagens**, tema, Abrir menu da conta | Os mesmos, sem "Mensagens" |
| Controles visíveis (celular) | Abrir menu, Mês anterior, Selecionar Mês e Ano, Hoje, Próximo mês, "Notificações, 3 não lidas", **Mensagens**, tema | Os mesmos, sem "Mensagens" |
| Ordem do Tab no Header | Igual à lista acima, nas 6 combinações | Igual, sem "Mensagens", nas 6 combinações |
| Botões com "Mensagens" na tela · texto "Mensagens" · "nova conversa" | 1 · 1 · ao abrir o painel | 0 · 0 · 0 |
| axe-core (WCAG 2.0/2.1 A e AA) no Header | Nenhuma violação | Nenhuma violação |
| Transbordamento horizontal (repouso e com o painel aberto) | 0 | 0 |
| Altura do Header | 60 px (desktop) e 166 px (celular) | Igual |
| Notificações fecham por toque ou clique fora | Sim | Sim |
| Menu da conta fecha por clique fora (desktop) | Sim | Sim |
| Menu lateral fecha com Esc (celular) | Sim | Sim |
| Painel de Mensagens | Abria; no celular cobria a tela inteira e o toque fora não o fechava (só o "X") | Não existe |

## Pixel a pixel

Resultados em `comparacao-antes-depois.json`; ruído em `comparacao-ruido-depois-depois.json`.

- **Menu da conta (elemento):** 0 px nos dois temas.
- **Painel de notificações (elemento):**
  - celular: 0 px nas 4 combinações;
  - desktop: interior idêntico (0 px, tirada a faixa de 12–13 px da borda esquerda nos dois temas);
  - essa faixa muda porque a borda translúcida deixa ver o fundo, e o painel acompanha o sino, que andou 48 px para a direita com a saída do envelope.
- **Menu lateral (celular):**
  - 0 px em 3 combinações;
  - 4 px em 360 escuro, na mesma caixa (4×1 em 333,373) que difere entre duas capturas da mesma árvore: é ruído.
- **Header, só a faixa dos controles muda:**
  - desktop: caixa de 828×51 a partir de x=484, com o envelope ausente, o sino deslocado 48 px e o seletor de mês 24 px (o `justify-between` redistribui o espaço liberado);
  - celular: caixa de 105×36, com o envelope ausente e o separador e o tema 48 px à esquerda;
  - a altura não muda.
- **Telas inteiras:** fora do Header, até 4 px.
- **Ruído medido:** entre duas execuções da mesma árvore, 2 a 8 px em 5 de 38 capturas; as outras 33 são idênticas. As diferenças de telas e menu lateral acima ficam dentro dessa faixa.

## Composições

- `composicoes/cabecalho-1440-escuro-antes-depois.png`: em cima, antes; embaixo, depois.
- `composicoes/cabecalho-390-claro-antes-depois.png` e `composicoes/cabecalho-360-escuro-antes-depois.png`: à esquerda, antes; à direita, depois.
- **Painel simulado que saiu:** `antes/mensagens-simuladas-*.png`.

## Decisões de apresentação

- **Separador vertical:** fica. Separa o sino do tema e da conta, com controle dos dois lados em todas as larguras.
- **Espaço do botão removido:** não foi reservado. Um espaço vazio seria um controle fantasma, e o deslocamento do seletor de mês no desktop é efeito direto da remoção.
- **Classes dos controles que ficaram:** nenhuma mudou. Contraste e anel de foco são os mesmos (`foco-sino-*`).

## Reprodução

1. Copiar `p5e2-evidence.spec.ts.txt` e `p4d-evidence-common.ts.txt` para `e2e/`, sem o sufixo.
2. Em `p4d-evidence-common.ts`, apontar `AXE` para um `axe-core/axe.min.js` local.
3. Gerar `npm run build:e2e`.
4. Rodar `npx playwright test e2e/p5e2-evidence.spec.ts` com `EVIDENCE_TREE=antes|depois` e `EVIDENCE_DIR=<saída>`.
5. Devolver os arquivos para fora de `e2e/`.
6. Comparar com `comparar-capturas.py.txt` (ImageMagick). O fluxo completo está em `run-evidence.sh.txt`.

## Recaptura após os ajustes da revisão independente

Os ajustes vieram depois das capturas "depois":
- remoção de dois componentes de ícone sem consumidor;
- comentário da limpeza de sessão;
- guarda e E2E de ausência.

A árvore final foi recapturada com o mesmo roteiro (`comparacao-recaptura-pos-revisao.json`, "depois" × "depois-final"):
- 34 de 38 capturas idênticas;
- 4 com 4 a 9 px numa linha de 1 px em y=373, a 360 px, a mesma faixa do ruído medido;
- relatório estrutural idêntico (controles, foco, axe, transbordamento e fechamentos) e 0 erros.

Os ajustes não mudaram nada visível. As capturas em `depois/` continuam representando a árvore final.
