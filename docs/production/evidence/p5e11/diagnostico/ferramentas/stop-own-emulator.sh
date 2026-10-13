#!/usr/bin/env bash
# Uso: stop-own-emulator.sh <porta> <inicio-da-execucao-epoch> <log> [diretório-da-execução]
# Encerra SÓ a JVM do Firestore Emulator desta sessão que ficou órfã na <porta> depois de uma execução
# iniciada em <inicio>. Confere identidade (java + cloud-firestore-emulator + --port <porta> + projeto
# minhas-financas-local + cwd no diretório da execução: o repositório ou a cópia de diagnóstico), propriedade (início do processo depois do início da execução)
# e ausência de uso (nenhum playwright/firebase/vite ativo com diretório de trabalho nessa mesma execução e nenhuma
# conexão TCP estabelecida com a porta, de outro processo). SIGTERM ao PID específico; sem SIGKILL.
set -u
PORT=$1; RUN_START=$2; LOG=$3
REPO=${4:-/home/user/minhas-financas}
for PID in $(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
  CMD=$(tr '\0' ' ' < /proc/$PID/cmdline)
  CWD=$(readlink /proc/$PID/cwd)
  START=$(( $(date +%s) - $(ps -o etimes= -p $PID | tr -d ' ') ))
  ACTIVE=0
  for P2 in $(ps -eo pid=,args= | grep -E "playwright test|firebase emulators|vite (preview|build)" | grep -v grep | awk '{print $1}'); do
    PCWD=$(readlink /proc/$P2/cwd 2>/dev/null)
    [[ "$PCWD" == "$REPO" || "$PCWD" == "$REPO"/* ]] && ACTIVE=$((ACTIVE+1))
  done
  ESTAB=$(lsof -nP -iTCP:$PORT -sTCP:ESTABLISHED -t 2>/dev/null | grep -vx "$PID" | sort -u | wc -l)
  {
    echo "$(date -u +%FT%TZ) porta=$PORT pid=$PID inicio_proc=$(date -u -d @$START +%FT%TZ) inicio_execucao=$(date -u -d @$RUN_START +%FT%TZ) cwd=$CWD ativos=$ACTIVE conexoes=$ESTAB"
    echo "  cmd: $(echo "$CMD" | cut -c1-260)"
  } >> "$LOG"
  if [[ "$CMD" == java* && "$CMD" == *cloud-firestore-emulator* && "$CMD" == *"--port $PORT "* && "$CMD" == *"--project_id minhas-financas-local"* && ( "$CWD" == "$REPO" || "$CWD" == "$REPO"/* ) && $START -ge $RUN_START && $ACTIVE -eq 0 && $ESTAB -eq 0 ]]; then
    kill -TERM "$PID" && echo "  SIGTERM enviado ao PID $PID" >> "$LOG"
    for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$PID" 2>/dev/null; then echo "  PID $PID ainda ativo após 15 s: NÃO encerrado à força; pedir orientação" >> "$LOG"; exit 3; fi
    echo "  PID $PID terminou; porta $PORT livre: $( (lsof -tiTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && echo não) || echo sim)" >> "$LOG"
  else
    echo "  identidade/propriedade/uso NÃO comprovados: nenhum sinal enviado" >> "$LOG"; exit 2
  fi
done
