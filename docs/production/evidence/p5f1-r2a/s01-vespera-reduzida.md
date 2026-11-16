# P5-F.1-R2A — S01: o dia seguinte a uma jornada reduzida (fundamento)

**O que este documento cobre.** O caso que a R1 deixou aberto: `p5f1-r1/rotinas-matematica.md` §6, a revisão 5 (S01) e o parecer de 2026-11-06 (§3).
- **Código:** `src/modules/work-time/calendar.ts` (`NeighborWindows`, `neighborWindowsOn`, `certainWindows`, `planDay`, `planDayWith`, `calendarAmbiguity`, `DayPlan.reducedEve` e `MonthPlan.reducedEveDays`), `draft.ts` (mensagem e seção), `estimate.ts` e `messages.ts` (`ambiguous_reduced_eve`), e `ExceptionsEditor.tsx` (nome acessível do dia).
- **Testes:**
  - os testes "P5-F.1-R2A" de `tests/unit/work-time-calendar.test.ts`, `work-time-preference.test.ts` e `work-time-estimate.test.ts`;
  - o E2E `S01 (P5-F.1-R2A)` de `e2e/work-time-p5f.spec.ts`.

O modelo e a notação são os de `p5f1-r1/rotinas-matematica.md` §1 e §3.

## 1. O problema

Rotina: segunda 20:00–06:00 e terça 00:00–08:00, sem intervalo. A segunda 05/10/2026 tem jornada reduzida a 8 h.

| | Segunda | Terça | Soma |
| --- | --- | --- | --- |
| Sem a redução | 600 | 120 (00:00–06:00 já contou na segunda) | 720 = todo o trecho 20:00–08:00 |
| R1, com a redução | 480 | 480 | **960**: mais que os 720 min do trecho |

Por que a R1 chegava a 960:
- o dia reduzido não segue a rotina, então a terça não via as janelas dele (`workedWindowsOn`);
- assim, contava a janela dela inteira;
- e o teto do dia civil dela não descontava o trecho da segunda depois da meia-noite.

Os 480 min da segunda caem em algum lugar do turno 20:00–06:00. Como só 240 cabem antes da meia-noite, pelo menos 240 ficam dentro da janela de terça:
- com a segunda em 20:00–04:00, a terça conta 04:00–08:00 = 240;
- com a segunda em 22:00–06:00, a terça conta 06:00–08:00 = 120.

**Não há um número só:** a configuração não tem interpretação determinística, e o pedido manda recusá-la.

## 2. Modelo da jornada reduzida

- **A redução.** Num dia `p` com jornada reduzida em que a rotina acontece (sem feriado de folga, alteração de escala nem ausência), o dia conta `min(r_p, R)`. Aqui `r_p` são os minutos da rotina e `R` o limite. O limite não diz **quando** esses minutos caem.
- **A única hipótese** do motor: a jornada reduzida é uma **parte** da jornada da rotina. Cada janela `Wᵢ` de `p` tem um intervalo `Bᵢ`, sem horário, numa posição qualquer dentro dela. O trecho trabalhado é qualquer parte fisicamente possível (revisão independente, T04):
  - `K ⊆ ⋃(Wᵢ ∖ Bᵢ)`, para alguma posição dos intervalos;
  - com `|K|`, mais as durações trabalhadas, até `R`.
- **O que conta para o dia seguinte** é o `K` que a véspera ocupou. O que ele ocupa do dia civil seguinte está contido no que a rotina inteira ocuparia pela convenção do intervalo (§3 da R1). A convenção põe o intervalo onde ele tira menos do dia seguinte: dá a maior ocupação e o maior desconto entre as posições.
- **Quando a redução não morde.** Se o máximo que `p` pode contar não passa de `R`, ela não corta nada, e o dia é o da rotina: todas as janelas aconteceram. O máximo é o da §3.

## 3. A regra (R2A)

**Dois tipos de véspera.** Para um dia `d` com véspera `p = d − 1` (`NeighborWindows`):
- **Véspera certa.** `p` segue a rotina, ou tem jornada reduzida que não pode morder: o máximo da rotina de `p` não passa de `R`. Esse máximo é:
  - as janelas de `p`. No **dia 1 de um mês**, sem descontar nada da véspera de `p` (a antevéspera de `d`). Nos outros dias, descontando só a véspera de `p` que segue a rotina;
  - mais as durações.

  **Por que o dia 1 é diferente.** Ele é o único dia que pode abrir o período da estimativa, e lá é contado sem a véspera. Com ela, só conta menos. Nos outros dias, `p` é sempre contado com a véspera, e o desconto é o mesmo do cálculo do próprio dia. Assim, a redução que não morde não morde em nenhuma vista de `p`.

  **Como se chegou aqui** (§9):
  - a versão revisada descontava a véspera em todos os dias e errava no dia que abre o período (R2A-01);
  - a primeira correção tirou o desconto de todos os dias, e a segunda rodada da revisão mostrou que isso recusava dias que nunca abrem o período (T13);
  - o desconto voltou fora do dia 1.

  Na véspera certa, as janelas de `p` contam para `d` como na R1. Feriado de folga, alteração de escala e ausência também são certos, mas com nenhuma janela.
- **Véspera incerta.** É a jornada reduzida que pode morder. O motor calcula `d` duas vezes, com os dois extremos de `K`:
  - **(i)** nenhuma janela de `p`, ou seja `K = ∅`;
  - **(ii)** todas as janelas de `p`, ou seja `K = ⋃Wᵢ`, como se `p` seguisse a rotina.

  Com os dois cálculos seguros e iguais, `d` vale esse número. Senão, `d` fica **sem cálculo seguro**: `ambiguous` e `reducedEve`.

**Os outros vizinhos.** Para o dia seguinte e a antevéspera, uma véspera incerta não entra: não cobre nem cruza (`certainWindows`). A §6 explica por que isso é seguro.

**Mesma mensagem nas três telas.** A recusa aparece ao salvar (`validateDraft`, seção das exceções) com:

> Com a jornada reduzida de segunda-feira, 05/10/2026, não dá para confirmar que parte do horário que passa da meia-noite (Rotina 1) foi trabalhada, e por isso as horas de terça-feira, 06/10/2026, não podem ser calculadas com segurança. Troque a jornada reduzida desse dia por uma alteração de escala ou ajuste os horários das rotinas.

A mensagem diz "não dá para confirmar", e não que "as horas dependem disso". Nos casos conservadores (§5), a parte trabalhada pode até fixar as horas, mas a regra não consegue confirmá-lo (revisão independente, T03).

- A estimativa de uma configuração já gravada fica indisponível (`ambiguous_reduced_eve`): "Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite, e não dá para confirmar que parte dele foi trabalhada: as horas desse dia não podem ser calculadas com segurança. Ajuste as exceções ou as rotinas em Configurações." (T08: "o dia anterior", em vez de "a véspera" sem referente).
- O calendário de exceções mostra o dia com "?" e o nome acessível "horas sem cálculo seguro: jornada reduzida na véspera".

## 4. Teorema 3 — a regra é segura

**Enunciado.** Se o motor aceita `d` (cálculo seguro), então `d` vale o mesmo número para **toda** parte fisicamente possível `K` que a véspera tenha trabalhado (§2: `K ⊆ ⋃(Wᵢ ∖ Bᵢ)` para alguma posição dos intervalos, até `R`) e para toda posição dos intervalos de `d`. Vale nas duas vistas de `d`: no meio do período e quando `p` abre o período (§9).

**Prova.** Na notação da R1 §3, `m = min(r + a, min(r, o) + 1.440 − P)`, em que:
- `r` = os minutos da rotina que contam;
- `a` = os acréscimos;
- `o` = o trecho das janelas de `d` depois da meia-noite, menos a sobra do intervalo da véspera coberta pelo dia;
- `P` = o que a véspera ocupa no dia civil de `d`.

Fixe uma posição `β` dos intervalos. Os três termos dependem de `K` assim:
1. **`r` só diminui quando `K` cresce.** Os minutos de janelas de `d` são `|U_β ∩ ⋃W_d ∖ K|`, onde `U_β` é a união trabalhada (sem `K`, que é descontado inteiro). Isso só diminui com `K`. `r` é função crescente deles: o menor com o limite de `d`, a alteração de escala constante e a ausência 0.
2. **`P` só cresce com `K`**, porque é a ocupação do dia civil por `K`.
3. **`o − P` só diminui com `K`.** `o − P = w − |(peças das janelas de d ∪ K) ∩ dia civil|`, com `w` decrescente e a união crescente.

Logo os dois termos do `min` diminuem com `K`, e `m` diminui com `K`. Para todo `K` fisicamente possível, vale `m(ii) <= m_β(K) <= m(∅)`. O extremo (ii) é `planDayWith` com todas as janelas de `p` e o intervalo na posição da convenção, que dá a maior ocupação e o maior desconto (§2).

Para um `K` com minutos de intervalo, que não é fisicamente possível, o valor pode sair da faixa. A revisão independente achou 543 casos assim em 260.000 configurações, e nenhum entre 6.846.581 partes fisicamente possíveis (`revisoes/`, T04).

O motor só aceita quando:
- (i) e (ii) têm cálculo seguro, então não dependem de `β`;
- e são iguais.

Então `m_β(K)` é constante. ∎

**No código**, o mesmo argumento dá `(ii) <= (i)` sempre: os três termos de `planDayWith` com `previous = ⋃Wᵢ` contra `previous = []`. Para a teoria, um valor aceito nunca depende da parte trabalhada da véspera. Na prática, o motor não escolhe posição nem trunca.

**Corolário (dia civil).** Num dia aceito depois de uma véspera reduzida, o que `d` conta no próprio dia civil mais o que a véspera ocupa nele não passa de 1.440, onde quer que tenham caído as horas dela.

O motivo: `m <= min(r, o) + 1.440 − P(K)` para todo `K`, e o trecho depois da meia-noite fica no dia civil seguinte. Isso fecha a segunda consequência do S01 (R1 §6, "Dia civil do dia seguinte"). Exemplo: segunda 20:00–06:00 reduzida a 8 h e terça com 24 h de plantão. A R1 contava 1.440 na terça, com pelo menos 4 h da segunda no mesmo dia civil (28 h). Agora:
- (i) dá 1.440 e (ii) dá 1.080, então a terça fica sem cálculo seguro e a configuração é recusada;
- com 4 h de plantão, os dois dão 240, e a terça é aceita.

## 5. Quando a recusa é necessária e quando é conservadora

A regra é **suficiente**, não necessária: usa os extremos `∅` e `⋃Wᵢ`, e não só as partes do tamanho exato da redução.

**Necessária.** Considere `d` sem minutos sem horário nem exceções, e `p` fora do dia 1 de um mês e sem véspera reduzida que cruze as janelas dele (as fontes 2 a 4 abaixo). Então as horas de `d` são `|⋃W_d| − |K ∩ X|`, com `X = ⋃Wᵢ ∩ ⋃W_d`. O motor recusa exatamente quando:
- a redução morde (`R < r_p`);
- e `X` tem medida positiva (o turno cruza uma janela de `d`).

Nesse caso há duas partes possíveis de medida `R`, uma com o máximo de `X` e outra com o mínimo, que dão horas diferentes:
- o mínimo de `|K ∩ X|` é `max(0, R − |⋃Wᵢ ∖ X|)`;
- o máximo é `min(R, |X|)`;
- eles só coincidem com `R = 0` ou `R >= r_p`.

A propriedade "o recusado depende mesmo dela" confere isso em todas as amostras desse tipo (mais de 150 por execução).

**Conservadora.** A regra também recusa casos em que toda parte fisicamente possível dá o mesmo número. A revisão independente (T03) mostrou que as fontes são mais largas do que a versão anterior desta seção dizia. São quatro:
1. **O teto com minutos sem horário ou acréscimos em `d`.** A diferença entre os extremos pode vir só do teto, com uma ocupação maior que a que cabe em `R`. Exemplos:
   - segunda 20:00–08:00 reduzida a 4 h e terça só com 19 h sem horário: a terça vale 1.140 em qualquer parte de 4 h, mas, com o turno inteiro, valeria 960;
   - noturno 19:00–07:00 reduzido a 6 h e terça 07:00–23:00 com 2 h de hora extra: o valor físico é 1.080 (revisão, caso A). Com 1 h de hora extra, é aceito com 1.020.
2. **Uma jornada reduzida no próprio `d`.** O limite de `d` pode esconder a diferença dos extremos.
3. **Reduções seguidas.** Por exemplo, segunda 20:00–08:00 com 1 h e terça 06:00–18:00 com 10 h 50: o valor físico é 650 (revisão, caso C).
4. **O máximo sem a véspera de `p` no dia 1 de um mês (R2A-01).** Quando `p` é o primeiro dia de um mês e as janelas dele cruzam o turno da véspera, o máximo sem desconto pode passar de `R` mesmo que, descontada a véspera, `p` não morda. Exemplo: domingo 31/05/2026 22:00–06:00, segunda 01/06 01:00–01:00 reduzida a 20 h e terça 00:00–02:00.
   - Com o domingo, a segunda conta 1.140, e a terça valeria 60.
   - Abrindo o período em junho, a segunda conta 24 h, o limite corta, e a terça vale de 60 a 120.

   A recusa é **necessária** na vista do período que começa nesse mês. Como a mesma configuração vale para todos os períodos, ela vale para a configuração. Num dia que não é o 1º, o mesmo caso é aceito: a segunda 05/10/2026 dá 1.140 + 60.

O caso B da revisão (domingo 20:00–08:00 e segunda 06:00–02:00, os dois reduzidos a 1.100, e terça 00:00–04:00, que valeria 120) é da fonte 3. O domingo reduzido não segue a rotina e não é descontado. Sem a redução de domingo (B0), é aceito com 120.

**Por que se aceita a recusa conservadora:**
- a regra mais fina dependeria de saber como os minutos reduzidos se dividem entre janelas, durações e intervalos, e a pessoa nunca informou isso;
- a regra dos extremos só supõe que a redução é parte da rotina;
- descontar também a véspera reduzida certa (a sugestão do T03) exigiria uma recursão pela cadeia de dias reduzidos, que pode ter milhares de dias, por um ganho pequeno; a fonte 4 já ficou restrita ao dia 1 de um mês, o único que pode abrir o período;
- a saída é a mesma da mensagem: alteração de escala no dia reduzido;
- a mensagem não afirma que as horas dependem da parte, só que a parte não pode ser confirmada (§3).

**Frequência medida:**

| Gerador | Recusas pela véspera reduzida | Conservadoras |
| --- | --- | --- |
| Oráculo do teste de unidade (4.000 amostras; a véspera de `p` é folga) | 1.525 | **159 (10,4%)**. As partes de tamanho `R` mais tarde e mais cedo dariam o mesmo número. Sonda `contagens-oraculo`, com saída igual antes e depois da R2A-01 |
| Revisão independente, gerador adversarial (árvore `cf9cb2a9`, antes da R2A-01) | 134.889 pares | 11.896 (8,8%), quase todas com minutos sem horário ou exceção em `d` |
| Genérico (3.000 configurações, sonda `custo-conservador-r2a01`) | 572 configurações recusadas pela regra de `cf9cb2a9`, sem a R2A-01 | a regra final recusa **as mesmas 572**: nenhuma a mais, nenhuma a menos. A regra estrita da primeira correção (sem desconto em nenhum dia, `63e4c3c6`) recusava 578: 6 a mais (0,2%), nenhuma num dia 1 |

- Das 159 do oráculo, 98 têm mais de 12 h de minutos sem horário e acréscimos no dia seguinte. As outras 61 têm turnos de véspera longos, que entram muito no dia seguinte.
- Nos casos comuns dos testes dirigidos (noturno até 08:00, escala 24 × 48, horário de escritório), não há recusa.

O detalhe está em `testes-e-resultados.md`.

## 6. Teorema 2 estendido — acrescentar uma rotina válida nunca tira horas

**Enunciado.** Sejam `C` e `C' = C + rotina`, ambas com cálculo seguro. Na janela da estimativa, `H(C') >= H(C)`.

**Prova.** Vale tudo da R1 §4 para os dias com véspera certa que segue a rotina. O que muda é a véspera com jornada reduzida `p` e o dia `d = p + 1`. Os dias aceitos valem `(ii)`, e os da véspera incerta valem também `(i)`, que é igual. Para cada par `(p, d)`, escolhe-se uma representação comum a `C` e `C'`:

1. **`p` incerta em `C'`: usar (i) nos dois.**
   - Em `C'`, `d' = m'(i)`, porque o dia foi aceito.
   - Em `C`, `d = m(ii) <= m(i)` (Teorema 3), ou `d = m(i)` se `p` também era incerta.
   - Com `(i)`, a véspera não leva nada de `d`. Os passos 1 a 5 da R1 dão `m'(i) >= m(i)`, com `δ_d = 0`. Então `d' >= d`: `d` não perde.
   - A própria `p` usa a fórmula do dia que não segue a rotina, igual com ou sem a redução morder (`D_p = 0`, R1 §3). O passo 5 da R1 dá `p' >= p − δ_p`, compensado pela véspera de `p`.
2. **`p` certa em `C'`: usar (ii) nos dois.**
   - Em `C`, `d = m(ii)`: ou `p` era certa, ou incerta com `(i) = (ii)`.
   - `d` perde no máximo `δ_d = ΔT_p`, pelos passos 2 e 3 da R1.
   - `p` não morde em `C'`, em nenhuma vista (§3 e §9), então conta pela fórmula do dia que segue a rotina. Como `r_p <= w_p + x_p` em `C`, os passos 3 e 4 da R1 dão `p' >= p + ΔT_p − δ_p`.
   - O ganho `ΔT_p` compensa a perda de `d`, e `δ_p` é compensado pela véspera de `p`.
3. **A soma.** Somando sobre o período, cada perda tem um ganho correspondente, como na R1 §4, passo 6. ∎

**Os dois sentidos da certeza.**
- **No dia 1 de um mês,** a certeza de `p` só depende das janelas e das durações de `p`, e do dia seguinte, que só pode torná-la incerta. Acrescentar uma rotina só aumenta o máximo, então `p` certa em `C'` implica `p` certa em `C`, pelos minutos.
- **Nos outros dias,** depende também da véspera de `p` que segue a rotina, cujo trecho é descontado. Acrescentar uma rotina pode deixar `p` certa ou incerta.

A prova acima trata os dois sentidos, e vale nas duas vistas de cada dia (§9).

**O caso que impedia descontar o trecho** (R1 §6: acrescentar segunda 23:00–08:00 com a segunda reduzida). Agora a terça fica sem cálculo seguro, e a configuração é recusada antes de contar menos horas.

## 7. O conferidor (`calendarAmbiguity`)

**Fatos que limitam onde procurar.** A véspera incerta só muda as horas de `d` por três caminhos:
- o trecho em comum;
- a ocupação do dia civil;
- a cobertura de intervalos.

Os três exigem uma janela da véspera que passe da meia-noite. Por isso:
- **Sem jornada reduzida, ou sem janela que passe da meia-noite:** nada muda em relação à R1, e o atalho continua.
- **Com elas, uma passada nova.** Para cada dia de jornada reduzida da janela conferida (de 12 meses antes do mês de hoje até 2099), quando ele tem janela que passa da meia-noite e é incerto, o conferidor roda o próprio `planDay` do dia seguinte.
  - Não há atalho por intervalo: o caso acontece sem intervalo nenhum.
  - Nem filtro pelo dia seguinte: até um dia sem a rotina muda pelo teto.
- **Na passada dos vizinhos da R1**, um dia ambíguo por causa da véspera reduzida recebe a causa nova (`reduced_eve`), em vez de "vizinho".
- **O dia que abre o período.** O segundo dia do período é `planDay(D + 1, D)`, a mesma chamada da vista sem período. A certeza de `D` não depende da vista (§3), e o plano de `D + 1` só lê `D` pelas janelas de vizinho. Por isso a passada nova, que roda `planDay` do dia seguinte a cada jornada reduzida, também cobre o período que começa em `D` (R2A-01, §9).
- **Os outros dois vizinhos.** A véspera incerta não entra como dia seguinte nem como antevéspera. Como dia seguinte, ela só mudaria a classificação de uma janela com intervalo. Essa janela, com todas as rotinas, ou é coberta sem ela, ou já é recusada pelas rotinas sozinhas, ou é achada pela passada dos vizinhos. Como antevéspera, tirá-la só pode tirar cobertura, o que leva a mais recusa, nunca a menos.

**Verificação.** A propriedade "o conferidor acha o dia seguinte a cada jornada reduzida sem cálculo seguro" confere, sem intervalo nenhum, em amostras de nov/2025 a fev/2027, como mês avulso e abrindo o período:
- o que ele aceita não tem dia ambíguo;
- o que recusa aponta um dia `reducedEve` cuja véspera é uma jornada reduzida.

A propriedade de solidez da R1, com intervalos, continua passando.

**Custo e memória por chamada (RR-R2A-02).** A passada nova lê cada dia muitas vezes: ele é véspera, dia e dia seguinte de outros. No pior caso da gramática, com 120 jornadas reduzidas de 366 dias até 2099 e turno noturno todo dia, a primeira versão levava cerca de 1 s por conferência.
- **A memória.** O conferidor guarda, só durante uma chamada e só para o mesmo objeto de calendário, as bandeiras e as janelas de vizinho de cada data. As duas dependem só do calendário e da data.
- **O descarte.** A memória é criada na entrada e desfeita na saída, também com exceção. Fora da chamada nada fica guardado: chamados sozinhos, `dayPlan` e `monthPlan` calculam tudo de novo.
- **O efeito.** No pior caso desta sonda, o tempo caiu para 343 a 436 ms na árvore final; o pior caso da R1 fica em 246 a 305 ms.
- **Os piores casos da revisão (T05).** Com janela coberta, 120 reduções de 366 dias e 40 feriados, as sondas da revisão independente dão de 492 a 1.199 ms na árvore final, contra 430 a 533 ms na R1. São configurações no limite da gramática, e o número fica registrado no RR-R2A-02. Os números estão em `testes-e-resultados.md`.
- **A equivalência.** As saídas da sonda antes × depois são idênticas com e sem a memória. O teste "a memória do conferidor vale só durante a chamada e não muda resultado" muda as exceções do mesmo objeto entre chamadas e confere os dois resultados. O mutante que deixa a memória sobreviver à chamada morre (`mutantes.md`).

## 8. Antes × depois

| Caso | R1 (`08d8c5a2`) | R2A |
| --- | --- | --- |
| Segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00 (parecer, §3) | 480 + 480 = **960**, aceita | terça sem cálculo seguro; salvar recusa (`reduced_eve`); estimativa gravada indisponível (`ambiguous_reduced_eve`) |
| O mesmo, com a redução de 10 h (não corta nada) | 600 + 480 = 1.080, aceita | 600 + **120** = 720, aceita (a véspera certa conta como a rotina) |
| Segunda 20:00–06:00 reduzida a 8 h, terça com 24 h de plantão | 480 + 1.440, **28 h** num dia civil, aceita | terça sem cálculo seguro, recusada |
| O mesmo com 4 h de plantão | 480 + 240, aceita | 480 + 240, aceita (iguais nos dois extremos) |
| Noturno 22:00–06:00 de segunda a sexta, reduzido a 6 h na quarta | quinta 480, aceita | quinta 480, aceita |
| Outubro de 2026 inteiro reduzido a 6 h no noturno | 22 × 360, aceita | 22 × 360, aceita |
| 24 × 48 (07:00–07:00) com o dia de trabalho reduzido a 12 h e 4 h de hora extra no seguinte | 720 + 240 | 720 + 240 |
| Segunda 22:00–08:00 cobrindo a janela de terça 05:00–09:00 com 30 min, segunda reduzida a 5 h | terça sem cálculo seguro, causa "vizinho" | terça sem cálculo seguro, causa `reduced_eve` (a véspera), com a mensagem nova |
| Domingo 22:00–06:00, segunda 05/10 01:00–01:00 reduzida a 20 h, terça 00:00–02:00 | terça 120 (a segunda ignorada) | terça **60**: a redução não corta nada (1.140 <= 1.200), como com a segunda seguindo a rotina. A segunda 05/10 nunca abre o período |
| O mesmo com a segunda em 01/06/2026, um dia 1 | 1.140 + 120, aceita | terça sem cálculo seguro; **recusada** (§5, fonte 4). Abrindo o período em junho, a segunda conta 24 h, e a terça vale de 60 a 120. Com o limite de 24 h, é aceita com 60 |
| Abrindo o período em outubro: quarta 20:00–10:00, quinta 06:00–20:00 reduzida a 850, sexta 00:00–04:00, férias de 03 a 31/10 (C) | 840 + 240 = 1.080, aceita | 840 + 240 = 1.080, aceita |
| C mais quinta 22:00–02:00 (C′) | 850 + 240 = 1.090, aceita (a sexta pode valer 120) | sexta sem cálculo seguro, **recusada**. Antes da R2A-01: 850 + 120 = **970**, menos que C |
| Abrindo o período: quarta 20:00–10:00, quinta 06:00–02:00 reduzida a 1.000, sexta 00:00–04:00 | 1.000 + 240, aceita (a sexta vale de 120 a 240) | sexta sem cálculo seguro, **recusada**. Antes da R2A-01: 1.000 + 120, aceita |

**As sondas.** A primeira linha nas duas árvores sai de `sondas/s01-rapida.mts.txt`, e a tabela inteira de `sondas/antes-depois-s01.mts.txt` (`saidas/antes-depois-s01-r1.log.txt` e `saidas/antes-depois-s01-r2a-final.log.txt`). Rode com `node --experimental-strip-types <sonda> <raiz da árvore>`.

## 9. O dia que abre o período da estimativa (revisão independente, R2A-01)

**O achado (T01, HIGH).** O primeiro dia do período da estimativa (`monthPlan` com `periodStart`, o mês mais antigo da janela) conta as próprias janelas sem descontar a véspera, que fica fora do período (regra da R1). A certeza desse dia, quando ele tinha jornada reduzida, era calculada descontando a véspera. Ele podia ser "certo" (descontada a véspera, a redução não corta) enquanto, no período, a redução cortava. O segundo dia então descontava o turno inteiro dele.
- **Solidez.** Quarta 20:00–10:00, quinta 06:00–02:00 reduzida a 1.000 e sexta 00:00–04:00, com outubro abrindo o período. A quinta conta 1.000 dos 1.200 min de janelas, sem se saber que parte foi trabalhada. A sexta vale de 120 a 240, e o motor dava 120, aceito.
- **Monotonia.** Quarta 20:00–10:00, quinta 06:00–20:00 reduzida a 850, sexta 00:00–04:00 e férias de 03 a 31/10 (C); C′ é C mais quinta 22:00–02:00.
  - As duas eram aceitas, e o período caía de 1.080 para 970 minutos.
  - Com R$ 10.000,00 em outubro, o valor da hora subia de R$ 555,56 para R$ 618,56.
  - A R1 era monótona nesse par: era uma regressão da R2A.
- **Alcance.** A busca dirigida da revisão achou 385 violações de monotonia em 12.474 pares. As buscas genéricas e as propriedades não chegavam lá.

**A correção.** No dia 1 de um mês, o máximo da certeza não desconta a véspera de `p` (§3). É o que `p` conta abrindo o período, e no meio do período `p` só conta menos. Nos outros dias, o máximo desconta a véspera que segue a rotina. Esses dias são sempre contados com a véspera, então o máximo é o do cálculo deles. Assim:
1. a redução certa não corta em nenhuma vista;
2. a certeza de `p` é a mesma nas duas vistas, e o plano do dia seguinte, `planDay(p + 1, p)`, também. O segundo dia do período é calculado pela mesma chamada que o conferidor já roda (§7);
3. os Teoremas 3 e 2 valem nas duas vistas, com as provas das §4 e §6.

**Só o dia 1 é calculado sem a véspera.** Isso está no código:
- `monthPlan` com `periodStart` passa `null` só no índice 0, o dia 1 do mês (`calendar.ts:670`, na árvore final `cd95e1cb`);
- a passada `period_start` do conferidor só olha o dia 1 de cada mês (`:934`).

**As duas rodadas da correção:**
1. A primeira tirou o desconto de todos os dias, na árvore `63e4c3c6`.
2. A segunda rodada da revisão mostrou que isso recusava dias que nunca abrem o período (T13): a segunda 05/10 do caso domingo/segunda de 24 h, e o caso B0 da revisão. A revisão testou a variante "sem desconto só no dia 1" numa cópia dela, e ela entrou na árvore final `cd95e1cb`.

**Custo da correção.** No gerador genérico, a regra final recusa exatamente as mesmas configurações que a regra sem a R2A-01. A estrita recusava 6 a mais em 3.000.

**Testes:**
- **Dirigido**, "B02 (P5-F.1-R2A, R2A-01)": os dois contraexemplos. C é aceita (1.080); C′ e o caso de 1.000 são recusados, com `reduced_eve` em 02/10.
- **Propriedade**, "R2A-01":
  - o sábado 01/08/2026 é reduzido e abre o período;
  - a sexta, fora do período, entra na manhã de sábado;
  - o limite é sorteado perto da faixa entre o sábado com a sexta e sem ela.

  Em cada configuração aceita, o domingo vale o mesmo com o sábado inteiro. Quando o limite corta o sábado abrindo o período, vale o mesmo também com o sábado sem nada. Acrescentar uma rotina nunca tira horas. Contra o motor anterior (`cf9cb2a9`), a propriedade falha na amostra 3: o domingo é aceito com 0, e sem nada do sábado valeria 150.
- **Domingo e segunda de 24 h:** a segunda 05/10 é aceita com 60. A mesma segunda em 01/06/2026 é recusada, com `reduced_eve` em 02/06 e `reducedEveDays` no mês abrindo o período; com o limite de 24 h, é aceita com 60. Contra a regra estrita (`63e4c3c6`), a asserção de 05/10 reprova; contra a anterior (`cf9cb2a9`), reprovam a de 01/06 e os dois testes R2A-01.
- **Mutantes:** morrem o que desconta a véspera também no dia 1 (U11) e o que nunca desconta (U38).
