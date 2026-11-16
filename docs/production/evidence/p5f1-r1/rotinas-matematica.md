# P5-F.1-R1 — B02: horas de rotinas que se cruzam (fundamento)

Código: `src/modules/work-time/calendar.ts` (`routineDayOf`, `coveredWithoutBreak`, `windowWorkOf`, `occupancyPieces`, `civilOccupancy`, `planDay`, `monthPlan`, `routinesAmbiguity`, `calendarAmbiguity`), `src/modules/work-time/estimate.ts` (primeiro mês da janela com `periodStart`), `src/modules/work-time/draft.ts` (recusa ao salvar) e `src/components/workTime/RoutineEditor.tsx` e `src/components/WorkTimeSettingsView.tsx` (avisos). Testes: `tests/unit/work-time-calendar.test.ts`, `tests/unit/work-time-estimate.test.ts`, `tests/unit/work-time-preference.test.ts` e os E2E `B02 (P5-F.1-R1)` e `B02 (revisão da R1, N07)` de `e2e/work-time-p5f.spec.ts`.

A revisão independente de 2026-11-05 (`revisoes/revisao-1.md`) achou um contraexemplo ao Teorema 2 em dia de jornada reduzida com plantão (N01, N02) e configurações aceitas ao salvar que ficavam sem cálculo seguro por feriado, exceção ou início do período (N07). O teto (§3), a prova (§4) e o conferidor (§2) abaixo são os corrigidos.

## 1. Modelo

- **Eixo contínuo.** Um minuto é `dayNumber(data) × 1440 + minuto do dia`. Uma janela `[s, e)` começa no dia `⌊s/1440⌋` e pode passar da meia-noite (até 24 h; início igual ao fim é um turno de 24 h).
- **Rotina num dia.** Num dia que segue a rotina, cada rotina dá folga, uma duração sem horário (`D480`) ou uma janela com intervalo `b`, com `0 ≤ b < e − s`. Janelas idênticas (mesmo início, fim e intervalo) contam uma vez.
- **Trabalho de uma janela.** `T = [s, e) ∖ B`, em que `B` é um trecho de `b` minutos dentro de `[s, e)`, em posição desconhecida.
- **Tempo trabalhado.** É a medida da união `U = ⋃ Tᵢ`: um minuto conta se alguma atividade está em curso, uma vez só.

## 2. Teorema 1 — quando as horas não dependem da posição dos intervalos

Seja `Z` a união das janelas sem intervalo. Suponha que toda janela com intervalo `Wᵢ` cumpra uma de duas condições:

- **(a) isolada:** não cruza nenhuma outra janela (interseção de medida zero com todas, inclusive as da véspera e as do dia seguinte); ou
- **(b) coberta:** está contida nas janelas sem intervalo das outras (`Wᵢ ⊆ Z`).

Então `|U|` é o mesmo para qualquer posição dos intervalos:

`|U| = |Z ∪ ⋃₍ₐ₎ Wᵢ| − Σ₍ₐ₎ bᵢ`, isto é, `|Z| + Σ₍ₐ₎ (|Wᵢ| − bᵢ)`.

**Prova.**
- Em (b), `Tᵢ ⊆ Wᵢ ⊆ Z`: a janela some na união, seja qual for `Bᵢ`.
- Em (a), `Wᵢ` não encontra nenhuma outra janela. Então `Tᵢ` é disjunto de `Z` e dos demais `Tⱼ`, e contribui com exatamente `|Wᵢ| − bᵢ`.
- As janelas sem intervalo são conjuntos fixos. ∎

**Recíproca (dia ambíguo).** Se uma janela com intervalo cruza outra sem ficar inteira dentro das janelas sem intervalo, há posições dos intervalos com uniões de medidas diferentes. Exemplos:
- **08:00–14:00 e 12:00–18:00, com 30 min cada:**
  - as duas pausas nas pontas de fora (08:00 e 17:30): 9 h;
  - as duas no trecho em comum (12:00–14:00), em horários diferentes: 10 h, porque cada uma cai no trabalho da outra.
- **08:00–12:00 e 13:00–17:00 sem intervalo, mais 11:00–14:00 com 1 h:**
  - pausa no almoço (12:00–13:00): a terceira rotina não acrescenta nada (8 h);
  - pausa fora do almoço: ela acrescenta 1 h (9 h).

O motor não escolhe posição: o dia fica **sem cálculo seguro** (`DayPlan.ambiguous`, `MonthPlan.ambiguousDays`). A estimativa fica indisponível (`ambiguous_routines`), o editor mostra o aviso (`role="alert"`) e salvar é recusado (`validateDraft`). O teste de propriedade "todo dia recusado depende mesmo da posição das pausas" confirma isso em amostras aleatórias: em cada dia recusado, duas posições dão uniões diferentes.

O conferidor `routinesAmbiguity` percorre o período conjunto das rotinas (o mínimo múltiplo comum entre 7 e os ciclos), ou todo o intervalo 2000–2099. Ele devolve o primeiro dia ambíguo e as rotinas envolvidas, para a mensagem.

**Conferidor do calendário inteiro (`calendarAmbiguity`, revisão independente, N07).** As horas de um dia `d` dependem das janelas da rotina de `d` e das de `d − 2`, `d − 1` e `d + 1` quando esses dias seguem a rotina. No primeiro dia do período (§3), não dependem das de `d − 1` e `d − 2`. Dois fatos bastam:
- **Mesmas entradas.** Se `d` não abre o período e os três vizinhos seguem a rotina, `planDay` vê as mesmas janelas que `routinesAmbiguity` viu no mesmo ponto do período conjunto: o resultado é o mesmo.
- **Tirar janelas não cria cruzamento.** Uma janela com intervalo isolada continua isolada com menos janelas. Uma que cruza outra sem ficar coberta já deixa o dia ambíguo com as rotinas sozinhas. Só uma janela com intervalo coberta pode perder a cobertura quando um vizinho sai (`WindowWork.covered`).

Então, além das rotinas sozinhas, só precisam ser conferidos, com o próprio `planDay`:
- o primeiro dia de cada mês, que pode abrir o período da estimativa;
- os dias `x − 1`, `x + 1` e `x + 2` de cada dia `x` sem a rotina (feriado de folga, nacional ou local; férias, folga, ausência, jornada reduzida, alteração de escala);
- só os que têm janela com intervalo coberta;
- de 12 meses antes do mês de hoje (a janela mais longa da estimativa) até 2099.

Salvar recusa o primeiro dia assim a partir de hoje (`validateDraft`), na seção que resolve, com o dia e a causa (`calendarAmbiguityMessage`). Em Configurações, o aviso fica junto do botão de salvar.

A propriedade de solidez confere 220 amostras, cada uma em todos os meses de nov/2025 a fev/2027, como mês avulso e abrindo o período:
- o que o conferidor aceita nunca tem dia ambíguo;
- com a causa nas rotinas, elas sozinhas são ambíguas;
- com a causa num feriado, numa exceção ou no início do período, o dia apontado é ambíguo no calendário.

**Fora do horizonte** (revisão independente 2, M09): o conferidor olha de 12 meses antes do mês de hoje até 2099, que é tudo o que uma estimativa pode usar. Num mês mais antigo, o calendário de exceções pode mostrar "horas sem cálculo seguro" num dia de uma configuração aceita. Exemplo da revisão: a folga de 15/10/2024 deixa 14/10/2024 sem cálculo seguro. Nenhuma estimativa usa esse mês, e o teste do horizonte de 12 meses fixa o limite. É só uma diferença visual no editor (RR-R1-02).

Com a causa nas rotinas, o dia citado é o mesmo do aviso do editor de rotinas: o primeiro em que elas se cruzam, a partir de hoje. Esse dia pode estar suspenso no calendário, por um feriado, uma exceção ou um vizinho suspenso. A recusa vale assim mesmo, porque as mesmas rotinas se cruzam nos outros dias do período conjunto. Na sonda `aceita-causas` (5.000 configurações), isso acontece em 15 das 1.462 recusas, todas com as rotinas sozinhas ambíguas.

Custo medido (revisão independente 2, M04). O conferidor roda uma vez por mudança do rascunho, em Configurações e no assistente:
- sem janela com intervalo coberta, o pré-filtro devolve em 0,1 ms (`sondas/custo-cal`, também com 40 feriados locais, 67 jornadas reduzidas de um ano e 120 férias). Essa sonda só mede esse caminho;
- com cobertura, nas 5.000 configurações aleatórias de `sondas/aceita`, a média é de 9 ms e o pior caso fica entre 59 e 80 ms;
- na sonda da revisão (`revisoes/sondas-revisao-2/b02-custo.mts.txt`), rodada na árvore final: configuração comum, 0 a 1 ms; coberta sem exceções, 42 a 84 ms; pior caso da gramática (3 rotinas cobertas, uma escala cíclica 27 × 26, 120 exceções de 366 dias e 40 feriados anuais), 368 a 389 ms, e `validateDraft` inteiro, 481 ms (`logs/execucoes/sonda-final-custo-m04.log`; na mesma sonda, a revisão mediu 385 a 520 ms).

O pior caso pesa algumas centenas de milissegundos por mudança do rascunho, só nessas configurações extremas. É risco de desempenho registrado (RR-R1-04), sem efeito em valores.

## 3. Atribuição aos dias e ao período

- Um minuto conta no dia em que começou a janela que o cobre. Coberto por janelas de dias diferentes, ele conta no dia da que começou antes, a véspera: `minutos de janelas de d = |Uᵈ| − |Uᵈ ∩ Uᵈ⁻¹|`. Aqui `Uᵈ⁻¹` são as janelas da véspera que aconteceram: a véspera seguiu a rotina, sem feriado de folga, alteração de escala, jornada reduzida nem ausência.
- **Período (P5-F.1-R1).** O primeiro mês da janela da estimativa abre o período (`monthPlan(..., { periodStart: true })`). O primeiro dia não desconta o que começou na véspera, porque a véspera fica fora da janela. Assim, a soma dos minutos de janelas do período é `|⋃ Tᵂ|` sobre as janelas que começam no período.
- **Teto (P5-F.1-R1; revisões independentes 1, N01 e N02, e 2, M03).** Sejam, num dia `d`:
  - `r`: os minutos da rotina que contam. São as janelas e durações; ou o menor entre elas e o limite da jornada reduzida; ou o valor da alteração de escala; ou 0.
  - `a`: os acréscimos (plantão e hora extra).
  - `x`: as durações sem horário.
  - `w = w^c + T`: os minutos de janelas atribuídos ao dia (se ele seguisse a rotina). `w^c` é a parte no dia civil de `d`, e `T` a parte depois da meia-noite, no dia civil seguinte.
  - `A`: os minutos atribuídos à véspera que caem no dia civil de `d`. É o `T` da véspera quando ela segue a rotina e está no período; senão, 0 (§6).
  - `P`: o que o trecho depois da meia-noite das janelas da véspera **ocupa** no dia civil de `d`, pela convenção da ocupação (`civilOccupancy`).
  - `D = A − P ≥ 0`. É a parte de um intervalo da véspera que a convenção põe depois da meia-noite e que uma janela de `d` cobre: conta na véspera (que começou antes), mas ocupa o dia civil pela janela de `d`.
    - `D = 0` quando `d` não segue a rotina: a janela com intervalo da véspera precisa então estar coberta sem as janelas de `d`, senão a véspera fica sem cálculo seguro.
    - `D = 0` também quando a véspera não segue a rotina ou fica fora do período.

  O código calcula `o = w − (ocupação das janelas de d além da da véspera no dia civil)` (`afterMidnight`), que dá `o = T − D` e pode ser negativo. O teto é `F = 1.440 − P`, e o dia conta `m = min(r + a, min(r, o) + F)`, com `o + F = T + 1.440 − A`:
  - **Num dia que segue a rotina**, `o ≤ T ≤ w ≤ r`, e então `m = T + min(w^c + x + a, 1.440 − A)`.
    - Os minutos de janelas depois da meia-noite contam sempre.
    - No dia civil, as janelas, as durações e os acréscimos só ocupam o tempo que a véspera deixa livre.
    - O dia civil tem `A + (m − T) ≤ 1.440`. Minutos de janelas nunca são cortados, porque `w^c ≤ 1.440 − A`.
  - **Num dia que não segue a rotina** (jornada reduzida, feriado de folga, alteração de escala, ausência), `D = 0`. Até `min(r, T)` minutos da rotina cabem depois da meia-noite (`T = 0` quando a rotina não acontece); o resto e os acréscimos, no tempo livre do dia civil.

  O caso de `D > 0` (revisão 2, M03): segunda 20:00–24:00 e terça 00:00–06:00 sem intervalo, mais segunda 22:00–04:00 com 3 h de intervalo, coberta pelas duas.
  - A segunda conta 00:00–04:00 de terça (`A = 240`). Pela convenção, ela ocupa 01:00–04:00 (`P = 180`), e a terça tem `D = 60`, `T = 0`, `w = 120` e `o = −60`.
  - Com 24 h de hora extra, a terça conta `120 + (1.440 − 360) = 1.200`. O dia civil fica em 360 min de janelas mais 1.080 de hora extra.
  - Um `o` limitado a 0 daria 1.260 e 25 h no dia civil. O teste dirigido "o intervalo da véspera coberto pelo dia" fixa isso, e o mutante U68 é morto.

  Outros pontos do teto:
  - Na árvore revisada pela revisão 1, um dia de jornada reduzida não contava as próprias janelas na ocupação e zerava `o` quando a redução mordia (N01, N02). Isso dava um teto descontínuo: 25 h 40 min num dia civil, e horas a menos ao acrescentar rotina.
  - Só para a ocupação, o intervalo de uma janela fica no fim do trecho do dia em que ela começa, e o que não cabe ali vai para depois da meia-noite. É uma convenção fixa, que depende só da própria janela. Numa janela isolada, ela decide em que dia civil caem os minutos; numa coberta, só a ocupação (daí `D`).

## 4. Teorema 2 — acrescentar uma rotina válida nunca tira horas

Sejam `C` e `C' = C + rotina` duas configurações com cálculo seguro (nenhum dia ambíguo). Sejam as mesmas exceções e os mesmos feriados. Sobre a janela da estimativa, `H(C') ≥ H(C)`. `H` é a soma dos minutos dos dias da janela, com o primeiro mês abrindo o período e com exceções e teto.

**Prova** (reescrita duas vezes: na revisão independente 1, para o teto da jornada reduzida, N01; na revisão 2, M03, porque a versão anterior tratava `o` como "minutos depois da meia-noite", o que falha quando o intervalo da véspera coberto pelo dia ocupa o dia civil). Use a notação do teto (§3).

Ao passar de `C` a `C'`, a união só cresce (Teorema 1), e um minuto só pode mudar de dia de `d` para `d − 1`, quando uma janela nova da véspera o cobre. Isso só acontece se a véspera segue a rotina; numa véspera sem ela, as janelas não contam para `d`. Então:

1. **`T_d` nunca diminui** (`ΔT_d = T'_d − T_d ≥ 0`). Os minutos de `d` depois da meia-noite não passam para a véspera: uma janela da véspera tem até 24 h e termina antes da meia-noite de `d`.
2. **`A_{d−1}` cresce `δ_d ≥ 0`.**
   - Com a véspera seguindo a rotina no período, `A_{d−1} = T_{d−1}` e `δ_d = ΔT_{d−1}`.
   - Sem ela, ou no primeiro dia do período, `δ_d = 0`.
3. **`w^c_d` perde no máximo `δ_d`.** Só saem do dia civil de `d` os minutos que a véspera passa a cobrir. Por isso `w_d` e `r_d` também perdem no máximo `δ_d`, e as durações `x` só crescem.
4. **Num dia que segue a rotina**, `m_d = T_d + min(w^c_d + x_d + a_d, 1.440 − A_{d−1})` (§3). Com 1 a 3, `m'_d ≥ m_d + ΔT_d − δ_d`.
5. **Num dia que não segue a rotina**, `D_d = 0` e `m_d = min(r + a, min(r, T_d) + 1.440 − A_{d−1})`.
   - `min(r, T)` não diminui (com `R` o limite da jornada reduzida, infinito sem ela). Se `min(r, T) = T`: de `R ≥ r ≥ T` e `w' ≥ T' ≥ T` vem `r' = min(w' + x', R) ≥ T`. Se `r < T`: a redução morde (`r = R`) e continua mordendo (`w' + x' ≥ T' > R`), então `r' = R = r`.
   - O primeiro termo perde no máximo `δ_d` (3), e o segundo também (2).
   - Logo `m'_d ≥ m_d − δ_d`. As janelas desse dia não contam como véspera do dia seguinte (`δ_{d+1} = 0`, §6).
6. **Soma sobre o período.** Cada perda `δ_d > 0` vem de uma véspera `d − 1` que segue a rotina e está no período. Ela é compensada pelo ganho `ΔT_{d−1} = δ_d` dessa véspera (4). O primeiro dia do período não tem `δ` (§3, Período), e o `ΔT` do último dia só soma. Logo `H(C') − H(C) ≥ 0`. ∎

`D` não aparece na prova: ele só desloca, dentro do mesmo dia civil, o que a convenção diz ocupado pela véspera para o que está ocupado pelo próprio dia. O teto usa `A`, os minutos atribuídos, e não a ocupação `P`.

**Na vista de um mês avulso** (o calendário de exceções), sem `periodStart`, um minuto do primeiro dia coberto por um turno que começou no último dia do mês anterior conta no mês anterior, pela regra do dia de início. A estimativa nunca usa essa vista para o primeiro mês.

**Verificação** (cada propriedade vale nas amostras do próprio gerador, com as faixas dele):
- "com cálculo seguro, as horas são a união das janelas trabalhadas, em qualquer posição das pausas": 400 amostras e mais de 150 conferidas, cinco posições por amostra.
- "acrescentar uma rotina, entre configurações com cálculo seguro, nunca tira horas": 2.000 amostras, trecho isolado, e o deslocamento dia a dia só para a véspera.
- "na janela de meses da estimativa, com exceções, durações, turnos de 24 h e feriados, acrescentar uma rotina nunca tira horas": 4.000 amostras sobre agosto a outubro de 2026, com o primeiro mês abrindo o período e mais de 600 pares conferidos. Esse gerador limita acréscimos e reduções a 12 h e não alcança o caso da revisão (N01).
- Revisão independente, dirigida a N01: a rotina acrescentada num só dia da semana, as outras ocorrências dele em férias e, nas que sobram, jornada reduzida com plantão e hora extra até 24 h. São 1.500 amostras, mais de 1.000 pares e mais de 300 dias reduzidos no teto. Na árvore revisada, reprova na amostra 14 (cerca de 1 amostra em 5 perdia horas).
- Revisão independente, N02: "sem janela que passe da meia-noite, nenhum dia passa de 24 h", com exceções até 24 h. São 1.500 amostras e mais de 100 mil dias; na árvore revisada, reprova com 2.040 min num dia.
- As buscas da revisão (`b02-cobertura` com 2 × 80.000 amostras e `b02-busca` com 60.000, `execucoes.md`) não acham violação na árvore corrigida.
- Testes dirigidos: contida, parcial, repetida, intervalos longos, vários intervalos, noturnos, entre dias, semanal e cíclica, feriados, plantão, hora extra, limites diários, borda do período, os cenários N01 e N02 da revisão 1 e o M03 da revisão 2 (o intervalo da véspera coberto pelo dia).
- Revisão independente 2: geradores adversariais próprios do revisor, com 182.354 pares, deram 0 violações na árvore corrigida. Os mesmos geradores acham violações na árvore revisada pela revisão 1 (29) e na da P5-F.1 (133), então têm poder (`revisoes/revisao-2.md` §4.1).

## 5. Antes × depois

| Caso | P5-F.1 (`d9b33cd1`) | P5-F.1-R1 |
| --- | --- | --- |
| Exemplo do parecer: 08:00–12:00 e 13:00–17:00 sem intervalo, mais 09:00–11:00 com 1 h 30 min (segunda) | 480 → **390** min | 480 → **480** min (a pausa cai na manhã sem intervalo) |
| Noturno 22:00–06:00 com 1 h (segunda a sexta) e manhã 05:00–09:00 (segunda a sábado), março/2026 | 14.220 min | 26 dias **sem cálculo seguro**: recusado |
| O mesmo noturno sem intervalo | 15.540 min | 15.540 min |
| Revisão 2: 00:00–10:00 sem intervalo e 22:00–10:00 com 10 h | 2 h por dia | **sem cálculo seguro**: recusado |
| Borda do período: 24 h todos os dias, mais sexta 22:00–06:00 (31/07/2026 é sexta), agosto/2026 | 44.640 → **42.840** min | 44.640 → **44.640** min (período); 44.280 na vista do mês avulso |
| Teto: segunda com 22 h sem horário e terça 00:00–08:00, mais segunda 23:00–06:00, outubro/2026 | 7.200 → **6.240** min | 7.200 → **7.440** min |
| Jornada reduzida (4 h) na segunda, terça 00:00–08:00, mais segunda 20:00–06:00, outubro/2026 | 1.920 → 2.880 min | 1.920 → 2.880 min |
| Revisão, N01: segunda 08:00–17:00 com jornada reduzida (10 h) e plantão de 24 h em 05/10/2026, férias no resto de outubro, mais segunda 18:00–20:00 | 1.440 → 1.440 min | árvore revisada: 1.980 → **1.440**; corrigida: **1.440 → 1.440** |
| Revisão, N02: segunda 08:00–17:00 reduzida a 10 h, com 1.000 min de hora extra (nenhuma janela passa da meia-noite) | 1.440 min | árvore revisada: **1.540** (25 h 40 min no dia civil); corrigida: **1.440**, com teto |

As sondas que geram a tabela estão em `sondas/` (`b02.mts.txt`, `b02-reduzida.mts.txt`, `exemplo-noturno.mts.txt`, `revisao2.mts.txt`). Elas rodam sobre as duas árvores: `node --experimental-strip-types <sonda> <raiz da árvore>`.

## 6. Caso aberto: a véspera em jornada reduzida (revisão 5, S01)

Num dia de jornada reduzida, não se sabe onde caem, dentro das janelas, os minutos que contam. Por isso as janelas desse dia não contam como janelas da véspera para o dia seguinte: `workedWindowsOn` só considera a véspera que segue a rotina. Isso é anterior à R1 e não muda nela.

As duas consequências erram para mais, nunca para menos. Nos exemplos abaixo, o erro é certo, e não só possível.

**Janelas em comum.** Uma janela do dia reduzido pode passar da meia-noite sobre uma janela do dia seguinte. Os minutos da redução que caem depois da meia-noite, dentro dessa janela, contam nos dois dias.
- Exemplo da revisão 5 (`revisoes/sondas-revisao-5/rr-r1-03-janelas.mts.txt`): segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00.
- Só 4 h da segunda existem antes da meia-noite. Então pelo menos 4 h caem em 00:00–06:00 de terça, dentro da janela dela.
- A segunda conta 480 min e a terça, 480: 960 min. O trabalho cabe em 20:00–08:00, no máximo 720 min, então sobram pelo menos 240 min, onde quer que caiam as horas.

**Dia civil do dia seguinte.** O teto do dia seguinte não desconta o trecho do dia reduzido depois da meia-noite. Os acréscimos e as durações podem ocupar as 24 h do dia civil seguinte, e até `min(r, o)` minutos da véspera reduzida ainda caem nele.
- Exemplo (`sondas/dia-seguinte-reduzida`): segunda 20:00–06:00 reduzida a 8 h e terça com 24 h de plantão.
- A terça conta 1.440 min, e pelo menos 240 min da segunda (até 360) estão no dia civil dela: são pelo menos 28 h num dia civil.
- Com a segunda seguindo a rotina, a terça conta 1.080 min.

A árvore da P5-F.1 dá os mesmos números nos dois exemplos.

**Por que não se desconta.** Descontar esse trecho quebraria o Teorema 2: acrescentar segunda 23:00–08:00 aumentaria o trecho depois da meia-noite sem aumentar as horas da segunda, que a redução limita, e tiraria horas da terça. As duas consequências não ferem o Teorema 2. O teste "o dia seguinte a uma jornada reduzida não desconta o trecho dela depois da meia-noite" fixa a regra e a monotonia nesse caso.

**Por que o B02 fica aberto aqui.** O pedido manda recusar, com mensagem, a combinação sem interpretação determinística segura, em vez de produzir um resultado enganoso (`pedido-r1.md:100`). Este caso é uma combinação assim, e o conferidor a aceita. A monotonia vale, mas a correção exigida é mais larga que ela.

**A correção que falta** é local e não muda a arquitetura:
- O `planDay` e o conferidor passariam a tratar como sem cálculo seguro o dia seguinte a uma jornada reduzida cuja janela passa da meia-noite, quando as horas dele mudam conforme a véspera ocupe ou não esse trecho.
- A recusa iria para a seção das exceções, com mensagem própria.

Ela muda a regra de ambiguidade do motor e o argumento de solidez do conferidor. Hoje, sem janela com intervalo coberta, o conferidor não confere nada além das rotinas sozinhas. Por isso ela ficou para a próxima etapa corretiva, com testes e revisão próprios (risco RR-R1-03 do relatório).
