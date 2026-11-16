VEREDITO: PASS

# Revisão adversarial de qualidade e arquitetura, P5-F.1-R3.2, rodada 4 (focada na mudança da rodada 3)

Árvore revisada: `698f96441df1fbcd63467792c43cdb57b3911d9e`, comparada com a da rodada 3 (`ef514869`). O veredito é
PASS: não há HIGH nem MEDIUM em aberto. Os três achados da rodada 3 estão fechados:

- **ADV-R3-01:** a lista fechada `DECIDED_BEFORE_INCOME` fecha o achado. As sondas R3-P0 a R3-P3, que mostravam o
  motivo falso, agora dão "calculando" ou "em atualização".
- **ADV-R3-02:** corrigido nos rascunhos.
- **ADV-R3-03:** os mutantes U01 e U17 morrem.

O ADV-01 continua valendo para os três motivos da lista, e a guarda da ordem está correta. Ficam dois INFO:

- `DATA_MODEL.md` ainda descreve a regra da rodada 3;
- o `exclusion_unconfirmed` mostrado sem prova não tem teste no gancho.

Veredito da skill `firestore-scale-cost-review`: **PASS** (seção 6).

## 1. Escopo

- **A mudança (9 arquivos):**
  - `useIncomeEstimateWith.ts`: `DECIDED_BEFORE_INCOME` e `dependsOnIncomeReadings` no lugar de `carriesBasisFigures`;
  - `consistency.ts`: comentário;
  - `executar-em-grupos.mjs`: o link físico do `firebase-debug.log` (EST-R3-01);
  - os testes da guarda, da tabela-verdade, do gancho e do executor;
  - comentários do E2E e `DATA_MODEL.md`.
- **O que não muda:** `estimate.ts`, `basisSync.ts`, `grupos.mjs`, `portas.mjs`, Rules, índices e `functions/`.
- **Cópias:** `rodada-4/copia`, `copia-mut` e `copia-sonda`, de `git archive`. O `diff -rq` contra o worktree e contra
  uma extração limpa (`ref`) dá igualdade.
  - O contêiner reiniciou durante a revisão. Conferi depois que as cópias continuavam iguais à árvore, sem mutante
    aplicado.
  - Não alterei o worktree nem o índice, que continua com a data de 11:47:49.
- **Lidos:** as respostas do executor (seção "Rodada 3" do `revisoes-LEIAME.md`), as execuções 55 a 63 do histórico e
  os rascunhos de 00:02 a 00:22.

## 2. Comandos e resultados

Tudo com `nice -n 19`, um de cada vez, nas minhas cópias. Não rodei Emulator, Playwright, E2E, `verify:*` nem
`test:integration*`.

Logs em `<scratchpad>/p5f1r32/revisoes/adversarial/rodada-4/logs/`;
roteiros em `.../rodada-4/scripts/`.

| Comando | Resultado | Log |
| --- | --- | --- |
| Conjunto `test:unit:work-time` | 284/284, saída 0 | `unit-work-time-698f.log` |
| Conjunto `test:unit:reports` | 107/107, saída 0 | `unit-reports-698f.log` |
| `node --test tests/tools/e2e-grupos.test.mjs` | 23/23, saída 0 | `tools-e2e-698f.log` |
| `node --test tests/tools/integracao-marco.test.mjs` | 3/3 | `tools-integracao-698f.log` |
| `npx tsc --noEmit` | saída 0 | `tsc-raiz-698f.log` |
| As sondas R3-P0 a R3-P9 da rodada 3, na árvore nova (`scripts/sonda-r4.ts.txt`: as mesmas, sem as definições que o teste agora traz idênticas) | ver 3.1 | `sonda-r4-698f.log` |
| Mutantes da Frente A, D01 a D10 novos e C05, C08, C09, C11, C12 e C13 da rodada 3 (`scripts/mutantes-adv-r4.py <cópia> A`) | 16/16 mortos; 14 por comportamento; D08 e D10 só pela guarda, como deve ser (3.3) | `mutantes-frente-a-r4.log` |
| Mutantes da Frente B: U01 a U17 da rodada 3 e L01 a L04 novos (`... B`) | 17/21 mortos; U03, U06, L02 e L03 equivalentes (3.4) | `mutantes-frente-b-r4.log` |
| Experimento: `copyFileSync` sobre um link físico do próprio arquivo | conteúdo preservado | `experimento-copia-sobre-link.log` |

O log da Frente B termina no `total`, sem a linha `saida=`. O reinício do contêiner matou o shell depois do último
mutante: os 21 rodaram, e a cópia foi restaurada.

Evidências do executor conferidas:

- **E2E `e2e-p5f-r33-1`** (20/20 na árvore nova): o ADV-01, o B02 das rotinas que se cruzam, o B02 N07 e o S01 da
  véspera reduzida passaram.
- **Mutantes do executor:** `r33-mutantes-cliente-novos` (N17, N18, N21, N22, N25 e N26) com 6/6 mortos.
- **Provas vermelhas:** `r33-vermelho-*` (execução 57) falham em `ef514869`.
- **Execução oficial:** a `verify-all-r32-5` foi interrompida pelo reinício. A `verify-all-r32-6` começou às 11:35Z e
  estava no build durante esta revisão (seção 7).

## 3. Situação dos achados da rodada 3

| Achado | Situação | Evidência |
| --- | --- | --- |
| ADV-R3-01 (LOW) | **Fechado** | 3.1 a 3.3 |
| ADV-R3-02 (INFO) | **Fechado** | O RR-R32-02 do rascunho (`plano-20-20.md`) e o relatório descrevem a regra final. O RR-R32-01 diz: "A que depende das receitas (com números, ou de rotinas ambíguas) espera como a que converte". |
| ADV-R3-03 (INFO) | **Fechado** | Testes `e2e-grupos.test.mjs:618` (o segundo sinal: o neto registra dois SIGINT e sai no segundo) e `:639` (o grupo que escreve o relatório completo e se mata com SIGKILL dá "terminou com saída 1"). O U01 e o U17 agora morrem. |

### 3.1 As sondas da rodada 3 na árvore nova

| Sonda | Rodada 3 (`ef514869`) | Árvore nova |
| --- | --- | --- |
| R3-P0/P0b: edição normal com o gatilho | *flash* de `ambiguous_reduced_eve` | `loading → pronta 704000`, nenhum indisponível |
| R3-P1: estado misto antes do gatilho | motivo falso | `loading`; depois, a pronta sem agosto |
| R3-P2: cache aquecido sem conexão | motivo do cache, sem aviso | `loading → "em atualização"`; com a conexão, a pronta |
| R3-P3: divergência persistente | motivo da base divergente, para sempre | `loading → "em atualização"` |
| R3-P4: rotina ambígua consistente (agosto com renda) | o motivo nos três caminhos | sem retorno do servidor, "em atualização"; com a escuta encerrada, "Não foi possível confirmar…"; sem conexão depois da prova, o motivo e depois "em atualização" |
| R3-P5: `exclusion_unconfirmed` | sem o primeiro retorno, "calculando" (ADV-R2-06); depois dele e sem conexão, o motivo | igual |
| R3-P6/P7: transições com a renda PJ | o motivo da PJ; nunca os números | igual |
| R3-P8/P9: workspace de ida e volta e janela 3 → 6 → 3 | nenhum número antes do retorno | igual |

O R3-P4 é o preço da opção (b), que eu mesmo sugeri no ADV-R3-01. Os motivos de rotina ambígua consistentes também
esperam a prova, inclusive no mês corrente, onde não dependeriam da renda. Não há conversão.

Está escrito no rascunho do plano e do relatório: RR-R32-01, `plano-20-20.md:68`; seção K e item 1 do
`RELATORIO-P5F1-R32.md`. Os testes do gancho do `ambiguous_reduced_eve` (DEPENDS_ON_INCOME,
`work-time-consistency.test.ts:1823-1866`) fixam a saída da espera nas três condições: o servidor responde, o "Tentar
de novo" reabre a escuta, ou a anomalia acaba. Não é regressão escondida, e não achei estado sem saída.

### 3.2 O ADV-01 para os três motivos da lista

- **`business_not_confirmed`:**
  - os testes WITHOUT_FIGURES do gancho, sem mudança, sem retorno do servidor, com a escuta encerrada e com
    divergência, e depois da prova, sem conexão, com a escuta encerrada e com divergência, em 3 e 12 meses;
  - o E2E "ADV-01 (R3.2)" (`e2e-p5f-r33-1`);
  - as sondas R3-P6 e R3-P7;
  - o D04 morre em 10 testes do gancho.
- **`report_unavailable`:** os testes WITHOUT_FIGURES; o D05 morre em 4 testes do gancho e 2 da tabela.
- **`exclusion_unconfirmed`:**
  - a tabela-verdade e a guarda; o D03 morre só nelas;
  - no gancho, a minha sonda R3-P5: depois do primeiro retorno do servidor e sem conexão, o motivo aparece como está;
  - antes do primeiro retorno vale o ADV-R2-06, já documentado.

  Falta um teste do gancho para esse caminho (ADV-R4-02, INFO).

### 3.3 A lista fechada e a guarda da ordem

**`dependsOnIncomeReadings`** (`useIncomeEstimateWith.ts:113-127`). É `!(unavailable && DECIDED_BEFORE_INCOME.has(reason))`:

- a pronta e todo motivo fora da lista esperam, inclusive um motivo novo (fail-closed);
- a tabela-verdade testa `motivo_novo` e confere a classificação contra `UNAVAILABLE_REASON_TEXT`;
- o D06 (a regra estrutural da rodada 3 mais as ambíguas, que deixaria passar um motivo novo sem números) morre por
  esse teste.

**Os mutantes da lista:**

| Mutante | Resultado |
| --- | --- |
| D01 as duas ambíguas voltam à lista | morto (6 do gancho, as sondas R3-P1 a R3-P3 e o laço DEPENDS_ON_INCOME, além da tabela) |
| D02 só `ambiguous_routines` volta | morto pela tabela; nenhum teste do gancho usa `ambiguous_routines` (o motivo é o mesmo caso do `ambiguous_reduced_eve`) |
| D07 a negação trocada | morto (20 do gancho) |

**A guarda** (`work-time-guard.test.ts:467-482`). Ela fixa as expressões de `DECIDED_BEFORE_INCOME`, de
`dependsOnIncomeReadings` e do `holdEstimate`. Também confere que os motivos devolvidos em `computeWorkTimeEstimate`
antes do primeiro `applyIncomeExclusions(` são exatamente os três da lista, e que nenhum deles aparece depois.

- **Correta.** Em `estimate.ts:159-171`, os três motivos saem antes de `applyIncomeExclusions` (`:172`) e não leem
  valor de receita:
  - `business_not_confirmed` lê o tipo do workspace e a preferência;
  - `report_unavailable` lê o estado do bloco e a presença dos meses na série;
  - `exclusion_unconfirmed` lê a leitura por id e a janela.
- **Pega o que deve.**
  - D08: `exclusion_unconfirmed` depois das desconsideradas.
  - D10: um motivo novo decidido pela receita antes delas.

  Os dois só mudam a ordem ou acrescentam um motivo que já seria segurado, e morrem só pela guarda, que é o papel
  dela.
- **Limite.** A guarda confere a posição, não os insumos. O D09 põe `report_unavailable` também quando a janela não tem
  renda, isto é, decidido pela receita antes das desconsideradas. Ele passa pela guarda e morre pelos testes de
  comportamento: 3 do gancho e 2 de `work-time-estimate`, porque o motivo `no_income` some. Não é achado: o caso
  realista, um motivo da lista que passasse a ler a receita, mudaria o motivo de estados que os testes fixam.
- **Fragilidade.** Uma refatoração cosmética, como um motivo em constante, outro nome para `emptyBase` ou um comentário
  com `applyIncomeExclusions(` antes da chamada, faz a guarda falhar alto, com a lista diferente. Nunca passa em
  silêncio.

  Um motivo novo antes das desconsideradas, com valor não literal, escaparia da contagem. Mas, fora da lista fechada,
  ele espera a prova, então o erro só pode ser para o lado seguro. É frágil na medida certa para uma guarda de ordem.

**Os mutantes C da rodada 3, adaptados, morrem todos por comportamento:** C05 (7), C08 (5 do gancho), C09 (4), C11 (10),
C12 (5) e C13 (1).

### 3.4 Frente B: a mudança do executor

**O link do `firebase-debug.log`** (`executar-em-grupos.mjs:69-104,170-173`).

- **Não entra na decisão:** `ok` continua dependendo só da interrupção, da conferência da lista e das linhas de saída e
  de porta.
- **Uma falha do link não derruba nada:** `linkSync` e `mkdirSync` ficam em `try`, e o fim do grupo ainda copia o
  que existir.
- **Sem custo relevante:** um intervalo de 500 ms enquanto o grupo roda, parado na saída e no erro.

**Mutantes da Frente B:**

| Mutante | Resultado | Por quê |
| --- | --- | --- |
| L01 o link nunca é feito | morto (teste do EST-R3-01) | — |
| L04 os relatórios antigos não são apagados (X09) | morto | — |
| L02 o link tentado uma vez só | sobrevive; equivalente | O Playwright 1.60 apaga as pastas de saída (`createRemoveOutputDirsTask`) antes de subir o `webServer` (`playwright/lib/runner/index.js:5828-5834`). Quando o log existe, a pasta já não vai ser apagada. |
| L03 a cópia do fim sobre o link | sobrevive; equivalente | `copyFileSync` sobre um link do próprio arquivo preserva o conteúdo (experimento). |
| U03 e U06 | sobrevivem; equivalentes | como na rodada 3 |
| Os outros U, inclusive U01 e U17 | mortos | — |

`grupos.mjs` não mudou desde a rodada 3: a sondagem da lista de aceitos dela continua valendo.

**Os testes novos do executor também matam** o sinal antes do primeiro grupo (U09 em 5, U15 em 3) e o relatório de
outra execução (L04). Os instantes de sinal são tirados da saída, e o `finally` não deixa o executor órfão.

## 4. Achados novos

### ADV-R4-01: INFO. `DATA_MODEL.md` ainda descreve a regra da rodada 3

- **Onde:** `docs/production/DATA_MODEL.md`, linha "Listeners" (o fim da célula). O texto diz: "A estimativa
  indisponível sem números (os motivos que saem antes de qualquer receita) … aparece como está …; a indisponível com a
  memória de cálculo preenchida espera a mesma prova".
- **O que falta:** não diz que a de rotinas ambíguas, sem números, também espera, nem cita a lista fechada.
- **Gravidade:** o parêntese casa com a lista final, mas "sem números" sugere o contrário para os motivos ambíguos. O
  plano e o relatório já trazem a regra final, e `docs/` ainda pode mudar depois da árvore.
- **Sugestão:** "a indisponível por um motivo decidido antes das receitas (`DECIDED_BEFORE_INCOME`) … aparece como
  está; toda outra, com números ou de rotinas ambíguas, espera a mesma prova (F-08, ADV-R3-01)".

### ADV-R4-02: INFO. O `exclusion_unconfirmed` mostrado sem prova não tem teste no gancho

- **O que acontece:** o D03 (o motivo fora da lista, que passaria a esperar a prova e sumiria sem conexão) só morre pela
  tabela-verdade e pela guarda.
- **O que já existe:** o comportamento no gancho está certo, como mostra a sonda R3-P5.
- **Sugestão:** um teste do gancho com o recebimento sem estado de estorno confirmável, sem conexão depois do primeiro
  retorno do servidor, como a R3-P5.

## 5. Achados em aberto

| ID | Severidade | Resumo |
| --- | --- | --- |
| ADV-R4-01 | INFO | `DATA_MODEL.md` descreve a regra da rodada 3 ("sem números"), sem as rotinas ambíguas esperando a prova. |
| ADV-R4-02 | INFO | O `exclusion_unconfirmed` mostrado sem prova não tem teste no gancho; o D03 só morre pela tabela-verdade e pela guarda. |

## 6. Firestore scale/cost review

PASS — Firestore scale/cost review

- **Escopo:** a mudança é pura (`DECIDED_BEFORE_INCOME`, `dependsOnIncomeReadings`) ou da ferramenta de teste (o
  link do log). Nenhuma consulta, escuta, índice, regra ou Function muda: o diff `ef514869..698f9644` não toca
  `firestore.rules`, `firestore.indexes.json`, `functions/`, `reports/hooks.ts`, `basisSync.ts` nem `incomeReads.ts`.
- **Leituras:**
  - Segurar também os motivos ambíguos só adia a leitura da janela de receitas do painel "Receitas consideradas"
    (`useIncomeWindow` exige o `referenceDate` da estimativa mostrada). Nunca acrescenta leitura.
  - A leitura por id e as releituras da base não dependem do estado mostrado.
  - As releituras por divergência continuam ≤ 2: o teste DEPENDS_ON_INCOME confere `w.calls.series === 3` também com
    o motivo ambíguo.
- **Itens da checklist:**
  - isolamento por workspace, consulta limitada (`limit(13)`), índices, ausência de N+1 e de escuta nova, ciclo de vida
    da escuta, nenhuma escrita: iguais à rodada 3, que deu PASS;
  - remoção do legado: `carriesBasisFigures` saiu do código e dos testes, e a guarda fixa as expressões novas.
- **Verificação:** unidade 284/284 e 107/107, ferramentas 23/23 e 3/3, `tsc` 0, mutantes 16/16 na Frente A. No
  Emulator, o E2E `e2e-p5f-r33-1` do executor (20/20) roda na árvore nova; a execução oficial `verify-all-r32-6` estava
  em curso (seção 7).
- **Achados bloqueantes:** nenhum.

## 7. O que não foi possível verificar

- **A execução oficial `verify-all-r32-6`.** Começou às 11:35Z na árvore `698f9644` e estava no build durante esta
  revisão. Não esperei pelo resultado. A `verify-all-r32-5` foi interrompida pelo reinício do contêiner (execução 62).
- **Nenhuma execução no Emulator nem E2E,** pela regra. O efeito da regra nova nos E2E de rotinas ambíguas vem do
  `e2e-p5f-r33-1` do executor.
- **O guardado do `firebase-debug.log` na execução real** (EST-R3-01): é da revisão de estabilidade. Pelos testes, pelos
  mutantes L01 a L03 e pela ordem das tarefas do Playwright, o caminho está certo.
