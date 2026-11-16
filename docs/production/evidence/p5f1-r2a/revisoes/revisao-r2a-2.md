# Revisão independente — P5-F.1-R2A, segunda rodada

**Data:** 2026-11-06 · **Revisor:** independente, somente leitura · **Veredito global: FAIL** (o B03 continua aberto)

**Árvore revisada:** `63e4c3c697212f2ba1f3a13850f8d29fb58754f3`.
- Extraí a árvore com `git archive` em `saida/r2a2`.
- O `delta-cf9cb2a9-para-63e4c3c6.diff` fornecido é igual ao `git diff` entre os objetos.
- O delta só toca `src/`, `tests/` e `e2e/`. Nada mudou em `functions/`, Rules, índices ou `firebase.json`.

**Cópias e execução:**
- A cópia instrumentada `saida/instr-r2a2` é o `calendar.ts` da árvore com uma linha de `export` no fim, conferida por `diff`.
- Tudo rodou com `node --experimental-strip-types`, só em `saida/`. Nada no `WORKTREE`, nem em `mutantes-arvore/`.
- Sem Emulator, E2E, rede ou segredos.
- Durante uma das execuções, o proxy registrou tentativas de conexão a `assets.mixkit.co`. Elas vinham da execução E2E em curso no worktree (Playwright e `vite preview`; o app referencia esse host em `src/contexts/ThemeContext.tsx`), não das sondas, que não usam rede.

**Testes de unidade na cópia de 63e4c3c6:**
- calendar 41/41, estimate 24/24, guard 17/17, preference 16/16, consistency 30/30, income-estimate 21/21, calculation 15/15, grammar 5/5 (`logs/unit-r2a2-*.log.txt`).
- Os testes novos rodam contra o motor de cf9cb2a9 e reprovam 3 (`logs/r2a2-testes-com-motor-cf9cb2a9.log.txt`):
  - o `sundayCover`;
  - o dirigido "R2A-01";
  - a propriedade "R2A-01", na "amostra 3", como o executor afirmou.

## Resumo

| Severidade | Achados abertos nesta rodada |
| --- | --- |
| HIGH | — |
| MEDIUM | — |
| LOW | **T13** (novo: a regra "bruta" recusa também dias que nunca abrem o período) · **T03** residual (documental) · **T04** · **T05** · **T06** (documentais, para o pacote final) |
| INFO | — |

## Estado de cada achado

| Achado | Sev. (1ª rodada) | Estado em 63e4c3c6 | Evidência nesta rodada |
| --- | --- | --- | --- |
| T01 — S01 no início do período | HIGH | **RESOLVIDO no código.** Falta a §6 do documento de evidência | contraexemplos recusados; busca dirigida 0/60.000; afirmação sobre o 2º dia conferida (abaixo) |
| T02 — prova da alternativa A | MEDIUM | **RESOLVIDO no desenho.** A implementação é da R3 | `b03-modelo-corrigido`: 0 provas falsas em 234.791; com a regra antiga, 71 (o modelo tem poder) |
| T03 — recusa conservadora | MEDIUM | **PARCIAL.** A mensagem não afirma mais a dependência; a §5 e a frequência ficam para o pacote final; a regra nova alarga a recusa (T13) | textos em `draft.ts:395` e `messages.ts:35`; `logs/r2a2-s01-conservadora.log.txt` |
| T04 — Teorema 3 com intervalo | LOW | **PENDENTE** (documental) | o código não mudou nisso; nas partes fisicamente possíveis, 0 divergências em 1.554.400 conferências |
| T05 — custo no pior caso | LOW | **PENDENTE** (documental, no RR-R2A-02) | 551–665 ms só a passada nova; 1,0–1,7 s combinado (`logs/r2a2-custo-pior-caso.log.txt`, com o E2E do executor rodando ao mesmo tempo) |
| T06 — evidência fora do pacote | LOW | **PENDENTE** (pacote final) | — |
| T07 — memória do conferidor | INFO | **RESOLVIDO** | teste novo de outro calendário no meio da chamada; M26 e M28 morrem; cabeçalho atualizado; diferencial com e sem memória: 0 diferenças em 3.000 chamadas |
| T08 — textos pt-BR | INFO | **RESOLVIDO** | "o dia anterior" e "as horas desse dia"; mensagem de salvar sem "dependem disso" |
| T09 — S03 | INFO | **sem mudança: resolvido** | M23 a M25 morrem |
| T10 — testes anteriores | INFO | **sem mudança** | no delta, só mudou a expectativa do `sundayCover` (registrada no comentário; ver T13) e os textos das mensagens. Nenhum `skip` ou `only` |
| T11 — fatos da proposta B03 | INFO | **RESOLVIDO** | avanço monótono; `limit` na consulta; metadado declarado; lançamento antigo e apagado definidos |
| T12 — escopo | INFO | **sem mudança: confirmado** | o delta só toca `src/`, `tests/` e `e2e/` |
| T13 — regra bruta conservadora a mais | — (novo) | **ABERTO, LOW** | abaixo |

## T01 — conferência da correção

**A regra nova.** `computeNeighborWindows` (`calendar.ts:425`) calcula o máximo sem descontar a véspera:

```
const most = windowWorkOf(routineDay.windows, [], followedWindowsOn(calendar, addDays(date, 1)), []);
```

**As sondas da primeira rodada, na árvore nova:**

| Sonda | cf9cb2a9 | 63e4c3c6 |
| --- | --- | --- |
| `s01-inicio-periodo` (quinta reduzida a 1.000, sexta 00:00–04:00) | aceita; a sexta vale 120, e o valor real vai de 120 a 240 | **recusa** (`reduced_eve`, 02/10); a estimativa fica indisponível |
| `s01-inicio-periodo-monotonia` (`C` → `C′`) | as duas aceitas; 1.080 → **970** | `C` aceita (1.080); **`C′` recusada** (`reduced_eve`, 02/10), e `validateDraft` recusa com a mensagem nova |
| `s01-inicio-periodo-busca`, 20.000 amostras (semente 99) | 385 violações de monotonia; 1.809 dependências da parte trabalhada | **0 e 0** (e também 0 e 0 com as sementes 199 e 299; 60.000 amostras ao todo) |

Logs: `logs/r2a2-s01-inicio-periodo*.log.txt` e `logs/r2a2-s01-inicio-periodo-busca-{99,199,299}.log.txt`.

**A afirmação do executor:**
- "O segundo dia do período não precisa de passada própria no conferidor: `planDay(D+1, D)` é a mesma chamada nas duas vistas, e a certeza de D não depende mais da vista."
- **Confere.** Pela leitura: `monthPlan` (`:660`) só troca a véspera do dia de índice 0, e `neighborWindowsOn` agora só depende do calendário e da data.
- Pela sonda (`sondas/vistas-iguais.mts`, 3.000 configurações × 4 meses):
  - os dias 2 em diante são **idênticos** com e sem `periodStart` (0 diferenças);
  - casos em que o dia 1 corta só no período e mesmo assim é "certo" para o dia 2: **4** em cf9cb2a9 (o defeito T01) e **0** em 63e4c3c6 (`logs/final-vistas-iguais.log.txt`, `logs/r2a2-vistas-iguais.log.txt`).
- O dia 1 do período não tem véspera, então não depende da parte trabalhada de ninguém. A cobertura de intervalo dele continua conferida pela passada do início do período da R1.

**Solidez, na vista sem período, 60.000 configurações** (`sondas/s01-solidez3.mts` e `s01-solidez2.mts`; `logs/r2a2-s01-solidez*-*.log.txt`):
- 53.600 pares (véspera incerta, dia aceito) e 1.554.400 partes trabalhadas;
- **0 violações em configuração aceita**, corolário do dia civil: 0;
- 0 dependências de intervalo em 2.433 casos marcados ambíguos sob uma parte intermediária;
- completude do conferidor: 0 dias escapando.

Num lote (night, semente 3202) apareceram 8 "violações" e 8 "dia civil". As 8 são de configurações **recusadas**, e em todas a véspera é ela mesma ambígua: três janelas com intervalo que se cruzam sem cobertura (`violationsAccepted: 0`, `violationsEveAmbiguous: 8`).
- O mesmo dia dá o mesmo número em cf9cb2a9 (`sondas/checa-exemplo.mts`, `logs/r2a2-violacao-exemplo.log.txt`): não é regressão.
- Explica-se assim: com intervalos que se cruzam sem cobertura, a convenção de `occupancyPieces` não é a ocupação máxima. Mas uma véspera assim nunca é aceita, porque já é ambígua.

**Monotonia, sem nenhuma violação:**
- 7.590 pares na busca genérica (`logs/r2a2-s01-monotonia-night-3404.log.txt`);
- 109.262 na dirigida, 28.872 deles com `p` abrindo o período (`logs/r2a2-s01-monotonia-dirigida2-3303.log.txt`).

**Mutantes** (`sondas/mutantes-revisor2.py`, `logs/r2a2-mutantes-revisor.log.txt`): **28 de 28 mortos**.
- O M11 foi ajustado à regra nova: "máximo descontando a véspera que segue", isto é, a regra de cf9cb2a9. Ele morre nos testes `sundayCover`, "R2A-01" dirigido e "R2A-01" propriedade.
- M26 e M28 morrem no teste novo da memória.

## T02 — conferência da proposta corrigida

Arquivo conferido: `relatorio/PROPOSTA-ARQUITETURAL-B03.md`.

**O que a proposta passou a ter:**
- a ordem das leituras, com a marca lida do servidor depois do instantâneo da escuta de todos os meses da janela;
- a releitura exigida a cada mudança de mês;
- condição 2: `pending` vazio, `appliedVersion == v` e escuta `>= monthCommits`;
- condição 1: sem evento de `T` depois do corte;
- o lançamento apagado;
- `limit` na consulta;
- o avanço monótono;
- na §8, o cenário da leitura velha e o oráculo "prova verdadeira ⇒ estimativa igual ao valor exato".

**O modelo** (`sondas/b03-modelo-corrigido.mts`, `logs/b03-modelo-corrigido.log.txt`):
- **O contraexemplo da 1ª rodada:**
  - com `T@v1` e `e3` aplicado antes de `e2`, a prova dá `false`, tanto com a marca lida depois do instantâneo quanto antes dele;
  - depois de `e2`, com `T@v3`, dá `true`, e o valor está exato.
- **A propriedade:** 200.000 cenários, com 2 a 6 versões, mudanças de mês, entregas fora de ordem em 147.668 cenários e leituras e instantâneos em instantes ao acaso. Deram **234.791 provas e 0 provas falsas**.
- **O poder do modelo:** a mesma propriedade com a regra antiga (sem `pending` vazio e com a marca lida a qualquer momento) dá **71 provas falsas** (`logs/b03-modelo-poder-regra-antiga.log.txt`).

**Observação sem severidade.** A regra do lançamento apagado ("sem marca, não há prova") faria um id desconsiderado de lançamento que não existe segurar a estimativa em reais. Conferi que isso só pode vir de exclusão física, porque trocar o espaço da renda limpa a lista (`IncomeEditor.tsx:215`), e a pessoa pode limpar a lista (`:129`). Basta registrar.

## T13 — LOW (novo) — a regra "bruta" recusa também dias que nunca abrem o período

**O problema.** Só o **dia 1 de um mês** pode abrir o período da estimativa. A janela da estimativa começa no primeiro dia de um mês: `estimate.ts:184` e `monthPlan`, `calendar.ts:660`. Mas o máximo bruto vale para todos os dias, e isso recusa configurações em que a jornada reduzida cai num dia que nunca é contado sem a véspera.

**Exemplos:**
- **O `sundayCover`.** Segunda 05/10/2026, reduzida a 20 h, depois de domingo 22:00–06:00, com terça 00:00–02:00.
  - O comentário novo do teste justifica a recusa com "num período que começa na segunda, ela conta sem o domingo", mas nenhuma janela da estimativa começa em 05/10/2026.
  - A segunda conta 1.140 em qualquer vista, e o limite de 1.200 não corta.
  - Antes era aceito com 60; agora é recusado.
- **O caso B0 da 1ª rodada.** Segunda 06:00–02:00 reduzida a 1.100, depois de domingo 20:00–08:00 que segue a rotina. A segunda conta 1.080 em qualquer vista. Era aceito com 120 e agora é recusado (`logs/r2a2-s01-conservadora.log.txt`).
- **Custo medido.** Num gerador aleatório, 2 configurações recusadas a mais em 962 aceitas antes (0,2%), e 0 aceitas a mais (`sondas/aceitacao-diferencial.mts`, `logs/r2a2-aceitacao-diferencial.log.txt`). É baixo, e a mensagem nova não é mais falsa. É custo de produto, sem risco de valor.

**Alternativa conferida.** Uma variante minha (`saida/r2a2-refinada`) usa o máximo bruto **só no dia 1 do mês** e desconta a véspera que segue a rotina nos demais:

```
date.endsWith('-01') ? [] : followedWindowsOn(calendar, addDays(date, -1))
```

- Ela também não depende da vista, porque só depende da data.
- Resultados:
  - 40/41 testes da árvore nova, e só reprova a asserção nova do `sundayCover`, que volta a ser aceito com 60;
  - busca dirigida do início do período: 0 violações e 0 dependências em 20.000 amostras;
  - contraexemplos do T01: recusados;
  - B0: aceito com 120;
  - solidez: 0 violações em configuração aceita, em 10.000 configurações;
  - monotonia dirigida: 0 em 43.868 pares, 11.560 deles com `p` no dia 1.

  Logs: `logs/refinada-*.log.txt`.
- Essa variante também permitiria descontar, por recursão, a antevéspera reduzida certa nos dias que não são o 1º do mês. O argumento do executor contra a recursão ("no dia que abre o período nada é descontado") só vale para o dia 1.

**Correção sugerida.** Uma de duas:
- adotar a variante;
- ou manter a regra bruta e registrar o custo com honestidade. Nesse caso, corrigir o comentário do `sundayCover`, porque a segunda 05/10/2026 não abre período nenhum, e citar os casos `sundayCover` e B0 na §5 reescrita.

## Matriz final

| Item | Estado |
| --- | --- |
| B02 (S01) | **RESOLVIDO** no código (63e4c3c6). Pendências documentais: T04, e a §5 e §6 do documento de evidência |
| S03 | **RESOLVIDO** |
| Frente B (desenho do B03) | **ADEQUADA no desenho**, que atende os critérios 1 a 6 do parecer. A implementação e os testes da §8 são da R3 |
| B03 | **aberto** (não implementado nesta etapa) |

**Veredito global: FAIL**, porque o B03 continua aberto, como previsto pelo parecer.
- Nesta árvore não há achado HIGH nem MEDIUM aberto.
- Ficam o T13 (LOW, decisão de produto) e as pendências documentais T03, T04, T05 e T06, que entram no pacote final.

## Anexo — sondas e logs novos desta rodada (`saida/`)

| Sonda (`sondas/`) | Uso | Log (`logs/`) |
| --- | --- | --- |
| `s01-inicio-periodo*.mts` | T01 na árvore nova | `r2a2-s01-inicio-periodo*.log.txt` |
| `vistas-iguais.mts` | afirmação do 2º dia (T01) | `r2a2-vistas-iguais.log.txt`, `final-vistas-iguais.log.txt` |
| `s01-solidez2.mts`, `s01-solidez3.mts` | solidez, com as violações separadas por aceitação | `r2a2-s01-solidez2-*.log.txt`, `r2a2-s01-solidez3-*.log.txt` |
| `checa-exemplo.mts` | exemplo das 8 "violações" (configuração recusada) | `r2a2-violacao-exemplo.log.txt` |
| `s01-monotonia.mts`, `s01-monotonia-dirigida2.mts` | monotonia | `r2a2-s01-monotonia-*.log.txt` |
| `mutantes-revisor2.py` | 28 mutantes, com o M11 ajustado (`ARVORE_DIR=r2a2`) | `r2a2-mutantes-revisor.log.txt` |
| `b03-modelo-corrigido.mts` | T02 (regra corrigida; `PODER=1` para a regra antiga) | `b03-modelo-corrigido.log.txt`, `b03-modelo-poder-regra-antiga.log.txt` |
| `aceitacao-diferencial.mts` | custo da regra bruta (T13) | `r2a2-aceitacao-diferencial.log.txt` |
| `s01-conservadora.mts`, `antes-depois.mts` | casos conservadores e tabela | `r2a2-s01-conservadora.log.txt`, `r2a2-antes-depois.log.txt` |
| `memo-diferencial.mts` | memória ligada × desligada (`saida/r2a2-sem-memoria`) | `r2a2-memo-diferencial.log.txt` |
| `custo-pior-caso.mts` | T05 | `r2a2-custo-pior-caso.log.txt` |
| variante `saida/r2a2-refinada`, `saida/instr-refinada` | T13 | `refinada-*.log.txt` |
