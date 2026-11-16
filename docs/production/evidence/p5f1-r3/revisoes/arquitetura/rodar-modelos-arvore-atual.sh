#!/usr/bin/env bash
# Reexecução na árvore atual (periods.ts 18:30 com a correção do A03; rebuild.ts 18:25 com a do A01, que o
# mundo reproduz pela opção 'publicacao').
set -u
cd <scratchpad>/p5f1r3/revisoes/arquitetura
export NODE_PATH=<scratchpad>/wt-p5f1-r3/functions/node_modules
for model in modelo-aleatorio modelo-aleatorio-duas; do
  for args in "20000 0 21" "20000 50 23 publicacao"; do
    out="atual-${model}-$(echo $args | tr ' ' '_').log"
    node $model.cjs $args > "$out" 2>&1
    echo "== $model $args: $(grep -o '"violacoes": [0-9]*' "$out") $(grep -o '"cenariosComViolacao": [0-9]*' "$out") $(grep -o '"provas": [0-9]*' "$out")"
  done
done
