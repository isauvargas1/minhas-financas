FAIL — Firestore scale/cost review

Rodada 3 da revisão independente da P5-F.1-R3, especialidade `firestore-scale-cost-review`. É a confirmação documental que o gate recomendou no L-01. Revisão só de leitura, em 2026-11-09, das 22:20 às 22:55 UTC.

**Veredito.**

- **Sugestões aplicadas:** as edições do §9 de `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md` aplicam N1, N2, N3, N5 e N6 como eu as escrevi.
- **Números:** todos conferem com as sondas e com o código da árvore `377c2f3f`. Reexecutei as cinco sondas anteriores sobre uma compilação nova da árvore congelada, e a saída foi idêntica byte a byte aos logs das rodadas 1 e 2.
- **§3:** não muda nenhum número de custo.
- **Motivo do FAIL:** ao conferir contra `src/modules/reports/basisSync.ts` a frase editada "Também tem limite por hora, pelo orçamento dos agendadores", achei um caminho sem orçamento.
  - Quando a projeção de um mês da janela diverge da base e volta antes de as bases relerem, a sincronização libera e relê a prova na hora, sem passar por nenhum agendador.
  - **Medido** com o gancho real da árvore congelada: 20 voltas, 20 provas e nenhuma releitura de base.
  - O custo desse caminho tem limite, mas é o limite das escritas no servidor, que o §9 não declara.
  - É o achado **R3-M1**.
- **Só documento:** nenhum código precisa mudar. O risco de desenho é LOW, como o L3; o que bloqueia é o modelo canônico afirmar um teto que o código não impõe.
- **Rodada 2:** o meu PASS não cobre o estado final, nem cobria o estado da rodada 2, porque a frase já estava lá, no singular. A omissão é minha: na rodada 2, conferi a frase só contra os caminhos do modelo da rodada 1 (o agendador da prova e as liberações que dependem de releitura das bases).

## Escopo e estado revisado

**Árvores.** Conferi as duas com um índice temporário meu, apagado depois. O índice real e o `final.index` não foram usados.

| Árvore | Hash | Como conferi |
| --- | --- | --- |
| Documentos, estado atual do W | `ad1660a336f043c7331e158e9a85efdae17e277b` | `read-tree HEAD` (`1730a1df`), `add -A` e `write-tree`. Às 22:20 e às 22:46 UTC, o mesmo hash |
| Código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` | `git diff --quiet --exit-code 377c2f3f ad1660a3 -- . ':(exclude)docs'` com saída 0. É a árvore do `verify:all`: `saidas/verify-all-final.meta.txt` registra `arvore=377c2f3f…` e `exit=0` |

**Base do diff.**

- O desenho em `3eb6041d` é o mesmo blob da árvore que conferi na rodada 2 (`1f78fc6e`): `d9529192`. Então o diff `3eb6041d` → `ad1660a3` é tudo o que mudou no desenho desde o meu parecer.
- Gerei o diff de novo, e ele é idêntico a `r3-diff-desenho.patch`. Mudaram 6 linhas e saíram 5:
  - a linha 37 (§3);
  - as linhas 122, 123, 125 e 143;
  - a linha 129, que é nova (§9).
- Blob final do desenho: `991e41a8`.

**Cópias no pacote.**

- As cópias dos meus pareceres em `docs/production/evidence/p5f1-r3/revisoes/escala-custo/` só trocam o caminho absoluto por `<scratchpad>`.
- As sondas e os logs copiados são idênticos aos originais, pelo sha-256.

**Código conferido** (árvore `377c2f3f`):

- **Backend:** `functions/src/cash/periods.ts`, `rebuild.ts`, `projectionMarks.ts`, `createTransaction.ts` e `mutateTransaction.ts`.
- **Prova e estimativa:** `src/modules/work-time/projectionReads.ts`, `projectionProof.ts`, `useIncomeEstimateWith.ts`, `receivableReversal.ts` e `estimate.ts`.
- **Bases e agendadores:** `src/modules/reports/basisSync.ts`, `basisRefresh.ts`, `basisRegistry.ts`, `queryKeys.ts`, `liveRefresh.ts` e `hooks.ts`.
- **Leituras e telas:** `src/modules/transactions/api.ts` e `incomeReads.ts`, `src/App.tsx` e `src/components/ReportsWidget.tsx`.
- **Configuração e testes:** `firestore.rules`, `firestore.indexes.json` e os testes citados abaixo.

Os blobs estão em `<scratchpad>/p5f1r3/revisoes/escala-custo/hashes-rodada-3.txt`.

**Também conferi** as linhas de custo da §20.18 do plano (`docs/production/PRODUCTION_READINESS_PLAN.md:5137-5144`, `:5147`, `:5182-5184` e `:5206-5209`). Elas resumem o §9 e fecham o N4.

## Conferência número a número do §9

"Sonda R3" quer dizer: reexecutada nesta rodada sobre a compilação nova da árvore congelada, com saída igual ao log anterior.

| Linha do §9 | Texto | Conferido contra | Resultado |
| --- | --- | --- | --- |
| 121 | Gatilho: +1 leitura e +1 escrita por entrega aplicada; reentrega e coberta +1 leitura e 0 escrita; primeira quebra +1 escrita no estado; criação 2/3 → 3/4; edição sem efeito de caixa 2/1 → 3/2 | **Código:** `getAll` de 3 documentos (`periods.ts:1313-1314`); reentrega sem escrita (`:1315-1321`); coberta, só a marca de entrega (`:1339-1347`); marca (`:1405-1406`); estado só na primeira quebra (`:1407-1413`). **Sonda R3:** `logs/r3-sonda-custo-gatilho.log`, igual a `r2-sonda-custo-gatilho.log` | **Confere** |
| 122 (N1) | `projectionGeneration` de 35 a 76 B, sem escrita a mais. "Medido (escritas); estimativa (tamanho)" | **Escritas:** o campo vai na escrita do mês que já existe (`periods.ts:849-865`, `:861`), e a sonda do gatilho mostra as mesmas escritas de meses da R2A. **Tamanho, pela fórmula:** nome 21 B. Com `{id: "g0", cutoff: null}` (`periods.ts:834-835`), 35 B. Com `{id: UUID, cutoff: Timestamp}` (`rebuild.ts:373`, `:1627`), 76 B | **Confere.** N1 aplicado |
| 123 (N6) | 373 B só na `g0`; 599 B depois de uma publicação, com a poda; 726 B sem ela; no máximo 5.743 B; 0 entrada de índice; a isenção só vale depois da implantação; uma consulta futura exige índice declarado | **Sondas R3:** `r3-sonda-tamanho-marca.log` (373 e 5.743) e `r3-sonda-poda-isencao.log` (726 → 599, os 6 campos gravados isentos, 0 composto). **Código:** 2 posições (`projectionMarks.ts:45-46`); 16 pendências (`:43`, `:319-320`); poda (`:505-518`), usada em `periods.ts:1402-1406`; campos de topo (`projectionMarks.ts:483-494`, `:524-535`); isenções (`firestore.indexes.json:1440-1469`), fixadas por `functions/src/cash/__tests__/projectionMarks.test.ts:292-307`; só leitura por id e `list` negado (`firestore.rules:818-822`, `:459`) | **Confere.** N6 aplicado. Ver R3-I5 sobre "cerca de 9 vezes" |
| 124 | N × 0,4 a 0,7 KB: cerca de 4 a 7 MB (N = 10 mil) e 75 a 145 MB (N = 200 mil) | **Conta:** 373 × 10⁴ = 3,7 MB; 726 × 10⁴ = 7,3 MB; 373 × 2·10⁵ = 74,6 MB; 726 × 2·10⁵ = 145,2 MB. **Sonda nova:** marca nunca regravada, `r3-sonda-marca-intocada.log`: 494 B depois de uma reconstrução e 615 B depois de duas ou mais, dentro da faixa | **Confere** |
| 125 (N2) | +1 escrita por documento; nenhum commit acima de 500; até 1,79 vez mais chamadas em workspaces diversos; até 2,85 leituras por documento no adversário; capacidade em 24 h de 20% a 28% menor (716 mil → 516 mil); recomeço grava as âncoras com outro `g` | **Sonda R3:** `r3-sonda-orcamento-pagina.log`, idêntico ao da rodada 1. Diverso/500: 52 → 93 chamadas (1,79); adversário/500: 2,85; maior commit 500. **Código:** orçamento com as âncoras (`rebuild.ts:804-806`), âncora por `merge` (`:1266-1276`), novo `rebuildId` no recomeço (`:373`). **Capacidade:** 24 h (`:206`) × 100 chamadas/h (`:1678-1682`) = 2.400 chamadas. Diverso/300: 2.400 × 20.000/67 ≈ 716 mil → 2.400 × 20.000/93 ≈ 516 mil (−28%). Adversário: 516 mil → 414 mil (−20%) | **Confere.** N2 aplicado. Ver R3-I4 sobre o tamanho de página |
| 126 | R = Σmax(1, achados) + 2Q + 3(m + u) + 2; 25, 120 e 446; R2A 5, 22 e 108 | **Código:** lotes de 30 lidos em sequência (`src/modules/transactions/api.ts:149`, `:170-179`); um `transaction.get` por documento (`projectionReads.ts:31-32`); teto recusado antes de ler (`:26-28`). **Conta:** (3,3): 3 + 2 + 18 + 2 = 25; (12,20): 20 + 2 + 96 + 2 = 120; (12,100): 100 + 8 + 336 + 2 = 446; u + 2Q = 5, 22 e 108 | **Confere** |
| 127 | 5 tentativas × 3 novas tentativas do React Query: cerca de 7,2 mil | **Código:** `maxAttempts: 5` (`projectionReads.ts:48`). `useTransactionsByIdsWith` (`incomeReads.ts:81-88`) e o `QueryClient` (`src/App.tsx:116-123`) não definem `retry`, e o padrão do `@tanstack/query-core` 5.0.0 é 3 no cliente (`retryer.js:91`). **Conta:** 4 × (108 + 5 × 338) = 7.192 | **Confere** |
| 128 | 34 na primeira hora, depois 31/h (725 em 24 h); cerca de 775 leituras/h no PF típico e 13,8 mil/h no teto | **Sonda R3:** `r3-sonda-agendador.log`, idêntico ao da rodada 1, com os orçamentos lidos do código (`queryKeys.ts:39-43`; `liveRefresh.ts:12-14`). **Conta:** 31 × 25 = 775; 31 × 446 = 13.826 | **Confere** |
| 129 (N3) | Até 35/h pelo agendador da prova, mais 1 por liberação da base (escuta até 35/h, mutação até 8/h): até 78/h, cerca de 34,8 mil/h no teto | **Código:** o agendador da prova usa o orçamento das bases (`useIncomeEstimateWith.ts:363-370`), 35/h por base (`queryKeys.ts:25`, `:39-43`); mutação 8/h por base (`:27`, `:53-57`); a liberação relê a prova (`basisSync.ts:420-429`). **Conta:** 78 × 446 = 34.788. **Sonda nova:** com receitas que só crescem, a liberação espera as bases, e houve 0 prova sem releitura de base (`r3-sonda-liberacao.log`, 2º cenário) | **Confere no cenário que a linha nomeia** (uma base, receitas que só crescem). **Não é teto** para a projeção que diverge e volta (R3-M1) nem para as duas bases da janela de 12 meses fora de passo (R3-I2) |
| 130 | Dashboard: 2 a 3 chamadas de `getFinancialReport` a mais por nova assinatura | **Código:** todo retorno conta, inclusive o primeiro (`hooks.ts:163-172`); a releitura agrupada refaz o mês (`App.tsx:260-262`) e o widget de 30 dias (`ReportsWidget.tsx:22`), mais a releitura encadeada da primeira leitura (`queryKeys.ts:130-131`), dentro do orçamento (`liveRefresh.ts:12-14`) | **Confere** |
| 131 | Nenhuma consulta, escuta ou índice composto novo | **Diff** `f8267922` → `377c2f3f`: o único `onSnapshot(` adicionado é a reescrita da escuta existente do Dashboard (4 chamadas nas duas árvores). Índices compostos: 72 → 72. *Overrides*: 20 → 26, as 6 isenções | **Confere** |
| 137-139 | Por mês: PF 8,8 mil (R2A 1,8 mil); PJ 2,46 milhões (R2A 370 mil), 930 chamadas, 9,3 h, 278 mil leituras e 200 mil escritas (R2A 670 chamadas e 200 mil leituras); PJ no teto 13,7 milhões (R2A 3,3 milhões) | **PF:** 176 × 2 × 25 = 8.800 (R2A 1.760). **PJ:** 5 × 176 × 35 × R(12,10) = 30.800 × 80 = 2.464.000 (R2A × 12 = 369.600). **Reconstrução PJ:** 10 × 93 = 930 chamadas; 930/100 = 9,3 h; 1,39 × 2·10⁵ = 278 mil (R2A: 670 e 200 mil). **PJ no teto:** 30.800 × 446 = 13.736.800 (R2A × 108 = 3.326.400). **PF, reconstrução:** ⌈10⁴/300⌉ = 34 | **Confere.** As taxas por hora são premissas declaradas |
| 142 | "A prova custa de 4 a 5 vezes cada releitura dependente da R2A" | **Razões:** 25/5 = 5,0; 120/22 = 5,5; 446/108 = 4,1; PJ 80/12 = 6,7; com m = 12 e u = 3, 52/5 = 10,4 | **Impreciso** (R3-I1). Os valores absolutos estão certos |
| 143 (N5) | Teto por tentativa de 13 meses e 100 marcas, testado no Emulator; entradas limitadas antes: até 50 desconsideradas, pelas Rules, e janela de até 12 meses. "Também tem limite por hora, pelo orçamento dos agendadores" | **Teste:** "tetos do cliente" (`tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs:301-322`), ok 8 em 184 ms no `verify:all`. **Limites das entradas:** `firestore.rules:1279` (≤ 50) e `:1273` (1, 3, 6 ou 12); janela (`estimate.ts:110-124`, `contract.ts:48`); no máximo um espelho por desconsiderada (`receivableReversal.ts:96-105`), logo u ≤ 100. **Última frase:** contradita pelo código (`basisSync.ts:440-446`, `incomeReads.ts:21-30`) e pela sonda nova | **As duas primeiras frases conferem.** N5 aplicado como texto; o teste de comportamento continua ausente, INFO herdado. **A última frase não confere** (R3-M1) |
| 144 | O estado pendente que não se resolve não tem limite no tempo; está no plano (RR-R3-01); sinal na P7 | `PRODUCTION_READINESS_PLAN.md:5182-5188` | **Confere** |

## O §3 e o custo

- **O que mudou:** a linha 37 acrescenta uma pré-condição de ordem ao passo da P8 ("depois que o gatilho aplicou todas as entregas do lançamento, apagar a marca e reconstruir"). `PRIVACY_LGPD.md:153` a detalha: a marca de entrega `applied` para cada escrita e a cadeia sem pendência.
- **Nenhum número do §9 muda.** O passo continua sendo 1 exclusão por id mais uma reconstrução, com custo já na linha 125.
- **Para a P8 (INFO):** a conferência da ordem é de um fluxo ainda não implementado. Ela pode ser feita por leitura por id (a marca: cadeia sem pendência e nó com a impressão atual) ou por igualdade em `cash_period_events.entityId`. Essa coleção só isenta `expiresAt`, com TTL (`firestore.indexes.json:1377-1381`), então o índice automático de `entityId` existe. A P8 precisa limitar essa leitura quando implementar o fluxo.

## Achados

### Bloqueante

**R3-M1. MEDIUM, só de documento. O §9 declara um teto por hora "pelo orçamento dos agendadores" que o código não impõe à releitura da prova na liberação por convergência.**

**Mecanismo** (árvore `377c2f3f`):

- A cada retorno do servidor, a escuta da janela compara a projeção com a base (`basisSync.ts:508-530`).
  - Na divergência, pede a releitura das bases (`:450-453`, `:407-419`). O agendador de cada base tem orçamento.
  - Se a projeção volta ao valor da base antes da releitura, `divergenceRefresh` dá `converged`. A sincronização zera as contagens (`basisRefresh.ts:70-96`) e libera na hora (`basisSync.ts:443-446`).
- A liberação chama `refreshIncomeReads` (`basisSync.ts:428`), que invalida e relê a leitura por id sem agendador (`incomeReads.ts:21-30`). Isso refaz a prova inteira: `readExcludedIncome` e `readProjectionMarks` (`useIncomeEstimateWith.ts:221-227`).
- O pedido seguinte não gasta orçamento para liberar. O orçamento só segura a releitura das bases, e essa nem chega a acontecer: o agrupamento de 5 s recomeça a cada mudança.

**Medido** com a estimativa real (`useIncomeEstimateWith`) da árvore congelada e dependências em memória, no padrão do harness do repositório. O relógio dos agendadores ficou parado, então nenhum agendador disparou. Sonda em `sondas/sonda-r3-liberacao.test.mts`, log em `logs/r3-sonda-liberacao.log`.

| Cenário (20 ciclos, janela de 3 meses, 2 desconsideradas) | Provas | Leituras por id | Releituras de base |
| --- | --- | --- | --- |
| Diverge e volta (receita lançada e anulada antes de as bases relerem) | **20** | 20 | **0** |
| Só diverge (receitas que só crescem) | 0 | 0 | 0 |

**Limite real** (estimativa, premissas P1 a P3):

- **Por volta:** 1 prova para cada estimativa montada que lê o workspace-fonte com desconsideradas. São até 446 leituras no teto e 25 no PF típico; na R2A, 108 e 5.
- **Por escrita:** cada volta exige pelo menos duas escritas em lançamentos do mês da janela, uma que diverge e outra que volta. Os limites do servidor, por ator e workspace, são:
  - 120 criações a cada 10 min (`createTransaction.ts:98-102`);
  - 120 correções, confirmações ou anulações a cada 10 min (`mutateTransaction.ts:118-127`).
- **Por hora, por membro que escreve:** até cerca de 720 voltas. No teto, cerca de 321 mil leituras/h por estimativa montada (R2A: cerca de 78 mil); no PF típico, cerca de 18 mil.
- **Uso normal:** um lançamento desfeito em segundos é raro; o teto acima é o de uma sequência deliberada.
- **Anterior à R3:** o caminho já existia na R1 e na R2A. A R3 multiplica o custo de cada volta por 4 a 10.

**Por que bloqueia.**

- A política da skill dá FAIL quando o custo declarado depende de premissa não declarada. Aqui, a premissa é que a projeção não diverge e volta antes de as bases relerem.
- O §9 é o modelo canônico (B03-03), e a frase da linha 143 afirma um limite que o código desmente. É a mesma natureza do M1 da rodada 1.
- O custo real tem limite, nos limites de escrita do servidor, que estão implementados. Por isso o risco de desenho é LOW e aceitável com registro, como o L3.

**Mudança exigida** (só documento; nenhum código, teste ou configuração):

1. **Nova linha no §9**, depois da linha 129, por exemplo:

   > | Prova, projeção que diverge e volta | Quando a projeção de um mês da janela diverge da base e volta antes de as bases relerem (receita lançada e anulada, ou edição desfeita), a sincronização libera e relê a prova na hora, sem agendador: 1 prova por volta, por estimativa montada com desconsideradas (até 446 leituras no teto). O limite por hora vem das escritas: cada volta exige pelo menos 2, e cada membro tem até 120 lançamentos e 120 correções ou anulações a cada 10 min. São até cerca de 720 voltas/h por membro que escreve, cerca de 321 mil leituras/h no teto (R2A: cerca de 78 mil) | Medido (gancho real: 20 voltas, 20 provas, nenhuma releitura de base); leituras estimadas |

2. **Linha 143**, trocar a última frase por:

   > Por hora, as releituras pelo agendador da prova e as liberações que dependem de releitura das bases têm o orçamento dos agendadores; a liberação por volta da projeção não tem orçamento no cliente e fica limitada pela frequência de escrita dos membros.

3. **§20.18:**
   - na linha 5143, a mesma ressalva;
   - no RR-R3-09 (`:5206-5209`), o custo da liberação por volta, com o limite pelas escritas.

**Recomendação para a P7** (não exigida aqui): passar essa releitura pelo orçamento do agendador da prova, junto com a condição de parada do L3.

### Não bloqueantes (INFO)

- **R3-I1.** Linha 142: "de 4 a 5 vezes" vale para os três casos de referência, que vão de 4,1 a 5,5. O cenário PJ da própria seção dá 6,7, e m = 12 com u = 3 dá 10,4. **Sugestão:** "de cerca de 4 a 7 vezes nos casos desta seção; a razão cresce com m e cai com u".
- **R3-I2** (leitura do código, não medido). Os 78/h da linha 129 supõem uma base, ou as duas bases da janela de 12 meses relidas em passo.
  - **Mecanismo:** `followReads` libera quando nenhuma base está em leitura e a receita mudou (`basisSync.ts:472-492`). Ele não espera as bases fora de passo, que só seguram a exibição (`:583-589`, `:597`).
  - **Efeito:** se a releitura de uma base chega antes de a outra começar (orçamentos defasados, ou a série dividida com a prévia de Configurações), cada base pode liberar sozinha. O limite fica em até 2 × (35 + 8) = 86 liberações/h, ou seja, até cerca de 121/h, cerca de 54 mil leituras/h no teto.
  - **Sugestão:** qualificar a linha 129 com "com as bases em passo".
- **R3-I3.** A §20.18 (`:5139`) diz "de 373 B a 599 B no caso típico (com a poda)", mas a poda só acontece quando o gatilho regrava a marca.
  - **Medido:** uma marca nunca regravada fica em 494 B depois de uma reconstrução e em 615 B depois de duas ou mais (`r3-sonda-marca-intocada.log`). Uma marca tocada durante a preparação fica em 726 B até a próxima regravação.
  - A linha de armazenamento (`:5140`, 4 a 7 MB) está certa. **Sugestão:** "de 373 B a 726 B".
- **R3-I4.** A queda de capacidade de 20% a 28% (linha 125; `:5141`) usa a página padrão de 300 (`rebuild.ts:124`).
  - Com a página máxima de 500, a R2A diversa faria cerca de 923 mil em 24 h, e a queda seria de cerca de 44%.
  - A capacidade absoluta da R3, 516 mil e 9,3 h para 200 mil lançamentos, é a mesma com 300 ou 500, e é ela que vale para o DR. **Sugestão:** escrever "na página padrão (300)".
- **R3-I5.** Linha 123: "cerca de 9 vezes o documento" vale para os casos típicos (8,8 e 9,1 vezes). No pior caso, são 2,9 vezes (`r3-sonda-tamanho-marca.log`). É um valor contrafactual (sem isenção) e não pede ação.
- **R3-I6.** `§20.18:5142` dá "446 no teto (13 meses e 100 marcas)", mas 446 é o caso (12, 100). O 13 é o teto do código (`projectionReads.ts:9`), e a janela não passa de 12 (`estimate.ts:110-124`).
- **N5, herdado.** O comportamento acima do teto (101 ids ou 14 meses) continua só com guarda estática (`tests/unit/work-time-guard.test.ts:333`). O risco é baixo, porque as entradas já chegam limitadas.

## Estado das sugestões da rodada 2

| ID | Estado | Onde |
| --- | --- | --- |
| N1 | **Aplicado, correto** | Desenho, linha 122 |
| N2 | **Aplicado, correto** | Linha 125 |
| N3 | **Aplicado como escrevi, mas a minha sugestão estava incompleta** | Linha 129; ver R3-M1 e R3-I2 |
| N4 | **Resolvido.** A §20.18 está no plano (`:5086`), e o custo está em `:5137-5144`. A §4 de `testes-e-resultados.md` foi preenchida (nenhum `[[VERIFY]]` fora de citações de pareceres antigos). As três afirmações das respostas (F-06, M1 e INFO-03) agora são verdadeiras | Plano; `testes-e-resultados.md:104-118` |
| N5 | **Aplicado como texto, correto.** O u ≤ 100 decorre de k ≤ 50 e de um espelho por desconsiderada. O teste de comportamento continua ausente (INFO) | Linha 143 |
| N6 | **Aplicado, correto**, também na condição de implantação | Linha 123; `§20.18:5147` |
| N7 | **Confere** | `§20.18:5140` |

## Evidência por item do checklist

Só listo os itens que mudam desde a rodada 2; os demais seguem PASS ou N/A, como nas rodadas 1 e 2.

| # | Item | Rodada 2 | Rodada 3 | Evidência |
| --- | --- | --- | --- | --- |
| 19 | Fórmulas e premissas por ação e período | PASS | **FAIL** | R3-M1: o teto por hora declarado depende de premissa não declarada, e falta o custo por volta da projeção |
| 20 | Cardinalidades realistas e altas | PASS | PASS | Os cenários por mês usam taxas de releitura declaradas como premissa. A volta da projeção entra pela correção do R3-M1 |
| 21 | Rules, novas tentativas, offline, índice | PASS | PASS | P2, P3, 5 × 3 tentativas e índices isentos, conferidos de novo. Reconexão da escuta: o primeiro retorno compara de novo; não há liberação sem pedido (`basisSync.ts:508-530`, `:440-446`) |
| 22 | Sem limpeza manual nem otimização futura | PASS com L3 aceito | **PASS com L3 aceito e o risco do R3-M1 a registrar** | O custo da volta tem limite implementado no servidor (limites de escrita); falta só o registro |
| 12 | Fan-out por ação | PASS | PASS | Por escrita num mês da janela: no máximo 1 prova por estimativa montada que observa o workspace (medido) |

## Modelo de custo: o que muda desde a rodada 2

**Sem mudança** (medido de novo nesta rodada, com saída idêntica):

- o gatilho;
- o tamanho da marca e as isenções;
- a página da reconstrução;
- o agendador.

**Novo, medido:** marca nunca regravada com 494 B depois de 1 reconstrução e 615 B depois de 2 ou mais. Fica dentro da faixa por workspace.

**Novo, medido:** a liberação por volta da projeção relê a prova sem orçamento, 1 por volta. Na estimativa (P1 a P3):

| Unidade | Custo |
| --- | --- |
| Por volta, por estimativa montada | 25 a 446 leituras |
| Por membro que escreve, por hora | até cerca de 720 voltas |
| No teto | cerca de 321 mil leituras/h por estimativa montada (R2A: cerca de 78 mil) |

**Novo, por leitura do código:** com as duas bases da janela de 12 meses fora de passo, até cerca de 121 releituras/h, em vez de 78/h.

## Verificação

Logs e sondas desta rodada em `<scratchpad>/p5f1r3/revisoes/escala-custo/logs/` (`r3-*`) e `.../sondas/` (`sonda-r3-*`). Os sha-256 estão em `hashes-rodada-3.txt`.

| Comando | Resultado |
| --- | --- |
| `git archive 377c2f3f functions/src …` para um sandbox meu, com `node_modules` ligado só para leitura; `tsc -p .` | exit 0 (`r3-tsc-build.log`, vazio). A `lib` nova é idêntica à da rodada 2 (`diff -rq`, sem `.map`) |
| Comparação dos 331 arquivos do `sandbox-377c` com os blobs de `377c2f3f` | 0 divergência |
| `node sondas/sonda-tamanho-marca.cjs`, `sonda-r2-poda-isencao.cjs`, `sonda-custo-gatilho.cjs` (com `sandbox-base`) e `sonda-orcamento-pagina.cjs` (com `sandbox-base`), sobre a compilação nova | exit 0 nas quatro; saída **idêntica byte a byte** aos logs das rodadas 1 e 2 |
| `node --experimental-strip-types sondas/sonda-agendador.mjs`, sobre `src/` extraído de `377c2f3f` | exit 0; idêntico ao log da rodada 1 |
| `node sondas/sonda-r3-marca-intocada.cjs` (nova) | 373, 494, 615, 615 e 615 B |
| `node --experimental-strip-types --test sondas/sonda-r3-liberacao.test.mts` (nova, com o gancho real e React Query real, sem rede) | 1/1. Voltas: 20 provas e 0 releitura de base; só divergência: 0 prova |
| `git diff f8267922 377c2f3f` (consultas, escutas e índices) | Nenhum `onSnapshot` novo, 72 → 72 compostos e as 6 isenções novas |

**Emulator.** Não executei: não foi indispensável. O código não mudou desde `377c2f3f`, e a evidência de Emulator deste gate continua sendo o `verify:all` da árvore congelada.

- Log: `p5f1r3/logs/verify-all-final.log`, sha-256 `b97c2f68…`, com `test:integration:emulator` terminando em código 0 (linha 36152).
- "Tetos do cliente": ok 8, 184 ms (linhas 36047-36049).
- A sonda nova não usa Firebase.
- Não usei porta nem `functions/lib` do W, e não alterei nada no W.

## Condição de reconferência

- **Para o PASS:** aplicar o R3-M1 (§9, linhas 129 e 143, e §20.18, linhas 5143 e 5206-5209). Eu reconfiro só esse diff de `docs/`, sem nova execução, se o código continuar `377c2f3f`.
  - **Nota de processo:** mudar o desenho aciona de novo a condição do parecer de privacidade (`privacidade/PARECER-RODADA-2.md:19`). O diff seria só do §9, sem conteúdo de privacidade.
  - R3-I1 a R3-I6 podem entrar na mesma edição, mas não são condição.
- **As mudanças previstas não exigem reconferência minha:**
  - as cópias dos pareceres da rodada 3 em `revisoes/`;
  - os marcadores de `revisoes/LEIAME.md` e de `matriz-requisitos.md`;
  - as linhas de revisão e do gate da §20.18, a linha da P5, o histórico e os marcadores de veredito.

  Nenhuma toca código, configuração, §3, §4 ou §9 do desenho, nem as linhas de custo e risco da §20.18. A linha da §20.18 sobre esta revisão (`:5172`) precisa dizer "FAIL na rodada 3 (R3-M1)" até a correção.
- **Exigem reconferência completa:**
  - qualquer diferença fora de `docs/` em relação a `377c2f3f` (`git diff --quiet 377c2f3f <árvore> -- . ':(exclude)docs'` diferente de 0);
  - mudança de `firestore.indexes.json`;
  - mudança nos §3, §4 ou §9 do desenho além do R3-M1;
  - mudança nas linhas de custo e risco da §20.18 (`:5137-5144`, `:5182-5188`, `:5206-5209`) além do R3-M1.

## Riscos residuais

- **R3-M1, depois de corrigido o texto (LOW):** a volta da projeção relê a prova sem orçamento no cliente, até cerca de 720 vezes por hora por membro que escreve. No uso normal é raro. O limite são as escritas do servidor. Recomendação para a P7: orçamento nessa releitura.
- **L3 e RR-R3-01 (inalterados):** o estado pendente que não se resolve relê 31 vezes por hora, até cerca de 13,8 mil leituras/h no teto, sem condição de parada até a P7.
- **L2 e RR-R3-09 (inalterados):** reconstrução de 20% a 28% menos capaz na página padrão. Um workspace de 200 mil lançamentos leva cerca de 9,3 h no limite de chamadas.
- **N6 (inalterado):** as isenções só valem depois da implantação de `firestore.indexes.json`, que não cabe a agentes.
- **P3 (inalterado):** não está verificado que o `verify` do commit da transação só de leitura não seja cobrado como escrita. Se for, são +m+u escritas por tentativa.
