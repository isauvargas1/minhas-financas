# P5-F.1-R2A — matriz antes × depois (S01 e S03)

**As colunas.**
- **Antes:** a árvore da R1 (`08d8c5a2`).
- **Depois:** a árvore da R2A. O hash está no relatório.
- **Valores:** em minutos.
- **"Recusa":** o conferidor do calendário inteiro (`calendarAmbiguity`, a partir de 01/10/2026) a devolve, e salvar é recusado.

**Como reproduzir.** Os números saem da sonda `sondas/antes-depois-s01.mts.txt`, rodada na árvore da R1 e na árvore final do código `63e4c3c6` (`saidas/antes-depois-s01-r1.log.txt` e `saidas/antes-depois-s01-r2a-final.log.txt`).

## Estado dos achados

| Achado | Antes (R1) | Depois (R2A) | Evidência |
| --- | --- | --- | --- |
| B02, caso S01 (véspera em jornada reduzida) | **aberto**: 960 min aceitos para um trecho de 720 | **resolvido**: o dia seguinte fica sem cálculo seguro, e a configuração é recusada com mensagem em pt-BR. Teorema 3: o que é aceito não depende de onde caíram as horas, em nenhuma vista do dia, também quando a jornada reduzida abre o período (T01 da revisão independente, corrigido) | `s01-vespera-reduzida.md`; testes "P5-F.1-R2A"; E2E `S01 (P5-F.1-R2A)`; mutantes S01 |
| B02, segunda consequência (24 h de plantão sobre o turno reduzido: 28 h num dia civil) | aceita | recusada; o corolário do Teorema 3 limita o dia civil a 24 h | idem |
| S03 (comportamento do Q02 sem teste) | 2 mutantes sobreviviam | testes de unidade e E2E; os 2 mutantes morrem | `s03-edicao-rotinas.md`; `mutantes.md` |
| B03 (consistência entre escritas e projeções) | aberto em (a), (b) e (c) | **aberto, sem mudança**: só o desenho (Frente B) | `PROPOSTA-ARQUITETURAL-B03.md` |

## S01 — casos

| Caso | Antes (R1) | Depois (R2A) | Leitura |
| --- | --- | --- | --- |
| Segunda 20:00–06:00 reduzida a 8 h; terça 00:00–08:00 (o caso do parecer) | 480 + 480 = 960, aceita | segunda 480; terça **sem cálculo seguro**; recusa `reduced_eve` em 06/10 | corrigido: 960 não cabe nos 720 do trecho; conforme onde caíram as 8 h, a terça teria de 120 a 240 |
| O mesmo com o limite de 10 h (não corta nada) | 600 + 480 = 1.080, aceita | 600 + **120** = 720, aceita | corrigido: a redução que não corta nada é a rotina |
| Segunda 20:00–06:00 reduzida a 8 h; terça com 24 h de plantão | 480 + 1.440, aceita (28 h num dia civil) | terça **sem cálculo seguro**; recusa | corrigido: de 18 h a 24 h, conforme a segunda |
| O mesmo com 4 h de plantão | 480 + 240, aceita | 480 + 240, aceita | igual: 240 nos dois extremos |
| Noturno 22:00–06:00 de segunda a sexta; quarta reduzida a 6 h | 360 + 480, aceita | 360 + 480, aceita | igual |
| Outubro de 2026 inteiro reduzido a 6 h no noturno | 7.920 (22 × 360), aceita | 7.920, aceita | igual |
| 24 × 48 (07:00–07:00) reduzida a 12 h; 4 h de hora extra no dia seguinte | 720 + 240, aceita | 720 + 240, aceita | igual |
| Segunda 22:00–08:00 cobre terça 05:00–09:00 com 30 min (mais terça 08:00–12:00); segunda reduzida a 5 h | terça sem cálculo seguro; causa "vizinho" (reduzida) | terça sem cálculo seguro; causa `reduced_eve` | mesma recusa, causa mais precisa (a cobertura depende da parte da segunda que aconteceu) |
| Domingo 22:00–06:00; segunda 05/10 01:00–01:00 reduzida a 20 h; terça 00:00–02:00 | 1.140 + 120, aceita | 1.140 + **60**, aceita | corrigido: a redução não corta nada (1.140 <= 1.200), e a terça desconta o trecho de 00:00 a 01:00, como com a segunda seguindo a rotina. A segunda 05/10 nunca abre o período |
| O mesmo com a segunda em 01/06/2026, um dia 1 | 1.140 + 120, aceita | terça sem cálculo seguro; **recusa** | corrigido (T01 e T13): abrindo o período em junho, a segunda conta 24 h, e a terça vale de 60 a 120 (`s01-vespera-reduzida.md` §5, fonte 4). Com o limite de 24 h, aceita com 60 |
| Abrindo o período em outubro: quarta 20:00–10:00, quinta 06:00–20:00 reduzida a 850, sexta 00:00–04:00, férias de 03 a 31/10 (C, da revisão independente) | 840 + 240 = 1.080, aceita | 840 + 240 = 1.080, aceita | igual |
| C mais quinta 22:00–02:00 (C′) | 850 + 240 = 1.090, aceita (a sexta pode valer 120) | sexta sem cálculo seguro; **recusa** | corrigido (T01). Antes da correção, a R2A dava 850 + 120 = 970, menos que C |
| Abrindo o período: quarta 20:00–10:00, quinta 06:00–02:00 reduzida a 1.000, sexta 00:00–04:00 | 1.000 + 240, aceita (a sexta vale de 120 a 240) | sexta sem cálculo seguro; **recusa** | corrigido (T01). Antes da correção, a R2A aceitava 1.000 + 120 |
| Segunda 20:00–06:00 + 2 h sem horário, reduzida a 650 min; terça 00:00–08:00 | 650 + 480, aceita | segunda 650; terça sem cálculo seguro; recusa | corrigido: não se sabe se o corte caiu no turno ou nas 2 h |

## S03 — comportamentos

| Comportamento | Antes (R1) | Depois (R2A) |
| --- | --- | --- |
| Configuração gravada recusada ao montar: fora de edição | testado (E2E do Q02) | testado (E2E e unidade) |
| Jornada para aplicar mudada sem aplicar: fora de edição | sem teste; `mut-tpl` sobrevivia | testado (E2E e unidade); `mut-tpl` morre |
| Aplicar a jornada: em edição, só nos dias marcados | E2E (sem conferir os dias) | E2E e unidade (sábado e domingo continuam sem trabalho) |
| Digitação inválida: em edição, com a mensagem na rotina | sem teste; `mut-tplfail` sobrevivia | testado (E2E: "Rotina 3, segunda-feira: Use horários no formato 08:00."; unidade: três tipos de erro); `mut-tplfail` morre |
| "Descartar" volta a jornada a 14:00 | sem teste | testado (E2E e unidade) |

## O que não mudou (tela)

- **Estados que não mudam.** Configuração válida, prévia com valor, editor de rotinas, calendário de exceções e Dashboard. São os mesmos componentes, sem mudança de layout ou de estilo.
- **Comparação pixel a pixel** (`visual/comparacao-antes-depois.json`). As duas árvores, a da R1 e a da R2A, foram capturadas no mesmo estado e na mesma viewport. Foram 1440 × 900 e 390 × 844, claro e escuro, sem tolerância.
  - **Referência** (as mesmas rotinas, sem a jornada reduzida): **0 pixel diferente** nas 4 combinações, na página inteira e no cartão da prévia.
  - **S01** (a jornada reduzida gravada): no desktop, os pixels diferentes ficam todos numa caixa de 328 × 643 na coluna da prévia. No celular, a página cresce 112 px: as linhas são idênticas até y = 5.290 e nas últimas 238. A faixa que muda tem só duas coisas:
    - o cartão da prévia: na R1, "R$ 115,00" calculado sobre os 960 min impossíveis; na R2A, "Estimativa indisponível" com o motivo;
    - a recusa junto do botão de salvar.
  - O resto da caixa do desktop é deslocamento: os botões abaixo da recusa ("Salvar alterações", "Refazer assistente", "Excluir meus dados") descem, com o mesmo estilo.
  - As duas mudanças são as do S01. Os recortes estão em `visual/recortes/`.
- **Texto que mudou** (só nos estados novos):
  - a mensagem da recusa junto do botão de salvar;
  - o motivo da estimativa indisponível;
  - o nome acessível do dia sem cálculo seguro no calendário de exceções ("jornada reduzida na véspera", texto oculto de leitor de tela).
