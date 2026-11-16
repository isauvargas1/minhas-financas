#!/usr/bin/env bash
# Árvore final (18:35): backend com as correções do A01 (rebuild.ts, reproduzida por 'publicacao') e do A03
# (periods.ts), e o cliente REAL com a defesa do A02 (projectionProof.ts). Sem o embrulho 'cliente' do modelo.
set -u
cd <scratchpad>/p5f1r3/revisoes/arquitetura
export NODE_PATH=<scratchpad>/wt-p5f1-r3/functions/node_modules
for model in modelo-aleatorio modelo-aleatorio-duas; do
  for args in "20000 0 31" "20000 50 33 publicacao" "20000 50 35"; do
    out="final-${model}-$(echo $args | tr ' ' '_').log"
    node $model.cjs $args > "$out" 2>&1
    echo "== $model $args: $(grep -o '"violacoes": [0-9]*' "$out") $(grep -o '"cenariosComViolacao": [0-9]*' "$out") $(grep -o '"provas": [0-9]*' "$out")"
  done
done
echo FIM
