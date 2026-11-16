# Revisão independente da P5-F (REQ-FUT-01): revisão 1

Base `1730a1df`. Li o worktree até 2026-10-19 11:29 UTC. Alguns arquivos mudaram durante a revisão e foram relidos: `display.tsx`, `WorkTimeSettingsView.tsx`, `SettingsView.tsx`, a suíte de Rules (com os casos novos de R$ 0,99), o E2E e `mutantes.md`. Revisão somente leitura: nada no worktree foi alterado.

## 1. Veredito

Não há BLOCKER nem HIGH. Rules, isolamento, privacidade, cálculo e sessão estão corretos. Recomendo corrigir os 2 MEDIUM antes de fechar a P5-F: aprovações financeiras feitas vendo só o tempo, e rótulos do eixo cortados no modo tempo. Os LOW podem entrar no mesmo ciclo.

## 2. Achados

### M1 (MEDIUM): aprovações financeiras feitas vendo só o tempo de trabalho

**Onde:**
- `src/components/SplitBillDetailsModal.tsx:242` converte a parte de cada participante. Ao lado, "Registrar recebimento" (245) e "Estornar recebimento" (263) executam na hora, via `shareAction` (93-95), sem diálogo. O mesmo vale para "Perdoar" → "Confirmar" (287).
- `src/components/SplitGroupDetailsView.tsx:404` converte o valor do reembolso. "Aprovar", "Rejeitar", "Cancelar" e "Estornar" (379-399) abrem o `ConfirmationModal` (541-551), cujas mensagens (`actionCopy`, 187-192) não trazem valor.
- `src/modules/investments/simple/components/SimpleInvestmentsView.tsx:631` converte o valor da operação. "Confirmar depósito", "Confirmar recebimento", "Cancelar lançamento" e "Desfazer lançamento" (281-345) abrem o `ConfirmMovementModal`, que mostra só a descrição (`ConfirmMovementModal.tsx:233`). Mesmo assim, o depósito movimenta o saldo da conta (`ConfirmMovementModal.tsx:123`).
- Mesmo padrão, mais brando:
  - `TransactionsView.tsx:614` e `:726` (linha convertida) → "Deletar" → `App.tsx:628-640`, uma anulação sem valor (a matriz registrou "não mostra valor").
  - `RecurringExpenseDetailsView.tsx:623` → "Tentar de novo", cujo painel (293-365) não mostra valor.

**Cenário:** com o modo tempo ativo, a linha mostra "≈ 6 h". O usuário clica "Registrar recebimento" (efeito imediato) ou "Aprovar"/"Confirmar depósito" e confirma sem ver nenhum R$. O valor em reais só aparece no `title`, ao passar o mouse, e no texto sr-only.

**Impacto:**
- Contraria o requisito "pagamentos, aprovações e confirmações continuam em BRL".
- Contraria o critério R-CF da própria matriz, que lista recebimento, estorno e reembolso.
- Contraria o texto da tela em `WorkTimeSettingsView.tsx:308`: "pagamentos, formulários e confirmações sempre mostram reais".
- Os dados não são afetados: a operação continua em centavos.

**Correção mínima:** há duas opções.
1. Reclassificar esses pontos como R-CF e voltar ao formatador original: `formatSplitCents(share.amountDueCents)`, `formatSplitCents(item.amountCents)`, `formatCurrency(row.valueCents)`.
2. Manter a classe T e, só quando `display.isTime`, incluir o valor em R$ no texto da confirmação. O modo dinheiro fica inalterado.

Nas ações de um clique da divisão de contas, só a opção 1 resolve. Nos dois casos: atualizar a matriz e acrescentar uma asserção na guarda.

### M2 (MEDIUM): rótulos do eixo Y saem cortados e enganosos no modo tempo

**Onde:** `src/components/ReportsChartsView.tsx`:
- 198, com margem `left: -10` (linha 195);
- 242, com margem `left: -20` (linha 219);
- 480, 668 e 714.

O `YAxis` não define `width`, então usa o padrão de 60 px (recharts 2.12.7, `lib/cartesian/YAxis.js:47`). O texto do tick recebe essa largura e só quebra em espaço comum (`lib/component/Text.js:30`, `BREAKING_SPACES`). Como `formatWorkTime` usa espaço inseparável, o rótulo vira uma "palavra" única. Ancorada à direita, ela transborda para a esquerda e é recortada pelo SVG.

**Cenário:** renda de R$ 3.500,00 por 173 h 20 min, ou seja, hora de R$ 20,19. Os ticks de R$ 2.500, R$ 5.000 e R$ 7.500 viram "≈ 123 h 49 min", "≈ 247 h 37 min" e "≈ 371 h 26 min" (conferido com a função real). São cerca de 14 caracteres, uns 90 px a 12 px. No fluxo de caixa (margem −20) sobram uns 30 px visíveis, algo como "9 min".

**Impacto:**
- No modo tempo, o eixo mostra magnitudes erradas e perde o "≈". Os tooltips continuam certos.
- Nenhum E2E cobre gráfico no modo tempo.
- Para confirmar visualmente, usar Playwright contra o Emulator.

**Correção mínima:** só quando `display.isTime`, usar no eixo um rótulo compacto em horas inteiras (por exemplo "≈ 124 h"), ou uma `width` maior com margem esquerda ≥ 0. O modo dinheiro fica inalterado.

### L1 (LOW): conversões em texto sem o valor em reais no mouse e no leitor de tela

**Onde:** quatro pontos usam `centsText`/`reaisText`, que devolvem só "≈ 2 h":
- `src/components/SplitGroupList.tsx:68-69`;
- `src/components/CreditCardsView.tsx:74` (renderizado em 107-108);
- `src/components/cards/CardInvoiceDetailsDrawer.tsx:141` (renderizado em 212-213);
- `src/components/ReportsOverview.tsx:374`.

**Cenário:** com o modo tempo ativo, três textos ficam sem `title` e sem texto sr-only com o R$:
- o saldo do grupo, "+ ≈ 2 h";
- a nota de crédito da fatura;
- "crédito de ≈ 1 h a compensar".

O leitor de tela lê "≈ 2 h", com o símbolo e as abreviaturas.

**Impacto:** contraria a regra "Acesso ao BRL" (matriz, §1) e o requisito de texto sr-only com o valor em reais.

**Correção mínima:** trocar por `centsTooltip`/`reaisTooltip`. No modo tempo eles devolvem "≈ 2 h (R$ 40,00)"; no modo dinheiro, exatamente o formatador de hoje. Outra saída é renderizar com `display.cents(...)` em JSX.

### L2 (LOW): a prévia do tema mostra o aviso e o alternador reais do modo tempo

**Onde:**
- `src/components/PersonalizationView.tsx:607-614` renderiza o `Header` real fora do `<ForceMoneyDisplay>` (648-660).
- O Header (`Header.tsx:38`, `364-375` e `516-531`) lê `useWorkTime()` direto. Ele não consulta o contexto de dinheiro forçado (`display.tsx:29-34`).

**Cenário:** com o modo tempo ativo, abrir Configurações → Personalização.
- A prévia usa valores fictícios em R$ (classe R-PV), mas exibe "Valores em tempo de trabalho equivalente: uma estimativa aproximada…" e o botão "Mostrar em R$".
- O relógio da prévia grava a preferência real.
- A página passa a ter dois `data-testid="work-time-notice"`.

**Impacto:**
- A prévia fica incoerente com a matriz (§2.12: "força BRL") e muda visualmente.
- Um locator de E2E futuro pode falhar no modo estrito por achar dois avisos.

**Correção mínima:**
1. Exportar de `display.tsx` um `useIsMoneyForced()`.
2. No Header, esconder o aviso e o alternador quando o dinheiro estiver forçado.
3. Envolver o Header da prévia em `<ForceMoneyDisplay>`.
4. Estender a guarda em `work-time-guard.test.ts:249`.

### L3 (LOW): sem conexão, a exclusão e a gravação prendem a tela

**Onde:**
- `src/components/WorkTimeSettingsView.tsx:114-135`: `await workTime.deletePreference()`.
- Linha 371: o `onClose` é ignorado enquanto `isDeleting` for verdadeiro.
- Linha 376: `isBusy`.
- `api.ts:61`: o `deleteDoc` só resolve com a confirmação do servidor, e o cache é só em memória.

**Cenário:** offline ou com rede instável, o usuário confirma "Excluir".
- A exclusão local já some com o botão e com o alternador.
- O modal fica aberto: "Excluir" desabilitado, e Cancelar, Esc e clique fora sem efeito, até a rede voltar.
- Se a página for recarregada offline, a exclusão pendente se perde e a renda continua no servidor.
- O "Salvar" fica em "Salvando..." da mesma forma.

**Impacto:** armadilha de UX, e a pessoa pode achar que a renda foi excluída. Não há vazamento.

**Correção mínima:** deixar fechar o modal durante a pendência, com um aviso como "a exclusão será concluída quando a conexão voltar". Outra saída é recusar com mensagem em pt-BR quando `navigator.onLine === false`.

### L4 (LOW): falsos negativos nas guardas e nos testes

- **BRL só por arquivo** (`tests/unit/work-time-guard.test.ts:200-205`). Os pontos R-* que ficam dentro dos 31 arquivos elegíveis podem passar a usar `display.*` sem reprovar nada:
  - `CashAccountsView.tsx:332`;
  - `CardInvoiceDetailsDrawer.tsx:378` e `:403`;
  - `ClientsReceivablesView.tsx:513`;
  - `ReportsOverview.tsx:309` e `:386`;
  - `RecurringExpenseDetailsView.tsx:762` e `:765`;
  - o principal em `LoanCard`.

  O E2E só confere o modal de transferência.
- **Import só estático** (`:46`). `importsWorkTime` só pega `from '…work-time/…'`. Escapam `import()`, barril de reexportação e um filho elegível renderizado por um arquivo BRL.
- **Curinga recursivo só por nome** (`:159-161`). A guarda procura `{path=**}` e `{document=**}`; um `match /{rest=**}` escaparia. A suíte de Rules no Emulator mitiga.
- **"Modo dinheiro idêntico" por regex** (`:252-258`). A asserção é uma regex sobre `display.tsx`, sem renderizar as telas.
- **Varredura do Firestore incompleta** (`e2e/work-time-p5f.spec.ts:424-434`). Ela só desce por documentos existentes, então subcoleções sob pai inexistente ficam de fora.

**Correção mínima:**
- asserções linha a linha para os R-* dos arquivos elegíveis, por exemplo `/Estornar a transferência de \{formatCents\(confirmation\.transfer\.amountCents\)\}/`;
- regex genérica `/match\s+\/\{\w+=\*\*\}/` com allowlist;
- detecção de `import(`.

### INFO

- **I1:** `firestore.rules:1165-1169` e `:1231`. A conta suspensa não lê nem apaga a própria preferência (o teste "suspensa apaga" confirma). Até o job de conta da P8, o titular suspenso não tem como eliminar a renda. Duas saídas:
  - registrar esse caso em PRIVACY_LGPD e DATA_RETENTION_LIFECYCLE;
  - permitir `delete` ao próprio uid em qualquer status (apagar o próprio documento não expõe nada).
- **I2:** `WorkTimeSettingsView.tsx:317`. O `aria-live="polite"` cobre o bloco inteiro e anuncia rótulo e valores a cada tecla. Basta limitá-lo à frase da prévia.
- **I3:** `form.ts:74-80`. Uma renda acima de uns R$ 90 trilhões cai em "Use o formato 3.500,00…" (o `MoneyError` do `parseBrlToCents`), em vez de "A renda máxima é…". Conferido com a função real. É só borda.
- **I4:** `docs/production/evidence/p5f/mutantes.md` cita `mutantes.py.txt`, `mutantes-guarda-anterior.py.txt` e `mutantes-rules.py.txt`, que não estavam no diretório no momento da revisão.

## 3. Verificado e considerado correto

### Rules e isolamento
- `firestore.rules:1165-1169`: só o titular, com conta ativa, e só o id `work_time_equivalent`.
- `firestore.rules:1171-1192`:
  - campos exatos (`hasOnly` + `hasAll`) e tipos;
  - limites iguais aos de `calculation.ts:24-30`;
  - hora de pelo menos R$ 0,01;
  - `updatedAt == request.time`.
- `firestore.rules:1230-1235`: `get`, `delete`, `create` e `update` como acima; `list` negado.
- As funções ficam no nível `databases/documents`, depois que o bloco `workspaces` fecha.
- O único curinga recursivo é o da linha 1262, dentro de `billing_accounts`. Não há regra de collection group.
- O `allow read` de `users/{userId}` (1201-1205) não alcança subcoleções.
- Nenhuma Function nem ferramenta referencia a coleção. Fora dos testes, não há `listCollections` nem `recursiveDelete` sobre `users`.
- Suíte de Rules: 10 cenários, cada limite isolado, inclusive o caso novo de R$ 0,99 com 1 h e o update correspondente.

### Privacidade
- O payload da IA leva só `workspaceId`, `question`, `range` e `idempotencyKey` (`src/modules/reports/api.ts:28-41`).
- Os logs levam só uma mensagem fixa e o código do erro: `WorkTimeContext.tsx:82-84`, `WorkTimeSettingsView.tsx:23-27`, `Header.tsx:41-48`.
- Não há analytics nem reporte global de erros.
- O Firestore usa o cache padrão, em memória (`src/lib/firebase.ts:38`).
- O módulo não usa `localStorage`, `sessionStorage`, IndexedDB nem React Query.
- `title` e sr-only levam só o valor convertido, nunca a renda.
- As evidências contêm só dados sintéticos.
- `cache-sdk.md` confere:
  - `LruGcMemoryOfflineComponentProvider` está em `@firebase/firestore` 4.10.0 (firebase 12.8.0);
  - logout e troca de conta limpam o React Query (`AuthContext.tsx:75,111`).

### Integridade financeira
- `calculation.ts`:
  - `:87-88`: o meio arredonda para cima sobre o módulo, o que dá "meio para longe de zero";
  - `:96-109`: zero; menos de 1 minuto; negativo espelhado; teto em `MAX_SAFE`; valor inválido vira `unavailable`;
  - `:61-71`: limites e piso da hora;
  - `:115-121`: valor por hora;
  - `:129-134`: volta de reais a centavos exata até 10¹⁵ centavos (erro máximo de uns 0,22 centavo);
  - `:151-161`: espaço inseparável, "≈" e sinal.
- A conversão só aparece em JSX e formatadores. Nenhum valor convertido vai para estado, filtro, ordenação, soma, exportação, callable ou dado de gráfico.
- `FinancialKPI.cents` (`reports/types.ts:129-133`; `adapter.ts:173`) é valor em centavos, não tempo.
- Unidades dos formatadores conferidas:
  - SplitGroupCharts: dados ÷ 100, com tooltip em reais;
  - AllocationPanels e SimpleInvestmentsView: centavos;
  - Relatórios: `centsToDisplay`;
  - GoalDetailsView: centavos só em meta que não é de margem.
- Ficam em BRL:
  - limites do cartão (`ReportsOverview.tsx:309,386`);
  - utilização em % (`ReportsChartsView.tsx:624`);
  - confirmações de cartão, recebível e transferência (`CardInvoiceDetailsDrawer.tsx:378,403`; `ClientsReceivablesView.tsx:513`; `CashAccountsView.tsx:332`).
- Nenhum arquivo BRL-obrigatório importa componente elegível.

### Sessão
- `WorkTimeContext.tsx:68`: o uid só entra depois do bootstrap; `isAccountReady` é marcado por uid (`WorkspaceContext.tsx:235`).
- `:72-88`: um listener por uid, cancelado na troca de conta.
- `:91-93`: estado de outro uid nunca é exposto.
- `:81-86`: falha de leitura cai em dinheiro.
- `:99-104`: a configuração só existe no modo tempo.
- O `AuthGuard` desmonta o app no logout (`App.tsx:650-655`).
- `WorkTimeSettingsView.tsx:59-64`, `:97-111` e `:116-134`: o formulário é zerado na troca de dono, e respostas atrasadas de outra conta são ignoradas.

### UI, acessibilidade e pt-BR
- O switch tem `role`, `aria-checked`, `aria-labelledby` e `aria-describedby` (`WorkTimeSettingsView.tsx:193-206`).
- Os erros têm `aria-invalid`, `aria-describedby` e levam o foco ao campo.
- Estados de carregamento, erro e preferência inválida existem.
- O modal de exclusão gerencia o foco (`ConfirmationModal.tsx:59-92`; `WorkTimeSettingsView.tsx:369-379`).
- O Header tem `aria-pressed` com nome fixo (364-375), e o aviso tem "Mostrar em R$" (516-528).
- Os exemplos numéricos conferem: R$ 482,35 dá 24 h 7 min, e 40 h por semana dão 173 h 20 min.
- O modo dinheiro fica idêntico:
  - toda chamada convertida passa o formatador original, ou uma função que devolve o mesmo texto;
  - `formatter={undefined}` equivale a omitir a prop no recharts 2.12.7;
  - `Number(value)` nos tooltips não muda valores numéricos.

### Testes e regressão
- `tsc --noEmit` passa, inclusive depois das edições de hoje.
- 825/825 testes unitários puros passam; 32/32 do work-time.
- Nenhum teste existente foi alterado. Não há `skip` nem `only`, e os timeouts do E2E seguem o padrão das outras specs.
- O padrão de `openInvoiceCreditNote` continua cobrindo `cards-model.test.ts`.

### Docs
- Limites e referências de linha conferem em DATA_MODEL, SECURITY_MODEL ("10 cenários") e ARCHITECTURE.
- PRIVACY_LGPD também confere.
- DATA_RETENTION_LIFECYCLE separa CURRENT de TARGET.
