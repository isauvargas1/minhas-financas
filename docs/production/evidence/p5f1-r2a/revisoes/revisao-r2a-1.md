# Revisão independente — P5-F.1-R2A

**Data:** 2026-11-06 · **Revisor:** independente, somente leitura · **Veredito global: FAIL**

**Árvores revisadas.**
- Base: P5-F.1-R1, `08d8c5a2f5141f19d06968737c5f7fdc71c4a45f` (extraída por `git archive` em `saida/r1`).
- R2A: `5a7dad57aa9d5a28c118c0a2008549631d41d3cb` (a cópia `ARVORE`; conferi os 2.816 arquivos da cópia contra os blobs do objeto: todos iguais).
- Final do delta (adendo): `cf9cb2a94a9ca270032dd25f2f00c4aad78b5d9d` (extraída por `git archive` em `saida/final`; igual à cópia 5a7dad57 com `delta-5a7dad57-para-cf9cb2a9.diff` aplicado, e o diff fornecido é igual ao `git diff` entre os objetos).

**O que foi executado.** Só `node --experimental-strip-types` (testes de unidade e sondas) nas cópias e em `saida/`. Nada no `WORKTREE`, nem em `mutantes-arvore/`. Sem E2E, Emulator, `npm run dev`/`preview`, rede, Firebase ou segredos. As cópias instrumentadas (`saida/instr`, de 5a7dad57, e `saida/instr-final`, de cf9cb2a9) são o `calendar.ts` da árvore com **uma linha de `export` acrescentada no fim** (conferido por `diff`), para as sondas lerem os internos (`planDayWith`, `neighborWindowsOn`).

**Testes de unidade.** Na cópia 5a7dad57: calendar 37/37, estimate 24/24, guard 17/17, preference 16/16. Na cópia cf9cb2a9: calendar 38/38, estimate 24/24, guard 17/17, preference 16/16, consistency 30/30, income-estimate 21/21, calculation 15/15, grammar 5/5 (`logs/unit-*.log.txt`).

---

## Resumo

| Severidade | Achados |
| --- | --- |
| HIGH | **T01** (S01 no início do período: configuração aceita cujas horas dependem da parte trabalhada da jornada reduzida, e acrescentar uma rotina válida **tira horas** da estimativa — regressão sobre a R1) |
| MEDIUM | **T02** (Frente B: a prova escrita não exige o conjunto aplicado exato e se apoia, sem dizer, numa releitura que já existe no cliente) · **T03** (recusa conservadora mais larga que a declarada, frequência sem evidência no pacote, mensagem que afirma uma dependência inexistente) |
| LOW | **T04** (Teorema 3 impreciso com intervalo) · **T05** (pior caso combinado do conferidor, de 1,0 a 1,8 s, não declarado) · **T06** (evidência citada fora do pacote) |
| INFO | **T07** (memória do conferidor: nenhuma mudança de resultado) · **T08** (textos pt-BR) · **T09** (S03 correto) · **T10** (testes anteriores) · **T11** (fatos da proposta B03) · **T12** (escopo) |

| Item | Situação |
| --- | --- |
| B02 (S01) | **Não resolvido** (T01) |
| S03 | **Resolvido** |
| Frente B | **Parcialmente adequada**: a direção (A) é boa, mas a prova precisa de emenda antes da R3 (T02) |
| Global | **FAIL** (B03 aberto; e B02 também, por T01) |

---

## Achados

### T01 — HIGH — S01 continua aberto no início do período da estimativa: a certeza da véspera é calculada fora do período, e o primeiro dia é contado dentro dele

**O defeito.** No primeiro dia do período da estimativa, o dia 1 conta as próprias janelas **sem** descontar a véspera, que fica fora do período (`calendar.ts` em cf9cb2a9, `monthPlan`, `:655`; `estimate.ts:184`, `periodStart: index === 0`). Mas a certeza do dia 1, que decide se o dia 2 desconta o turno inteiro do dia 1, é calculada **descontando** essa véspera de fora (`computeNeighborWindows`, `:420-422`: `most = windowWorkOf(..., followedWindowsOn(calendar, addDays(date, -1)), ...)`).
- Resultado: o dia 1 é "certo" (o máximo com o desconto não passa do limite), mas, no período, a redução **corta** horas dele.
- O dia 2 então desconta o turno inteiro do dia 1 (`planDay`, `:498`, `if (eve.certain) return plan(eve.windows)`), como se ele tivesse acontecido todo.
- O conferidor não vê esse caso: a passada nova (`:924-940`) usa `planDay(calendar, date, eve)` na vista sem período, e a passada do início do período (`:916-922`) só confere o dia 1, e só com janela com intervalo coberta.

**Contraexemplo 1 — o número depende da parte trabalhada** (`sondas/s01-inicio-periodo.mts`, `logs/s01-inicio-periodo-final.log.txt`).
- Rotina `W:-,-,20:00-10:00/0,06:00-02:00/0,00:00-04:00/0,-,-` (quarta 30/09 cobre 06:00–10:00 da quinta). Exceção `R2026-10-01=1000`.
- `calendarAmbiguity(...,'2026-11-06')` = `null`; a estimativa de 1 mês (outubro abre o período) fica `ready`, com 8.800 min.
- No período: 01/10 conta **1.000** de 1.200 min de janela (`applied: ['reduced']`), e 02/10 conta **120** (desconta 00:00–02:00 inteiro).
- Os dois extremos do dia 2 no período são **240** (nada do dia 1) e **120** (o dia 1 inteiro). Conforme onde caíram os 1.000 min, a sexta vale de 120 a 240.
- Sem a janela de quarta, o mesmo par é recusado (`reduced_eve`, 02/10).

**Contraexemplo 2 — monotonia quebrada na janela da estimativa** (`sondas/s01-inicio-periodo-monotonia.mts`, `logs/s01-inicio-periodo-monotonia.log.txt`; `sondas/s01-inicio-periodo-draft.mts`).
- `C`: `W:-,-,20:00-10:00/0,06:00-20:00/0,00:00-04:00/0,-,-`; exceções `R2026-10-01=850;F2026-10-03/2026-10-31`.
- `C′ = C + W:-,-,-,22:00-02:00/0,-,-,-` (uma rotina válida, sem intervalo).
- As duas: `calendarAmbiguity` = `null`, `validateDraft` = `{ ok: true }`, nenhum dia ambíguo, estimativa `ready`.

| Árvore | `C` (01/10 + 02/10 = período) | `C′` | Horas do período | Valor da hora (R$ 10.000,00 em outubro) |
| --- | --- | --- | --- | --- |
| cf9cb2a9 | 840 + 240 = 1.080 | 850 (reduzido) + 120 = **970** | **1.080 → 970 (−110)** | R$ 555,56 → **R$ 618,56** |
| R1 (08d8c5a2) | 840 + 240 = 1.080 | 850 + 240 = 1.090 | 1.080 → 1.090 | R$ 555,56 → R$ 550,46 |

- É uma **regressão** da R2A: a R1 era monótona nesse par.
- A busca dirigida da família (`sondas/s01-inicio-periodo-busca.mts`, 20.000 amostras, `logs/s01-inicio-periodo-busca-final.log.txt`) acha **385 violações de monotonia em 12.474 pares** com cálculo seguro e **1.809 configurações aceitas** em que o dia 2 do período depende da parte trabalhada do dia 1.
- As buscas genéricas não chegam lá:
  - as minhas deram 0 violações em 706.044 pares, na busca genérica e na dirigida com a véspera no meio ou no fim do mês (`logs/agregado-solidez-monotonia.txt`);
  - com a véspera no primeiro dia do mês, mas sem forçar a véspera de fora cruzando a janela, foram 0 em 21.784 (`logs/s01-monotonia-dirigida2-777.log.txt`);
  - a propriedade da R2A (agosto a outubro) também passa.

**O que isso desmente na documentação** (`s01-vespera-reduzida.md`):
- §6, caso 2: "p certa em C′ … p não morde em C′, então conta pela fórmula do dia que segue a rotina" é falso quando `p` abre o período: `p` é certa pela vista sem período, mas no período morde.
- §4 (Teorema 3) e §7 (o conferidor "acha todo dia assim") não cobrem o segundo dia do período.
- `matriz-antes-depois.md` e o plano (§20.17) declaram o B02 resolvido.

**Correção sugerida** (local, no motor):
- Calcular a certeza do dia 1 do jeito que o dia 1 é contado. Duas opções:
  - na vista do período, o dia 2 lê o dia 1 com `neighborWindowsOn` sem descontar a véspera de fora (um parâmetro vindo de `monthPlan`/`planDay`);
  - ou, mais simples e conservador, calcular o máximo **sem nenhum desconto da véspera** (bruto). Isso deixa a certeza monótona nas rotinas e simplifica o Teorema 2, mas passa a recusar o caso "domingo 22:00–06:00 sobre o turno de 24 h de segunda", que o teste da R2A hoje aceita com 60 min. Por isso a primeira opção preserva mais.
- No conferidor: para cada mês de `[first, last]` (início possível do período), conferir o dia 2 com o dia 1 no modo do período quando o dia 1 tem jornada reduzida, sem a precondição `scan.covered`.
- Testes: os dois contraexemplos acima como regressão, e uma propriedade com `p` no primeiro dia do período e a véspera de fora cruzando a janela de `p`.

### T02 — MEDIUM — Frente B: a prova escrita para a alternativa A não basta sozinha e se apoia, sem dizer, numa releitura que já existe no cliente

**O texto** (`PROPOSTA-ARQUITETURAL-B03-v2.md`, §5.A, "No cliente"):
- **A condição 2 exige:**
  - a marca não estar em `broken`;
  - "o prefixo resolvido é igual a `v`" (`:186`);
  - `updatedAt` da escuta `>= monthCommits[m]`.
- **A condição 2 não exige:**
  - que `pending` esteja vazio;
  - que a leitura de `T` e da marca seja posterior às versões atuais da janela.
- **A justificativa** (`:190`, `:194`) é que "as duas só avançam: uma divergência leva a ler de novo, nunca a uma prova falsa", e que, com o prefixo anterior, "a projeção ainda vê `T@v`". **Isso é falso como argumento:** os eventos em `pending` são "aplicados fora de ordem" (`:163`), então já estão em `P` sem fazer parte do prefixo.
- A própria condição de consistência da §3 ("exatamente os da cadeia até `v`") não é imposta pela regra do cliente.

**O contraexemplo da regra escrita** (`sondas/b03-modelo.mts`, `logs/b03-modelo.log.txt`). O modelo executável aplica só a regra 4 atual e a nova regra 5, como estão no texto:

1. `T`, desconsiderada, é lida em `v1`: março, R$ 100,00.
2. Outra sessão muda a data para fevereiro (`e2`, `v2`) e o valor para R$ 300,00 (`e3`, `v3`).
3. O gatilho entrega `e3` antes de `e2`, que fica em retentativa:
   - `P(fevereiro)` ganha +R$ 200,00;
   - março não muda;
   - a marca fica `appliedVersion = v1` e `pending = {v2: v3}`.
4. A regra 4 só relê quando muda um mês **com** desconsiderada, que aqui é março (`consistency.ts:239-242`; `useIncomeEstimateWith.ts:404-410`).
5. A prova dá **`true`**, com a marca antiga e também com a marca relida. A estimativa fica **R$ 1.400,00 contra R$ 1.200,00 (+R$ 200,00)**.
6. A regra corrigida dá `false`. Ela exige `pending` vazio e a leitura posterior às versões de todos os meses da janela.

**Por que hoje isso não chega à tela.** No cliente atual, quando a receita da base muda, a sincronização relê as leituras de receitas, inclusive a leitura por id das desconsideradas:
- liberação: `basisSync.ts:421-429`, com `refreshIncomeReads` (`incomeReads.ts:16`, `:27-30`);
- acompanhamento das leituras: `basisSync.ts:476-490`.

Com isso, `T` seria relida em `v3` depois de `e3`, e a prova escrita falharia, como deve. Não consegui montar uma prova falsa com essa releitura no caminho. Se as receitas por mês da janela não mudam, a estimativa sai igual à de um estado consistente.

**O problema de desenho.** A proposta não declara essa dependência, não a exige da R3 e a justifica com um argumento errado. Uma implementação que siga só o texto, ou uma mudança futura na sincronização, abre a prova falsa.

**A condição 1 (reconstrução)** tem a mesma forma. Ela pede `v <= rebuildCutoff` e a escuta posterior à publicação, sem conferir se a marca tem eventos de `T` aplicados depois do corte. Hoje, a mesma releitura e a regra 4 a protegem.

**Os testes da §8 não pegariam uma regressão:**
- o cenário "Fora de ordem" é no mesmo mês, e lá a regra 4 relê;
- o oráculo da propriedade "Permutações" ("prova verdadeira ⇔ prefixo aplicado") é satisfeito pela leitura velha, porque o prefixo é igual à versão lida.

**Consequência:**
- A recomendação **atende só em parte o critério 2 do parecer** ("Demonstrar quais escritas da fonte foram aplicadas ao agregado; … eventos fora de ordem"): a marca registra o que entrou, mas a prova descrita não exige o conjunto exato.
- A′ e C herdam a mesma prova.

**Correção sugerida** (no desenho, antes de autorizar a R3):
1. Condição 2: conjunto aplicado igual à cadeia até `v`, sem pendência de `T`.
2. Requisito explícito: as leituras de `T` e das marcas são refeitas a cada mudança de versão de **qualquer** mês da janela (ou as marcas são escutadas), sem depender só da comparação de receitas.
3. Condição 1: nenhum evento de `T` aplicado depois do corte.
4. Na §8: o cenário "fora de ordem + mudança de mês + leitura velha", com o oráculo "prova verdadeira ⇒ estimativa igual ao valor exato", e um teste que falhe se a releitura da sincronização for retirada.

### T03 — MEDIUM — a recusa conservadora é mais larga do que a §5 declara, a frequência não tem evidência no pacote, e a mensagem afirma uma dependência que não existe

**O que a documentação diz** (`s01-vespera-reduzida.md` §5 e o plano, RR-R2A-01):
- sem minutos sem horário nem exceções no dia seguinte, o motor recusa "**exatamente quando** a redução morde e X tem medida positiva";
- a recusa conservadora "exige minutos sem horário **perto de 24 h**" e é "rara";
- a frequência medida estaria em `testes-e-resultados.md`, que **não está no pacote**.

**Contraexemplos** (`sondas/s01-conservadora.mts`, `logs/s01-conservadora-final.log.txt`). Nos três casos, toda parte fisicamente possível da véspera dá o mesmo número no dia seguinte, e a configuração é recusada com a mensagem `reduced_eve`:

| Caso | Configuração | Motor | Valor fisicamente único |
| --- | --- | --- | --- |
| A | noturno 19:00–07:00 reduzido a 6 h; terça 07:00–23:00 (16 h) com **2 h** de hora extra | recusa | 1.080 (com 1 h de hora extra, aceita com 1.020) |
| B | domingo 20:00–08:00 e segunda 06:00–02:00, ambos reduzidos a 1.100 min; terça 00:00–04:00 | recusa | 120. Nenhuma redução corta: a segunda conta 1.080 = a rotina inteira, e o próprio motor dá `applied: []` para ela. Sem a redução de domingo (B0), é aceita com 120 |
| C | duas reduções seguidas que cortam: segunda 20:00–08:00 com 1 h, terça 06:00–18:00 com 10 h 50 | recusa | 650 |

- **O caso B mostra a causa.** `computeNeighborWindows` (`:420`) só desconta a véspera que **segue** a rotina. A antevéspera reduzida, mas certa, não é descontada, e o máximo da segunda (1.200 > 1.100) a faz "incerta".
- **A mensagem é falsa em B.** Ela diz "não se sabe que parte do horário que passa da meia-noite (Rotina 1) foi trabalhada, e as horas de terça-feira … dependem disso", mas a parte é conhecida: tudo.
- **Frequência nas minhas sondas.** Num gerador adversarial, que não representa o uso real, 8,8% das recusas pela véspera foram conservadoras (11.896 de 134.889 pares). Quase todas tinham minutos sem horário ou exceção no dia seguinte (`logs/agregado-solidez-monotonia.txt`).
- **Avaliação.** A recusa é uma opção segura que o parecer admite ("recusa explícita"). Mas a declaração do alcance é inexata, a evidência da frequência não está no pacote, e a mensagem "clara" exigida pelo pedido afirma um fato falso nesses casos.

**Correção sugerida:**
- descontar também a véspera reduzida **certa** no máximo, por recursão com a memória de cf9cb2a9 (isso elimina B);
- reescrever a §5 com as três fontes (teto com hora extra comum, redução no próprio dia seguinte e reduções seguidas);
- anexar a medição da frequência;
- se a recusa conservadora ficar, a mensagem pode dizer que "a jornada reduzida não permite confirmar…" em vez de afirmar que as horas dependem da parte.

### T04 — LOW — Teorema 3: modelo e enunciado imprecisos com intervalo

**O problema:**
- A §2 diz que o trecho trabalhado é "qualquer parte de Wᵢ, de nenhuma a toda", e a §3 diz que (ii) é "todas as janelas de p, ou seja K = ⋃Wᵢ".
- Mas o (ii) do código é `plan(eve.windows)` (`:498-503`), com o intervalo da véspera posto pela convenção de `occupancyPieces` (`:273-281`). Isso não é `K = ⋃Wᵢ`.
- Para `K` que inclui minutos de intervalo, o valor muda: 543 divergências em 260.000 configurações. Para partes fisicamente possíveis, isto é, até `R` minutos e fora do intervalo, são **0** divergências em 6.846.581 conferências (`logs/s01-solidez*-*.log.txt`: `docModelMismatch` e `docModelMismatchPhysical`).
- A propriedade de unidade da R2A só usa janelas sem intervalo (`spanSpec`, `breakMinutes: 0`).

**Correção sugerida:**
- enunciar `K ⊆ ⋃(Wᵢ ∖ Bᵢ)` para alguma posição dos intervalos, com `|K| <= R`;
- acrescentar à prova que a convenção maximiza a ocupação do dia civil e o desconto entre as posições do intervalo;
- pôr intervalo na propriedade.

### T05 — LOW — o pior caso combinado do conferidor não está declarado

A sonda `sondas/custo-pior-caso.mts` (`logs/custo-pior-caso.log.txt`, máquina sem carga, ms por chamada) mediu piores casos válidos pela gramática:

| Caso | R1 | 5a7dad57 | cf9cb2a9 |
| --- | --- | --- | --- |
| 3 noturnos e 120 reduções de 366 dias | 0 | 1.082–1.157 | 520–634 |
| janela coberta, 120 × 366 reduções e 40 feriados | 430–510 | 2.055–2.422 | 1.080–1.821 |
| cíclica 27 × 26 de 24 h, janela coberta e reduções | 475–533 | 2.092–2.206 | 1.046–1.366 |

- **O que se afirma:** o adendo diz que a memória levou o pior caso da passada nova de "~1 s para 346–451 ms".
- **O que reproduzi:**
  - só a passada nova cai de 1,1 s para 0,52–0,63 s aqui. É a mesma ordem, e a diferença é compatível com a da máquina;
  - o pior caso **combinado** com a passada dos vizinhos (janela coberta e feriados) fica em 1,0–1,8 s com a memória. Isso é de 2 a 4 vezes o pior caso da R1, e não está declarado.
- **Onde pesa:** `validateDraft` roda a cada mudança do rascunho (`WorkTimeSettingsView.tsx:266`).
- **Ressalva:** não há efeito em valores, e esses casos são extremos.
- **Correção sugerida:** registrar o pior caso medido no RR-R2A-02; opcionalmente, agrupar dias reduzidos de vizinhança idêntica pelo período conjunto, ou adiar (debounce) a conferência.

### T06 — LOW — evidência citada que não está no pacote

- O `LEIAME.md` do rascunho cita `testes-e-resultados.md`, `revisoes/`, `sondas/`, `logs/` e `visual/`. Nenhum veio.
- Por isso não verifiquei:
  - a frequência da recusa conservadora;
  - os logs dos mutantes (34/34 de unidade e 6/6 de E2E);
  - o `verify:all`;
  - a comparação pixel a pixel;
  - as sondas `custo-vespera-reduzida` e `antes-depois-s01`.
- Refiz o que pude:
  - os testes de unidade;
  - a tabela antes × depois: as 10 linhas conferem nas duas árvores (`sondas/antes-depois.mts`, `logs/antes-depois.log.txt`);
  - 28 mutantes de unidade (T09).

### T07 — INFO — a memória do conferidor (cf9cb2a9) não muda resultado

**Diferencial** (`sondas/memo-diferencial.mts`, `logs/memo-diferencial.log.txt`):
- 2.000 configurações × 3 datas = 6.000 chamadas, com resultados iguais entre 5a7dad57 e cf9cb2a9;
- `monthPlan` igual antes e depois de uma chamada.

**Reentrância e exceção:**
- uma chamada aninhada por um *getter* (`calendarAmbiguity` e `dayPlan` de outro calendário no meio da chamada) devolve o mesmo resultado, e a memória de fora é restaurada;
- uma exceção injetada no meio da chamada restaura a memória (`finally`). Depois disso, o mesmo objeto, com a lista mudada, é conferido do zero: `null`, e a terça volta a 120.

**Leitura de código:**
- nenhum objeto guardado é mutado, só listas novas (`mergeIntervals`, `windowWorkOf`, `computeFlags`);
- as chaves (data) e a identidade do objeto bastam, porque `flagsOf` e `computeNeighborWindows` só dependem do calendário e da data;
- sem `await` dentro da chamada.

**Observações:**
- O cabeçalho chama o módulo de "PURO", mas agora há estado mutável de módulo. O efeito é invisível; vale anotar.
- O teste novo não exercita a conferência de identidade: os mutantes M26 e M28, que a tiram, **sobrevivem** (anexo). São equivalentes fora da reentrância, então é uma lacuna de teste da guarda defensiva, sem efeito em valores.

### T08 — INFO — textos em pt-BR

- `messages.ts:35`: "Em algum dia do período, **a véspera** tem jornada reduzida…" fica sem referente. Sugestão: "Em algum dia do período, o dia anterior tem jornada reduzida num horário que passa da meia-noite…".
- `draft.ts:394-395`: a mensagem está correta e clara nos casos necessários. Nos conservadores, ver T03.
- O nome acessível no calendário de exceções está correto e só em texto oculto. O aviso fica no elemento que já existia (`work-time-calendar-ambiguity`), sem mudança visual.

### T09 — INFO — S03 resolvido

**A extração para `routineModels.ts` preserva o comportamento, linha a linha:**
- `modelOf`, `routineOf`, `routinesKey` e o tipo do resultado são idênticos;
- `editorResultOf` reproduz o corpo do `useMemo` da R1, com as mesmas dependências;
- `applyTemplate` é o `onClick` da R1;
- só caíram dois `as RoutineEditorResult`, o que é só de tipo.

**A guarda não enfraqueceu:**
- as duas asserções da R1 mudaram para o módulo;
- vieram mais três sobre a fiação da tela e uma que proíbe cópia local.

**Os testes cobrem os dois comportamentos:**
- unidade: a jornada sem aplicar, válida e inválida, dá o resultado da montagem; a digitação inválida dá `edited: true`, com a mensagem;
- E2E, por leitura: `notEditing()` depois do `fill('15:00')`, e "Prévia com as alterações" e `role=alert` depois de apagar o "Fim".

**Mutantes do revisor** (`sondas/mutantes-revisor.py`, `logs/mutantes-revisor.log.txt`, cópia própria de cf9cb2a9): ver a tabela no anexo. O `mut-tplfail` da revisão 5 fica na tela, então só o E2E pega; pela leitura, o passo novo o pega.

### T10 — INFO — testes anteriores

- Na R1 contra cf9cb2a9, só o teste que fixava o RR-R1-03 sumiu. Ele foi substituído por um teste com o contrato novo, o que está registrado no nome do teste, no comentário e no plano (§20.17), e é legítimo.
- As outras linhas removidas são as duas asserções da guarda que foram para o módulo e o `fill('15:00')` do E2E, que ganhou asserções.
- Nenhum `skip`, `only` ou `todo`.
- O `test.setTimeout(240_000)` é de um teste novo e segue a convenção do arquivo; não houve timeout aumentado.

### T11 — INFO — fatos da proposta B03 contra o código

Conferem:
- os escritores e o `updatedAt: serverTimestamp()`, inclusive `cashEntryDocument`, investimentos e recorrentes;
- o gatilho (`transactions.ts:45`, `:305`, `:350`, `:364`, `:389`; `runtimeOptions.ts:144-150`);
- `periods.ts` (`addToPlan`, `cashWritePlanFor`, `writeCashMonth`, `applyCashPeriodWriteOnce` `:1169-1251`, a cerca);
- `rebuild.ts` (`:60-87`, `:1350`, `:1513-1545`, `:1610`);
- as Rules (`:614-617`, `:788-797`, `:800-802`, `isBackendOwnedCollection`);
- as leituras (`basisSync.ts:99`, `:524`; `api.ts:149-175`; `grammar.ts:93`; `useIncomeEstimateWith.ts:64`, `:214`);
- a lacuna do teste fora de ordem.

Imprecisões menores:
- "Lançamento antigo sem marca … ou da próxima escrita": a próxima escrita só avança com `bv <= baselineCutoff`; senão, fica pendente até a reconstrução.
- `list` só com `limit <= 30`: a consulta `in` por id teria de pôr `limit`, e a leitura atual (`getTransactionsByIds`) não põe.
- "covered_by_rebuild só avança o prefixo": precisa ser monótono, sem nunca recuar `appliedVersion`.
- "Quem já lê `transactions` não ganha nada novo": `monthCommits` revela meses antigos do lançamento (histórico de datas). É metadado menor.
- A prova para id não encontrado (exclusão física pela ferramenta) não está definida.

### T12 — INFO — escopo

- `git diff --stat 08d8c5a2..cf9cb2a9` só lista arquivos de `src/`, `tests/` e `e2e/`.
- Nada mudou em `functions/`, Rules ou índices, e não há `firebase.json` nem configuração remota no delta.
- Sem rede nem segredos.

---

## Respostas aos itens do pedido

1. **S01, solidez.** Na vista sem período, nenhuma violação:
   - 260.000 configurações aleatórias, em 13 lotes e 5 perfis (turnos de 24 h, cíclicas, feriados, alterações de escala, ausências, reduções seguidas, plantões perto de 24 h, durações, grades de 15 e 1 min);
   - 236.089 pares (véspera incerta, dia aceito) e 6,8 milhões de partes trabalhadas, todas fisicamente possíveis;
   - nenhuma dependência de intervalo: 4.126 casos marcados ambíguos sob uma parte intermediária têm o mesmo valor em todas as posições;
   - corolário do dia civil: 0 violações.

   **Mas há contraexemplo no início do período da estimativa (T01).** O Teorema 3 vale para partes fisicamente possíveis; o enunciado precisa de ajuste (T04).
2. **S01, monotonia.** Na vista sem período, 0 violações em 706.044 pares. No início do período, **contraexemplo** (T01): 1.080 → 970 min com as duas configurações aceitas, e 385 violações na busca dirigida. A §6 falha no caso 2 quando `p` abre o período.
3. **S01, conferidor.** Nos meses de nov/2025 a mar/2027 (como mês avulso e abrindo o período), nenhum dia marcado como ambíguo escapou dele. As causas `reduced_eve` conferem: data, véspera, exceção e rotinas do turno, com 0 divergências no lote refinado. As causas `routines` em dia `reducedEve` seguem a regra documentada da R1. **O segundo dia do período, sem cálculo seguro em substância, não é marcado nem achado** (T01).
4. **Recusa conservadora.** É aceitável como regra de segurança, mas a declaração é inexata e sem evidência no pacote, e a mensagem é falsa nesses casos (T03).
5. **Interface e pt-BR.** Os textos estão corretos, com uma nota (T08). Não há mudança visual fora do necessário.
6. **S03.** Resolvido (T09).
7. **Testes anteriores.** Nada removido, relaxado ou pulado além da substituição declarada do RR-R1-03 (T10).
8. **Frente B.** Os fatos conferem (T11). A prova escrita não exige o conjunto aplicado exato e se apoia, sem dizer, na releitura que a sincronização já faz (T02): o critério 2 do parecer fica atendido só em parte. Os demais critérios (1, 3, 4, 5 e 6) estão atendidos no desenho, com as ressalvas de T11.
9. **Escopo.** Confirmado (T12).

**Adendo (cf9cb2a9).** A memória não muda resultado (T07). O ganho de desempenho existe (cerca de 2 vezes). Só para a passada nova, confere com o declarado, ressalvada a máquina; o pior caso combinado com a passada dos vizinhos fica em 1,0–1,8 s e não está declarado (T05). A proposta v2 corrigiu o título e acrescentou a tabela dos mecanismos e a A′; a A′ herda a falha de T02.

## Matriz final

| Achado | Estado | Base |
| --- | --- | --- |
| B02 (S01) | **NÃO RESOLVIDO** | T01: configuração aceita, que passa em `validateDraft`, com horas dependentes da parte trabalhada no início do período, e monotonia quebrada (regressão sobre a R1) |
| S03 | **RESOLVIDO** | T09 |
| Frente B (desenho do B03) | **PARCIALMENTE ADEQUADA** | T02: a direção (marca por lançamento, gravada pelo gatilho) é boa; a prova do cliente precisa exigir o conjunto aplicado exato e a releitura explícita antes da R3 |
| B03 | aberto, sem mudança (fora do escopo da R2A) | — |

**Veredito global: FAIL.** O B03 continua aberto, como previsto. Além disso, o B02 não está fechado (T01), e a Frente B precisa de emenda na prova antes de autorizar a R3 (T02).

## Anexo — sondas e logs (`saida/`)

| Sonda (`sondas/`) | O que faz | Log (`logs/`) |
| --- | --- | --- |
| `s01-parecer.mts` | caso do parecer nas duas árvores | `s01-parecer.log.txt` |
| `s01-solidez.mts`, `s01-solidez2.mts` | solidez, completude, corolário e recusa conservadora (aleatória) | `s01-solidez*-*.log.txt`, `agregado-solidez-monotonia.txt` |
| `s01-monotonia.mts`, `s01-monotonia-dirigida.mts`, `s01-monotonia-dirigida2.mts` | monotonia, genérica e dirigida | `s01-monotonia-*.log.txt`, `s01-monotonia-dirigida*-*.log.txt` |
| `s01-inicio-periodo.mts`, `-monotonia.mts`, `-busca.mts`, `-draft.mts` | T01 | `s01-inicio-periodo*.log.txt` |
| `s01-conservadora.mts` | T03 | `s01-conservadora*.log.txt` |
| `antes-depois.mts` | tabela antes × depois nas duas árvores | `antes-depois.log.txt` |
| `b03-modelo.mts` | T02 (modelo executável da prova A só com as regras 4 e 5 escritas, sem a releitura da sincronização das bases) | `b03-modelo.log.txt` |
| `memo-diferencial.mts` | T07 | `memo-diferencial*.log.txt` |
| `custo-pior-caso.mts` | T05 | `custo-pior-caso*.log.txt` |
| `mutantes-revisor.py` | 28 mutantes de unidade sobre cf9cb2a9 | `mutantes-revisor.log.txt` |
| `lib.mts` | geradores e cópia do calendário com a véspera trabalhando só uma parte | — |

Reprodução: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda> <raiz>`. As sondas que leem os internos recebem `saida/instr-final` (ou `saida/instr`); as de caixa-preta recebem `saida/final`, `saida/r1` ou a `ARVORE`.

### Mutantes do revisor (cf9cb2a9)

| Mutante | Resultado | Arquivos que reprovam |
| --- | --- | --- |
| M01 véspera incerta ignorada (motor da R1) | morto | calendar, estimate, preference |
| M02 sempre desconta o turno inteiro | morto | calendar, estimate, preference |
| M03 aceita sem comparar os extremos | morto | calendar, estimate, preference |
| M04 ignora a ambiguidade do extremo "inteiro" | morto | calendar |
| M05 devolve o plano do extremo "inteiro" | morto | calendar |
| M06 reducedEve sempre falso | morto | calendar, estimate, preference |
| M07 véspera reduzida sempre certa | morto | calendar, estimate, preference |
| M08 véspera reduzida sempre incerta | morto | calendar, estimate, preference |
| M09 máximo sem as durações | morto | calendar |
| M10 < no lugar de <= | morto | calendar, estimate, preference |
| M11 máximo sem descontar a véspera que segue | morto | calendar |
| M12 dia que segue a rotina também incerto | morto | calendar, estimate, preference |
| M13 dia seguinte incerto entra como vizinho | morto | calendar |
| M14 conferidor sem a passada nova | morto | calendar, preference |
| M15 conferidor com o atalho antigo | morto | calendar, preference |
| M16 passada nova com o filtro invertido | morto | calendar, preference |
| M17 causa do vizinho no lugar da véspera | morto | calendar |
| M18 meia-noite medida no próprio dia | morto | calendar |
| M19 último dia reduzido fora da passada | morto | calendar, preference |
| M20 seção da recusa nas rotinas | morto | preference |
| M21 datas trocadas na mensagem | morto | preference |
| M22 motivo da estimativa sempre o das rotinas | morto | estimate |
| M23 mut-tpl: a chave inclui a jornada para aplicar | morto | preference |
| M24 edited falso na digitação inválida | morto | preference, guard |
| M25 aplicar em todos os dias | morto | preference |
| M26 memória sem conferir o objeto | **vivo** | — |
| M27 memória não desfeita na saída | morto | calendar |
| M28 memória das janelas sem conferir o objeto | **vivo** | — |

**Resultado: 26 de 28 mortos.**
- Os dois vivos (M26, M28) tiram a conferência de identidade da memória.
- Fora de uma chamada aninhada com outro calendário, eles são equivalentes, e nenhum teste exercita esse caso.
- É lacuna de teste da guarda defensiva (T07), sem efeito em valores.
- Os mutantes de E2E (tpl, tplfail e s01a a s01d) não foram executados: o E2E é proibido nesta revisão.
