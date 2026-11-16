PASS — revisão de UI de produto em PT-BR

# P5-F.1-R3.1 — revisão independente (`ptbr-product-ui-review`)

Revisão feita só com leitura em 2026-11-10, das 20:55 às 21:10 UTC, contra o código e não contra os documentos. A skill e o checklist foram lidos inteiros. `W` = `<scratchpad>/wt-p5f1-r31`.

Nada foi alterado em `W`. As leituras de git usaram `GIT_OPTIONAL_LOCKS=0`, e os blobs foram calculados com `git hash-object` sem `-w`. O índice do worktree continua com mtime 20:06:53, anterior a esta revisão. Não rodei Emulator, Playwright, build, `verify*` nem `firebase`. Só rodei testes de unidade, direto com `node --test`.

## Respostas diretas aos pontos pedidos

- **Mudanças visíveis.** Todas são de seleção de estado (qual estado já existente aparece em cada situação) e todas estão ligadas à correção (seção 4). Não houve mudança de layout, estilo, navegação nem texto novo: nenhum `.tsx`, `.css` ou arquivo de estilo mudou. `Header.tsx`, `EstimateDetails.tsx` e `WorkTimeContext.tsx` têm o mesmo blob nas duas árvores. Em `messages.ts`, só o JSDoc mudou.
- **Estados que aparecem em mais situações.** Todos usam texto pt-BR claro, sem detalhe interno. Têm "Tentar de novo" onde há ação possível: o erro, o "em atualização" e o aviso de leitura anterior. "Calculando" é transitório e vira "em atualização" com o botão depois de 30 s. Os valores ficam em reais. O topo e a prévia ficam coerentes em cada estado (tabela 2.2), com a ressalva pré-existente dos temporizadores independentes (I-04).
- **Aviso de leitura anterior.** Continua aparecendo para o estado atual, provado e sincronizado, quando uma releitura falhou. Não pode mais aparecer junto de uma estimativa antiga: `holdEstimate` não recebe estimativa anterior nenhuma, e o prazo que a "envelhecia" (N06) foi removido (seção 2.3).
- **Acessibilidade.** `role="status"` em "calculando" e no aviso de leitura anterior, e `role="alert"` no erro e no "em atualização", sempre com botão nativo. O B03-b passa no axe, no teclado e a 375×812 no mesmo ramo de componente que o B03-f usa. Há lacunas pré-existentes, fora do escopo mínimo: o aviso do topo não tem região viva, e o foco cai no `body` quando o bloco pronto é desmontado (I-02 e I-03).

## 1. Escopo

- **Requisito.** `relatorio/pedido-r31.md`, achado R3-AUD-01. Com `proven=false` ou com a sincronização impedindo a confirmação, nenhuma estimativa histórica pode aparecer como conversão atual. O pedido prefere BRL com estado de atualização e quer que o prazo só troque o texto. A conversão volta com a prova e com a sincronização concluída. Os avisos, o "Tentar de novo", as preferências e os estados de erro ficam preservados, e a mudança de interface deve ser a menor possível.
- **Base e HEAD.** O HEAD do worktree (`1730a1d`) é a base antiga do programa e não entra na comparação. Comparei árvore com árvore: antes (R3) `1c9155dbc8d6aedd35e6f39a63fac46b53d81919`, depois (R3.1) `40057d2a78c47fea537480b0a2bc21fc46e2a500`. Os 12 arquivos de interesse em `W` batem blob a blob com `40057d2a`.
- **Arquivos alterados (11).** `useIncomeEstimateWith.ts` (lógica). `messages.ts`, `consistency.ts` e `basisSync.ts`, só com comentários. `e2e/work-time-b03.spec.ts` (+B03-f) e `e2e/work-time-p5f.spec.ts` ("releitura que falha" reescrito). Os três testes de unidade de tempo de trabalho e dois `.md` de evidência.
- **Telas e fluxos revisados.**
  - Aviso do topo no Dashboard (`Header`).
  - Valores do app via `WorkTimeContext.config`.
  - Prévia de Configurações (`EstimateSummary`) e memória de cálculo (`EstimateDetailsDialog`).
  - Painel "Receitas consideradas" e editor de renda (`IncomeEditor`).
  - Linha "Valor em uso agora" (`WorkTimeSettingsView`).
  - Assistente (`WorkTimeWizard`), que usa uma instância própria, de identidade nova, e não muda.

## 2. Evidências do código

### 2.1 Critérios

| Critério | Arquivo:linha | Conclusão |
| --- | --- | --- |
| Nenhum componente ou estilo alterado | `git diff --name-status 1c9155d 40057d2`: nenhum `.tsx`, `.css`, `index.html` ou `tailwind`. Blobs iguais: `Header.tsx` `bedd51f`, `EstimateDetails.tsx` `e5386e8`, `WorkTimeContext.tsx` `fe2302c` | OK |
| Nenhum texto visível novo | `messages.ts:78-81` (JSDoc). `consistency.ts:4-10` e `basisSync.ts:307-311, 583-587` (comentários). Fora de comentários, os únicos literais novos em `src/` são `'done'` e `'loading'` (`useIncomeEstimateWith.ts:118, 367`), identificadores internos | OK |
| Pronta só com prova e sincronização concluída | `useIncomeEstimateWith.ts:113-118` (`holdEstimate` com 4 parâmetros, sem anterior) e `:363` | OK |
| Valores em reais fora disso | `WorkTimeContext.tsx:127-135`: `config` só com `done` + `ready` + modo tempo | OK |
| O prazo só troca o texto | `useIncomeEstimateWith.ts:367-385`: `loading` vira `error`/`ESTIMATE_UPDATING` com `retry`, sem conversão | OK |
| Erros sem detalhe interno | `useIncomeEstimateWith.ts:229-235, 346-362`. `messages.ts:74-93`: textos fixos; `excluded` sempre fixo. `official.ts:383-407` e `officialApi.ts:19-27`: todo erro do relatório passa por `reportErrorMessage`, e o texto do SDK nunca chega à tela. Os erros de `projectionReads.ts` entram como `excluded`, com texto fixo | OK |
| Renderização dos estados | `EstimateDetails.tsx:43-45` (`role="status"`), `:46-53` (`role="alert"` + "Tentar de novo"), `:78-83` (`role="status"` + "Tentar de novo"), `:146` (diálogo) | OK |
| Aviso do topo | `Header.tsx:45-51` (ressalvas) e `:529-546` (três textos + "Mostrar em R$") | OK, sem região viva (I-02) |
| Superfícies adjacentes | `IncomeEditor.tsx:46, 108, 145-146, 196, 231`; `WorkTimeSettingsView.tsx:177, 443, 446-449, 492-493` | Estados existentes (I-05) |

### 2.2 Estados após a R3.1: o topo e a prévia

| Estado mostrado | Aviso do topo (`Header.tsx:533-537`) | Prévia de Configurações (`EstimateDetails.tsx`) | Valores |
| --- | --- | --- | --- |
| Sem prova ou sincronizando, menos de 30 s, sem falha | "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais." | "Lendo as receitas oficiais e calculando..." (`status`) | reais |
| O mesmo, depois de 30 s | "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." | "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais." + "Tentar de novo" (`alert`) | reais |
| Sem prova ou sincronizando, com leitura ou escuta em falha | "…indisponível agora… Veja o motivo em Configurações." | Uma das mensagens fixas, com "Tentar de novo" (`alert`): "Não foi possível carregar o relatório. Tente novamente.", "Não foi possível conferir as receitas desconsideradas agora. Tente de novo.", "Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo." ou "Você não tem permissão…" | reais |
| Provada, sincronizada, releitura em falha | "Valores em tempo de trabalho equivalente…" + "Não foi possível atualizar a estimativa com os lançamentos mais recentes: ela usa a leitura anterior. Tente de novo em Configurações." | Hora + "Não foi possível atualizar… Ela usa a última leitura." + "Tentar de novo" (`status`) | tempo |
| Provada e sincronizada | "Valores em tempo de trabalho equivalente…" | Hora e resumo | tempo |

Os pares do topo e da prévia são coerentes. A diferença entre "indisponível" e "em atualização", e entre "última leitura" e "leitura anterior", já existia na R3 e não confunde.

### 2.3 Aviso de leitura anterior

- **Ainda aparece quando deve.** `refreshFailed` vem só das leituras atuais (`useIncomeEstimateWith.ts:281`) e passa intacto pelo `holdEstimate` quando a estimativa está provada e sincronizada (`:118`). Testes:
  - Unidade: `work-time-income-estimate.test.ts:105-115` (`stale` provada e sincronizada aparece) e `:849-888` ("a atual com a ressalva imediata").
  - E2E: P5F "releitura que falha" (`work-time-p5f.spec.ts:1093, 1097`) e "escuta das projeções encerrada" (`:1215-1223`).
  - Mutante A11 ("a atual provada perde o aviso") morto.
- **Não aparece mais com uma estimativa antiga sem prova.**
  - A R3 tinha dois caminhos para isso: a anterior segurada (base `useIncomeEstimateWith.ts:153-158`) e o aviso adiado de 30 s (base `:452-453`). Os dois foram removidos.
  - `work-time-income-estimate.test.ts:76-103` exige `holdEstimate.length === 4`, com tabela-verdade completa.
  - `work-time-guard.test.ts:466` proíbe `HeldEstimate`, `last.current`, `heldTooLong` e afins no hook.
  - O mutante A01 (retenção reintroduzida) está morto.
  - O E2E P5F exige `stale` só com a hora oficial (`:1121`) e nenhuma hora entre o primeiro erro e a anulação (`:1120`).

## 3. Evidências de execução

| Comando ou teste | Viewport ou interação | Resultado | Artefato |
| --- | --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/work-time-income-estimate.test.ts` (eu) | — | 21/21, 0 skip | terminal |
| `… tests/unit/work-time-consistency.test.ts` (eu) | — | 46/46, 0 skip | terminal |
| `… tests/unit/work-time-guard.test.ts` (eu) | — | 18/18, 0 skip | terminal |
| `verify:all` do executor na árvore `40057d2a`, iniciado às 20:47:05 e em curso | — | Passaram typecheck, lint, build, `test:unit:ui` 9/9, `test:unit:reports` 107/107 e `test:unit:work-time` 221/221, todos com 0 skip. Integração e E2E ainda rodam | `logs/verify-all-1.log:6824-6888, 9206-9858, 9862-11200` |
| E2E de tempo de trabalho (25 testes), das 20:39:29 às 20:45:50 | Desktop 1280×720; B03-b também a 375×812, com teclado (Tab, Enter, Espaço, foco visível) e axe | 25/25 | `evidencia/e2e-r31-work-time-1/` |
| Os mesmos testes novos na cópia da R3 | — | B03-f e P5F falham com o defeito: 9 `[data-work-time]`, saldo R$ 20.200,00 como "≈ 808 h" sem ressalva, e prévia R$ 25,00 com "Ela usa a última leitura" | `evidencia/e2e-red-r3/*.md` |
| Mutantes dirigidos | — | 11/11 mortos | `logs/mutantes-cliente-r31.log` |
| Captura `b03-b-celular-375x812.png`, inspecionada por mim | 375×812 | Texto inteiro sem corte, botão dentro da janela, anel de foco visível, ortografia correta | evidência B03-b |

O E2E corresponde ao código final. O `build:e2e` começou às 20:39, depois da última edição em `src/` (20:36). O spec B03 é idêntico ao executado. O spec P5F mudou depois da execução, mas só por uma linha de `console.log` (I-07). Só os dois specs de tempo de trabalho usam o modo tempo (`grep` nos 36 specs). Contagem de testes nos arquivos alterados, R3 → R3.1: consistency 33→40, guard 18→18, income-estimate 20→20, B03 5→6, P5F 19→19. Nenhum `skip`, `only` ou `fixme`.

## 4. Comparação antes e depois

### 4.1 Classificação de cada mudança visível

| # | Situação | R3 (antes) | R3.1 (depois) | Classificação |
| --- | --- | --- | --- | --- |
| V1 | Estimativa provada na tela; leitura nova divergente, sem prova, mesma identidade, sem falha (R3-AUD-01) | Conversão pela estimativa anterior, sem aviso. No E2E, "≈ 808 h" para R$ 20.200,00, com o topo sem ressalva | Reais. Topo "Calculando…" e depois "indisponível… Veja o motivo em Configurações". Prévia "Lendo…" e depois "em atualização" + "Tentar de novo". E2E: `[valores-b03-f]` tempo 796 h → reais R$ 19.900,00 → reais R$ 20.200,00 → tempo 795 h 2 min | Requerida (núcleo do achado) |
| V2 | O mesmo, depois de 30 s | Anterior + "Ela usa a última leitura" | "Em atualização" + "Tentar de novo" | Requerida (item 4) |
| V3 | Falha de leitura ou da escuta sem prova (relatório, por id, marcas, escuta com desconsiderada ou 12 meses) | Anterior + aviso de leitura anterior (`status`) | Erro fixo em pt-BR (`alert`) + "Tentar de novo"; topo "indisponível" | Requerida (itens 2 e 6) |
| V4 | Provada, mas com a sincronização em curso | A anterior da mesma identidade, ou a atual se não houvesse anterior | "Calculando" e depois "em atualização"; reais | Requerida (itens 2 e 5). Efeito: alternância (I-01) |
| V5 | Provada, sincronizada, releitura em falha; escuta encerrada com uma base sem desconsiderada | Atual + aviso | Igual | Preservado (item 6) |
| V6 | Superfícies adjacentes durante a sincronização: painel, memória de cálculo, "Valor em uso agora", aviso PJ | Conteúdo da anterior | Estados existentes de carregando ou de erro | Requerida, como consequência (I-05) |
| — | Layout, estilo, navegação, ícones, cores, texto | — | Nenhuma mudança | — |

Não há mudança fora de escopo. A mudança inesperada mais visível é a alternância de I-01, um efeito direto do contrato pedido.

Não há par de capturas da R3 e da R3.1 no mesmo estado. Considero suficiente a prova de que nenhum código de renderização mudou: blobs idênticos e nenhum literal novo. Com isso, cada estado tem a mesma aparência que já tinha na R3, por exemplo no B03-b, e o que muda é só qual estado aparece. Isso está documentado pelo snapshot da R3 e pelas sequências registradas na R3.1.

## 5. Achados

Nenhum achado HIGH, MEDIUM ou LOW: nenhum defeito introduzido pela R3.1 na interface. Os itens abaixo são INFO, fatos para o registro, nenhum bloqueante.

- **I-01 (INFO): alternância tempo → reais → tempo a cada sincronização.**
  - Efeito: na janela de 12 meses, a alternância também acontece cerca de 30 s depois de qualquer lançamento nesta aba, inclusive uma despesa.
  - Impacto: troca visível e breve de todos os valores, pela duração da releitura, e "Calculando…" no topo. Os valores continuam sempre corretos, e o topo explica a troca.
  - Por que acontece:
    - O mês avulso só existe em habitual de 12 meses (`estimate.ts:130-134`), o que dá duas bases (`useIncomeEstimateWith.ts:139, 164`).
    - Com duas bases, qualquer leitura em curso segura a estimativa (`basisSync.ts:588-589, 597`).
    - Toda mutação relê as bases do workspace (`incomeReads.ts:43-47`, `transactions/hooks.ts:30`, `basisRegistry.ts:139-144`), agrupadas a cada 30 s, com 2 seguidas e depois 1 a cada 10 min (`queryKeys.ts:53-57`).
    - Na R3, a anterior da mesma identidade ficava na tela (base `:153-158`). Na R3.1, segurar é não converter (`:118`).
  - Evidência de alternância com o mesmo valor final: `[valores-b03-e]`, tempo 896 h → reais R$ 22.400,00 → tempo 896 h, com o aviso alternando duas vezes.
  - Classificação: requerida pelos itens 2, 3 e 5 do pedido, com o mecanismo de sincronização da R3 preservado.
  - Remediação: registrar como risco residual aceito no relatório da R3.1. Reduzir a alternância, por exemplo distinguindo a releitura sem mudança de receita, seria mudar a sincronização: fica para outra etapa, com revisão financeira.
- **I-02 (INFO, pré-existente): o aviso do topo não tem região viva.** `Header.tsx:530` é um `<p>` sem `role` nem `aria-live`. As trocas "Valores em tempo…" ↔ "Calculando…" ↔ "indisponível…" não são anunciadas. A R3.1 não toca o `Header`, mas as trocas ficam mais frequentes. Corrigir exige mudar a UI, fora do escopo mínimo: registrar para uma etapa própria.
- **I-03 (INFO): o foco se perde quando o resumo pronto vira "carregando".** `EstimateDetails.tsx:43-45` substitui o bloco que tinha "Como este valor foi calculado?" (`:109-110`) e o "Tentar de novo" do aviso (`:81`), e o foco cai no `body`. O novo estado é anunciado com `role="status"`, e "em atualização" mantém o foco no botão (B03-b, `work-time-b03.spec.ts:409-415`). O padrão já existia na troca de identidade; na R3.1 ele fica mais frequente. Só registrar.
- **I-04 (INFO, pré-existente): o topo e a prévia têm temporizadores independentes.** São duas instâncias, `WorkTimeContext.tsx:118` e `WorkTimeSettingsView.tsx:177`, cada uma com a sua espera (`useIncomeEstimateWith.ts:368-384`). O topo pode dizer "Veja o motivo em Configurações" enquanto a prévia, recém-montada, ainda mostra "Lendo as receitas oficiais e calculando..." por até 30 s. O B03-f precisa de até 60 s para ver o "em atualização" (`:680`). Unificar a espera fica para outra etapa.
- **I-05 (INFO): superfícies adjacentes mudam durante a sincronização.**
  - O painel "Receitas consideradas" troca a lista por "Carregando as receitas do período..." (`IncomeEditor.tsx:46, 108, 145`).
  - A memória de cálculo mostra "A estimativa ainda não está pronta." (`EstimateDetails.tsx:146`).
  - "Valor em uso agora" some (`WorkTimeSettingsView.tsx:446-449`).
  - Com a fonte PJ fora da lista carregada, o aviso PJ e a confirmação somem (`IncomeEditor.tsx:196, 231`).

  São textos e estados existentes, coerentes com não mostrar a anterior. O caso é raro: o painel ou a tela abertos durante uma sincronização da mesma identidade.
- **I-06 (INFO, pré-existente): "em atualização" usa o ramo de erro.** O ramo tem `role="alert"` (`EstimateDetails.tsx:48`), embora `messages.ts:84-86` diga que o estado "não é falha". A revisão pt-BR da R3 já aceitou isso.
- **I-07 (INFO, evidência): o spec P5F mudou depois da execução.**
  - `work-time-p5f.spec.ts` foi editado às 20:46:26, depois do E2E (20:39:29–20:45:50).
  - A única diferença para a versão executada (igual a `copia-r3-e2e`, das 20:33:46) é o `console.log` da linha 1115. Nenhuma asserção mudou.
  - Por isso o registro `[previa-releitura-que-falha]` não está no log entregue. As asserções da sequência (`:1120-1123`) passaram no run.
  - Remediação: anexar ao pacote o log do `verify:all` na árvore `40057d2a` (em curso), que roda o arquivo final.
- **I-08 (INFO, pré-existente): mensagem de relatório genérica.** "Não foi possível carregar o relatório. Tente novamente." (`official.ts:383-384`) agora aparece no cartão da hora também numa releitura que falha sem prova. "Relatório" é genérico, e "Tente novamente" difere de "Tentar de novo". O texto é seguro, em pt-BR e já era usado na R3. Nenhuma ação nesta etapa.

## 6. Riscos residuais

- **I-01.** Nenhum E2E cobre o caso de 12 meses com uma mutação comum. A duração da alternância em produção depende da latência da callable do relatório.
- **Acessibilidade do topo.** Na R3.1, o axe só passou em Configurações (B03-b). O aviso do topo e o Dashboard não mudaram de código, mas não passaram pelo axe nesta rodada (I-02).
- **`verify:all` em curso.** A integração e o E2E completo ainda rodam. O veredito de UI se apoia nos 25 E2E de tempo de trabalho, os únicos que exercitam o modo tempo, rodados no código final.
- **Sincronização presa.** Se a sincronização ficar presa, o usuário vê reais com "em atualização" e "Tentar de novo"; antes, a anterior ficava na tela. O comportamento é seguro, mas a liveness depende do mecanismo da R3: cabe à revisão financeira e de arquitetura.

## 7. Bloqueadores para PASS

Nenhum.

## Pendências de navegador

Nenhuma é necessária para decidir. Fica uma verificação recomendada e não bloqueante, para dimensionar I-01, que o executor pode rodar depois, no Emulator:

- **Cenário.** Habitual, 12 meses, fonte igual ao espaço ativo, modo tempo e estimativa provada na tela.
- **Ação.** Lançar uma despesa nesta aba e registrar, por 45 s, o saldo do Dashboard e o aviso do topo com o registrador do B03.
- **Esperado.** Por volta de 30 s depois, tempo → reais com "Calculando…" durante a releitura → tempo com o mesmo valor, nunca outro valor convertido. Medir a duração.
