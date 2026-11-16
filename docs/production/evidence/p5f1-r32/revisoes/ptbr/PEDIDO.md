# Revisão de produto e interface em pt-BR — P5-F.1-R3.2

Leia antes `<scratchpad>/p5f1r32/revisoes/COMUM.md` (instruções comuns, obrigatórias). Sua pasta: `<scratchpad>/p5f1r32/revisoes/ptbr`.

Execute a skill `ptbr-product-ui-review` (leia `<scratchpad>/wt-p5f1-r32/.claude/skills/ptbr-product-ui-review/SKILL.md` e a referência
inteira). Primeira linha do parecer: o veredito no formato da skill.

Contexto: a R3.2 não acrescenta nem altera texto nem layout (confira no diff). O que muda é QUANDO os estados já
existentes aparecem: uma estimativa com uma base e sem desconsiderados passa a esperar o retorno do servidor antes de
converter (antes convertia pela leitura do cache); sem conexão, os valores voltam a reais com o aviso do topo
("Calculando a estimativa…" e, depois do tempo de interface, "Estimativa de tempo de trabalho indisponível agora…"), e a
prévia de Configurações mostra "calculando" e depois "Estimativa em atualização" com "Tentar de novo"; com a escuta
encerrada por erro, a falha com "Tentar de novo".

Confira, com evidência:
1. Que nenhum texto, componente ou estilo mudou (diff de `src/components/`, `src/modules/work-time/messages.ts`).
2. Que cada estado que passa a aparecer em mais situações está em pt-BR claro, coerente com o resultado (valores em
   reais, sem conversão), acionável ("Tentar de novo") e acessível (papéis e anúncios já existentes). Use os
   registros `[valores-b03-g…]` dos logs E2E e o código.
3. Os impactos conhecidos que o pedido manda documentar, sem mudança de interface: sincronização demorada (mais
   tempo em "calculando" ou "em atualização"; a conversão volta sozinha) e a disponibilidade do painel "Receitas
   consideradas" (RR-R31-06 da R3.1) — diga se a redação proposta pelo executor no relatório é precisa, ou indique a
   sua.
Não rode E2E (portas em uso); se uma observação na tela for indispensável para concluir, peça no parecer.
