# P5-F.1-R2A — testes e resultados

Horários em UTC, de 2026-11-06. Execuções no worktree isolado (`feat/p5-f1-r2a-2026-11-06`). O Firebase rodou só no Emulator (`minhas-financas-local`), com Java 21 (`openjdk 21.0.12.1`). As saídas estão em `saidas/`.

## Testes novos e reescritos

| Arquivo | Teste | O que prova |
| --- | --- | --- |
| `tests/unit/work-time-calendar.test.ts` | S01: segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00 (o caso do parecer) | a terça fica sem cálculo seguro, `reducedEve`, `reducedEveDays`, causa `reduced_eve` com as rotinas do turno. Duas partes possíveis dão 240 e 120. Alteração de escala, limite de 10 h e limite de 12 h com 2 h sem horário são aceitos |
| idem | S01: o dia civil seguinte não recebe 24 h de plantão por cima do turno (**contrato anterior, RR-R1-03, substituído**) | o teste que fixava "o dia seguinte não desconta o trecho" agora fixa a recusa, com o motivo no comentário; a véspera seguindo a rotina, a redução que não corta e o plantão de 4 h continuam aceitos |
| idem | S01: casos comuns continuam aceitos | noturno com quarta reduzida, hora extra, o mês inteiro reduzido, 24 × 48, horário de escritório |
| idem | S01: dois extremos seguros e o plano da véspera sem nada | a ambiguidade do extremo "turno inteiro" recusa, mesmo com o mesmo número; o plano do dia aceito é o de (i) (D-R2A-02) |
| idem | S01: a cobertura que vem da véspera reduzida aponta a véspera | causa `reduced_eve`; com folga na segunda, `neighbor` |
| idem | S01, Teorema 2: a redução que passa a cortar ao acrescentar rotina | o período não perde horas |
| idem | **R2A-01** (revisão independente, T01): a jornada reduzida no dia que abre o período | os dois contraexemplos da revisão: C aceita com 1.080; C′ (C mais quinta 22:00–02:00) e a quinta de 20 h reduzida a 1.000 recusadas, com `reduced_eve` em 02/10 |
| idem (no teste do parecer) | **T13**: o desconto da véspera fora do dia 1 | o caso domingo/segunda de 24 h: a segunda 05/10 aceita com 60; a mesma segunda em 01/06/2026 recusada (`reduced_eve` em 02/06, `reducedEveDays` no mês abrindo o período); com o limite de 24 h, aceita com 60. Reprova contra a regra estrita (`63e4c3c6`) e contra a anterior (`cf9cb2a9`) |
| idem | **Propriedade R2A-01:** o dia que abre o período | 1.500 amostras dirigidas (sexta fora do período entrando no sábado reduzido; limite perto da faixa da sexta). Em cada configuração aceita, o domingo é igual ao extremo com o sábado inteiro e, quando o limite corta o sábado abrindo o período, ao extremo sem nada dele; acrescentar uma rotina nunca tira horas. Contra o motor anterior (`cf9cb2a9`), falha na amostra 3 |
| idem | **Propriedade:** o oráculo das partes | para cada dia aceito depois de uma véspera reduzida, a especificação executável do §3 (aritmética de trechos e teto, independente do código do motor) dá o mesmo número para nenhuma parte, o turno inteiro, as partes mais tarde e mais cedo de tamanho `R` e 4 partes aleatórias. O dia civil fica <= 24 h. O motor recusa exatamente quando os extremos diferem. Sem minutos sem horário, duas partes possíveis do tamanho da redução dão terças diferentes |
| idem | **Propriedade:** monotonia com jornadas reduzidas em turnos que passam da meia-noite | 2.500 amostras na janela agosto a outubro de 2026, com o primeiro mês abrindo o período |
| idem | **Propriedade:** o conferidor sem intervalo nenhum | aceitas sem dia ambíguo (nov/2025 a fev/2027, mês avulso e abrindo o período); recusadas apontam um dia `reducedEve` cuja véspera tem jornada reduzida |
| idem | a memória do conferidor vale só durante a chamada e não muda resultado | o mesmo objeto, com as exceções mudadas entre chamadas, é conferido do zero |
| idem | a memória do conferidor é de um calendário só (revisão independente, T07) | outro calendário lido no meio da chamada, por um getter das exceções, dá a terça de sempre (120), e a conferência de fora dá a recusa certa; mata os mutantes que tiram a conferência do objeto |
| `tests/unit/work-time-preference.test.ts` | S01: `validateDraft` | seção das exceções, `ambiguity: 'reduced_eve'` e mensagem exata em pt-BR ("não dá para confirmar…", revisão T03); duas rotinas no turno; alteração de escala e limite de 10 h aceitos; no assistente, o passo das exceções |
| idem | S03: recusa ao montar e jornada para aplicar | contratos 1, 2, 3 e 5 de `s03-edicao-rotinas.md` |
| idem | S03: digitação inválida | contrato 4, com três mensagens exatas |
| `tests/unit/work-time-estimate.test.ts` | S01: estimativa | `ambiguous_reduced_eve`, sem nenhuma hora na memória; com um dia ambíguo pelo intervalo, `ambiguous_routines`; com o limite de 10 h, pronta |
| `tests/unit/work-time-guard.test.ts` | fiação do S03 | a tela usa `routinesKey`, `editorResultOf` e `applyTemplate` do módulo puro, sem cópia local; `edited` e as duas recusas ficam no módulo |
| `e2e/work-time-p5f.spec.ts` | `B02 (P5-F.1-R1)`, passos novos do S03 | jornada mudada sem aplicar: fora de edição. Aplicar e descartar: 14:00. Digitação inválida: em edição, com a mensagem |
| idem | `S01 (P5-F.1-R2A)` (novo) | configuração gravada: estimativa indisponível com o motivo, aviso exato junto do botão de salvar, axe 0, fora de edição, a terça com "?" e o nome acessível no calendário. Tirar a redução volta a estimativa e salva. Incluir 8 h de novo é recusado sem gravar; 10 h é aceito |

Nenhum teste anterior foi removido, pulado ou relaxado, e não há `skip`, `only` nem timeout aumentado. O único reescrito é o do RR-R1-03 (acima). Dentro da própria R2A, o caso domingo/segunda de 24 h passou por "recusado" na primeira correção (R2A-01, regra estrita) e voltou a "aceito com 60" na variante do T13, agora com o mesmo caso num dia 1 recusado; as asserções das mensagens acompanham o texto novo (T03 e T08). A guarda do Q02 passou a conferir a fiação no módulo novo (mesmas asserções, mais as do botão e da ausência de cópia local).

## Contagens das propriedades

Na sonda `sondas/contagens-oraculo.mts.txt`, com a mesma geração do teste (`saidas/contagens-oraculo.log.txt`):

| Medida | Valor |
| --- | --- |
| Amostras | 4.000 |
| Aceitas (conferidas com o oráculo em 8 partes cada) | 1.031 |
| Recusadas pela véspera reduzida | 1.525 |
| Recusadas sem minutos sem horário, com partes diferentes provadas | 462 |
| Reduções que não cortam (o dia seguinte é o da rotina) | 1.444 |
| Recusas conservadoras (as duas partes de tamanho `R` dariam o mesmo número) | **159 de 1.525 (10,4%)** |

**O que o gerador do teste explora.** É adversarial:
- turnos de até 24 h que começam entre 17:00 e 23:45;
- em 25% das amostras, minutos sem horário de até 24 h no dia seguinte;
- acréscimos e exceções em 55%.

**As 159 recusas conservadoras, por tipo:**

| Turno inteiro da véspera | Sem horário mais acréscimos no dia seguinte | Recusas |
| --- | --- | --- |
| cruza janela do dia seguinte | acima de 12 h | 26 |
| cruza janela do dia seguinte | até 12 h | 26 |
| não cruza | acima de 12 h | 72 |
| não cruza | até 12 h | 35 |

Em todas, o turno inteiro ocuparia do dia seguinte mais do que a redução permite, e as horas do dia seguinte só mudam acima dessa ocupação. Nos casos comuns dos testes dirigidos (noturno até 08:00, escala 24 × 48, horário de escritório), não há recusa.

**As outras fontes de recusa conservadora** (revisão independente, T03; `s01-vespera-reduzida.md` §5):
- a revisão mediu 11.896 de 134.889 pares (8,8%) no gerador adversarial dela, na árvore `cf9cb2a9`;
- num gerador genérico de 3.000 configurações, a regra final recusa exatamente as mesmas 572 da regra sem a R2A-01. A regra estrita da primeira correção recusava 578 (`sondas/custo-conservador-r2a01.mts.txt`; `saidas/custo-conservador-r2a01.log.txt` e `saidas/custo-conservador-r2a01-estrita.log.txt`).

No gerador do oráculo, a véspera da segunda é folga, e as contagens ficaram iguais depois da R2A-01 (`saidas/contagens-oraculo-final.log.txt`).

## Custo do conferidor

`sondas/custo-vespera-reduzida.mts.txt`, 5 rodadas cada, nas quatro árvores (`saidas/custo-vespera-reduzida-*.log.txt`):

Cinco conferências seguidas de `calendarAmbiguity(…, '2026-11-05')` por caso, em ms, mais uma `validateDraft`. Quatro árvores:
- a R1 (`08d8c5a2`);
- a R2A antes da memória por chamada (`5a7dad57`);
- a R2A com a memória (`cf9cb2a9`);
- a final (`63e4c3c6`), com a correção R2A-01.

| Caso | R1 | R2A sem memória | R2A com memória | Final |
| --- | --- | --- | --- | --- |
| Comum (rotina semanal padrão) | 0–1 | 0–2 | 0–1 | 0–2 |
| Noturno todo dia, sem exceções | 0 | 0 | 0 | 0 |
| Noturno todo dia, 120 jornadas reduzidas de 366 dias (6 h) | 0 | 916–1.202 | 346–415 | **343–414** |
| Noturno + madrugada todo dia, 120 jornadas reduzidas de 366 dias, 40 feriados | 0 | 941–1.029 | 404–451 | **372–436** |
| Pior caso da R1 (3 rotinas cobertas + cíclica 27 × 26, 120 exceções, 40 feriados) | 219–285 | 275–372 | 237–334 | 246–305 |

**Os piores casos da revisão independente (T05)**, com a sonda `custo-pior-caso` do revisor e 3 conferências por caso, em ms:

| Caso | R1 | `5a7dad57` | `cf9cb2a9` | Final |
| --- | --- | --- | --- | --- |
| 3 noturnos e 120 reduções de 366 dias | 0 | 1.082–1.157 | 520–634 | 492–553 |
| Janela coberta, 120 × 366 reduções e 40 feriados, sem trabalho em feriado | 430–510 | 2.055–2.121 | 1.204–1.232 | 915–1.097 |
| O mesmo, trabalhando em feriado | 433–471 | 2.234–2.422 | 1.080–1.821 | 1.082–1.173 |
| Cíclica 27 × 26 de 24 h, janela coberta e 120 × 366 reduções | 475–533 | 2.092–2.206 | 1.046–1.366 | 1.058–1.199 |

**Como ler:**
- **Os 0 ms da R1 nos casos de jornada reduzida são o próprio S01.** Sem janela com intervalo coberta, o conferidor da R1 saía pelo atalho e não olhava o dia seguinte. A passada nova faz esse trabalho, que antes não existia.
- **O pior caso medido** é de 0,5 a 1,2 s por conferência. São configurações no limite da gramática: 120 jornadas reduzidas de 366 dias até 2099, que se sobrepõem, com janela coberta e 40 feriados. Fica 2 a 2,5 vezes acima do pior caso da R1 e registrado no RR-R2A-02. A conferência roda a cada mudança do rascunho (`WorkTimeSettingsView.tsx:266`).
- **Os casos comuns continuam em 0 a 2 ms.** Com 120 reduções de 3 dias em três noturnos, ficam em 7 a 10 ms.
- **Mesmo resultado.** No caso "noturno + madrugada", a recusa aponta 06/09/2098 em todas as árvores da R2A:
  - as faixas reduzidas se sobrepõem até 05/09/2098;
  - dentro delas, o dia seguinte também é reduzido a 6 h, abaixo dos dois extremos, e tem cálculo seguro;
  - o primeiro dia sem cálculo seguro é o que vem depois do bloco.
- **Igualdade com e sem a memória.** A sonda antes × depois do S01 dá saídas idênticas com e sem a memória (`saidas/antes-depois-s01-r2a.log.txt` e `saidas/antes-depois-s01-r2a-memo.log.txt`). A revisão confirmou em 6.000 chamadas (T07).

**Saídas:**
- `saidas/custo-vespera-reduzida-r1.log.txt`, `-r2a.log.txt` (sem memória), `-r2a-memo.log.txt` e `-r2a-final.log.txt`;
- `saidas/custo-pior-caso-revisor-final.log.txt`;
- os da revisão, em `revisoes/`.

## Execuções

### Finais (árvore do código `cd95e1cb`)

**As árvores.**
- **Código final:** `cd95e1cb`. A árvore entregue acrescenta só documentos (`docs/`), o que o roteiro do pacote confere.
- **`63e4c3c6`:** a árvore da primeira correção da revisão. Difere da final só em `calendar.ts` (o desconto da véspera fora do dia 1, T13) e no teste de unidade do calendário. O E2E, a interface, as mensagens e as âncoras dos mutantes E2E são os mesmos.
- **Onde rodou o quê.** O E2E dirigido, os mutantes E2E e as capturas rodaram em `63e4c3c6`. O E2E inteiro roda de novo no `verify:all` da árvore final.

| Execução | Árvore | Resultado | Saída |
| --- | --- | --- | --- |
| `npx tsc --noEmit -p .` | `cd95e1cb` | 0 erro | (saída vazia) |
| `npm run test:unit:work-time` | `cd95e1cb` | **174/174**, 0 skip, 0 todo | `saidas/unit-wt-9.log.txt` |
| O mesmo na árvore da R1 (cópia exata) | `08d8c5a2` | 158/158 | `saidas/unit-wt-r1-arvore-08d8c5a2.log.txt` |
| Os testes do T13 e da R2A-01 contra os motores anteriores | `63e4c3c6` e `cf9cb2a9` | reprovam (1 de 3 e 3 de 3), como devem | `saidas/unit-t13-contra-*.log.txt` |
| Mutantes de unidade da R2A, numa cópia exata | `cd95e1cb` | **38/38** mortos | `saidas/mutantes-r2a-final.log.txt` |
| Mutantes de unidade da R1, refeitos (idem) | `cd95e1cb` | **77/77** mortos | `saidas/mutantes-r1-na-r2a-final.log.txt` |
| E2E `e2e/work-time-p5f.spec.ts` (Emulator) | `63e4c3c6` | **19/19** | `saidas/e2e-final-1.log.txt` |
| Mutantes E2E da R2A, cada um com build novo, no worktree | `63e4c3c6` | **6/6** mortos; SHA-256 dos 408 arquivos e `git status` iguais | `saidas/e2e-mutantes-final.log.txt` e `saidas/e2e-mutante-*.resultado.txt` |
| Capturas da R2A (S01, 20 capturas) | `63e4c3c6` | 8/8; axe 0, transbordamento 0, aviso não coberto | `saidas/visual-r2a-capturas.log.txt`, `visual/` |
| Antes × depois (R1 e R2A, mesmo roteiro) | `08d8c5a2` e `63e4c3c6` | 8/8 e 8/8; 0 pixel diferente nas referências | `visual/comparacao-antes-depois.json` |
| `npm run verify:all` (Emulator, Java 21) | `cd95e1cb` | com saída 0 na 3ª execução (2.466 s): 3.153 testes (`verify:fast` 1.687/1.687, integração e Rules 1.256/1.256, Playwright 210/210), 0 falha, 0 skip e 0 todo; lint com 0 erro e os mesmos 201 avisos da R1. A 2ª execução teve 1 falha intermitente de E2E fora do delta (RR-R2A-04) | `saidas/verify-all-final.resumo.json.txt`; log completo no pacote |

**Rodadas anteriores, na ordem** (mantidas como histórico, em `saidas/`):
- na árvore `cf9cb2a9`, antes da revisão: mutantes 35/35 (`mutantes-r2a-3`) e 77/77 (`mutantes-r1-na-r2a-2`), capturas e antes × depois;
- na árvore `63e4c3c6`, depois da primeira correção: mutantes de unidade 37/37 e 77/77, E2E 19/19, mutantes E2E 6/6, capturas e antes × depois. Dessa rodada ficaram o log completo da lista da R1 e o resumo das duas listas (`saidas/mutantes-arvore-63e4c3c6/`); o log da lista da R2A foi substituído pelo da final, que usa o mesmo nome;
- o `verify:all` nessa árvore foi **interrompido de propósito** às 15:22 UTC, na integração, para corrigir o T01 da revisão (`verify-all-1-interrompido.*`). As 84 falhas registradas nele são dos testes cortados pela interrupção, e nada dessa execução conta como resultado;
- o `verify:all` teve três execuções:
  - a 1ª, em `cf9cb2a9`, foi interrompida, acima;
  - a 2ª, na árvore final (`saidas/verify-all-2-falha-e2e.*`), deu 1.687/1.687 no `verify:fast`, 1.256/1.256 na integração e 209/210 no E2E. A falha foi `cash-pending-entries.spec.ts:169`, fora do delta (RR-R2A-04 no relatório): passou em 8 execuções isoladas, 5 sem carga e 3 com carga (`saidas/diag-cash-pendente-*`);
  - a 3ª, na árvore final e com a máquina livre, é a da tabela acima;
- a 1ª rodada das capturas na árvore final falhou em 4 dos 8 testes. A causa foi o roteiro temporário de evidência, que ainda esperava o texto antigo do motivo ("a véspera tem jornada reduzida"). Corrigido o roteiro, a 2ª rodada deu 8/8 (`saidas/visual-r2a-capturas-1-texto-antigo.log.txt`).

**A contagem de testes de unidade (158 → 174).**
- O teste que fixava o RR-R1-03 foi substituído pelo da recusa, com o mesmo propósito e o contrato novo.
- Entraram 16 testes novos:
  - 6 dirigidos do S01 no motor (o caso do parecer, os casos comuns, os dois extremos, a cobertura pela véspera, o Teorema 2 e o dia que abre o período, R2A-01);
  - 4 propriedades (o oráculo, a monotonia, o conferidor e o dia que abre o período);
  - os 2 da memória por chamada;
  - o da estimativa;
  - o de `validateDraft`;
  - os 2 do S03.
- No E2E, `work-time-p5f.spec.ts` passou de 18 para 19 testes: o `S01 (P5-F.1-R2A)` é novo, e o `B02 (P5-F.1-R1)` ganhou os passos do S03.
- Nenhum teste foi removido ou pulado.

### Durante a implementação (histórico, na ordem)

Cada falha abaixo foi do teste novo ou do texto, e foi corrigida na causa. Nenhuma asserção foi afrouxada.

| Execução | Resultado | Causa e correção |
| --- | --- | --- |
| `unit-wt-1`: a suíte da R1 sobre o motor novo | 158/158 | O teste do RR-R1-03 passava sem conferir `ambiguous`. Foi reescrito para o contrato novo (a recusa) |
| `unit-r2a-1`: testes dirigidos | 4/5 | A cobertura pela véspera reduzida: com `today` em 06/11/2026, o conferidor devolvia antes o início do período (01/12/2026). O teste passou a usar 01/10/2026, para que o dia esperado seja o primeiro |
| `unit-r2a-3`: propriedades | 6/8 | As contagens mínimas não eram atingidas: 771 aceitas de 800 e 12 recusadas de 40. As amostras subiram para 4.000, e entrou o gerador `nightOrEarly`. Os limites mínimos não mudaram |
| `unit-s03-1`: preferência | 4/5 | Faltava a vírgula depois da data em aposição ("06/10/2026, dependem"). A mensagem foi corrigida em `draft.ts` |
| `e2e-r2a-1`: o E2E novo do S01 | 1/2 | O seletor "Mês anterior" casava dois botões (modo estrito). Foi limitado ao mês das exceções |
| `e2e-r2a-2` | 1/1 | — |
| `unit-wt-2` a `unit-wt-5` | 165, 169, 169 e 171, todos passando | — |
