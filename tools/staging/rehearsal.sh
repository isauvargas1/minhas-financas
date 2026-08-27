#!/usr/bin/env bash
#
# Ensaio de rollout em STAGING.
#
# Executa a sequência do runbook contra um projeto Firebase de teste e para no
# primeiro passo que falhar. Não executa nada em produção: exige que o projeto
# alvo seja informado explicitamente e recusa o projeto padrão do repositório.
#
# Uso:
#   PROJETO=<projeto-de-staging> ./tools/staging/rehearsal.sh [passo]
#
# Sem argumento, roda a sequência inteira. Com argumento, roda só o passo
# nomeado — útil para retomar depois de corrigir uma falha.
#
# Os passos que dependem de interface (backfill de caixa, operações do domínio
# patrimonial, reconstruções) são executados pela área operacional do produto e
# aparecem aqui como PAUSA com o critério de aceitação.

set -euo pipefail

PROJETO="${PROJETO:-}"
PROJETO_PRODUCAO="sistema-financeiro-pesso-20698"
REGIAO="southamerica-east1"

fatal() { printf '\n[FALHA] %s\n' "$1" >&2; exit 1; }
passo()  { printf '\n=== %s ===\n' "$1"; }
pausa()  {
  printf '\n[PAUSA MANUAL] %s\n' "$1"
  printf 'Critério de aceitação: %s\n' "$2"
  printf 'Pressione ENTER quando o critério estiver atendido, Ctrl+C para abortar.\n'
  read -r _
}

[ -n "$PROJETO" ] || fatal "Defina PROJETO com o projeto de staging."
[ "$PROJETO" != "$PROJETO_PRODUCAO" ] || \
  fatal "PROJETO aponta para produção ($PROJETO_PRODUCAO). Abortado."

case "$PROJETO" in
  *stag*|*homolog*|*dev*|*test*) : ;;
  *) fatal "O nome de '$PROJETO' não identifica um ambiente de teste. Abortado por segurança." ;;
esac

ALVO="${1:-tudo}"
roda() { [ "$ALVO" = "tudo" ] || [ "$ALVO" = "$1" ]; }

# --------------------------------------------------------------------------
roda gate && {
  passo "0. Gate local (nada toca o projeto)"
  npm run verify:fast
  npm run test:integration:emulator
  npm run test:e2e
}

roda indices && {
  passo "1. Índices"
  firebase deploy --only firestore:indexes --project "$PROJETO"
  printf 'Aguardando READY. Conferir com:\n'
  printf '  firebase firestore:indexes --project %s\n' "$PROJETO"
  pausa "Aguarde todos os índices ficarem READY." \
        "nenhum índice em estado CREATING"
}

roda rules && {
  passo "2. Rules"
  npm run deploy:firestore -- --project "$PROJETO"
}

roda functions && {
  passo "3. Functions"
  npm run deploy:functions -- --project "$PROJETO"
  firebase functions:list --project "$PROJETO"
  pausa "Confira que as 53 funções aparecem em $REGIAO." \
        "nenhuma função do codebase fora de $REGIAO"
}

roda schedulers && {
  passo "4. Rotinas agendadas"
  printf 'Jobs esperados: processRecurring (02:00), processInvestmentDriftScan (06:00),\n'
  printf 'processCreditCardInvoiceOperationalAlerts (07:00), todos America/Sao_Paulo.\n'
  printf 'Listar:\n  gcloud scheduler jobs list --location=%s --project=%s\n' "$REGIAO" "$PROJETO"
  printf 'Forçar execução imediata de cada um:\n'
  printf '  gcloud scheduler jobs run processRecurring --location=%s --project=%s\n' "$REGIAO" "$PROJETO"
  pausa "Dispare os três jobs e confira os logs." \
        "cada job executa sem erro e o log traz as contagens (recurring_processed)"
}

roda dados && {
  passo "5. Massa de teste"
  printf 'Criar pela interface, com contas de teste:\n'
  printf '  - um workspace PF e um workspace PJ;\n'
  printf '  - em cada um, histórico legado de investimento;\n'
  printf '  - uma meta com aportes vinculados.\n'
  pausa "Massa criada nos dois perfis." "dois workspaces com histórico legado"
}

roda backfill && {
  passo "6. Backfill da projeção de caixa"
  printf 'Ver CASH_BACKFILL_RUNBOOK.md. Simular, conferir, aplicar, reconciliar.\n'
  pausa "Backfill concluído nos dois workspaces." \
        "reconciliation.netCents/100 igual ao saldo anotado antes"
}

roda operacoes && {
  passo "7. Operações financeiras"
  printf 'Pela interface, no workspace com a flag ligada:\n'
  printf '  aporte, resgate parcial com prejuízo, valoração, vínculo de meta.\n'
  pausa "Operações executadas." \
        "patrimônio, alocação e relatório refletem cada operação"
}

roda reconstrucoes && {
  passo "8. Reconstruções pela superfície"
  printf 'Área operacional, uma a uma, conferindo o resultado exibido:\n'
  printf '  - Reconstruir projeções\n'
  printf '  - Recalcular posições e metas\n'
  printf '  - Reconstruir o fluxo de caixa mensal\n'
  printf '  - Recalcular o progresso patrimonial de uma meta\n'
  pausa "As quatro concluem." \
        "cada uma exibe 'concluída com sucesso' e os totais não mudam"
}

roda isolamento && {
  passo "9. Isolamento entre tenants"
  printf 'Com a conta do workspace A, tentar ler e escrever no workspace B.\n'
  pausa "Tentativas recusadas." "toda leitura e escrita cruzada é negada"
}

roda stripe && {
  passo "10. Webhook do Stripe"
  printf 'URL: https://%s-%s.cloudfunctions.net/stripeWebhook\n' "$REGIAO" "$PROJETO"
  printf '  stripe listen --forward-to https://%s-%s.cloudfunctions.net/stripeWebhook\n' "$REGIAO" "$PROJETO"
  printf '  stripe trigger checkout.session.completed\n'
  pausa "Evento assinado entregue com 200." \
        "plano concedido só para preço da allowlist; preço fora dela é recusado"
}

roda ttl && {
  passo "11. TTL"
  printf 'Ver TTL_MANIFEST.md. Ativar as seis coleções e conferir:\n'
  printf '  gcloud firestore fields ttls list --project=%s\n' "$PROJETO"
  pausa "Seis coleções ACTIVE, nenhuma além delas." \
        "investment_operation_leases NÃO está na lista"
}

printf '\n=== Ensaio concluído até o passo solicitado ===\n'
