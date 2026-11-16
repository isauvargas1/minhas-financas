# P5-F.1-R3.1 — testes e resultados

Todas as execuções rodaram no worktree isolado `wt-p5f1-r31`, ou em cópias dele, com o Firebase Emulator (projeto `minhas-financas-local`). Nenhuma acessou um projeto real. As saídas literais estão em `saidas/`; os logs completos, no pacote de auditoria (`logs/`).

## Testes novos

| Arquivo | Teste | Na R3 | Na R3.1 |
| --- | --- | --- | --- |
| `tests/unit/work-time-consistency.test.ts` | R3.1 (R3-AUD-01): a última estimativa provada nunca aparece como a atual (leitura nova divergente, prova falsa, a mesma identidade, nenhuma falha de leitura) | falha ("mostrados: loading → 1056000") | passa |
| idem | R3.1: antes e depois do tempo de interface (30 s no produto, 800 ms no teste, relógio manual), com um segundo período que começa de novo em "calculando" (acrescentado depois da revisão adversarial, A-06 a) | falha | passa |
| idem | R3.1: a releitura falha depois da divergência (lançamentos por id) | falha | passa |
| idem | R3.1: a releitura falha depois da divergência (meses e marcas) | falha | passa |
| idem | R3.1: releitura por id em andamento depois da divergência | falha | passa |
| idem | R3.1: troca do workspace da renda com a prova pendente | falha | passa |
| idem | R3.1: mudança da preferência com a prova pendente | falha | passa |
| idem | R3.1: provada, mas com a sincronização em curso (uma base, nenhuma desconsiderada) | falha | passa |
| `e2e/work-time-b03.spec.ts` | B03-f (R3.1): leitura nova sem prova, o saldo novo em reais e nunca convertido pela estimativa anterior; a reconstrução traz a conversão certa | falha: na 1ª versão, 9 valores convertidos (`:668`); na final, o último valor mostrado ainda é "tempo\|≈ 808 h" depois de 60 s (`:671`) | passa |

A prova vermelha de unidade rodou os testes da R3.1 com os três arquivos de `src/` da R3 (`saidas/red-r31-na-r3.log.txt`: `# pass 0`, `# fail 8`). As duas revisões a refizeram de forma independente com os testes finais: 12 e 23 falhas na R3, conforme o conjunto. A de E2E rodou na cópia `copia-r3-e2e`, que é a árvore da R3.1 com os mesmos três arquivos da R3, com a 1ª versão dos testes (`saidas/e2e-red-r3/`) e com a final (`saidas/e2e-red-r3-2/`).

## Testes reescritos

Estão em `testes-substituidos.md`: 14 de unidade, a guarda e 1 E2E, com o que cada um afirmava e afirma e a justificativa.

Contagem por arquivo, R3 → R3.1, pelos nomes de teste (`saidas/nomes-testes-r3-r31.txt`):

| Arquivo | R3 | R3.1 |
| --- | ---: | ---: |
| `work-time-consistency.test.ts` | 33 | 40 |
| `work-time-income-estimate.test.ts` | 20 | 20 |
| `work-time-guard.test.ts` | 18 | 18 |
| `e2e/work-time-b03.spec.ts` | 5 | 6 |
| `e2e/work-time-p5f.spec.ts` | 19 | 19 |

## Execuções, em ordem (inclusive as falhas intermediárias)

| # | Execução | Árvore | Resultado | Saída |
| --- | --- | --- | --- | --- |
| 1 | Testes novos de unidade sobre o código da R3 (prova vermelha) | R3.1 com 3 arquivos da R3 | 0 passam, **8 falham** (esperado) | `saidas/red-r31-na-r3.log.txt` |
| 2 | `npm run test:unit:work-time` depois da correção, 1ª | R3.1 intermediária | 210 passam, **11 falham**: os testes antigos que formalizavam a retenção e as expressões da guarda | `saidas/unit-work-time-1.log.txt` |
| 3 | `npm run test:unit:work-time`, depois da reescrita | R3.1 | **221/221**, 0 falha, 0 skip, 0 todo | `saidas/unit-work-time-2.log.txt` |
| 4 | `npx tsc --noEmit` | R3.1 | 0 erro | `saidas/tsc-root-1.log.txt` (vazio) |
| 5 | Mutantes dirigidos, 1ª cópia (só `src/`, `tests/`, `package.json`) | `7ee80711` | a base da cópia falha **4 testes da guarda**: a cópia não tinha `functions/src` nem `firestore.rules`, que a guarda lê. Refeita com a árvore inteira, sem `docs/` | `saidas/mutantes-copia-1-base.log.txt` (reexecução da base dessa cópia) |
| 6 | Mutantes dirigidos (`mutantes-cliente-r31.py`, `copia-mutantes-2`) | `7ee80711` | base 0 falha; **11/11 mortos** | `saidas/mutantes-cliente-r31.log.txt` |
| 7 | Mutantes do cliente da R3 sobre a R3.1 | `7ee80711` | base 0 falha; **29/29 mortos** | `saidas/mutantes-cliente-r3-na-r31.log.txt` |
| 8 | `npx tsc --noEmit` com os E2E novos | R3.1 | 0 erro | `saidas/tsc-root-2.log.txt` (vazio) |
| 9 | E2E B03-f e "releitura que falha" na cópia da R3 (prova vermelha) | R3.1 com 3 arquivos da R3 | **2 de 2 falham** (esperado): B03-f em `:668`, com 9 valores convertidos; a "releitura que falha" em `:1076`, sem o erro, com R$ 25,00 e o aviso de leitura anterior | `saidas/e2e-red-r3/` |
| 10 | E2E `work-time-b03.spec.ts` e `work-time-p5f.spec.ts` | R3.1 | **25/25** (5,9 min) | `saidas/e2e-r31-work-time-1.log.txt` |
| 11 | `npm run verify:all` (rodada 1 das revisões) | `40057d2a` | **saída 0**: 1.754 de unidade, 1.289 de integração e Rules, 216 E2E (19,3 min); 0 falha, 0 skip, 0 todo; lint 0 erro e 201 avisos; 42,5 min | `saidas/verify-all-1.resumo.json`, `saidas/verify-all-1-memoria.txt` |
| 12 | Revisões independentes, rodada 1 | `40057d2a` | adversarial PASS; financeira FAIL só pelo F-01 (documentação); pt-BR PASS | `revisoes/` |
| 13 | `work-time-income-estimate.test.ts` depois do R6-02 reforçado e do nome da propriedade | intermediária | 21/21 | `saidas/unit-income-estimate-3.log.txt` |
| 14 | `npm run test:unit:work-time` e `npx tsc --noEmit` | intermediária | 221/221; 0 erro | `saidas/unit-work-time-3.log.txt`, `saidas/tsc-root-3.log.txt` |
| 15 | Base da 1ª cópia de mutantes, reexecutada para registrar a falha da execução 5 | `7ee80711` (cópia incompleta) | 81 passam, **4 falham**: guardas sem `functions/src` e `firestore.rules`. É a falha que invalidou a cópia | `saidas/mutantes-copia-1-base.log.txt` |
| 16 | E2E B03-f e "releitura que falha" (versões finais) na cópia da R3 | R3.1 com 3 arquivos da R3 | **2 de 2 falham** (esperado): B03-f em `:671` (`tempo\|≈ 808 h` depois de 60 s); a "releitura que falha" em `:1081` (sem o erro) | `saidas/e2e-red-r3-2/` |
| 17 | E2E `work-time-b03.spec.ts` e `work-time-p5f.spec.ts` (versões finais) | R3.1 | **25/25** (5,9 min); B03-f em 39,4 s; "releitura que falha" em 19,9 s | `saidas/e2e-r31-work-time-2.log.txt` |
| 18 | Mutantes dirigidos, refeitos depois das revisões | `196259af` | **interrompida** de propósito, depois da base (0 falha), para acrescentar o segundo período e o A12 | `saidas/mutantes-cliente-r31-final-interrompida.log.txt` |
| 19 | `work-time-consistency.test.ts` com o segundo período | final | 46/46 | `saidas/unit-consistency-4.log.txt` |
| 20 | Mutantes dirigidos A01–A12 | **`d9fed573`** (código final) | base 0 falha; **12/12 mortos** | `saidas/mutantes-cliente-r31-final.log.txt` |
| 21 | Revisões independentes, rodada 2 | `d9fed573` | adversarial PASS; financeira PASS; pt-BR PASS | `revisoes/` |
| 22 | `npm run verify:all` | `b841ec69` (só `docs/` difere de `d9fed573`) | **saída 1, falha intermediária ambiental.** 1.754/1.754 de unidade, 1.289/1.289 de integração e Rules, lint 0 erro; E2E **215/216**. Falhou `e2e/workspace-membership.spec.ts:169` ("convite, aceite, troca de papel, remoção e perda de acesso entre duas contas"), o 215º de 216: o membro continuou `active` no poll de 12 s por `removed` (`:265`). Causa e evidência logo abaixo | `saidas/verify-all-2.resumo.json`, `saidas/verify-all-2-memoria.txt`, `saidas/verify-all-2-falha/` |
| 23 | `e2e/workspace-membership.spec.ts --repeat-each=3`, isolado, no mesmo build | final | **6/6**; o teste que falhou passou 3/3 (13,3 s, 3,8 s e 3,8 s) | `saidas/e2e-membership-isolado.log.txt` |
| 24 | `npm run verify:all` | `9d688d9c` (só `docs/` difere de `d9fed573`) | **saída 1, falha intermediária ambiental.** 1.754/1.754 de unidade, 1.289/1.289 de integração e Rules, lint 0 erro; E2E **215/216**. Falhou o B03-e (`e2e/work-time-b03.spec.ts:577`), o 193º de 216, ainda no preparo dos dados: `apiRequestContext.post: socket hang up` no `POST` de `createCashAccount` ao emulador de Functions, chamado por `seedTenant`. Causa e evidência logo abaixo | `saidas/verify-all-3.resumo.json`, `saidas/verify-all-3-memoria.txt`, `saidas/verify-all-3-falha/` |
| 25 | B03-e isolado, `--repeat-each=3`, no mesmo build | final | **3/3** (27,0 s, 15,3 s e 14,8 s) | `saidas/e2e-b03-e-isolado.log.txt` |
| 26 | `npm run verify:all` | `30abca0f` (só `docs/` difere de `d9fed573`) | **saída 1, falha intermediária ambiental, com OOM.** 1.754/1.754 de unidade, 1.289/1.289 de integração e Rules, lint 0 erro; E2E **215/216**. Falhou de novo `workspace-membership.spec.ts:169`, no poll de `removed` (`:265`). Às 00:07:33, o kernel matou o `chrome-headless` do teste por falta de memória no cgroup da sessão | `saidas/verify-all-4.resumo.json`, `saidas/verify-all-4-memoria.txt`, `saidas/verify-all-4-falha/` |
| 27 | Etapa E2E do `verify:all` em três grupos de arquivos, cada um com o próprio Emulator (mitigação do RR-R3-11) | `4e1521a6` (só `docs/` difere de `d9fed573`) | **saída 0. 216/216**: grupo 1, 68 testes (6,0 min); grupo 2, 70 (4,8 min); grupo 3, 78 (10,7 min); 0 falha, 0 skip, 0 flaky; 36 arquivos, cada um em um só grupo. Pico de memória 10.777 MiB, com 74 processos `node`, no fim do grupo 3. Nenhum OOM | `saidas/e2e-grupos.meta.txt`, `saidas/e2e-grupo-*.log.txt`, `saidas/e2e-grupos-memoria.txt` |
| 28 | `npm run verify:all` do gate (`gate-verify-all`) | `6137c201` (só `docs/` difere de `d9fed573`) | **saída 1, falha intermediária ambiental.** 1.754/1.754 de unidade, 1.289/1.289 de integração e Rules, lint 0 erro; E2E **215/216** (20,2 min), em 42,5 min no total. Falhou de novo `workspace-membership.spec.ts:169`, no poll de `removed` (`:265`). Causa logo abaixo. As contagens dos 40 scripts são iguais às da execução 26 | `revisoes/gate/saidas/gate-verify-all.resumo.json`, `gate-verify-all.contagens.log.txt`, `gate-verify-all-memoria.txt`; `revisoes/gate/evidencia/` |
| 29 | Etapa E2E em três grupos, refeita pelo gate com o mesmo roteiro, só com os logs renomeados | `6137c201` | **saída 0. 216/216**: grupo 1, 68 testes (6,1 min); grupo 2, 70 (4,8 min); grupo 3, 78 (11,1 min); 0 falha, 0 skip, 0 flaky. O `:169` passou (14,1 s). Pico de memória 10.302 MiB, com 73 processos `node`. Nenhum OOM | `revisoes/gate/saidas/gate-e2e-grupos.meta.txt`, `gate-e2e-grupo-*.log.txt`, `gate-e2e-grupos-memoria.txt` |
| 30 | Gate (`regression-release-gate`), rodada 1 | `6137c201` | **PASS.** Nenhum HIGH ou MEDIUM no diff; G-01 (MEDIUM, processo), G-02 (LOW), G-03 a G-05 (INFO). Também rodou: `ai-backend-only.test.ts` com o índice completo, 5/5; a prova vermelha própria, com 24 de 85 testes falhando com o `src/` da R3; 3 mutantes próprios, todos mortos | `revisoes/gate/PARECER-RODADA-1.md`, `revisoes/gate/saidas/` |

**A falha da execução 22, causa.** É a mesma falha do E-01 do gate da R3 (o mesmo teste, o penúltimo do E2E, uma escrita assíncrona de membro que não chega no prazo), com a causa provada pelo log do emulador desta execução (`saidas/verify-all-2-falha/firebase-debug-removeWorkspaceMember-trecho.txt`):
- `removeWorkspaceMember` é chamada uma única vez em todo o E2E, justamente nesse teste (`addWorker` aparece 1 vez no log): o emulador de Functions cria o processo dela na hora, a frio.
- O pedido de pré-checagem (`OPTIONS`) chegou às 22:34:06,97Z. O processo novo levou 9,2 s só para carregar os módulos (22:34:06,99 → 22:34:16,20) e ficou pronto às 22:34:18,88. O `POST` foi aceito às 22:34:19,59 e terminou em 1,24 s.
- Nesse minuto, a memória usada subiu de 13.716 para 14.443 MiB (de 16.086), com 99 a 104 processos `node` do emulador (`saidas/verify-all-2-falha/memoria-22h34.txt`). É o RR-R3-11. Não houve OOM (`dmesg` sem registro).
- Da pré-checagem ao `POST` foram cerca de 12,6 s, acima do prazo de 12 s do poll.
- Nada disso passa pelo código da R3.1: o diff não toca o spec, `functions/src/workspaces`, `src/modules/workspaces` nem a tela de Configurações. O mesmo teste passou no `verify-all-1` e na reexecução isolada, 3 de 3.
- A falha fica no histórico. Não é regressão da R3.1; é a limitação de memória do harness E2E registrada no RR-R3-11, agora com a causa medida: o processo a frio sob pressão de memória.

**A falha da execução 24, causa.** O B03-e falhou antes de qualquer código da estimativa: no preparo do tenant, a chamada de `createCashAccount` ao emulador de Functions recebeu `socket hang up` (a conexão foi fechada sem resposta).
- **Nada no servidor.** No log do emulador, a janela do tenant desse teste (`e2e-b03-pf-mwbb7ksr`, das 23:16:42,17 às 23:16:43,55Z) não tem nenhum `createCashAccount` aceito: o pedido não chegou ao tratamento da função (`saidas/verify-all-3-falha/firebase-debug-b03-e-trecho.txt`). Nessa hora o emulador ainda terminava um `getFinancialReport` do teste anterior (3,0 s).
- **Ambiente.** Memória em 13.189 MiB, com 97 processos `node` do emulador (`saidas/verify-all-3-falha/memoria-23h16.txt`). Sem OOM (`dmesg`) e sem erro de descritor (`ulimit -n` de 20.000).
- **Hipótese, não comprovada.** O mecanismo exato do fechamento não ficou provado: um soquete reaproveitado no instante em que o servidor o fecha produziria exatamente esse sintoma.
- **Conferência do gate (G-02, RR-R31-08).** O gate conferiu três fatos:
  - o `createCashAccount` é a primeira chamada à porta 5001 nesse teste;
  - o `APIRequestContext` do Playwright 1.60 usa o agente HTTP global com `keepAlive: true`, compartilhado entre os testes do mesmo processo;
  - o firebase-tools 15.32.1 não define `keepAliveTimeout`, e o padrão do Node 22 é 5 s.

  Com isso, a corrida entre um soquete ocioso reaproveitado e o fechamento dele pelo servidor é o mecanismo provável. Para este evento ela continua sem prova, porque não houve captura de rede. A atribuição ao ambiente está comprovada.
- **R3.1 fora do caminho.** A chamada é a mesma de todos os testes B03 desde a R3. O B03-e passou nas execuções 10, 11, 17 e 22 e, isolado, 3 de 3.
- É uma falha de infraestrutura do harness E2E no fim de uma suíte longa, a mesma classe do RR-R3-11. Fica no histórico.

**A falha da execução 26, causa.** É o mesmo teste da execução 22 e o mesmo E-01 do gate da R3, agora com o registro do kernel (`saidas/verify-all-4-falha/dmesg-oom.txt`): às 00:07:33, "Memory cgroup out of memory: Killed process … (chrome-headless)", no cgroup da sessão. Nesse minuto, a memória usada estava em 13,7 a 14,4 GB, com 99 a 104 processos `node` do emulador (`saidas/verify-all-4-falha/memoria-00h07.txt`).

**Decisão depois da execução 26.** Três execuções completas na árvore final de código terminaram cada uma com uma única falha ambiental no fim do E2E, e as três são diferentes:
- o processo a frio sob pressão de memória;
- a conexão encerrada no preparo;
- o OOM do navegador.

Em todas, a unidade, a integração, as Rules e o lint passaram, e cada teste que falhou passou isolado e nas outras execuções. Repetir o `verify:all` até uma execução verde provaria pouco. A execução 27 aplica a mitigação do RR-R3-11: a etapa E2E em grupos de arquivos, cada um com o próprio Emulator, com os mesmos arquivos, a mesma configuração e o mesmo build. A unidade, a integração e o lint vêm das execuções 22, 24 e 26 (iguais nas três). A decisão sobre aceitar a regressão completa por partes é do gate.

**A falha da execução 28, causa.** É o mesmo teste e o mesmo poll das execuções 22 e 26. O gate mediu a partida a frio no `firebase-debug.log` da própria execução (`revisoes/gate/evidencia/firebase-debug-removeWorkspaceMember-gate.txt`):
- o `OPTIONS` foi aceito às 01:21:08,93Z, e o processo de `removeWorkspaceMember` foi criado a frio nesse instante, a única criação dele no E2E;
- os módulos resolveram às 10,63, o `initializeApp` saiu às 17,79 e o runtime ficou pronto às 20,04;
- o `POST` foi aceito às 20,44 e terminou às 21,18 com `outcome: ok`, cerca de 12,2 s depois do `OPTIONS`, acima dos 12 s do poll.

A memória estava em 14,4 GB, com pico de 14.441 MiB às 01:21:12 e 103 processos `node`. Não houve OOM: o `dmesg` só tem o das 00:07:33. A página estava viva (`revisoes/gate/evidencia/error-context-gate.md`).

**Decisão do gate** (parecer, §9.5): a regressão completa está aprovada por etapas, todas executadas pelo próprio gate na árvore final.
- As etapas 1 a 7, o lint e os builds passaram no `verify:all` do gate (execução 28).
- A etapa 8 passou inteira nos grupos do gate (execução 29), com os mesmos 36 arquivos, os 216 testes, a mesma configuração e o mesmo build.
- Cada um dos 216 testes passou ao menos uma vez numa sessão completa da árvore final.
- Nenhuma das quatro falhas veio de uma asserção sobre o comportamento do produto.

O que isso não prova fica com o RR-R31-07: que o `npm run test:e2e` numa sessão só, como o CI roda, passe neste ambiente.

**Condição de manutenção do E2E "releitura que falha"** (revisão adversarial R2-02): as cinco fases gastam, no pior caso, exatamente as 5 releituras de uma vez (`burst`) do agendador; nas execuções registradas, a coalescência reduziu a 3. Uma fase de falha a mais faria a última releitura esperar a reposição, de até 120 s no teste, acima da espera de 45 s. Entre `page.unroute` e o clique há uma janela de milissegundos em que a releitura automática agendada depois do erro poderia disparar. Ela não disparou em nenhuma execução registrada.

## Valores registrados no E2E

B03-f na R3.1: os valores do saldo do Dashboard, na ordem em que apareceram (registrador `MutationObserver`).

| Momento | Saldo | Aviso do topo |
| --- | --- | --- |
| antes | "≈ 796 h" (R$ 19.900,00 ÷ R$ 25,00/h) | "Valores em tempo de trabalho equivalente: uma estimativa aproximada, não o valor exato." |
| a escuta vê o mês novo | "R$ 19.900,00" | "Calculando a estimativa de tempo de trabalho: enquanto isso, os valores ficam em reais." |
| a leitura nova chega, sem prova | "R$ 20.200,00" | o mesmo e, depois de 30 s, "Estimativa de tempo de trabalho indisponível agora: os valores continuam em reais. Veja o motivo em Configurações." |
| depois da reconstrução | "≈ 795 h 2 min" (a renda nova, R$ 25,41/h) | o normal |

O valor inseguro da R3, "≈ 808 h" (R$ 20.200,00 pela renda anterior), não aparece. Na R3 ele aparece, como se vê no snapshot de acessibilidade da falha (`saidas/e2e-red-r3/b03-f-na-r3-error-context.md`, "Saldo Atual": "R$ 20.200,00 · tempo de trabalho estimado", "≈ 808 h").

## Regressão completa (`verify:all`)

| Execução | Árvore | Saída | Unidade | Integração e Rules | E2E | Lint | Duração |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R3 (referência) | `377c2f3f` | 0 | 1.746 | 1.289 | 215 | 0 erro, 201 avisos | 40,4 min |
| `verify-all-1` | `40057d2a` | 0 | 1.754 | 1.289 | 216 | 0 erro, 201 avisos | 42,5 min |
| `verify-all-2` | `b841ec69` | **1** | 1.754 | 1.289 | 215/216 (falha ambiental acima) | 0 erro, 201 avisos | 42,9 min |
| `verify-all-3` | `9d688d9c` | **1** | 1.754 | 1.289 | 215/216 (falha ambiental acima) | 0 erro, 201 avisos | 41,9 min |
| `verify-all-4` | `30abca0f` | **1** | 1.754 | 1.289 | 215/216 (OOM no fim do E2E, acima) | 0 erro, 201 avisos | 43,0 min |
| E2E em grupos | `4e1521a6` | 0 | (execuções 22, 24 e 26) | (execuções 22, 24 e 26) | 216/216 | (execuções 22, 24 e 26) | 22,3 min |
| `gate-verify-all` (gate) | `6137c201` | **1** | 1.754 | 1.289 | 215/216 (falha ambiental acima) | 0 erro, 201 avisos | 42,5 min |
| E2E em grupos (gate) | `6137c201` | 0 | (execução 28) | (execução 28) | 216/216 | (execução 28) | 22,8 min |

Delta contra a R3:
- Unidade +8: os 7 testes novos de `work-time-consistency`, um deles com duas variantes, por id e marcas.
- E2E +1: o B03-f.
- Integração e Rules iguais.
- 0 skip, 0 todo e 0 cancelado em todas as execuções.

## Memória (RR-R3-11)

A amostragem roda a cada 10 s (`MemTotal − MemAvailable`, de 16.086 MiB, sem swap) e conta os processos `node` e `java`.

| Execução | Pico | Quando | Processos `node` no pico |
| --- | --- | --- | --- |
| `verify-all-1` | 14.357 MiB | últimos segundos do E2E | 102 |
| `verify-all-2` | 14.443 MiB | últimos segundos do E2E, no minuto da falha | 104 |
| `verify-all-3` | 13.936 MiB | últimos segundos do E2E (na falha, 13.189 MiB e 97 processos) | 101 |
| `verify-all-4` | 14.423 MiB | últimos segundos do E2E; OOM do `chrome-headless` às 00:07:33 | 104 |
| E2E em grupos | 10.777 MiB | fim do grupo 3 | 74 |
| `gate-verify-all` | 14.441 MiB | no minuto da falha (01:21:12); sem OOM | 103 |
| E2E em grupos (gate) | 10.302 MiB | fim do grupo 3 | 73 |

O emulador de Functions mantém um processo por função chamada e não encerra os ociosos. A memória cresce até o fim do E2E, e uma função chamada pela primeira vez no fim do E2E sobe a frio, sob essa pressão. A R3.1 não muda o número de funções nem de processos, porque não toca o backend. A mitigação do RR-R3-11 continua para o CI: separar o E2E em grupos com Emulator próprio, ou reiniciar o emulador de Functions entre grupos.
