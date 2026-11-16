VEREDITO: FAIL

# Revisão adversarial de qualidade e arquitetura, P5-F.1-R3.2 (Frentes A e B)

O veredito é FAIL por um achado MEDIUM em aberto (ADV-01): um estado legitimamente indisponível com base exata fica
escondido quando o servidor não confirma. Não é risco de conversão. Tentei quebrar a correção pelos cinco caminhos do
pedido e não consegui: nenhuma conversão chega à tela sem retorno do servidor válido para a montagem, a conta, o
workspace e os meses.

Veredito da skill `firestore-scale-cost-review`: **PASS** (seção própria abaixo).

## 1. Escopo conferido

- **Árvore final revisada:** `93668199c4d5a57a41308dd08383afd7c2245b00`, comparada com a base R3.1
  `efcbd2645b8e7b08b5add2812f6b319f4a76369b`. Revisei antes `6d28cf98` e depois `ca11baca`, conforme as atualizações do
  coordenador. Entre `ca11baca` e `93668199` mudaram só três arquivos: um comentário do `playwright.config.ts`, o
  `README.md` e o `RUNBOOKS.md`. `src/`, `tests/` e `e2e/` são idênticos nas duas.
- **Worktree:** conferi que o worktree tem o conteúdo da árvore (`cmp` arquivo a arquivo e `diff -rq` contra o
  `git archive`). Não alterei nada nele nem no índice.
- **Frente A:** li inteiros `consistency.ts`, `useIncomeEstimateWith.ts` e `basisSync.ts`. Li também o adaptador real
  (`reports/hooks.ts:80-97`), `WorkTimeContext.tsx`, `display.tsx`, `Header.tsx`, `EstimateDetails.tsx`,
  `IncomeEditor.tsx`, `WorkTimeWizard.tsx`, `WorkTimeSettingsView.tsx`, `incomeReads.ts` e `estimate.ts`. Do lado do
  servidor, li a série do relatório (`functions/src/reports/report.ts:369-383`, `cash.ts:106-184`) e as Rules de
  `cash_report_periods` (`firestore.rules:792-799`). Do SDK instalado (`firebase` 12.8.0, `@firebase/firestore` 4.10.0),
  li o rastreador de estado da conexão e a regra de emissão das escutas.
- **Frente B:** li `tools/e2e/grupos.mjs`, `tools/e2e/executar-em-grupos.mjs`, `tests/tools/e2e-grupos.test.mjs`,
  `playwright.config.ts`, `package.json`, `.github/workflows/quality-gate.yml`, `README.md` e o `RUNBOOKS.md` (RB-04,
  RB-05, RB-08 e RB-09).
- **Testes substituídos:** comparei com a R3.1 todos os indicados no COMUM.md e o E2E reescrito "escuta das projeções
  encerrada…" (`e2e/work-time-p5f.spec.ts:1230`). Procurei também outro E2E que ainda dependesse de conversão sem
  confirmação (seção 5).

## 2. Comandos executados e resultados

Os logs estão em `<scratchpad>/p5f1r32/revisoes/adversarial/logs/`.
Rodei tudo em cópias próprias (`copia` e `copia-final`, de `git archive`), sem Emulator, sem E2E e sem `verify:*`.

| Comando (na cópia) | Resultado | Log |
| --- | --- | --- |
| `node --experimental-strip-types … --test` com os 7 arquivos da estimativa e da sincronização (`work-time-consistency`, `-income-estimate`, `-estimate`, `-guard`, `-projection-proof`, `report-basis-sync`, `report-basis-refresh`) em `93668199` | 215/215, saída 0 | `unit-9366.log` (e `unit-base-r32.log` em `6d28cf98`) |
| `node --test tests/tools/e2e-grupos.test.mjs` em `93668199` | 9/9, saída 0 | `tools-e2e-9366.log` |
| `python3 -I scripts/mutantes-adversarial.py <cópia>` com os mutantes A01 a A09 (`src/` e `tests/` iguais aos de `93668199`) | 8/9 mortos. **A02 sobrevive.** A09 só morre pela guarda estrutural. | `mutantes-adversarial.log`, `mutantes-adversarial-2.log` |
| Sonda de unidade (anexada a uma cópia do teste, nunca no repositório): estado indisponível com base exata, na R3.2 e na R3.1 | R3.2 esconde o estado; R3.1 o mostra | `sonda-indisponivel.log`, `sonda-indisponivel-2.log` |
| Leitura do SDK (`common-341bda9b.esm.js`) | Só o estado `Offline` gera o retorno `fromCache`; o `Unknown` não gera | `sdk-online-state.txt` |

O roteiro dos mutantes fica em `<scratchpad>/p5f1r32/revisoes/adversarial/scripts/mutantes-adversarial.py`.
Ele aplica um mutante por vez, exige que cada troca case uma vez só e restaura os arquivos conferindo o SHA-256.

| Mutante | Resultado |
| --- | --- |
| A01: `holdEstimate` ignora a sincronização em curso | morto (6 testes, entre eles 165, 166, 167, 181 e 185) |
| A02: o retorno do servidor sem documento mudado (a reconexão) não restaura a confirmação | **sobrevive** a toda a unidade (ADV-02) |
| A03: o retorno do cache só derruba a confirmação antes do primeiro retorno do servidor | morto (o 105, comportamental, e a guarda 157) |
| A04: chave da confirmação sem os meses | morto (65, 179 e 185) |
| A05: confirmação guardada em módulo e herdada na montagem | morto (33) |
| A06: a própria base serve de projeção | morto (23) |
| A07: janela de um mês sem desconsiderada dispensa a projeção | morto (100, 109, 117 e 164) |
| A08: o erro da escuta mantém a confirmação com uma base e nenhuma desconsiderada (a ressalva da R3.1) | morto (106 e 157) |
| A09: o retorno do cache só derruba a confirmação com uma base e nenhuma desconsiderada | morto **só pela guarda estrutural 157** (ADV-03) |

Evidências do executor que conferi, sem rodar nada:

- `e2e-b03g-r32-2` passou na árvore `059cec04`. O `src/` e o `e2e/work-time-b03.spec.ts` dela são iguais aos da final.
  A gravação registra `["tempo|≈ 776 h","reais|R$ 19.400,00","tempo|≈ 776 h"]`.
- B03 a–f passaram em `0f1b9320`, com o mesmo `src/` da final.
- `e2e-p5f-r32-2` teve 19/19 em `ff1aa360`, que difere da final só no `RUNBOOKS.md`.
- `e2e-p5f-escuta-na-r31-vermelho` falha na R3.1, como esperado. O topo trazia "…ela usa a leitura anterior", convertido.
- `red-r32-na-r31-2`: com o `src/` da R3.1, 20/85 falham, só os testes novos ou reescritos. Os testes com desconsiderada
  ou de 12 meses da matriz já passavam na R3.1, que já exigia a projeção nesses casos. Eles servem de regressão, não de
  prova vermelha.

## 3. O que tentei quebrar e não quebrou

1. **Conversão sem confirmação.** Nenhum consumidor converte fora do estado do gancho:
   - `WorkTimeContext.tsx:127-135` deriva o `config` só de `done` com `ready`.
   - `display.tsx:79-80` usa só esse `config`.
   - `Header.tsx:45-50`, `EstimateDetails.tsx:42-62`, `IncomeEditor.tsx:108` e o assistente recebem o estado já filtrado
     por `holdEstimate`.
   - Não existe `setQueryData`, persistência do React Query nem cache em `localStorage` para bases ou estimativa.
   - `confirmed` só nasce de um retorno do servidor da escuta da própria montagem (`basisSync.ts:518-537`). Ele é zerado
     em três momentos: ao abrir a escuta (`:505`), no retorno do cache (`:511-517`) e no erro (`:545`). Além disso, é
     filtrado pela chave de conta, workspace e meses (`:395`, `:609`).
   - O SDK silencia a escuta antiga no cancelamento, e a limpeza do efeito roda antes da escuta nova.
   - A regra 1 (`consistency.ts:63`) é segura. Mostrei que `reportExact` implica `basis.exact`
     (`useIncomeEstimateWith.ts:162` × `:248-252`), e sem `reportExact` a estimativa é `report_unavailable`
     (`estimate.ts:164-165`).
2. **Corridas no tempo de vida de `confirmed`.**
   - Cache e servidor: as chamadas a `setConfirmed` não são funcionais, então vale a última, que é a ordem do SDK.
   - Reabertura (`listenAttempt`): o efeito zera a confirmação antes de assinar.
   - Fechamento obsoleto: a chave guardada filtra a confirmação velha.
   - SDK real: o retorno `fromCache` só é emitido quando o estado passa a `Offline` (`View.va`, `:16711`), e só chega
     com `includeMetadataChanges` (`:16335`, `hooks.ts:87`). A volta da conexão emite `fromCache: false` com
     `syncStateChanged` e `docChanges().length === 0`; o código restaura `confirmed` sem depender de mudança (`:537`).
     A conversão volta sozinha, como o B03-g mostra com o SDK real.
   - `hasPendingWrites` não se aplica: as Rules negam escrita do cliente em `cash_report_periods`
     (`firestore.rules:798`).
3. **Regressões de conversão com o servidor disponível.** Não achei nenhuma.
   - Escuta e callable têm a mesma autorização: conta ativa e membership ativa (`firestore.rules:32-46`,
     `workspaceAuth.ts:103,130`), nos quatro papéis (`report.ts:55-56`).
   - A série lê os mesmos documentos da projeção (`reports/cash.ts:106-142`): mês cheio pelo total, mês parcial pela
     soma dos dias.
   - O mês corrente não diverge sem motivo, porque todo produtor que mexe em `incomeCents` recusa data futura
     (`cash/contracts.ts:82`, `receivables/contracts.ts:96`, `loans/contracts.ts:52`, `recurring/contracts.ts:274`,
     `accounts/contracts.ts:68`). Investimento não entra em `incomeCents` (`cash/periods.ts:322-356`).
   - O tipo do workspace é imutável: `updateWorkspaceSettingsPayloadSchema` não aceita `type`.
4. **Testes substituídos.** Nenhum foi enfraquecido (seção 5).
5. **Frente B.** Não achei caminho em que uma execução incompleta ou com falha termine com saída 0 (seção 6).

## 4. Achados

### ADV-01: MEDIUM: estado legitimamente indisponível com base exata fica escondido sem confirmação do servidor

- **Arquivo:linha:**
  - `src/modules/work-time/consistency.ts:62-65`: só `!basis.exact` dispensa a projeção.
  - `src/modules/work-time/useIncomeEstimateWith.ts:116-121`: `holdEstimate` segura qualquer `done`, pronto ou
    indisponível.
  - `useIncomeEstimateWith.ts:364-367`.
  - O teste "R3.2: o estado legitimamente indisponível…" (`tests/unit/work-time-consistency.test.ts:1651`) cobre só
    `report_unavailable`.
- **Cenário:** uma base e nenhuma desconsiderada. A série está exata e a estimativa sai indisponível por um motivo que
  não converte nada, por exemplo `no_work_minutes` (rotina sem horas, `estimate.ts:210`) ou `business_not_confirmed`
  (`:160`). A sonda mostra o comportamento em quatro situações (`sonda-indisponivel*.log`):

  | Situação | R3.2 | R3.1 |
  | --- | --- | --- |
  | Sem retorno do servidor | "calculando" → `A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais…` | `done/unavailable/no_work_minutes` |
  | Escuta encerrada por erro | `Não foi possível confirmar a estimativa com os totais oficiais. Tente de novo.` | `done/unavailable/no_work_minutes` |
  | Sem conexão, depois de o estado aparecer | o estado some ("calculando" → "em atualização") | — |
  | Divergência persistente | o estado nunca aparece ("em atualização" para sempre) | — |

  Com retorno do servidor e sem anomalia, a R3.2 mostra o indisponível depois de um "calculando" breve.
- **Impacto:**
  - Nenhum risco de conversão: o saldo fica em reais nos dois casos.
  - Contraria o pedido "Preservar estados legitimamente indisponíveis, quando não há uma estimativa pronta para
    conversão", que a R3.2 só cumpre para `report_unavailable`.
  - Em dois cenários obrigatórios, sem conexão e escuta encerrada, a mensagem acionável vira um texto enganoso sobre
    "totais oficiais", que nenhum "Tentar de novo" resolve. A mensagem acionável é, por exemplo, "A jornada configurada
    não tem horas nos meses considerados. Revise a rotina e as exceções.".
  - O painel "Receitas consideradas" também fica indisponível, o mesmo efeito do RR-R31-06.
  - É regressão em relação à R3.1 para uma base. Com 12 meses ou desconsiderada, a R3.1 já segurava assim.
- **Correção sugerida (uma das duas):**
  - (a) Não segurar `done` cuja estimativa não seja `ready`: não há conversão a provar. Pelo menos para os motivos que
    não dependem da receita lida (`business_not_confirmed`, `no_work_minutes`, `ambiguous_*`, `work_minutes_too_high`,
    além de `report_unavailable`). Acrescentar testes nos quatro cenários acima e na janela de 12 meses.
  - (b) Registrar no plano e no relatório a decisão explícita de que o indisponível com base exata também espera a
    confirmação, com a justificativa e um teste que fixe o comportamento, e documentar o impacto junto do RR-R31-06.

### ADV-02: LOW: a reconexão sem mudança de documento não é exercida pela unidade; só o B03-g a cobre

- **Arquivo:linha:** `tests/unit/work-time-consistency.test.ts:293` e `:269` (`goOnline`). A falsa escuta responde sempre
  com `changes: documents.length`. O SDK, na volta da conexão, responde com `docChanges().length === 0` (seção 3.2).
- **Cenário:** o mutante A02 só restaura `confirmed` no primeiro retorno do servidor ou com documento mudado. Ele
  sobrevive a toda a unidade, inclusive ao teste "a conexão cai com a estimativa provada na tela … com a conexão de
  volta, ela volta" (`:1588`).
- **Impacto:** a garantia de que a conversão volta sozinha (requisito 10) depende só do E2E B03-g. Pela análise, o B03-g
  mata o A02 no último passo: o saldo do Dashboard convertido de novo, pela escuta do provedor já sincronizada. Não pude
  rodar o E2E para confirmar.
- **Correção sugerida:** dar à falsa escuta um retorno do servidor com `changes: 0` quando nada mudou, igual ao SDK, ou
  acrescentar esse caso ao teste da queda. Peço ao executor o B03-g com o A02 aplicado (seção 8).

### ADV-03: LOW: queda de conexão com 12 meses ou com desconsiderada sem teste de comportamento

- **Arquivo:linha:** `src/modules/reports/basisSync.ts:511-517`. Os testes da queda (`:1588`, "sem conexão, a tela que
  volta…" e o E2E B03-g) usam só uma base sem desconsiderada.
- **Cenário:** na R3.1, o `fromCache` era ignorado em toda janela, então a conversão ficava sem conexão também com 12
  meses e com desconsiderada. O mutante A09 devolve esse comportamento a essas janelas e só morre pela regex da guarda
  `work-time-guard.test.ts:345` (teste 157).
- **Impacto:** o código é uniforme, sem desvio por janela, e a guarda é exata, então o risco é baixo. Mesmo assim, a
  combinação dos requisitos 5, 8 e 9 não tem teste de comportamento vermelho na R3.1.
- **Correção sugerida:** acrescentar dois testes à matriz `WINDOWS`, ambos com a estimativa provada e depois
  `goOffline()`: um de 12 meses e um com desconsiderada.

### ADV-04: LOW: o runbook exige as portas 9299 e 9499 livres, mas o remédio documentado não as libera

- **Arquivo:linha:**
  - `docs/production/RUNBOOKS.md:49` (RB-04) e `tools/e2e/grupos.mjs:103-106` conferem 9299 e 9499.
  - `RUNBOOKS.md:95` (RB-09) e `package.json:46-47` (`e2e:kill-ports`, `test:e2e:clean`) liberam só
    4000, 4400, 4500, 5001, 8080, 9099, 9150 e 5173.
- **Cenário:** sobra um Eventarc ou um Cloud Tasks do emulador, e o executor para com "portas em uso". O remédio do RB-09
  não resolve.
- **Impacto:** é falha falsa, não aprovação falsa. Prende o operador.
- **Correção sugerida:** incluir 9299 e 9499 no `e2e:kill-ports` e no texto do RB-09.

### ADV-05: INFO: janela de detecção da queda pelo SDK (risco residual a documentar)

- **Evidência:** `common-341bda9b.esm.js:15342-15356`. Uma falha do canal com o estado `Online` só leva a `Unknown`. O
  `Offline` vem na próxima tentativa que falha ou depois de 10 s. A `:16711` mostra que só o `Offline` gera o retorno
  `fromCache`.
- **Impacto:** numa queda silenciosa, sem o evento `offline` do navegador, a confirmação e a conversão ficam até o SDK
  perceber. Com o evento, que é o que o B03-g exercita, a percepção é imediata (`:15453`). É inerente a toda escuta; não
  é conversão sem retorno do servidor.
- **Correção sugerida:** registrar no relatório, entre os impactos de sincronização demorada que o pedido manda
  documentar.

### ADV-06: INFO: título de teste inexato

`tests/unit/work-time-consistency.test.ts:1416` diz "R3.1: provada, mas com a sincronização em curso". Na R3.2 a prova
também falta nesse cenário (`bases`), como o próprio comentário corrigido admite. O corpo é idêntico ao da R3.1
(`logs/t-r31.txt` × `t-r32.txt`), e o ramo `settling` continua coberto por outros testes: o A01 morre em 6 deles.
Sugiro ajustar o título.

### ADV-07: INFO, fechado: comentário do `playwright.config.ts` com caminho inexistente

O comentário citava `scripts/e2e-shards.mjs`. Achei isso na `ca11baca`, e a `93668199` o corrigiu para
`tools/e2e/executar-em-grupos.mjs`.

### ADV-08: INFO: mês corrente com desconsiderada no próprio mês fora da matriz da R3.2

A desconsiderada da matriz fica em outubro (`work-time-consistency.test.ts:1664`, matriz `WINDOWS`). O caminho é o da R3.1
(regras 4 e 5), que a R3.2 não mudou. Sugiro o caso para completar a matriz dos requisitos 8 e 9.

## 5. Testes substituídos e E2E dependentes

| Teste | Comparação com a R3.1 | Conclusão |
| --- | --- | --- |
| Prova pura, "cada regra, na ordem…" | O caso da leitura única passa a esperar `projection`. Os casos com `multipleBases` viram equivalentes sem o campo. Entram `bases` sem desconsiderada e a recusa de um campo antigo extra. | Reforçado |
| Antiga linha 472 ("leitura única… com a ressalva") | Antes bastava a estimativa com ressalva. Agora: erro fixo, nenhuma conversão (`assertNoConversion`) e recuperação provada pelo "Tentar de novo". | Reforçado |
| "R3.1: provada, mas com a sincronização em curso…" | Só título e comentário mudam; o corpo é idêntico. | Mantido (ADV-06) |
| "R3.1: mudança da preferência…" | Só comentário. | Mantido |
| Regex da antiga linha 418 de `work-time-guard` | Agora exige `setConfirmed(null)` no retorno do cache. Surge uma guarda nova da prova (`:759-779`). | Reforçado |
| E2E "escuta das projeções encerrada…" (`work-time-p5f.spec.ts:1230`) | A ressalva convertida dá lugar a: aviso de indisponível, zero `[data-work-time]`, saldo em reais e nenhuma ressalva. A reabertura agora é provada por asserções positivas: o topo "Valores em tempo de trabalho equivalente…" e o saldo convertido de volta antes da receita retroativa. Falha na R3.1 (`e2e-p5f-escuta-na-r31-vermelho`). | Reforçado |
| B03-g, asserção corrigida entre `0f1b9320` e a final | A asserção antiga incluía o saldo de antes da queda e estava errada. A nova exige a queda (`drop > 0`) e nenhum `tempo|` depois dela. | Não enfraquecido |

**Outros E2E dependentes de conversão sem confirmação:** nenhum.

- Só `work-time-b03.spec.ts` e `work-time-p5f.spec.ts` afirmam conversão.
- O "releitura que falha" (`:1038`) mostra a hora com o aviso só com a escuta confirmando. A rota bloqueada é a callable,
  não o canal do Firestore.
- O "falha na leitura da preferência" (`:1204`) passa pela estimativa religada e exige a confirmação.
- O p5f inteiro passou com 19/19.

## 6. Frente B (como código)

- **`checkGroupRuns` (`grupos.mjs:72-100`):** exige que cada chave da lista apareça uma vez, com `expected` e uma única
  tentativa `passed`. Reprova teste fora da lista, lista vazia, chave repetida e grupo sem relatório.
- **Combinação no executor (`executar-em-grupos.mjs:146`):** exige também saída 0 de cada grupo e portas livres.
  Argumentos do usuário podem trocar o `--reporter`, o `--config` ou o `--max-failures`, mas só levam a falta de
  relatório ou a teste não rodado, ou seja, à reprovação.
- **Sobrevivente X03 do executor:** é equivalente. Os grupos que não rodaram aparecem como "não rodou" e "portas ainda em
  uso".
- **Comportamentos do Playwright 1.60 que só podem dar reprovação falsa, nunca aprovação falsa:** um grupo vazio no
  `--shard` sai com código 1 ("No tests found"). Testes com `test.fail()` também reprovariam (status `expected` com
  tentativa `failed`), e a suíte não tem nenhum.
- **`retries: 0`, `forbidOnly: true` e `gracefulShutdown`:** estão no config, e a guarda e os mutantes W01 a W06 os
  cobrem.
- **Gaps:** a falta de teste do executor para portas ocupadas é só lacuna de teste, sem aprovação falsa. O ADV-04 é a
  outra observação da frente.

## 7. Firestore scale/cost review

PASS — Firestore scale/cost review

- **Escopo:**
  - A R3.2 não cria, não muda e não remove consulta, escuta, índice nem regra. A escuta existente
    (`reports/hooks.ts:80-97`: `workspaces/{workspaceId}/cash_report_periods`, `documentId()` entre o primeiro e o
    último mês, `limit(13)`, `includeMetadataChanges: true`) passa a ser a única fonte da prova em toda janela.
  - O retorno do cache só muda estado (`basisSync.ts:511-517`).
  - Efeito indireto: `projectionReady` (`useIncomeEstimateWith.ts:196-199`) alterna com a confirmação e liga ou desliga
    a leitura por id (`incomeReads.ts:73-89`).
  - A Frente B só muda a ferramenta de teste, contra `minhas-financas-local`.
- **Evidência por item da checklist:**

  | Item | Estado | Evidência |
  | --- | --- | --- |
  | Isolamento por workspace | PASS | O caminho tem o workspace (`hooks.ts:82`). As Rules exigem membro ativo com conta ativa (`firestore.rules:793-797`, `:42-46`), sem mudança na R3.2 (diff sem `firestore.rules`). |
  | Consulta limitada | PASS | `limit(BASIS_PERIODS_MAX=13)` (`basisSync.ts:99`, `hooks.ts:85`). A regra exige `limit` de 1 a 600. |
  | Paginação | N/A | Janela fixa de até 12 documentos mensais, sem lista paginada. |
  | Índices | PASS | Intervalo em `__name__` usa o índice automático. `firestore.indexes.json` não muda na R3.2 (diff). |
  | N+1 e escutas duplicadas | PASS | Nenhuma escuta nova: continua uma por montagem (provedor, prévia, assistente; a prévia fica desligada com o assistente aberto). Consultas idênticas dividem o alvo do SDK. |
  | Justificativa e ciclo de vida da escuta | PASS | A escuta é a prova (`consistency.ts:16-19`). O cancelamento fica na limpeza do efeito (`basisSync.ts:551-554`). |
  | Dados amplos no navegador | PASS | Até 13 documentos de projeção. Nenhuma leitura de lançamentos para somar. |
  | Agregados, escritas, retenção | N/A | Nenhuma escrita: as Rules negam escrita em `cash_report_periods` (`firestore.rules:798`). |
  | Remoção do legado | PASS | `multipleBases` e a regra da leitura única saíram do código e dos testes. A busca em `src/`, `tests/` e `e2e/` só acha registros históricos em `docs/production/evidence/`. |
  | Leituras novas pela mudança | PASS | `setConfirmed(null)` não lê nada. Religar a leitura por id não relê dado em cache (React Query 5.0.0, `shouldFetchOptionally` exige dado vencido; `staleTime: Infinity`, `refetchOnReconnect: false`). |
  | Verificação no Emulator | PASS | O B03-g (SDK real sem conexão e volta, Emulator) e o p5f (19/19) passaram em árvores com o mesmo `src/` da final. Os logs do executor estão na seção 2. Como nenhuma consulta nem regra mudou, não há suíte de Rules nova a exigir. O `verify:all` oficial de `93668199` estava em curso (`verify-all-r32-2`). |

- **Modelo de custo** (estimativas). Valem `W` = documentos da janela (≤ 12) e `M` = membros com a estimativa ligada no
  workspace-fonte.
  - Montagem: ≤ W leituras na escuta inicial, ou nenhuma a mais se a consulta idêntica já estiver ativa no cliente.
  - Projeção de um mês muda: 1 leitura por escuta, e a escrita do gatilho se espalha para M escutas.
  - Volta da conexão: só os documentos mudados, se a retomada valer; senão ≤ W por alvo.
  - Releituras da base: ≤ `BASIS_DIVERGENCE_RETRIES` (2) por estado divergente, dentro do orçamento do agendador (rajada
    5, recarga 120 s; mutação 2/600 s) e do limite da callable (300 por hora, por conta e workspace,
    `reports/callables.ts:27-31`).
  - Todos esses números são iguais aos da R3.1. A R3.2 só acrescenta os "Tentar de novo" que o usuário pede na
    divergência persistente, uma chamada cada, dentro do mesmo limite.
  - Com 10 000 usuários ligados: no máximo 3 escutas de ≤ 13 documentos por usuário, sem crescimento com o histórico.
- **Achados bloqueantes:** nenhum.
- **Verificação:** unidade 215/215 e ferramenta 9/9 nas minhas cópias. Os E2E no Emulator são do executor (B03-g, B03 a–f
  e p5f 19/19), com os comandos nos `.meta`. Não rodei Emulator, por proibição do pedido.

## 8. O que não foi possível verificar e pedidos ao executor

- **Rodar o B03-g com o mutante A02 aplicado.** O mutante troca, em `src/modules/reports/basisSync.ts`, o
  `setConfirmed({ key, projection: … })` do retorno do servidor por
  `if (firstServer || snapshot.changes > 0) setConfirmed(…)`, com `const firstServer = !synced;` antes de `synced = true`.
  O esperado é falha no último `balanceCard … toContainText(timeRegex(minutes))`. Sem isso, o ADV-02 fica fechado só pela
  análise.
- **Não reproduzi a queda silenciosa** (sem o evento `offline` do navegador), que precisaria de Emulator e de manipular a
  rede. É o ADV-05.
- **O `verify:all` oficial de `93668199`** (`verify-all-r32-2`) estava na fase de integração durante esta revisão. Não
  esperei pelo resultado.
- **O relatório técnico da R3.2 ainda não existe**, nem o registro no plano com os impactos de sincronização demorada e
  do painel "Receitas consideradas". Não verifiquei esses textos. Devem incluir o ADV-05 e a decisão do ADV-01.
