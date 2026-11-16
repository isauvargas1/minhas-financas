# P5-F.1-R3.1 — revisões independentes e respostas

Três revisões independentes na rodada 1, sobre a árvore de código `40057d2a78c47fea537480b0a2bc21fc46e2a500`. Cada revisor recebeu o pedido, o código e as árvores, não as conclusões do executor. Todos trabalharam só lendo: nenhum rodou Emulator, E2E nem `verify:all`, que rodava ao mesmo tempo.

| Revisão | Rodada 1 | Parecer |
| --- | --- | --- |
| Adversarial (eliminação do R3-AUD-01 e regressões) | **PASS**, nenhum HIGH ou MEDIUM; 3 LOW e 3 INFO | `adversarial/PARECER-RODADA-1.md` |
| `financial-domain-integrity` | **FAIL**, só pelo F-01 (LOW, documentação); F-02 MEDIUM fora do diff; V-01 (`verify:all` pendente) | `financeiro/PARECER-RODADA-1.md` |
| `ptbr-product-ui-review` | **PASS**, 8 INFO | `ptbr/PARECER-RODADA-1.md` |

Na rodada 2, as três revisões conferiram as respostas na árvore final de código `d9fed573c803d64827ba278c347215054a31e0d2`:

| Revisão | Rodada 2 | Parecer |
| --- | --- | --- |
| Adversarial | **PASS**, nenhum HIGH ou MEDIUM; 4 INFO (R2-01 a R2-04) | `adversarial/PARECER-RODADA-2.md` |
| `financial-domain-integrity` | **PASS**; pendências de fechamento (F-05, N-01, V-02) e 1 INFO opcional (N-02) | `financeiro/PARECER-RODADA-2.md` |
| `ptbr-product-ui-review` | **PASS**, só INFO (I-01 a I-08, N-01, N-02) | `ptbr/PARECER-RODADA-2.md` |

## Respostas

### `financial-domain-integrity`

| Achado | Resposta |
| --- | --- |
| **F-01 (LOW, bloqueante)** — `DATA_MODEL.md:279` e o comentário de `src/modules/work-time/useIncomeEstimate.ts:18` descreviam a retenção como vigente | **Corrigido.** `DATA_MODEL.md` passou a dizer: sem prova, ou com a sincronização em curso, nenhuma conversão; nenhuma estimativa anterior no lugar da atual; a escuta encerrada como erro sem conversão com desconsiderada ou 12 meses. O comentário passou a dizer "a apresentação fail-closed". A busca no código por `HeldEstimate`, `EstimateIdentity`, `sameEstimateIdentity`, `sameEstimateInputs`, `heldTooLong` e "mesma identidade" em `src/` e nos documentos de referência não acha mais descrição vigente da retenção. |
| **F-02 (MEDIUM, fora do diff, anterior à R3.1)** — com uma base e nenhuma desconsiderada, um valor do cache do React Query aparece sem aviso antes do primeiro retorno do servidor à escuta (regra 1 da prova, `consistency.ts:56`) | **Registrado como RR-R31-05**, fora do escopo da R3.1. O pedido manda corrigir só o R3-AUD-01 e preservar o mecanismo da R3. A revisão adversarial confirmou o mesmo caso (A-01), reproduzido também na R3, onde dura mais, e que a R3.1 reduz a exposição. A direção sugerida pelas duas revisões está no RR-R31-05: tratar como sincronização em curso a regra 1 com a escuta aberta e sem retorno do servidor, mantendo a escuta encerrada como está. Ela muda a navegação e o comportamento sem rede e pede decisão própria. |
| **F-03 (INFO)** — parte da evidência era anterior aos arquivos finais | Todas as execuções foram refeitas na árvore final de código: unidade, E2E dos dois arquivos, mutantes dirigidos e `verify:all` (`testes-e-resultados.md`). |
| **F-04 (INFO)** — "nenhuma espera foi aumentada" impreciso | Corrigido em `testes-substituidos.md`: cada prazo, por fase, e o orçamento total (240 s → 300 s) com o motivo. |
| **F-05 (INFO)** — o plano mestre sem a R3.1 | Registrada no plano mestre (§20.19, linha da P5 e histórico). |
| **V-01** — `verify:all` pendente | O `verify:all` da árvore da rodada 1 (`40057d2a`) terminou com saída 0. O da árvore final de código está em `testes-e-resultados.md`. |

### Revisão adversarial

| Achado | Resposta |
| --- | --- |
| **A-01 (LOW, anterior à R3.1)** — regra 1 da prova sem confirmação da escuta: base do cache (ADV-1) e divergência persistente depois de 2 releituras (ADV-6, exige anomalia no servidor) | O mesmo caso do F-02: **RR-R31-05**, com os dois cenários. |
| **A-02 (LOW)** — o painel "Receitas consideradas" e a contagem da renda dependem de `status === 'done'` e ficam indisponíveis em toda janela sem prova ou sincronizando, também no meio da sessão | **Registrado como RR-R31-06.** O painel depende do estado pronto da estimativa (`IncomeEditor.tsx`), embora precise só da data de referência e dos totais oficiais, que a série corrente traz sem conversão (precisão da rodada 2, R2-03). Desacoplá-lo é mudança de integração e interface, fora do escopo da R3.1. "Restaurar padrão" continua funcionando. |
| **A-03 (LOW)** — o E2E reescrito perdeu a recuperação pelo "Tentar de novo" trazendo a receita nova depois da falha | **Corrigido.** O E2E ganhou a fase 2: com o relatório de volta, o "Tentar de novo" do erro traz a hora com a receita nova, sem erro nem aviso. O registrador afirma que nenhuma hora aparece entre o erro e o clique. Vermelho na R3 e verde na R3.1. |
| **A-04 (INFO)** — `refreshFailed` com a escuta encerrada | Registrado no RR-R31-04 (preservação do item 6, com o aviso imediato). |
| **A-05 (INFO)** — o pior caso do RR-R31-02 é maior que "alguns segundos" | **Corrigido no RR-R31-02:** na janela de 12 meses, até cerca de 10 min sem conversão pelo orçamento da releitura de mutação (`queryKeys.ts:53-57`), com "Tentar de novo" resolvendo. |
| **A-06 (INFO)** — força e precisão | (a) O M8 sobrevivia: nenhum teste cobria dois períodos de espera seguidos. Corrigido: o teste "antes e depois do tempo de interface" ganhou um segundo período, e o mutante A12 (o mesmo do M8) entrou nos dirigidos e é morto (`mutantes.md`).<br>(b) O nome da propriedade foi corrigido.<br>(c) O R6-02 passou a conferir todas as renderizações até a prova.<br>(d) Os prazos foram descritos por fase.<br>(e) O B03-f passou a provar os reais pelo registrador: o último valor mostrado é `reais|R$ 20.200,00`. Na R3 ele falha aí, com `tempo|≈ 808 h` depois de 60 s. |

### `ptbr-product-ui-review`

| Achado | Resposta |
| --- | --- |
| **I-01** — a cada sincronização, tempo → reais → tempo, com "Calculando…" (na janela de 12 meses, também cerca de 30 s depois de qualquer lançamento nesta aba) | Registrado no RR-R31-01: é o comportamento pedido (itens 2, 3 e 5). |
| **I-02** — o aviso do topo sem região viva (anterior) | Sem mudança: mudaria a interface sem necessidade estrita. Registrado no RR-R31-01. |
| **I-03** — quando o resumo pronto vira "carregando", o foco cai no `body` | Registrado no RR-R31-01 (padrão anterior, agora mais frequente). |
| **I-04** — o topo e a prévia com prazos de 30 s independentes (anterior) | Sem mudança; o texto do topo e o da prévia são coerentes em cada estado. |
| **I-05** — durante a sincronização, as telas vizinhas também passam aos estados existentes | Esperado. É o mesmo do A-02 (RR-R31-06). |
| **I-06** — "em atualização" usa o ramo de erro com `role="alert"` (anterior, aceito na R3) | Sem mudança. |
| **I-07** — o `console.log` do E2E entrou depois da execução | O E2E foi refeito na árvore final, com a sequência registrada no log (`testes-e-resultados.md`). |
| **I-08** — o texto genérico do erro do relatório aparece em mais situações | Sem mudança: é o texto existente e seguro; trocar mudaria a interface. |

## Respostas à rodada 2

| Achado | Resposta |
| --- | --- |
| **Adversarial R2-01 (INFO)** — as fases 2 e 4 do E2E não provam que foi o clique que recuperou: a releitura automática agendada depois do erro também traria a estimativa dentro da espera de 30 s (ADV-7) | **Aceito como INFO, sem mudança de teste.** O caminho do "Tentar de novo" relendo a série tem cobertura de unidade: o mutante M9 da revisão, com o "Tentar de novo" sem reler, é morto pelo R6-02 com a escuta encerrada. A primeira carga tem cobertura no E2E de Configurações. Endurecer o E2E (por exemplo, `waitForRequest` com prazo menor que a releitura automática) mudaria um arquivo fora de `docs/` depois do `verify:all` final, que teria de ser refeito. A sugestão fica registrada para a próxima mudança nesse teste. |
| **Adversarial R2-02 (INFO)** — duas fragilidades latentes do E2E: uma microcorrida entre `page.unroute` e o clique (janela de milissegundos), e as 5 fases gastam no pior caso exatamente o `burst` de 5 releituras do agendador | **Registrado** em `testes-e-resultados.md`, como condição de manutenção: não acrescentar uma fase de falha a esse teste sem rever o orçamento. Nas execuções registradas (verde 25/25 e `verify:all`), a coalescência reduziu a 3 releituras. |
| **Adversarial R2-03 (INFO)** — a justificativa do RR-R31-06 era imprecisa | **Corrigida:** o painel precisa só da data de referência e dos totais oficiais. Desacoplá-lo do estado pronto da estimativa é mudança de integração e interface, fora do escopo. Corrigido no plano mestre, no relatório, na matriz e na resposta ao A-02. |
| **Adversarial R2-04 e pt-BR N-01 (INFO)** — o plano mestre e o relatório ainda sem os RR-R31 finais | **Corrigido:** §20.19 do plano mestre e seção J do relatório, com RR-R31-01 a 06. Inclui I-01 a I-03, o pior caso de cerca de 10 min, a divergência de severidade do RR-R31-05 (MEDIUM na financeira, LOW na adversarial) e o I-05. |
| **Financeira F-05 e N-01 (pendências de fechamento)** — §20.19 e os marcadores em `testes-e-resultados.md` e no `LEIAME.md` da evidência | **Corrigido** no fechamento, com o resultado do `verify:all` final e do gate. |
| **Financeira N-02 (INFO, opcional)** — `DATA_MODEL.md:279` poderia remeter ao RR-R31-05 | **Aplicado:** a linha registra a exceção da regra 1 servida do cache e remete ao RR-R31-05. |
| **Financeira V-02 e pt-BR N-02** — `verify-all-2` pendente | Registrado em `testes-e-resultados.md` com o resultado. O gate o confere. |


## Gate (`regression-release-gate`)

| Rodada | Árvore | Decisão | Parecer |
| --- | --- | --- | --- |
| 1 | `6137c2012bd755d75a94229ae9d5a3a54a52c738`, igual a `d9fed573` fora de `docs/` | **PASS.** Nenhum HIGH ou MEDIUM no diff; G-01 (MEDIUM, processo), G-02 (LOW), G-03 a G-05 (INFO) | `gate/PARECER-RODADA-1.md` |

O gate rodou o próprio `verify:all` e a própria etapa E2E em grupos. Também refez a prova vermelha, rodou 3 mutantes seus e reexecutou `ai-backend-only.test.ts` com o índice completo. O que se pediu a ele está em `gate/PEDIDO-GATE.md`, a evidência própria em `gate/evidencia/`, as saídas em `gate/saidas/` e os roteiros em `gate/roteiros/`. A cópia de árvore do gate fica fora da evidência.

| Achado | Resposta |
| --- | --- |
| **G-01 (MEDIUM, processo; fora do diff)** — o `verify:all` não termina verde numa execução só neste ambiente: 0 de 4 na árvore final, a do gate inclusive | **Registrado:** o RR-R31-07 foi elevado a MEDIUM de processo no §20.19, com as quatro execuções. A remediação fica fora do escopo da R3.1 e é condição antes de o CI ou o gate da P5 dependerem do `verify:all`: E2E em grupos ou emulador de Functions reiniciado entre eles, sem aumentar prazos nem repetir asserções. |
| **G-02 (LOW)** — o mecanismo provável da falha do `verify-all-3`: o agente HTTP global do Playwright com `keepAlive: true` e o `keepAliveTimeout` padrão do servidor do emulador | **Registrado como RR-R31-08.** O executor conferiu os dois fatos no ambiente. O `coreBundle.js` do `playwright-core` 1.60.0 cria os agentes globais com `keepAlive: true` e os usa quando a chamada não passa agente. O firebase-tools 15.32.1 não tem `keepAliveTimeout` em `lib/`, e o Node é o 22.23.4. Para o evento, o mecanismo continua sem prova, porque não houve captura de rede. A mitigação vai junto da do RR-R31-07. |
| **G-03 (INFO, fechamento)** — marcadores do veredito vazios e pacote de auditoria não gerado | **Corrigido:** <ul><li>os marcadores foram preenchidos no plano mestre, no `LEIAME.md` da evidência, em `testes-e-resultados.md` e no relatório;</li><li>as execuções do gate estão registradas como 28 (`gate-verify-all`, saída 1, `:169`) e 29 (grupos, 216/216);</li><li>o gate está registrado como 30;</li><li>o pacote foi gerado na árvore final, com este parecer.</li></ul>Depois do parecer, só `docs/` mudou. |
| **G-04 (INFO)** — o projeto não tem instrumentação de cobertura | Sem mudança, porque já era assim antes da R3.1. A comparação continua pela contagem por script e por nome e pelos mutantes. |
| **G-05 (INFO)** — o relatório dizia "sem OOM" logo depois do OOM do `verify-all-4` | **Corrigido:** a seção G do relatório diz que não houve swap e que o único OOM foi o do `verify-all-4`. |
