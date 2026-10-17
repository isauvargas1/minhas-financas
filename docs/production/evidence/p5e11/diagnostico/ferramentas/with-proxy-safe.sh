#!/usr/bin/env bash
# Uso: with-proxy-safe.sh <porta> <comando...>
# Sobe o loopback-proxy (aplica NO_PROXY para 127.0.0.1, que o firebase-tools ignora) só durante o comando.
# Encerramento seguro: só o processo do próprio loopback-proxy desta sessão (cmdline com loopback-proxy.cjs,
# cwd no scratchpad e LISTEN_PORT=<porta> no ambiente), com SIGTERM. Nunca encerra por porta sem identidade.
set -u
# Na cópia de evidência, o diretório de trabalho da sessão (onde fica loopback-proxy.cjs) virou variável.
S=${S:?defina S como o diretório de trabalho com loopback-proxy.cjs}
PORT=$1; shift
UPSTREAM_PORT=$(echo "$HTTPS_PROXY" | sed -E 's#.*:([0-9]+)/?$#\1#')

is_own_proxy() { # <pid>
  local pid=$1
  tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | grep -q 'node loopback-proxy.cjs' || return 1
  [ "$(readlink /proc/$pid/cwd 2>/dev/null)" = "$S" ] || return 1
  tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -qx "LISTEN_PORT=$PORT" || return 1
}

stop_own_proxy() {
  for pid in $(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
    if is_own_proxy $pid; then
      kill -TERM $pid
      for _ in $(seq 1 50); do kill -0 $pid 2>/dev/null || break; sleep 0.1; done
      kill -0 $pid 2>/dev/null && { echo "with-proxy-safe: PID $pid não terminou com SIGTERM; nada mais foi feito" >&2; return 1; }
    else
      echo "with-proxy-safe: porta $PORT ocupada por processo que não é o loopback-proxy desta sessão (PID $pid); abortando" >&2
      return 1
    fi
  done
}

stop_own_proxy || exit 97
( cd "$S" && UPSTREAM_PORT=$UPSTREAM_PORT LISTEN_PORT=$PORT exec node loopback-proxy.cjs ) > "$S/loopback-proxy-$PORT.log" 2>&1 &
for _ in $(seq 1 50); do (echo > /dev/tcp/127.0.0.1/$PORT) 2>/dev/null && break; sleep 0.2; done
env HTTPS_PROXY=http://127.0.0.1:$PORT https_proxy=http://127.0.0.1:$PORT "$@"
CODE=$?
stop_own_proxy
exit $CODE
