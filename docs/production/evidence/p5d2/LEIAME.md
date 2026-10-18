# Evidência — P5-D2, contagem exata de não lidas e condições dos Relatórios (2026-10-11)

As capturas foram feitas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados em duas árvores isoladas:
- "antes": a árvore `7c3913f6`, base da P5-D2 (D-18-NOTIF concluída; o sino conta só o que foi carregado);
- "depois": snapshot do working tree com a P5-D2 (árvore `c82090ad`).

A semente é a mesma nas duas. Os eventos são os de cartões e convite, no formato que as duas árvores leem, e o estado privado fica em `notification_entries` nas duas. A conta negativa dos Relatórios nasce pela callable real `createCashTransaction`, e a captura espera a própria `getFinancialReport` refletir o pagamento. Os relatórios registram o rótulo do sino, o badge, o chip, a geometria do painel, a rolagem horizontal e as violações do axe.

**Telas** (desktop 1440×900 e celular 390×844 com toque, temas claro e escuro):
- `sino-owner`: cabeçalho de quem tem 30 não lidas (só 25 cabem na primeira página);
- `painel-owner`: o painel desse usuário;
- `painel-viewer`: viewer, com 3 não lidas de 4;
- `painel-vazio`;
- `relatorio-condicoes` (tela) e `relatorio-condicoes-lista` (recorte da lista), com uma conta de saldo negativo;
- só no depois, `painel-indisponivel`: contagem indisponível ("?"), com o limite de frequência da contagem no teto.

Total: 24 capturas no antes e 28 no depois.

## Diferenças (`diferencas-pixels.txt`, limiar 48 por pixel)

Esperadas e observadas:
- **Sino (`sino-owner`), 0,00%:** o badge continua "9+". Muda só o rótulo acessível, que não aparece na captura:
  - antes: "Notificações, 25 não lidas entre as mais recentes";
  - depois: "Notificações, 30 não lidas", o total do servidor.
- **Painel do owner, desktop 0,01%:** o chip passa de "25+" para "30". No celular, 0,30% a 0,33%: além do chip, o texto "Marcar exibidas como lidas" quebra de outro jeito, porque o chip ficou mais estreito.
- **Painel do viewer, 0,00%:** com a semente corrigida, os dois mostram "3 não lidas". O mesmo vale para o painel vazio, que muda só no texto para leitor de tela: "Notificações" vira "Notificações, nenhuma não lida" e o chip passa a dizer "Nenhuma não lida".
- **Relatórios, 5% a 20% na tela inteira:** é o conjunto de mudanças pedido.
  - O título "Alertas e Insights" vira "Condições do período".
  - Entra o parágrafo "Calculadas a partir dos dados do período selecionado; não ficam salvas como notificações." O que vem abaixo desce cerca de 20 px.
  - Cada item passa a dizer "Calculado em DD/MM/AAAA".
  - O botão "Marcar como lido" deixa de existir: `botoesMarcarComoLido` vai de 3 para 0 nos relatórios.
  - O sino dessa tela mostra "1 não lida" no depois: o gatilho novo publicou "Saldo negativo em conta" para a conta que ficou negativa. Os valores financeiros são idênticos nas duas árvores.
  - Os recortes da lista têm alturas diferentes (o parágrafo novo) e por isso não entram na diferença de pixels.
- **`painel-indisponivel` (só depois):** badge "?", rótulo "Notificações, total de não lidas indisponível" e chip "?" com o texto "Total de não lidas indisponível". A lista continua utilizável.

## Acessibilidade e responsividade (`*-relatorio.json`)

- **Rolagem horizontal da página:** 0 em todas as telas, nas duas árvores. O painel fica dentro da viewport (no celular, x = 8 a 328 em 390).
- **axe-core (WCAG 2.0/2.1 A e AA), cabeçalho, painel e lista, nos 4 cenários:** o resultado é igual nas duas árvores e a única regra violada é `color-contrast`. Esse débito é anterior à P5-D2 e não foi introduzido por ela:
  - o badge vermelho do sino (texto branco de 10 px sobre `bg-red-500`), em todas as telas;
  - o painel no tema escuro (texto `text-primary`: chip, "Marcar exibidas como lidas" e rótulos de ação);
  - os títulos vermelho e amarelo da lista no tema claro.
- **Estados novos:** o painel "?" não tem violação no tema claro, e no escuro tem o mesmo contraste do painel. Nenhuma violação de outra regra.
- **Teclado, 4 cenários da spec `notifications-p5d2.spec.ts`:** Tab alcança o sino, Enter abre o painel, o foco é visível, e a ordem do Tab é "Marcar exibidas como lidas" e depois "Fechar notificações".

## Limites

- O axe-core entrou como `devDependency` na P5-D2 (`axe-core` ^4.14.0); a spec F lê o `axe.min.js` do pacote (ou de `E2E_AXE_CORE_PATH`) e falha com a instrução se não o encontrar. Os contrastes acima são tolerados só nas superfícies listadas na spec (`CONTRAST_DEBT`); em qualquer outra, nenhuma violação passa.
- Com o axe-core 4.14 do pacote, a regra `label-content-name-mismatch` (WCAG 2.5.3, ativa por padrão nessa versão) acusa dois botões do cabeçalho que já existiam na árvore base: o seletor de mês (rótulo "Selecionar Mês e Ano", texto visível com o mês) e o sino (rótulo com o total, badge visível dentro do botão). As capturas acima foram auditadas com o axe-core 4.13.0, instalado fora do projeto, e por isso não registram essa regra. A spec F aceita essa regra só quando todos os nós dela resolvem, na página, para esses dois botões (`LABEL_IN_NAME_DEBT`), e registra a anotação `rotulo-no-nome-conhecido`; em qualquer outro nó, ou em qualquer outra regra, falha. Corrigir exigiria mudar o rótulo visível ou acessível do cabeçalho, o que fica fora do escopo (interface inalterada).
- Os horários relativos do painel ("5 h atrás") variam em minutos entre capturas de uma mesma árvore, e a diferença de pixels já descarta o ruído abaixo de 48 por pixel.
- Esta evidência é de um snapshot do working tree. Se o código da P5-D2 mudar, as capturas do depois precisam ser refeitas.
  Depois deste snapshot, as correções da revisão independente mudaram só o que estas telas não mostram: textos e tipo (ícone) dos avisos de empréstimo, recebível e recorrente (a semente usa cartões e convite), `asOf` com nanossegundos, releitura da contagem na expiração local, completude das condições com o caixa indisponível (as telas têm o caixa disponível), correlação nos logs dos gatilhos e cursor de retomada da rotina de recebíveis (sem efeito na interface).
- O Emulator não executa TTL; a retenção física não é testada aqui.

## Outros arquivos desta pasta

- `mutacoes.json`: 38 mutantes válidos e 38 mortos, com a asserção que matou cada um e a árvore da cópia isolada em que rodaram.
- `prova-remocao.txt`: busca no código de produção e nas E2E que comprova a remoção da leitura falsa (`markAlertAsRead`, `readAlertIds`, "Marcar como lido"), da contagem parcial e do polling. Também mostra que o cliente não escreve notificações e que os produtores não leem `client_private`.
- `VEREDITOS.md`: vereditos das skills de domínio e do `regression-release-gate` sobre o estado final.
