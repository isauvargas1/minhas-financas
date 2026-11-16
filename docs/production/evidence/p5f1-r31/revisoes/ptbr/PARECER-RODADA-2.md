PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.1 — rodada 2 (`ptbr-product-ui-review`)

Revisão independente, só com leitura, em 2026-11-10, das 21:45 às 21:58 UTC. Comparei árvore com árvore:

| Árvore | Hash |
| --- | --- |
| R3 | `1c9155dbc8d6aedd35e6f39a63fac46b53d81919` |
| Rodada 1 | `40057d2a78c47fea537480b0a2bc21fc46e2a500` |
| Final de código | `d9fed573c803d64827ba278c347215054a31e0d2` |

`W` = `<scratchpad>/wt-p5f1-r31`. Nada foi alterado em `W` nem no índice. As leituras de git usaram `GIT_OPTIONAL_LOCKS=0` e `hash-object` sem `-w`. Não rodei Emulator, E2E, build, `verify*` nem `firebase`; só testes de unidade, direto com `node --test`. Dois arquivos temporários em `/dev/shm` (listas de literais) foram apagados ao final.

## Respostas diretas

- **Nenhuma mudança chega ao conteúdo renderizado.**
  - De `40057d2a` para `d9fed573`, a única mudança em `src/` é uma linha de JSDoc em `useIncomeEstimate.ts:18`. Nenhuma linha fora de comentário mudou.
  - Nenhum `.tsx`, `.css` ou arquivo de estilo mudou desde a R3.
  - `Header.tsx`, `EstimateDetails.tsx`, `IncomeEditor.tsx`, `WorkTimeSettingsView.tsx`, `WorkTimeWizard.tsx`, `WorkTimeContext.tsx` e `official.ts` têm o mesmo blob da R3.
  - `messages.ts`, `useIncomeEstimateWith.ts` e `basisSync.ts` têm o mesmo blob da rodada 1.
  - Os 16 arquivos de interesse em `W` batem blob a blob com `d9fed573`.
- **Os textos que os E2E afirmam são os existentes.**
  - Extraí 109 literais afirmados nos dois specs (`toContainText`, `toHaveText`, `getByText`, `name:` e as constantes `*_TEXT`) e procurei cada um em `src/` nas árvores `1c9155d` e `d9fed573`.
  - Os 96 encontrados estão nas duas árvores.
  - Os 13 restantes vêm de linhas que não mudaram desde a R3. São compostos por template (`EstimateDetails.tsx:28, 71, 203`, `IncomeEditor.tsx:205`, `RoutineEditor.tsx:170`, `ExceptionsEditor.tsx:165`, `draft.ts:123`) ou são dados semeados pelo teste (nomes de espaço e cliente, motivo digitado, resposta simulada da IA).
  - Nas linhas de E2E acrescentadas desde a R3, os textos de interface afirmados existem literalmente:
    - "Não foi possível carregar o relatório. Tente novamente." (`official.ts:383-384`)
    - "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." (`Header.tsx:536`)
    - "Não foi possível atualizar a estimativa com os lançamentos mais recentes…" (`messages.ts:77, 99`)
    - "Tentar de novo" (`EstimateDetails.tsx:50, 81`)
- **Respostas aos I-01 a I-08.** Conferi cada uma contra o código, os testes e o log novo (seção 5). Nenhuma alterou a interface, como o escopo mínimo exige. Uma pendência documental não afeta o veredito de UI (N-01).

## 1. Escopo

- **Requisito.** O mesmo da rodada 1 (`relatorio/pedido-r31.md`, R3-AUD-01), mais a conferência das respostas da rodada 1.
- **Mudanças de `40057d2a` para `d9fed573` (8 arquivos).**
  - `src/modules/work-time/useIncomeEstimate.ts`: 1 linha de comentário.
  - `e2e/work-time-b03.spec.ts`: o B03-f prova os reais pelo registrador.
  - `e2e/work-time-p5f.spec.ts`: "releitura que falha" em 5 fases.
  - `tests/unit/work-time-consistency.test.ts`: segundo período sem prova.
  - `tests/unit/work-time-income-estimate.test.ts`: nome da propriedade e R6-02 em todas as renderizações.
  - Documentos: `DATA_MODEL.md`, `mutantes.md`, `testes-e-resultados.md`.
- **Telas e fluxos.** Os mesmos da rodada 1: aviso do topo, valores do app, prévia de Configurações, memória de cálculo, painel "Receitas consideradas", editor de renda, "Valor em uso agora" e assistente. Nenhum código de renderização mudou desde a R3.

## 2. Evidências do código

| Critério | Arquivo:linha | Conclusão |
| --- | --- | --- |
| Única mudança em `src/` desde a rodada 1 | `useIncomeEstimate.ts:18`: "a retenção" passou a "a apresentação fail-closed" (JSDoc) | Não renderizado |
| Nenhuma linha fora de comentário em `src/` | `git diff -U0 40057d2a d9fed573 -- src/`, com as linhas de comentário filtradas: nenhuma sobra | OK |
| Componentes e textos inalterados desde a R3 | Blobs: `Header.tsx` `bedd51f`, `EstimateDetails.tsx` `e5386e8`, `IncomeEditor.tsx` `7b7d5a4`, `WorkTimeSettingsView.tsx` `cc1234f`, `WorkTimeWizard.tsx` `acb6d58`, `WorkTimeContext.tsx` `fe2302c`, `official.ts` `f984cdd` | Iguais aos da R3 |
| Lógica de apresentação inalterada desde a rodada 1 | `useIncomeEstimateWith.ts` `24e9c2b`, `messages.ts` `07d7de2`, `basisSync.ts` `c54c9ae` | Iguais aos da rodada 1 |
| Textos afirmados pelos E2E | 109 literais: 96 literais em `src/` nas duas árvores; 13 compostos ou dados de teste, todos em linhas que não mudaram desde a R3 | Todos existentes |
| Testes não enfraquecidos | Testes por arquivo, rodada 1 → final: consistency 40→40, guard 18→18, income-estimate 20→20, B03 6→6, P5F 19→19. Linhas com asserção: consistency 158→165, income-estimate 89→91, P5F 374→384, B03 107→107, guard 252→252. Nenhum `skip`, `only` ou `fixme`. As 6 asserções de P5F removidas foram trocadas por equivalentes das 5 fases, com a hora confirmada `hourlyX` e a nova `hourlyXZ` | OK |

## 3. Evidências de execução

| Comando ou teste | Viewport ou interação | Resultado | Artefato |
| --- | --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/work-time-income-estimate.test.ts` (eu, árvore final) | — | 21/21, 0 skip | terminal |
| `… tests/unit/work-time-consistency.test.ts` (eu) | — | 46/46, 0 skip | terminal |
| `… tests/unit/work-time-guard.test.ts` (eu) | — | 18/18, 0 skip | terminal |
| E2E de tempo de trabalho, run 2, das 21:36:25 às 21:42:47, build às 21:36 | Desktop; B03-b também a 375×812, com teclado e axe | 25/25 | `logs/e2e-r31-work-time-2.log` |
| Mesmo run, sequência registrada da prévia (11 estados) | 5 fases do P5F | Ver a sequência abaixo | idem |
| `verify-all-1` (árvore `40057d2a`) | — | `exit=0` às 21:29:32; 216 E2E aprovados | `logs/verify-all-1.log*` |
| `verify-all-2` (árvore `b841ec69`, que difere de `d9fed573` só em `docs/`) | — | Em curso. Até agora: `test:unit:reports` 107/107 e `test:unit:work-time` 221/221, 0 skip; integração em curso | `logs/verify-all-2.log*` |

O run 2 corresponde ao estado final. As últimas edições foram em 21:23 (`useIncomeEstimate.ts`, só comentário) e 21:31 (specs), antes do build e da execução.

A sequência da prévia no P5F, com a hora mostrada em cada estado:
1. 0,00 s: R$ 25,00.
2. 0,09 s: sem hora, "Lendo…".
3. 6,11 s: erro.
4. 6,37 s: sem hora, logo depois do "Tentar de novo".
5. 6,38 s: R$ 25,68.
6. 6,47 s: sem hora.
7. 12,49 s: erro.
8. 12,72 s: R$ 25,68 com o aviso.
9. 12,88 s: R$ 25,68, sem o aviso.
10. 13,01 s: sem hora.
11. 18,06 s: R$ 26,09.

A sequência confirma o que as asserções `:1145-1149` exigem:
- Nenhuma hora nos dois intervalos sem confirmação.
- O aviso só com a hora confirmada.
- Horas novas nunca junto do erro.
- A hora final sem aviso.
- O "Tentar de novo" do erro traz a receita nova (fase 2).

As sequências `[valores-b03-a…f]` são iguais às do run 1. No B03-f, o saldo novo aparece como `reais|R$ 20.200,00`, que o novo `expect.poll` exige (`work-time-b03.spec.ts:670`), antes de `tempo|≈ 795 h 2 min`.

## 4. Comparação antes e depois

- **Da rodada 1 para o final.** Nenhuma mudança de UI, texto ou comportamento visível: só um comentário em `src/`, testes mais fortes e documentos.
- **Da R3 para o final.** Igual à rodada 1, seção 4.1:
  - V1 a V4 e V6 são requeridas. Nos estados sem prova ou sincronizando, os valores ficam em reais e aparecem "Calculando…", "em atualização" ou o erro, sempre com "Tentar de novo" quando há ação.
  - V5 preserva o aviso de leitura anterior no estado atual provado.
  - Nenhuma mudança fora de escopo. Não há layout, estilo, navegação nem texto novo.

## 5. Achados

Nenhum HIGH, MEDIUM ou LOW. Todos são INFO e nenhum bloqueia.

### Respostas da rodada 1 conferidas

Fonte das respostas: `docs/production/evidence/p5f1-r31/revisoes/LEIAME.md`.

| Achado | Resposta | Conferência |
| --- | --- | --- |
| I-01 (alternância a cada sincronização; na janela de 12 meses, também cerca de 30 s depois de qualquer lançamento nesta aba) | Comportamento pedido, registrado no RR-R31-01. Pela resposta ao A-05, o pior caso no RR-R31-02 é de cerca de 10 min sem conversão na janela de 12 meses | Confere com o código: 2 releituras seguidas e 1 a cada 10 min por base (`queryKeys.ts:53-57`); com bases fora de passo, a estimativa segura (`basisSync.ts:588-597`). Nesse tempo, a tela mostra "em atualização" e "Tentar de novo", que relê as duas bases direto (`useIncomeEstimateWith.ts:203-208`); o topo manda a Configurações. Os valores ficam sempre corretos. Mantenho INFO; o registro final é a N-01 |
| I-02 (aviso do topo sem região viva) | Sem mudança, RR-R31-01 | De acordo: corrigir mudaria a UI fora do escopo mínimo |
| I-03 (foco no `body` ao desmontar o bloco pronto) | Registrado no RR-R31-01 | De acordo |
| I-04 (temporizadores independentes) | Sem mudança | De acordo |
| I-05 (superfícies adjacentes) | RR-R31-06, o mesmo do A-02 | De acordo: manter a lista exigiria guardar a anterior ou mudar o painel |
| I-06 (`role="alert"` em "em atualização") | Sem mudança | De acordo |
| I-07 (`console.log` depois da execução) | E2E refeito na árvore final | Conferido: o run 2 é posterior às edições, e a sequência está no log |
| I-08 (texto genérico do relatório) | Sem mudança | De acordo |

### Novos

- **N-01 (INFO, documentação): o registro dos riscos residuais ainda não está nos documentos finais.**
  - O LEIAME diz que I-01, I-02 e I-03 estão no RR-R31-01, que o RR-R31-02 traz o pior caso de cerca de 10 min e que a R3.1 foi registrada no plano mestre §20.19.
  - O plano no worktree não mudou desde 19:57: o blob `75a789f` é o mesmo de `d9fed573`, e não há §20.19 nem RR-R31.
  - O relatório (`relatorio/RELATORIO-P5F1-R31.md`, das 20:54) ainda é rascunho, com `[[VEREDITO]]`. Nele, RR-R31-01 e RR-R31-02 não trazem o caso da janela de 12 meses depois de uma mutação nem os cerca de 10 min, e não existem RR-R31-05 e RR-R31-06.
  - O coordenador informou que os riscos finais vão ao plano §20.19 e ao relatório.
  - Remediação, no fechamento:
    - RR-R31-01 com I-01 (inclusive a janela de 12 meses cerca de 30 s depois de qualquer lançamento nesta aba), I-02 e I-03.
    - RR-R31-02 com o pior caso de cerca de 10 min e o "Tentar de novo" como saída.
    - RR-R31-06 com I-05.
  - Não muda o conteúdo renderizado: fica para conferência do `regression-release-gate`.
- **N-02 (INFO): o `verify-all-2` ainda não terminou.** Ele roda sobre `b841ec69`, que difere de `d9fed573` só em `docs/` (55 arquivos), com o mesmo código. O veredito de UI se apoia no run 2 dos 25 E2E de tempo de trabalho, os únicos que exercitam o modo tempo, e nos testes de unidade da árvore final.

A cópia do meu parecer da rodada 1 em `docs/production/evidence/p5f1-r31/revisoes/ptbr/PARECER-RODADA-1.md` é idêntica ao original, exceto pela troca do caminho absoluto por `<scratchpad>`.

## 6. Riscos residuais

- **I-01.** É o comportamento pedido. A conversão some durante toda sincronização. Na janela de 12 meses, isso também acontece depois de lançamentos comuns nesta aba, com pior caso de cerca de 10 min até o "Tentar de novo". Nenhum E2E mede a duração em 12 meses.
- **I-02 a I-06 e I-08.** Inalterados e aceitos (rodada 1).
- **Registro nos documentos finais (N-01) e término do `verify-all-2` (N-02).**

## 7. Bloqueadores para PASS

Nenhum.

## Pendências de navegador

Nenhuma é necessária para o veredito. Continua recomendada, sem bloquear, a medição do I-01 descrita na rodada 1: janela de 12 meses, lançar uma despesa nesta aba e registrar o saldo e o aviso do topo por 45 s.
