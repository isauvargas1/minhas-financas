# Rodada 3: revisão adversarial da árvore final

**Veredito:** 0 BLOCKER, 0 HIGH, 0 MEDIUM e 4 LOW. A pergunta 14 fica pendente do `verify:all`.

**Base da revisão.** Trabalhei só com leitura. Recalculei o delta contra `43ffbfa1` sem gravar objetos:
- fora das evidências, 9 arquivos novos, 19 modificados e nenhum removido, o que bate com a lista;
- depois das 13:44Z mudaram só `pressOrigin.ts` (`5ca234f9…`), `press-origin.test.ts`, `notifications-guard.test.ts`, as duas specs E2E e os quatro arquivos da corrida;
- `NotificationsPanel`, `Header`, `feed`, `model`, `analysisContext`, `prompts` e `AiShareConsentDialog` têm os mesmos hashes da rodada 2;
- `callables`, `gateway`, `policy`, `consent`, `admission`, `api.ts`, Rules, índices e `playwright.config` são idênticos à base.

Um registro de processo: rodei `git status --short` uma vez no início, o que pode ter atualizado só o cache de stat do índice. Depois disso usei `GIT_OPTIONAL_LOCKS=0`.

## As 15 perguntas

| # | Veredito | Resumo |
|---|---|---|
| 1 | OK | `analysisContext.ts:295-305` copia só valor e participação. O rótulo é fixo (`:308-309`, `:515`). A forma do contexto é fechada (`aiContext.integration.test.ts:101-117`) e há teste com getters que lançam erro (`analysisContext.test.ts:596`). Um nome só chega ao Google se o usuário o digitar na pergunta, e o diálogo avisa. |
| 2 | OK | O código diz "sanitizar não é anonimizar" (`analysisContext.ts:31-35`). A prova é estrutural: nome inteiro, janelas de 8 caracteres, chaves e IDs (`aiMinimization.integration.test.ts:150-245`). As regex são só complemento. `ai-share-contract.test.ts:38-48` proíbe prometer anonimização. |
| 3 | OK | `AiShareConsentDialog.tsx:101-106` cobre todos os blocos renderizados. O patrimônio só entra com permissão (`analysisContext.ts:325`, `:397`). |
| 4 | OK | Confirmação, papel relido, relatório com o papel atual e sem ranking de clientes (`callables.ts:375-397`). Só dados e pergunta são enviados (`:281-288`). O viewer fica fora (`policy.ts:33-37`). Nada disso mudou desde a base. |
| 5 | OK | Centavos e pontos-base copiados sem alteração (`analysisContext.ts:300-305`), teto de 5 grupos, mutante X17 morto. O relatório oficial está fora do delta. |
| 6 | OK com limite | A regra está só na instrução (`prompts.ts:44-51`). Não há filtro de saída nem teste com o modelo real. |
| 7 | OK | A pergunta vai inteira, só sem caracteres de controle (`callables.ts:287`). Só o hash é persistido (`admission.ts:80`). O diálogo mostra a pergunta e avisa (`AiShareConsentDialog.tsx:99,104`). |
| 8 | OK | Ordem mantida: confirmação, contexto, admissão e só então o provedor (`callables.ts:375,396-416`). O aviso de crédito está em `:106` do diálogo. |
| 9 | OK | Rules idênticas à base (`firestore.rules:1015-1044`). A fusão nunca liga marca nova (`model.ts:281-312`). "Excluir" só aparece com `canDelete` (`NotificationsPanel.tsx:237`). |
| 10 | OK | `NotificationsPanel.tsx:253` → `Header.tsx:351` → `feed.ts:337-339` → `api.ts:120-121`: grava só o estado do próprio usuário. E2E 02 e 19 cobrem. |
| 11 | OK com limite | Spec original intacta (SHA `08fd3057…`), sem espera arbitrária. As duas causas estão tratadas: `pressOrigin.ts:79-90` e `NotificationsPanel.tsx:79-80,196`. Rodada 5 com 80/80 mais a regressão determinística. Limites: L2, L5, N1 e N2. |
| 12 | OK | O fundo é dono de gesto (`Header.tsx:241`). Um gesto iniciado no painel é impedido ou reentregue à origem (`pressOrigin.ts:87-89`). E2E 15 e 16 cobrem. |
| 13 | OK com limite | 20 de 20 encerramentos com identidade, propriedade, `ativos=0` e, desde as 13:41Z, `conexoes=0`, sempre por SIGTERM (`stop-own-emulator.sh:16-25`; `encerramentos-emulator.txt`). Os desvios anteriores às 12:41Z estão divulgados. |
| 14 | Pendente | Detalhe abaixo da tabela. |
| 15 | OK (provisório) | O roteador é global, mas só age onde há donos (fundo e painel). Os outros ouvintes globais são de `mousedown`. O `verify:fast` passou; falta o E2E completo. |

**Pergunta 14.** Situação no log às 14:53Z:
- **Já passou:**
  - typecheck;
  - lint sem erros (201 avisos, nenhum em arquivo da P5-E1.1);
  - build;
  - unitários das Functions, 661/661;
  - todos os unitários do frontend, entre eles notificações (99/99) e billing (72/72);
  - integração e Rules ainda rodando, com 2.584/2.584 até agora.
- **Falta:** o E2E da suíte ainda não começou.
- **Conferido à parte:** a spec original tem o mesmo SHA da base, a rodada 5 deu 80/80 (40/40 por tema, maior série 40/40) e o pré-teste deu 33/33 (`execucoes/e2e-specs-p5e11-final.txt`).

## Achados da rodada 2

| Achado | Estado na árvore final |
|---|---|
| M1 | **Tratado.** A spec empacota o `NotificationsPanel` real, e a sonda é fiel: repassa todas as props e só acrescenta o aviso ao teste. A guarda exige `useState(0)`. R13r, R14r e R16r reprovam (`mutlogs/mut-R16r.log` recebeu `["Aviso b","Aviso c"]`). Resta o N3. |
| M2 | **Em fechamento, como previsto.** Ainda há links para `execucoes.md` e `VEREDITOS.md` (`LEIAME.md:3,20,24`; `repeticoes-mobile.md:46`). |
| L1 | **Tratado** (`notifications-mobile-p5e11.spec.ts:14-41`). |
| L2 | **Risco residual** com descrição técnica correta, mas o registro "no diagnóstico §4.1" não existe (N4). |
| L3 | **Tratado** (`pressOrigin.ts:112-113`; R18). |
| L4 | **Parcialmente.** Vale para botões; no dono `div` o foco não muda (N2). |
| L5 | **Risco residual.** A descrição é adequada, mas omite a variante do "Excluir para mim", e o registro está só na tabela da revisão. |
| L6 | **Tratado** (`stop-own-emulator.sh:18,25`; texto do ambiente refeito; proxy nas evidências). |
| L7 | **Tratado.** Só `revisao/rodada1-completa.txt` está sem quebra de linha final, o que não importa. |
| L8 | **Tratado** (`ai-consent-extraction.spec.ts:230-251`, `:269-291`). O item (a) é decisão registrada; o (b) é resíduo registrado só na tabela. |

## Achados novos

**N1 — LOW: caneta que age como mouse perde o "deslizar para fora cancela"** (`src/lib/pressOrigin.ts:88-89`; docstring `:19-21`; não há caso de caneta em `tests/unit/press-origin.test.ts`).
- **Quando acontece:** com caneta que se comporta como mouse (mesa digitalizadora no macOS/Linux; no Windows, conforme o modo), o `click` vai ao ancestral comum do `pointerdown` e do `pointerup`.
- **Cenário:**
  1. O usuário pressiona "Arquivar" do aviso X.
  2. Desliza para o corpo do X, ou para o Y, e solta em menos de 1 s: o gesto convencional de cancelar.
  3. O `click` cai no item X ou na lista.
  4. Como `pointerType` é `pen`, a regra reentrega o clique ao "Arquivar", e X é arquivado sem volta (a marca só liga).
- **Antes da P5-E1.1:** o mesmo gesto abria o X ou não fazia nada. Com mouse, a regra só impede (protegido pelo R04).
- **Correção:**
  - tratar caneta como mouse (só impedir), ou guardar o alvo do `pointerup` e só reentregar se ele estiver no dono de origem;
  - no toque, a captura implícita mantém o `pointerup` na origem, então o caso do toque não muda;
  - acrescentar um caso unitário de caneta.

**N2 — LOW: o L4 só vale para dono focável** (`pressOrigin.ts:113-115`; `diagnostico-notificacoes.md:84`, onde diz "O foco vai junto").
- **Causa:** o corpo do aviso é um `div` sem `tabindex` (`NotificationsPanel.tsx:198-206`). O `focus()` não faz nada, e o foco fica no botão onde caiu o `mousedown` de compatibilidade.
- **Cenário:**
  1. Tablet com teclado; o usuário toca no corpo do X, um aviso sem link, enquanto outro aviso sai da lista.
  2. O clique cai em "Arquivar" do Y e é reentregue ao X: ele é marcado como lido e o painel continua aberto.
  3. O foco fica em "Arquivar" do Y, e o próximo Enter arquiva o Y sem volta.
- **Correção:**
  - depois do `click()`, se `document.activeElement` estiver fora do dono, chamar `blur()`;
  - ajustar a frase do diagnóstico.

**N3 — LOW: a regressão determinística não tem controle positivo na suíte** (`e2e/notifications-exit-race.spec.ts:72-90`).
- **O que o teste prova:** que a sonda rodou, porque o `evaluate` só resolve em `__afterExitComplete`.
- **O que não prova:** que a remoção do "b" caiu na janela da corrida.
- **Cenário de falso PASS:**
  1. Uma atualização de React ou framer-motion (ou uma mudança na sonda) faz o render adiado acontecer antes da remoção.
  2. A corrida some, e as 10 rodadas passam também sem a correção.
  3. A não vacuidade hoje depende de uma única execução dos mutantes R13r, R14r e R16r.
- **Correção:**
  - criar um caso de controle no mesmo arquivo em que a sonda não repassa o `onExitComplete` ao painel (uma flag na `window`);
  - o teste espera o segundo `onExitComplete`, que marca o fim da saída do "b", e mais dois quadros;
  - e exige que o "b" continue no DOM. Se o controle passar a falhar, a regressão ficou vazia.

**N4 — LOW: os riscos residuais não estão onde a evidência diz** (`revisao-independente.md:84,87,90`; `diagnostico-notificacoes.md:95-146`).
- **Problema:** a tabela da revisão diz que o L2 está registrado no §4.1, mas o §4.1 não cita os dois caminhos e apresenta a correção como completa ("o aviso que terminou de sair é desmontado"). O L5 e o L8b só existem na tabela.
- **Cenário:** quem decide o fechamento pelas evidências não encontra os limites conhecidos.
- **Correção:** acrescentar "Riscos residuais" ao §4.1, repetidos na seção 20.12:
  - L2a e L2b;
  - L5, com a variante "Excluir para mim", que abre a confirmação de um aviso que já está saindo;
  - L8b;
  - N1, N2 e N3.

## Verificado sem problema

- **`pressOrigin.ts`:**
  - o foco vai com `preventScroll` e sem anel de foco depois de ponteiro; dono sem `click()` só tem o clique impedido;
  - o clique reentregue (`detail` 0, origem já zerada) passa uma única vez;
  - teclado e leitor de tela (`detail` 0, `pointerId` -1), toque longo, rolagem, multitoque no Chromium e duplo disparo continuam corretos;
  - com dois componentes montados há um único par de ouvintes (contador, coberto por teste).
- **Harness da corrida:**
  - exercita o painel real e não tem outra fonte de re-render (`useKeepInsideViewport` só ouve `resize`);
  - `write: false` evita esvaziar o `dist/` que o `vite preview` serve;
  - import quebrado faz o teste falhar, nunca passar.
- **`useFocusableWhenScrollable`:**
  - o efeito sem dependências é necessário, porque o diálogo é montado fechado;
  - o `ResizeObserver` é desconectado a cada render, e não há laço (trocar o atributo não muda o layout);
  - a armadilha de foco recalcula os focáveis a cada Tab, e o React não controla esse `tabindex`.
- **Guardas estáticas:** são textuais, mas cada uma tem um teste comportamental que pega o defeito (E2E da corrida, E2E do diálogo, unitários do roteador). Os diffs só acrescentam testes e asserções, sem `skip` nem `only`.
- **Evidências:**
  - minimização, diagnóstico (§4 e §4.1), repetições (80/80 confere) e porta 8080 batem com o código;
  - capturas do painel com diferença de 0,00%.
- **Mutações:** refazer E04 e E05 na cópia final basta, desde que:
  - os logs desses dois sejam guardados;
  - a gravação do JSON seja serializada, ou a tabela seja gerada a partir dos logs de cada mutante;
  - a linha "E2E, lote 1 … E01–E06, 6 mortos" seja conciliada com a tabela final;
  - fique dito que E01–E03 citam as linhas 297/620 da cópia das 13:05Z (hoje são 302/625).
