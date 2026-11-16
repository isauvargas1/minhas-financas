VEREDITO: PASS

# Revisão adversarial de qualidade e arquitetura, P5-F.1-R3.2, rodada 2 (Frentes A e B)

Árvore revisada: `9fddcb5ad93f030bcd991820db85ca9a2b233976`. O veredito é PASS porque não há HIGH nem MEDIUM em aberto.
Os oito achados da rodada 1 estão fechados: o ADV-01 por código, testes e E2E vermelho/verde; o ADV-05 como risco
residual escrito. Tentei quebrar as correções novas e não achei nenhum caminho em que uma conversão chegue à tela sem
prova. Ficam três achados novos LOW e quatro INFO, nenhum de conversão:

- o indisponível mostrado sem prova pode trazer motivo e memória de cálculo de leituras não confirmadas (ADV-R2-01);
- os testes do executor não distinguem o SIGINT ao grupo do SIGINT ao PID (ADV-R2-02);
- a recusa de argumentos deixa passar opções curtas combinadas e `--debug` (ADV-R2-03).

Veredito da skill `firestore-scale-cost-review`: **PASS** (seção 7).

## 1. Escopo conferido

- **Cópias.** Uma de `git archive` da árvore em `rodada-2/copia`, com `cmp`/`diff -rq` contra o worktree: idêntica, salvo
  o `firestore-debug.log` da execução oficial. Outra, igual, em `rodada-2/copia-sonda`, para as sondas. Não alterei o
  worktree nem o índice: o arquivo do índice do worktree continua com a data de 11:47:49.
- **Diff desde a rodada 1** (`93668199..9fddcb5a`): `consistency.ts`, `useIncomeEstimateWith.ts`, os testes de unidade,
  o E2E do ADV-01, `tools/e2e/*`, `tools/integracao/marco-da-fase.mjs`, `tests/tools/*`, `package.json`, CI e
  documentos. `basisSync.ts`, `reports/hooks.ts`, `incomeReads.ts`, `firestore.rules`, `firestore.indexes.json` e
  `functions/` não mudam desde a R3.1 (`git diff --stat efcbd264..9fddcb5a` vazio para eles).
- **Consumidores da estimativa**, relidos: `WorkTimeContext.tsx`, `display.tsx`, `Header.tsx`, `EstimateDetails.tsx`,
  `IncomeEditor.tsx`, `WorkTimeWizard.tsx` e `WorkTimeSettingsView.tsx`. Também o uso do cache do React Query nas bases
  (`basisSync.ts:121-161`).
- **Evidências do executor:** os logs da rodada 2, o `error-context` da prova vermelha, as cópias vermelhas
  (`copia-adv01-pre`, `copia-a02`, `copia-n16`; comparei cada uma com a árvore final, arquivo a arquivo) e o
  histórico.

## 2. Comandos executados e resultados

Tudo com `nice -n 19`, um de cada vez, nas minhas cópias. Não rodei Emulator, Playwright, E2E nem `verify:*`. Logs em
`<scratchpad>/p5f1r32/revisoes/adversarial/rodada-2/logs/`.

| Comando (na cópia) | Resultado | Log |
| --- | --- | --- |
| Conjunto `test:unit:work-time` (10 arquivos) | 261/261, saída 0 | `unit-work-time-9fdd.log` |
| Conjunto `test:unit:reports` (7 arquivos) | 107/107, saída 0 | `unit-reports-9fdd.log` |
| `node --test tests/tools/e2e-grupos.test.mjs` | 15/15, saída 0 | `tools-e2e-9fdd.log` |
| `node --test tests/tools/integracao-marco.test.mjs` | 3/3, saída 0 | `tools-integracao-9fdd.log` |
| `npx tsc --noEmit` | saída 0 | `tsc-raiz-9fdd.log` |
| Mutantes da Frente A: A01–A09 da rodada 1 e B01–B12 novos (`scripts/mutantes-adv-r2.py`, falhas separadas por arquivo) | 21/21 mortos; 20 por comportamento; o B08 só pela guarda | `mutantes-adv-r2.log` |
| Mutantes da Frente B: T01–T08 (`scripts/mutantes-frente-b-r2.py`) | 6/8 mortos; **T01 e T03 sobrevivem** | `mutantes-frente-b-r2.log` |
| Sondas S1–S4 anexadas a uma cópia do teste do gancho, fora do repositório (`scripts/sonda-r2.ts.txt`) | comportamento registrado (ADV-R2-01, ADV-R2-06) | `sonda-r2.log` |
| O commander que o Playwright 1.60 empacota (só o analisador de opções) e a recusa do executor (`scripts/commander-combinado.cjs`, `scripts/recusa.mjs`) | `-xj2`, `-xc <arquivo>` e `-xu` são lidos como `-x` mais `--workers`, `--config` e `--update-snapshots`, e o executor os aceita | `commander-combinado.log`, `recusa-argumentos.log` |
| Experimento com o `npx` e o `npm run` reais e um "neto" falso, sem Playwright nem portas (`scripts/exp-npx/`) | a árvore real é `npm exec` → `sh` (dash) → `node`; resultados nos achados ADV-R2-02 e ADV-R2-05 | `experimento-npx-sinal.log` |
| Experimento `sh -c "node --test <teste longo>; …"` com SIGINT ao grupo e só ao `node --test` (`scripts/exp-node-test/`) | ao grupo: o `sh` morre pelo sinal; só ao `node --test`: saída 1 | `experimento-node-test-sigint.log` |

### Mutantes da Frente A

| Mutante | Resultado |
| --- | --- |
| A01 `holdEstimate` ignora a sincronização | morto (pura e gancho de 12 meses em `work-time-income-estimate`) |
| A02 a volta da conexão sem documento mudado não restaura a confirmação | **morto por comportamento** (4 testes do gancho; na rodada 1 sobrevivia) |
| A03, A04, A05, A06, A07, A08 | mortos por comportamento |
| A09 o retorno do cache só derruba a confirmação com uma base | **morto por comportamento** (3 testes do ADV-03; na rodada 1, só a guarda) |
| B01 `holdEstimate` de antes do ADV-01 | morto (13 testes do gancho) |
| B02 a pronta provisória (mês incompleto ou menos meses) passa sem prova | morto (3 do gancho) |
| B03 a pronta com `refreshFailed` (inclusive escuta encerrada) passa sem prova | morto (15) |
| B04 o indisponível espera a prova, mas não a sincronização | morto (15) |
| B05 o `no_income` espera a prova | morto (3) |
| B06 F-03 desfeito; B07 sem a regra do bloco exato | mortos pelo teste puro das regras e pela guarda. São equivalentes no gancho: nenhuma pronta existe sem bloco exato |
| B08 o tempo de interface troca também a falha por "em atualização" | só a guarda (ADV-R2-07) |
| B09 o indisponível sem prova vira "em atualização" | morto (11) |
| B10 com a escuta encerrada, o indisponível vira o erro | morto (4) |
| B11 a prova não recalcula quando só a confirmação muda | morto (33) |
| B12 a confirmação só volta com documento mudado | morto (5) |

### Mutantes da Frente B

| Mutante | Resultado |
| --- | --- |
| T01 o SIGINT vai só ao PID do `npx`, não ao grupo de processos | **sobrevive** (ADV-R2-02) |
| T02 o executor repassa SIGTERM em vez de SIGINT | morto |
| T03 `E2E_PORT_WAIT_MS=0` pula a conferência das portas | **sobrevive** (ADV-R2-04) |
| T04 no fim do prazo, a porta ocupada vale como livre | morto (3) |
| T05 `conferir` aprova o marco aberto; T06 `iniciar` não troca o marco existente; T07 `concluir` sem marco aberto; T08 `conferir` não apaga o marco | mortos |

## 3. Situação dos achados da rodada 1

| Achado | Situação | Evidência |
| --- | --- | --- |
| ADV-01 (MEDIUM) | **Fechado** | `holdEstimate` só segura `done` com `ready` (`useIncomeEstimateWith.ts:123-129`). Testes: a tabela-verdade (`work-time-income-estimate.test.ts:154`) e os do gancho (`work-time-consistency.test.ts:1686-1805`): sem retorno do servidor, escuta encerrada, sem conexão e divergência persistente; 3 e 12 meses, com desconsiderada; a transição para a pronta com a escuta encerrada. A prova vermelha falha no ponto certo (`e2e-adv01-na-pre-vermelho`, `:1333`; o `error-context` mostra "A estimativa está em atualização…" com "Tentar de novo" no lugar do motivo), e a final passa (`e2e-adv01-r32-1`). Mortos por comportamento: B01, B04, B05, B09 e B10. Fica a consequência de projeto descrita no ADV-R2-01 (LOW). |
| ADV-02 (LOW) | **Fechado** | Na volta da conexão, a falsa escuta conta as mudanças contra o último retorno de cada escuta (`work-time-consistency.test.ts:276-279,305-320`), como as `docChanges` do SDK (seção 4.3). O A02 morre em 4 testes do gancho e o B12 em 5. O B03-g com o A02 falha onde eu tinha previsto (`work-time-b03.spec.ts:778`: `R$ 19.400,00` em vez de `≈ 776 h`). |
| ADV-03 (LOW) | **Fechado** | Três testes novos (`:1807`): 12 meses sem desconsiderada, 3 meses com e 12 meses com. O A09 morre por comportamento. |
| ADV-04 (LOW) | **Fechado** | `package.json:46` inclui 9299 e 9499. O RB-09 foi atualizado (`RUNBOOKS.md:95`). Um teste exige que a lista do `e2e:kill-ports` seja a do executor (`e2e-grupos.test.mjs:140-142`). |
| ADV-05 (INFO) | **Fechado como risco documentado** | RR-R32-07 no rascunho do plano (`evidencia-rascunho/plano-20-20.md:74`). O relatório final ainda não existe (seção 8). |
| ADV-06 (INFO) | **Fechado** | Título corrigido (`:1438`). |
| ADV-07 (INFO) | Fechado na rodada 1 | — |
| ADV-08 (INFO) | **Fechado** | `:1855`: a desconsiderada `r1103` no próprio mês corrente, com o cache aquecido. |

## 4. O que ataquei nas correções novas

### 4.1 `holdEstimate` (ADV-01)

**Nenhuma conversão sem prova.**

- O gancho só devolve `shown` ou um erro (`useIncomeEstimateWith.ts:375-398`).
- `shown` segura toda estimativa `ready` sem prova ou com a sincronização em curso, inclusive a provisória e a com
  `refreshFailed`: os mutantes B02 e B03 morrem.
- Todo consumidor só converte a partir de `ready`:
  - `WorkTimeContext.tsx:127-135`, de onde vêm `display.tsx:76-80` e o topo (`Header.tsx:45-50,532-537`);
  - `EstimateDetails.tsx:55,60-68,97-102,154-155`;
  - o valor em uso de `WorkTimeSettingsView.tsx:448-449`.
- O indisponível não leva valor por hora nem `config` (`estimate.ts:85-93`). O "Receitas consideradas" e a memória de
  cálculo só mostram reais.
- Só o gancho calcula a estimativa (`useIncomeEstimateWith.ts:279`; busca no `src/`).
- **Cache do React Query:** as bases não usam `placeholderData`, `initialData` nem `setQueryData`, e a chave tem a conta
  e o workspace (`basisSync.ts:135`). O cache só entrega dados. A prova vem do `confirmed` da escuta desta montagem.

**Transição de indisponível para pronta.**

- A prova não depende do estado da estimativa. A pronta que nasce de uma mudança de rotina, de modo ou de
  `allowBusinessIncome` passa pelo mesmo portão, na mesma renderização.
- O teste `:1781` (rotina sem horas → com horas, escuta encerrada) cobre o caso. Os mutantes B01 e B04 também.

**Estado indisponível ainda trocado por "calculando".** Só num caso, anterior à R3.2 (ADV-R2-06): com desconsiderada e
antes do primeiro retorno do servidor, a leitura por id não começa, e a estimativa não chega a ser calculada.

### 4.2 F-03 (`consistency.ts:62-65`, `reason: 'inexact'`)

- **`unprovenReason`:** `'inexact'` não está entre os motivos que pedem releitura das desconsideradas
  (`useIncomeEstimateWith.ts:344-356`). O agendador continua cancelado, como antes, quando a regra aprovava.
- **"Em atualização":** só vale para `done` segurado (`:379`). O indisponível sem bloco exato aparece como está.
- **Outros usos de `proof`:** só `holdEstimate` e `unprovenReason`. `ConsistencyReason` não é usado em outro lugar.
- **Nenhuma pronta existe sem bloco exato:** `basis.exact` é `false` ⇒ `reportExact` é `false` (`:170` × `:256-259`) ⇒
  `report_unavailable` (`estimate.ts:164-165`). O F-03 é defesa em profundidade. Por isso B06 e B07 só morrem no teste
  puro e na guarda, como esperado.

### 4.3 O mundo simulado e o SDK (ADV-02/F-06)

- **Saída da conexão.** Com o estado `Offline`, o SDK entrega um retorno de metadados (`fromCache: true`,
  `docChanges` vazio).
- **Volta da conexão.** O retorno `fromCache: false` traz as `docChanges` da visão: só os documentos mudados, ou nenhum.
- **O mundo** (`:268-279,305-320`) reproduz os dois casos, por escuta.
- **Fidelidade sem efeito na prova.** O mundo não modela a retomada em duas etapas (um retorno do cache com as mudanças
  e depois o do servidor sem mudança). A confirmação usa os documentos completos (`basisSync.ts:523-537`), então não
  depende disso; só a releitura da base sem bloco exato depende de `changes` (`:521`). É liveness, anterior à R3.2,
  e não pode converter.
- **Os mutantes da rodada 1 morrem por comportamento:** A02 (4 falhas), B12 (5) e A09 (3, fora a guarda).

### 4.4 O E2E "ADV-01 (R3.2)" (`e2e/work-time-p5f.spec.ts:1277-1352`)

- **O sinal positivo da queda vem antes da janela.** `not.toContainText(approximate)` (`:1330`) espera a estimativa em
  uso perder a conversão. Isso só acontece com o retorno do cache da escuta do provedor, que o SDK entrega a todas as
  escutas na mesma troca de estado (as duas no mesmo cliente). Os 35 s (`:1331`) começam depois.
- **A gravação.** É um `MutationObserver` no `body` e pega os estados que chegam ao DOM entre tarefas. Duas
  renderizações na mesma tarefa poderiam se fundir, mas não há mecanismo que produza um "calculando" curto para o
  indisponível na árvore final. Na cópia anterior, o estado errado é longo e a afirmação final o pega: o
  `error-context` traz "A estimativa está em atualização…" e "Tentar de novo".
- **A afirmação final é forte o bastante.** Exige `[indisponivel|<motivo>]` da gravação até a volta da conexão
  (`:1346`), a conversão em uso de volta, a pronta da prévia depois de "Descartar alterações" e nada gravado.
- **O vermelho prova o que diz.** A cópia anterior difere da final só no `holdEstimate` e em `consistency.ts` (mais
  ferramentas e testes que o E2E não usa).
- **Limitação.** Cobre só `business_not_confirmed`, na janela de 3 meses e sem desconsiderada. Os outros motivos ficam
  com a unidade.

### 4.5 Frente B como código

**Executor** (`tools/e2e/executar-em-grupos.mjs:49-78,133-170`). Não achei saída 0 numa interrupção:

- `interrupted` entra na decisão (`:164`), e a saída é 128 + o sinal (`:170`).
- O sinal durante o `spawnSync` do build ou da lista só é tratado no primeiro `await`. O filho do mesmo grupo morre e o
  executor sai com 1; ou ele termina, e o laço não roda grupo nenhum (`:134`).
- Não há corrida no `current`: `spawn` e `current = child` rodam no mesmo passo síncrono.
- Sinal depois do último `await`: a execução já estava completa.
- O experimento confirma que, com o SIGINT ao grupo, o Playwright recebe o sinal e termina antes do `npx`, que espera o
  `sh`, que espera o neto. A afirmação "nada fica órfão" do teste vale também na árvore real.

Lacunas e órfãos:

- Os testes não distinguem o SIGINT ao grupo do SIGINT só ao PID (ADV-R2-02).
- Sinal só a um ancestral deixa o executor órfão ou sem efeito (ADV-R2-05).
- SIGKILL e o segundo Ctrl+C já estão no RR-R32-04.

**`E2E_PORT_WAIT_MS`** (`grupos.mjs:35-41`, `portas.mjs:21-29`). Não serve para aprovar porta ocupada:

- O valor é inteiro de 0 a 60.000. Com 0, a conferência roda uma vez e devolve a porta ocupada.
- Esse caso não tem teste: T03 sobrevive (ADV-R2-04).

**Recusa de argumentos** (`grupos.mjs:49-53`):

- As formas longa e curta isoladas estão cobertas.
- As opções curtas combinadas e o `--debug` passam (ADV-R2-03).
- Só afeta execuções com argumentos. O procedimento oficial e o CI não passam nenhum.

**Marco de fase completa** (`tools/integracao/marco-da-fase.mjs:41-60`, `package.json:54`). Não achei como a fase
incompleta passaria:

- `concluir` só roda se todas as suítes anteriores saírem com 0 (`&&`; o teste exige que antes dele só haja
  `npm run <suíte>`).
- `iniciar` sempre grava um marco novo e aberto, e `conferir` o apaga.
- Qualquer corte antes de `concluir` reprova:
  - `emulators:exec` com 0: `conferir` acha o marco aberto;
  - `emulators:exec` com outro código: o `&&` para.
- No SIGINT ao grupo inteiro, o `sh` da cadeia morre pelo sinal. Um `node --test` interrompido sozinho sai com 1, também
  quando é a última suíte (`experimento-node-test-sigint.log`). Em nenhum caso a cadeia chega ao `concluir`.
- Os mutantes T05–T08 morrem.
- A execução oficial na árvore final imprimiu `[integração] fase completa…` e saiu com 0 (seção 7).

### 4.6 Testes substituídos desde a R3.1

Nenhum enfraquecido:

- **Guarda.** A regex do `holdEstimate` fixa a expressão nova inteira. A da ordem das regras ficou mais estrita, e a
  contagem de aprovações caiu de 3 para 2. As do adaptador e do retorno do cache são novas ou mais estritas.
- **Teste puro das regras.** `'provada'` → `'inexact'`, mais uma asserção (com projeção igual).
- **Mundo simulado.** Só a volta da conexão mudou, e para mais fiel.
- **ADV-06.** Só o título.
- **`tests/tools`.** Desde a rodada 1, saíram só duas linhas: um `import` trocado e o `return` com `holderPid`.
- **Propriedade da R3.1 (20 000 renderizações).** Continua só com prontas; o caso do indisponível ganhou uma tabela
  própria.
- **Sem `skip`, `only` nem `fixme` novos.** O `test.setTimeout(300_000)` do E2E novo vem da espera deliberada de 35 s e
  das esperas explícitas de 60 s. Não muda o prazo de outro teste.

## 5. Achados novos

### ADV-R2-01: LOW: o indisponível mostrado sem prova traz motivo e memória de cálculo de leituras não confirmadas

- **Arquivo:linha:**
  - `useIncomeEstimateWith.ts:123-129`: o indisponível passa com ou sem prova;
  - `useIncomeEstimateWith.ts:262-278`: sem a prova das marcas, a estimativa usa o conteúdo bruto lido por id;
  - `estimate.ts:193-228`: os motivos `no_income`, `no_work_minutes`, `income_*`, `work_minutes_too_high` e
    `hourly_rate_too_low` levam meses, receitas e desconsideradas;
  - `EstimateDetails.tsx:162-205`: a tabela "Receitas oficiais / Desconsideradas / Elegíveis" e o total;
  - `messages.ts:32`.
- **Cenário (sondas em `sonda-r2.log`, uma base, nenhuma conversão em todas):**
  - **S1:** a série lê zero na janela, e a projeção confirmada pelo servidor tem R$ 11.060,00. Depois da leitura e das
    duas releituras, aparece para sempre `no_income`, "Não há receitas efetivadas nos meses considerados. Assim que
    houver, a estimativa aparece.", sem "em atualização" nem "Tentar de novo". Antes do ADV-01, o mesmo caso dava
    "em atualização" com "Tentar de novo", como o F-04 faz para a pronta.
  - **S2:** rotina sem horas com a série R$ 300,00 acima da projeção em setembro. A memória de cálculo mostra setembro
    com R$ 3.820,00 como "Receitas oficiais" e o total de R$ 11.360,00. A projeção confirmada diz R$ 3.520,00.
  - **S4:** a desconsiderada `r500` é editada em outra sessão (R$ 500,00 → R$ 50,00) antes de o gatilho aplicar. O
    indisponível passa a descontar os R$ 50,00 do conteúdo bruto de uma base que ainda contém os R$ 500,00. É o estado
    misto que o B03 proíbe para a conversão, agora na memória de cálculo.
- **Impacto:**
  - Nenhuma conversão e nenhum valor por hora. É informação errada ou não confirmada num painel auxiliar.
  - Persistente só com anomalia no servidor (S1, S2); passageira no S4 e com o cache antes do retorno do servidor.
  - Fica em tensão com o requisito 7 e com "não transformar duas tentativas de releitura em aceitação de uma
    divergência financeira persistente": depois das releituras, a conclusão da base divergente aparece como o estado
    atual.
  - Para uma base, a R3.1 já mostrava o mesmo. Para 12 meses e desconsideradas, a R3.1 segurava.
  - Nada disso está escrito no rascunho de 17:29:
    - o RR-R32-01 abre com "nada errado aparece" e só diz "A estimativa indisponível não espera: aparece com o motivo"
      (`evidencia-rascunho/plano-20-20.md:59,65`). O S1 é justamente um caso em que aparece algo errado;
    - a linha 11 da matriz (`evidencia-rascunho/matriz-antes-depois.md:35`) lista "com divergência persistente" entre os
      casos atendidos, sem dizer que o motivo e os valores vêm da base divergente. O RR-R32-02 já foi corrigido nesse
      rascunho e agora diz que o painel monta com a indisponível;
    - o comentário `useIncomeEstimateWith.ts:262-263` ("Sem prova, a estimativa calculada aqui nunca é mostrada")
      ficou falso para o indisponível.
- **Correção sugerida:**
  - (a) Registrar a decisão e o risco residual no relatório e no plano, com S1, S2 e S4. Isso inclui tirar o "nada
    errado aparece" do RR-R32-01, ajustar a linha 11 da matriz e corrigir o comentário.
  - (b) Opcional: segurar sem prova só o indisponível cujo motivo depende da receita lida (`no_income`, `income_*`,
    `hourly_rate_too_low`). A alternativa é mostrar, nele, só o motivo sem os valores, a menor mudança de interface.
    Teria de manter o ADV-01 para `business_not_confirmed`, `no_work_minutes` e `ambiguous_*`.

### ADV-R2-02: LOW: os testes do executor não distinguem o SIGINT ao grupo do SIGINT ao PID

- **Arquivo:linha:**
  - `tests/tools/e2e-grupos.test.mjs:170-216`: o `npx` falso é um processo só e recebe o sinal direto;
  - `:478-506`: os testes do EST-02;
  - `tools/e2e/executar-em-grupos.mjs:59`.
- **Cenário:**
  - O mutante T01 troca `process.kill(-current.pid, 'SIGINT')` por `process.kill(current.pid, 'SIGINT')` e sobrevive a
    todos os testes.
  - A árvore real é `npm exec` → `sh` (dash) → `node` (`experimento-npx-sinal.log`).
  - Com o SIGINT só ao PID, o `npm` o repassa ao `sh`, que espera o filho, e o neto não recebe nada e roda até o fim.
  - Com o SIGINT ao grupo, o neto o recebe e termina antes do `npx`.
- **Impacto:**
  - O código atual está certo.
  - Uma "simplificação" para o PID voltaria ao problema do EST-02 com os testes verdes: Ctrl+C, `timeout` ou o
    cancelamento não param o grupo em curso, e o SIGKILL que vem depois deixa o Playwright e o Emulator órfãos.
- **Correção sugerida:**
  - fazer o `npx` falso rodar o "Playwright" como neto (`sh -c 'node …'`), registrar o sinal no neto e exigir que ele
    termine antes do executor;
  - ou, no mínimo, uma guarda estrutural de `process.kill(-current.pid, 'SIGINT')`.

### ADV-R2-03: LOW: a recusa de argumentos deixa passar opções curtas combinadas e `--debug`

- **Arquivo:linha:** `tools/e2e/grupos.mjs:49-53`; `RUNBOOKS.md:50`, que diz que `-j`, `-c` e `-u` são recusados.
- **Cenário:**
  - O commander do Playwright 1.60 lê `-xj2` como `-x --workers 2`, `-xc outro.config.ts` como `-x --config …` e
    `-xu` como `-x --update-snapshots` (`commander-combinado.log`). O executor aceita os três
    (`recusa-argumentos.log`).
  - `--debug` equivale a `--timeout=0 --max-failures=1 --headed --workers=1` (`node_modules/playwright/lib/program.js:171`)
    e também passa.
  - Com `-xc` e uma configuração própria, que escreva o relatório JSON, prazos maiores dariam "ok".
- **Impacto:**
  - Nenhum no procedimento oficial (`verify:all`, CI), que não passa argumento.
  - Mas a afirmação do EST-08 e do RB-04 não é exata. É burla deliberada ou acidente raro, não aprovação no caminho
    oficial.
- **Correção sugerida:**
  - aceitar só uma lista de opções conhecidas (filtros posicionais, `-g`/`--grep`, `--grep-invert`, `--project`,
    `--trace`, `-x`, `--max-failures`) e recusar o resto;
  - ou analisar os argumentos com o mesmo commander e conferir as opções resultantes.
  - Uma regex sobre o grupo curto (`^-[a-z]*[jcu]`) recusaria `-gjuros`, um `--grep` legítimo.

### ADV-R2-04: INFO: `E2E_PORT_WAIT_MS=0` com porta ocupada sem teste

- **O código está certo:** com 0, `waitForFreePorts` confere uma vez e devolve a porta ocupada.
- **A lacuna:** o mutante T03 (`if (timeoutMs === 0) return [];`) sobrevive. O único teste com 0 usa porta livre
  (`e2e-grupos.test.mjs:339`).
- **Sugestão:** acrescentar `waitForFreePorts([portaOcupada], 0)` → `[porta]`.

### ADV-R2-05: INFO: sinal só a um processo ancestral

- **O que o experimento mostra** (`experimento-npx-sinal.log`), com o mesmo encadeamento do `npm run test:e2e`
  (`npm run` → `sh` → `node`):
  - SIGTERM só ao PID do `npm` de cima: o `npm` o repassa ao `sh`, que morre, e sai em 0,7 s. O "executor" continua
    vivo, sem sinal nenhum. Na prática, rodaria todos os grupos órfão, sem ninguém esperar o resultado.
  - SIGINT só a esse PID: nada acontece até o fim.
- **Não é aprovação falsa:** a cadeia sai pelo sinal, com código diferente de 0.
- **Não é da R3.2:** com `playwright test` direto, antes, era igual.
- **Os caminhos normais funcionam:** Ctrl+C e `timeout` mandam ao grupo, e o EST-02 cobre esse caso.
- **Sugestão:** no RB-04, interromper pelo grupo de processos (`kill -TERM -- -<pgid>`) ou pelo próprio executor.

### ADV-R2-06: INFO, anterior à R3.2: com desconsiderada, antes do primeiro retorno do servidor, nem o motivo nem "em atualização"

- **Arquivo:linha:**
  - `useIncomeEstimateWith.ts:197-200`: a leitura por id espera `projectionReady`;
  - `:368-379`;
  - na R3.1, `efcbd264:useIncomeEstimateWith.ts:187,356,367`.
- **Cenário (S3):**
  - Rotina sem horas, com desconsiderada.
  - Sem retorno do servidor: "calculando" indefinido, sem "em atualização" nem "Tentar de novo".
  - Com a escuta encerrada: "Não foi possível confirmar a estimativa…", no lugar do motivo.
- **Impacto:**
  - Sem conversão.
  - Na tela real, exige leitura por id sem cache na chave atual: lista de desconsideradas mudada sem conexão, ou a escuta
    sem responder.
  - Contradiz o RR-R32-01 ("Antes dele: 'calculando' e, passado o tempo de interface (30 s), 'em atualização'…") nesse
    caso.
- **Sugestão:** documentar.

### ADV-R2-07: INFO: a troca da falha por "em atualização" passado o tempo de interface só é fixada pela guarda

O mutante B08 (`waitingProof` para qualquer estado segurado) sobrevive aos testes de comportamento. É código anterior
à R3.2, de efeito só no texto do erro. Um teste do gancho com a escuta encerrada e o relógio passado do tempo de
interface o fixaria.

## 6. Achados em aberto

| ID | Severidade | Resumo |
| --- | --- | --- |
| ADV-R2-01 | LOW | O indisponível mostrado sem prova traz motivo e memória de cálculo de leituras não confirmadas. Na divergência persistente, "Não há receitas efetivadas…" aparece para sempre. Não está documentado. |
| ADV-R2-02 | LOW | Os testes do executor não distinguem o SIGINT ao grupo do SIGINT ao PID; o T01 sobrevive. |
| ADV-R2-03 | LOW | A recusa de argumentos deixa passar opções curtas combinadas (`-xj2`, `-xc`, `-xu`) e `--debug`. |
| ADV-R2-04 | INFO | `E2E_PORT_WAIT_MS=0` com porta ocupada sem teste (T03). |
| ADV-R2-05 | INFO | Sinal só ao `npm` de cima deixa o executor órfão ou sem efeito; documentar no RB-04. |
| ADV-R2-06 | INFO | Anterior à R3.2: com desconsiderada e sem o primeiro retorno do servidor, "calculando" indefinido ou o erro, no lugar do motivo. |
| ADV-R2-07 | INFO | B08 só pela guarda. |

## 7. Firestore scale/cost review

PASS — Firestore scale/cost review

- **Escopo:**
  - Desde a R3.1, a R3.2 não cria, não muda e não remove consulta, escuta, índice, regra nem Function. O
    `git diff --stat efcbd264..9fddcb5a` é vazio para `firestore.rules`, `firestore.indexes.json`,
    `src/modules/reports/hooks.ts`, `src/modules/transactions/incomeReads.ts` e `functions/`.
  - A escuta é a mesma: `workspaces/{workspaceId}/cash_report_periods`, `documentId()` entre o primeiro e o último mês,
    `limit(13)`, `includeMetadataChanges: true` (`hooks.ts:80-87`, `basisSync.ts:99`).
  - Mudou só a interpretação no cliente: o retorno do cache derruba `confirmed` (`basisSync.ts:511-517`, desde a rodada
    1). Na rodada 2, `holdEstimate` e o motivo `inexact`, ambos puros.
  - A Frente B só muda a ferramenta de teste, contra `minhas-financas-local`.
- **Evidência por item:**

  | Item | Estado | Evidência |
  | --- | --- | --- |
  | Isolamento por workspace | PASS | Caminho com o workspace (`hooks.ts:82`). Rules de membro ativo com conta ativa (`firestore.rules:793-797`), sem mudança. Chaves do cache com conta e workspace (`basisSync.ts:135`). |
  | Consulta limitada | PASS | `limit(BASIS_PERIODS_MAX = 13)` (`basisSync.ts:99`, `hooks.ts:85`). |
  | Paginação | N/A | Janela fixa de até 12 documentos mensais, sem lista. |
  | Índices | PASS | Intervalo em `__name__`, índice automático; `firestore.indexes.json` sem mudança desde a R3.1. |
  | N+1 e escutas duplicadas | PASS | Uma escuta por montagem (provedor, prévia, assistente), sem escuta nova. Leitura por id só das desconsideradas (até 50), com `staleTime: Infinity`. |
  | Ciclo de vida da escuta | PASS | Cancelamento na limpeza do efeito (`basisSync.ts:551-554`), reabertura por `listenAttempt`. |
  | Leituras novas pela mudança | PASS | `holdEstimate` e o F-03 não leem nada. O motivo `inexact` não entra no agendador (`useIncomeEstimateWith.ts:344-356`). Os testes do ADV-03 exigem "sem leitura a mais" na volta da conexão, com 12 meses e desconsiderada (`work-time-consistency.test.ts:1807`, `w.calls` igual). Liga e desliga da leitura por id não relê (React Query 5, `staleTime: Infinity`, `refetchOnReconnect: false`). |
  | Dados amplos no navegador | PASS | Até 13 projeções. Nenhuma soma de lançamentos no navegador. |
  | Escritas, agregados, retenção | N/A | Nenhuma escrita: as Rules negam escrita do cliente em `cash_report_periods` (`firestore.rules:798`). |
  | Remoção do legado | PASS | `multipleBases` e a leitura única fora do código e dos testes (guarda `work-time-guard.test.ts:761-781`). |
  | Verificação no Emulator | PASS | Ver a lista abaixo. |

  Evidência no Emulator, com o SDK real (as escutas do PF e do PJ, sem conexão e de volta):

  - O ADV-01 passou na árvore final (`e2e-adv01-r32-1`, 1/1).
  - O B03-g com o N16 aplicado à árvore final falha sem as mudanças de metadados (`e2e-b03g-com-n16`, `:750`).
  - O B03-g com o A02 falha (`e2e-b03g-com-a02`, `:778`).
  - O B03-g verde (`e2e-b03g-r32-2`, `059cec04`) e o p5f 19/19 (`e2e-p5f-r32-2`, `ff1aa360`) rodaram com o mesmo código
    de escuta e consulta da final: `basisSync.ts` e `hooks.ts` não mudaram. O portão da pronta também não mudou. O
    efeito do ADV-01 nos outros E2E é conferido pela execução oficial na árvore final.
  - A execução oficial na árvore final (`verify-all-r32-3`, de 16:49:33Z a 17:40:04Z) saiu com 0:
    - `[integração] fase completa…`;
    - `[e2e em grupos] ok: 218 testes, cada um uma vez, todos passaram` (83, 64 e 71 por grupo), com o B03-g e o ADV-01
      verdes;
    - 42 resumos do `node --test`, todos com `fail 0` (3.101 testes), e nenhum `not ok` no log;
    - portas livres e nenhuma JVM no fim.
  - Como nenhuma consulta nem regra mudou, não há suíte de Rules nova a exigir. As 19 rodaram na fase completa.

- **Modelo de custo** (estimativas). `W` = documentos da janela (≤ 12); `M` = membros com a estimativa ligada no
  workspace-fonte.
  - Montagem: ≤ W leituras na escuta inicial, ou nenhuma a mais se a consulta idêntica já estiver ativa.
  - Mudança de projeção: 1 leitura por escuta; a escrita do gatilho chega às M escutas.
  - Volta da conexão: os documentos mudados, se a retomada valer; senão ≤ W por alvo. Medido na unidade: nenhuma
    leitura de base ou por id a mais (ADV-03).
  - Releituras da base: ≤ 2 por estado divergente (`BASIS_DIVERGENCE_RETRIES`), dentro do agendador (rajada 5, recarga
    120 s) e do limite da callable (300/h por conta e workspace).
  - Números iguais aos da rodada 1 e da R3.1. A rodada 2 não acrescenta leitura: o indisponível que deixou de esperar
    não lê nada.
  - Com 10 000 usuários ligados: no máximo 3 escutas de ≤ 13 documentos por usuário, sem crescer com o histórico.
- **Achados bloqueantes:** nenhum.
- **Verificação:** unidade 261/261 e 107/107, ferramentas 15/15 e 3/3, `tsc` 0, mutantes 21/21 (Frente A). Os E2E
  e a integração no Emulator são do executor, com os comandos nos `.meta`; a execução oficial `verify-all-r32-3` saiu
  com 0 na árvore final. Não rodei Emulator, por regra da rodada.

## 8. O que não foi possível verificar

- **Execução oficial `verify-all-r32-3`.** Li o log e o `.meta` (saída 0, 3.023 s, pico de 10.243 MiB, árvore no fim
  `9fddcb5a`, sem limpeza externa), mas não a reexecutei. A conferência da lista de 218 é a do próprio executor.
- **Interrupção real.** Não rodei o executor novo interrompido com o Playwright e o Emulator de verdade. A execução 22
  do histórico usou o executor anterior. Pelo experimento com o `npx` real e pela leitura do código, o caminho está
  certo (seção 4.5).
- **Relatório e plano finais** ainda não existem. Conferi só os rascunhos (`plano-20-20.md` e `matriz-antes-depois.md`,
  de 17:29, e `revisoes-LEIAME.md`), que o executor continuava editando. Devem trazer o ADV-R2-01 (decisão e risco) e os
  INFO de documentação (ADV-R2-05, ADV-R2-06).
- **Mutantes do executor na árvore final.** O `mutantes-cliente-r32-2` dele é de antes do F-03. Os meus 21 da
  Frente A rodaram na árvore final.
