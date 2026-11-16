VEREDITO: FAIL

# Parecer independente: estabilidade do processo de testes (Frente B), P5-F.1-R3.2, rodada 5 (focada, interrompida)

- **Revisor:** estabilidade do processo e `firebase-production-readiness` no escopo da etapa.
- **Data:** 2026-11-14.
- **Árvore sob revisão:** `b2b15267aa0ad2ae7cbda8e7999156412aaf8f1e`. É `698f9644` com o `finally` de `runExecutorSignaled`, em `tests/tools/e2e-grupos.test.mjs`, e o texto de `docs/production/DATA_MODEL.md`.
- **Pasta:** `p5f1r32/revisoes/estabilidade/rodada-5/`.
- **Situação:** parecer interino. A rodada parou a pedido do executor depois de um incidente causado por mim (seção 1). Uma nova árvore e uma nova execução oficial vêm em seguida.

## Conclusão

- **O motivo do FAIL é a falta de uma execução oficial válida na árvore sob revisão.** Não é defeito da árvore.
  - A `verify-all-r32-7` (árvore `b2b15267`) reprovou no `verify:fast` com saída 1.
  - A causa foi o meu roteiro: a 1ª versão de `ka/suite-inteira-s01-s05.sh` encerrou com SIGKILL dois processos do teste 16 da execução oficial (seção 1).
  - A última execução oficial válida é a `verify-all-r32-6`, na árvore `698f9644`, conferida por contagem na rodada 4. Ela não cobre `b2b15267`.
  - O executor já anunciou uma nova árvore, por causa do EST-R5-01, e uma nova execução oficial. O veredito passa a PASS quando essa execução terminar sem interrupção e for conferida por contagem.
- **A correção do EST-R4-01 funciona.**
  - S01 e S05 reprovam sem travar e sem deixar processo órfão, tanto no teste do segundo sinal quanto na suíte inteira (C2, C3).
  - A limpeza nova não esconde falhas: 10 mutantes do caminho de sinais morrem pelos testes certos (C4).
- **Achados abertos:**
  - **EST-R5-01 (LOW):** a limpeza nova mata, no caminho normal, um PID que já saiu. O executor já anunciou a mudança.
  - **EST-R5-02 (INFO):** o `run-oficial.sh` guarda como artefatos de uma execução os relatórios de outra.
  - Continuam abertos o EST-R4-02 (INFO), o EST-R4-03 (INFO) e o EST-R3-03 (INFO).
- **Skill:** `FAIL — Firebase production readiness`, no escopo da etapa, pelo mesmo item: não há execução oficial com o Emulator na árvore sob revisão.

## 1. Incidente causado pelo revisor

- **O que aconteceu.**
  - A 1ª versão do roteiro `ka/suite-inteira-s01-s05.sh` procurava processos "órfãos" em `/proc` pelo nome (`e2e-grupos-falsos-`) e pelo diretório de trabalho (`e2e-grupos-raiz-`), e os encerrava com SIGKILL.
  - A execução oficial `verify-all-r32-7` rodava ao mesmo tempo o `test:tools:e2e` do worktree, que usa os mesmos prefixos.
  - Por volta de 12:48Z, o roteiro encerrou os processos 8083 (`wt-p5f1-r32/tools/e2e/executar-em-grupos.mjs`, com cwd `/tmp/e2e-grupos-raiz-VZpeFs`) e 8111, a porta presa do mesmo teste.
- **O efeito.**
  - O teste 16 da execução oficial reprovou com `null !== 143`, porque o executor morreu por sinal (`logs/verify-all-r32-7.limpo.log:11676-11700`).
  - O `verify:fast` saiu com 1, e a execução terminou às 12:48:25Z, com `exit=1` e 260 s.
  - A mesma versão do roteiro também encerrou o shell que a rodava (pid 4486).
- **Evidência:**
  - `logs/C3-PRIMEIRA-VERSAO-que-encerrou-processos-da-r32-7.txt`;
  - a execução 66 do histórico.
- **Correção no meu procedimento.**
  - A 2ª versão do roteiro só conta processos com uma marca própria no ambiente (`REVISOR_EST_R5=…`), herdada pelo executor e pelos falsos `npx`. O detector foi validado em `logs/C3-validacao-detector.txt`. Ele não encerrou nada.
  - Ao parar o C4 a pedido do executor:
    - mandei SIGINT só ao meu roteiro;
    - antes disso, gravei a árvore dos processos filhos, com a hora de início de cada um (`logs/C4-arvore-ao-parar.txt`);
    - conferi esses mesmos PIDs, pela hora de início, antes de qualquer ação. Já tinham saído, e não encerrei nada (`logs/C4-depois-de-parar.txt`).
  - Daqui em diante, não encerro processo que eu não tenha criado, e não faço busca por nome nem por diretório em `/proc`.
- Nenhum outro processo da execução oficial foi tocado. O Emulator não rodava, porque a execução estava no `verify:fast`. No fim, `portas_ocupadas_no_fim=[]`, `java_no_fim=0` e a árvore igual (`.meta`).

## 2. Comandos executados e resultados

Todos rodaram em cópias próprias de `b2b15267`, extraídas com `git archive`, com `nice -n 19`, sem Emulator e sem escrita no repositório.

| # | Comando | Resultado | Saída |
| --- | --- | --- | --- |
| C0 | `git diff 698f9644 b2b15267` | 2 arquivos: o `finally` do ajudante (`e2e-grupos.test.mjs:527-544`) e o `DATA_MODEL.md` | `logs/C0-diff.txt` |
| C1 | `node --test tests/tools/e2e-grupos.test.mjs` e `integracao-marco.test.mjs` | 23/23 e 3/3 | `logs/C1-*.log` |
| C2 | o teste do segundo sinal sozinho, sem mutante, com S01 e com S05 (`ka/trava-segundo-sinal.sh`, o mesmo da rodada 4) | sem mutante: ok em 1 s. **S01: `not ok` e saída em 10 s. S05: o mesmo em 11 s.** Nenhum falso `npx` sobra. Na rodada 4 (`698f9644`), os dois ficavam presos até o prazo externo de 90 s | `logs/C2-segundo-sinal-s01-s05.txt` |
| C3 | a suíte inteira (26 testes) com S01 e com S05, pela 2ª versão do roteiro (marca no ambiente) | **S01: saída 1 em 69 s, falham 14, 15 e 18. S05: saída 1 em 23 s, falham 14, 16, 17, 18 e 22.** Nenhum processo com a marca sobra. Bate com a `r34-mutantes-sinais.log` do executor (3 e 5 falhas) | `logs/C3-suite-inteira-s01-s05.resumo.txt`, `ka/saidas-suite-2/` |
| C3* | a 1ª versão do mesmo roteiro | inválida, e a causa do incidente (seção 1). O resultado do S05 também saiu contaminado: eu restaurei o executor no meio da execução | `logs/C3-PRIMEIRA-VERSAO-…` |
| C4 | os 13 mutantes do roteiro do executor mortos pelos testes que usam `runExecutorSignaled` (`ka/mutantes-grupos-r32-sinais.py`, cópia filtrada de `mutantes-grupos-r32.py`) | **10 mortos** (S01 a S09 e T01) antes de eu parar a pedido do executor. U17, U01 e S10 não rodaram. A cópia voltou byte a byte, conferida pelo SHA-256 dos 14 arquivos | `logs/C4-*.txt`, `logs/C4-mutantes-sinais.log` |
| C5 | contagem da `verify-all-r32-7` | `verify:fast` até o `test:tools:e2e`: 22/23, falha no teste 16, causada por mim. Integração e E2E não rodaram | `logs/verify-all-r32-7.limpo.log` |
| C6 | os artefatos da `verify-all-r32-7` | são os da `verify-all-r32-6`: mesmos `startTime` e SHA-256 nos três JSON (EST-R5-02) | `logs/C6-artefatos-r32-7.txt` |

## 3. A correção do EST-R4-01

**O que o `finally` novo faz** (`e2e-grupos.test.mjs:527-544`):
1. encerra o grupo do executor se ele ainda não saiu, como antes;
2. depois, com o PID do falso `npx` em curso (`stubPid` ou o do arquivo `shard-1.started`), manda SIGKILL ao grupo (`-running`) e ao processo (`running`);
3. destrói os pipes do executor.

**Trava e órfão: fechado.**
- Com S01 e S05, o teste do segundo sinal reprova em cerca de 10 s, e a suíte inteira termina (C2, C3).
- Nenhum processo com a marca sobra.
- Os pipes destruídos soltam o processo de teste.

**Pode esconder alguma falha? Não.**
- O `return` do `try` (código de saída, saída do executor, `stubAlive`, sinais recebidos e chamadas) é avaliado antes do `finally`.
- As asserções dos testes, inclusive `stubAlive === false` ("nada fica órfão"), olham o estado de antes da limpeza.
- Os 10 mutantes de sinais de C4 morrem pelos mesmos testes da rodada 4. Os outros três não rodaram por causa da parada.

**Pode matar algo que não devia? Sim, em tese.** É o EST-R5-01.

### EST-R5-01: LOW. A limpeza nova manda SIGKILL, no caminho normal, a um PID e a um grupo que já saíram

- **Onde:** `tests/tools/e2e-grupos.test.mjs:533-538`.
- **Cenário.**
  - Quando o teste passa, o falso `npx` já saiu: `stubAlive` é falso, e o próprio teste o confere.
  - Mesmo assim, o `finally` manda `kill(-running)` e `kill(running)` a esse PID.
  - Neste contêiner, `pid_max` é 32768 (`/proc/sys/kernel/pid_max`). Se o PID for reutilizado na janela entre a saída do falso `npx` e o `finally` (normalmente menos de 1 s), o SIGKILL alcança um processo alheio.
  - No caso do grupo, alcança todos os processos de um grupo cujo líder recebeu o PID reutilizado: por exemplo, o grupo de um Playwright de outra execução, que o executor sobe com `detached`.
  - O teste roda dentro do `verify:fast` e do CI, ao lado de outros processos.
- **Impacto.** Improvável: exige o ciclo inteiro dos PIDs numa janela curta. Não leva a PASS falso. Mas o efeito, se acontecer, é encerrar um processo de fora. Foi o que o meu roteiro fez por outro caminho.
- **Correção sugerida** (o executor já anunciou a mudança): só encerrar quando o falso `npx` não tiver saída confirmada (`stubAlive` verdadeiro, ou o `send` ou o prazo falharam), ou conferir antes a identidade do processo. A identidade pode ser a marca no ambiente, a linha de comando com o diretório `stubs` do próprio teste ou a hora de início gravada no `shard-1.started`.

### EST-R5-02: INFO. O `run-oficial.sh` guarda como artefatos de uma execução os relatórios de outra

- **Onde:** `p5f1r32/run-oficial.sh`, na cópia de `test-results/e2e-grupos/` e `test-results/grupo-*/` para `logs/<rótulo>-artefatos/`.
- **Cenário.** A `verify-all-r32-7` parou no `verify:fast`, e o `test:e2e` nem começou. Mesmo assim, `logs/verify-all-r32-7-artefatos/` tem os três JSON e os logs do Emulator da `verify-all-r32-6`: mesmos `startTime` e SHA-256 (C6). O `.meta` diz `artefatos=73M e2e-grupos grupo-1 grupo-2 grupo-3`, como se o E2E tivesse rodado.
- **Impacto.** É só evidência, e a conferência pelo log desmente. Mas quem abrir a pasta vê um E2E completo numa execução que não chegou a ele.
- **Correção sugerida:** copiar só o que for mais novo que o início da execução, ou apagar `test-results/` no começo do `run-oficial.sh`, e escrever no `.meta` quando não houver artefatos desta execução.

## 4. Situação dos achados anteriores

| Achado | Situação |
| --- | --- |
| EST-R4-01 (LOW) | **Fechado** quanto à trava e ao órfão (C2, C3). O resíduo é o EST-R5-01 |
| EST-R4-02 (INFO) | Aberto, sem mudança nesta árvore. É opcional |
| EST-R4-03 (INFO) | Aberto: o texto da execução 62 do histórico não foi conferido de novo nesta rodada |
| EST-R3-03 (INFO) | Aberto: o `mutantes.md` ainda não foi refeito |
| EST-R3-01 e EST-R3-02 | Fechados (rodada 4) |
| EST-05 e EST-14 | Riscos residuais aceitos (RR-R32-05, RR-R32-10) |

## 5. Skill `firebase-production-readiness`

FAIL — Firebase production readiness

- **Escopo:** o mesmo das rodadas 3 e 4, no escopo da etapa.
- **Mapa de ambientes:** sem mudança.
- **Inventário de Functions:** fora do escopo.

**Matriz de evidência:**

| Seção | Item | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Scripts e CI sem produção como destino | PASS | `playwright.config.ts`, `package.json` e o CI iguais aos de `698f9644` (C0) |
| 12 | Execução oficial com o Emulator (integração, Rules e E2E em grupos) na árvore sob revisão | **FAIL** | a `verify-all-r32-7` reprovou no `verify:fast` pela interferência do revisor (seção 1); não há outra execução oficial em `b2b15267` |
| 12 | Emulator desligado limpo, sem órfão | sem evidência nesta árvore | o Emulator não rodou na r32-7. Em `698f9644`, PASS (rodada 4) |
| 12 | Versão da CLI fixa no CI | PASS | sem mudança |

- **Configuração externa pendente:** nenhuma.
- **Achado bloqueante:** a falta da execução oficial válida na árvore sob revisão.
  - **Cenário:** o gate não tem a prova da etapa Emulator na árvore final.
  - **Remediação:** uma nova execução oficial, ininterrupta, na árvore que o executor vai entregar, conferida por contagem.
- **Fora do escopo desta avaliação:** a mesma lista da rodada 4: PR-PLAT-01, PR-PLAT-02, PR-APPCHK-01, PR-REL-01, §4, E-04, E-05, PR-AUTH-04, PR-PLAT-03, PR-OBS-01, PR-OBS-02, PR-BKP-01, FIRE-13, INV-16, REL-09, REL-11 e §13.
- **Verificação:** C0 a C6.

## 6. O que não foi possível verificar

- **A execução oficial na árvore final:** inexistente, pela seção 1.
- **U17, U01 e S10 contra o `finally` novo:** a rodada parou antes deles. O executor os rodou na execução 64 (U01) e na 59 (U17 e S10, contra o `finally` anterior).
- **O resto da rodada:** espera a nova árvore e a nova execução oficial, que o executor vai avisar.
