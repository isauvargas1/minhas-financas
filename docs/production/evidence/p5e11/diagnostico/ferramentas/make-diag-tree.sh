#!/usr/bin/env bash
# Uso: make-diag-tree.sh <árvore-git> <destino> — extrai a árvore (git archive), troca SÓ as portas do Emulator
# (8080→8280, 9099→9299, 5001→5201, 9150→9350; UI desligada; hub 4420; logging 4520) e liga node_modules por symlink.
set -eu
T=$1; D=$2
rm -rf "$D" && mkdir -p "$D"
cd /home/user/minhas-financas && git archive "$T" | tar -x -C "$D"
ln -s /home/user/minhas-financas/node_modules "$D/node_modules"
ln -s /home/user/minhas-financas/functions/node_modules "$D/functions/node_modules"
cd "$D"
FILES=$(grep -rlE "8080|9099|5001|9150" src/lib/firebase.ts e2e tests/firestore playwright.config.ts firebase.json package.json || true)
for f in $FILES; do
  sed -i -E 's/(^|[^0-9])8080([^0-9]|$)/\18280\2/g; s/(^|[^0-9])9099([^0-9]|$)/\19299\2/g; s/(^|[^0-9])5001([^0-9]|$)/\15201\2/g; s/(^|[^0-9])9150([^0-9]|$)/\19350\2/g' "$f"
done
node -e '
const fs=require("fs");const p="firebase.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.emulators.ui={enabled:false};j.emulators.hub={host:"127.0.0.1",port:4420};j.emulators.logging={host:"127.0.0.1",port:4520};
j.emulators.firestore.websocketPort=9350;fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n");'
echo "árvore $T extraída em $D"
