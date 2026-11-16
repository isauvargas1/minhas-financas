#!/usr/bin/env bash
# Roda o modelo aleatório (funções reais, Firestore em memória) nas variantes do parecer.
set -u
cd <scratchpad>/p5f1r3/revisoes/arquitetura
export NODE_PATH=<scratchpad>/wt-p5f1-r3/functions/node_modules
for model in modelo-aleatorio modelo-aleatorio-duas; do
  for args in "20000 0 11" "20000 8 12" "20000 50 13" "20000 50 13 publicacao" "20000 50 13 cliente" "20000 50 13 ambas"; do
    out="resultado-${model}-$(echo $args | tr ' ' '_').log"
    node $model.cjs $args > "$out" 2>&1
    echo "== $model $args: $(grep -o '"violacoes": [0-9]*' "$out") $(grep -o '"cenariosComViolacao": [0-9]*' "$out")"
  done
done
