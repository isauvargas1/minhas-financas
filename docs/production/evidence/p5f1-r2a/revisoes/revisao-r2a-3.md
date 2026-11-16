# Revisão independente — P5-F.1-R2A, terceira rodada

**Data:** 2026-11-06 · **Revisor:** independente, somente leitura · **Veredito global: FAIL** (o B03 continua aberto)

**Árvore revisada:** `cd95e1cbb292188638b189f67e3c8f90b0c4ba2d`, extraída por `git archive` em `saida/r2a3`, com a cópia instrumentada em `saida/instr-r2a3`.
- O `delta-63e4c3c6-para-cd95e1cb.diff` fornecido é igual ao `git diff`, e só toca `calendar.ts` e o teste dele.
- Nada foi executado no worktree, onde o `verify:all` estava rodando, nem em `mutantes-arvore/`.
- Sem Emulator, E2E, rede ou segredos.

**Testes de unidade (cd95e1cb):** calendar 41/41, estimate 24/24, guard 17/17, preference 16/16, consistency 30/30, income-estimate 21/21, calculation 15/15, grammar 5/5 (`logs/unit-r2a3-*.log.txt`).

## Resumo

| Severidade | Achados abertos |
| --- | --- |
| HIGH | — |
| MEDIUM | — |
| LOW | T03 residual · T04 · T05 · T06. Todos documentais, para o pacote final |
| INFO | — |

## A variante adotada (T13)

**É a minha variante.**
- A diferença para `saida/r2a2-refinada` está só no auxiliar `opensMonth(date) = date.slice(8, 10) === '01'`, equivalente a `date.endsWith('-01')` em datas `AAAA-MM-DD`, e na variável `eveWindows`.
- A regra é a mesma (`calendar.ts:434`, cd95e1cb): sem desconto da véspera no dia 1 de cada mês; nos outros dias, desconta a véspera que segue a rotina.

**Só o dia 1 é calculado sem véspera.** Conferi todas as chamadas com véspera `null`:
- `monthPlan` com `periodStart`, no índice 0: `:670`;
- a passada `period_start` do conferidor: `:934`, mais `involvedOn` em `:936`, que só monta a lista de rotinas;
- `addDays(date, -1)` só dá `null` em 01/01/2000, que também é um dia 1 (`dayPlan`, `:623`, e `monthPlan`, `:670`).

As referências `:660` e `:924` citadas na mensagem são as de 63e4c3c6; em cd95e1cb são `:670` e `:934`.

**As sondas da rodada anterior, em cd95e1cb:**

| Conferência | Resultado |
| --- | --- |
| Busca dirigida do início do período (`s01-inicio-periodo-busca`), sementes 99, 199 e 299, 3 × 20.000 | **0 violações de monotonia e 0 dependências da parte trabalhada.** Contagens idênticas às de 63e4c3c6 e às da minha variante (`logs/r2a3-s01-inicio-periodo-busca-*.log.txt`) |
| Contraexemplos do T01 (`s01-inicio-periodo*`) | recusados (`reduced_eve`, 02/10); a estimativa do caso longo fica indisponível; `validateDraft` recusa `C′` (`logs/r2a3-s01-inicio-periodo*.log.txt`) |
| Vistas (`vistas-iguais`, 3.000 configurações × 4 meses) | dias 2 em diante idênticos nas duas vistas; **0** casos em que o dia 1 corta só no período e é "certo" (`logs/r2a3-vistas-iguais.log.txt`) |
| Solidez (`s01-solidez3`; perfis night, break, early e mix; 40.000 configurações) | 36.171 pares e 1.048.959 partes trabalhadas: **0 violações** (aceitas ou não), 0 no corolário do dia civil, 0 dias escapando do conferidor e 0 divergências em partes fisicamente possíveis; 1.705 casos ambíguos sob parte intermediária, todos com valor constante (`logs/r2a3-s01-solidez3-*.log.txt`) |
| Monotonia | **0 violações**: 65.296 pares na busca dirigida (17.190 com `p` no dia 1) e 5.026 na genérica (`logs/r2a3-s01-monotonia-*.log.txt`) |
| Aceitação, 3.000 configurações (`aceitacao-diferencial`) | **idêntica** à de cf9cb2a9 e à da minha variante; contra 63e4c3c6, +2 aceitas e 0 recusadas a mais (`logs/r2a3-aceitacao-*.log.txt`) |
| Casos conservadores e tabela | o `sundayCover` (05/10) é aceito com 60, e o B0 com 120; A, B, C e D continuam recusados, como em cf9cb2a9 (`logs/r2a3-s01-conservadora.log.txt`, `logs/r2a3-antes-depois.log.txt`) |
| Os testes de cd95e1cb contra motores anteriores | com o motor de 63e4c3c6, reprova 1 (o teste 21, a asserção de 05/10); com o de cf9cb2a9, reprovam 3 (21, pela asserção de 01/06, mais os dois "R2A-01"). Confere com a afirmação do executor (`logs/r2a3-testes-com-motor-*.log.txt`) |
| Custo, com o `verify:all` rodando ao mesmo tempo | 572–644 ms só a passada nova e 1,0–1,2 s combinado; igual a 63e4c3c6 (`logs/r2a3-custo-pior-caso.log.txt`) |

**Mutantes** (`sondas/mutantes-revisor3.py`, `ARVORE_DIR=r2a3`, `logs/r2a3-mutantes-revisor.log.txt`): **29 de 29 mortos**. São os 28 da primeira rodada, com o M11 nas duas direções:
- **M11a**, que desconta a véspera também no dia 1 (a regra de cf9cb2a9): morre nos testes 21, 22 e 35 (o 01/06 e os dois "R2A-01");
- **M11b**, que nunca desconta (a regra estrita de 63e4c3c6): morre no teste 21 (a asserção de 05/10).

## Estado de cada achado

| Achado | Estado em cd95e1cb |
| --- | --- |
| T01 — S01 no início do período (HIGH) | **RESOLVIDO no código.** Falta escrever a §6 do documento de evidência |
| T02 — prova da alternativa A (MEDIUM) | **RESOLVIDO no desenho** (sem mudança nesta rodada). A implementação e os testes da §8 são da R3 |
| T03 — recusa conservadora (MEDIUM) | **PARCIAL.** A mensagem foi corrigida em 63e4c3c6, e o conjunto recusado voltou a ser o de cf9cb2a9. Ficam a §5 reescrita e a frequência (documental, LOW) |
| T04 — Teorema 3 com intervalo (LOW) | **PENDENTE** (documental) |
| T05 — custo no pior caso (LOW) | **PENDENTE** (documental, no RR-R2A-02). Medições desta rodada acima |
| T06 — evidência fora do pacote (LOW) | **PENDENTE** (pacote final) |
| T07 — memória do conferidor (INFO) | **RESOLVIDO.** M26 e M28 morrem |
| T08 — textos pt-BR (INFO) | **RESOLVIDO** (sem mudança nesta rodada) |
| T09 — S03 (INFO) | **resolvido** (sem mudança). M23 a M25 morrem |
| T10 — testes anteriores (INFO) | **sem regressão.** O delta devolve a aceitação de 05/10 com o comentário corrigido e acrescenta a recusa de 01/06 e a aceitação com 24 h. Nenhum `skip` ou `only` |
| T11 — fatos da proposta B03 (INFO) | **RESOLVIDO** |
| T12 — escopo (INFO) | **confirmado.** O delta só toca `calendar.ts` e o teste |
| T13 — regra bruta conservadora a mais (LOW) | **RESOLVIDO.** A regra adotada é a variante sugerida |

## Matriz final

| Item | Estado |
| --- | --- |
| B02 (S01) | **RESOLVIDO no código** (cd95e1cb). Pendências documentais: §5 e §6 do documento de evidência e T04 |
| S03 | **RESOLVIDO** |
| Frente B (desenho do B03) | **ADEQUADA no desenho**. A R3 implementa |
| B03 | **aberto** |

**Veredito global: FAIL**, porque o B03 continua aberto, como previsto pelo parecer. Não há achado HIGH, MEDIUM nem LOW de código em aberto. O que falta é documental (T03, T04, T05 e T06) e entra no pacote final.

Sondas e logs desta rodada: `saida/sondas` (as mesmas, mais `mutantes-revisor3.py`) e `saida/logs/r2a3-*`.
