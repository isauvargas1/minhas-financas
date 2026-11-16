#!/usr/bin/env bash
# Rodada 2: árvore final congelada (poda no gatilho), funções reais em build/, sombra das componentes vivas.
set -u
cd <scratchpad>/p5f1r3/revisoes/arquitetura
export NODE_PATH=<scratchpad>/wt-p5f1-r3/functions/node_modules
for model in modelo-r2 modelo-r2-duas; do
  for args in "20000 0 51 publicacao" "20000 8 52 publicacao" "20000 50 53 publicacao"; do
    out="r2-${model}-$(echo $args | tr ' ' '_').log"
    nice -n 15 node $model.cjs $args > "$out" 2>&1
    echo "== $model $args: $(tr -d '\n ' < "$out" | grep -o '"perdasDePoda":[0-9]*,"cenarios":[0-9]*' ) $(tr -d '\n ' < "$out" | grep -o '"violacoes":[0-9]*,"cenariosComViolacao":[0-9]*,"provas":[0-9]*,"publicacoes":[0-9]*,"recomecos":[0-9]*') $(tr -d '\n ' < "$out" | grep -o '"finalSemProvaSemExclusaoFisica":{[^}]*}')"
  done
done
echo FIM
