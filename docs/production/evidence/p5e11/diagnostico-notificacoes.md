# P5-E1.1 — Falha intermitente das notificações no celular: diagnóstico, causa e correção

Este documento cobre o teste "F — celular 390×844 (toque)", em `e2e/notifications-p5d2.spec.ts`.

Antes da correção, o teste falhava de forma intermitente: 1 vez em 16 execuções na base da P5-D2.1 e 3 vezes em 20 na P5-E1. Havia dois sintomas:

- a lista ficava com 8 itens onde deveria ter 7, por volta de `toHaveCount(7)`;
- o painel fechava no meio dos toques em "Arquivar para mim".

A causa foi diagnosticada com instrumentação antes de qualquer mudança no app (§7.4).

## 1. Método

- **Cópia de diagnóstico:**
  - árvore auditada da P5-E1, `43ffbfa162299814a59005acff476ffbc77488cf`, extraída com `git archive`;
  - Emulator dedicado em portas trocadas: 8280, 9299, 5201 e 9350, com hub 4420, logging 4520 e UI desligada;
  - projeto `minhas-financas-local`;
  - script em [`diagnostico/ferramentas/make-diag-tree.sh`](diagnostico/ferramentas/make-diag-tree.sh).

  A troca de portas serve só ao diagnóstico. Não substitui o `verify:all` padrão.
- **Instrumentação:** o script [`diagnostico/ferramentas/patch-diag-spec.py`](diagnostico/ferramentas/patch-diag-spec.py) acrescenta à spec, sem alterar asserções nem interações:
  - resumo das requisições e respostas do Firestore e das callables;
  - console da página;
  - captura, dentro da página, de `pointer*`, `touch*`, `mouse*` e `click`, com o elemento-alvo e as coordenadas;
  - foco;
  - IDs da lista e estado de abertura do painel a cada mudança;
  - marcas nos passos do teste;
  - estado privado persistido no fim (`notification_user_states/{uid}/notification_entries`).
- **Execuções:** `--grep celular --repeat-each=10`, ou seja, 20 execuções (10 no tema claro e 10 no escuro), com dados reiniciados a cada teste (`clearEmulatorData`).
- **Instrumentação do app (rodadas finais, só na cópia):** [`diagnostico/ferramentas/patch-diag-app.py`](diagnostico/ferramentas/patch-diag-app.py) registra a decisão do roteamento de cada clique, o início e o resultado de cada leitura e de cada ação do feed, o cache depois de cada ação, a fusão de marcas e o início e o fim de cada animação de saída, inclusive o `onExitComplete` do `AnimatePresence`. Os resumos saem de [`analyze-diag.py`](diagnostico/ferramentas/analyze-diag.py) e [`gap-diag.py`](diagnostico/ferramentas/gap-diag.py).

## 2. Resultado antes da correção: 17 aprovadas e 3 falhas, todas com a mesma assinatura

| Execução | Toque (alvo de `pointerdown`/`touchstart`/`touchend`) | `mousedown`/`click` de compatibilidade | Estado persistido | Efeito |
| --- | --- | --- | --- | --- |
| r1, tema escuro ([log](diagnostico/antes/FAIL-r1-escuro.txt)) | botão "Arquivar para mim: Aviso F 03" em (304,175), às …903885 | corpo de um aviso (`DIV.p-4.border-b`), 14 ms depois | `f_04 read:true`; `f_03` não arquivado | F 04 marcado como lido, navegação, painel fechado |
| r7, tema claro ([log](diagnostico/antes/FAIL-r7-claro.txt)) | botão "Arquivar para mim: Aviso F 03" em (304,335), às …034699 | corpo de um aviso, 5 ms depois | `f_04 read:true`; `f_03` não arquivado | idem; o sino chegou a 8 por coincidência (3 arquivados + 1 lido) |
| r9, tema claro ([log](diagnostico/antes/FAIL-r9-claro.txt)) | botão "Arquivar para mim: Aviso F 01" em (304,175), às …089353 | corpo do próprio F 01, 16 ms depois | `f_01 read:true`; só `f_00` arquivado | F 01 lido em vez de arquivado, navegação, painel fechado |

Trecho de r7 (relógio em ms):

```
…034669 REQ commit notification_entries/f_02 (arquivamento de F 02)
…034697 RES 200 commit                            ← F 02 confirmado: ele começa a sair da lista
…034699 EV pointerdown/touchstart BUTTON "Arquivar para mim: Aviso F 03"  xy=304,335
…034704 EV mousedown DIV.p-4.border-b             xy=304,335   ← mesmo ponto, outro elemento
…034705 EV click     DIV.p-4.border-b             xy=304,335
…034713 DOM open=false                            ← painel fechado (navegação do aviso)
…034777 REQ commit notification_entries/f_04      ← F 04 marcado como lido
```

As 17 execuções aprovadas têm a mesma sequência de toques. A diferença é que, nelas, nenhuma mudança de layout caiu entre o `touchend` e o `click` de compatibilidade.

## 3. Causa

1. Num toque, o Chromium (e os navegadores móveis em geral) entrega `pointerdown`, `touchstart`, `pointerup` e `touchend` ao elemento tocado. Só depois ele gera `mousedown`, `mouseup` e `click` de compatibilidade, com um **novo teste de acerto** no mesmo ponto.
2. Quando o arquivamento de um aviso é confirmado pelo Firestore (`onSuccess` com os IDs gravados), esse aviso sai da lista com `AnimatePresence`, `exit={{ height: 0 }}` e `layout` nos irmãos. Durante cerca de 300 ms, os avisos de baixo sobem a cada quadro.
3. O teste toca os quatro botões em sequência rápida, cerca de 70–110 ms entre toques, sem esperar confirmação. Isso é o que um usuário faz e corresponde ao caso "dois rápidos" do §9.3. Quando a confirmação de um arquivamento anterior chega, ou a animação dele está em curso, entre o `touchend` e o `click` de um toque, o `click` cai no **corpo de um aviso**:
   - pode ser o próximo aviso, ou a faixa abaixo do botão no próprio aviso;
   - o `onClick` do item chama `handleItemClick`: marca como lido, navega para a tela do link e **fecha o painel**;
   - o arquivamento tocado se perde.
4. Isso explica os dois sintomas relatados:
   - **"Lista fica com 8":** um aviso foi lido em vez de arquivado, e o painel reaberto mostra um item a mais.
   - **"Painel fecha durante os toques":** foi a navegação do aviso atingido por engano.

É um defeito real do aplicativo, não só do Playwright. Um toque legítimo em "Arquivar" pode marcar como lido e abrir **outro** aviso. Isso fere o §8.3: "sem alterar outro item por índice deslocado", "sem fechamento inesperado".

### Hipóteses do §7.3

| Hipótese | Conclusão |
| --- | --- |
| A — fundo `fixed inset-0 z-30` | Não observada nas 20 execuções. É a mesma classe de defeito: um `click` redirecionado para o fundo fecharia o painel. Recebeu a mesma proteção, com teste. |
| B — releitura assíncrona com resposta antiga | Não observada no E2E. **Reproduzida de forma determinística** em teste unitário com React Query real. Uma releitura que leu o estado antes da gravação e chega depois dela restaura o item arquivado, lido ou excluído. Os gatilhos são `refetch`, foco, releitura após erro e "Carregar mais", que reaproveita as páginas do início da leitura. 4 testes falhavam antes da correção ([saída](feed-resposta-antiga-antes.txt)). Corrigida. |
| C — remover só depois da escrita confirmada | O comportamento já era correto e foi preservado: o item só sai com o `onSuccess` dos IDs gravados. |
| D — identidade e cache (UID/workspace) | Sem evidência de falha. As chaves seguem por `(workspace, uid)`, e o resultado entra só no escopo em que a ação começou. Isso é coberto pelos testes de troca de workspace e de conta. |
| E — eventos de toque | **Causa confirmada** (§3). |

## 4. Correção (menor mudança)

1. **O clique de um gesto vai para o elemento em que o gesto começou.** Isso fica em `src/lib/pressOrigin.ts` (`routeGestureClick`, `applyGestureClickRoute`, `usePointerOriginTracking`).
   - Um único par de ouvintes de captura no documento guarda a origem do último `pointerdown` (alvo, `pointerId`, tipo de ponteiro e instante).
   - Quando o `click` desse mesmo gesto cai num "dono" diferente daquele em que o gesto começou, o clique é impedido ali (`preventDefault` + `stopPropagation` na captura, antes do React). Dono é o elemento marcado com `data-press-target`: cada aviso, "Arquivar para mim", "Excluir para mim" e o fundo do `Header`.
   - Depois disso:
     - **toque ou caneta:** o clique é reentregue ao dono de origem (`click()`), se ele ainda está na página. Quando o dono é focável (os botões "Arquivar" e "Excluir"), o foco vai junto, sem rolar a tela, porque o `mousedown` de compatibilidade pode tê-lo levado ao elemento em que o clique caiu. O corpo do aviso é um `div` sem `tabindex`: aí o `focus()` não tem efeito e o foco fica onde o `mousedown` o deixou (risco residual N2, abaixo). Um dono sem `click()` só tem o clique impedido;
     - **mouse, origem sem dono ou dono que saiu da página:** o clique só é impedido.
   - O **navegador continua decidindo se houve clique**: toque curto, sem rolagem, sem parar inércia, sem toque longo. O código não reimplementa o toque.
   - Passam intocados: clique sem ponteiro (`detail === 0`: teclado, leitor de tela, `click()` programático), clique de outro ponteiro (por exemplo, `pointerId` `-1` de clique simulado) e clique de gesto com mais de 1 s.
2. **Componentes.** O `NotificationsPanel` e o `Header` só ganharam `usePointerOriginTracking()` e a marca `data-press-target` em três elementos do painel e no fundo. Os `onClick` são idênticos aos originais.
3. **Remoção garantida no fim da saída (segunda causa, §4.1).** O `AnimatePresence` da lista ganhou `onExitComplete`, e o painel re-renderiza a cada chamada com uma atualização funcional (`setExitCompletions((count) => count + 1)`). A linha mantém o `layout` original: a animação da lista é a mesma da base, sem nenhuma diferença visual.
4. **Marca confirmada não volta atrás.** `keepConfirmedNotificationMarks` (`src/modules/notifications/model.ts`) virou o `structuralSharing` da consulta do feed (`src/modules/notifications/feed.ts`).
   - Toda resposta de leitura conserva as marcas lida, arquivada e excluída que o cache já tinha, e só para o mesmo evento: mesmo ID e mesma expiração.
   - As Rules só deixam ligar essas marcas, nunca desligar (`isNewNotificationMark` e `isKeptOrNewNotificationMark`).
   - A fusão nunca inventa marca nem item.

### 4.1 Segunda causa: aviso arquivado preso no DOM (`AnimatePresence` do framer-motion 10.16.4)

Com o roteamento do clique, as repetições ainda falhavam de vez em quando, sempre com o mesmo sintoma (lista com 8): 39/40 oficiais e 77/80 e 78/80 instrumentadas, com `layout`; depois, 76/80 oficiais e 77/80 instrumentadas, já sem `layout`. Em todas as falhas instrumentadas ([com `layout`](diagnostico/saida-presa/commit-confirmado-sem-remocao.txt), [estilos com `layout`](diagnostico/saida-presa/FAIL-1-claro.txt), [sem `layout`, com o registro do app](diagnostico/forcerender/linhas-do-tempo-falhas.txt)):

- o toque e o clique chegam ao botão "Arquivar para mim: Aviso F 04" e o roteamento deixa passar (`ROUTE pass`);
- a ação confirma (`MUT ok marked=f_04`), o cache fica com `f_04` arquivado e o aviso sai da lista visível;
- a animação de saída começa e termina, e o `AnimatePresence` chama `onExitComplete`;
- o estado persistido fica `dismissed: true`, sem releitura da lista;
- mesmo assim, a linha do F 04 continua no DOM com `opacity: 0; height: 0px; overflow: hidden`. Fica invisível, ocupa 65 px de espaçamento (o `padding` da linha) e continua clicável.

**Mecanismo, conferido no código do framer-motion 10.16.4 e reproduzido fora do app:**
- O `AnimatePresence` só tira do DOM os itens que terminaram de sair quando a última saída em curso termina. Nesse momento, ele agenda `forceRender()` para o próximo quadro (`frame.postRender`).
- Esse `forceRender` vem de `useForceUpdate` (`utils/use-force-update.mjs`), que faz `setForcedRenderCount(forcedRenderCount + 1)` com o valor capturado no render em que a função foi criada. Cada item que começa a sair guarda o `forceRender` do render em que a saída começou.
- Se o F 04 começa a sair logo depois de o F 03 terminar e antes desse render adiado, ele guarda o mesmo `forceRender` (contador N). O render adiado leva o contador a N+1. Quando a saída do F 04 termina, o `forceRender` dele grava N+1 de novo, o React descarta a atualização igual e nada tira o F 04 do DOM.
- Nas três falhas instrumentadas sem `layout`, a saída do F 04 começou 7, 10 e 21 ms depois do `exitComplete` anterior. Nas 77 aprovadas, esse intervalo foi de 14 ms ou mais, quase sempre acima de 80 ms, ou não houve `exitComplete` no meio ([atrasos](diagnostico/forcerender/atrasos.txt)). A janela é de cerca de um quadro, por isso a falha é rara e depende de tempo.
- **Reprodução determinística** ([`ferramentas/harness`](diagnostico/ferramentas/harness/)): uma página mínima com React 18.2 e framer-motion 10.16.4, as mesmas versões do app, remove o segundo item exatamente nessa janela, de dentro do `onExitComplete` do primeiro:
  - sem a correção, o item fica preso em 20/20 ([resultado](diagnostico/ferramentas/harness/resultado-corrida.txt));
  - com a correção, em 0/20;
  - com e sem `layout`, o resultado é o mesmo, também numa varredura de atrasos: o item fica preso só com 0–12 ms de atraso e só sem a correção ([cenários](diagnostico/ferramentas/harness/resultado-cenarios.txt));
  - num estresse com remoções em intervalos aleatórios, sem a correção o item ficou preso em 0–7 de 50 execuções, conforme a rodada e sem relação com o `layout`; com a correção, em 0/50 ([LEIAME](diagnostico/ferramentas/harness/LEIAME.md)).

**Hipótese anterior refutada.** A primeira versão deste diagnóstico atribuiu a saída presa ao `MeasureLayout`, o registro de presença que o `layout` acrescenta, e tirou o `layout` da linha. A hipótese estava errada:
- pelo código, quando o item deixa de estar presente, o `MeasureLayout` chama `safeToRemove` no `postRender` seguinte (`relegate()` é falso e não há pilha de `layoutId`), sem esperar animação nenhuma;
- sem `layout`, a falha continuou com a mesma assinatura e a mesma frequência (76/80 oficiais e 77/80 instrumentadas, contra 39/40, 77/80 e 78/80 com `layout`);
- na reprodução determinística, o `layout` não muda o resultado.

Por isso o `layout` voltou à linha: a remoção dele era uma mudança visual sem necessidade (os de baixo deixavam de deslizar quando um aviso novo entrava). A guarda que proibia o `layout` foi substituída por outra que exige a animação original e a correção.

**Correção:** o painel passa `onExitComplete` ao `AnimatePresence` e re-renderiza a cada chamada (`setExitCompletions((count) => count + 1)`). O `onExitComplete` é chamado no mesmo ponto do `forceRender`, quando a última saída termina. A atualização é funcional, então vale mesmo quando o `AnimatePresence` chama uma versão antiga do manipulador. No re-render, o `AnimatePresence` desenha só os itens presentes, e o aviso que terminou de sair é desmontado.

O defeito é preexistente e dependente de tempo, e é real para o usuário: deixa um vão vazio e um item invisível que ainda recebe toques. Fica fixado por:
- **regressão determinística na suíte E2E**, `e2e/notifications-exit-race.spec.ts`:
  - empacota com o Vite, fora do app, o `NotificationsPanel` real;
  - só nesse pacote, os ícones viram vazios e o `AnimatePresence` avisa o teste logo depois do `onExitComplete` do painel;
  - tira o aviso "a" e, exatamente nesse instante, o "b", e exige que o "b" saia do DOM, em 10 rodadas;
  - sem a correção, o "b" fica preso em todas;
- a guarda estática em `tests/unit/notifications-guard.test.ts`, que exige o `useState(0)`, o `onExitComplete`, a atualização funcional e a animação original da linha;
- os mutantes, em [`mutacoes.md`](mutacoes.md):
  - R13r, R14r e R16r morrem pela regressão determinística: sem `onExitComplete`, com valor fixo no lugar da atualização funcional, e com um setter que não faz nada;
  - R13, R14, R15 e R16 morrem pela guarda;
- a reprodução fora do app ([`ferramentas/harness`](diagnostico/ferramentas/harness/)), que mostra o defeito da biblioteca com e sem `layout`;
- as repetições oficiais ([`repeticoes-mobile.md`](repeticoes-mobile.md)).

Não mudaram:
- Rules, TTL e índices;
- o estado privado em `notification_user_states/{uid}/notification_entries` e os tombstones da D-18;
- a paginação por cursor bruto;
- a contagem exata pela callable;
- as permissões (o viewer lê e arquiva, não exclui);
- o momento de remoção: só após confirmação;
- textos, estilos, disposição e animações da tela: nenhuma diferença visual em relação à base.

#### Riscos residuais (revisões 2 e 3)

A correção não cobre estes casos, todos LOW e registrados também no plano mestre (§20.12):
- **L2. Dois caminhos do `AnimatePresence` 10.16.4 que a correção não cobre.** Nos dois, o `onExitComplete` deixa de ser chamado (`index.mjs:129-135`) e as saídas seguintes ficam presas até outro render do painel:
  - **(a) chave que volta durante a própria saída:** ela fica para sempre em `exitingChildren`. No painel, exigiria um aviso sair e voltar em menos de 300 ms; não há gatilho conhecido, porque as marcas só ligam e não há remoção otimista;
  - **(b) saída mais antiga que termina por último:** uma chave já removida volta a `exitingChildren` sem filho. No painel, exigiria término fora de ordem, improvável com a transição uniforme.
  - Atualizar o framer-motion fica para uma milestone própria.
- **L5. Reentrega a um aviso que já está saindo.** O toque começa num aviso cujo arquivamento já foi confirmado. Se o clique for reentregue a ele, repete um arquivamento idempotente, navega para o aviso arquivado ou, no "Excluir para mim", abre a confirmação de um aviso que está saindo, que pode ser cancelada. Antes, a ação caía no aviso vizinho.
- **N1. Caneta que se comporta como mouse.** Numa mesa digitalizadora, pressionar "Arquivar", deslizar para fora e soltar em menos de 1 s gera um `click` no ancestral comum; a regra reentrega ao "Arquivar" e o aviso é arquivado. Antes, o mesmo gesto abria o aviso, quando a caneta soltava sobre ele, ou não fazia nada, quando soltava fora. Correção recomendada: só reentregar quando o `pointerup` estiver no dono de origem, ou tratar caneta como mouse; o toque não muda, porque a captura implícita mantém o `pointerup` na origem.
- **N2. Foco quando o dono é o corpo do aviso** (`div` sem `tabindex`). Com teclado físico num tablet, depois de uma reentrega o foco pode ficar no botão em que caiu o `mousedown`; o próximo Enter age nesse botão. Correção recomendada: `blur()` se o elemento ativo ficar fora do dono.
- **N3. A regressão determinística não tem controle positivo na suíte.** Ela prova que a sonda rodou, não que a remoção caiu na janela. Hoje a não vacuidade é provada pelos mutantes R13r, R14r e R16r, com o framer-motion fixado em 10.16.4 no `package.json` e no lockfile. Correção recomendada: um caso de controle, no mesmo arquivo, em que a sonda não repassa o `onExitComplete` ao painel e o "b" precisa continuar no DOM.
- **L8b. Foco no `body` quando a região focada deixa de rolar** (por exemplo, ao girar o aparelho com o diálogo de IA aberto). O próximo Tab volta ao diálogo pela armadilha de foco.

### Histórico de tentativas (com todas as execuções)

| Desenho | Validação | Resultado |
| --- | --- | --- |
| Antes da correção (árvore da P5-E1, instrumentada) | 20 execuções | 17 aprovadas, 3 falhas (§2) |
| A — ações disparadas no `touchend`, com `preventDefault` para suprimir o click de compatibilidade, mais guarda por origem nos `onClick` | 20 execuções instrumentadas | 20 aprovadas; nenhum click de compatibilidade depois de toque em "Arquivar" |
| A, depois da revisão adversarial (inércia, toque longo, foco, `pointerId`) | 40 execuções oficiais, spec original sem alteração ([log](repeticoes/repeticoes-1-desenho-A.txt)) | **39 aprovadas, 1 falha** (repetição 29, tema claro), descrita abaixo |
| B — roteamento do clique, ainda com `layout` | 40 execuções oficiais; 80 instrumentadas; mais 80 instrumentadas com os estilos das linhas | 39/40; 77/80; 78/80. Todas as falhas são aviso preso no DOM (§4.1), sem nenhum clique desviado |
| B + item sem `layout` (hipótese do `MeasureLayout`, refutada) | 80 execuções oficiais; 80 instrumentadas com o registro do app | 76/80; 77/80. Todas as falhas são aviso preso depois do `onExitComplete` (§4.1) |
| **B + `layout` original + re-render no `onExitComplete` (final)** | spec nova de 20 casos; execuções oficiais ([`repeticoes-mobile.md`](repeticoes-mobile.md)) | ver o registro |

Como foi a falha do desenho A:
- **Sintoma:** o mesmo da falha original. A asserção `toHaveCount(7)` recebeu 8; F 04 continuava na lista, com o botão "Arquivar para mim: Aviso F 04" focado e sem nenhum alerta. No servidor, a contagem foi 13 → 12 → 11 → 10 → 9 → 8, sempre exata, e o estado do F 04 nunca foi gravado.
- **Causa:** naquele toque, a ativação no `touchend` não ocorreu. Ela depende de sinais do navegador: `touchend` cancelável, duração medida no tempo de execução do manipulador, que um travamento momentâneo da thread principal pode inflar, e leitura de inércia. Sem a ativação, o click de compatibilidade assumiu e caiu fora do botão, porque F 03 ainda saía da lista. A guarda impediu a ação errada, mas o arquivamento se perdeu.
- **Decisão:** em vez de reimplementar a detecção de toque, o desenho B deixa o navegador decidir se houve clique e corrige só para onde ele vai. Com isso:
  - os riscos levantados na revisão (toque que só para a inércia, toque longo, foco) deixam de existir;
  - os `onClick` voltam a ser os originais.

## 5. Resultado depois da correção

- **Desenho A (instrumentado):** 20 de 20 aprovadas. Exemplos: [claro](diagnostico/depois/PASS-claro.txt) e [escuro](diagnostico/depois/PASS-escuro.txt). As contagens estão em [`diagnostico/contagens.txt`](diagnostico/contagens.txt).
- **Final (roteamento do clique + fusão de marcas + re-render no `onExitComplete`, com o `layout` original):** as execuções oficiais, com a spec original sem instrumentação e na árvore final, estão em [`repeticoes-mobile.md`](repeticoes-mobile.md).

## 6. Testes que fixam a correção

- **`tests/unit/press-origin.test.ts`:** regra do roteamento. Cobre:
  - reentrega a partir do botão, do item e de nó de texto;
  - mesmo dono;
  - área sem dono para o fundo (impede);
  - mouse e dono fora da página;
  - teclado e leitor de tela;
  - outro ponteiro;
  - janela do gesto;
  - aplicação da rota (impede uma vez, reentrega uma vez);
  - par único de ouvintes de captura e limpeza.
- **`tests/unit/notifications-feed.test.ts`:** 5 casos novos `P5-E1.1`. Cobrem a releitura antiga, "Carregar mais" em curso, lida e excluída, dois arquivamentos com releitura antiga no meio e o isolamento de escopo.
- **`tests/unit/notifications-model.test.ts`:** 3 casos sobre a fusão de marcas, entre eles o evento recriado com o mesmo ID.
- **`tests/unit/notifications-guard.test.ts`:** donos de gesto e roteamento no painel e no `Header`; os `onClick` originais seguem exigidos; a animação original da linha (`layout`, entrada e saída), o `onExitComplete` do `AnimatePresence` e a atualização funcional são exigidos.
- **`e2e/notifications-exit-race.spec.ts`:** regressão determinística da segunda causa, com o `NotificationsPanel` real (§4.1). Roda dentro de `npm run test:e2e`, sem depender do Emulator.
- **Reprodução determinística do defeito do framer-motion** ([`diagnostico/ferramentas/harness`](diagnostico/ferramentas/harness/)): fora do app e da suíte, com as mesmas versões de React e framer-motion; mostra 20/20 preso sem a correção e 0/20 com ela.
- **E2E:** `e2e/notifications-mobile-p5e11.spec.ts` tem 20 casos: os 18 do §9.3 e mais o 19 e o 20, que reproduzem no navegador o clique redirecionado de um toque iniciado num botão, num item ou numa área sem dono. Somam-se a spec original, com todas as asserções e interações preservadas, e o caso 15, sobre o fundo.
