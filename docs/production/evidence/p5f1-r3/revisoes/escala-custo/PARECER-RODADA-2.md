PASS — Firestore scale/cost review

Rodada 2 da revisão independente da P5-F.1-R3, especialidade `firestore-scale-cost-review`. Revisão só de leitura. 2026-11-09, 20:25 UTC.

**Veredito.**

- M1 e M2 estão corrigidos.
- L1, L4, I2 e I3 estão corrigidos.
- L2 e L3 foram aceitos como LOW, com o risco residual registrado.
- I1 e I4 foram atendidos.
- Não há achado novo HIGH, MEDIUM ou LOW; os sete achados novos são INFO, só de texto ou de processo.
- A evidência de Emulator que este gate exige saiu do `verify:all` da árvore congelada: a fase `test:integration:emulator` terminou com código 0.
- O `verify:all` terminou às 20:22:55 UTC com `exit=0`. Os 215 E2E passaram, inclusive os 5 do B03. O veredito é final; não há mais dependência.

## Árvore

- Código congelado: `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93`.
  - Conferi que a árvore de trabalho atual (`1f78fc6e…`, gerada com índice temporário meu e depois apagado) só difere dela em `docs/`.
- Diferenças de código desde a árvore da rodada 1 (`905ed3d6`), por comparação dos blobs:
  - Arquivos de produção e de configuração alterados: `functions/src/cash/periods.ts`, `functions/src/cash/projectionMarks.ts`, `firestore.indexes.json`, `src/modules/reports/basisRegistry.ts`, `src/modules/work-time/messages.ts` e `package.json`.
  - Arquivos de teste alterados: os testes das marcas (unidade e integração), a nova suíte de Rules de ataques, o E2E B03 e dois testes de unidade do cliente.
  - **Sem mudança**, blob a blob: `rebuild.ts`, o gatilho (`triggers/transactions.ts`), `projectionReads.ts`, `projectionProof.ts`, `useIncomeEstimateWith.ts`, `receivableReversal.ts`, `consistency.ts`, `transactions/api.ts`, `incomeReads.ts`, `queryKeys.ts`, `hooks.ts`, `liveRefresh.ts`, `basisSync.ts` e `firestore.rules`.
  - Por isso, as medições da rodada 1 da reconstrução, da prova no cliente, dos agendadores e do Dashboard continuam valendo. Medi de novo só o gatilho e a marca.
- Para compilar sem tocar no WT nem no `functions/lib` dele (o `verify:all` usava os dois), extraí a árvore congelada com `git archive 377c2f3f` para um sandbox meu e compilei lá.

## Estado dos achados da rodada 1

| ID | Sev. | Estado | O que conferi |
| --- | --- | --- | --- |
| **M1** | MEDIUM | **Corrigido** | O §9 de `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md` foi reescrito. **Premissas:** P1 a P3, inclusive o `verify` não verificado, com o custo nos dois casos. **Por unidade:** custo por entrega, por mês, por marca e por workspace. **Reconstrução:** orçamento, capacidade e recomeços. **Prova:** fórmula e casos (25, 120 e 446), novas tentativas e estado pendente persistente. **Também:** o Dashboard e os cenários por mês. "Medido" e "estimativa" estão separados, e os números conferem com as sondas. **Plano:** a §20.18 ainda não está no plano: o rascunho fica em `p5f1r3/evidencia/plano-20-18.md` e vai ao plano no fechamento (N4). Isso não bloqueia este gate, porque o modelo canônico é o do §9. Três imprecisões de texto estão em N1 a N3 |
| **M2** | MEDIUM | **Corrigido** | **Onde:** o teste "tetos do cliente" lê 13 meses e 100 marcas numa transação só de leitura, como viewer; o owner de outro workspace é negado sem resultado parcial. Está em `tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs:301-322`. **Execução:** roda em `test:rules:projection-marks` (`package.json:70`), que faz parte de `test:integration:emulator` (`package.json:52`). **Resultado no `verify:all` final:** ok 8, leitura em 184 ms. **Resto:** o comportamento acima do teto (101 ids ou 14 meses) continua só com guarda estática (N5) |
| L1 | LOW | **Corrigido** | **Isenção:** os 6 campos de topo que o gatilho e a varredura gravam estão isentos de índice de campo único (`firestore.indexes.json:1440-1469`), e não há índice composto da coleção. **Teste:** `functions/src/cash/__tests__/projectionMarks.test.ts:292-307` fixa as isenções. **Sonda da rodada 2:** nenhum campo gravado ficou sem isenção, e as entradas automáticas por marca são 0 (`logs/r2-sonda-poda-isencao.log`). **Premissa:** a isenção de um mapa (`anchors`, `chains`) vale para os subcampos, como no Firestore. **Efeito real:** só depois da implantação dos índices (N6) |
| L2 | LOW | **Aceito, com risco registrado** | O §9 registra a perda de capacidade da reconstrução (de 20% a 28%), as 1,79 vez mais chamadas e o custo de cada recomeço. O rascunho da §20.18 registra o risco (RR-R3-09). `rebuild.ts` não mudou, então a medição da rodada 1 vale |
| L3 | LOW | **Aceito, com risco registrado** | O §9 registra o custo: 31 releituras/h por estimativa montada, e cerca de 13,8 mil leituras/h no teto. O rascunho da §20.18 registra o risco (RR-R3-01 e RR-R3-09). A condição de parada fica para a P7, junto com o sinal de recuperação |
| L4 | LOW | **Corrigido** | O comentário agora diz "três leituras endereçadas por ID" (`functions/src/cash/periods.ts:1299-1300`) |
| I1 | INFO | **Atendido** | **Execução própria:** a árvore final tem `verify:all`, com a árvore registrada no `.meta` (`arvore=377c2f3f…`). **Histórico:** `testes-e-resultados.md` §3 lista as execuções dirigidas, separando a cópia do W3, com a ressalva do A03. **Falta:** a §4 do mesmo arquivo ainda tem o marcador `[[VERIFY]]` |
| I2 | INFO | **Corrigido** | `observeDependentRead`, `dependentObservations` e `dependentStates` foram removidos (`src/modules/reports/basisRegistry.ts`). A busca em `src` e `tests` não acha nenhuma referência |
| I3 | INFO | **Corrigido** | `docs/production/evidence/p5f1-r3/rr-r2a-04.md:41-47` registra 2 a 3 chamadas de `getFinancialReport` a mais por evento, nas consultas ativas do mês e do widget de 30 dias |
| I4 | INFO | **Atendido** | O §9 registra a premissa P3 (o `verify` não cobrado como escrita), não verificada, e o custo se ele for cobrado (+m+u escritas por tentativa) |

## Código novo da rodada 2

**Poda do gatilho** (`functions/src/cash/projectionMarks.ts:505-518`, usada em `functions/src/cash/periods.ts:1402-1406`).

- A poda é só CPU. A mesma escrita grava só as gerações vigente e preparada.
- **Custo medido de novo com a função real da árvore congelada** (`logs/r2-sonda-custo-gatilho.log`): igual ao da rodada 1, caso a caso. Criação 3/4, edição sem efeito 3/2, mudança de mês 3/6, reentrega 3/0 (leituras/escritas) e a primeira quebra +1 escrita no estado. Nenhuma leitura nem escrita a mais.
- **Tamanho da marca** (`logs/r2-sonda-poda-isencao.log`):
  - durante a preparação: 726 B, com 3 componentes;
  - depois da publicação e de uma regravação: 599 B, com 2 componentes.
- O pior caso continua 5.743 B: vigente e preparada, 2 âncoras e 2 cadeias com 16 pendências cada.
- **Na varredura:** a âncora (`set` com merge) não é podada; a posição superada sai na próxima regravação do gatilho. Continua limitada a 2 posições.
- **Concorrência:** a corrida entre a âncora e o gatilho está no teste 16 da integração (ok 369 no `verify:all`), e a poda no teste 15 (ok 368).
- **Unidade:** a propriedade INV-M passou com a poda: 4.000 cenários, 79.796 conferências e 954 podas (`logs/r2-functions-unit-377c.log`).

**Isenções de índice.** Nenhuma consulta lê a coleção. Busca no código: só referências por id. As Rules negam `list`, e o cliente lê por id. Então a isenção não quebra nenhum caminho. Uma consulta futura, como uma limpeza por collection group com `workspaceId`, vai precisar de índice explícito (N6).

## Achados novos (todos INFO)

- **N1.** No §9 do desenho, a linha "Meses" está rotulada como "Medido". Só a ausência de escrita a mais foi medida. Os 35 a 76 B de `projectionGeneration` são estimativa pela fórmula de tamanho.
- **N2.** O §9 fala em "workspaces diversos… até 2,85 leituras por documento". O valor 2,85 é do cenário adversário (600 meses e 500 categorias, página de 500). No diverso são 1,39 (página de 300) e 2,30 (página de 500).
- **N3.** Falta no §9 o teto por hora com receitas contínuas nos meses da janela. Ele soma o agendador da prova e as liberações da base: até 78/h, cerca de 34,8 mil leituras/h no teto, conforme a tabela C do parecer da rodada 1. O cenário PJ usa 35/h, que é o caso típico com receitas frequentes.
- **N4.** A §20.18 continua só como rascunho, fora do WT. `PRODUCTION_READINESS_PLAN.md` não muda desde 16:26 UTC e termina na §20.17. Ainda assim, as respostas (`respostas-revisao-financeiro-escala-privacidade-1.md`: F-06, M1 e INFO-03) dizem que "a §20.18 existe". É preciso aplicar o rascunho no fechamento e corrigir essas três afirmações. A §4 de `testes-e-resultados.md` (`[[VERIFY]]`) também precisa ser preenchida.
- **N5.** O comportamento acima do teto (mais de 100 ids ou mais de 13 meses dá erro antes de qualquer leitura) só tem guarda por expressão regular (`tests/unit/work-time-guard.test.ts:333`). O risco é baixo, porque as entradas já têm limite antes de chegar à prova: no máximo 50 desconsideradas, garantido pelas Rules (`firestore.rules:1277-1279`); no máximo 50 espelhos; janela de no máximo 12 meses. Recomendo um teste de comportamento.
- **N6.** As isenções só valem num ambiente depois da implantação de `firestore.indexes.json`, que não cabe a agentes. Até lá, o ambiente tem os índices automáticos. Qualquer consulta futura sobre marcas precisa declarar índice: `workspaceId` agora está isento.
- **N7.** O rascunho da §20.18 dá o armazenamento como "cerca de 4 a 7 MB por workspace com 10 mil lançamentos". Confere com o §9 e com a sonda: N × 373 a 726 B, sem índice.

## Evidência por item do checklist

Só listo os itens que mudaram de estado; os demais seguem PASS ou N/A, como na rodada 1.

| # | Item | Rodada 1 | Rodada 2 | Evidência |
| --- | --- | --- | --- | --- |
| 7 e 21 | Amplificação de índice; índice no modelo | PASS com L1; FAIL (M1) | **PASS** | isenções e teste (L1); 0 entrada automática por marca (sonda) |
| 19 | Fórmulas e premissas por ação e período | FAIL | **PASS** | §9 reescrito (M1); N1 a N3 só de texto |
| 20 | Cardinalidades realistas e altas | FAIL | **PASS** | cenários PF e PJ por mês e casos da prova até o teto (§9) |
| 21 | Rules, novas tentativas, offline, índice | FAIL | **PASS** | P2, P3, 5 tentativas da transação × 3 novas tentativas do React Query, índice isento (§9) |
| 22 | Sem limpeza manual ou otimização futura | PASS com L3 | **PASS com L3 aceito** | teto por hora medido e registrado; condição de parada na P7 (RR-R3-01) |
| 23 | Emulator: formas novas, Rules, vazio e máximo | FAIL (M2) | **PASS** | "tetos do cliente" na suíte versionada; ok 8 no `verify:all` final |
| 25 | Execução da suíte relevante | PASS com I1 | **PASS** | `test:integration:emulator` da árvore congelada terminou com código 0 (abaixo) |

## Modelo de custo: o que mudou desde a rodada 1

- **Gatilho:** igual (medido de novo): +1 leitura e +1 escrita por entrega aplicada; +1 leitura na reentrega e na entrega coberta; +1 escrita no estado só na primeira quebra.
- **Marca:**
  - 373 B só na `g0`; 726 B durante uma preparação; 599 B depois da publicação e da regravação com poda; pior caso 5.743 B.
  - **Nenhuma entrada de índice de campo único**, contra 22 a 78 estimadas na rodada 1.
- **Por workspace (estimativa):** N × 0,4 a 0,7 KB. Com N = 10 mil, cerca de 4 a 7 MB; com N = 200 mil, cerca de 75 a 145 MB. Na rodada 1, contando o índice, eram cerca de 35 a 70 MiB e 0,7 a 1,4 GiB.
- **Sem mudança** (o código não mudou):
  - reconstrução: até 1,79 vez mais chamadas em workspaces diversos, nenhum commit acima de 500;
  - prova por tentativa: 25, 120 e 446 leituras;
  - releitura num estado pendente que não acaba: 31/h;
  - Dashboard: 2 a 3 chamadas a mais por assinatura.

## Verificação

**Comandos desta rodada.** Logs em `<scratchpad>/p5f1r3/revisoes/escala-custo/logs/`.

| Comando | Resultado |
| --- | --- |
| `git -C WT archive 377c2f3f functions/src … firestore.indexes.json tests`, extraído com `tar -x -C sandbox-377c`; `npx tsc -p .` no sandbox | exit 0 (`r2-tsc-build-377c.log`) |
| `node --test` de todos os testes de unidade das Functions, no sandbox | **677/677**, inclusive o teste das isenções, o da poda e a INV-M com 954 podas (`r2-functions-unit-377c.log`) |
| `node sondas/sonda-custo-gatilho.cjs sandbox-377c sandbox-base` | custo por entrega igual ao da rodada 1 (`r2-sonda-custo-gatilho.log`) |
| `node sondas/sonda-r2-poda-isencao.cjs sandbox-377c` | 726 B e 599 B; nenhum campo sem isenção; 0 índice composto (`r2-sonda-poda-isencao.log`) |
| Comparação de blobs `905ed3d6` → `377c2f3f` e da árvore de trabalho atual → `377c2f3f` | o código que não mudou está listado em "Árvore"; desde 377c2f3f, só mudou `docs/` |

**`verify:all` da árvore congelada** (`p5f1r3/logs/verify-all-final.log`, sha-256 `b97c2f68…`). O `.meta` registra `arvore=377c2f3f…`, início 19:42:32 UTC, fim 20:22:55 UTC, `exit=0`, `duracao_s=2423` e `limpeza=0`. O `verify-all-final.resumo.json` registra:

- `node_verify_fast`: 1.746/1.746;
- `node_integracao`: 1.289/1.289;
- lint: 0 erro e 201 avisos;
- Playwright: "215 passed (18.5m)".

São 3.250 testes no total, com 0 falha e 0 skip, na primeira execução. O coordenador confirmou o resultado às 20:2x UTC.

Por fase:

- **`verify:fast`:**
  - `tsc` sem erro; lint das Functions com 0 erro e 201 avisos;
  - unidade das Functions 677/677;
  - unidade do cliente: work-time 213/213, reports 107/107, cash 23/23.
- **`test:integration:emulator`**, Emulator `minhas-financas-local`; o script terminou com "Script exited successfully (code 0)", na linha 36152 do log:
  - **Integração das Functions: 985/985**, 0 falha. Inclui a suíte das marcas, 16/16 (ok 354 a 369, com a poda no 15 e a corrida no 16), e a cerca: "limite real: 500 escritas sim, 501 não" (ok 401) e "checkpoint suporta 500 meses e recusa passar de 600" (ok 402).
  - **`test:rules:projection-marks`: 17/17**, inclusive "tetos do cliente" (ok 8, 184 ms).
- **E2E: 215/215, nenhuma falha.** Os que exercitam a prova e a escuta passaram:
  - `cash-pending-entries.spec.ts:169` (RR-R2A-04) e `:240`;
  - `work-time-b03.spec.ts`, de B03-a a B03-e (testes 189 a 193);
  - `work-time-p5f.spec.ts`, testes 194 a 212.

## Dependência do `verify:all`

Nenhuma. Na versão provisória deste parecer, o veredito dependia só destes E2E e do `exit=0`. O `verify:all` terminou com `exit=0` e 215/215 E2E, então o veredito acima é final.
