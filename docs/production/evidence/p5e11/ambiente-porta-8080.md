# P5-E1.1 — Diagnóstico da porta 8080 e limpeza do Emulator (§10)

Verificação feita em 2026-10-13, às 09:21Z, antes de qualquer edição de código e sem enviar nenhum sinal a processo. A saída abaixo foi sanitizada: ficaram de fora identificadores de sessão do host e variáveis de ambiente.

## Situação herdada da P5-E1

Na P5-E1, um Firestore Emulator órfão ocupava as portas 8080 e 9150. Era o PID 7545, um processo `java -jar …/cloud-firestore-emulator-v1.22.0.jar`, iniciado em 2026-10-12 às 11:43:45. Encerrá-lo foi recusado naquela sessão, e por isso o `verify:all` não rodou como está (`evidence/p5e1/execucoes.md`).

## Inspeção (§10.1)

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Quem escuta nas portas do Emulator (8080, 9150, 9099, 5001, 4000, 4400, 4500 e as alternativas 8180/8280/9199) | `lsof -tiTCP:<porta> -sTCP:LISTEN` | ninguém |
| Sondagem TCP de 8080, 9150, 9099, 5001, 4000, 4400 e 4500 | `exec 3<>/dev/tcp/127.0.0.1/<porta>` | todas livres |
| Processos `java` | `ps -eo pid,ppid,user,lstart,comm` | nenhum |
| PID histórico 7545 | `/proc/7545` | não existe |
| Processos `node`, `firebase`, `playwright` ou Chromium ativos (suítes em execução) | `ps -eo …,args` | nenhum além do próprio agente |
| Início do ambiente | `ps -o lstart -p 1`; `/proc/uptime` | PID 1 (`process_api --firecracker-init`) iniciado em 2026-10-13 às 09:13:19; uptime de 509 s na verificação |

`ss` não está instalado neste ambiente; `lsof` e `/proc` bastaram.

## Conclusão e ação (§10.2)

- **Causa da liberação:** a máquina virtual foi reiniciada às 09:13:19Z de 2026-10-13. Com isso, o processo órfão da sessão anterior deixou de existir e as portas 8080 e 9150 ficaram livres.
- **Nenhum sinal foi enviado:** nem SIGTERM nem SIGKILL. Nenhum processo foi encerrado nesta milestone, porque não havia alvo.
- **Sem encerramento por nome:** não foi usado `pkill`, `killall` nem qualquer encerramento por coincidência de nome.

## Revalidação (§10.3)

- **Fluxo padrão:** os Emulators passam a subir pelo fluxo padrão do repositório (`firebase.json`, projeto `minhas-financas-local`, portas 8080/9099/5001) quando o gate rodar.
- **Proxy local:** neste container, o `firebase-tools` manda até as requisições para 127.0.0.1 pelo `HTTPS_PROXY` e ignora o `NO_PROXY`. Por isso os comandos com Emulator rodam envolvidos pelo proxy local de loopback do scratchpad, já usado nas milestones anteriores. Ele só aplica o `NO_PROXY`: loopback vai direto, o resto segue ao proxy do agente. Comandos, portas e projeto ficam iguais.
- **Limpeza de execuções de diagnóstico:** quando uma execução de diagnóstico rodar numa cópia com portas alternativas, a JVM do Emulator que essa execução deixar para trás é encerrada só pelo PID cuja linha de comando contém a porta exclusiva da cópia. Os registros ficam no relatório de execuções.

## Durante a P5-E1.1: JVM do Emulator órfã depois do E2E

**Observado em 2026-10-13, às 10:52Z, e repetido depois de cada execução de E2E.**

- **O que acontece:** quando o Playwright termina, ele encerra o `webServer` (`firebase emulators:start`), mas a JVM do Firestore Emulator, processo filho, sobrevive. Ela é adotada pelo PID 1 e continua presa às portas 8080 e 9150.
- **Contraste:** as suítes que usam `firebase emulators:exec` (integração) liberam as portas normalmente.
- **Conclusão:** essa é a explicação mais provável para o processo órfão da P5-E1 (PID 7545). Não há como provar, porque aquela máquina virtual não existe mais.

**Procedimento adotado em toda execução de E2E desta milestone:** o script [`stop-own-emulator.sh`](diagnostico/ferramentas/stop-own-emulator.sh) só envia sinal depois de comprovar três coisas:

- **Identidade:** é `java` com `cloud-firestore-emulator`, `--port 8080`, `--project_id minhas-financas-local` e diretório de trabalho no repositório.
- **Propriedade:** o processo começou depois do início da execução que acabou de terminar.
- **Ausência de uso:** não há nenhum `playwright test`, `firebase emulators` ou `vite build/preview` ativo (a partir das 13:41Z, contando os da mesma execução, e sem conexão TCP estabelecida com a porta; ver abaixo).

Cumpridas as três, o script envia SIGTERM ao PID específico, espera até 15 s e confere que o processo terminou e que a porta ficou livre. Se o processo não terminar, ele para e pede orientação, sem SIGKILL. Também não usa `pkill`, `killall` nem encerramento por nome.

O registro de cada encerramento está em [`encerramentos-emulator.txt`](encerramentos-emulator.txt). Exemplo da primeira ocorrência:

```
2026-10-13T10:52:58Z porta=8080 pid=25494 inicio_proc=2026-10-13T10:50:01Z inicio_execucao=2026-10-13T10:40:00Z cwd=/home/user/minhas-financas ativos=0
  cmd: java … cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 8080 --websocket_port 9150 … --project_id minhas-financas-local …
  SIGTERM enviado ao PID 25494
  PID 25494 terminou; porta 8080 livre: sim
```

### Cópias de diagnóstico e de mutação (portas 8280/9299/5201)

- **Até as 12:41Z:** nas execuções em cópias com portas trocadas, a JVM órfã foi encerrada com SIGTERM pelo próprio script de execução, depois de conferir que a linha de comando continha `--port 8280`. Essa porta é exclusiva das cópias; nenhum processo de outra sessão a usa. Essa conferência não verificava o início do processo nem a ausência de uso.
- **Depois das 12:41Z:** o mesmo `stop-own-emulator.sh` é usado, com um quarto parâmetro: o diretório da cópia, exigido como diretório de trabalho da JVM. Valem as mesmas três provas (identidade, propriedade e ausência de uso), SIGTERM ao PID e nenhum SIGKILL.
- **Prova de ausência de uso, a partir das 13:41Z:** antes, qualquer `playwright test`, `firebase emulators` ou `vite build/preview` ativo no sistema impedia o encerramento, inclusive o de outra execução em portas próprias (os mutantes de integração, na 8180). A regra mudou em dois pontos:
  - **ficou mais estreita num eixo:** contam só os processos desses tipos cujo diretório de trabalho é o da mesma execução (igual ao diretório ou dentro dele; desde as 13:55Z, sem casar prefixo solto), e eles precisam ser zero;
  - **ganhou uma prova direta:** nenhum outro processo pode ter conexão TCP estabelecida com a porta da JVM (`lsof -iTCP:<porta> -sTCP:ESTABLISHED`).

  A troca relaxa a primeira condição (processos de outras execuções não bloqueiam mais) e a compensa com a segunda, que prova o não uso daquela JVM específica. O registro passou a mostrar também `conexoes=`.
- **Proxy de loopback:** o script está em [`diagnostico/ferramentas/loopback-proxy.cjs`](diagnostico/ferramentas/loopback-proxy.cjs).

### Proxy local de loopback

O proxy de loopback é um processo `node loopback-proxy.cjs` que os scripts do scratchpad iniciam só durante o comando, cada um numa porta exclusiva (38801–38805). Até as 12:41Z, fim da última rodada instrumentada, os scripts `with-proxy-*.sh` encerravam esse processo com `kill -9` pelo PID que escutava na porta exclusiva dele, sem conferir a identidade. Era sempre o proxy iniciado pelo próprio script, nunca um Emulator ou processo de outra sessão, mas o padrão não seguia o cuidado pedido. Por isso eles foram substituídos por [`with-proxy-safe.sh`](diagnostico/ferramentas/with-proxy-safe.sh), usado na rodada 4 das repetições, nas mutações e no `verify:all`:

- antes de subir o proxy e depois do comando, ele só encerra um processo cuja linha de comando é `node loopback-proxy.cjs`, com diretório de trabalho no scratchpad e `LISTEN_PORT` igual à porta pedida;
- o encerramento é por SIGTERM;
- se a porta estiver ocupada por outro processo, ou se o SIGTERM falhar, ele aborta sem enviar mais nenhum sinal.

### Sessão de processos de cada mutante

O script de mutações roda cada mutante numa sessão de processos própria (`start_new_session`) e, ao final, encerra o que restar dessa sessão. Na rodada preliminar das 10:08–10:14Z (só mutantes unitários e de frontend, sem Emulator, no desenho A, depois substituído), esse encerramento era SIGKILL ao grupo da própria sessão. Agora é SIGTERM, com espera de até 15 s; se algo continuar ativo, o script para e pede orientação, sem SIGKILL.
