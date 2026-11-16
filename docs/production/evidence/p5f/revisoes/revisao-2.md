# Revisão independente da P5-F (REQ-FUT-01): revisão 2

Base `1730a1df`. Li o worktree até 2026-10-19 12:11 UTC. Revisão somente leitura: nada no worktree foi alterado. Os temporários estão só em `scratchpad/p5f/review/`.

O worktree mudou durante a revisão. Entre 11:59 e 12:08 entraram:
- a largura do eixo Y no modo tempo (`AXIS_WIDTH_IN_TIME_MODE = 80`) em `ReportsChartsView.tsx`, com a guarda correspondente;
- dois arquivos novos de evidência em `e2e/`;
- ajustes na matriz e no plano.

Esta revisão considera esse estado.

## 1. Veredito

As correções conferem no código e não criaram regressão:
- `tsc` passa;
- os testes unitários puros passam (828/828 na rodada completa; 35/35 do work-time no estado final);
- o modo dinheiro fica idêntico em todas as telas tocadas.

Resta 1 resíduo MEDIUM: a anulação de despesa dividida continua sem R$ no modo tempo (M1-R). O M2 ficou resolvido com a largura de 80 px, salvo uma borda LOW. Também entrou 1 LOW novo: o roteiro temporário de evidência está dentro de `e2e/`. Recomendo fechar M1-R e o LOW do roteiro antes de encerrar a P5-F.

## 2. Achados

### M1-R (MEDIUM, resíduo do M1): a anulação de despesa dividida segue sem valor em reais no modo tempo

**Onde:**
- `src/components/SplitBillDetailsModal.tsx:190` converte o "Valor Total". A matriz o classifica como T (`matriz-cobertura.md:165`).
- No mesmo modal, "Anular Despesa" (139-147) abre a confirmação (156-183): "Anular esta despesa?" … "Confirmar Anulação". Ela não mostra valor nenhum e faz uma de duas coisas:
  - estorna o lançamento no Caixa (164);
  - cancela ou estorna a compra no cartão (165).
- A mesma rota parte da lista: `SplitGroupDetailsView.tsx:446` (linha convertida) → "Anular" (463) abre esse modal.

**Cenário:** modo tempo ativo. A despesa mostra "≈ 6 h"; o usuário clica "Anular Despesa" e confirma o estorno sem nenhum R$ na tela. O valor em reais só aparece no `title` e no sr-only.

**Impacto:** é o mesmo caso que foi corrigido na anulação de lançamento (`App.tsx:635-637`). Contraria duas coisas:
- a regra nova da própria matriz (`matriz-cobertura.md:23`): "valor mostrado ao lado de uma ação que move dinheiro sem exibir o valor em reais fica em BRL";
- o requisito "aprovações e confirmações continuam em BRL".

**Correção mínima:** há duas saídas.
1. Fazer como em `App.tsx`: só quando `display.isTime`, mostrar o valor exato em reais na confirmação. O modo dinheiro fica idêntico.
2. Voltar o "Valor Total" do modal à expressão da base, `formatSplitCents(bill.amountCents)`, como R-CF.

A opção 2 também elimina a mistura de unidades no mesmo bloco (total em tempo, partes em R$). Nos dois casos: acrescentar o ponto a `BRL_POINTS_IN_ELIGIBLE_FILES` e atualizar a matriz (linha 165).

### M2: resolvido, com uma borda LOW (estimativa)

**O que entrou depois da primeira leitura:** às 12:0x, `ReportsChartsView.tsx:16` passou a definir `AXIS_WIDTH_IN_TIME_MODE = 80`. Os 5 eixos (201, 245, 484, 673, 720) recebem `width={display.isTime ? AXIS_WIDTH_IN_TIME_MODE : undefined}`. No modo dinheiro, `undefined` mantém o padrão de 60 px. A guarda confere as 5 ocorrências (`work-time-guard.test.ts:277`).

**Mecânica** (confirmada no recharts 2.12.7): o tick é ancorado à direita em `x + width - 6 - 2` (`CartesianAxis.js:117-121, 355-356`); o espaço inseparável impede a quebra (`Text.js:30`); o SVG recorta o que passa da borda. Com 80 px sobram, por estimativa:
- ~52 px no fluxo de caixa (margem −20);
- ~62 px no patrimônio (margem −10);
- ~72 px no gráfico de parcelas;
- ~92 px no de top clientes.

**Larguras estimadas** (Poppins 12 px; dígitos de 6,5 a 7,5 px):

| Rótulo | Largura | Resultado |
| --- | --- | --- |
| "≈ 124 h" | ~38-43 px | cabe |
| "≈ 1.234 h" | ~48-54 px | cabe, no limite |
| "≈ 12.345 h" | ~55-61 px | cabe no patrimônio; no fluxo de caixa perde só parte do "≈" |

**Borda que resta (LOW, `ReportsChartsView.tsx:222` e `:245`):**
- Num tick negativo de 4 dígitos ou mais no fluxo de caixa ("-≈ 1.234 h", ~52-58 px), o "-" pode ser recortado e o valor aparecer como positivo.
- Acontece quando o resultado operacional fica negativo em mais de mil horas de renda.
- O modo dinheiro já tem o mesmo defeito, preexistente e pior: "R$-1.25k", ~51 px em 32 px visíveis.

**Correção mínima:** só no modo tempo, usar `margin.left: 0` no fluxo de caixa ou largura de ~90 px. Confirmar visualmente com Playwright contra o Emulator.

### L-NOVO (LOW): roteiro temporário de evidência dentro de `e2e/`

**Onde:** `e2e/p5f-evidence.spec.ts` e `e2e/p4d-evidence-common.ts` (novos, criados às 12:08).
- O cabeçalho diz "roteiro TEMPORÁRIO de evidência visual (não faz parte da suíte)".
- Mesmo assim, `playwright.config.ts:39` usa `testDir: './e2e'`, sem `testIgnore`. Por isso `npm run test:e2e` e o job de E2E do CI coletam o `.spec.ts`.
- `p4d-evidence-common.ts:11` fixa o axe-core num caminho absoluto do scratchpad da sessão (`<scratchpad>/axe/...`).

**Cenário:** se os arquivos forem commitados ou ficarem no worktree no gate de regressão:
- o E2E falha no CI, porque o arquivo não existe lá;
- ou roda uma bateria longa de capturas (360, 390 e 1440 px × claro e escuro);
- e um caminho de sessão vai para o repositório.

**Correção mínima:** remover os dois arquivos antes do fechamento. Se forem mantidos, levá-los para fora de `e2e/` (ou pôr em `testIgnore`) e resolver o axe-core pelo `node_modules` do repositório.

### INFO

- **I4 (aberto):** `docs/production/evidence/p5f/mutantes.md` cita `mutantes.py.txt`, `mutantes-guarda-anterior.py.txt` e `mutantes-rules.py.txt`. Nenhum dos três está no repositório: `find` não os acha, e o diretório só tem `cache-sdk.md`, `matriz-cobertura.md` e `mutantes.md`. Versionar os roteiros ou citar onde ficam.
- **L3 sem teste:** nenhuma guarda nem E2E cobre a recusa offline nem o modal que fecha durante a exclusão. Sugestões:
  - um E2E com `context.setOffline(true)`;
  - ou uma asserção estática de `isOffline()` em `handleSave` e em `handleDelete`.

  Limite conhecido, já comentado no código: `navigator.onLine` não detecta rede sem internet. Nesse caso o "Salvar" ainda fica em "Salvando..." até a rede voltar; a exclusão já pode ser fechada e mostra o aviso de pendência.
- **Cobertura linha a linha parcial:** `BRL_POINTS_IN_ELIGIBLE_FILES` (`work-time-guard.test.ts:247-260`) protege 12 pontos. Ficam de fora outros R-* em arquivos elegíveis:
  - `ClientsReceivablesView.tsx:513`, confirmação de cancelamento com o valor original;
  - `ClientsReceivablesView.tsx:327`, coluna "Valor";
  - o principal em `LoanCard.tsx`;
  - `RecurringExpenseDetailsView.tsx:762` e `:765`, histórico de reajustes;
  - `CardInvoiceDetailsDrawer.tsx:313`, pagamentos.
- **Mistura de unidades na mesma tela, efeito colateral do M1** (aceitável pela regra):
  - parte da divisão em R$ com o total em tempo;
  - ocorrências pendentes em R$ com próximas e histórico em tempo;
  - linhas de investimento em R$ com os chips em tempo.

  A opção 2 de M1-R resolve o caso mais visível.

## 3. Verificado nesta passada

### M1
- Voltaram exatamente à expressão da base:
  - `SplitBillDetailsModal.tsx:242`: `formatSplitCents(share.amountDueCents)`;
  - `SplitGroupDetailsView.tsx:404`: `formatSplitCents(item.amountCents)`;
  - `SimpleInvestmentsView.tsx:631`: `formatCurrency(row.valueCents)`;
  - `RecurringExpenseDetailsView.tsx:623`: `formatCents(occ.plannedAmountCents)`.
- O histórico (719) e as próximas ocorrências (678) não têm ação.
- A anulação de lançamento (`App.tsx:635-637`):
  - mostra "O lançamento de R$ x" só no modo tempo; no modo dinheiro, a mensagem é idêntica à base;
  - `valueCents` é validado como inteiro seguro ≥ 0 na leitura (`transactions/contract.ts:47-49`), então `formatCentsBRL` não lança.
- As outras ações ao lado de valores convertidos já mostram R$ na confirmação: compra e pagamento da fatura, recebível, transferência e cancelamento de empréstimo (`useLoanOperations.tsx:151`).
- Arquivar uma conta não move dinheiro.

### M2
- `formatWorkTimeCompact` (`calculation.ts:168-176`):
  - horas inteiras, com o meio para cima, em BigInt;
  - minutos abaixo de 1 h;
  - `0 h` e `< 1 min`;
  - sinal espelhado e espaço inseparável.
- O caminho passa por `moneyOrWorkTimeAxisFromReais` (`presentation.ts:40-49`), que cai em dinheiro fora do intervalo exato, e chega a `display.reaisAxis`.
- Os 5 `tickFormatter` (201, 246, 485, 674, 721) usam `reaisAxis` e são idênticos à base no modo dinheiro.
- A largura de 80 px vale só no modo tempo (201, 245, 484, 673, 720), e a guarda a confere (`work-time-guard.test.ts:277`).
- A matriz (linha 64) descreve o estado atual.
- O eixo de % de utilização (618, 629) ficou intacto.

### L1
- As notas de crédito voltaram à base: `CreditCardsView` e `CardInvoiceDetailsDrawer` com `openInvoiceCreditNote(invoice)`.
- `src/modules/cards/presentation.ts` está idêntico à base (`git diff` vazio).
- "crédito de … a compensar" voltou à base em `ReportsOverview`.
- `SplitGroupList.tsx:68-69` agora usa `<>+ {display.cents(...)}</>`. No modo dinheiro, o texto é idêntico; no modo tempo, há `title` e sr-only.

### API removida
- Não sobrou nenhuma referência a `centsText`, `reaisText`, `centsTooltip`, `moneyOrWorkTimeText*` ou `moneyOrWorkTimeTooltip(` em src/tests/e2e/docs.
- `display.tsx:49-60` expõe só `cents`, `reais`, `reaisAxis` e `reaisTooltip`.

### L2
- `useIsMoneyForced` em `display.tsx:35`.
- No Header:
  - `isWorkTimeMode = !moneyForced && …` (`Header.tsx:40-41`);
  - o alternador com `isAvailable && !moneyForced` (367);
  - o aviso só no modo tempo efetivo (519).
- O Header da prévia fica dentro de `ForceMoneyDisplay` (`PersonalizationView.tsx:607-616`). O Header principal não muda.

### L3
- `isOffline()` recusa salvar e excluir com mensagem em pt-BR (`WorkTimeSettingsView.tsx:36-37, 105-108, 128-132`).
- O modal fecha a qualquer momento (390). "Excluir" continua desabilitado com `isBusy`, e o botão de excluir também.
- O aviso de pendência tem `role="status"` (136, 376-383).
- A troca de conta continua zerando o aviso (67-72).

### L4
- `importsWorkTime` pega `import(` (`work-time-guard.test.ts:46`).
- O curinga recursivo é detectado com qualquer nome, e só existe no billing (159-163).
- O novo teste linha a linha (262-276) cobre os reversos do M1, as notas de crédito, as confirmações do cartão e da transferência, os limites, a anulação e os 5 eixos.
- O E2E usa `listDocuments()` (`e2e/work-time-p5f.spec.ts:424-436`).

### I1, I2 e I3
- **I1:** a limitação da conta suspensa está documentada (PRIVACY_LGPD, item 25).
- **I2:** o painel não tem mais `aria-live` (`WorkTimeSettingsView.tsx:336`).
- **I3:** uma renda bem formada acima do inteiro seguro recebe "A renda máxima é…" (`form.ts:77-84`). Os testes cobrem o caso com e sem `R$` e mantêm o formato ambíguo recusado.

### Matriz
- Os totais T 105, G 18 e BRL 128 batem com o código, contando superfície por superfície os usos de `display.*`. Exemplos:
  - Relatórios: T 21 (14 + 7) e G 13 (5 eixos + 8 tooltips);
  - Divisão de contas: T 13;
  - Cartões: T 8.

### Testes e regressão
- `tsc --noEmit` passa, também no estado das 12:11, já com os arquivos novos de evidência.
- 828/828 testes unitários puros passam (3 testes novos); depois da largura dos eixos, 35/35 do work-time.
- A suíte de Rules não mudou desde a revisão 1.
- Nenhum teste existente foi alterado; não há `skip` nem `only`.
- O modo dinheiro fica idêntico: todo diff novo devolve o formatador original no modo dinheiro (fragmento com o mesmo texto na `SplitGroupList`).
