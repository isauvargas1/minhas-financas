VEREDITO: PASS

# Parecer adversarial, rodada 2 — P5-F.1-R3.1 (conferência das respostas)

As respostas aos achados da rodada 1 se sustentam no estado final e não há achado HIGH nem MEDIUM. Há quatro observações INFO novas, nenhuma que mude o comportamento. O fechamento ainda depende de duas pendências que não são achado: o `verify-all-2` está em andamento, e o texto final dos riscos RR-R31-02, 05 e 06 no plano mestre (§20.19) e no relatório ainda não existe no disco (ver R2-04).

## 1. Escopo conferido

As três árvores foram comparadas uma com a outra no mesmo worktree:

| Árvore | Hash |
| --- | --- |
| Código final | `d9fed573c803d64827ba278c347215054a31e0d2` |
| Rodada 1 | `40057d2a78c47fea537480b0a2bc21fc46e2a500` |
| Base R3 | `1c9155dbc8d6aedd35e6f39a63fac46b53d81919` |

**Rodada 1 → final.** São 8 arquivos:
- Código de produção: só o comentário de `src/modules/work-time/useIncomeEstimate.ts:18`. Estes arquivos são idênticos entre `40057d2a` e `d9fed573`: `useIncomeEstimateWith.ts`, `basisSync.ts`, `consistency.ts`, `messages.ts`, `WorkTimeContext.tsx`, `IncomeEditor.tsx`, `Header.tsx` e `EstimateDetails.tsx`. As conclusões de código da rodada 1 continuam valendo.
- Testes: `work-time-consistency.test.ts` (segundo período), `work-time-income-estimate.test.ts` (nome da propriedade e R6-02), `e2e/work-time-p5f.spec.ts` (5 fases) e `e2e/work-time-b03.spec.ts` (`expect.poll` do registrador).
- Documentos: `DATA_MODEL.md`, mais os novos `mutantes.md` e `testes-e-resultados.md`.

**R3 → final.** No código, só 5 arquivos de `src/` mudaram. Nada em `functions/`, `firestore.rules`, `firestore.indexes.json`, Billing, marcas, gatilhos, reconstrução ou estilos.

**Disco.** Os 3.374 arquivos da árvore final (`src`, `tests`, `e2e`, `functions/src`, Rules, índices, `package.json`, `docs/production`) batem com o disco por `git hash-object`, exceto 3 documentos de evidência que já foram atualizados depois da árvore: `matriz-antes-depois.md`, `mutantes.md` e `testes-substituidos.md`. Não há arquivo extra em `src/`, `tests/` ou `e2e/`. As respostas de documentação foram lidas na versão do disco.

**`verify-all-2`.** Roda sobre a árvore `b841ec69…`, que difere de `d9fed573` só em `docs/` (0 arquivos fora de `docs/`). Estava em andamento na etapa de integração com o Emulator quando este parecer foi escrito: **pendente**, sem resultado presumido.

## 2. Comandos executados e resultados

Os caminhos curtos são relativos a `<scratchpad>/p5f1r31/revisoes/adversarial/rodada2/`.

| Comando | Resultado |
| --- | --- |
| `git diff --stat` / `--name-only` entre as três árvores e entre `d9fed573` e `b841ec69` | como na seção 1 |
| `git hash-object` da árvore final contra o disco | 3.371/3.374; os 3 restantes são documentos de evidência atualizados depois |
| `npx tsc --noEmit` no worktree | saída 0 (`logs/tsc-final.log`) |
| Os 3 arquivos de unidade numa cópia da árvore final (`git archive`, com `functions/src` e Rules) | 85/85; guarda 18/18 nessa cópia (`logs/unit-3-final.log`, `logs/guard-final-copia.log`) |
| Meu M8 (`waitedTooLong` não volta a `false`) sobre os testes finais | **morto** pelo segundo período ("o segundo período não herda o 'em atualização' do primeiro"; `logs/m8-final.log`) |
| M9: o "Tentar de novo" não relê a série (`void refetchSeries()` removido) | **morto** pelo R6-02 com a escuta encerrada, pelo registro de leituras (`logs/m9-final.log`) |
| ADV-7: falha da série relida e relatório de volta, **sem clique** | a releitura automática do agendador traz a estimativa nova (1 leitura; `logs/adv7-final.log`) |
| Segundo período ("antes e depois do tempo de interface"), 15 vezes em sequência | 15/15 (`logs/rep-segundo-periodo-*.log`) |
| Segundo período e os dois R6-02, 4 processos em paralelo × 3 rodadas | 12/12 (`logs/par-*.log`) |

Não rodei Emulator, E2E, builds nem `verify*`. Os logs E2E do autor foram conferidos como dados:
- `e2e-red-r3-2.log`: o B03-f falha em `:671` com `Received: "tempo|≈ 808 h"`, e a "releitura que falha" falha em `:1081` (fase 1).
- `e2e-r31-work-time-2.log`: 25/25. A "releitura que falha" levou 19,9 s e o B03-f 39,4 s.
- A sequência `[previa-releitura-que-falha]` bate com as 5 fases:
  - R$ 25,00;
  - calculando → erro → calculando → R$ 25,68 (8 ms depois do clique);
  - calculando → erro → R$ 25,68 com aviso → R$ 25,68 → calculando → R$ 26,09.

## 3. Conferência das respostas

| Achado (rodada 1) | Resposta | Conferência |
| --- | --- | --- |
| A-01 (LOW) — regra 1 sem a escuta: cache e divergência persistente | RR-R31-05, fora do escopo | **Aceita.** A matriz (linha 17) e o `revisoes/LEIAME.md` descrevem os dois cenários e a direção sugerida, e o código não mudou, como esperado. Mantenho LOW, ao contrário do F-02 (MEDIUM) da revisão financeira, pelos motivos da rodada 1: anterior à R3.1 e reduzido por ela; não é o mecanismo do R3-AUD-01; o critério literal (estado da própria renderização, `proven`, `!holding`) se cumpre; corrigir muda o mecanismo da R3 que o pedido manda preservar. A divergência de severidade precisa ficar registrada na decisão do RR-R31-05. Texto final pendente (R2-04) |
| A-02 (LOW) — painel "Receitas consideradas" | RR-R31-06 | **Aceita**, com a ressalva R2-03 sobre a justificativa |
| A-03 (LOW) — E2E sem o "Tentar de novo" trazendo a receita nova | Fase 2 no E2E | **Aceita.** A fase 2 percorre o caminho: relatório de volta, clique no "Tentar de novo" do erro, a hora com a receita nova (`hourlyX`), sem erro nem aviso. O registrador exige que não haja hora entre o erro e o clique. Ressalva R2-01: a afirmação não prova que foi o clique |
| A-04 (INFO) | RR-R31-04 | Aceita |
| A-05 (INFO) — pior caso do RR-R31-02 | cerca de 10 min | Aceita no `LEIAME.md`; o texto do próprio RR-R31-02 ainda não foi atualizado no relatório (R2-04) |
| A-06 (a) segundo período | teste e mutante A12 | **Aceita.** O segundo período (`work-time-consistency.test.ts:1234-1259`) começa em "calculando", não herda o "em atualização" e volta a ele depois do tempo de interface. Meu M8 é morto ali, e o A12 do autor é o mesmo |
| A-06 (b) nome da propriedade | renomeada | **Aceita.** O novo nome descreve o que ela gera, e o comentário diz que as trocas reais estão nos testes de gancho (`work-time-income-estimate.test.ts:117-120`) |
| A-06 (c) R6-02 | todas as renderizações até a prova | **Aceita.** Com a escuta encerrada, nenhuma conversão desde a falha até a prova (`:709-714`). Com a escuta viva, a base nova (outubro em 352.000) nunca convertida em renderização nenhuma; a ausência de conversão da anterior continua conferida na renderização final, como a tabela de `testes-substituidos.md` agora diz com exatidão |
| A-06 (d) prazos | descritos por fase | **Aceita.** O texto de `testes-substituidos.md:21-28` bate com o código: 45 s no primeiro estado depois da falha e nas esperas de gatilho (fases 3 e 5), 30 s nas recuperações (fases 2 e 4) e o orçamento de 240 s para 300 s |
| A-06 (e) B03-f | `expect.poll` do registrador | **Aceita.** `e2e/work-time-b03.spec.ts:670-671` exige `reais|R$ 20.200,00` como último valor do saldo, e o registrador separa `tempo|…` de `reais|…` (`:261-281`). Na R3 falha exatamente aí, com `tempo|≈ 808 h` |

Nenhuma asserção foi removida entre a rodada 1 e o final. As únicas linhas removidas em `tests/` são o nome e o comentário antigos da propriedade. No E2E, as removidas foram trocadas pelas mesmas asserções com os valores das fases novas: `hourlyX` no lugar de R$ 25,00 e `hourlyXZ` no lugar de `hourlyAfter`. A contagem de testes dos 3 arquivos ficou em 85 (77 na R3).

## 4. Pergunta adicional: as fases novas podem ser frágeis?

**Teste de unidade (segundo período): não, na prática.**
- O tempo de interface corre só no relógio manual. `drive` avança no máximo 20 × 30 ms = 600 ms, abaixo dos 800 ms do teste, então a afirmação "não herda" não quebra por estouro do relógio.
- As leituras assíncronas usam tempo real com folga (`settle(40)` por passo).
- O único jeito de falhar seria uma inanição extrema: as leituras não terminarem em 20 passos de 40 ms. O `drive` acusa com mensagem própria, e o risco é o mesmo do primeiro período, que já existia.
- Passou 15/15 em sequência e 12/12 em paralelo, sob carga.

**E2E (fases 2 a 5): dependem da ordem dos eventos, mas são determinísticas em condições normais.** Há três pontos a registrar:

1. **Microcorrida entre `page.unroute` e o clique** (fases 2 e 4). Depois de cada primeira falha, o agendador deixa uma releitura automática pendente cerca de 5 s depois: `BASIS_RETRIES_AFTER_ERROR = 2` (`basisSync.ts`) com `coalesceMs: 5_000` (`queryKeys.ts:39-43`). Se ela disparar exatamente entre o `unroute` e o clique (ou a captura de `retriedAt`), o erro ou o aviso some antes do clique. O `click()` espera um botão que não volta (tempo esgotado) ou uma hora entra antes de `retriedAt`, e a asserção "nenhuma hora sem confirmar" falha. A janela é de milissegundos e só existiria se as asserções da fase anterior levassem perto de 5 s; na execução registrada, o clique veio cerca de 0,26 s depois do erro. Risco desprezível; não pede mudança.
2. **Orçamento do agendador da escuta no limite, no pior caso.** Cada episódio de falha gasta até 2 disparos (a releitura pedida e uma automática). O pior caso da sequência é 2 + 2 + 1 = 5 disparos, exatamente o `burst: 5`, com reposição de 1 a cada 120 s (`queryKeys.ts:39-43`). Na execução registrada, a coalescência reduziu isso a 3. Hoje passa; mas uma fase de falha a mais neste teste faria a releitura da última fase esperar a reposição, até 120 s, acima dos 45 s da espera, e o teste falharia por orçamento. Fica como cuidado para edições futuras.
3. **O B03-f com `expect.poll` não é frágil.**
   - O último valor do registrador só muda com uma conversão nova, e ela só volta depois da reconstrução, posterior à afirmação.
   - A ordem entre o saldo novo do Dashboard e a perda da conversão é segura: a sincronização da estimativa segura no próprio retorno da escuta (`setWaitingKey` no callback), e a releitura do Dashboard só chega depois de pelo menos 2 s de coalescência.

## 5. Achados novos (rodada 2)

### R2-01 — INFO — As fases 2 e 4 do E2E não provam que o "Tentar de novo" causou a recuperação

**Cenário (ADV-7).**
1. A série relida falha durante a sincronização e o erro aparece.
2. O relatório volta e ninguém clica.
3. A releitura automática do agendador traz a estimativa nova (`rodada2/logs/adv7-final.log`).

No produto, essa releitura vem cerca de 5 s depois do primeiro erro, dentro da espera de 30 s da fase 2 (`e2e/work-time-p5f.spec.ts:1088-1095`). O mesmo vale para a fase 4. Um botão inerte passaria nas duas fases.

Na execução registrada, a hora apareceu cerca de 0,27 s depois do erro, antes da automática: o clique foi a causa ali, mas a asserção não exige isso.

**O risco real é baixo.** O M9 ("Tentar de novo" sem reler a série) é morto pelo R6-02 com a escuta encerrada, pelo registro de leituras. O "Tentar de novo" da primeira carga, sem releitura automática, está coberto no E2E de Configurações (`:758-763`).

**Sugestão (opcional).** Antes do `unroute`, esperar o agendador esgotar as automáticas, contando no `route` as respostas 500 (por exemplo, 4 respostas e depois nenhuma por mais de 6 s). Ou abrir `page.waitForRequest('**/getFinancialReport')` antes do clique, com prazo menor que a coalescência.

### R2-02 — INFO — Fragilidades latentes do E2E

São a microcorrida e o orçamento no limite, com os cenários da seção 4. Nenhuma pede mudança agora.

### R2-03 — INFO — Justificativa do RR-R31-06 imprecisa

A matriz (linha 18) diz "Manter a lista exigiria a estimativa anterior". Não é exato: o painel só precisa da data de referência e dos totais oficiais dos meses (`IncomeEditor.tsx:46-56`, `:108-110`). A série corrente traz os dois, sem conversão e sem estimativa anterior.

Adiar é uma decisão legítima, pelo escopo mínimo e por mexer no contrato do componente. Mas a justificativa deveria ser essa, não a necessidade da estimativa anterior.

### R2-04 — INFO, pendente — Texto final dos riscos e `verify-all-2`

- **Riscos.** No disco, `RELATORIO-P5F1-R31.md` (modificado às 20:54) ainda tem só RR-R31-01 a 04, e o RR-R31-02 sem o pior caso de cerca de 10 min. O plano mestre não tem §20.19 nem RR-R31, nem no disco nem na árvore final. Hoje, RR-R31-05 e 06 estão só em `matriz-antes-depois.md` (linhas 17 e 18) e em `revisoes/LEIAME.md`. A resposta ao A-05 ("Corrigido no RR-R31-02") ainda não está no próprio RR. Conferir quando o texto final for gravado.
- **`verify-all-2`.** Em andamento; resultado não presumido.

## 6. Artefatos

Tudo em `<scratchpad>/p5f1r31/revisoes/adversarial/rodada2/`:
- `final-copia/` — cópia `git archive` da árvore final, com link para `node_modules`;
- `m8-final/` e `m9-retry-sem-serie/` — cópias com os mutantes;
- `experimentos/adv7-append.ts` — o ADV-7, anexado a uma cópia de `work-time-consistency.test.ts`;
- `logs/` — `tree-final.tsv`, `tsc-final.log`, `unit-3-final.log`, `guard-final-copia.log`, `m8-final.log`, `m9-final.log`, `adv7-final.log`, `rep-segundo-periodo-*.log` e `par-*.log`.

Não alterei nenhum arquivo do worktree.
