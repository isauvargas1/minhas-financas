# Runbook — backfill da projeção mensal de caixa

Procedimento executável em **STAGING** para reconstruir `cash_report_periods`
em workspaces cujo histórico é anterior à projeção.

Não executar contra produção antes de o ensaio fechar.

---

## 1. Por que existe

O saldo de caixa acumulado é um agregado global: não se pagina. Antes ele era
obtido somando a subcoleção inteira de transações a cada carga do aplicativo.
A projeção `cash_report_periods` substitui essa varredura por um documento por
mês, mantido por delta pelo gatilho de escrita de transações.

Como todo acumulador mantido por delta, ela tem duas dívidas:

1. workspaces anteriores ao gatilho começam **sem** a projeção — e o progresso
   das metas PJ do tipo `caixa_minimo` sairia zerado;
2. um acumulador sem caminho de reconstrução é um número que ninguém consegue
   conferir.

`rebuildCashPeriods` resolve as duas: recalcula do próprio ledger e publica
**valores absolutos**.

---

## 2. Propriedades, e como cada uma é verificável

| Propriedade | Como é garantida | Onde é provada |
| ----------- | ---------------- | -------------- |
| **Idempotência** | Publica valor absoluto recalculado do ledger, nunca incremento. Reexecutar converge para o mesmo número. | `cash/__tests__/periods.integration.test.ts` — reconstrução idêntica ao incremental |
| **Checkpoint** | Documento `cash_report_periods/cash_periods_rebuild` com cursor, contagem e acumulado parcial. | idem |
| **Retomada** | Cada chamada lê o checkpoint e continua do cursor; a resposta traz `completed: false` enquanto houver página. | idem |
| **Isolamento por workspace** | `requireWorkspaceRole(owner, admin)` e todo caminho sob `workspaces/{id}`. Nenhum `workspaceId` de payload cru. | matriz de papéis; suítes de Rules |
| **Simulação (dry-run)** | `dryRun: true` percorre tudo e devolve a conferência **sem publicar**, com checkpoint separado do real. | `periods.integration.test.ts` |
| **Reconciliação** | O resultado traz `reconciliation` com receita, despesa, saída para investimento, líquido, contagem de transações e de períodos. | idem |
| **Concorrência** | Limite de frequência por ator e workspace (100/h). O checkpoint é um único documento por workspace: duas execuções convergem porque cada página parte do estado lido. | `shared/__tests__/rateLimit.integration.test.ts` |
| **Custo** | Uma leitura por transação, uma vez, em páginas de 300. Escrita: um documento por mês. Teto de 600 períodos com erro nomeado. | `cash/rebuild.ts` |

**Limite explícito:** acima de 600 períodos mensais (50 anos) a reconstrução
falha por inteiro, com mensagem em pt-BR, e **nada é truncado**.

---

## 3. Procedimento

### Passo 0 — anotar o saldo atual

Antes de tocar em qualquer coisa, registrar o saldo que o workspace exibe hoje.
É contra esse número que a simulação será conferida.

### Passo 1 — simular

Área operacional (Configurações › Cadastros › Operação do domínio patrimonial),
como proprietário ou administrador do workspace, com motivo obrigatório.

A simulação percorre o ledger inteiro e devolve:

```
reconciliation: {
  incomeCents, expenseCents, investmentOutflowCents,
  netCents, transactionCount, periodCount
}
```

**Critério de aceitação:** `netCents / 100` bate com o saldo do passo 0, na
casa do centavo. Se não bater, **parar**: a divergência é a informação, e
aplicar por cima a esconde.

### Passo 2 — aplicar

Mesma tela, ação **Reconstruir o fluxo de caixa mensal**. A tela repagina até
concluir e mostra o progresso.

### Passo 3 — reconciliar

O resultado da aplicação traz o mesmo bloco `reconciliation`. Conferir contra
o passo 1: os dois precisam ser idênticos — a simulação e a aplicação leem o
mesmo ledger.

### Passo 4 — conferir na tela

- O saldo exibido não mudou (a projeção substitui a varredura, não o valor).
- Metas PJ `caixa_minimo` mostram progresso, não zero.
- Nenhuma meta exibe "saldo incompleto".

---

## 4. Ordem em relação ao rollout

O backfill vem **antes** de habilitar o domínio patrimonial. Ligar a flag antes
deixa a meta de caixa mínimo com progresso zerado até a reconstrução — não é
perda de dado, mas é número errado na tela do usuário.

---

## 5. Se algo sair errado

| Sintoma | Causa provável | Ação |
| ------- | -------------- | ---- |
| Simulação não bate com o saldo | Transação sem `date` válido, ou com `date` fora do contrato `YYYY-MM-DD` | Identificar as linhas; `cashPeriodKeyFor` ignora o que não consegue datar. Corrigir o cadastro antes de aplicar. |
| "excedeu 600 períodos mensais" | Histórico além do teto, ou documento espúrio na coleção | Nada foi truncado nem publicado. Investigar a coleção antes de insistir. |
| A operação não conclui em 500 páginas | Cursor não avança | Não repetir. Conferir o checkpoint `cash_periods_rebuild` antes de tentar de novo. |
| Limite de frequência | Mais de 100 execuções na hora | Aguardar a janela. |

**Rollback:** não há estado a desfazer. A projeção é derivada; reexecutar
publica de novo o valor absoluto calculado do ledger, que é a fonte de verdade
e não é tocada pela rotina.

---

## 6. Custo estimado

Por workspace, por execução completa:

- **Leituras:** uma por transação (páginas de 300) + uma leitura da coleção de
  períodos na última página.
- **Escritas:** um documento por mês com movimento, mais um checkpoint por
  página intermediária.
- **Ordem de grandeza:** 20.000 transações e 5 anos de histórico ⇒ ~20.000
  leituras e ~60 escritas, uma vez. O gatilho de delta mantém a projeção
  depois disso, sem varredura nova.
