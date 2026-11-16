# P5-F.1-R3.2 — revisões independentes e respostas do executor

Quatro revisões independentes rodaram sobre as árvores da R3.2, cada uma numa cópia própria, sem Firebase real: quatro
rodadas de todas e mais duas da estabilidade, a última na árvore de código final. Esta página responde a cada achado: o
que mudou, onde e com qual teste, ou por que fica como risco residual. Cada rodada revisou a árvore que o executor
entregou depois de responder à anterior. Os pareceres estão em `<revisão>/PARECER-RODADA-<n>.md`, o pedido de cada
revisão em `<revisão>/PEDIDO.md` e o contexto comum de cada rodada em `COMUM.md`, `COMUM-R2.md`, `COMUM-R3.md` e
`COMUM-R4.md`. O parecer do gate está em `gate/`.

| Revisão | Skill | Rodada 1 (`93668199`) | Rodada 2 (`9fddcb5a`) | Rodada 3 (`ef514869`) | Rodada 4 (`698f9644`; focada) |
| --- | --- | --- | --- | --- | --- |
| Integridade financeira | `financial-domain-integrity` | PASS | **FAIL** (F-08 MEDIUM, aberto pela correção do ADV-01) | PASS (F-R3-01 LOW) | PASS (2 INFO) |
| Adversarial de qualidade e arquitetura, com o custo do Firestore | `firestore-scale-cost-review` | **FAIL** (ADV-01 MEDIUM) | PASS | PASS (ADV-R3-01 LOW) | PASS (2 INFO) |
| Estabilidade do processo de testes, com a prontidão da plataforma | `firebase-production-readiness` | **FAIL** (EST-10 MEDIUM e nenhuma execução oficial válida) | PASS (e `PASS — Firebase production readiness`) | PASS (os dois; EST-R3-01 LOW) | PASS (os dois; EST-R4-01 LOW, corrigido). Rodada 5 (`b2b15267`, interina): FAIL só pela falta de execução oficial válida (EST-R5-01 LOW, corrigido). Rodada 6 (árvore de código final `5ea7fabe`, focada): PASS (os dois; EST-R6-01 LOW, risco residual RR-R32-13) |
| Produto e interface em pt-BR | `ptbr-product-ui-review` | PASS | PASS | PASS (PT-R3-01 e PT-R3-02 LOW) | PASS (PT-R4-01 LOW, documentação; corrigido) |

A ordem dos fatos: o ADV-01 da rodada 1 pediu que a estimativa indisponível aparecesse como está; a correção (todo
estado indisponível sem esperar a prova) abriu o F-08 da rodada 2, porque parte dos estados indisponíveis traz números
das bases; a correção do F-08 (a regra "traz números ou não") deixou passar as rotinas ambíguas, cujo motivo depende dos meses com renda (ADV-R3-01 da rodada 3); a apresentação final é uma lista fechada: só a indisponível **por um motivo decidido antes das receitas** aparece como está.

## Adversarial (rodada 1: FAIL)

| Achado | Resposta |
| --- | --- |
| **ADV-01 (MEDIUM)** estado legitimamente indisponível, com base exata, escondido sem a confirmação do servidor | **Corrigido, e refinado pelo F-08 da rodada 2.** Na rodada 2, `holdEstimate` só segurava a estimativa que converte (`done` com `ready`). Na árvore final, segura toda estimativa que depende das leituras de receita (`dependsOnIncomeReadings`: a pronta, a indisponível com a memória de cálculo preenchida e a de rotinas ambíguas); só a indisponível por um motivo decidido antes das receitas (`DECIDED_BEFORE_INCOME`: fonte PJ sem confirmação, relatório sem bloco exato, desconsiderada sem confirmação) aparece como está, com o motivo, com ou sem prova e com ou sem sincronização em curso. Testes: a tabela-verdade pura em `work-time-income-estimate.test.ts` (seis motivos × prova × sincronização × falha); no gancho, `work-time-consistency.test.ts` (rotina sem horas e renda ausente sem servidor, com a escuta recusada e com divergência persistente; depois da confirmação, sem conexão, com erro da escuta e com divergência; a transição de indisponível para pronta não converte sem prova); E2E "ADV-01 (R3.2)" em `work-time-p5f.spec.ts` (sem conexão por mais que o tempo de interface, a prévia indisponível só mostra o motivo; vermelha na cópia anterior à correção). A guarda da expressão antiga foi substituída pela nova (`testes-substituidos.md`). Mutantes N17 e N18. |
| **ADV-02 (LOW)** a reconexão sem documento mudado só era coberta pelo B03-g | **Corrigido.** O mundo simulado entrega, na volta da conexão, `changes` contado por escuta, como o `docChanges()` do SDK (0 quando nada mudou). O mutante A02 da revisão (N19) morre na unidade (4 falhas) e, pedido da revisão, no B03-g com o mutante aplicado (`testes-e-resultados.md`). |
| **ADV-03 (LOW)** queda de conexão com 12 meses ou com desconsiderada sem teste de comportamento | **Corrigido.** Três testes novos: 12 meses sem desconsiderada, 3 meses com e 12 meses com (o retorno só do cache tira a conversão, sem leitura a mais, e a volta da conexão com `changes: 0` a restaura). O mutante A09 da revisão (N20) morre por comportamento (3 falhas sem a guarda). |
| **ADV-04 (LOW)** RB-09 e `e2e:kill-ports` sem as portas 9299 e 9499 | **Corrigido.** `package.json:46`, RB-09, e um teste que exige a mesma lista de portas no `e2e:kill-ports` e no executor (`e2e-grupos.test.mjs`). |
| **ADV-05 (INFO)** janela de detecção da queda pelo SDK | **Risco residual RR-R32-07**, no relatório e no plano. Sem o evento `offline` do navegador, a confirmação dura até o SDK passar a `Offline` (próxima falha do canal ou 10 s). |
| **ADV-06 (INFO)** título inexato | **Corrigido**: "R3.1: com a sincronização em curso (uma base e nenhuma desconsiderada; a base em releitura ainda diverge da projeção)". |
| **ADV-07 (INFO)** comentário com caminho inexistente | Já corrigido na árvore revisada. |
| **ADV-08 (INFO)** mês corrente com desconsiderada no próprio mês fora da matriz | **Corrigido** com o teste do F-04 (desconsiderada `r1103`, de novembro, no mês corrente). |

## Estabilidade (rodada 1: FAIL)

| Achado | Resposta |
| --- | --- |
| **EST-10 (MEDIUM)** a saída 0 do `verify:all` não prova que a integração e as Rules terminaram | **Corrigido no projeto.** Marco de fase completa (`tools/integracao/marco-da-fase.mjs`): `iniciar` antes do `emulators:exec`, `concluir` como último passo da cadeia e `conferir` depois. A cadeia interrompida por sinal, que o firebase-tools encerra com 0, reprova (`package.json:54`; RB-03). Testes: `tests/tools/integracao-marco.test.mjs` (os passos do marco; a fiação com todas as 19 suítes de Rules; o script oficial com `firebase` e `npm` falsos: interrompido reprova, completo aprova, suíte que falha reprova), no `verify:fast` e no CI. Vermelho no script anterior. E no gate: contagem por suíte. O `predeploy:rules` tem o mesmo mecanismo e fica fora da etapa (RR-R32-08, P6). |
| **EST-01 (LOW)** o caminho de portas do executor sem teste | **Corrigido.** A espera foi para `tools/e2e/portas.mjs`; o prazo vem de `E2E_PORT_WAIT_MS`, que só encurta (0 a 60 s). Testes: o auxiliar (porta presa até o prazo; porta que libera no meio); o executor com a porta presa antes do primeiro grupo (saída 1, nenhum grupo, o ouvinte continua vivo), presa depois do último grupo e depois do primeiro ("ainda em uso", o grupo 2 não roda) e liberada em poucos segundos (saída 0). Mutantes P01 a P06. |
| **EST-02 (LOW)** interrompido por SIGTERM, o fluxo deixava o Emulator do grupo de pé | **Corrigido.** O Playwright de cada grupo roda num grupo de processos próprio; SIGINT, SIGTERM, SIGHUP e (desde a rodada 2, EST-12) SIGQUIT ao executor viram um SIGINT ao grupo em curso (o Ctrl+C do Playwright, que desliga o Emulator pelo `gracefulShutdown`); os grupos seguintes não rodam; saída 128 + o sinal. Testes com o executor de verdade e um `npx` falso em cadeia (`npx` → `sh` → o processo que trata o sinal, como na cadeia real): SIGTERM ao executor, SIGTERM ao grupo de processos dele, Ctrl+C, SIGHUP, SIGQUIT, o sinal entre os grupos e o sinal depois do último (EST-11). Vermelho no executor anterior. RB-04 diz como interromper e o que fazer depois. Mutantes S01 a S09 e T01, todos mortos (execução 48). |
| **EST-03 (LOW)** RR-R31-08 sem mitigação | **Risco aceito por escrito, com gatilho** (D-P5F1-R32-03; RR-R32-03). A hipótese não foi comprovada para o emulador real (E3b/E3c: 0/100), e o `Connection: close` só no preparo não a afastaria: um pedido com ele ainda reaproveita um soquete livre deixado por outro pedido do mesmo contexto (`route.fetch`). Gatilho: qualquer `socket hang up` ou `ECONNRESET` numa execução oficial leva ao endurecimento de todo o tráfego do `APIRequestContext` antes da execução seguinte, sem repetir a execução até passar. A falha é visível (sem nova tentativa e com a lista conferida). |
| **EST-04 (LOW)** documentos contraditórios com o CI fixado | **Corrigido.** RB-01 (firebase-tools 15.32.1 e Java 21), FIREBASE_PRODUCTION §15, THREAT_MODEL T-27 e SECURITY_MODEL, com as linhas atuais do CI; RB-09 e `e2e:kill-ports`. O aviso de versão do firebase-tools no executor não foi feito (opcional); o RB-01 diz a versão validada. |
| **EST-05 (LOW)** fluxo novo não exercitado no CI; capacidade do runner desconhecida | **Risco residual RR-R32-05** (externo): confirmar a classe do runner e medir na primeira execução do CI; `E2E_SHARDS` (1 a 12) é o ajuste. |
| **EST-06 (INFO)** grupos oficiais não são os da R3.1 | **Corrigido** o comentário de `grupos.mjs`; a divisão real está em `fluxo-e2e-oficial.md`. |
| **EST-07 (INFO)** comentário impreciso sobre zerar dados | **Corrigido** em `executar-em-grupos.mjs`. |
| **EST-08 (INFO)** argumentos que mudam o critério | **Corrigido**, e na rodada 2 trocado por uma lista do que é aceito (ADV-R2-03, EST-13): só arquivos e linhas, `-g`/`--grep`, `--grep-invert`, `--project`, `--trace`, `-x` e `--max-failures` (`grupos.mjs:52-77`); qualquer outra opção é recusada, também nas formas curtas combinadas (`-xj2`, `-xc`, `-xu`) e `--debug`. Teste com as recusas e as aceitas; mutantes G08, G09, A01 e A02. |
| **EST-09 (INFO)** registros | Sem ação. |

## Integridade financeira (rodada 1: PASS)

| Achado | Resposta |
| --- | --- |
| **F-01 (LOW, anterior à R3.2)** virada do mês: a janela anterior continua provada até a releitura das bases | **Risco residual RR-R32-06** (atraso de fronteira de período; valores sempre da janela mostrada, sem mistura). Etapa própria. |
| **F-02 (INFO)** só o indisponível sem bloco exato dispensava a confirmação | **Resolvido pelo ADV-01, pelo F-08 e pelo ADV-R3-01**: a indisponível decidida antes das receitas aparece como está; a que depende delas espera a prova, como a pronta. |
| **F-03 (INFO)** a dispensa sem bloco exato dependia de duas expressões separadas | **Corrigido.** Sem bloco exato, nada é provado (`reason: 'inexact'`, `consistency.ts`); a indisponível decidida antes das receitas (`report_unavailable`) aparece pelo `holdEstimate`, sem depender da prova. Uma estimativa pronta com base não exata nunca converteria. Testes: a prova pura e a guarda; mutante N07. |
| **F-04 (INFO)** reforços de teste | **Adotados**: base abaixo da projeção, mês corrente com desconsiderada no próprio mês, janela ampliada e reduzida na mesma montagem. |
| **F-05 (INFO, backend)** correção de lançamento confirmado com data futura sem caso explícito | Fora da etapa (o backend não muda); fica como sugestão para a etapa do caixa. A regra é a mesma da criação, e a revisão executou o esquema compilado: recusado. |
| **F-06 (INFO)** o mundo simulado não reproduzia a volta da conexão só com metadados | **Corrigido** com o ADV-02. |
| **F-07 (INFO, processo)** a execução oficial não terminou, e o `&&` seguiu depois da interrupção | **Corrigido** com o EST-10; a execução oficial final é a do `testes-e-resultados.md`, conferida por contagem. |

## Produto e interface em pt-BR (rodada 1: PASS)

| Achado | Resposta |
| --- | --- |
| **PT-R32-01 (INFO)** o aviso do topo orienta de forma indireta | Registrado no relatório (impactos da sincronização demorada); sem mudança de interface nesta etapa. |
| **PT-R32-02 (INFO)** sem conexão, o motivo não cita a conexão | Idem. O texto genérico foi aceito na R3 e é verdadeiro. |
| **PT-R32-03 (INFO)** itens I-02 a I-06 da R3.1, mais frequentes | Registrados no relatório, com os riscos RR-R31-03, RR-R31-04 e RR-R31-06 atualizados. |
| **PT-R32-04 (INFO)** relatório inexistente | O relatório usa a redação da seção 7 da revisão. |
| **PT-R32-05 (INFO)** 1ª execução do p5f estourou o prazo | Causa registrada (execução 18 de `testes-e-resultados.md`): `dist/` de produção reaproveitado, sem o botão de login do E2E; a execução foi inválida, e a seguinte, com build novo, passou 19/19. |

## Rodada 2

### Integridade financeira (rodada 2: FAIL)

| Achado | Resposta |
| --- | --- |
| **F-08 (MEDIUM)** a estimativa indisponível com números das bases aparecia sem prova (aberto pela correção do ADV-01): valores de estado misto na memória de cálculo (R$ 10.260,00 no lugar de R$ 10.560,00), "Não há receitas efetivadas…" falso e o mês de setembro com R$ 3.300,00 na divergência persistente | **Corrigido como a revisão sugeriu.** Sem prova, só aparece a indisponível por um motivo decidido antes de qualquer receita (na rodada 3, a regra estrutural "traz números" foi trocada por essa lista, ADV-R3-01); a com números (a memória de cálculo preenchida: `no_income`, `no_work_minutes`, `income_too_low`, `income_too_high`, `work_minutes_too_high`, `hourly_rate_too_low`) espera a prova e o fim da sincronização, como a pronta (`dependsOnIncomeReadings` e `holdEstimate`). Testes: a tabela-verdade (`work-time-income-estimate.test.ts`, cada motivo conferido contra `UNAVAILABLE_REASON_TEXT`); no gancho, o bloco "o estado indisponível" de `work-time-consistency.test.ts` (29 testes: sem números e com números × sem retorno do servidor, escuta encerrada e divergência persistente; depois da confirmação; as sondas R2-01, R2-02 e R2-03 da revisão; a passagem da fonte PJ para a renda confirmada com a escuta recusada; o ADV-R2-07). Mutantes N17, N18, N21 e N22 (execução 50). |
| **F-01 (LOW, anterior à R3.2)** | Continua **RR-R32-06** (agora no plano). |
| **F-05 (INFO, backend)** | Fora da etapa, como na rodada 1. |

### Adversarial (rodada 2: PASS)

| Achado | Resposta |
| --- | --- |
| **ADV-R2-01 (LOW)** o indisponível sem prova trazia motivo e memória de cálculo de leituras não confirmadas | **Corrigido com o F-08** (o mesmo defeito). |
| **ADV-R2-02 (LOW)** os testes não distinguiam o SIGINT ao grupo do SIGINT ao PID (T01 sobrevivia) | **Corrigido.** O `npx` falso sobe um `sh -c` e, dentro dele, o processo que trata o sinal, como na cadeia real (`npm exec` → `sh` → `node`): só o sinal ao grupo chega a ele. O T01 morre (execuções 43 e 48). |
| **ADV-R2-03 (LOW)** opções curtas combinadas e `--debug` escapavam da recusa | **Corrigido** com a lista do que é aceito (EST-08 acima). |
| **ADV-R2-04 (INFO)** `E2E_PORT_WAIT_MS=0` com a porta ocupada sem teste | **Corrigido.** O teste do auxiliar confere o prazo 0 com a porta ocupada e livre (`e2e-grupos.test.mjs:344-362`); mutante T03. |
| **ADV-R2-05 (INFO)** sinal só a um processo acima do executor | **Documentado no RB-04**: interromper pelo Ctrl+C, pelo grupo de processos (`kill -TERM -- -<pgid>`) ou pelo próprio executor; o SIGTERM só ao `npm` de cima deixa o executor órfão. |
| **ADV-R2-06 (INFO, anterior à R3.2)** com desconsiderada, antes do primeiro retorno do servidor, "calculando" sem prazo, e com a escuta encerrada "Não foi possível confirmar…" no lugar do motivo | **Documentado no RR-R32-01**, sem mudança: comportamento da R3.1, sem conversão. A leitura por id das desconsideradas só começa com a projeção confirmada. |
| **ADV-R2-07 (INFO)** a troca da falha por "em atualização" passado o tempo de interface só era fixada pela guarda | **Corrigido.** Teste do gancho com a escuta encerrada e o relógio passado do tempo de interface (`work-time-consistency.test.ts:1981`); o B08 da revisão (N23) morre por comportamento, e o B09 (N24) também (execução 50). |

### Estabilidade (rodada 2: PASS)

| Achado | Resposta |
| --- | --- |
| **EST-11 (LOW)** os testes do EST-02 deixavam vivos quatro mutantes (R01 SIGHUP, R02 PID, R03 sinal sem grupo em curso, S06 sinal depois do último grupo) | **Corrigido.** Testes novos: SIGHUP e SIGQUIT (`e2e-grupos.test.mjs:537`), o sinal durante a espera das portas entre os grupos (`:557`; o grupo 2 não roda, saída 143) e o sinal depois do último grupo (`:573`; saída 143, nunca "ok"); o R02 com o `npx` em cadeia (ADV-R2-02). Os mutantes viraram S07 (R01), S09 (R03), T01 (R02) e S06: mortos (execução 48). As contagens dos rascunhos foram corrigidas. |
| **EST-12 (INFO)** caminhos de interrupção não cobertos | (a) **SIGQUIT tratado** como os outros (`executar-em-grupos.mjs:66`), com teste e mutante S08. (b) e (c) **RB-04**: o sinal precisa chegar ao executor ou ao grupo inteiro; com o sinal ao grupo, o `npm` e o `sh` saem na hora e o executor termina o desligamento sozinho: esperar a linha final do executor ou as portas livres. (d) **Documentado, sem mudança**: cada sinal vira um SIGINT, e o segundo força a saída do Playwright e pode deixar o Emulator de pé (cabeçalho do executor, RB-04 e RR-R32-04); repassar só o primeiro tiraria o jeito de forçar a saída. |
| **EST-13 (INFO)** `-xj2`, `-xc`, `-xu` e `--debug` escapavam | **Corrigido** com a lista do que é aceito (EST-08). |
| **EST-14 (INFO)** o marco não é amarrado à cadeia que o fecha | **Risco residual RR-R32-10**, sem mudança: exige uma cadeia órfã viva entre duas execuções que alcance o Emulator novo e, depois, uma interrupção da execução nova; o gate confere a contagem por suíte e a ausência de "Received SIG" na fase. A amarração pelo identificador exigiria substituição de comando do shell no script do `package.json`. |
| **EST-15 (INFO)** os relatórios por grupo e os logs do Emulator da execução oficial foram apagados pela execução seguinte | **Corrigido no procedimento**: o `run-oficial.sh` copia `test-results/e2e-grupos/` e `test-results/grupo-*/` para `logs/<rótulo>-artefatos/` antes de qualquer outra execução; os da execução oficial final estão no pacote. Na execução 37, a evidência ficou no log (execução 38 do histórico). |
| **EST-05 (LOW)** | Continua **RR-R32-05**, com a medida da execução oficial final (pico de memória por grupo). |

### Produto e interface em pt-BR (rodada 2: PASS)

| Achado | Resposta |
| --- | --- |
| **PT-R32-06 (INFO)** com alterações não salvas, o "Veja o motivo em Configurações" leva ao motivo do rascunho | **Documentado** nos impactos (seção K do relatório) e no RR-R31-04; sem mudança de interface nesta etapa. A classe já existia na R3.1 (I-05). |
| **PT-R32-07 (LOW, documentação)** frases inexatas nos rascunhos | **Corrigido** nos rascunhos: a linha da escuta encerrada qualificada ("estimativa que converte"), a coluna da R3.1, a espera "não medida", o RR-R32-02 e o RR-R31-04, os textos citados literalmente e as contagens. Com o F-08, a redação da apresentação foi revista de novo (a indisponível com números espera a prova). |
| **PT-R32-08 (INFO)** partes do ADV-01 sem prova no projeto | (a) **Corrigido**: os testes do estado indisponível afirmam `refreshFailed` (verdadeiro com a escuta encerrada, falso sem conexão). (b) **Corrigido**: o E2E do ADV-01 imprime as sequências gravadas no log (`[estados-adv-01-sem-conexao]` e `[estados-adv-01]`, `work-time-p5f.spec.ts:1337, 1348`). (c) **Risco de cobertura RR-R32-09**: não há E2E da estimativa em uso indisponível sem conexão nem da indisponível com a escuta encerrada; o gancho cobre os dois. |

## Rodada 3

Na árvore `ef514869`. Os achados da adversarial (ADV-R3-01) e da estabilidade (EST-R3-01) levaram a uma mudança de código; a árvore de código final passou a ser `698f9644`, revista na rodada 4 (focada na mudança).

### Adversarial (rodada 3: PASS; `PASS — Firestore scale/cost review`)

| Achado | Resposta |
| --- | --- |
| **ADV-R3-01 (LOW)** os motivos de rotina ambígua apareciam sem prova, mas dependem dos meses com renda (o corte dos primeiros meses sem renda vem antes da conferência da ambiguidade): motivo falso de estado misto, do cache sem conexão ou da base divergente; regressão em relação à R3.1 | **Corrigido** (a opção b da revisão, sem limitar ao modo habitual). A regra estrutural "traz números" saiu: só a lista fechada `DECIDED_BEFORE_INCOME` (`business_not_confirmed`, `report_unavailable`, `exclusion_unconfirmed`, os motivos devolvidos antes de `applyIncomeExclusions`) aparece sem prova; tudo o mais, inclusive um motivo novo, espera (`dependsOnIncomeReadings`, `useIncomeEstimateWith.ts`). No mês corrente a ambiguidade não depende da renda, mas espera também: a lista é por motivo, e esperar é o lado seguro. Testes: a véspera reduzida ambígua no laço da indisponível que depende das receitas (3 condições), as sondas R3-P1, R3-P2 e R3-P3 com asserções, a tabela-verdade e a guarda (a ordem dos motivos em `computeWorkTimeEstimate`); vermelhos em `ef514869` (execução 57). Mutantes N22, N25 e N26 (execução 59). O E2E das rotinas ambíguas (B02, S01) passa (execução 61). |
| **ADV-R3-02 (INFO)** o RR-R32-02 não dizia que a indisponível com números também espera | **Corrigido** no plano e no relatório. |
| **ADV-R3-03 (INFO)** o repasse do segundo sinal (U01) e o grupo morto por sinal como falha (U17) sem teste | **Corrigido**: dois testes novos do executor; U01, U17 e o `process.once` (S10) morrem (execução 59). |

### Estabilidade (rodada 3: PASS; `PASS — Firebase production readiness`)

| Achado | Resposta |
| --- | --- |
| **EST-R3-01 (LOW)** o `firebase-debug.log` por grupo, prometido pelo RB-04 e pelo D-P5F1-R32-03, não existia: o firebase-tools o apaga ao sair limpo | **Corrigido.** O executor faz um link físico do arquivo em `test-results/grupo-i/` enquanto o grupo roda (o Playwright apaga a pasta antes de subir o Emulator, então o link é feito depois); no fim, só copia o que o link não guardou. Teste com o falso `npx` que apaga o log na saída; vermelho no executor anterior (execução 58); mutante K01. |
| **EST-R3-02 (INFO)** cinco mutantes do caminho de interrupção sobreviviam | **Corrigido** com testes: o segundo sinal (U01 e `process.once`), o sinal antes do primeiro grupo, o grupo morto por sinal (U17) e o relatório de uma execução anterior (X09). Todos mortos (execução 59). |
| **EST-R3-03 (INFO)** rascunhos desatualizados (`mutantes.md` da rodada 1; a execução 22 simplificada) | **Corrigido**: `mutantes.md` é refeito das execuções finais; o `fluxo-e2e-oficial.md` descreve a cadeia órfã da execução 22 como o histórico. |
| **EST-05 e EST-14** | Riscos residuais RR-R32-05 (agora com os picos medidos e a regra do `E2E_SHARDS`) e RR-R32-10. |
| Registro da revisão | Um `git write-tree` rodado por descuido pelo revisor não mudou nada (a árvore já existia; o índice não mudou). |

### Produto e interface em pt-BR (rodada 3: PASS)

| Achado | Resposta |
| --- | --- |
| **PT-R3-01 (LOW, anterior à R3.2)** a memória de cálculo da indisponível sem os totais diz "Você não desconsiderou nenhuma receita." e "Férias, folgas e exceções: nenhuma no período." mesmo quando há desconsiderada ou exceção | **Risco residual RR-R32-11**, documentado na seção K e no plano; etapa própria (os arquivos são iguais aos da R3.1). |
| **PT-R3-02 (LOW, documentação)** trechos dos rascunhos sem o F-08 | **Corrigido** (relatório, linha da escuta encerrada; RR-R32-02; a linha 11 da matriz com o ADV-R2-06; a seção K; o RR-R32-11). |
| **PT-R3-03 (INFO)** o motivo acionável da indisponível com números não aparece enquanto falta a prova | **Documentado** na seção K (item 1). |
| **PT-R32-01 a PT-R32-04** | Documentados na seção K, com a redação da rodada 3, ajustada à regra final (a de rotinas ambíguas passa ao item 1) e conferida na rodada 4. |

### Integridade financeira (rodada 3: `PASS — Financial domain integrity`)

| Achado | Resposta |
| --- | --- |
| F-08 (rodada 2) | **Fechado** pela revisão: as sondas R2-01 a R2-03 reprovam na árvore da rodada 2 e passam na final; a varredura R3-05 vai de 0/30 a 30/30. |
| **F-R3-01 (LOW)** os motivos de rotina ambígua não saem antes da receita, levam notas das bases e aparecem sem prova; um motivo novo com valores sem meses passaria pela regra estrutural | **Corrigido** como a revisão recomendou (o mesmo do ADV-R3-01): a lista fechada dos três motivos decididos antes de qualquer receita, fail-closed para motivos novos. |
| **F-R3-02 (INFO, anterior)** a memória de cálculo de uma indisponível sem valores diz "Você não desconsiderou nenhuma receita." | O mesmo do PT-R3-01: **RR-R32-11**. |
| **F-R3-03 (INFO, testes)** | Ver a rodada 4. |
| F-01 (LOW, anterior) e F-05 (INFO, backend) | RR-R32-06, agora no plano (§20.20); F-05 fora da etapa. |

## Rodada 4

Focada na mudança de `ef514869` para a árvore de código final `698f9644` (`revisoes/COMUM-R4.md`).

### Produto e interface em pt-BR (rodada 4: PASS)

| Achado | Resposta |
| --- | --- |
| **PT-R4-01 (LOW, documentação)** sete pontos da seção K e dos rascunhos não acompanhavam o ADV-R3-01 (a frase das rotinas ambíguas sem verbo e sem os textos; "números confirmados" para quem não os traz; o motivo "não está em Configurações", mas o aviso do editor mostra a causa; uma frase truncada; o preâmbulo; três trechos do plano; a linha 11 da matriz com 29 testes e N21 a N24) | **Corrigido** com a redação da seção 7 do parecer: preâmbulo da seção K, itens 1, 2 e 5, plano (RR-R32-02, RR-R32-09, PT-R3-03) e matriz (35 testes; N17, N18, N21 a N26). |
| **PT-R3-01 (LOW, anterior à R3.2)** | Continua **RR-R32-11**, agora também para as ambíguas depois da confirmação; etapa própria. |
| Fechados | PT-R3-02 e PT-R32-04 corrigidos; PT-R3-03 e PT-R32-01 a 03 documentados na seção K. Nenhuma interface mudou desde a rodada 3 (mesmos hashes). |

### Integridade financeira (rodada 4: `PASS — Financial domain integrity`)

| Achado | Resposta |
| --- | --- |
| F-R3-01 | **Fechado** pela revisão: a lista fechada `DECIDED_BEFORE_INCOME` é a classificação certa pelo critério do F-08 (os três motivos saem com a base vazia, antes de qualquer receita; numa propriedade com 2.016 estimativas, nenhum traz valor nem nota das bases, e um motivo novo espera a prova); as sondas R3-01, R3-02 e R4-03 reprovam em `ef514869` e passam em `698f9644`; 14 dos 15 mutantes dela morrem por comportamento. |
| **F-R3-03 (INFO, testes, reduzido)** nenhum teste do gancho tem a indisponível que depende das receitas, provada, durante uma releitura (o mutante Q12 da revisão morre só pela guarda); `ambiguous_routines` e o `exclusion_unconfirmed` mostrado como está só têm teste de gancho nas sondas da revisão | **Risco de cobertura, no RR-R32-09**, com o ADV-R4-02: a guarda fixa a chamada do `holdEstimate` com a sincronização, e a tabela-verdade, a decisão para cada motivo. Testes do gancho para esses casos exigiriam mudar a árvore de código final de novo. |

### Adversarial (rodada 4: PASS; `PASS — Firestore scale/cost review`)

| Achado | Resposta |
| --- | --- |
| ADV-R3-01, ADV-R3-02 e ADV-R3-03 | **Fechados** pela revisão: nas sondas R3-P0 a R3-P3, o motivo de rotina ambígua falso não aparece; o ADV-01 vale para os três motivos da lista; a guarda da ordem confere a posição dos motivos, e a troca de insumos (mutante D09 da revisão) morre nos testes de comportamento; U01 e U17 morrem. |
| **ADV-R4-01 (INFO)** `DATA_MODEL.md` com a regra da rodada 3 ("sem números") | **Corrigido** no documento (só `docs/`, depois da execução oficial). |
| **ADV-R4-02 (INFO)** o `exclusion_unconfirmed` mostrado sem prova não tem teste no gancho; o mutante que o tira da lista morre só pela tabela-verdade e pela guarda | **Risco de cobertura, no RR-R32-09**: a tabela-verdade afirma o comportamento para os três motivos da lista, e a guarda confere a lista e a ordem do cálculo. Um teste do gancho exigiria mudar a árvore de código final depois da execução oficial. |

### Estabilidade (rodada 4: PASS; `PASS — Firebase production readiness`)

| Achado | Resposta |
| --- | --- |
| EST-R3-01, EST-R3-02 | **Fechados** pela revisão: o link físico conferido (a limpeza do Playwright acontece antes do Emulator subir; a cópia sobre o próprio link não acontece; o grupo sem log não guarda nada) e numa execução real (dois links durante o grupo 1 da `verify-all-r32-6`); os três `firebase-debug.log` dela existem, cada um do próprio grupo, só com o projeto local; os cinco mutantes sobreviventes da rodada 3 morrem; 57/57 do roteiro. A `verify-all-r32-6` conferida por contagem. |
| **EST-R4-01 (LOW)** o teste novo do segundo sinal travava quando o primeiro SIGINT não chegava ao grupo (S01, S05): o falso `npx` ficava órfão com o pipe e prendia o processo dos testes; no CI, sem `timeout-minutes`, o job travaria em vez de falhar | **Corrigido**: o `finally` do ajudante encerra o falso `npx` em curso e os pipes do executor; S01, S05 e U01 reprovam em 149 s, sem órfão (execução 64). Nova árvore de código final `5ea7fabe`, com nova execução oficial (execução 66) e a rodada 5 da estabilidade. |
| **EST-R4-02 (INFO)** a falha ao criar o link é silenciosa; um log que sobra na raiz (só depois de uma saída suja) recebe o da execução seguinte | **Risco residual INFO**, registrado: sem o link, a cópia do fim do grupo ainda vale quando o arquivo existe; o caso só aconteceu com a execução interrompida pelo reinício (62), cuja evidência do grupo 3 ficou marcada como não confiável no histórico. |
| **EST-R4-03 (INFO)** o histórico dizia que o grupo 3 da execução 62 parou pelo caminho limpo | **Corrigido** no histórico: o CLI foi morto pelo reinício. |
| EST-R3-03 (parcial) | `mutantes.md` refeito das execuções finais. |

### Estabilidade (rodada 5: interina, FAIL só pela falta de execução oficial válida na árvore `b2b15267`)

| Achado | Resposta |
| --- | --- |
| Incidente (execução 66) | O roteiro da própria revisão encerrou com SIGKILL processos de um teste da `verify-all-r32-7`, que reprovou; registrado no histórico com a evidência dela. A revisão passou a só encerrar processos que ela mesma criou. |
| **EST-R5-01 (LOW)** a limpeza nova do ajudante mandava SIGKILL, no caminho normal, a um PID e a um grupo que já tinham saído (um PID reaproveitado levaria o sinal a um processo alheio) | **Corrigido** (árvore `5ea7fabe`): a limpeza só acontece no caminho de erro; o executor, só se ainda é filho deste processo; o falso `npx`, só se o `STUB_DIR` deste teste está no ambiente dele (`/proc/<pid>/environ`); os pipes são fechados. S01, S05 e U01 reprovam em 149 s, sem órfão (execução 68). Uma primeira versão deixava um falso `npx` órfão com o S05 (execução 67). |
| **EST-R5-02 (INFO)** o `run-oficial.sh` guardava como artefatos de uma execução os relatórios de outra | **Corrigido** no roteiro: só guarda as pastas com arquivos mais novos que o início da execução. |
| EST-R4-02, EST-R4-03, EST-R3-03 | Como na rodada 4 (o histórico da execução 62 foi corrigido; `mutantes.md` refeito das execuções finais). |

### Estabilidade (rodada 6: PASS; `PASS — Firebase production readiness`)

Na árvore de código final `5ea7fabe`, focada na limpeza do ajudante e na execução oficial `verify-all-r32-9`.

| Achado | Resposta |
| --- | --- |
| `verify-all-r32-9` e EST-R5-01 | **Conferidos** pela revisão: a execução confere por contagem (1.843, 1.289 com as 19 suítes de Rules e o marco, 218 do E2E iguais aos da `verify-all-r32-6` por arquivo, título e linha), os artefatos são desta execução, com o `firebase-debug.log` de cada grupo; S01 e S05 reprovam sem travar e sem órfão, U01, S10 e U17 morrem, e a limpeza não age no caminho normal. |
| **EST-R6-01 (LOW)** no caminho normal, o ajudante ainda confere e encerra o falso `npx` pelo número do PID (`e2e-grupos.test.mjs:517-533`), sem o `ownStub` | **Risco residual RR-R32-13**, sem mudança: exige que o contador de PIDs (`pid_max` 32768 neste contêiner, alocação sequencial) dê a volta inteira em menos de um segundo, e o teste reprova se acontecer (sem PASS falso). A correção muda a árvore de código depois da execução oficial; fica para a próxima mudança do executor. |
| **RR-R32-12** (a falha da `verify-all-r32-8`) | **Classificação confirmada** pela revisão (falso positivo de um teste do backend anterior à etapa; o mesmo teste passou nas execuções r32-2 a r32-6 e na r32-9). As duas ressalvas foram atendidas: o destino da correção (pré-requisito do fechamento da P5, numa etapa que possa mudar os testes do backend) e o critério do gate (só é este falso positivo quando o log mostra a palavra dentro de um identificador gerado; a execução continua reprovada no histórico, e nunca se repete só o teste), no plano e no relatório. |
| **EST-R6-02 (INFO)** as pastas de artefatos da `verify-all-r32-7` e da `verify-all-r32-8` guardam os da `verify-all-r32-6` (rodaram antes da correção do EST-R5-02) | **Registrado**: as duas execuções não chegaram ao E2E; o pacote não leva essas duas pastas, só as da `verify-all-r32-4`, da `verify-all-r32-6`, da `verify-all-r32-9` e da execução do gate. |
| EST-R4-02 (INFO) e EST-R3-03 (INFO) | O EST-R4-02 continua como na rodada 4. O EST-R3-03 foi resolvido: `mutantes.md` foi refeito das execuções finais na árvore `5ea7fabe`. |

## Gate da etapa (`regression-release-gate`, rodada 1: PASS)

Na árvore final com os documentos `3bf21397` (fora de `docs/`, igual à de código final `5ea7fabe`), com a execução própria do gate (`gate-verify-all-r32`: saída 0, 2.902 s; unidade 1.843, integração e Rules 1.289 com a fase completa, E2E 218 em 3 grupos com as chaves iguais às da `verify-all-r32-9`). Parecer em `gate/PARECER-RODADA-1.md`, pedido em `gate/PEDIDO-GATE.md`, saídas em `gate/saidas/`.

| Achado | Resposta |
| --- | --- |
| **G-R32-01 (LOW, anterior à etapa)** o teste de `producers.integration.test.ts` dá falso positivo quando um identificador aleatório contém "9990" | É o **RR-R32-12**, com o destino da correção e o critério do gate no plano (§20.20); o teste passou na execução do gate. |
| **G-R32-02 (LOW)** o ajudante de `tests/tools/e2e-grupos.test.mjs` encerra o falso `npx` pelo número do PID, sem o `ownStub` | É o **RR-R32-13**, aceito como risco residual. |
| **G-R32-03 (INFO, anterior)** sem commit, a guarda de IA da execução oficial só vê o índice do HEAD | É o **RR-R3-12**; o gate a reexecutou com o índice completo numa cópia própria: 5/5. |
| **G-R32-04 (INFO)** o repositório não tem ferramenta nem baseline de cobertura | Sem mudança; o gate comparou por contagem e nome dos testes, sem redução. |
| **G-R32-05 (INFO)** o veredito ainda estava como "XXX" no `LEIAME.md` da evidência e no estado do plano | **Corrigido** depois do gate, só em `docs/`: o veredito PASS está no `LEIAME.md`, no plano (§20.20 e tabela de milestones) e no relatório. |
