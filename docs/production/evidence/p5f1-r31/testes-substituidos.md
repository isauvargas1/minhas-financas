# P5-F.1-R3.1 — testes reescritos (mudança de contrato)

**Contrato antigo (R1 a R3).** Sem prova de consistência, ou com a sincronização em curso, `holdEstimate` devolvia a última estimativa provada da mesma identidade (conta, período, workspace, modo, meses, PJ, calendário e exclusões) como `status: 'done'`. Ela convertia os valores como se fosse a atual: até 30 s sem aviso nenhum, depois com `refreshFailed: true`. A auditoria independente da R3 classificou esse comportamento como R3-AUD-01 (HIGH): a estimativa histórica aparecia como conversão atual com `proven = false`.

**Contrato novo (R3.1).** Uma estimativa pronta só aparece com a prova válida e a sincronização concluída, e é sempre o objeto de estado da renderização corrente. Fora disso vale um estado sem conversão, com os valores em reais:
- "calculando";
- depois do tempo de interface, "estimativa em atualização" com "Tentar de novo";
- com uma leitura ou a escuta em falha, o erro fixo em pt-BR com "Tentar de novo".

Nenhuma estimativa anterior é guardada. O tempo de interface só troca o texto e é contado do começo de cada espera. O aviso de leitura anterior (`refreshFailed`) continua, mas só no estado atual provado e sincronizado.

**Regra desta reescrita.** Os testes listados abaixo afirmavam o contrato antigo: a hora ou o total anterior na tela durante a falta de prova ou a sincronização. Cada um foi reescrito no mesmo cenário (mesmos dados, mesmas falhas injetadas, mesma sequência). As afirmações que valiam nos dois contratos seguem iguais:
- nenhum estado misto;
- nenhum valor intermediário;
- contagem de leituras;
- textos fixos;
- recuperação.

Onde o teste afirmava a estimativa anterior, ele passa a afirmar a ausência de conversão em todas as renderizações da janela sem prova (`assertNoConversion`). Quando havia mensagem, afirma o texto exato do erro ou do "em atualização" e a presença do "Tentar de novo". Nenhum teste foi removido nem marcado `skip`/`only`. A contagem de testes por arquivo não diminuiu (`testes-e-resultados.md`).

Prazos (conferidos no diff de `tests/` e `e2e/` contra a R3):
- **Unidade:** nenhuma espera mudou. A N06 segue com 2,5 s e 3 s.
- **E2E reescrito ("releitura que falha"):**
  - o primeiro estado observável depois da falha continua com 45 s;
  - a recuperação pelo "Tentar de novo" continua com 30 s, agora na fase 2, sobre o erro;
  - as fases novas usam as esperas que o arquivo já usa: 45 s para o gatilho de uma receita nova (fases 3 e 5) e 30 s para cada recuperação (fases 2 e 4).
- **Orçamento total do E2E reescrito:** passou de 240 s para 300 s, porque o teste ganhou três fases, cada uma com a espera do gatilho. Ele roda em cerca de 20 s. Nenhuma espera de afirmação já existente foi aumentada.
- **Testes novos:** B03-f e as fases novas usam os prazos de 45 s e 60 s do mesmo arquivo (B03-b e B03-c).

## Unidade — `tests/unit/work-time-income-estimate.test.ts`

| Teste (R3 → R3.1) | Afirmava (R3) | Afirma (R3.1) | Justificativa |
| --- | --- | --- | --- |
| "retenção fail-closed: sem prova, só a estimativa provada da mesma identidade…" → "apresentação fail-closed (R3.1, R3-AUD-01): a estimativa pronta só aparece provada e com a sincronização concluída, e é a própria atual…" | Sem prova, `holdEstimate` devolve a anterior guardada (`shown === first`, `held: true`), com `refreshFailed: true`. Com "calculando" ou erro, a anterior. | Tabela-verdade completa de `holdEstimate(proven, settling, state, unproven)`: pronta só com `proven && !settling`, e é o próprio `state` (`===`); sem prova ou sincronizando, `unproven` ("calculando" ou o erro); estados não prontos passam sem mudança. `holdEstimate.length === 4`: a função não recebe estimativa anterior. | É o próprio comportamento inseguro (R3-AUD-01). |
| "retenção fail-closed: provada durante a sincronização, a anterior da mesma identidade…" → "apresentação fail-closed (R3.1): provada, mas com a sincronização em curso, nenhuma conversão, nem a anterior nem a atual…" | Provada e sincronizando: a anterior com `refreshFailed: true`. | Sincronizando: "calculando" ou o erro da leitura em falha. Sincronizada: a atual, com o aviso dela (`stale`) quando houver. | A sincronização em curso impede confirmar o estado atual (item 2 do pedido). |
| "retenção fail-closed: outra conta, outro período ou qualquer entrada diferente não reaproveita a anterior…" → "apresentação fail-closed (R3.1), propriedade: em 20 000 renderizações aleatórias (pronta, carregando, erro ou ociosa; com ou sem prova; sincronizando ou não)…" | Troca de identidade não reaproveita a anterior (`sameEstimateIdentity`). | Propriedade com 20 000 passos (gerador LCG fixo) sobre estados, prova e sincronização aleatórios. A pronta mostrada é sempre `=== state` da renderização, com `proven && !settling`, nunca um estado de outra renderização, e mais de 1 000 prontas são exercitadas. A função não recebe identidade: os rótulos só nomeiam o passo. As trocas reais de conta, workspace e preferência estão nos testes do gancho ("R3.1: troca do workspace…", "R3.1: mudança da preferência…"). O nome foi corrigido depois da revisão adversarial (A-06 b), porque citava trocas que a propriedade não faz. | A identidade deixou de existir: não há anterior a reaproveitar. |
| R5-02 "escuta das projeções encerrada por erro: a estimativa avisa que pode estar desatualizada…" → "…, com desconsiderada: sem prova, o erro fixo com 'Tentar de novo' e nenhuma conversão, nem a última leitura…" (mesmo cenário: `excludedIds: ['r500']`) | Escuta encerrada: `refreshFailed: true` e `incomeCents === 1_056_000` ("a última leitura continua valendo"). | Escuta encerrada: o erro `ESTIMATE_UNCONFIRMED_FAILED` e `assertNoConversion` em todas as renderizações desde a falha. "Tentar de novo" reabre a escuta (`opened + 1`) e a estimativa volta provada (`1_056_000`, sem aviso). | Com desconsiderada, a prova depende da escuta. Encerrada, nada prova a leitura em uso. |
| R6-01 "escuta do provedor encerrada: a prévia de Configurações a reabre…" → "…, com desconsiderada: o erro com 'Tentar de novo' no provedor, sem conversão…" | O provedor fica com a ressalva (`refreshFailed: true`). | O provedor mostra o erro `ESTIMATE_UNCONFIRMED_FAILED` e nenhuma conversão desde a falha. A reabertura pela prévia e a receita de outra sessão (`1_106_000`) seguem iguais. | Mesma do R5-02. |
| R6-02 "releitura da mutação com a base nova antes do retorno da escuta (viva / encerrada)…" (mesmo nome) | Encerrada: espera `refreshFailed`; a última estimativa `1_056_000` com a ressalva. | Encerrada: espera o erro `ESTIMATE_UNCONFIRMED_FAILED`. Viva: "calculando" na renderização final. Em todas as renderizações até a prova (a escuta entregar a projeção nova, ou o "Tentar de novo"), a base nova (outubro sem a anulada) nunca convertida. Encerrada: nenhuma conversão em renderização nenhuma desde a falha. "Nenhum valor intermediário" (`[1_056_000]`) e o registro de leituras seguem iguais. A afirmação sobre todas as renderizações entrou depois da revisão adversarial (A-06 c), porque antes só a renderização final era conferida. | A base nova sem projeção não prova; a anterior não pode substituí-la. |
| R8-03 "janela de 12 meses, a série nova sem pedido e o mês avulso falhando: a estimativa segura enquanto ele lê e libera depois da falha, com a ressalva" → "…: sem conversão enquanto ele lê e sem prova; com a projeção que prova a série nova, a atual com a ressalva da falha (R8-03; R3.1)" | Antes da projeção nova, `incomeCents === 3_550_000` (a anterior). | Antes da projeção nova, nenhuma conversão e o erro do mês avulso com "Tentar de novo". Com a projeção que prova a série nova, todos os estados mostrados são `3_600_000` com `refreshFailed: true`: o aviso da falha continua, no estado atual. Contagens de leitura (`byIdReads === 3`, `monthCalls`) iguais. | Prova do item 6 (o aviso continua) sem a anterior. |
| R9-01 "janela de 12 meses sem receita desconsiderada, com a escuta encerrada…: a estimativa segura a versão anterior até a série chegar" → "…: sem prova, o erro com 'Tentar de novo' e nenhuma conversão, nem a versão anterior; reaberta a escuta, as bases novas provadas" | Com a escuta encerrada, a anterior (`2026-10 = 300_000`) com a ressalva. | O erro `ESTIMATE_UNCONFIRMED_FAILED` e `assertNoConversion` em todas as renderizações. "Nunca R$ 35.500,00" e "nenhum par novembro/outubro misto" seguem iguais. | Com mais de uma base, a escuta encerrada deixa a prova sem projeção. |
| R10-03 "janela de 12 meses com a escuta encerrada: a releitura pendente da série que sai sem rede fica pausada, e outra renderização não mostra o mês avulso novo com a série antiga…" → "…, e nenhuma renderização converte (nem a versão anterior nem o mês avulso novo com a série antiga) até a rede voltar e a prova" | Busca pausada: `incomeCents === 3_600_000` (a anterior), com a ressalva. | Busca pausada: nenhuma conversão e o erro com "Tentar de novo". As afirmações de chamadas (`seriesCalls`, `monthCalls`) e de estado misto seguem iguais. | Mesma do R9-01. |
| R9-03 "anulação nesta aba… o estado misto nunca aparece, sem esperar a releitura pendente da série" → "…, e a estimativa de 12 meses só aparece com a sincronização concluída" | A de 12 meses (`3_550_000`) aparece antes da releitura pendente da série (`seriesCalls === 1`). | Com a releitura da série pendente, nenhuma conversão nas renderizações de 12 meses. A de 12 meses só aparece com `seriesCalls === 2` (a sincronização concluída), com o mesmo valor. "Antes da prova, só 'calculando'" segue igual. | O item 2 do pedido manda esperar a sincronização. Este teste passa a esperar a releitura pendente (risco residual RR-R31-02). |

## Unidade — `tests/unit/work-time-consistency.test.ts`

| Teste | Afirmava (R3) | Afirma (R3.1) | Justificativa |
| --- | --- | --- | --- |
| N06 "revisão da R1 (N06): a última estimativa provada mostrada no lugar da atual por mais que a espera limitada ganha o aviso e o 'Tentar de novo'" → "revisão da R1 (N06), contrato da R3.1: a base relida devagar por mais que o tempo de interface: nunca a última provada; 'calculando', depois 'estimativa em atualização' com 'Tentar de novo', e a nova provada, sem aviso" | Depois de 30 s, a anterior (`1_056_000`) com `refreshFailed: true` e `retry`; o aviso só na anterior. | Depois do tempo de interface, o erro `ESTIMATE_UPDATING` com `retry`; `assertNoConversion` enquanto a base nova não chega. A nova (`1_086_000`) aparece sem aviso. `assertUpdatingOr(…, [1_086_000])` cobre a janela inteira. | O aviso da N06 existia só para a anterior mostrada no lugar da atual, e essa troca não existe mais. |
| R11-02 "12 meses sem desconsiderada, as bases relidas sem pedido da escuta… e o mês avulso falhando" (mesmo nome) | Depois da falha do mês avulso, `status: 'done'` com `refreshFailed` (a anterior, com a ressalva). | Depois da falha, o erro exato do relatório ("Não foi possível carregar o relatório. Tente novamente.") e `assertNoConversion` desde a falha. "Nunca R$ 36.500,00", "o mesmo total antes e depois" e "nenhuma renderização com só uma das bases novas" seguem iguais. | Com a sincronização sem concluir, nenhuma conversão. |
| B03 (R3, a) "a desconsiderada editada em outra sessão com o gatilho atrasado…" (mesmo nome) | Enquanto o gatilho não aplicou: `assertOnly([1_056_000])`, só a última provada. | Enquanto o gatilho não aplicou: `assertNoConversion`. No fim, `assertUpdatingOr([1_086_000])`: só estados sem conversão ou o valor certo. | É o cenário do R3-AUD-01 com o gatilho atrasado. |
| B03 (R3, d) "a desconsiderada muda de mês para fora da janela…" (mesmo nome) | O mês antigo continua descontando: `assertOnly([1_056_000])`. | `assertNoConversion` até a marca e a receita mudarem juntas; depois só `1_086_000` (`assertUpdatingOr`). | Mesma do (a). |

Testes novos neste arquivo (vermelhos na R3; `saidas/red-r31-na-r3.log.txt`):
- R3-AUD-01 em si;
- antes e depois do tempo de interface. Depois da revisão adversarial (A-06 a), ganhou um segundo período sem prova: ele começa de novo em "calculando" e não herda o "em atualização" do primeiro. Isso mata o mutante A12 (`mutantes.md`);
- falha de rede nas leituras por id e nas marcas;
- leitura em andamento;
- troca de workspace;
- troca de preferência;
- provada sincronizando.

## Guarda — `tests/unit/work-time-guard.test.ts` ("estimativa: uma por contexto, sem polling nem listener por lançamento")

| Afirmava (R3) | Afirma (R3.1) |
| --- | --- |
| A forma da retenção: `const decision = holdEstimate(proof.proven, holding, last.current, identity, current, unproven); last.current = decision.last;`, a identidade (`EstimateIdentity`, `sameEstimateInputs`) e o aviso N06 (`decision.held && heldTooLong …`). | `const shown = holdEstimate(proof.proven, holding, current, unproven);` e o corpo exato `state.status === 'done' && (!proven \|\| settling) ? unproven : state`, com a assinatura de 4 parâmetros. Ausência de `HeldEstimate`, `EstimateIdentity`, `sameEstimateIdentity`, `sameEstimateInputs`, `heldTooLong`, `heldSince`, `decision.`, `last.current` e `lastProven`. Nenhum `useRef`/`useState` de `IncomeEstimateState`. O fim exato (`if (waitingProof && waitedTooLong) return { … ESTIMATE_UPDATING … }; return shown;`). |
| `waitingProof = !proof.proven && !decision.held && …` | `waitingProof = current.status === 'done' && shown.status === 'loading'`: "em atualização" também durante a sincronização longa, sempre sem conversão. |

As outras afirmações da guarda (entrada da prova sem relógio, leitura do servidor, chave da leitura, `ESTIMATE_UPDATING` importado e usado uma vez) seguem iguais. A guarda é estática: uma retenção escrita de outro jeito (por exemplo, `useRef<any>`) escaparia da expressão, mas não dos testes de comportamento. O mutante A01 é morto por 27 deles, e a revisão adversarial matou também uma variante com `useRef<any>`.

## E2E — `e2e/work-time-p5f.spec.ts`

| Teste (R3 → R3.1) | Afirmava (R3) | Afirma (R3.1) | Justificativa |
| --- | --- | --- | --- |
| "releitura que falha: a estimativa segue com a leitura anterior, avisa e se recupera com 'Tentar de novo'" → "releitura que falha: sem confirmar a receita nova, nada convertido e erro com 'Tentar de novo', que a traz com o relatório de volta; com a projeção de volta à última leitura, a estimativa volta com o aviso" | Com o relatório em falha e uma receita nova na janela: `work-time-preview-refresh-failed` com o aviso, a hora anterior (R$ 25,00) e a ressalva no topo; depois, "Tentar de novo" traz a hora nova. | Mesma receita nova, mesma falha (HTTP 500 em `getFinancialReport`), cinco fases:<br>(1) o erro "Não foi possível carregar o relatório. Tente novamente." com "Tentar de novo", sem detalhe interno, sem hora, sem aviso de leitura anterior, nenhum valor convertido, e "indisponível agora" no topo;<br>(2) com o relatório de volta, o "Tentar de novo" do erro traz a hora com a receita nova, sem erro nem aviso, como na R3;<br>(3) com o relatório em falha de novo, outra receita: de novo o erro; outra sessão a anula e a projeção volta à última leitura: o aviso de leitura anterior aparece com a hora confirmada, sem detalhe interno, e a ressalva no topo;<br>(4) o "Tentar de novo" do aviso, com o relatório de volta, apaga o aviso;<br>(5) receita nova: a hora nova, sem aviso nem erro.<br>Um registrador na página afirma: nenhuma hora nos dois intervalos de erro (até o "Tentar de novo" e até a anulação); o aviso só com a hora confirmada; as horas novas nunca com o erro. | A R3 mostrava a hora anterior com a receita nova ainda não lida. A recuperação pelo "Tentar de novo" (fase 2) é a da R3, agora a partir do erro; ela voltou depois da revisão adversarial (A-03), que apontou que a primeira reescrita da R3.1 a tinha perdido. Os textos do aviso e da ressalva seguem cobertos de ponta a ponta, no estado atual confirmado pela escuta (fase 3). |

## E2E novo

`e2e/work-time-b03.spec.ts`, "B03-f (R3.1)", é o R3-AUD-01 de ponta a ponta e é vermelho na R3:
- 1ª execução: a falha em `:668`, com 9 valores convertidos na tela;
- 2ª execução, depois de a revisão adversarial (A-06 e) pedir que os reais fossem provados pelo registrador: a falha em `:671`, porque depois de 60 s o último valor mostrado ainda era "tempo|≈ 808 h". É o saldo novo pela renda anterior.

Os registros estão em `saidas/e2e-red-r3/` e `saidas/e2e-red-r3-2/`.
