#!/usr/bin/env bash
R=<scratchpad>/p5f1r31/revisoes/adversarial
for m in M1-ignora-sincronizacao M2-ignora-prova M3-prazo-aprova M4-espera-so-sem-prova M5-retencao-sem-identidade M6-retencao-com-aviso M7-atual-sem-prova-com-aviso M8-espera-nao-zera; do
  d="$R/mutantes/$m"
  ( cd "$d" && timeout 600 node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/work-time-consistency.test.ts tests/unit/work-time-income-estimate.test.ts tests/unit/work-time-guard.test.ts > "$R/logs/mutante-$m.log" 2>&1 )
  echo "$m exit=$? $(grep -E '^# (pass|fail)' "$R/logs/mutante-$m.log" | tr '\n' ' ')" >> "$R/logs/mutantes-resumo.txt"
done
echo FIM >> "$R/logs/mutantes-resumo.txt"
