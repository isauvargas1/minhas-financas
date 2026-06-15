# Fase 10 — Segurança, governança e hardening multiworkspace

## Status

Documentada como consolidação das regras de segurança, RBAC, idempotência, auditoria e governança operacional do domínio de cartão.

## Objetivo

Garantir que o domínio de cartão opere como backend financeiro seguro, multiworkspace e auditável, sem depender de regras críticas no frontend.

## Princípios aplicados

- toda operação financeira crítica passa por Cloud Functions;
- o frontend não escreve diretamente nas coleções oficiais do domínio de cartão;
- `workspaceId` é obrigatório em todas as operações;
- autenticação e associação ao workspace são obrigatórias;
- operações críticas exigem papel adequado;
- operações com efeito financeiro exigem `idempotencyKey`;
- eventos financeiros, auditoria e métricas são persistidos no backend;
- replay incompatível é bloqueado.

## Matriz de permissões por operação

| Operação backend | Owner | Admin | Member | Viewer | System | Observação |
|---|---:|---:|---:|---:|---:|---|
| `createCreditCardPurchase` | sim | sim | sim | não | não | cria compra, parcelas, faturas, ledger e evento |
| `updateCreditCardPurchase` | sim | sim | sim | não | não | edita compra aberta e recompõe domínio |
| `cancelCreditCardPurchase` | sim | sim | não | não | não | operação crítica |
| `closeCreditCardInvoice` | sim | sim | não | não | sim | fechamento não baixa caixa |
| `reopenCreditCardInvoice` | sim | sim | não | não | não | reabertura restrita |
| `registerCreditCardInvoicePayment` | sim | sim | não | não | não | baixa caixa e recompõe limite |
| `reverseCreditCardInvoicePayment` | sim | sim | não | não | não | estorna caixa e limite |
| `recalculateCardLimit` | sim | sim | não | não | sim | recalcula snapshot a partir do ledger |
| `rebuildCardInvoicesForCard` | sim | sim | não | não | sim | reconstrução administrativa |
| `migrateLegacyInstallmentsToInvoiceDomain` | sim | sim | não | não | não | dispensada no rollout inicial sem dados reais |

## Matriz de coleções do domínio de cartão

| Coleção | Tipo | Leitura cliente | Escrita cliente | Escrita backend | Finalidade |
|---|---|---:|---:|---:|---|
| `credit_cards` | operacional | membros do workspace | owner/admin | sim | cadastro dos cartões |
| `credit_card_purchases` | domínio | membros do workspace | não | sim | compras oficiais no cartão |
| `credit_card_installments` | domínio | membros do workspace | não | sim | parcelas oficiais |
| `credit_card_invoices` | domínio | membros do workspace | não | sim | faturas oficiais |
| `credit_card_invoice_payments` | domínio | membros do workspace | não | sim | pagamentos de fatura |
| `card_limit_ledger` | razão financeiro | membros do workspace | não | sim | consumo e recomposição de limite |
| `card_limit_snapshots` | snapshot | membros do workspace | não | sim | posição atual do limite |
| `financial_events` | evento | membros do workspace | não | sim | eventos financeiros do domínio |
| `invoice_views` | projeção | membros do workspace | não | sim | compatibilidade com UI e relatórios |
| `credit_card_audit_logs` | governança | owner/admin | não | sim | auditoria operacional |
| `credit_card_operational_metrics` | observabilidade | owner/admin | não | sim | métricas operacionais |
| `credit_card_idempotency_keys` | segurança | não | não | sim | replay e idempotência |

## Regras de escrita

O cliente pode cadastrar e editar `credit_cards` conforme as regras Firestore.

As coleções financeiras oficiais do domínio são escritas exclusivamente pelo backend.

Isso inclui:

- compras;
- parcelas;
- faturas;
- pagamentos;
- ledger;
- snapshots;
- eventos;
- projeções;
- auditoria;
- métricas;
- chaves de idempotência.

## Idempotência

Operações críticas exigem `idempotencyKey`.

A mesma chave com o mesmo payload deve retornar replay sem duplicar efeitos financeiros.

A mesma chave com payload incompatível deve ser bloqueada.

## Auditoria e observabilidade

As operações do domínio devem registrar, quando aplicável:

- `financial_events`;
- `credit_card_audit_logs`;
- `credit_card_operational_metrics`;
- notificações derivadas de eventos relevantes.

## Emuladores e testes

Firestore Emulator é obrigatório para testes de integração.

Terminal 1:

```bash
npm run emulators:firestore