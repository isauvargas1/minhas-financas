# P5-F.1-R2A — respostas à revisão independente 2 (2026-11-06)

**O que a revisão leu.** A `revisao-r2a-2.md` leu a árvore `63e4c3c6`, a da primeira correção.
- **Veredito:** FAIL global só pelo B03. Nenhum HIGH ou MEDIUM aberto.
- **Resolvidos:** T01 (no código), T02 (no desenho), T07, T08 e T11.
- **Abertos:** T03 residual, T04, T05 e T06, todos documentais, e um LOW novo, o **T13**.

## T13 — LOW — a regra "bruta" recusava também dias que nunca abrem o período

| Item | Conteúdo |
| --- | --- |
| Achado | Só o dia 1 de um mês abre o período, mas o máximo sem desconto valia para todos os dias. Por isso a segunda 05/10/2026 do caso domingo/segunda de 24 h e o caso B0 eram recusados sem necessidade. O comentário do teste ("num período que começa na segunda") estava errado para essa data. |
| Resposta | **Aceito; adotada a variante que a revisão testou.** O máximo não desconta a véspera só no dia 1 de um mês (`opensMonth`); nos outros dias, desconta a véspera que segue a rotina. A árvore final do código é `cd95e1cb`. |
| Por que é seguro | Só o dia 1 de um mês é calculado sem a véspera: `monthPlan` com `periodStart` passa `null` só no índice 0 (`calendar.ts:670`, na árvore final `cd95e1cb`), e a passada `period_start` do conferidor só olha o dia 1 de cada mês (`:934`). Os outros dias são sempre calculados com a véspera, e o máximo da certeza é o do cálculo deles. |
| Testes | • O teste do parecer volta a aceitar a segunda 05/10 com 60, com o comentário corrigido.<br>• Ganhou a mesma segunda em 01/06/2026: recusa com `reduced_eve` em 02/06 e `reducedEveDays` no mês abrindo o período; com o limite de 24 h, aceita com 60.<br>• Contra o motor de `63e4c3c6`, a asserção de 05/10 reprova. Contra o de `cf9cb2a9`, reprovam a de 01/06 e os dois testes R2A-01 (`saidas/unit-t13-contra-*.log.txt`). |
| Mutantes | O U11 desconta também no dia 1 (a regra de antes) e o U38 nunca desconta (a regra estrita). Os dois morrem. |
| Custo | Na sonda genérica, com 3.000 configurações, a regra final recusa exatamente as mesmas 572 da regra sem a correção. A estrita recusava 578. |

## T03 residual, T04, T05 e T06 — documentais

- **T03:** a §5 de `s01-vespera-reduzida.md` foi reescrita com quatro fontes:
  - o teto;
  - a redução no próprio dia;
  - reduções seguidas, onde fica o caso B;
  - o dia 1 de um mês.

  A frequência está medida em três geradores, com as saídas no pacote. As mensagens já estavam corrigidas.
- **T04:** a §2 e a §4 tratam o intervalo: a parte fisicamente possível, a convenção do extremo (ii) e a conferência da revisão (0 divergências nas partes possíveis).
- **T05:** `testes-e-resultados.md` traz as duas tabelas de custo em quatro árvores, e o RR-R2A-02 registra o pior caso: 0,5 a 1,3 s por conferência nas sondas da revisão, contra 0,43 a 0,53 s na R1.
- **T06:** o pacote final traz `testes-e-resultados.md`, `saidas/`, `visual/`, `sondas/` e `revisoes/`.

## Nota da revisão sobre a rede

O proxy registrou tentativas de conexão a `assets.mixkit.co` durante um E2E no worktree. O app referencia esse host em `src/contexts/ThemeContext.tsx`. É comportamento anterior à R2A, fora do delta e sem efeito nos testes, porque a conexão é recusada no contêiner. Fica registrado no relatório como observação, sem ação nesta etapa.
