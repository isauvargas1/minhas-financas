PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.2 — revisão independente de produto e interface em pt-BR, rodada 4 (`ptbr-product-ui-review`, focada na mudança depois da rodada 3)

Revisão feita em 2026-11-14, das 00:22 às 00:35 (UTC), sobre o código real da árvore `698f96441df1fbcd63467792c43cdb57b3911d9e`.
- Não alterei o worktree nem o índice do git (nem `git write-tree`).
- Não rodei Emulator, Playwright, E2E, `verify:*` nem `test:integration*`.
- Rodei tudo com `nice -n 19`, um comando de cada vez, numa cópia própria feita por `git archive`.

Pasta: `<scratchpad>/p5f1r32/revisoes/ptbr/rodada-4`. Os arquivos citados como `logs/…` e `testes-revisor/…` ficam nela. Os números de linha são os da árvore `698f9644` e da versão dos rascunhos de 14/11 (relatório às 00:03:37, plano às 00:21:04, matriz às 00:02:30).

## 1. Escopo

- **Requisito:** o COMUM-R4 e o pedido do executor:
  - o que o usuário vê com as rotinas ambíguas;
  - a seção K ajustada;
  - nenhuma interface mudada;
  - as respostas aos PT-R3-01 a 03.
- **Árvores.**
  - Rodada 3: `ef514869`.
  - Sob revisão: `698f9644`.
  - A cópia é idêntica ao worktree, fora `docs/` e os artefatos não versionados (`logs/copia-vs-worktree.txt`).
  - Índice: mtime de 11/11, 11:47:49, e HEAD `1730a1df`, no começo e no fim.
- **A mudança** (`logs/diff-stat.txt`, `logs/diff-src-r3-final.patch`):
  - Em `useIncomeEstimateWith.ts`, `carriesBasisFigures` dá lugar à lista fechada `DECIDED_BEFORE_INCOME`: `business_not_confirmed`, `report_unavailable` e `exclusion_unconfirmed` (`:113-117`).
  - Entra `dependsOnIncomeReadings` (`:126-127`), e o `holdEstimate` passa a usá-la (`:154`).
  - Em `consistency.ts` e no E2E, só comentários (`logs/diff-e2e-r3-final.patch`).
  - O resto são testes e o executor do E2E.
- **Telas:**
  - o aviso do topo;
  - em Configurações, a prévia, a memória de cálculo, o painel "Receitas consideradas" e os avisos de ambiguidade dos editores;
  - no assistente, a prévia, a contagem e o painel.

## 2. Nenhuma interface mudou

| Critério | Evidência | Conclusão |
| --- | --- | --- |
| Componentes, contextos, estilos, `index.html`, `index.tsx`, `App.tsx`, Tailwind e PostCSS | Hashes iguais em `efcbd264`, `ef514869` e `698f9644` (`logs/escopo-ui.txt`) | Inalterados |
| Textos e cálculo que decidem o que é mostrado | `messages.ts` (`07d7de2f`), `estimate.ts`, `incomeBasis.ts`, `WorkTimeContext.tsx` e `presentation.ts`: iguais nas três árvores | Inalterados |
| Arquivos de UI alterados | Filtro de `.tsx`, `.jsx`, `.css`, `.scss`, `.html`, `.svg`, `public/`, `messages`, i18n, Tailwind e PostCSS, desde a R3.1 e desde a rodada 3: "(nenhum)" | Nada |
| Literais novos | Só os identificadores internos dos três motivos da lista | Nenhum texto novo |

## 3. O que o usuário vê agora com as rotinas ambíguas

`ambiguous_routines` e `ambiguous_reduced_eve` passam a seguir a regra da indisponível com números: esperam a prova e o fim da sincronização (`:126-127, 154`). Uso os códigos da rodada 3 (P1 a P6, T1 a T3, L1 a L4; `rodada-3/PARECER.md`, seção 3.2):
- **P1:** "Lendo as receitas oficiais e calculando..." (`status`);
- **P2:** "A estimativa está em atualização: …" com "Tentar de novo" (`alert`);
- **P3:** "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo." com "Tentar de novo" (`alert`);
- **P4:** "Estimativa indisponível. <motivo>";
- **T1:** "Calculando a estimativa…";
- **T2:** "Estimativa de tempo de trabalho indisponível agora: …".

| Situação | Prévia (rotinas que se cruzam e véspera reduzida, com e sem desconsiderada) | Topo (estimativa em uso) | Painel e contagem | Evidência |
| --- | --- | --- | --- | --- |
| Tela que volta com o cache aquecido, antes do retorno do servidor | P1 → (30 s) P2 → P4 com o retorno | T1 → T2 → T2 | L1 → L2 → lista sem a linha de conferência | Sondas R4 (1), 4 combinações |
| Sem conexão depois da prova | P1 → P2; P4 volta sozinho | T1 → T2 | L1 → L2 | Sondas R4 (1), 4 combinações |
| Escuta encerrada | P3 de imediato; depois do "Tentar de novo", P1 → P4 | T2 | L2 | Sondas R4 (1), 4 combinações |
| Divergência persistente | P1 → P2; com a anomalia corrigida, o "Tentar de novo" traz P4 | T1 → T2 | L1 → L2 | Sondas R4 (1), 4 combinações; unidade, sonda R3-P3 (`ok 148`) |
| Mês corrente | Espera também, embora ali a ambiguidade não dependa da renda: P1 → P2 → P4 | Como acima | Como acima | Sonda R4 (2) |
| Com a prova (rede normal) | P4 com o motivo; a memória de cálculo diz "Você não desconsiderou nenhuma receita." mesmo com desconsiderada (RR-R32-11) | T2 | Lista sem a linha de conferência | `logs/render-probe.txt`, B5c e B6b; E2E B02 e S01 (20/20, `e2e-p5f-r33-1`) |

- **O que continua aparecendo sem prova.** Em Configurações, os avisos dos editores explicam a causa: "A Rotina 1 e a Rotina 2 se cruzam em <dia>, <data>, e há intervalo no trecho em comum: …" e "Com a jornada reduzida de <dia>, <data>, não dá para confirmar …". Eles aparecem em três lugares:
  - `routines-ambiguity`, `role="alert"` (`RoutineEditor.tsx:293-294`);
  - `work-time-calendar-ambiguity`, `role="alert"`, junto do botão de salvar (`WorkTimeSettingsView.tsx:270-272, 460-461`);
  - a marca "horas sem cálculo seguro" no editor de exceções.

  Esses avisos são calculados na tela, a partir do calendário. Não dependem da estimativa nem da conexão, e a conferência cobre de 12 meses antes do mês atual até 2099, a janela mais longa da estimativa (`calendar.ts:835-843`). Também aparecem sem rascunho alterado, porque o rascunho nasce da preferência salva (`WorkTimeSettingsView.tsx:112-115, 266`). Os E2E B02 e S01 afirmam esses avisos, com axe.
- **Coerência.** Nada converte e nenhum motivo de estado misto aparece. As sondas R3-P1 a R3-P3 da adversarial estão no projeto e passam (`ok 146-148`).
  - Sem prova, a prévia mostra um estado verdadeiro, com "Tentar de novo".
  - O editor mostra a causa acionável.
  - Para as rotinas ambíguas, o PT-R3-03 (motivo acionável escondido) fica atenuado.
- **A decidida antes das receitas.** Continua como está, sem conexão e com a escuta encerrada, esta com a ressalva (sondas R4 (3) e R3 (5); unidade `ok 115-126`).

## 4. Evidências de execução

| Comando / teste | Árvore ou cópia | Resultado | Log |
| --- | --- | --- | --- |
| Unidade: os 10 arquivos de `test:unit:work-time`, `--test-concurrency=1` | Cópia `698f9644` | 284/284, 0 skip, 0 todo, 99 s. O bloco do estado indisponível tem 35 testes (115 a 149, com a véspera reduzida no laço e as sondas R3-P1 a R3-P3); a tabela-verdade é o `ok 220` | `logs/unit-work-time-ptbr-r4.log` |
| `tsc --noEmit` da raiz | Cópia limpa | Saída 0, 16 s | `logs/tsc-root-ptbr-r4.log` |
| Sondas do revisor, rodadas 3 e 4 (37) | Cópia `698f9644` | 34/37. As 19 da rodada 4 passam. Reprovam as 3 sondas (6) da rodada 3, que afirmavam as ambíguas sem prova: o último estado já não é `done`. É a mudança pedida | `logs/revisor-ptbr-r3-r4-gancho.log` |
| Renderização com o React real (`renderToStaticMarkup`) | Idem | Rotinas ambíguas: sem prova, P1; com a escuta encerrada, P3; com a prova, P4 com a memória de RR-R32-11. A decidida antes das receitas, como está | `logs/render-probe.txt` |
| E2E `work-time-p5f.spec.ts` (executado pelo executor) | `698f9644` | 20/20, 271 s, com B02, S01 e ADV-01 | `logs/e2e-p5f-r33-1.log` do executor |
| `verify:all` oficial `verify-all-r32-5` | `698f9644` | Em curso às 00:29 | Para o gate |

Os SHA-256 das sondas estão em `logs/testes-revisor-sha256.txt`. As sondas montadas ficam em `testes-revisor/montados/`, fora da cópia.

## 5. A seção K ajustada (`RELATORIO-P5F1-R32.md:87-160`)

O ajuste está correto no essencial e em bom pt-BR:
- a divisão "depende das receitas" / "decidida antes das receitas";
- a passagem das ambíguas para o item 1;
- os itens 3, 4 e 6;
- o RR-R31-04;
- o PT-R3-01 com as ambíguas depois da confirmação.

Os textos citados são os literais da interface. Sete pontos ainda pedem ajuste; são o PT-R4-01 (seção 7).

## 6. Achados da rodada 3

- **PT-R3-01 (LOW, anterior): aberto como risco documentado, para uma etapa própria.**
  - Está registrado como RR-R32-11 no §M (`:181`), no plano (`plano-20-20.md:82`) e na seção K (`:119-122`).
  - Inclui o caso das ambíguas depois da confirmação, confirmado na renderização (B5c, B6b).
  - A resposta basta.
- **PT-R3-02 (LOW, documentação): fechado.**
  - Relatório: a linha 48 separa os dois tipos.
  - Plano: `:70-72` tem o RR-R32-02 corrigido.
  - Matriz: a linha 11 traz o ADV-R2-06.
  - A seção K está preenchida e há o RR-R32-11.
  - Os resíduos que surgiram com o ADV-R3-01 estão no PT-R4-01.
- **PT-R3-03 (INFO): fechado pela documentação** (seção K, `:109`; `plano-20-20.md:83`).
  - Com o ADV-R3-01, o caso vale também para as ambíguas, mas o aviso do editor mostra a causa (seção 3). A seção K precisa dizer isso (PT-R4-01, item 4).
- **PT-R32-01, 02 e 03 (INFO): fechados pela documentação** (seção K, itens 3 e 5). Continuam como limitações conhecidas.
- **PT-R32-04 (INFO): fechado.** A seção K está preenchida.

## 7. Achados novos

- **PT-R4-01 (LOW, documentação): pontos da seção K e dos rascunhos que não acompanham o ADV-R3-01.** Nenhum afeta a árvore.
  1. **`RELATORIO-P5F1-R32.md:89`.** O preâmbulo diz "Redação da revisão pt-BR, rodada 3 (…)". Acrescentar: "ajustada à regra final (ADV-R3-01) e conferida na rodada 4 (`evidencias/revisoes/ptbr/rodada-4/PARECER.md`)".
  2. **`:95`.** "Sem números, as rotinas ou a véspera reduzida sem cálculo seguro, cujo motivo depende de quais meses têm renda (ADV-R3-01);" é uma frase sem verbo, não cita os textos e só vale no modo habitual. Propor: "Sem números, também espera a de rotinas ou véspera reduzida sem cálculo seguro ("Em algum dia do período, rotinas se cruzam e há intervalo no trecho em comum: …" e "Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite, …"): no modo habitual, os meses usados dependem de quais têm renda; no mês atual ela espera do mesmo jeito (ADV-R3-01);".
  3. **`:107`.** "Na indisponível que depende das receitas, volta o motivo, com os números confirmados." A de rotinas ambíguas não traz números. Trocar por: "…volta o motivo, com os números confirmados quando ela os traz.".
  4. **`:148`.** "Na indisponível que depende das receitas ainda sem a confirmação, o motivo não está em Configurações." Não vale para as rotinas ambíguas. Acrescentar: "Nas rotinas ou na véspera reduzida ambíguas, a causa aparece mesmo assim no aviso do editor de rotinas ou junto do botão de salvar ("A Rotina 1 e a Rotina 2 se cruzam em …" e "Com a jornada reduzida de …"), calculado na tela, sem depender da confirmação nem da conexão.".
  5. **`:121`.** A frase tem quatro vírgulas e duas condições no mesmo período. Propor: "Vale também quando o motivo é a própria desconsiderada e, depois da confirmação, para a indisponível de rotinas ou de véspera reduzida ambíguas, mesmo quando o motivo é a jornada reduzida.".
  6. **`plano-20-20.md`.**
     - `:71`: "a que converte ou a indisponível com números" → "a que converte ou a indisponível que depende das receitas".
     - `:81` (RR-R32-09): "da indisponível com números esperando a prova" → "da indisponível que depende das receitas esperando a prova", como já está no relatório (`:179`).
     - `:83` (PT-R3-03): incluir as ambíguas, com o aviso do editor.
  7. **`matriz-antes-depois.md:35`, coluna R3.2.** "**Com números**: esperam a prova…" não cita as ambíguas, e a evidência diz "29 testes" e "N21 a N24". Corrigir para: "**Que dependem das receitas** (com números, ou de rotinas e véspera reduzida ambíguas, ADV-R3-01)"; "35 testes no gancho"; "mutantes N17, N18, N21 a N26". A contagem de 35 está conferida em `logs/unit-work-time-ptbr-r4.log`.
  - **Impacto:** o relatório descreveria de forma inexata o que a pessoa vê com rotinas ambíguas: diria que nada as explica em Configurações. O gate deve conferir no relatório final.

Nenhum achado HIGH, MEDIUM ou de interface. Nenhum texto fora do pt-BR.

## 8. Riscos residuais

- A espera das ambíguas sem a prova não tem E2E: o B02 e o S01 rodam com rede. A cobertura é a do gancho e a das sondas. Os ramos de tela são os já exercitados para a indisponível com números (RR-R32-09).
- O RR-R32-11 continua, agora também nas ambíguas depois da confirmação.

## 9. O que não foi possível verificar

- **Inspeção interativa e leitor de tela.** O COMUM-R4 proíbe. Não há mudança de UI, e a renderização, as sondas, a unidade e o E2E do executor bastam para o juízo.
- **O resultado da `verify-all-r32-5`.** Estava em curso; fica para o gate.

## 10. Bloqueadores para PASS

Nenhum na árvore `698f9644`. Para fechar o relatório, sem efeito nesta decisão: o PT-R4-01.

## 11. Comandos executados

- **Git**, com `GIT_OPTIONAL_LOCKS=0`: `diff --stat|--name-only|--name-status --no-renames` entre `efcbd264`, `ef514869` e `698f9644`; `rev-parse <árvore>:<caminho>`; `archive 698f9644 | tar -x --exclude=docs`.
- **`diff -rq`** da cópia contra o worktree.
- **Testes.** `nice -n 19 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 …`, com `--test-name-pattern='REVISOR-PTBR-R[34]'` nas sondas.
- **`tsc`.** `nice -n 19 node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- **Renderização.** `nice -n 19 node_modules/.bin/esbuild … --bundle --platform=node --format=cjs --jsx=automatic`, depois `node`. A pasta `.revisor/` foi apagada da cópia depois.
- **Leitura, sem alterar:** os rascunhos do executor, os logs do executor (`e2e-p5f-r33-1`, histórico 55 a 62) e `RoutineEditor.tsx`, `WorkTimeSettingsView.tsx`, `draft.ts` e `calendar.ts`.
