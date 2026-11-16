# Revisão independente da P5-F (REQ-FUT-01): revisão 3 (curta)

Base `1730a1df`. Li o worktree até 2026-10-19 12:33 UTC, só lendo código. Como o `verify:all` estava rodando, não rodei testes, `tsc`, Emulator nem Playwright. Nada no worktree foi alterado.

## 1. Veredito

As correções resolvem M1-R, a borda do M2, L-NOVO e I4, e a leitura do código não mostrou regressão. Restam só observações INFO: a matriz não acompanhou as duas últimas mudanças, e há detalhes de teste. Nada bloqueia o fechamento do ponto de vista desta revisão; a confirmação de execução fica com o `verify:all` em andamento.

## 2. Achados

**Nenhum BLOCKER, HIGH, MEDIUM ou LOW novo.**

### INFO

- **I5: a matriz não acompanhou as duas últimas mudanças.** `docs/production/evidence/p5f/matriz-cobertura.md` é das 12:08, anterior a elas.
  - **Linha 165** ("Detalhes da conta: valor total", T, "Informativo"): não diz que a anulação da despesa dividida confirma com o valor em reais no modo tempo. Também falta uma linha R-CF análoga à da anulação de lançamento (linha 50), e o total "Em BRL" (128) não conta esse ponto.
  - **Linha 64:** cita só a largura de 80 px, não a margem esquerda 0 no modo tempo nos gráficos de patrimônio e fluxo de caixa.
  - **Correção:** atualizar as duas linhas e os totais.
- **I6: a guarda linha a linha tem 19 entradas, não 20** (`tests/unit/work-time-guard.test.ts:248-266`). Todas as expressões existem no código; conferi cada uma com `grep -F`. As sete novas (260-266) só verificam presença, sem `converted`. Se alguém converter a mesma expressão em outro ponto sem apagar a original, a guarda não pega. É aceitável; registro para referência.
- **I7: limite do `carriesIncome`** (`e2e/work-time-p5f.spec.ts:460-468`). Ele detecta a renda como número igual aos centavos (440000) ou como texto com "4.400,00" ou "440000". Uma cópia em reais (4400) ou em texto sem separador escaparia; a varredura anterior tinha o mesmo limite. Ignorar carimbos de tempo está certo: elimina o falso positivo de `_nanoseconds`.

## 3. Verificado nesta passada

### M1-R
- `SplitBillDetailsModal.tsx:164-166`: "A despesa de ${formatSplitCents(bill.amountCents)} continua no histórico…" aparece só com `display.isTime`.
- No modo dinheiro, a string é idêntica à da base, seguida das mesmas frases de Caixa e cartão (167-168). O comentário JSX não renderiza nada.
- `formatSplitCents` é o `formatCents` de `loans/money.ts`, que não lança.

### Borda do M2
- Só no modo tempo, a margem esquerda vai a 0: `ReportsChartsView.tsx:201` (`left: display.isTime ? 0 : -10`) e `:225` (`… : -20`).
- Isso se soma a `width={display.isTime ? AXIS_WIDTH_IN_TIME_MODE : undefined}` nos 5 eixos (204, 248, 487, 676, 723).
- No modo dinheiro ficam −10, −20 e 60 px: `undefined` cai no `defaultProps` do recharts 2.12.7 com React 18.2.
- Com cerca de 72 px visíveis, cabem "-≈ 1.234 h" e "-≈ 12.345 h".
- A evidência `visual/composicoes/eixo-modo-tempo-antes-e-depois-da-correcao.png` confirma o efeito: antes, "120 h" e ": 90 h" saíam cortados; depois, "≈ 120 h", "≈ 90 h" e "≈ 60 h" aparecem inteiros.

### Guarda
- As 19 entradas de `BRL_POINTS_IN_ELIGIBLE_FILES` existem no código:
  - anulação da despesa dividida: `SplitBillDetailsModal.tsx:165`;
  - valor original e confirmação de cancelamento do recebível: `ClientsReceivablesView.tsx:327` e `:513`;
  - principal: `LoanCard.tsx:66`;
  - reajustes: `RecurringExpenseDetailsView.tsx:762` e `:765`;
  - pagamentos da fatura: `CardInvoiceDetailsDrawer.tsx:313`.
- Há asserções das duas margens (283-285) e das 5 larguras.

### E2E
**Teste 3, recusa offline** (`e2e/work-time-p5f.spec.ts:344-356`):
- `setOffline(true)`.
- Salvar mostra "Sem conexão com a internet. Conecte-se e tente de novo." e o botão continua habilitado.
- Excluir fecha o modal com a mesma mensagem.
- Depois de voltar a rede, o documento no servidor não mudou.
- O `expect.timeout` de 12 s (`playwright.config.ts:42`) cobre a reconexão antes da exclusão real.

**Teste 4, varredura** (438-451):
- usa `listDocuments()` mais `carriesIncome`, que compara valores folha e ignora objetos com `toMillis`;
- o teste por nome de campo sobre o JSON continua.
- Nenhuma coleção grava `DocumentReference`, então não há risco de recursão cíclica.

### L-NOVO
- `git status --short -- e2e` mostra só `?? e2e/work-time-p5f.spec.ts`, e não há arquivo de evidência em `e2e/`.
- Os roteiros estão versionados como `.txt` em `docs/production/evidence/p5f/visual/`.

### I4 e evidências
- `mutantes.py.txt`, `mutantes-guarda-anterior.py.txt` e `mutantes-rules.py.txt` estão no diretório de evidência, junto com `run-*.sh.txt` e `resumo-verify.py.txt`.
- Usam `<scratchpad>` no lugar do caminho da sessão: nenhum caminho temporário da sessão nem da pasta pessoal.
- Não citam o projeto de produção nem segredos; o Emulator roda só em `minhas-financas-local`.
- As 119 capturas (8,5 MB) usam dados sintéticos (R$ 4.400,00 por 176 h, "Olá, Usuário"); conferi duas. Isso segue o precedente dos milestones anteriores, que já têm cerca de 91 MB de PNG versionados.

### Escopo
Desde a revisão 2 mudaram só:
- `SplitBillDetailsModal.tsx`;
- `ReportsChartsView.tsx`;
- `work-time-guard.test.ts`;
- `e2e/work-time-p5f.spec.ts`;
- os `.txt` e as capturas de evidência.

O plano mestre também mudou, mas não entra nesta revisão.
