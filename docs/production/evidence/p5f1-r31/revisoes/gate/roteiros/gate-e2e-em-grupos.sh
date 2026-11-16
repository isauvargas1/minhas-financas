#!/usr/bin/env bash
# P5-F.1-R3.1, mitigação do RR-R3-11: a etapa E2E do verify:all em três grupos de arquivos, cada um com o próprio
# Emulator (o webServer do Playwright sobe e desce a cada execução), para a memória do emulador de Functions não
# acumular a suíte inteira. Os mesmos arquivos, a mesma configuração, o mesmo build E2E; juntos, os 216 testes.
set -u
S=<scratchpad>
R=$S/p5f1r31; L=$R/logs; WT=$S/wt-p5f1-r31
STOP=$L/gate-e2e-grupos-memoria.stop
echo "inicio=$(date -u +%FT%TZ) arvore=$(bash $R/tree-now.sh)" > "$L/gate-e2e-grupos.meta"
bash $R/amostrar-memoria.sh "$L/gate-e2e-grupos-memoria.txt" "$STOP" 10 10800 &
SAMPLER=$!
cd "$WT" && npm run build:e2e > "$L/gate-e2e-grupos-build.log" 2>&1; echo "build=$?" >> "$L/gate-e2e-grupos.meta"
G1="e2e/ai-chat-isolation.spec.ts e2e/ai-consent-extraction.spec.ts e2e/app-smoke.spec.ts e2e/authenticated-smoke.spec.ts e2e/billing-bootstrap.spec.ts e2e/billing-checkout-portal.spec.ts e2e/cash-accounts.spec.ts e2e/cash-manual-entries.spec.ts e2e/cash-pending-entries.spec.ts e2e/clients-receivables.spec.ts e2e/credit-card-flow.spec.ts e2e/financial-reports.spec.ts e2e/goal-contributions.spec.ts e2e/goal-investments.spec.ts e2e/goals-investment-options.spec.ts"
G2="e2e/goals-p5b.spec.ts e2e/investment-operations.spec.ts e2e/investments-accounts.spec.ts e2e/investments-simple.spec.ts e2e/investments-v2.spec.ts e2e/loans-pf.spec.ts e2e/loans-pj.spec.ts e2e/notifications-exit-race.spec.ts e2e/notifications-mobile-p5e11.spec.ts"
G3="e2e/notifications-p5d2.spec.ts e2e/notifications-private-state.spec.ts e2e/notifications-retention-d18.spec.ts e2e/recurring-flow.spec.ts e2e/regression-smoke.spec.ts e2e/settings-catalog.spec.ts e2e/split-flow.spec.ts e2e/ux-navigation-a11y.spec.ts e2e/work-time-b03.spec.ts e2e/work-time-p5f.spec.ts e2e/workspace-membership.spec.ts e2e/workspace-pagination.spec.ts"
CODE=0
for g in 1 2 3; do
  eval "FILES=\$G$g"
  # shellcheck disable=SC2086
  SKIP_BUILD=1 bash $R/run-pw.sh "gate-e2e-grupo-$g" dejavu $FILES --trace off > "$L/gate-e2e-grupo-$g.resumo.txt" 2>&1 || true
  grep -q "^exit=0" "$L/gate-e2e-grupo-$g.resumo.txt" || CODE=1
  echo "grupo $g: $(grep -E '^exit=' "$L/gate-e2e-grupo-$g.resumo.txt") $(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$L/gate-e2e-grupo-$g.log" | grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky)' | tr -s ' ' | tr '\n' ' ')" >> "$L/gate-e2e-grupos.meta"
done
touch "$STOP"; wait $SAMPLER
echo "fim=$(date -u +%FT%TZ) exit=$CODE $(tail -1 "$L/gate-e2e-grupos-memoria.txt")" >> "$L/gate-e2e-grupos.meta"
cat "$L/gate-e2e-grupos.meta"
exit $CODE
