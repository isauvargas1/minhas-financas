#!/usr/bin/env bash
#
# Ensaio de rollout: SUBSTITUÍDO pela produção única (D-19, 2026-11-17; P6-A).
#
# Não existe mais projeto de STAGING online. Este script não fala com nenhum projeto remoto: ele roda só o gate local
# (Emulator e dados sintéticos) e recusa todo passo que antes publicava índices, Rules ou Functions num projeto
# informado por variável de ambiente. Esse caminho somava um segundo `--project` a scripts que já fixavam a
# produção (PR-PLAT-01).
#
# Uso:
#   ./tools/staging/rehearsal.sh gate     # o ensaio local: verify:fast, integração no Emulator e E2E
#
# A publicação na produção é feita só por `npm run deploy:* -- --project <id> --confirmar <id>`, com a liberação G0
# registrada no contrato (tools/deploy/publicar.mjs). O roteiro está no RUNBOOKS.md, "Primeira publicação controlada".

set -euo pipefail

fatal() { printf '\n[FALHA] %s\n' "$1" >&2; exit 1; }

ALVO="${1:-}"
[ -z "${PROJETO:-}" ] || fatal "PROJETO não é mais aceito: não há STAGING online (D-19). Nada foi executado."

case "$ALVO" in
  gate)
    printf '\n=== Gate local (Emulator, dados sintéticos; nada toca projeto remoto) ===\n'
    npm run verify:fast
    npm run test:integration:emulator
    npm run test:e2e
    ;;
  "")
    fatal "Informe o passo. Só 'gate' existe: o ensaio é local. A publicação passa pelo guard (npm run deploy:*)."
    ;;
  *)
    fatal "O passo '$ALVO' publicava num projeto de STAGING, que não existe mais (D-19). Use o roteiro de publicação controlada do RUNBOOKS.md."
    ;;
esac
