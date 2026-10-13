# P5-E1.1 — Revisão adversarial independente, rodada 2 (árvore final)

Revisor: Opus, somente leitura. Nenhum arquivo do repositório foi editado. Não rodei Emulator, `firebase`, E2E, `verify:all`, `dev` nem `preview`. As Functions foram compiladas só em `revisao2/flib`, nunca em `functions/lib`. Não acessei produção, não li segredos e não fiz commit, push nem deploy. Os mutantes extras rodaram só numa cópia em `revisao2/mirror`.

**Retrato da árvore** (2026-10-13T13:44Z, contra a árvore auditada `43ffbfa1`, com hash de blob calculado sem gravar objetos): 59 arquivos novos, 0 removidos e 19 modificados; índice sem nada staged. A spec original `e2e/notifications-p5d2.spec.ts` tem SHA-256 `08fd30570851559b…`, igual ao da base. Arquivos que mudaram durante a revisão e foram relidos: `tests/unit/press-origin.test.ts` (13:21), `src/components/AiShareConsentDialog.tsx`, `tests/unit/ai-extraction-form.test.ts` e `e2e/ai-consent-extraction.spec.ts` (13:37–13:38, complemento do coordenador), além de `ambiente-porta-8080.md`, `stop-own-emulator.sh` e `with-proxy-safe.sh` (13:20–13:41).

Hashes do código revisado (16 primeiros dígitos do SHA-256): `src/lib/pressOrigin.ts` `ba045ef8e752163b`; `src/components/NotificationsPanel.tsx` `228d3a0244b1556f`; `src/components/Header.tsx` `11254f8d3d307af7`; `src/modules/notifications/feed.ts` `4e2bfa45a6431186`; `src/modules/notifications/model.ts` `51bfde71c5aeb8cf`; `functions/src/ai/analysisContext.ts` `5bd1c72b37417305`; `functions/src/ai/prompts.ts` `78b73acd9bb437a1`; `src/components/AiShareConsentDialog.tsx` `4c9aa6a4514b5205`.

**Resumo:** nenhum BLOCKER, nenhum HIGH. Dois MEDIUM (M1 e M2) e oito LOW. Um achado (R05) foi corrigido durante a revisão.

## 1. As 15 perguntas do §13

| # | Veredito | Evidência (arquivo:linha) | Explicação |
| --- | --- | --- | --- |
| 1 | OK | `functions/src/ai/analysisContext.ts:295-305`, `:307-309`, `:513-521`; `functions/src/ai/callables.ts:283-288`, `:412-416`, `:461-466`; `src/components/ReportsAIChat.tsx:19-33`; `functions/src/ai/__tests__/analysisContext.test.ts:596`; `functions/src/ai/__tests__/aiContext.integration.test.ts:101-162` | `topExpenseCategories` copia só `amountCents` e `shareBasisPoints`; nome e chave nunca são lidos (há teste com getters que lançam erro). O pedido ao provedor tem só a instrução fixa, o bloco de dados renderizado e a pergunta. A extração envia instrução fixa e transcrição ou arquivo, sem catálogo. As sugestões do chat são fixas, e a forma do contexto é uma lista fechada. O único caminho para um rótulo chegar ao Google é o próprio usuário digitá-lo na pergunta, o que o diálogo informa. |
| 2 | OK | `analysisContext.ts:31-35`; `docs/production/evidence/p5e11/minimizacao-contexto-v2.md:7`; `AiShareConsentDialog.tsx:101-106`; `aiMinimization.integration.test.ts:234-243` (prova principal) e `:223-225` (complemento) | O código e a evidência dizem que sanitizar não é anonimizar, e o diálogo não promete anonimização. A prova principal é estrutural: igualdade exata do bloco e da lista de chaves, ausência do nome inteiro e de janelas de 8 caracteres, e getters que lançam erro. As regex de CPF, CNPJ e e-mail só complementam. |
| 3 | OK | `AiShareConsentDialog.tsx:101-106` comparado com `analysisContext.ts:456-604`; `functions/src/reports/report.ts:215,323`; `analysisContext.ts:395-405` | Cada bloco renderizado está no texto. `perfil` corresponde ao tipo do espaço e `contas` aos saldos. `caixa` cobre entradas, saídas, receitas e despesas. Também estão indicadores, cartões, "dívidas e valores a receber", alertas e os grupos. Os fluxos de investimento vão para todos os papéis; o patrimônio, só com permissão, como o diálogo diz. Nuance sem impacto: "valores agregados do período" também inclui posições na data de referência e contagens. |
| 4 | OK | `callables.ts:375`, `:377` com `:326-337`, `:382-392`; `functions/src/ai/policy.ts:33-36`; `analysisContext.ts:325`, `:397-404`; `prompts.ts:71-73` | A confirmação vem antes de tudo. O papel é relido em transação, e o viewer fica fora de `AI_OPERATION_ROLES`. O relatório é montado com o papel atual e sem ranking de clientes, e o patrimônio só entra com `permissions.investments`. As partes não levam `workspaceId` nem `uid`, e a instrução depende só do tipo PF/PJ. Esses arquivos não mudaram desde `43ffbfa1`. |
| 5 | OK | `analysisContext.ts:298-305`, `:245-262`, `:190-199`; `functions/src/reports/` fora do delta | Centavos e pontos-base são copiados sem alteração. A ordenação por valor é estável, com teto de 5, e a cobertura é preservada. A formatação usa aritmética inteira, e o relatório oficial não mudou. Só o desempate mudou (agora segue a ordem do relatório, não o nome); a posição muda, o valor não. |
| 6 | OK, com limite | `analysisContext.ts:513-521`; `prompts.ts:44-51`; `callables.ts:266-277`; `minimizacao-contexto-v2.md:56` | O modelo não recebe nenhum nome, e a instrução proíbe inventar ou associar nomes. Não há filtro de saída (a validação só limpa e trunca) nem teste com o modelo real. Ele ainda pode repetir ou associar um nome que o usuário digitou na pergunta. O limite está declarado. |
| 7 | OK | `callables.ts:117-128`, `:286-287`, `:93-101`, `:114-115`; `prompts.ts:52-57`, `:91-93`; `admission.ts:110,182`; `AiShareConsentDialog.tsx:99`, `:104` | O schema é estrito e a pergunta vai inteira (só caracteres de controle são removidos), marcada como dado não confiável. Ela não vai para log, e só o hash é persistido. O diálogo mostra o texto e avisa sobre dados pessoais. |
| 8 | OK | `callables.ts:375`, `:396-397`, `:398-405`, `:412-416`; `AiShareConsentDialog.tsx:106` | Ordem mantida: confirmação, depois contexto e partes antes da admissão, admissão atômica e só então o provedor. O aviso de crédito continua no diálogo. `consent.ts`, `admission.ts` e `policy.ts` estão fora do delta; P26 a P28 cobrem o fluxo. |
| 9 | OK | `firestore.rules:1015-1044` (idêntico à base); `src/modules/notifications/api.ts:100-125`; `src/modules/notifications/model.ts:295-311`; `tests/unit/notifications-model.test.ts:256-260`; `NotificationsPanel.tsx:237` | As Rules continuam deixando só ligar marcas, com `delete: false`, e o `api.ts` não mudou. A fusão nunca liga uma marca que nem o cache nem a leitura têm e nunca acrescenta item. O "Excluir para mim" só existe com `canDelete`, e a reentrega só vai a um dono que existe, então nunca a um botão de excluir para viewer. |
| 10 | OK | `NotificationsPanel.tsx:253` → `Header.tsx:351` → `feed.ts:337-339` → `api.ts:120-121` (caminho do próprio uid em `api.ts:47-48`); `NotificationsPanel.tsx:199`; E2E 02 | O arquivamento grava só o estado do próprio usuário, pela chave estável `notif.id`. A reentrega vai ao elemento do item tocado, e o E2E 02 confere que só os dois IDs foram gravados. |
| 11 | OK; a proteção por teste é o M1 | hash `08fd30570851559b…`; `pressOrigin.ts:79-104`, `:80`, `:81-83`, `:88`, `:101-103`, `:124-135`; `node_modules/framer-motion/dist/es/utils/use-force-update.mjs:8-10,15`; `.../AnimatePresence/index.mjs:122-136`; `NotificationsPanel.tsx:79-80`, `:196`, `:241`, `:253`; `tests/unit/press-origin.test.ts:130-138` | **Spec e causas.** A spec original está intacta e não há espera arbitrária nem timer. As duas causas foram tratadas: o clique de compatibilidade que cai em outro alvo depois do deslocamento da lista, e o contador capturado no `useForceUpdate` do framer-motion. O navegador continua decidindo se houve clique.<br>**Regressões verificadas:**<br>- teclado e leitor de tela: `detail 0` passa;<br>- caneta: tratada como toque;<br>- toque longo e rolagem: o navegador não gera clique, e o próximo `pointerdown` sobrescreve a origem;<br>- multitoque: o `pointerId` decide;<br>- duplo disparo: o clique original é barrado na captura do documento, antes da raiz do React; os botões param a propagação e há um único `click()`;<br>- item não tocado: a reentrega só vai ao dono do `pointerdown`, e dono desconectado é bloqueado.<br>**Resíduos:** L4 (foco) e L5 (item em saída). |
| 12 | OK | `Header.tsx:238-244`; `pressOrigin.ts:80`, `:87-89`, `:124-135`; E2E 15 e 16 | O fundo é dono de gesto. Um gesto iniciado dentro do painel nunca aciona o `onClick` do fundo: o clique é bloqueado ou reentregue ao dono de origem. Um gesto iniciado no fundo fecha o painel, mesmo que o clique caia dentro. A origem obsoleta é sobrescrita a cada `pointerdown` e zerada a cada clique de ponteiro. Sem Pointer Events, a origem é nula e tudo passa. |
| 13 | OK; ressalvas em L6 e M2 | `ambiente-porta-8080.md:9-26`; `stop-own-emulator.sh:11-31`; `scratchpad/p5e11/logs/emulator-cleanup.log` | A inspeção não enviou nenhum sinal. Todo encerramento na 8080 tem identidade, propriedade, `ativos=0`, SIGTERM e porta liberada. Os desvios anteriores às 12:41Z foram divulgados. Às 13:41Z a regra de ausência de uso mudou: não é exato dizer que ela não foi afrouxada (ver L6). O arquivo `encerramentos-emulator.txt` é citado, mas não existe. |
| 14 | PROBLEMA (MEDIUM) | seção 3; M1; M2 | O que passa: tipos, unitários de notificações e de billing, compilação e unitários de IA das Functions. Nenhum arquivo de código foi ignorado ou ficou fora dos scripts. O que falta: a correção da segunda causa não tem teste determinístico na suíte (M1); evidências citadas não existem e o plano mestre não tem a seção da P5-E1.1 (M2). A bateria de mutações estava em curso: o R05 sobreviveu e o teste foi reforçado (seção 2.3). Não verifiquei integração, E2E, lint nem `verify:all`. |
| 15 | OK | `src/App.tsx:513`; `src/components/PersonalizationView.tsx:606`; `pressOrigin.ts:144-171`; `Header.tsx:138`; `src/components/ReportPeriodSelect.tsx:24`; `ReportsAIChat.tsx:164`; seção 2.4 | Há dois `Header` montados (app e prévia da personalização), e o contador mantém um único par de ouvintes. Mensagens e o menu da conta compartilham o fundo: só muda o gesto com destino trocado, e isso é intencional. Os outros ouvintes globais são de `mousedown` e não são afetados; os outros `AnimatePresence` ficaram intocados. Nenhum teste depende dos textos ou símbolos removidos. O complemento do diálogo não tem diferença visual. |

## 2. Achados

### BLOCKER

Nenhum.

### HIGH

Nenhum.

### MEDIUM

**M1 — A correção da segunda causa não tem proteção comportamental determinística na suíte. R13 a R15 só caem por regex.**

- **Cenário:**
  - A guarda (`tests/unit/notifications-guard.test.ts:140-148`) confere apenas o texto do JSX e do manipulador.
  - Num espelho em `revisao2`, troquei `NotificationsPanel.tsx:79` (`const [, setExitCompletions] = useState(0);`) por um setter que não faz nada: `const setExitCompletions = (_update: (count: number) => number): void => undefined;`.
  - Resultado: `tsc` com saída 0 e suíte de notificações com 99/99 aprovados. O mutante sobrevive e o aviso volta a ficar preso no DOM.
  - O mesmo vale para uma troca plausível por `useRef`, já que o valor do estado parece sem uso.
  - R13, R14 e R15 também rodaram no espelho e caem só pela guarda textual.
- **Impacto:**
  - A regressão só seria pega pelo E2E F, de forma probabilística (taxa-base de 2,5% a 5%).
  - As 80 aprovações seguidas são compatíveis com a correção, mas sozinhas não provam: pela taxa-base, ocorreriam por acaso em cerca de 13% (1/40), 3,3% (5/120) ou 1,7% (4/80) das vezes.
  - A prova real é o harness, que fica fora da suíte e exige Chromium.
  - A frase "Fica fixado por: a guarda estática…" (`diagnostico-notificacoes.md:125-129`) exagera.
- **Correção mínima:**
  - Levar o harness para a suíte como teste Playwright determinístico: remover o segundo item dentro do `onExitComplete` do primeiro e exigir que ele saia do DOM. O ideal é montar o `NotificationsPanel` real numa entrada só do build E2E; no mínimo, usar o mesmo padrão.
  - Como paliativo, ampliar a guarda para exigir `const [, setExitCompletions] = useState(0);`.
  - Corrigir a frase da evidência.

**M2 — O fechamento documental está incompleto, e há textos que já o dão como feito.**

- **Links quebrados (9):**
  - `mutacoes.md`, `execucoes.md`, `VEREDITOS.md` e `encerramentos-emulator.txt` não existem.
  - Eles são citados em `LEIAME.md:3,17-21`, `ambiente-porta-8080.md:50`, `repeticoes-mobile.md:10`, `diagnostico-notificacoes.md:127` e `minimizacao-contexto-v2.md:105`.
- **Plano mestre:**
  - `PRODUCTION_READINESS_PLAN.md` não tem nenhuma ocorrência de "P5-E1.1", embora o §14 exija a seção.
  - Mesmo assim, `revisao-independente.md:35` afirma "seção 20.12 do plano mestre".
- **Log da spec nova:** o da árvore final (20/20) está só no scratchpad (`logs/e2e-new-spec-fix2.log`), não na pasta de evidências (`repeticoes-mobile.md:45`).
- **Impacto:** o gate dá FAIL por evidência ausente, e há afirmações sem respaldo.
- **Correção:**
  - criar `encerramentos-emulator.txt` a partir de `logs/emulator-cleanup.log`, sanitizado;
  - criar `mutacoes.md` com a rodada final, incluindo o R05 rerodado;
  - criar `execucoes.md` com o `verify:all`;
  - escrever a seção no plano mestre;
  - só depois manter as frases que dão isso como feito.

### LOW

**L1 — Cabeçalho da spec nova desatualizado.**
- `e2e/notifications-mobile-p5e11.spec.ts:25-28` descreve o desenho A: ações no fim do toque que suprimem o clique de compatibilidade.
- `:30` fala em "18 casos", e são 20.
- `:18-23` omite a segunda causa.
- Isso contradiz `pressOrigin.ts:13-23` e a guarda "sem reimplementar o toque".
- Correção: reescrever o comentário.

**L2 — Caminhos residuais do `AnimatePresence` 10.16.4 que a correção não cobre.** Em ambos, o `onExitComplete` nunca mais é chamado (`index.mjs:129-135`) e as saídas seguintes ficam presas até outro render do painel.
- **(a) Chave que volta durante a saída.** Ela continua para sempre em `exitingChildren` (`index.mjs:112-115,144-147`). No painel, isso exige um item sair e voltar em menos de 300 ms. Não há gatilho conhecido: as marcas só ligam e não há remoção otimista.
- **(b) Saída mais antiga que termina por último.** O `presentChildren.current` é reatribuído a um `filteredChildren` antigo (`:130`), e uma chave já removida volta a `exitingChildren` sem `child` (`:116-118`). No painel, isso exige término fora de ordem, mas a transição é uniforme (`ease` de 0,3 s, `animation/utils/default-transitions.mjs:24-39`).
- Os dois são improváveis. Registrar como risco residual; avaliar a atualização do framer-motion numa milestone própria.

**L3 — Tipo frouxo na reentrega.**
- `pressOrigin.ts:103`: `(route.to as unknown as { click(): void }).click()`.
- Um dono que não seja `HTMLElement` (por exemplo, um SVG marcado) lançaria erro depois do `preventDefault` e do `stopPropagation`, e o toque se perderia. Hoje os donos são só `div` e `button`.
- Correção: `if (route.to instanceof HTMLElement) route.to.click()` e tipar `to` como `HTMLElement`.

**L4 — O foco não acompanha a reentrega.**
- O `mousedown` de compatibilidade não é roteado e foca o elemento onde o clique caiu, por exemplo o "Arquivar" de outro aviso; a ação vai ao dono de origem.
- Com teclado externo, o Enter seguinte age no aviso focado. O impacto é baixo.
- Opcional: focar o dono de origem ao reentregar.

**L5 — Reentrega a um dono dentro de aviso que já está saindo.**
- O aviso continua conectado durante os 0,3 s da saída. A reentrega repete o arquivamento (idempotente, `api.ts:91-98`) ou navega para o link do aviso arquivado.
- Antes da correção, o clique agia no vizinho, o que era pior.
- Opcional: bloquear quando o dono estiver num item em saída.

**L6 — Processo e ambiente.**
- **Desvios anteriores às 12:41Z** (divulgados e corrigidos):
  - `kill -9` pela porta, sem conferir identidade, no proxy próprio;
  - SIGKILL ao grupo da própria sessão;
  - SIGTERM à JVM da 8280 conferindo só a linha de comando.
- **Regra de ausência de uso, desde as 13:41Z** (`stop-own-emulator.sh:15-19,24`):
  - agora contam só os processos com diretório de trabalho na mesma execução, mais a ausência de conexão TCP estabelecida;
  - relaxa um eixo (processos de outro diretório não bloqueiam mais), compensado pela checagem de conexões;
  - é aceitável, mas "sem afrouxar" (`ambiente-porta-8080.md`) não é exato.
- `stop-own-emulator.sh:17,24` compara diretórios por prefixo (`"$REPO"*`).
- As ferramentas de evidência dependem de `loopback-proxy.cjs`, que não está na pasta.

**L7 — Higiene de arquivos.**
- Há espaços no fim de linha em `repeticoes/*.txt` e em `diagnostico/forcerender/linhas-do-tempo-falhas.txt`, e o `contexto-amostras-sinteticas-v2.json` não tem newline final.
- O `git diff --check` acusaria isso se esses arquivos forem adicionados ao índice. A falta de newline em `Header.tsx` já existia na base.

**L8 — Diálogo de IA (complemento das 13:37).**
- **(a) Região focável sem papel nem nome** (`AiShareConsentDialog.tsx:231`, e a citação em `:81`). Ao focá-la, o leitor de tela pode reler o corpo inteiro, que já é a descrição do diálogo (`aria-describedby`). Opcional: `role="region"` com `aria-labelledby` ou `aria-label`.
- **(b) Foco perdido ao girar o aparelho.** Se o conteúdo deixa de rolar com o corpo focado, o `tabindex` é removido (`:62-64`) e o foco cai no `body`, atrás do modal. A armadilha de Tab recupera no próximo Tab (`:183-190`).
- **(c) Lacunas de teste.**
  - A citação focável, que aparece com uma pergunta longa, não é exercitada no E2E: a pergunta do teste é curta.
  - A ordem do Tab com o corpo rolável não é testada a 390 px e a 360 px.

### 2.3 Resolvido durante a revisão

- **R05** (teclado e leitor de tela tratados como gesto) sobreviveu na bateria das 13:15 (`scratchpad/p5e11/mutlogs/mut-R05.log`: 99 aprovados).
- **Causa:** o teste de `detail 0` usava `pointerId -1`, e o ramo do `pointerId` mascarava o do `detail`.
- **Correção às 13:21:** `tests/unit/press-origin.test.ts:130-138` ganhou casos sem `pointerId` e com o mesmo `pointerId`.
- **Reconfirmação:** reapliquei o R05 no espelho, deu duas falhas e o mutante caiu.
- **Pendente:** rerodar o R05 na bateria oficial e registrá-lo em `mutacoes.md`.

### 2.4 Complemento: `useFocusableWhenScrollable` em `AiShareConsentDialog.tsx:51-74`

- **Ordem do Tab e foco preso.**
  - Como `FOCUSABLE` inclui `[tabindex]:not([tabindex="-1"])`, o corpo e a citação entram em ordem de DOM, entre "Fechar" (primeiro) e Cancelar ou Enviar (último).
  - O primeiro e o último não mudam, e a armadilha (`:174-190`) continua fechando o ciclo.
  - O foco inicial em Cancelar e a devolução de foco não mudaram.
  - O teste de teclado existente cobre as transições Cancelar → Enviar → Fechar e Fechar ← Enviar. Essas transições não atravessam o corpo e continuam válidas.
- **Leitores de tela:** não há regressão. As ressalvas são as de L8a e L8b.
- **Regressão visual:**
  - Não há regra global que remova `outline` (`src/index.css`, `index.html`, `tailwind.config.js`).
  - O anel de foco só aparece no foco por teclado; com clique ou toque não há anel.
  - Sem rolagem, o atributo nem existe. As capturas continuam válidas.
- **`ResizeObserver` e efeito sem dependências:**
  - O efeito roda a cada render e desconecta o observador anterior no cleanup.
  - A escrita do atributo não muda tamanho nem dispara render do React, então não há laço.
  - Com o diálogo fechado, `ref` é nulo e o efeito sai cedo.
  - Observar os filhos cobre o conteúdo que cresce dentro de `max-h`; a reexecução a cada render cobre mudança de texto.
  - Sem `ResizeObserver`, vale só o cálculo inicial.
- **Escopo:** é uma correção mínima de acessibilidade (axe `scrollable-region-focusable`), necessária porque o texto novo faz o corpo rolar a 390×844. Não muda nenhum texto visível.

## 3. Comandos executados e resultados

| Comando | Resultado |
| --- | --- |
| `git status --short`; `git rev-parse HEAD`; `git diff --cached --name-only` | HEAD `f0c172b6…`, branch `integration/p4-finalization-2026-10-08`, nada staged |
| `git ls-tree -r 43ffbfa1` + hash de blob calculado em Python (sem `git add`, sem gravar objetos) | delta final: 59 novos, 0 removidos, 19 modificados |
| `sha256sum e2e/notifications-p5d2.spec.ts` | `08fd30570851559b…` (igual à base) |
| `npx tsc --noEmit -p .` (13:20, 13:37 e 13:41Z) | saída 0 nas três |
| `npm run test:unit:notifications` (13:20, 13:35 e 13:41Z) | 99/99 |
| `npm run test:unit:billing` (13:20 e 13:41Z) | 72/72 |
| `cd functions && npx tsc -p . --outDir revisao2/flib` | saída 0 |
| `node --test flib/ai/__tests__/analysisContext.test.js flib/ai/__tests__/callables.test.js` | 75/76. A falha é artefato do diretório: o teste lê `../../../../firestore.indexes.json`. Com o layout do repositório espelhado (`revisao2/layout`, com link simbólico para o arquivo): 76/76 |
| Espelho: `tsc` + suíte de notificações com mutante semântico M1 | saída 0 e 99/99: o mutante sobrevive |
| Espelho: R13, R14 e R15 contra a guarda | as três caem (1 falha cada) |
| Espelho: R05 contra o teste atualizado | 2 falhas: cai |
| Verificador próprio de espaços (linhas acrescentadas no delta) | espaços no fim de linha só em logs de evidência; JSON sem newline final |
| Verificador de links das evidências | 9 links quebrados |
| `grep -c "P5-E1.1" PRODUCTION_READINESS_PLAN.md` | 0 |

Não executado, por estar fora da lista permitida: Emulator, integração, E2E, harness (exige Chromium), lint e `verify:all`.
