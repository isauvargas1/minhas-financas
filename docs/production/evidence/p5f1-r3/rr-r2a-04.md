# P5-F.1-R3 — RR-R2A-04 (`e2e/cash-pending-entries.spec.ts:169`)

**Sintoma (R2A, `verify:all` 2, árvore `cd95e1cb`).** Depois de confirmar uma despesa pendente, o cartão "Despesas" do Dashboard ficou em R$ 0,00 até o fim da espera do teste; o esperado era R$ 205,50. Oito execuções isoladas da R2A não reproduziram.

**Estado na R3:** causa identificada no produto, corrigida e coberta por testes determinísticos; resultado das repetições do E2E na §5.

## 1. Linha do tempo da falha (instrumentação sobre o log da Functions)

`saidas/rr-r2a-04-linha-do-tempo.txt` reconstrói, do log completo do `verify:all` que falhou, todas as chamadas do workspace do teste entre a primeira linha dele e a falha (início e fim de cada callable, duração e o gatilho de caixa):

- a confirmação (`confirmCashTransaction`, 71 ms) e o gatilho (`TRIGGER UPDATE applied periods=1`) acontecem **antes** das quatro releituras do relatório que vêm a seguir (linhas 69–73);
- só duas dessas leituras terminam, com 10.275 ms e 10.650 ms (o Emulator estava carregado: as leituras anteriores do mesmo teste levavam 57–140 ms, e duas levaram 2–3 s);
- as outras duas não terminam antes da falha.

Conclusão desta parte: a atualização **não** se perdeu no backend nem na publicação do Firestore. O gatilho gravou o mês antes de as releituras começarem, então elas leram o mês já atualizado (o log não traz o valor devolvido; a conclusão vem da ordem). O que faltou foi a tela receber a resposta de uma delas dentro da janela.

## 2. Onde a resposta deixava de chegar à interface

Leitura do código (`src/modules/reports/hooks.ts`, `queryKeys.ts`, `liveRefresh.ts`) e testes com o `QueryClient` real do React Query 5:

1. **Cancelamento de leitura nova.** A escuta do mês (`onSnapshot` em `cash_report_periods/{mês}`), a cada mudança, chamava `invalidateQueries` em todo relatório. `invalidateQueries` cancela a leitura em curso e começa outra (`cancelRefetch: true`). Uma leitura que **já tinha começado depois da mudança** (portanto traria o valor novo) era cancelada e trocada por outra. Com cada leitura levando ~10 s, a tela passava a depender de mais uma leitura inteira, além da janela do teste. Esse é o mecanismo compatível com a linha do tempo: quatro inícios, só dois fins e nenhuma resposta aplicada a tempo.
2. **Reaproveitamento da primeira leitura.** Sem dado ainda (`dataUpdatedAt = 0`), o React Query 5 não cancela a leitura em curso: reaproveita-a. Se essa leitura começou **antes** da mudança, ela termina sem o valor novo e nada pede outra: a atualização se perde até o `staleTime`.
3. **Primeiro retorno da escuta ignorado.** O código pulava o primeiro retorno da escuta. Uma gravação entre a leitura do relatório e esse primeiro retorno só aparece nele, e era descartada.

O defeito é do produto (cliente), não do ambiente. O Emulator lento só aumentava a janela em que ele aparece.

## 3. Correção (escopo: releitura do relatório do Dashboard)

- `src/modules/reports/queryKeys.ts`:
  - `nextFinancialReportOrder` mantém uma ordem de registro e `noteFinancialReportFetchStart` anota o começo de cada leitura (chamado na `queryFn` do relatório).
  - `needsReportRefetch` decide, para cada consulta:
    - não relê a consulta que está lendo e começou **depois** da mudança vista;
    - relê qualquer outra (parada, ou lendo desde antes).
  - `refreshFinancialReportsAfterChange` relê só as consultas que precisam (`invalidateQueries` exato por chave). Na primeira leitura reaproveitada, encadeia uma releitura depois dela.
- `src/modules/reports/hooks.ts`:
  - a `queryFn` anota o começo;
  - todo retorno da escuta conta, inclusive o primeiro, e registra a ordem da mudança;
  - o agendador agrupado (mesmo orçamento de antes) chama a releitura com essa ordem.
- **Sem mudança de timeout**, de contrato de callable, de backend, de chave de consulta ou de UI.

**Custo.** O `useFinancialReportLiveRefresh` fica montado no `App` e persiste na navegação. Contar o primeiro retorno acrescenta no máximo uma releitura agrupada do relatório. Ela refaz as consultas ativas do relatório: no Dashboard, a do mês e a do widget de 30 dias. A primeira leitura reaproveitada ganha também uma releitura encadeada. Na conta do revisor de escala, são 2 a 3 chamadas de `getFinancialReport` a mais por evento, e só nestes casos:

- a cada carga do app;
- a cada troca de workspace;
- a cada troca do mês do Header (a assinatura nova).

Tudo isso continua dentro do orçamento do agendador: 40 seguidas, reposição de uma por minuto, agrupamento de 2 s. Por outro lado, deixa de haver o cancelamento repetido de leituras novas.

## 4. Testes

`tests/unit/report-live-refresh-freshness.test.ts`, 7 testes com o `QueryClient` real, sem temporizador e sem prazo:

1. decisão pura (`needsReportRefetch`);
2. a leitura que começou depois da mudança não é cancelada nem repetida;
3. a primeira leitura reaproveitada recebe uma releitura depois dela, e a mudança nunca se perde;
4. com dado, a leitura desde antes da mudança é cancelada e relida;
5. a consulta parada é relida; sem observador, fica inválida e relê ao ativar;
6. em rajada, uma mudança depois do começo da leitura obriga outra;
7. só as consultas do relatório são tocadas.

Junto com `report-live-refresh.test.ts`: 14 de 14. Mutantes Q01–Q05 (`mutantes.md`): 5 de 5 mortos, inclusive o que restaura o comportamento antigo (Q01).

## 5. Repetições do E2E

Todas as execuções abaixo usaram o Emulator `minhas-financas-local`, com o build E2E da árvore do momento. Nenhum timeout foi aumentado e nenhum teste foi pulado. `e2e/cash-pending-entries.spec.ts` é o mesmo da R2A (sem diff); `src/modules/reports/hooks.ts` e `queryKeys.ts` não mudaram depois das 17:44, antes da primeira execução.

| Execução | Condição | Resultado | Log |
| --- | --- | --- | --- |
| `work-time-p5f.spec.ts` + `cash-pending-entries.spec.ts`, uma vez | build novo | 21 de 21 | `logs/execucoes/t1.log` (pacote) |
| `cash-pending-entries.spec.ts --repeat-each=10` (2 testes × 10) | sem processo de carga próprio, com outra rodada concorrente (mutantes do cliente) pesando a máquina; load average 3,21 → 4,64 | **20 de 20** | `t5-x10.log`; carga em `load-x10.txt` |
| `cash-pending-entries.spec.ts --repeat-each=5` (2 × 5) | 3 processos de carga com `nice -n 10`; load average 4,43 → 5,86 (4 CPUs) | **10 de 10** | `t6-x5-carga.log`; carga em `load-x5.txt` |
| `verify:all` final | árvore final | ver `testes-e-resultados.md` | `logs/verify-all-final.log` (pacote) |

Antes da correção, a falha só tinha aparecido no `verify:all` 2 da R2A e não se reproduzia em execuções isoladas. Por isso **as repetições sozinhas não provam a correção**. O que a prova é o mecanismo identificado (§2), coberto por testes determinísticos que falham sem a correção (mutantes Q01–Q05). As repetições mostram que a correção não piora o comportamento sob carga.

## 6. Risco residual

- **Latência do Emulator carregado.** Uma leitura de ~10 s continua possível no Emulator sob carga. A correção tira as chamadas a mais (cancelamento e reaproveitamento), mas não acelera a callable. Uma única leitura acima da janela do teste ainda falharia. Isso seria falha do teste por lentidão do ambiente, e não perda de atualização: a falha mostraria uma leitura em curso que começou depois da mudança, e o produto a aplicaria ao chegar. Se acontecer, o registro é o mesmo da linha do tempo (§1).
- **Fora do escopo, observado no E2E da R3** (anterior à R3, não corrigido): a escuta do Dashboard só acompanha o mês corrente e o mês escolhido no topo (`src/App.tsx`, `useFinancialReportLiveRefresh`). Uma edição de lançamento de outro mês não relê o saldo até a próxima leitura do relatório. Não é perda de atualização da escuta; é o alcance dela. Registrado no plano mestre como risco.
