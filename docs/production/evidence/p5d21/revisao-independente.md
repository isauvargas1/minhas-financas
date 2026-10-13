# Revisão independente (Opus, somente leitura) — P5-D2.1

## Rodada 1

Base `2ddcd26f` → árvore `e530c5e3` (11 arquivos). Sem edição, sem índice Git, sem Emulator.

Veredito: "aprovável com ressalvas". 0 BLOCKER, 0 HIGH, 1 MEDIUM, 5 LOW, 7 INFO.

| ID | Sev. | Achado | Tratamento |
| --- | --- | --- | --- |
| M1 | MEDIUM | Ordem da fila por `dueDate + 1`: vencimentos retroativos (2000-01-01) furam a fila global e podem deixar outros workspaces sem processamento | Corrigido: `runAfterDay = max(vencimento + 1, dia civil da operação)` (`dueQueueDay`); testes unitário e §15.23; mutante M38 |
| L1 | LOW | Recebíveis anteriores à milestone nunca entram na fila; não documentado | Documentado no plano (§20.10) e no DATA_MODEL; sem backfill pela política de legado |
| L2 | LOW | Nada impede um escritor novo de `receivables` sem sincronizar a fila | Corrigido: guarda estática em `receivableQueue.test.ts` (lista fechada de consumidores; 5 escritas = 5 sincronizações, cada uma depois da sua escrita); mutante M44 |
| L3 | LOW | Falha do `count()` final virava erro estrutural com trabalho feito | Corrigido: contagem com `try/catch` próprio, `pendingDueAtEnd = null` e WARN `receivable_overdue_pending_count_failed`; teste §15.24; mutante M40 |
| L4 | LOW | `recoverable_failures` esconde o backlog; fora do contrato persistente sem o WARN persistente | Corrigido: campo `backlog` independente do desfecho; WARN `receivable_overdue_persistent_failure` também para `receivable_invalid`; teste §15.25; mutantes M41 e M42 |
| L5 | LOW | Backoff em dias para falha transitória | Corrigido: códigos transitórios voltam a cada execução horária nas 6 primeiras tentativas e depois diariamente (nunca 7 dias); testes unitário e §15.10b; mutante M39 |
| I1 | INFO | Orçamento só entre páginas | Corrigido: parada rígida por item aos 480 s (`deferred`); teste §15.26; mutante M43 |
| I2 | INFO | Contagem de resposta perdida (`failed` + `retryNotRecorded`, ou `gone`) | Registrado: a confirmação (com `runId`) é a fonte de verdade |
| I3 | INFO | Item fora de tenant nunca sai da frente da fila | Registrado: inalcançável (o cliente não grava; o backend só grava sob `workspaces/{ws}`) |
| I4 | INFO | JSDoc órfão em `notificationTestSupport.ts` | Corrigido |
| I5 | INFO | Contagem de testes (34, não 35) | Corrigido no relato; a suíte agora tem 46 |
| I6 | INFO | "Só enquanto há trabalho" inclui espera até 10 anos | Esclarecido em DATA_MODEL, DATA_RETENTION e no cabeçalho de `receivableQueue.ts` |
| I7 | INFO | Execução que atravessa a meia-noite usa o dia do início na mensagem | Registrado: sem efeito de correção |

Cenários sem teste apontados e cobertos depois: cancelamento concorrente (§15.27), recebido + vencimento editado + estorno (§15.28), estorno parcial aberto → aberto (§15.29), edição só da descrição em backoff (§15.30), vencimento editado para hoje (§15.31), replay da criação (§15.32), corrida real rotina × quitações (§16.3b), falha do `count()` (§15.24), inválido com ≥ 5 tentativas (§15.25), fila retroativa (§15.23), guarda estática (L2). Ficam só registrados: commit do domínio intercalado entre as leituras e o commit da transação do worker (coberto pela serialização do Firestore e pelos testes de item obsoleto e quitação durante o processamento), item fora de tenant (inalcançável) e execução que atravessa a meia-noite (sem efeito).

Respostas às 12 perguntas (resumo): 1) só recebíveis anteriores à milestone sem mudança de forma ou vencimento (documentado; sem backfill pela política); 2) não há perda definitiva; 3) não há publicação dupla; 4) o TTL não reemite; 5) quitação ou cancelamento concorrente não gera aviso indevido; 6) mudança de vencimento correta; 7) defeituosos ocupam no máximo 2 posições; a ordem retroativa foi o M1, corrigido; 8) nenhuma leitura proporcional ao histórico; 9) dados isolados por workspace; capacidade compartilhada: a ordem retroativa foi corrigida em M1 e o volume concentrado num workspace na revisão delta (D1); 10) nenhuma regra financeira afetada; 11) retenção documentada; 12) os testes detectam as regressões, exceto L2 e M1, agora cobertos.

## Rodada 2 — revisão do delta das correções

Árvore `e530c5e3` → `74e8e46b` (9 arquivos). Mesmo revisor independente, somente leitura: sem edição, sem índice Git, sem Emulator.

Veredito: "aprovável com ressalvas". 0 BLOCKER, 0 HIGH, 1 MEDIUM, 2 LOW, 7 INFO. Confirmados sem achado: `runAfterDay` em todos os casos (criação, edição para o passado e para o futuro, estorno), retry do SDK na transação de domínio, relógio fora do alcance do cliente, contadores coerentes, testes antigos não enfraquecidos, caminho antigo removido, logs sem dado pessoal, domínio financeiro intocado.

| ID | Sev. | Achado | Tratamento |
| --- | --- | --- | --- |
| D1 | MEDIUM | Resíduo de M1: capacidade global fixa (2.000 itens por execução) sem justiça entre workspaces; um workspace com volume (pré-carga ou criação contínua) atrasa os avisos de todos os outros | Corrigido: (i) a capacidade passou a ser limitada pelo tempo (até 200 páginas; novas páginas até 420 s, novos itens até 480 s); (ii) cota de 500 itens por workspace por execução, com o cursor saltando o restante do workspace (`startAfter(runAfterDay, workspaces/{ws}/receivable_overdue_queue/\uf8ff)`), validada no Emulator (§15.35); (iii) risco residual registrado no THREAT_MODEL (T-23) e no INCIDENT_RESPONSE, alerta de `backlog` previsto na P7. Mutantes M45 e M46 |
| D2 | LOW | `backlog` não separava falha transitória (que fica devida) de backlog de capacidade; com a contagem falha, ignorava falhas devidas e chegadas | Corrigido: contador `retriedSameDay`; `backlog = pendingDueAtEnd > retriedSameDay + retryNotRecorded`; com a contagem falha, `true` se parou por tempo ou cota, senão nulo. Teste §15.36 (uma única falha transitória) e §15.24 |
| D3 | LOW | Falsos negativos da guarda estática L2 (`update(doc.ref)`, forma de método, `collectionGroup("receivables")`, concatenação) | Corrigido: guarda ampliada (referências a `receivables` por template, concatenação e grupo de coleção; escrita por `receivableRef`/`receivablesRef` em qualquer forma; lista fechada de arquivos; teste de reconhecimento dos padrões) e invariante no Emulator (§15.34): depois de cada operação, todo recebível aberto, com saldo e vencimento válido, tem item na fila do vencimento atual ou confirmação daquele episódio |
| D4 | INFO | §15.23 com janela da meia-noite; datas fixas de 2030 viram bomba-relógio desde M1 | Corrigido: §15.23 usa o `runAfterDay` gravado como dia da execução; o dia dos testes é relativo (`hoje + 1.460 dias`) |
| D5 | INFO | WARN persistente na 5ª tentativa gera ruído em indisponibilidade de 5 a 6 horas | Corrigido: nos códigos transitórios, o WARN começa na 7ª tentativa (depois das 6 horárias); teste unitário; mutante M47 |
| D6 | INFO | Parada rígida só testada com limite 0 | Corrigido: §15.26b (parada no meio da página: o item em curso conclui, os seguintes ficam devidos). O `count()` final e transações em curso depois de 480 s seguem sem limite próprio (resíduo registrado) |
| D7 | INFO | Comentário desatualizado ("`runAfterDay` = dia seguinte ao vencimento") | Corrigido |
| D8 | INFO | `operationDayOf` duplicava `todayOf` | Corrigido: reuso de `todayOf` |
| D9 | INFO | §16.3b não força a corrida (teste de fumaça) | Registrado: as invariantes valem em qualquer intercalação; a corrida forçada está nos testes de item obsoleto e de quitação durante o processamento (falha injetada entre leitura e commit) |
| D10 | INFO | Plano sem o título §20.10; THREAT_MODEL sem o resíduo de D1 | Corrigido: §20.10 escrito; T-23 atualizado |

## Rodada 3 — revisão das correções da rodada 2 e das duas passadas

Árvore `74e8e46b` → `568d380c` (código e testes), depois confirmação das correções em `18dedc9d`. Mesmo revisor independente, somente leitura: sem edição, sem índice Git, sem Emulator.

Antes desta rodada, o benchmark do código com a cota fixa revelou (achado próprio, não do revisor) que a cota não aproveitava a capacidade ociosa: 18.000 itens de um único workspace levavam 36 execuções. A cota passou a valer só na 1ª passada, e uma 2ª passada atende o excedente com o tempo que sobra.

Veredito inicial: "não aprovável". 0 BLOCKER, 1 HIGH, 0 MEDIUM, 3 LOW, 5 INFO. Depois das correções: "aprovável", sem defeito funcional novo.

| ID | Sev. | Achado | Tratamento |
| --- | --- | --- | --- |
| R3-1 | HIGH | O salto do cursor sem leitura não ligava a cota esgotada: quando o 500º item de um workspace era o último de uma página cheia (cota 500 = 5 páginas de 100; workspace único ou primeiro na ordem, como numa importação de vencidos), a 2ª passada não rodava e voltavam 500 itens por execução; `throttled 0` com `backlog true` e, com a contagem falha, `drained` com excedente | Corrigido: o ramo do salto também liga a cota esgotada. Teste §15.39 (cota 2, página 2, 5 itens no mesmo dia: 5 publicados numa execução); mutante M52 |
| R3-2 | LOW | Testes da cota com cada workspace num dia diferente: salto que pulasse o dia inteiro ou o mesmo workspace em dia posterior passaria | Corrigido: §15.40 no mesmo dia, com prefixos ordenados e um item do workspace num dia posterior; mutante M53 |
| R3-3 | LOW | §15.26b com margem curta (300 ms desde o início, inclusive a consulta no Emulator cheio) | Corrigido: 2.000 ms e espera de 2.500 ms, mesmas asserções |
| R3-4 | LOW | Guarda estática sem detectar `` collection(`…/receivables`) `` (sem barra final) e constante de outro nome | Corrigido: padrão `["'`/]receivables["'`/]`, comentários removidos antes da busca, 3 arquivos com o rótulo de classificação "receivables" listados com justificativa; a checagem de escrita segue sobre todos os arquivos. Residual aceito: escrita por `snap.ref` ou variável de nome livre dentro dos arquivos listados |
| R3-5 | INFO | Semântica de `scanned` e `throttled` | Corrigido: documentada no código (`scanned` = desfechos + `deferred` + `throttled`; `throttled` só os lidos além da cota) |
| R3-6 | INFO | Comentários desatualizados (cursor, backoff 0, WARN persistente, "o limite efetivo é o tempo") | Corrigido no código, nos testes e na documentação: com transações rápidas é o teto de 200 páginas que limita |
| R3-7 | INFO | Prioridade estática pelo ID do workspace no mesmo dia; com mais de ~33 workspaces com 500+ itens devidos no mesmo dia o teto de páginas se esgota; a 2ª passada relê falhas que continuam devidas | Registrado como risco residual (espera limitada a cerca de max(nᵢ)/500 execuções) |
| R3-8 | INFO | Sem teste de contagem falha com orçamento esgotado | Corrigido: §15.41 (`backlog true`, desfecho `backlog`) |
| R3-9 | INFO | Sem prazo por chamada ao Firestore: transação iniciada até 480 s com repetições do SDK, mais o `count()`, pode passar de 540 s com Firestore degradado (preexistente) | Registrado como risco residual |

Respostas confirmadas pelo revisor: sem publicação dupla (confirmação lida e criada no mesmo commit; `handled` marcado antes do primeiro `await`); sem perda de item (só remoções transacionais depois de reler recebível e confirmação; cota, parada rígida e item já tratado não escrevem); nenhum item tentado duas vezes na mesma execução; o salto só pula o resto do workspace naquele dia; IDs acima de U+F8FF impossíveis (`rcv_` + 40 hexadecimais, Rules negam escrita do cliente); sem privação indefinida; `operations.ts` só reutiliza `todayOf` (nenhuma regra financeira mudou). Observação final: quando um workspace termina exatamente na cota, sem excedente, a 2ª passada roda mesmo assim (custo de pelo menos uma página; também atende o que chegou durante a execução).
