# P5-F.1 — Modelo de calendário e fontes de feriados

Motor puro em `src/modules/work-time/calendar.ts` (datas em `dates.ts`, feriados em `holidays.ts`). Sem React, sem Firebase; determinístico e testado em `tests/unit/work-time-calendar.test.ts`. As horas de cada mês são calculadas em memória e nunca gravadas.

## Datas civis

Datas são textos `AAAA-MM-DD` do calendário civil, sem hora nem fuso (como o `date` dos lançamentos, São Paulo). A aritmética usa dias em UTC, que não tem horário de verão. Intervalo aceito: 2000-01-01 a 2099-12-31. Anos bissextos e meses de 28 a 31 dias são tratados pela própria data; não há conversão de timestamp.

## Regras de cada dia (nesta ordem)

1. **Rotina.** Para cada rotina, a especificação do dia:
   - semanal: o dia da semana (segunda a domingo; nenhum dia é presumido de folga);
   - escala cíclica: posição no ciclo `trabalho + folga` a partir da data de referência, também para datas anteriores.
   Janela `HH:MM-HH:MM/intervalo`: conta no dia em que começa. `22:00-06:00` é um turno noturno do dia de início; `07:00-07:00` é um turno de 24 h. Desde a P5-F.1-R1 (B02), o tempo trabalhado é a união dos trechos trabalhados de todas as rotinas, num eixo contínuo de minutos, e o intervalo é uma duração de posição desconhecida dentro da própria janela. Uma janela sem intervalo trabalha inteira. Uma janela com intervalo que não cruza nenhuma outra (nem da véspera, nem do dia seguinte) trabalha a duração menos o intervalo. Uma janela com intervalo que cruza outra só tem resultado determinado se ficar inteira dentro de janelas sem intervalo; nesse caso não acrescenta nada. Fora disso, o dia fica ambíguo: o motor não calcula horas, a estimativa fica indisponível (`ambiguous_routines`), o editor de rotinas mostra o aviso e salvar é recusado. Salvar também é recusado quando a combinação fica ambígua por um feriado, uma exceção ou o primeiro dia de um mês (o conferidor do calendário inteiro, `calendarAmbiguity`), com o aviso junto do botão de salvar. Janelas idênticas contam uma vez. O trecho em comum com a véspera conta no dia da janela que começou antes (só quando a véspera seguiu a rotina). Com isso, acrescentar uma rotina válida nunca reduz as horas: a união só cresce, e um minuto só passa de um dia ao anterior. O exemplo do parecer (08:00–12:00 e 13:00–17:00, mais 09:00–11:00 com 1 h 30 min de intervalo) continua com 8 h, e não 6 h 30 min. Os da revisão 2 (00:00–10:00 sem intervalo e 22:00–10:00 com 10 h de intervalo) e o de 11:00–14:00 com intervalo, cruzando a pausa do almoço, são ambíguos e recusados. A prova está em `evidence/p5f1-r1/rotinas-matematica.md`; os testes de propriedade, em `tests/unit/work-time-calendar.test.ts`. A memória de cálculo mostra as horas de cada mês. Duração sem horário (`D480`) soma; duas rotinas sem horário no mesmo dia são sinalizadas.
2. **Feriado.** Feriado nacional da base ou feriado local cadastrado zera o dia de trabalho, salvo se o usuário trabalha em feriados ou marcou "feriado trabalhado" na data. Feriado em dia sem trabalho não reduz nada (sem desconto em dobro).
3. **Definição do dia.** Alteração de escala define os minutos da data (pode criar trabalho num dia de folga ou num feriado); jornada reduzida limita os minutos dos dias de trabalho do intervalo (nunca aumenta nem cria trabalho). A classificação do feriado na memória de cálculo segue os minutos finais do dia (depois de exceções e acréscimos): com trabalho no fim (rotina, alteração de escala, plantão ou hora extra), ele aparece como trabalhado, também num dia de folga; sem trabalho, aparece entre os que tiraram dias de trabalho só quando foi o próprio feriado que zerou a rotina, e como feriado em dia sem trabalho nos demais casos (folga da rotina, férias, folga, ausência ou escala zerada). A marca "feriado trabalhado" só conta entre as exceções do mês quando o dia terminou com trabalho.
4. **Ausências.** Férias, folga e ausência zeram o dia (sem motivo nem dado de saúde).
5. **Acréscimos.** Plantão e hora extra somam minutos, inclusive em dia de folga.
6. **Teto.** O dia civil (das 00:00 às 24:00) não tem mais de 24 h de trabalho, salvo o dia seguinte a uma jornada reduzida cuja janela passa da meia-noite (caso aberto da P5-F.1-R1, `evidence/p5f1-r1/rotinas-matematica.md` §6). Os minutos sem horário e os acréscimos só ocupam o tempo livre dele. O trecho de um turno depois da meia-noite conta no dia em que o turno começou, além do dia civil. Com jornada reduzida, os minutos que contam cabem primeiro nesse trecho (P5-F.1-R1 e revisão independente, `evidence/p5f1-r1/rotinas-matematica.md` §3). O excesso é limitado e sinalizado.

Exceções de tipos diferentes podem coincidir (férias e folga no mesmo dia descontam uma vez); do mesmo tipo, não podem se sobrepor.

## Exemplos (rotina de segunda a sexta, 08:00–17:00 com 1 h de intervalo = 8 h)

| Mês | Dias úteis | Feriados nacionais em dia útil | Horas previstas |
| --- | --- | --- | --- |
| fevereiro/2026 | 20 | — | 20 × 8 = **160 h** |
| novembro/2026 | 21 | 02/11 (segunda), 20/11 (sexta); 15/11 é domingo | 19 × 8 = **152 h** |
| janeiro/2026 | 22 | 01/01 (quinta) | 21 × 8 = 168 h |
| fevereiro/2024 (bissexto) | 21 | — | 168 h |
| julho/2026, com férias de 06 a 17/07, 2 h extras em 20/07, jornada reduzida a 6 h de 21 a 31/07 e 5 h num sábado | 23 | — | 184 − 80 + 2 − 18 + 5 = **93 h** |

Nunca uma carga fixa de 220 h. Escala 12×36 (07:00–19:00 com 1 h, referência 01/01/2026) em janeiro/2026: 16 dias × 11 h = 176 h. Noturno 22:00–06:00 sem intervalo (segunda a sexta) com manhã 05:00–09:00 (segunda a sábado) em março/2026: 22 × 8 h + 26 × 4 h − 21 h de sobreposição = 15.540 min. Com 1 h de intervalo no noturno (o exemplo anterior, que dava 14.220 min), o noturno cruza a manhã e não fica inteiro dentro dela: os 26 dias ficam sem cálculo seguro, e a configuração é recusada (P5-F.1-R1, `evidence/p5f1-r1/sondas/exemplo-noturno.mts.txt`).

## Fontes de feriados

Automáticos são só os nacionais declarados em lei federal, com a lei e o primeiro ano de vigência na base (`NATIONAL_HOLIDAY_RULES`):

| Data | Feriado | Lei | Na base desde |
| --- | --- | --- | --- |
| 01/01 | Confraternização Universal | Lei nº 662/1949, art. 1º, redação da Lei nº 10.607/2002 | 2003 |
| 21/04 | Tiradentes | idem | 2003 |
| 01/05 | Dia do Trabalho | idem | 2003 |
| 07/09 | Independência do Brasil | idem | 2003 |
| 12/10 | Nossa Senhora Aparecida | Lei nº 6.802/1980 | 2003 (início da base) |
| 02/11 | Finados | Lei nº 662/1949, redação da Lei nº 10.607/2002 | 2003 |
| 15/11 | Proclamação da República | idem | 2003 |
| 20/11 | Dia Nacional de Zumbi e da Consciência Negra | Lei nº 14.759/2023 (D.O.U. de 22/12/2023) | 2024 |
| 25/12 | Natal | Lei nº 662/1949, redação da Lei nº 10.607/2002 | 2003 |

**Conferência:** em 2026-11-04, por busca nos textos oficiais reproduzidos (Senado, Câmara, LegJur, Guia Trabalhista). O acesso direto a `www.planalto.gov.br` e `www2.camara.leg.br` está fora da rede permitida desta sessão (ENOTFOUND). Antes de 2003, nada é automático, e o mês aparece sinalizado na memória de cálculo.

**Nunca automáticos:**
- Sexta-feira da Paixão: feriado religioso declarado em lei municipal (Lei nº 9.093/1995, art. 2º).
- Carnaval, Quarta-feira de Cinzas e Corpus Christi: pontos facultativos federais.
- Feriados estaduais e municipais: sem fonte oficial verificável integrada. A tela mostra a limitação de cobertura e oferece inclusão manual ("Feriados locais", data única ou anual), com atalhos que calculam a data de Carnaval, Sexta-feira da Paixão e Corpus Christi pela Páscoa (algoritmo gregoriano anônimo; testado de 2000 a 2038). Esses atalhos só incluem a data quando o usuário clica.
- Dias de eleição (1º turno no primeiro domingo de outubro dos anos pares e, onde houver, 2º turno no último; Constituição Federal, arts. 28, 29, II, e 77): não estão na base, porque o 2º turno depende de cada eleição e a natureza do dia não foi conferida numa fonte oficial nesta sessão. A tela informa a limitação e oferece atalhos que calculam as duas datas; só entram quando o usuário clica. A Lei nº 4.737/1965 (Código Eleitoral), art. 380, citada na revisão independente, fica registrada para validação jurídica. Em 2020, a Emenda Constitucional nº 107/2020 adiou as eleições municipais para 15 e 29 de novembro: o atalho não calcula datas para 2020 e explica o adiamento, para que a pessoa inclua essas datas como data única (`ELECTIONS_POSTPONED_YEARS`).

Base versionada, determinística e sem dependência de rede: os testes não usam internet.
