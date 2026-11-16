VEREDITO: PASS

# Parecer adversarial — P5-F.1-R3.1 (R3-AUD-01)

Revisão independente e somente leitura da correção R3.1. Comparei árvore com árvore: R3 `1c9155dbc8d6aedd35e6f39a63fac46b53d81919` e R3.1 `40057d2a78c47fea537480b0a2bc21fc46e2a500`. O código conferido é o do disco de `wt-p5f1-r31`. Não alterei nenhum arquivo do worktree. Os experimentos rodaram em cópias dentro de `<scratchpad>/p5f1r31/revisoes/adversarial/`.

**Resultado.** O defeito R3-AUD-01 foi eliminado. `holdEstimate` não guarda nem recebe estimativa anterior. O gancho só devolve `status: 'done'` quando o estado é o da própria renderização, com `proof.proven` e `!holding`. Não há achado HIGH nem MEDIUM. Ficam três achados LOW, todos fora do mecanismo do R3-AUD-01: dois resíduos anteriores à R3.1 (a R3.1 os reduz) e uma lacuna de cobertura. Há também três observações INFO.

## 1. Escopo conferido

- **Diff R3 → R3.1** (`git diff --name-status`): 11 arquivos.
  - Lógica: só `src/modules/work-time/useIncomeEstimateWith.ts`.
  - Só comentários: `src/modules/reports/basisSync.ts` (2 trechos), `src/modules/work-time/consistency.ts` (cabeçalho) e `src/modules/work-time/messages.ts` (doc de `ESTIMATE_UNCONFIRMED_FAILED`).
  - Testes: `tests/unit/work-time-{consistency,income-estimate,guard}.test.ts`, `e2e/work-time-b03.spec.ts` e `e2e/work-time-p5f.spec.ts`.
  - Documentos: `docs/production/evidence/p5f1-r31/{matriz-antes-depois,testes-substituidos}.md`.
- **Integridade do disco:** 725 arquivos de `src/`, `tests/`, `e2e/`, `functions/src/`, `firestore.rules`, `firestore.indexes.json` e `package.json` batem, por `git hash-object` (sem `-w`), com a árvore R3.1. Não há arquivo extra em `src/`, `tests/` ou `e2e/`.
- **Código lido inteiro ou nos trechos relevantes:**
  - `useIncomeEstimateWith.ts` (versões R3 e R3.1);
  - `consistency.ts`;
  - `basisSync.ts` (`useFinancialReportBasisWith` e `useFinancialReportBasisLiveRefreshWith`);
  - `basisRegistry.ts`, `basisRefresh.ts`, `liveRefresh.ts`, `queryKeys.ts` e `incomeReads.ts`;
  - `WorkTimeContext.tsx` e `display.tsx`;
  - `Header.tsx`, `EstimateDetails.tsx`, `WorkTimeSettingsView.tsx`, `WorkTimeWizard.tsx` e `IncomeEditor.tsx`;
  - `messages.ts`;
  - `App.tsx` (configuração do `QueryClient`);
  - `functions/src/reports/cash.ts` (origem da série) e `functions/src/cash/contracts.ts` (data futura).

## 2. Comandos executados e resultados

Os caminhos curtos abaixo são relativos à pasta da revisão, `<scratchpad>/p5f1r31/revisoes/adversarial/`.

| # | Comando (resumo) | Resultado |
| --- | --- | --- |
| 1 | `git diff --stat` / `--name-status` entre as árvores | 11 arquivos, nenhum em Ledger, marcas, gatilhos, reconstrução, Rules, índices, Billing ou estilos |
| 2 | `git hash-object` de cada arquivo da árvore R3.1 contra o disco | 725/725 iguais |
| 3 | Testes de unidade no worktree: `work-time-income-estimate`, `work-time-consistency` e `work-time-guard` | 85/85 (`logs/unit-3-arquivos.log`) |
| 4 | Testes de unidade no worktree: os 10 de `test:unit:work-time` mais `report-basis-refresh` e `report-basis-sync` | 276/276, 0 skip, 0 todo (`logs/unit-work-time-e-bases.log`) |
| 5 | `npx tsc --noEmit` no worktree | saída 0 (`logs/tsc-root.log`) |
| 6 | **Vermelho reproduzido:** testes da R3.1 sobre o código da R3 (cópia via `git archive` da árvore R3; `r3-com-testes-r31/`) | 23 falhas e 44 aprovações em 67 testes. O teste principal "R3.1 (R3-AUD-01)" falha com `mostrados: loading → 1056000` e `'1056000 sem aviso'` ×5, que é o defeito (`logs/red-r31-testes-sobre-r3.log`). Confere com o log do autor |
| 7 | Testes da R3 sobre o código da R3 (`r3-puro/`) | 77 testes nos 3 arquivos, contra 85 na R3.1 (+8, nenhum removido). As 4 falhas são do ambiente da cópia: guardas que varrem `functions/` e `firestore.rules`, ausentes nela |
| 8 | 8 mutantes dirigidos da R3.1 (`mutantes/`) | 7 mortos por testes de comportamento e não só pela guarda; 1 sobrevivente só de texto (M8, INFO). Contagem sem as 4 falhas de ambiente, iguais na cópia sem mutação (`logs/baseline-guard-copia.log`) |
| 9 | Experimentos ADV-1 a ADV-6 na R3.1 e na R3 (`experimentos/`) | Ver os achados (`logs/adv-*.log`) |

Mutantes (testes de comportamento + guarda que os mataram):

| Mutante | Mudança | Comportamento | Guarda |
| --- | --- | --- | --- |
| M1 | `holdEstimate` ignora `settling` | 6 | 1 |
| M2 | `holdEstimate` ignora `proven` | 36 | 1 |
| M3 | o prazo de 30 s devolve `current` (prazo aprova) | 13 | 1 |
| M4 | `waitingProof` só sem prova (texto da R3) | 1 | 1 |
| M5 | retenção da última pronta por workspace via `useRef<any>` (escapa da regex da guarda) | 25 | 1 |
| M6 | retenção da última pronta com `refreshFailed: true` | 25 | 1 |
| M7 | a atual sem prova mostrada com aviso | 49 | 1 |
| M8 | `waitedTooLong` não volta a `false` ao sair da espera | **0 (sobrevive)** | 0 |

Não rodei Emulator, Playwright, `build`, `verify*` nem `firebase`. Os resultados de E2E citados (B03-f e "releitura que falha" vermelhos na R3; 25/25 na R3.1) são os logs do autor, conferidos como dados: o B03-f na R3 falha em `[data-work-time]` com 9 elementos convertidos (`evidencia/e2e-red-r3/b03-f-na-r3-error-context.md`).

## 3. Respostas às perguntas

**1. Algum caminho entrega conversão fora de "estado desta renderização + `proven` + `!holding`"? Não.**
- No gancho, `holdEstimate` devolve `unproven` sempre que `state.status === 'done' && (!proven || settling)` (`src/modules/work-time/useIncomeEstimateWith.ts:113-118`). A chamada usa a prova e o `holding` da própria renderização (`:363`). As duas saídas são o erro "em atualização" ou `shown` (`:385-386`).
- O gancho não guarda estimativa: só `waitingSince`/`waitedTooLong` (texto), `projectionReady` e os agendadores (`:171`, `:315-331`, `:368-369`). A guarda proíbe `HeldEstimate`, `last.current` etc. O M5 mostra que os testes de comportamento pegam até uma retenção que a regex da guarda não vê.
- O provedor deriva `config` da estimativa a cada renderização (`src/modules/work-time/WorkTimeContext.tsx:127-135`), e a exibição usa `workTime.config` direto (`src/modules/work-time/display.tsx:79-80`).
- O topo (`src/components/Header.tsx:45-51`, `:529-538`) e a prévia (`src/components/workTime/EstimateDetails.tsx:42-83`) são funções puras do estado.
- Configurações (`src/components/WorkTimeSettingsView.tsx:177`) e o assistente (`src/components/workTime/WorkTimeWizard.tsx:69`) chamam o gancho direto.
- Não há `placeholderData`/`keepPreviousData`, persistência do cache ou `useDeferredValue` em `src/`.
- Troca de conta: o experimento ADV-3 e o teste "B03: troca de conta" não mostram nada da conta anterior.
- Troca de workspace e de preferência: testes novos verdes. Retorno antecipado: não há.
- "Tentar de novo": só dispara releituras; nada é guardado.
- O único caminho em que um dado antigo aparece como atual é o cache do React Query sob a regra 1 da prova (uma base, sem desconsiderada). Ele satisfaz o critério literal (`proven` e `!holding` na própria renderização), é anterior à R3.1 e a R3.1 o reduz. Ver A-01.

**2. O prazo de 30 s só muda o texto? Sim.**
- `waitedTooLong` só é lido em `useIncomeEstimateWith.ts:385`, que devolve `{ status: 'error', message: ESTIMATE_UPDATING, retry }`, nunca `done`.
- A entrada da prova não tem relógio (guarda em `tests/unit/work-time-guard.test.ts`, trecho `proofMemo`).
- O M3 (prazo que aprova) é morto por 13 testes de comportamento. Entre eles, "antes e depois do tempo de interface", que avança 10 min no relógio e 1 h na hora do servidor sem conversão.
- O novo `waitingProof` (`:367`) passa a valer também durante a sincronização longa com prova. Só muda o texto, como pedido.

**3. A conversão volta normalmente? Sim. Algum estado nunca libera? Nenhum novo.**
- Com prova e `!holding`, `shown === state` (tabela-verdade em `tests/unit/work-time-income-estimate.test.ts:76-103`). Nos testes de gancho, a nova aparece "sem esperar o tempo de interface" (`work-time-consistency`, "antes e depois…").
- A R3.1 só muda a apresentação, não a sincronização. Os períodos novos sem conversão (provada, mas `holding`) terminam com a liberação, a rede de volta ou o orçamento dos agendadores (até cerca de 10 min na releitura de mutação; ver A-06/RR-R31-02), ou com o "Tentar de novo".
- Experimento ADV-4 (série relida falhando durante a sincronização): o erro "Não foi possível carregar o relatório. Tente novamente." aparece sem conversão. Com o relatório de volta, o "Tentar de novo" do erro traz a estimativa nova (R$ 11.360,00) com uma leitura, sem aviso.
- A marca quebrada continua sem conversão até a reconstrução (RR-R31-03). Isso vem da R3, que já era assim sem estimativa anterior.

**4. Avisos, "Tentar de novo", preferências e erros: preservados, com uma ressalva (A-02).**
- `ESTIMATE_REFRESH_FAILED`/`ESTIMATE_QUALIFIER_STALE` seguem no estado atual provado e sincronizado (`src/modules/work-time/messages.ts:77`, `:99`; R8-03; E2E "releitura que falha", fase 2).
- Os estados de erro (`useIncomeEstimateWith.ts:231-236`, `:348-362`) e o N05 (`:356-359`) não mudaram. Só saiu o aviso da N06, que existia apenas para a estimativa retida.
- **Sobre `refreshFailed: true` ainda convertendo, é preservação legítima do item 6 e não viola o item 2** (A-04):
  1. É o próprio estado da renderização, não uma estimativa anterior no lugar da atual.
  2. Está provado e não há sincronização segurando.
  3. O aviso é imediato: no ADV-2, a primeira renderização depois do erro da escuta já traz `1106000+aviso`.
  4. O texto diz que a estimativa "usa a leitura anterior". Não aparece como conversão corrente sem ressalva, que era a essência do R3-AUD-01.
- Na releitura que falha sem divergência, a estimativa bate com a projeção confirmada pela escuta.

**5. Os testes reescritos ficaram mais fracos? Em geral não; são mais fortes.**
- R5-02, R6-01, R8-03, R9-01, R10-03, R11-02 e B03 (a) e (d) trocaram "a anterior aparece" por `assertNoConversion` na janela, com o texto exato do erro. Mantiveram as asserções de estado misto, contagem de leituras e recuperação.
- Os 8 testes novos falham na R3 (reproduzido). O teste principal exercita exatamente `!proven && !settling`: sob o M2 (que ignora a prova), ele falha mostrando `'1046000 sem aviso'`.
- Ressalvas: a lacuna do A-03 e as notas do A-06.

**6. Restrições: respeitadas.**
- Nada em Ledger/saldos, `cash_projection_marks`, gatilhos, reconstrução, Rules, índices, Billing, RR-R2A-04 (`cash-pending-entries.spec.ts`) ou estilos.
- Não há funcionalidade nova de histórico: a R3.1 remove a retenção.

## 4. Achados

### A-01 — LOW — Regra 1 da prova sem confirmação da escuta: base do cache e divergência persistente aparecem como atuais (anterior à R3.1)

**Cenário (ADV-1, reproduzido).** Estimativa de uma base e sem desconsiderada em `ws-a` (R$ 11.060,00).
1. A pessoa troca a fonte para `ws-b`. Outra sessão lança R$ 300,00 em setembro de `ws-a`.
2. Dentro dos 5 min do `gcTime` padrão, ela volta para `ws-a`, com a escuta ainda sem retorno do servidor (rede lenta ou sem rede).
3. A base vem do cache do React Query (`staleTime: Infinity`, `refetchOnMount: false`; `src/modules/reports/basisSync.ts:153`, `:159`), sem nenhuma leitura.
4. A estimativa antiga (R$ 11.060,00; o servidor já tem R$ 11.360,00) aparece como `done`, sem aviso, até o primeiro retorno do servidor. Sem rede, isso não tem prazo.
- Religar o tempo de trabalho dentro de 5 min, ou uma fonte escolhida na prévia, segue o mesmo caminho.
- Com desconsiderada ou com 12 meses (ADV-5), a regra 2 exige a projeção confirmada, e nada aparece até ela.

**Variante (ADV-6, reproduzido).** Se a base relida não alcança a projeção que a escuta mostra (exige anomalia no servidor: a série de meses completos vem dos mesmos documentos, `functions/src/reports/cash.ts:106-119`), a liberação acontece depois de `BASIS_DIVERGENCE_RETRIES = 2` (`src/modules/reports/basisRefresh.ts:76`; `basisSync.ts:455`). A base divergente aparece provada e sem aviso.

**Por que não é HIGH/MEDIUM.**
- Não passa por `holdEstimate` nem por retenção.
- Cumpre o critério literal: é o estado da renderização, com `proven` (`src/modules/work-time/consistency.ts:56`) e `!holding`.
- É idêntico na R3 (`logs/adv-r3.log`, `logs/adv456-r3.log`), onde dura mais: a R3 seguia mostrando o valor velho durante a sincronização inteira, e a R3.1 só até o primeiro retorno.
- Corrigir exige mudar a regra 1 ou a política de cache das bases, mecanismo da R3 que o pedido manda preservar.

**Sugestão (etapa própria).** Duas opções:
- tratar como `settling` a estimativa da regra 1 servida de cache enquanto a escuta desta chave e janela não teve retorno do servidor (`confirmed === null` sem `listenFailed`);
- marcar a base como desatualizada quando sai de uso, para ela ser lida ao voltar.

Em qualquer dos casos, registrar a divergência persistente da regra 1 como aviso, não como estado provado.

### A-02 — LOW — "Receitas consideradas" e a contagem da renda ficam indisponíveis em toda janela sem prova ou sincronizando, também no meio da sessão

**Evidência.** `src/components/workTime/IncomeEditor.tsx:46-56` deriva a janela do painel de `state.status === 'done'` (`referenceOf`). Sem isso, a consulta fica desligada (`src/modules/transactions/hooks.ts:76`). O painel então mostra "Carregando as receitas do período..." ou "A estimativa não carregou, então a lista ainda não pode ser montada. Feche e tente de novo." (`IncomeEditor.tsx:145-146`), e a conciliação fica vazia (`:108-110`). A contagem do assistente segue a mesma regra (`:197-203`).

**Comparação.** Na R3, a estimativa retida mantinha a lista durante a sincronização ou a falta de prova da mesma identidade. Na R3.1, a lista some sempre que a prévia sai de `done`. Por exemplo: outra sessão lança uma receita com o painel aberto, ou a marca quebrada até a reconstrução. Desconsiderar ou reconsiderar um item específico fica impossível nessa janela. "Restaurar padrão" segue disponível. É o comportamento que a R3 já tinha numa sessão recém-aberta.

**Impacto.** Item 6 ("comportamento das preferências"): sem risco financeiro nem conversão errada. O efeito é piscar, ou indisponibilidade enquanto durar a falta de prova. O que aparece em reais no painel não converte nada. Não está nos riscos residuais RR-R31-01 a 04.

**Sugestão.** Registrar como risco residual. Se quiser manter o painel, passar a ele a data de referência da série (dado do relatório, sem conversão) em vez de exigir a estimativa pronta.

### A-03 — LOW — O E2E reescrito deixou de cobrir o "Tentar de novo" que traz a receita nova depois da falha do relatório

**Evidência.**
- A versão da R3 terminava com "De volta o relatório, 'Tentar de novo' traz a receita nova" (`git show 1c9155db…:e2e/work-time-p5f.spec.ts:1054-1058`).
- Na R3.1, o "Tentar de novo" só apaga o aviso com a hora oficial (`e2e/work-time-p5f.spec.ts:1098-1103`). A receita nova chega pela sincronização (`:1104-1108`), não pelo botão.
- O caminho de recuperação que a pessoa passa a usar no contrato novo (erro do relatório na sincronização → "Tentar de novo" → conversão com a receita nova) não é exercitado por nenhum teste, nem de unidade nem E2E. O único caso de falha do relatório com "Tentar de novo" é o da primeira carga (`e2e/work-time-p5f.spec.ts:758-763`).

**O comportamento está correto.** O experimento ADV-4 (`experimentos/adv-append-2.ts`) prova que funciona.

**Sugestão.** Incluir esse passo no E2E (fase 1: tirar o `route`, clicar "Tentar de novo" em `work-time-preview-error`, esperar `hourlyAfter`) ou um teste de unidade equivalente ao ADV-4.

### A-04 — INFO — `refreshFailed: true` com conversão (escuta encerrada com uma base e sem desconsiderada; releitura que falha sem divergência)

**Experimento ADV-2:** a primeira renderização depois do erro da escuta já traz o aviso (`1106000+aviso`), e a R3 é idêntica.

**Conclusão.** É preservação legítima do item 6 e não viola o item 2. As razões estão na resposta 4.

**Resíduo.** Com a escuta encerrada, o frescor deixa de ser acompanhado até "Tentar de novo" ou recarregar. O aviso diz isso. Está documentado como RR-R31-04 e na matriz, linha 13.

### A-05 — INFO — Quantificação do RR-R31-02 (12 meses e orçamento da releitura de mutação)

No produto, a releitura de mutação tem 2 por base, com reposição de 1 a cada 10 min (`src/modules/reports/queryKeys.ts:53-57`).

**Cenário.** Os agendadores das duas bases estão fora de fase e uma base relê antes da outra (`basesOutOfStep`, `src/modules/reports/basisRegistry.ts:173`; `basisSync.ts:588`). A estimativa de 12 meses, mesmo provada, fica sem conversão por até cerca de 10 min:
- "Calculando…", depois "em atualização" com "Tentar de novo" em Configurações;
- no topo, "indisponível agora".

O "Tentar de novo" relê as duas bases e resolve. É o que o item 2 manda. O relatório chama isso de "alguns segundos"; vale registrar o pior caso.

### A-06 — INFO — Força e precisão dos testes e documentos

- **(a) Mutante M8 sobrevive.** O código não mudou desde a R3. Sem zerar `waitedTooLong` (`useIncomeEstimateWith.ts:370-375`), o 2º período de espera começa direto em "em atualização". Só muda o texto, nunca a conversão. Nenhum teste cobre dois períodos de espera seguidos.
- **(b) A propriedade de 20 000 passos não faz o que o nome diz.** O nome (`tests/unit/work-time-income-estimate.test.ts:117`) cita trocas de conta, período e outras. O rótulo `change` (`:125`) não entra em `holdEstimate`, então nenhuma troca de identidade é exercitada ali. A cobertura real está nos testes de gancho (troca de conta, workspace, preferência, calendário, janela). `testes-substituidos.md` diz que ela é "estritamente mais forte", o que exagera.
- **(c) O R6-02 reescrito só olha a última renderização.** Ele confere a ausência de conversão só na renderização final (`work-time-income-estimate.test.ts:704`). `testes-substituidos.md` afirma, em geral, "em todas as renderizações da janela". A própria linha do R6-02 na tabela diz "renderização final", e o teste continua vermelho na R3.
- **(d) A espera da hora nova no E2E subiu de 30 s para 45 s.** A frase "nenhuma espera de afirmação foi aumentada" é imprecisa: a espera de `hourlyAfter` passou de 30 s (R3, `:1058`) para 45 s (R3.1, `:1108`). Não é a mesma afirmação: agora ela espera o gatilho de uma receita nova (fase 4), com o mesmo prazo das outras esperas de gatilho do arquivo. Não contorna falha.
- **(e) No B03-f, `toContainText(brl(after))` sozinho não prova reais.** Ele passa até convertido (`e2e/work-time-b03.spec.ts:667`): na R3, o elemento convertido tem "R$ 20.200,00 · tempo de trabalho estimado". Quem prova a ausência de conversão é `[data-work-time]` com contagem 0 (`:668`) e o registrador (`:658`, `:674`). O teste está correto por causa desses dois.

## 5. Artefatos desta revisão

Todos em `<scratchpad>/p5f1r31/revisoes/adversarial/`:

- Logs em `logs/`: `unit-3-arquivos.log`, `unit-work-time-e-bases.log`, `tsc-root.log`, `red-r31-testes-sobre-r3.log`, `r3-puro-3-arquivos.log`, `mutantes-resumo.txt`, `mutante-*.log`, `baseline-guard-copia.log`, `adv-r31.log`, `adv-r3.log`, `adv4-r31.log`, `adv5-r31.log`, `adv6-r31.log` e `adv456-r3.log`.
- Experimentos em `experimentos/`: `adv-append.ts` (ADV-1 a 3), `adv-append-2.ts` (ADV-4), `adv-append-3.ts` (ADV-5) e `adv-append-4.ts` (ADV-6). São anexados a uma cópia de `work-time-consistency.test.ts`.
- Mutantes em `mutantes/`: `mutar.py`, `rodar.sh` e uma cópia por mutante.
- Cópias das árvores: `r31-copia/`, `r3-com-testes-r31/` e `r3-puro/`, montadas por `git archive` das árvores, com link para `node_modules`.
