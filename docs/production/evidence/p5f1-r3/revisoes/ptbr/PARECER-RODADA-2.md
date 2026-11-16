PASS — revisão de UI de produto em PT-BR

# Rodada 2 — P5-F.1-R3

Revisão independente pela skill `ptbr-product-ui-review`, só com leitura, em 2026-11-09, de 19:56 a 20:25 UTC. O código está congelado na árvore `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`, e o `verify:all` dela terminou às 20:22:55 com `exit=0`.

Abreviações: `S` = `<scratchpad>`, `WT` = `$S/wt-p5f1-r3`. Os caminhos `arquivo:linha` são relativos ao WT.

## 1. Escopo

- **O que foi conferido:** as respostas a M-01, M-02 e L-03 e a classificação de L-01, L-02 e I-01 a I-05, em `docs/production/evidence/p5f1-r3/revisoes/respostas-revisao-ptbr-seguranca-1.md`.
- **Árvores conferidas.** Calculei a árvore do WT com índice temporário duas vezes: `98ce245…` às 20:12 e `3eb6041d…` às 20:23. As duas diferem de `377c2f3` só em `docs/`. O `git diff` em `src e2e tests functions/src firestore.rules firestore.indexes.json package.json playwright.config.ts` sai vazio.
- **Delta desde a rodada 1 (`90c0635` → `377c2f3`), fora de `docs/`:**
  - `src/modules/work-time/messages.ts`: o texto de M-01;
  - `src/modules/reports/basisRegistry.ts`: remove `observeDependentRead`, código morto sem nenhuma referência restante;
  - `e2e/work-time-b03.spec.ts`: a constante do texto e `expectKeyboardRetry`;
  - `tests/unit/work-time-consistency.test.ts`: 2 testes novos;
  - um teste de ataque das Rules;
  - `functions/src/cash/{periods,projectionMarks}.ts`: poda das marcas;
  - `firestore.indexes.json`: isenções;
  - `package.json`: scripts de teste.
- **Nenhum `.tsx`, `.css` ou `.html` mudou.** A única string visível alterada é `ESTIMATE_UPDATING`. As mudanças de backend não têm texto que chegue ao cliente; o efeito delas na prova foi exercitado pelo B03-c, com reconstrução e poda.

## 2. Estado de cada achado

| ID | Rodada 1 | Resposta | Estado |
| --- | --- | --- | --- |
| M-01 | MEDIUM | Texto neutro (opção a) | **Resolvido** |
| M-02 | MEDIUM | Teclado no B03-b; E2E vizinhos no `verify:all` | **Resolvido** |
| L-01 | LOW | Classificado, sem mudança | **Aceito como risco residual** |
| L-02 | LOW | Classificado, sem mudança | **Aceito como risco residual** |
| L-03 | LOW | Teste de unidade | **Resolvido** |
| I-01 a I-05 | INFO | Classificados | **Aceitos** |

### M-01 — Resolvido

- `messages.ts:88` diz: "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais."
- O texto não aponta causa e é verdadeiro para qualquer motivo de recusa: projeção, bases ou marcas. Isso cobre as sondas A e B da rodada 1.
- O pt-BR está correto ("confirmá-la"). O texto é coerente com o topo (`Header.tsx:536-537`) e com `ESTIMATE_UNCONFIRMED_FAILED` (`messages.ts:82`), e não expõe detalhe interno.
- O texto antigo não aparece mais em `src`, `e2e` nem `tests`. A constante `e2e/work-time-b03.spec.ts:36` foi atualizada.
- Teste novo em `tests/unit/work-time-consistency.test.ts:673`, sem desconsiderada e com janela de 12 meses. Ele confere:
  - o texto sem "desconsiderad";
  - nenhuma conversão;
  - a estimativa provada quando a escuta retorna.
- No `verify:all`, esse teste é `ok 79`, com `test:unit:work-time` 213/213.

### M-02 — Resolvido

- **Teclado.** `expectKeyboardRetry` (`e2e/work-time-b03.spec.ts:387-413`) é chamado no B03-b em desktop (`:439`) e em 375×812 (`:453`). Ele confere:
  - Tab a partir do título até "Tentar de novo";
  - `:focus-visible` e anel de foco desenhado;
  - Enter e Espaço pedem de novo `getFinancialReport`;
  - o foco continua no botão.
- O desenho do teste está correto. O limite de 400 Tabs é contagem de teclas, não timeout, num teste novo; não enfraquece nada (ver I-06).
- A captura de 375×812 da árvore final mostra o texto neutro, sem corte, e o anel de foco em "Tentar de novo": `$S/p5f1r3/revisoes/ptbr/capturas/rodada2-377c2f3-b03-b-celular-375x812-texto-neutro-foco-teclado.png`.
- **E2E na árvore final.** No `verify:all` de `377c2f3`:
  - `work-time-b03.spec.ts` 5/5 (testes 189 a 193, inclusive o B03-b com teclado e o B03-c com reconstrução);
  - `work-time-p5f.spec.ts` 19/19 (testes 194 a 212);
  - `cash-pending-entries.spec.ts` 2/2 (testes 35 e 36).
- Nos cinco cenários B03, os valores registrados vêm só de estados consistentes.

### L-03 — Resolvido

- Teste novo em `tests/unit/work-time-consistency.test.ts:693`, `ok 80` no `verify:all`.
- Ele confere `ESTIMATE_EXCLUDED_READ_FAILED` com "Tentar de novo", nenhuma conversão e a prova depois do "Tentar de novo".

### L-01 — Aceito como risco residual

- Os textos "a estimativa não carregou" (`IncomeEditor.tsx:146` e `:202`) são anteriores à R3.
- Separar o estado exigiria um ramo novo no componente, o que não é estritamente necessário depois de M-01. A regra de UI inalterada justifica não mudar.
- Com o texto neutro, deixou de haver causa falsa. Sobra uma diferença de redação ("não carregou" × "em atualização"), sem efeito nos valores.

### L-02 — Aceito como risco residual

- É o mesmo padrão dos outros erros de `EstimateSummary`, anterior à R3.
- O teclado do B03-b confirma que cada acionamento relê o relatório.

### I-01 a I-05 — Aceitos

- Classificações aceitas.
- Observação sobre o registro de I-04: o RR-R3-01 existe hoje só no rascunho `$S/p5f1r3/evidencia/plano-20-18.md:70`.
- O plano mestre do WT (`docs/production/PRODUCTION_READINESS_PLAN.md`, sha256 `9707887b…`, sem mudança desde 16:26) termina na §20.17. A §20.18 ainda não foi inserida.
- Recomendo que a §20.18 inclua também L-01 e L-02 como riscos residuais de UI.
- Isso não é critério desta skill: fica para o `regression-release-gate`.

## 3. Observação nova

**I-06 — INFO: o caminho por teclado até "Tentar de novo" é longo.**
- A 1ª execução falhou com 60 Tabs (`$S/p5f1r3/logs/r3-b03-teclado.log`).
- O cartão da estimativa vem depois de todo o formulário de Configurações na ordem do DOM: rotinas, feriados, exceções e renda.
- Estimativa pelo snapshot DOM do trace da rodada 1, com marcação idêntica: cerca de 69 controles focáveis entre o título h2 e o botão. No Chromium, com o locale do E2E (en-US), Tab percorre os subcampos de hora e de data, o que dá cerca de 107 Tabs. Script: `$S/p5f1r3/revisoes/ptbr/sonda/contar-tabs-trace.py`.
- A ordem é coerente com a leitura e a estrutura é anterior à R3, fora do escopo.

## 4. Evidências de execução

| Fonte | Resultado |
| --- | --- |
| `verify:all` em `377c2f3` (`$S/p5f1r3/logs/verify-all-final.log`; `.meta`: início 19:42:32, `fim=2026-11-09T20:22:55Z exit=0 duracao_s=2423`, `limpeza=0`) | `typecheck` sem erro; `node --test` sem nenhum `fail`, `skipped`, `todo` ou `cancelled` acima de zero; `test:unit:reports` 107/107; `test:unit:work-time` 213/213 (M-01 `ok 79`, L-03 `ok 80`); **E2E 215 passed (18,5 min)**, sem falha, sem retry e sem skip |
| `work-time-b03` 5/5, `work-time-p5f` 19/19, `cash-pending-entries` 2/2 | No mesmo `verify:all` |
| `$S/p5f1r3/logs/verify-all-final.resumo.json` | 3.250 testes (1.746 do `verify:fast` + 1.289 de integração + 215 E2E), 0 falha e 0 skip. Lint: 0 erros e 201 avisos, os da P5-F.1. Confirmado também pelo coordenador. |
| `r3-b03-teclado.log` e `r3-b03-teclado-2.log` | Histórico: com 60 Tabs, FAIL; com 400, B03-b 1/1 (antes do congelamento) |

## 5. Comparação antes/depois

- **Componentes e estilos.** Inalterados: nenhum diff em `.tsx`, `.css` ou `.html`.
- **Mudança visível.** Só o conteúdo de `ESTIMATE_UPDATING`, que agora não aponta causa. O estado e o momento seguem a justificativa de estado/contrato do B03 (fail-closed): sem prova, nada converte, e depois de 30 s aparece o texto com "Tentar de novo".
- **Sem desconsideradas.** Esses casos continuam passando a "em atualização" depois de 30 s, em vez de "calculando" para sempre. Com o texto neutro, isso é aceitável: informa e oferece "Tentar de novo", sem causa falsa.
- **Nenhuma regressão** nos E2E vizinhos.

## 6. Riscos residuais

- **L-01 (LOW).** Texto "não carregou" no painel e na contagem durante "em atualização"; o painel fica sem lista. Mitigação: valores em reais, "Restaurar padrão" disponível, e registrar no §20.18.
- **L-02 (LOW).** "Tentar de novo" sem retorno visível nem proteção contra repetição. Mitigação: o orçamento das releituras e os limites da callable.
- **I-03 e I-04.** Incoerência transitória entre o topo e Configurações; "em atualização" persistente até a reconstrução em casos fora do produto.
- **Registro pendente.** A §20.18 ainda não está no plano mestre do WT (para o `regression-release-gate`).

## 7. Bloqueadores para PASS

Nenhum.
