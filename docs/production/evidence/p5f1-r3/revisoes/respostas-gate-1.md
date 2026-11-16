# P5-F.1-R3 — respostas ao gate de regressão (rodada 1)

Parecer: `gate/PARECER-RODADA-1.md`, com decisão **FAIL** por um único bloqueador, de evidência e não de código. A árvore de código `377c2f3f` não mudou: as respostas abaixo só alteram documentos em `docs/`.

| ID | Severidade | Resposta | Onde | Evidência |
| --- | --- | --- | --- | --- |
| B-01 | Bloqueador | **Em reconferência.** O parecer de privacidade (rodada 2) exige nova conferência se `PRIVACY_LGPD.md`, `DATA_RETENTION_LIFECYCLE.md`, `DATA_MODEL.md` ou `DESENHO-MARCAS-B03.md` mudarem, e três deles mudaram depois dele, com o N-PRI-01 do próprio revisor. O revisor de `privacy-lgpd-data-lifecycle` faz a rodada 3 sobre o diff `3eb6041d` → árvore de documentos final e registra o veredito com o hash dela. Depois da rodada 3, esses quatro arquivos não mudam mais | `privacidade/PARECER-RODADA-3.md` | rodada 3 |
| E-01 | Falha ambiental | **Registrada, sem mudança de código.** A falha de `workspace-membership.spec.ts:169` na reexecução do gate entrou no histórico de falhas, com causa, evidência e classificação, e continua lá mesmo tendo passado no executor e isolada. O risco de reprodutibilidade virou o RR-R3-11 do plano. Os logs da reexecução, o trecho do `firebase-debug.log` e o relatório do OOM do kernel vão no pacote, em `logs/gate/` | `testes-e-resultados.md` §3 e §4; plano §20.18 (RR-R3-11) | `gate/PARECER-RODADA-1.md` §3 |
| L-01 | LOW | **Em confirmação na mesma rodada.** Os revisores de observabilidade (`OBSERVABILITY.md` §2.1, §6/A21 e a linha do Caixa), escala (§9 do desenho) e segurança (`DATA_MODEL.md:140` e a linha 26 de `PRIVACY_LGPD.md`) conferem se as edições posteriores aos seus pareceres aplicam as próprias sugestões e batem com o código | `obs-plataforma/`, `escala-custo/`, `seguranca/` (rodada 3) | rodada 3 |
| L-02 | LOW | **Classificado, sem mudança na R3.** A guarda é anterior à R3 e só fica cega num worktree sem commit: no CI, com tudo versionado, ela vê todos os arquivos. Para a árvore da R3, o gate reexecutou os dois testes com o índice completo (262 e 762 arquivos), e os dois passaram, com 0 import de SDK de IA e 0 chave na busca estática. Mudar a guarda agora alteraria código depois do `verify:all`, fora do escopo da R3. Risco residual e correção sugerida no RR-R3-12 | plano §20.18 (RR-R3-12) | `gate/PARECER-RODADA-1.md`, L-02 |
| L-03 | LOW | **Classificado, sem mudança na R3.** A fixture está atual (o gate a regenerou com o backend final, idêntica byte a byte). A falta é de paridade futura: uma mudança de `markViewOf` sem regenerar a fixture não quebraria teste. Os E2E do B03 exercitam, com o backend real, a leitura pelo cliente das marcas gravadas pelo gatilho nos cenários (a) a (e), mas não substituem essa paridade. Condição e endurecimento sugerido no RR-R3-13 | plano §20.18 (RR-R3-13) | `gate/PARECER-RODADA-1.md`, L-03 |
| I-01 | INFO | **Corrigido.** `testes-substituidos.md`: 33 declarações e 38 testes, com os dois testes da revisão pt-BR (M-01 e L-03) na lista do §1.5. `matriz-requisitos.md`: `work-time-consistency`, 38, e as suítes de Rules das marcas 17/17 (matriz 6 e ataques 11) | `testes-substituidos.md`; `matriz-requisitos.md` | log do `verify:all` (38 nomes; 17 Rules) |
| I-02 | INFO | **Tratado.** `[[REVISOES-ESTADO]]` da matriz é preenchido com o estado das revisões depois da rodada 3. `[[VEREDITO]]` e `[[GATE]]` dependem do gate e são preenchidos com a decisão dele | `matriz-requisitos.md`; `LEIAME.md`; `revisoes/LEIAME.md` | — |
| I-03 | INFO | **Corrigido.** O texto agora diz que a limpeza encerrou com SIGTERM a JVM do Firestore deixada pelo E2E (PID 21948) e que, no fim, não sobrou processo e a porta 8080 ficou livre. `saidas/verify-all-final.meta.txt` continua sendo a cópia literal do `.meta` do executor | `testes-e-resultados.md` §4 | `emulator-cleanup.log` |
| I-04 | INFO | Sem ação: o gate aceitou a retirada da asserção de 24 px, escrita e retirada dentro da R3, com a justificativa registrada | — | `gate/PARECER-RODADA-1.md`, I-04 |
| I-05 | INFO | **Classificado.** O CI não chama `test:unit:settings-catalog` nem `test:unit:ai-chat` desde antes da R3. A R3 não muda o CI. O `verify:all` e o gate executaram os dois. Registrado no RR-R3-14 | plano §20.18 (RR-R3-14) | — |

**Mudanças depois desta resposta.**
- Antes do gate (rodada 2):
  - os pareceres da rodada 3, copiados em `revisoes/`;
  - o estado das revisões em `revisoes/LEIAME.md`, em `matriz-requisitos.md` e nas linhas de revisão da §20.18 do plano.
- Depois do gate, só os marcadores de veredito: `[[VEREDITO]]`, `[[GATE]]`, a linha do gate e o "Estado" da §20.18, a linha da P5 e o histórico do plano, e a cópia do parecer do gate.

Nenhuma delas toca código, testes, configuração ou os quatro documentos da condição de privacidade.
