# P5-F.1-R3.2 — investigação do RR-R31-08 (`socket hang up` e keep-alive)

**Pergunta.** Na execução 24 da R3.1 (`verify-all-3`), o B03-e falhou no preparo: `apiRequestContext.post: socket hang up` no `POST` de `createCashAccount` ao emulador de Functions. No log do emulador, o pedido não chegou à função. A R3.1 registrou como mecanismo provável, sem prova, a reutilização de um soquete ocioso no instante em que o servidor o fecha. O pedido da R3.2 manda investigar essa hipótese sem tratá-la como fato.

**Conclusão.** A hipótese **não foi comprovada** para o emulador real e não foi tratada como causa:
- Nenhuma mudança de keep-alive foi aplicada.
- O evento original continua sem mecanismo demonstrado, porque não houve captura de rede naquela execução.
- Ele ocorreu sob sobrecarga: 13 GB de memória e 97 processos `node` do emulador. A Frente B remove essa condição, com um Emulator por grupo.
- O risco remanescente fica registrado como RR-R32-03 (LOW) e foi **aceito por escrito, com gatilho** (D-P5F1-R32-03, depois da revisão de estabilidade, EST-03): qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva ao endurecimento de todo o tráfego do `APIRequestContext` (os auxiliares de `e2e/support/callables.ts`, as duas chamadas diretas ao REST do Firestore e as `route.fetch`) antes da execução seguinte, sem repetir a execução até passar.

## Fatos confirmados no código instalado

| Fato | Evidência |
| --- | --- |
| O `APIRequestContext` do Playwright 1.60 usa um agente do módulo com `keepAlive: true` e sem `timeout`, compartilhado no processo | `node_modules/playwright-core/lib/coreBundle.js:7946` (`httpHappyEyeballsAgent = new HttpHappyEyeballsAgent({ keepAlive: true })`) e `:25944` (o `fetch` usa esse agente) |
| O agente do Node 22.23.4 só usa o aviso `Keep-Alive: timeout=N` do servidor para **encurtar** um prazo próprio; sem `timeout` no agente, o aviso é ignorado e o soquete livre fica no conjunto até o servidor fechar | `Agent.prototype.keepSocketAlive`, lido do próprio binário (`process.binding('natives')._http_agent`) |
| O servidor HTTP do Node 22.23.4 anuncia `timeout=5`, mas fecha a conexão ociosa em `keepAliveTimeout + keepAliveTimeoutBuffer` = 5 s + 1 s | `_http_server` do binário: `keepAliveTimeoutBuffer = 1000` e `socket.setTimeout(keepAliveTimeout + keepAliveTimeoutBuffer)` |
| O emulador de Functions do firebase-tools 15.32.1 sobe o servidor sem ajustar esses prazos | `lib/emulator/functionsEmulator.js:273` (`this.createHubServer().listen(port, host)`), sem `keepAliveTimeout` no código do emulador |
| O emulador real fecha a conexão ociosa em ~6,0 s depois da resposta | E3e: 6.001, 6.001 e 6.002 ms (`saidas/keepalive-e3e-emulador-com-atraso.log.txt`) |

Consequência para o desenho dos experimentos:
- A janela de corrida fica perto de **6 s** de ociosidade, não de 5 s.
- O E1, o E1b e o E2 foram desenhados perto de 5 s e não podiam encontrá-la. Valem só como "nenhuma falha perto de 5 s".
- O E3 foi desenhado em volta de 6 s.

## Experimentos

Em todos, o cliente é o `APIRequestContext` do Playwright 1.60, o mesmo do preparo dos E2E. As exceções estão indicadas.
- **Pedidos ao emulador.** Vão ao `createCashAccount` sem token: o emulador encaminha ao processo da função, que recusa com 401, e nada é escrito.
- **Instalação.** Projeto `minhas-financas-local`, com a instalação do repositório.
- **Atraso do laço.** É injetado sem alterar o firebase-tools: `NODE_OPTIONS=--require bloqueio-laco.cjs`, ativo só no processo `emulators:start`.

| # | Servidor | Condição | Ociosidade | Resultado |
| --- | --- | --- | --- | --- |
| E1 | 1.000 servidores Node locais | cliente ocupado logo antes do 2º pedido | perto de 5 s | keep-alive 0/168; `Connection: close` 0/168 |
| E1b | 200 servidores Node locais | servidor ocupado (200 e 1.000 ms) em volta de 5 s | perto de 5 s | 0/88 |
| E2 | emulador de Functions real | ocioso e com carga concorrente (229.469 pedidos de outro processo, 0 erro) | 4.980–5.020 ms | 0/126 (keep-alive 0/84, `close` 0/42) |
| E3a (timers) | 10 servidores Node locais (10 pistas paralelas) | laço ocupado 300 ms a cada 1 s, dentro do temporizador | 4–6 s | 0/240 |
| **E3a (check)** | idem | laço ocupado 300 ms a cada 1 s, na fase *check* (`setImmediate`), como o trabalho pesado de um callback de E/S | 4–6 s | **keep-alive 3/80** (`read ECONNRESET`, ociosidade 5.859, 5.907 e 5.983 ms); `Connection: close` 0/80; sem atraso 0/80 |
| E3b | emulador real | laço do processo principal ocupado na fase *check* (300 ms/1 s) | 4–6 s | keep-alive 0/40; `close` 0/40 |
| E3c | emulador real | idem | **5,6–6,1 s** (a janela do E3a) | keep-alive 0/60; `close` 0/60 |
| E3d | servidor Node em outro processo | cliente ocupado de 5,95 a 6,10 s (atravessa o fechamento) | ~6,1 s | 0/48 (Playwright e `http.request` com `Agent({ keepAlive: true })`, cada um com keep-alive e com `close`) |
| E3e | emulador real | medição do fechamento ocioso (cliente TCP cru), com o atraso injetado | — | FIN em 6.001–6.002 ms; `Keep-Alive: timeout=5` |
| E3h | servidor Node em outro processo | sonda: o soquete é reaproveitado depois de o cliente ficar ocupado durante o fechamento? | ~6,1 s | não (`reusedSocket: false`): o agente já tinha descartado o soquete |

## Leitura dos resultados

- **A corrida existe em princípio.** No E3a (fase *check*):
  - com keep-alive, o pedido escrito num soquete reaproveitado, enquanto o servidor estava ocupado e o prazo de 6 s vencia, foi descartado com RST: `read ECONNRESET`;
  - com `Connection: close`, ou sem atraso, nada falhou;
  - as três falhas caíram logo antes de 6 s.
- **No emulador real ela não apareceu.** Foram 0 em 100 pares com keep-alive e atraso injetado (E3b e E3c), mesmo com toda a ociosidade do E3c na janela que, no servidor puro, falhou em cerca de 14% dos pares. Não identifiquei o que muda no caminho do emulador. Fica sem explicação, e é por isso que a hipótese não é dada como comprovada.
- **A mensagem também difere.** O E3a deu `read ECONNRESET`; o evento da R3.1 foi `socket hang up`, que é o fim da conexão (FIN) sem resposta, e não um RST. O atraso no cliente, que daria esse sintoma, não reproduziu: E3d 0/48, e na sonda E3h o agente não reaproveitou o soquete.

## Decisão

- **Sem mudança de keep-alive.** Uma mitigação como `Connection: close` no preparo pela API não está sustentada pela evidência para o emulador real. Para valer, também precisaria cobrir as quatro chamadas `route.fetch`, porque um pedido com `Connection: close` ainda reaproveita um soquete livre deixado por outro. Aplicá-la agora seria tratar a hipótese como fato.
- **A condição em que o evento ocorreu muda.** As três falhas ambientais da R3.1 (o processo a frio, a conexão encerrada e o OOM do navegador) aconteceram com o emulador acumulando processos e a memória acima de 13 GB. O E2E oficial em grupos começa cada grupo com um Emulator novo (`fluxo-e2e-oficial.md`).
- **O diagnóstico fica possível.** Os logs do Emulator de cada grupo agora são guardados (`test-results/grupo-<n>/firebase-debug.log`). Se a falha voltar, o log do instante dela existe e ela fica no histórico, sem nova tentativa automática.
- **Risco aceito por escrito, com gatilho (D-P5F1-R32-03).** A R3.1 pedia que o preparo pela API fosse protegido do RR-R31-08 antes de o CI e o gate dependerem do `verify:all`. A revisão de estabilidade (EST-03) aceitou duas saídas: o endurecimento só do harness ou a aceitação escrita com gatilho. Fica a segunda, pelos motivos acima: a mitigação parcial não cobriria o mecanismo, e a completa mexeria também nas `route.fetch` dos testes de falha, por uma hipótese que os dados não sustentam no emulador real. A falha, se ocorrer, é visível: o teste fica vermelho, sem nova tentativa, e o executor reprova a execução. Gatilho: qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva ao endurecimento de todo o tráfego do `APIRequestContext` antes da execução seguinte, registrado no histórico, sem repetir a execução até passar.

## Arquivos

- Roteiros: `scripts/keepalive/` no pacote de auditoria (`e1-local.mjs`, `e1b-atraso-servidor.mjs`, `servidor*.mjs`, `e2-emulador.mjs`, `carga.mjs`, `rodar-e2.sh`, `bloqueio-laco.cjs`, `servidor-atraso-laco.mjs`, `e3a-atraso-laco.mjs`, `e3b-emulador-atraso.mjs`, `rodar-e3b.sh`, `rodar-e3c.sh`, `e3d-atraso-cliente.mjs`, `e3e-fechamento-ocioso.mjs`, `e3h-sonda-reuso.mjs`).
- Resultados: `saidas/keepalive-*.log.txt` e `.json`. O log do servidor do E2E (209 MB) está comprimido no pacote, com o SHA-256 do original.
- **Correção de procedimento.** O `rodar-e3b.sh` foi editado por engano enquanto rodava. O conteúdo original foi restaurado byte a byte antes de o cliente terminar, no mesmo inode, e a limpeza do fim rodou normalmente (`e3b=0 porta5001_livre=sim`). A versão parametrizada virou `rodar-e3c.sh`.
