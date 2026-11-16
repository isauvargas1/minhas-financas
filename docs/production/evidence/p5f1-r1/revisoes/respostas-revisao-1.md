# P5-F.1-R1 — respostas à revisão independente 1 (2026-11-05)

A revisão (`revisao-1.md`) leu a árvore `b97806c4` e terminou em **FAIL**:
- B01 corrigido;
- B02 reaberto (N01);
- B03 não corrigido por inteiro (N03 a N06).

Cada achado abaixo foi corrigido, com teste que reprova na árvore revisada e passa na corrigida. O "antes" é a mesma bateria rodada sobre uma cópia exata de `b97806c4` (`git archive`), só com os testes novos e sem o que depende de funções que só existem depois da correção. Os logs são:
- `antes-revisao-calendario.log`;
- `antes-revisao-preferencia.log`;
- `antes-revisao-pares.log`;
- `antes-revisao-ganchos.log`.

## N01 — HIGH — jornada reduzida com plantão: acrescentar uma rotina tirava horas (reabria B02)

| Item | Conteúdo |
| --- | --- |
| Causa | Duas regras do teto, em `planDay`, para o dia de jornada reduzida:<br>• as janelas do próprio dia não ocupavam o dia civil (`followsRoutine` falso);<br>• `windowPart` zerava quando a redução mordia.<br>Com a rotina abaixo do limite, o teto era `w + 1.440`; acima, `1.440`. Era uma descontinuidade. |
| Correção | `calendar.ts`, `planDay`. Quando a rotina acontece (também em dia reduzido), o teto é `min(minutos da rotina que contam, minutos das janelas do dia depois da meia-noite) + (1.440 − o que o trecho depois da meia-noite das janelas da véspera ocupa no dia civil)`.<br>Num dia que segue a rotina, é o mesmo teto de antes (`w + 1.440 − ocupação`): nada muda fora da jornada reduzida.<br>Prova da monotonia com o teto novo: `rotinas-matematica.md` §3 e §4. |
| Testes | `work-time-calendar.test.ts`:<br>• N01 dirigido, o cenário da revisão. Antes: 1.980 → 1.440 min. Agora: 1.440 → 1.440.<br>• Propriedade dirigida: a rotina acrescentada num só dia da semana, as outras ocorrências em férias e, nas que sobram, jornada reduzida com plantão e hora extra até 24 h. Em 1.500 amostras, a árvore revisada reprova na amostra 14 (25.860 → 25.800); a corrigida tem 0 violações, com mais de 1.000 pares e mais de 300 dias reduzidos no teto. |
| Buscas da revisão, de novo | Na árvore corrigida (`d7dabb10`; `sondas/`, logs `sonda-final-*`), 0 violações:<br>• `b02-cobertura.mts`, 2 × 80.000 amostras (sementes 99 e 4242);<br>• `b02-busca.mts`, 60.000 amostras (semente 7).<br>A cópia da busca conta também o que a gravação de agora aceita: 9.662 configurações, nenhuma com dia ambíguo na janela. O conferidor antigo, só das rotinas, aceitava 287 com dia ambíguo. |

## N02 — MEDIUM — o dia civil passava de 24 h num dia de jornada reduzida

| Item | Conteúdo |
| --- | --- |
| Causa | A mesma de N01. |
| Correção | A mesma de N01. Num dia de jornada reduzida, o dia civil volta a não passar de 24 h de trabalho entre 0h e 24h.<br>A exceção é anterior à R1: o dia seguinte a uma jornada reduzida cuja janela passa da meia-noite não desconta o trecho dela. Descontar quebraria o Teorema 2 (`rotinas-matematica.md` §6).<br>A nota `capped_days` não afirma mais que nenhum dia passa de 24 h: diz que as horas sem horário foram limitadas ao tempo livre do dia. |
| Testes | N02 dirigido:<br>• 08:00–17:00 reduzida a 10 h com 1.000 min de hora extra: 1.440 min, com teto. Antes, 1.540 sem teto.<br>• O turno 20:00–06:00 reduzido a 8 h, com 24 h de plantão: 1.800 min (6 h depois da meia-noite e 24 h no dia civil).<br>Propriedade "sem janela que passe da meia-noite, nenhum dia passa de 24 h": 1.500 amostras, mais de 100 mil dias. A árvore revisada reprova com 2.040 min num dia. |

## N03 — MEDIUM — edição de uma desconsiderada antes da primeira leitura mostrava estado misto como provado

| Item | Conteúdo |
| --- | --- |
| Correção | `consistency.ts` (`inherentWritesOf`, regra 5, `unappliedWrites`) e `useIncomeEstimateWith.ts`.<br>A última gravação (`updatedAt`) de cada desconsiderada com mês é escrita pendente com espera limitada (`bounded`): segura a prova até a projeção do mês passar dela.<br>Uma edição sem efeito na renda (a descrição, por exemplo) o gatilho não grava. Por isso a espera termina em `ESTIMATE_PENDING_WAIT_MS` (30 s, no relógio injetável dos agendadores), e a escrita deixa de segurar.<br>A criação, a confirmação, a anulação e o estorno sempre mudam a renda e continuam sem espera: seguram até a projeção. |
| Testes | Gancho (`work-time-consistency.test.ts`):<br>• "editada em outra sessão antes do gatilho": nunca R$ 10.260,00. Na árvore revisada, `loading → R$ 10.260,00`.<br>• "editada sem efeito na renda": a estimativa aparece só depois da espera, com o valor certo.<br>Puros: a regra 5 com `bounded` e `expired`; a chave da espera; as escritas de cada documento. |
| Limite que fica | Um gatilho mais lento que a espera (início a frio, retentativas) deixa o estado misto aparecer depois dela, até ele gravar (`consistencia-estimativa.md` §6, (a)). Fechar isso exigiria a projeção registrar as escritas aplicadas, ou seja, mudar a arquitetura financeira, fora do escopo. |

## N04 — MEDIUM (suspeita) — leitura por id do cache local passava na prova

| Item | Conteúdo |
| --- | --- |
| Correção | `transactions/api.ts`: `getTransactionsByIds` passa a usar `getDocsFromServer`. Quem chama é só a estimativa.<br>Sem rede, a leitura falha, e a estimativa mostra a falha com "Tentar de novo" (ou a última provada, com o aviso). |
| Testes | Contra o SDK real, no Emulator (`work-time-p5f.rules.integration.test.mjs`):<br>• sem rede, `getDocs` responde do cache (`fromCache: true`), sem erro;<br>• `getDocsFromServer` falha como `unavailable`;<br>• de volta à rede, lê do servidor.<br>A leitura dos membros e as negações passam a usar `getDocsFromServer`.<br>A guarda fixa a fiação, e o mutante com `getDocs` é morto. |

## N05 — MEDIUM — escuta encerrada antes do primeiro retorno, com desconsideradas: "calculando" para sempre

| Item | Conteúdo |
| --- | --- |
| Correção | `useIncomeEstimateWith.ts` (`blockedByListen`). Com desconsideradas e a escuta encerrada antes do primeiro retorno do servidor, a leitura por id nunca começaria. O estado passa a ser o erro `ESTIMATE_UNCONFIRMED_FAILED`, com "Tentar de novo", que reabre a escuta. |
| Testes | Gancho:<br>• o erro aparece e continua até o "Tentar de novo", com 0 leituras por id;<br>• com a escuta de volta, há uma leitura por id e a estimativa é provada.<br>Na árvore revisada, fica preso em "calculando". |

## N06 — LOW — limite (c): estimativa velha na tela sem aviso, indefinidamente

| Item | Conteúdo |
| --- | --- |
| Correção | Três partes:<br>• A mudança vista entre duas leituras por id também é escrita com espera limitada: depois da espera, deixa de prender.<br>• A última provada mostrada no lugar da atual por mais que a espera ganha o aviso "usa a última leitura", com "Tentar de novo" (`refreshFailed`, que a tela já mostra).<br>• Com a leitura atual em erro, a última provada aparece com o aviso na hora (`holdEstimate`). |
| Testes | Gancho:<br>• O cenário da revisão: a edição de valor (o gatilho grava), depois só a descrição, e mais tarde agosto com +R$ 100,00. Agora chega a R$ 10.660,00; na árvore revisada, ficava em R$ 10.560,00.<br>• O aviso: a releitura da base mais lenta que a espera dá a anterior com o aviso e, depois, a nova sem ele.<br>Puros: o erro com a anterior mostra o aviso; `held`. |

## N07 — LOW — configurações aceitas ao salvar ficavam sem cálculo seguro na janela

| Item | Conteúdo |
| --- | --- |
| Correção | `calendar.ts`: `calendarAmbiguity`, o conferidor do calendário inteiro. Confere:<br>• as rotinas sozinhas;<br>• os dias vizinhos de cada dia sem a rotina (feriado de folga, férias, folga, ausência, jornada reduzida, alteração de escala);<br>• o primeiro dia de cada mês, que pode abrir o período;<br>de 12 meses antes do mês de hoje até 2099.<br>`draft.ts`: `validateDraft` recusa na seção que resolve (exceções, feriados ou rotinas), com o dia e a causa.<br>Configurações: o aviso `role="alert"` fica junto do botão de salvar. No assistente, aparece no passo da seção. |
| Fundamento | Fora desses dias, as entradas de `planDay` são as mesmas que o conferidor das rotinas já conferiu. Tirar janelas não cria cruzamento: só um dia com janela com intervalo coberta pode ficar ambíguo, o que dá o pré-filtro. Prova em `rotinas-matematica.md` §2. |
| Testes | • Dirigidos: folga, jornada reduzida, férias e alteração de escala; feriado local (e marcado como trabalhado, ou trabalhando em feriados); feriado nacional (Tiradentes); início do período; a partir de hoje; o horizonte de 12 meses.<br>• Propriedade de solidez, 220 amostras: o que é aceito não tem dia ambíguo em nenhum mês de nov/2025 a fev/2027, como mês avulso e abrindo o período. Na recusa, ou as rotinas sozinhas são ambíguas, ou o dia apontado é ambíguo no calendário.<br>• Sondas na árvore final: `aceita` (5.000 configurações; 3.538 aceitas, nenhuma com dia ambíguo) e a cópia da busca da revisão (9.662 aceitas, nenhuma com dia ambíguo).<br>• Preferência: seção e mensagem exatas.<br>• E2E `B02 (revisão da R1, N07)`: a folga em Configurações dá o aviso, salvar fica bloqueado, nada é gravado e o axe não acha violação. |

## N08 — INFO — documentos

Corrigidos:
- **Teorema 2** (`rotinas-matematica.md` §4): reescrito com o teto novo e a jornada reduzida.
- **Amostras:** "a propriedade vale em todas as amostras" ficou restrito às faixas de cada gerador, e as faixas foram ampliadas (acréscimos e reduções até 24 h, dirigidas ao caso da revisão).
- **Limites** (`consistencia-estimativa.md` §6): reescritos. N04 e N05 foram corrigidos. Ficam:
  - (a), só com gatilho mais lento que a espera;
  - (b), gatilhos fora de ordem;
  - (c), a mudança de data que tira a desconsiderada da janela.
- **"Cada par vem do mesmo instante":** substituído.
  - Os pares agora vão lado a lado e sem ID repetido (`pairedReadIds`), sempre na mesma consulta.
  - O espelho de um estorno na própria lista não abre par novo.
  - Teste com mais de 30 IDs; na árvore revisada, há ID repetido.

## N09 — INFO — custo do conferidor

| Item | Conteúdo |
| --- | --- |
| Correção | Em Configurações, `validateDraft` é memorizado: uma vez por rascunho, não por renderização (guarda).<br>O conferidor do calendário tem pré-filtro: só um dia com janela com intervalo coberta pode mudar. Medido:<br>• 0,1 ms no caso comum, sem cobertura (`sondas/custo-cal`);<br>• nas 5.000 configurações com cobertura de `sondas/aceita`, média de 9 ms e pior caso entre 59 e 80 ms;<br>• na sonda da revisão 2 (M04): 42 a 84 ms numa configuração coberta comum e 368 a 389 ms no pior caso da gramática (`respostas-revisao-2.md`). |
| Fica | `routinesAmbiguity` leva até cerca de 100 ms no pior caso (três escalas longas, primas entre si), a cada mudança do editor de rotinas. As releituras por id a mais dos testes estão em `consistencia-estimativa.md` §5. |

## N10 — INFO — lista de mudanças observadas sem limite

| Item | Conteúdo |
| --- | --- |
| Correção | `observeExcludedRead` guarda só os lançamentos da leitura atual e só as mudanças que a projeção (a da escuta quando a leitura chegou) ainda não passou. A projeção de um mês só avança, então uma mudança já incluída nunca volta a pesar. |
| Testes | Puros: já incluída, ainda não incluída, acumulada e depois incluída; o lançamento que saiu da lista leva o estado e as mudanças dele. |

## Mutantes e regressão

- Mutantes da R1 com os da revisão: `mutantes.md`.
- Execuções: `execucoes.md`.
- O `verify:all` final roda sobre a árvore corrigida.
- Uma segunda revisão independente, somente leitura, confere o delta corrigido (`revisao-2.md`, com as respostas).
