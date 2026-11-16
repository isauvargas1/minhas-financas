# P5-F.1 — Inventário inicial (estruturas reutilizáveis e mudanças)

Base: commit `1730a1df0d3870ff52496933f45cb73a8dacd29b` + patch da P5-F (árvore `455086e0fceaf9dfe32e7bc38c9f384712d4ddc3`, SHA-256 do patch `6b98969d…a122`, conferidos antes de começar). A P5-F.1 evolui a P5-F: o núcleo de conversão e exibição continua o mesmo; mudam a origem da renda (automática, do relatório oficial) e a origem das horas (calendário do usuário).

## 1. O que é reaproveitado sem mudança de comportamento

| Estrutura | Arquivo | Uso na P5-F.1 |
| --- | --- | --- |
| Conversão centavos → minutos em BigInt, arredondamento ao minuto, formatos `≈ 11 h 30 min`, rótulo compacto, texto falado | `src/modules/work-time/calculation.ts` | Mesma fórmula; a configuração passa a ser `{ incomeCents, workMinutes }` da janela (soma de meses), não de um mês digitado. |
| Escolha dinheiro/tempo por ponto, eixos e tooltips | `src/modules/work-time/presentation.ts` | Sem mudança. |
| `useMoneyDisplay`, `ForceMoneyDisplay`, `useIsMoneyForced` | `src/modules/work-time/display.tsx` | Sem mudança; os 105 pontos e 18 gráficos da matriz da P5-F continuam lendo `config` do contexto. |
| Matriz de cobertura e confirmações em BRL (M1) | `docs/production/evidence/p5f/matriz-cobertura.md`, guarda | Sem mudança. |
| Documento privado `users/{uid}/private_preferences/work_time_equivalent` | `contract.ts`, `api.ts`, `firestore.rules` | Mesmo caminho e mesma posse (só o titular); o conteúdo passa ao contrato v2. |
| Estado do provedor marcado com o uid; listener cancelado na troca de uid | `WorkTimeContext.tsx` | Mantido; a estimativa derivada também é marcada com o uid. |
| Proteção do cache do SDK (nenhum `getDocFromCache`), nenhum `localStorage`, nenhum React Query no módulo | guarda `tests/unit/work-time-guard.test.ts` | Mantida. Os ganchos de dados genéricos ficam nos módulos de dados (relatórios, lançamentos). |
| Relatório financeiro oficial (callable `getFinancialReport`) | `functions/src/reports/*`, `src/modules/reports/officialApi.ts` | Fonte da renda: série mensal `receiptsCents` (= `incomeCents` da projeção de caixa) do preset `12m`, mais o bloco `cash` de um mês para o 12º mês completo. `workspaceType` e `referenceDate` vêm do servidor. |
| Classificação autoritativa de caixa | `functions/src/cash/periods.ts` (`cashPeriodDeltaFor`) | Define o que é receita. O cliente só espelha `incomeCents` para mostrar itens e aplicar exclusões do usuário; um teste com fixture compartilhada prova a paridade com a função do backend. |
| Invalidação existente | `invalidateFinancialReports`, `invalidateTransactionDependents`, `useFinancialReportLiveRefresh` | Atualização automática da estimativa; nenhum polling e nenhum listener por lançamento. |
| Limpeza de sessão | `AuthContext.tsx` (`queryClient.clear()` no logout e na troca de conta) | Garante que nada em cache de outra conta sirva à conta nova. As bases do relatório também levam o uid na chave; as consultas de lançamentos levam o workspace. |

## 2. Classificação oficial que a P5-F.1 herda (`cashPeriodDeltaFor` → `incomeCents`)

| Documento em `transactions` | Efeito em `incomeCents` |
| --- | --- |
| Anulado (`voidedAt`) | 0 |
| `loanEntry` (empréstimo) | 0 (principal e resultado financeiro) |
| `creditCardPaymentEntry` (pagamento de fatura) | 0 |
| `receivableEntry` (recebimento de recebível) | `+principalCents`; estorno (`reversal`, `type: despesa`) `-principalCents`; juros e multa vão para receita financeira |
| `splitEntry` (divisão de contas, reembolsos) | 0 (despesa com sinal) |
| `investmentEntry` (aporte, resgate, rendimento) | 0 (fluxo patrimonial) |
| `receita` comum pendente (`isPaid: false` ou `cashEntry.status: pending`) | 0 |
| `receita` comum liquidada | `+valueCents` |

Transferências entre contas não vivem em `transactions` (são movimentos de conta) e não entram. A classificação não usa descrição nem nome de categoria. Uma `receita` comum lançada pelo usuário para registrar aporte, empréstimo informal ou reembolso não é distinguível sem texto livre: isso fica como incerteza declarada, e o usuário pode excluir o item da estimativa.

## 3. Mudanças necessárias

1. **Contrato v2** (`contract.ts`): substitui o v1 sem migração nem leitura dupla (não há dados reais). Campos: `schemaVersion` 2, `enabled`, `displayMode`, `estimateMode` (`habitual`/`current_month`), `historyMonths` (1/3/6/12), `incomeWorkspaceId`, `allowBusinessIncome`, `excludedIncomeIds`, `routines`, `worksOnHolidays`, `uf`, `municipality`, `localHolidays`, `exceptions`, `updatedAt`. Listas e estruturas são textos com gramática fechada (sem mapas nem listas arbitrárias), validados por expressão regular e por limite de tamanho e de quantidade nas Rules; o cliente valida também a semântica (datas reais, intervalos, sobreposição).
2. **Rules v2**: o mesmo bloco do titular, com a lista exata de campos v2 e as mesmas gramáticas. O v1 deixa de ser aceito.
3. **Motor de calendário puro** (`calendar.ts`, `holidays.ts`): minutos planejados por dia e por mês a partir das rotinas, dos feriados e das exceções; função pura testada.
4. **Base de renda** (`incomeBasis.ts`, `estimate.ts`): janela de meses, espelho de `incomeCents`, exclusões do usuário, modo habitual e mês atual, estados provisório e indisponível.
5. **Ganchos de dados genéricos**: relatório de um workspace escolhido (`src/modules/reports/hooks.ts`), lançamentos por id e listagem de receitas da janela (`src/modules/transactions/*`). Nenhum deles conhece o tempo de trabalho.
6. **Índices**: `transactions` (`type`, `date` desc, `__name__` desc) e (`receivableEntry.reversal`, `date` desc, `__name__` desc) para a listagem sob demanda das receitas.
7. **Interface**: assistente (A–E e resumo), Configurações com prévia antes de salvar, refazer o assistente, desativar, excluir; "Como este valor foi calculado?"; "Receitas consideradas"; calendário mensal de exceções acessível. Header: o aviso do modo tempo informa quando a estimativa está indisponível. Fora dessas superfícies, nada visual muda.
8. **Testes**: unitários (calendário, feriados, contrato, renda, estimativa, cálculo), paridade com o backend, Rules no Emulator, E2E; guardas e suítes da P5-F adaptadas ao v2 sem perder asserções.

## 4. Decisões

- **D-P5F1-01 — Nenhuma Function nova.** A renda vem do relatório oficial existente. Nenhuma Function lê `private_preferences`; a preferência não vai ao servidor além do próprio documento.
- **D-P5F1-02 — Uma fonte de renda.** `incomeWorkspaceId` aponta um único workspace; o padrão é o PF do qual o usuário é proprietário. Fonte PJ só com `allowBusinessIncome: true` e aviso; o tipo vem do servidor (`workspaceType`). Não há soma PF+PJ.
- **D-P5F1-03 — Exclusões aplicadas sobre o total oficial.** Estimativa = Σ mês (`receiptsCents` oficial − contribuição dos itens excluídos pelo usuário naquele mês). As contribuições dos excluídos são lidas por id (até 50, consultas `in` de até 30). Mês em que a subtração ficaria negativa não aplica exclusões e é sinalizado. O painel "Receitas consideradas" lista a janela sob demanda e confere, mês a mês, Σ itens = total oficial.
- **D-P5F1-04 — O estorno de recebimento fica na data do recebimento** e anula o valor dele naquele mês, como no relatório de caixa. É assim que o backend o grava (`functions/src/receivables/operations.ts`: o movimento e o espelho em `transactions` recebem `date: movement.date`, conferido em `receivableLifecycle.integration.test.ts`), então estornar em novembro um recebimento de setembro muda setembro. No painel (`incomeItemPresentation`), recebimento estornado não pode ser desconsiderado (o valor sairia duas vezes), e o que já estava desconsiderado ganha o aviso para voltar a considerá-lo; nenhuma data é apresentada como a do estorno (a do espelho é a do recebimento). Item depois do período (os dois no mês corrente, no modo habitual) diz que ainda não entra na conta. As revisões 2 e 3 partiram de uma fixture com o estorno em outra data; a revisão 4 mostrou que o backend não produz esse caso, e o ramo foi retirado. O lançamento original não guarda o estorno, então o recebimento desconsiderado antes de ser estornado depende do aviso do painel.
- **D-P5F1-05 — Feriados nacionais por lei federal, com vigência.** Lei 662/1949 na redação da Lei 10.607/2002 (1/1, 21/4, 1/5, 7/9, 2/11, 15/11, 25/12; base a partir de 2003), Lei 6.802/1980 (12/10) e Lei 14.759/2023 (20/11, a partir de 2024). Sexta-feira da Paixão é feriado religioso municipal (Lei 9.093/1995, art. 2º); Carnaval, Quarta-feira de Cinzas e Corpus Christi são pontos facultativos federais: nenhum é automático. O usuário pode incluí-los com um clique (data calculada pela Páscoa) em "Feriados locais".
- **D-P5F1-06 — Feriados estaduais e municipais manuais.** Não há fonte oficial verificável nesta sessão: os portais `www.planalto.gov.br` e `www2.camara.leg.br` estão fora da rede permitida (ENOTFOUND). As leis federais acima foram conferidas por busca em 2026-11-04, em resultados que reproduzem os textos oficiais. A interface mostra a limitação de cobertura e oferece inclusão manual e "feriado trabalhado".
- **D-P5F1-07 — Turno conta no dia em que começa.** Janelas do mesmo dia se unem; um turno que passa da meia-noite e cruza com uma janela do dia seguinte conta a sobreposição uma vez, no dia do turno; intervalos são descontados uma vez por janela; duração sem horário soma; teto de 24 h por dia.
- **D-P5F1-08 — Nada derivado é gravado.** Renda, minutos e valor por hora são calculados em memória a partir do relatório oficial e do calendário; não vão ao documento, ao `localStorage`, ao React Query (o cache guarda só o DTO oficial, como nos Relatórios), a logs nem à IA.

## 5. Fora do escopo

P6–P10, publicação de Rules, índices, Functions ou Hosting, migração ou backfill, alteração de `.claude/settings.json`, commit e push.
