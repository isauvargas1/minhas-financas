# P5-F.1-R3 — matriz de requisitos e resultados

Referência: o pedido da R3 (§0–§15), no pacote de auditoria em `relatorio/pedido-r3.md`. Estados: **Atendido**, **Atendido com risco registrado** (o requisito é cumprido e o risco residual está no plano mestre §20.18), **Não atendido**.

Classificação da evidência:
- **E** — executado nesta etapa, na árvore indicada;
- **H** — herdado de etapa anterior, sem reexecução;
- **RV** — reproduzido em revisão independente;
- **NE** — não executado, com o motivo.

Os logs citados estão em `saidas/` (aqui) e no pacote (`logs/execucoes/`).

## §1–§2 Base e conferência da arquitetura

| Requisito | Estado | Implementação e evidência |
| --- | --- | --- |
| Base reproduzível (R1 `08d8c5a2`, código R2A `cd95e1cb`, entrega R2A `f8267922`, commit `1730a1df`) e ambiente isolado | Atendido | Worktree próprio (`wt-p5f1-r3`), criado da árvore `f8267922` sobre o commit `1730a1df`, conferido por `git write-tree` antes de qualquer edição (E). Relatório, §A |
| Conferir o fluxo real antes de mudar | Atendido | Inventário dos escritores de `transactions` e de `cash_report_periods` (só o gatilho e a publicação: desenho §10); sondas no Emulator (`sonda-updatetime`, `sonda-transacao-leitura`) (E) |
| Corrigir a falha de recuperação "broken" apontada pela auditoria | Atendido | Gerações com âncoras e cadeias próprias, em duas posições (desenho §4–§6); testes de integração 5, 6, 7, 12 e 13 (E) |

## §3 Marcas por lançamento

| Requisito | Estado | Implementação e evidência |
| --- | --- | --- |
| Caminho `workspaces/{ws}/cash_projection_marks/{transactionId}` | Atendido | `functions/src/cash/projectionMarks.ts` (`cashProjectionMarkRef`) |
| Campos: identificador, versão aplicada, estado, fora de ordem, meses atingidos, reconstruções, marcos, atualização transacional | Atendido | `transactionId`; nó por impressão digital; `broken`; `pending` (≤ 16); `g`/`cut` e `anchors`; `updatedAt`; mesma transação do delta. Os **meses atingidos não ficam na marca**: o mês vem do conteúdo lido (garantido pela impressão), e guardá-lo exporia atividade (§6 do pedido). DATA_MODEL e desenho §4 |
| B03-01: atômica com o delta, idempotência preservada; nada de projeção sem prova, prova sem delta, duplo ou posterior provando predecessor ausente | Atendido | `applyCashPeriodWriteOnce` grava marca, delta e marca de entrega na mesma transação; reentrega é `duplicate`. Integração 1–4 (E); mutantes B01 e M1 mortos (E) |
| B03-02: cadeia de versões; viabilidade de `updateTime` × `updatedAt` provada no Emulator; criação, edição, várias edições, duplicado, fora de ordem, delta zero, anulação, exclusão, mudança de mês | Atendido | `updatedAt` ≠ `updateTime` em 40 de 40 escritas (`saidas/sonda-updatetime.log.txt`, E): identidade por impressão digital. Integração 1 (criação, edições, edição sem efeito, anulação, mês retroativo, exclusão), 2 (fora de ordem), 3 (reentrega e entregas simultâneas) (E); unidade "fora de ordem…", "criação, edição sem efeito, exclusão e recriação…" (E). Caso-limite registrado pela revisão financeira (F-07, INFO): com conteúdo repetido (A→B→A), um evento posterior pode casar antes dos predecessores. A INV-M continua valendo, então nenhuma ordem errada aprova valor que a projeção não contém; no produto, todo escritor grava `updatedAt`, e o caso não ocorre |
| B03-03: limites explícitos, correção preservada, recuperação registrada, conversão bloqueada; sem crescimento ilimitado; custo | Atendido | Teto de 16 pendências, 2 posições; acima, `broken` com `markRecoveryNeeded`, `markIssueCount`, log; cada delta continua aplicado. Integração 6 e 7 (E); mutantes B03 e B09 (E). A poda do gatilho guarda só as gerações vigente e preparada (integração 15; mutantes B13 a B16). Custo por entrega, lançamento, mês, workspace, prova e reconstrução: desenho §9, com as medições do parecer de escala |

## §4 Recuperação após reconstrução

| Requisito | Estado | Evidência |
| --- | --- | --- |
| 1. Distinguir cobertos pelo corte dos posteriores | Atendido | `covered_by_rebuild` sem mexer em cadeia; posteriores na preparada. Integração 8 (E) |
| 2. `broken` antigo não invalida para sempre a base reconstruída | Atendido | Cadeia `broken` fica na outra posição; integração 5, 6, 13 (E) |
| 3. Preservar posteriores ao corte não conciliados | Atendido | Integração 8 e 10; publicação recomeça se uma entrega posterior não alimentou a preparada (A01). Integração 9 (E); mutante B12 (E) |
| 4. Impedir aceitação de eventos fora de ordem | Atendido | Integração 2 e 8; propriedade INV-M (E) |
| 5. Respeitar a cerca existente | Atendido | Recomeços da P3-B intactos; 108/108 nas suítes de reconstrução e caixa (`int-copia-cash-fix-1.log`, E) |
| 6. Sem reaplicação de deltas | Atendido | Integração 3, 8 (reentrega `duplicate`) (E) |
| 7. Marca e projeção consistentes sob concorrência | Atendido | Integração 3 (entregas simultâneas) e 10 (edições antes do commit da página); modelo aleatório do revisor, 0 violação na árvore final (RV) |
| 8. Recuperação futura sem intervenção manual indevida | Atendido com risco registrado | A reconstrução (operação existente) recupera; `markRecoveryNeeded` registra; leitor e alerta ficam para a P7 (RR-R3-01) |
| Provas obrigatórias: broken antes do rebuild; rebuild sem e com concorrência; atrasado de antes do corte; posterior antes do predecessor; reentrega depois do rebuild; marca sem histórico; lançamento excluído; meses vazios ou órfãos; falha entre preparação e publicação | Atendido | Integração 5–6 (broken antes), 11 (sem histórico), 12 (excluído), 8 (concorrência, atrasado, reentrega, fora de ordem), 14 (falha entre preparação e publicação). Órfãos zerados e etiquetados na publicação: integração 12 e a suíte de reconstrução (E); mês vazio vale zero e mês sem etiqueta recusa: unidade da prova (E) |

## §5 Consistência no cliente

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Reconciliar receita mensal oficial, desconsideradas, estornos, marcas, meses e época de reconstrução | Atendido | `proveProjectionExclusions` e regra 5 de `consistency.ts` (E: `work-time-projection-proof`, 30 testes; `work-time-consistency`, 38) |
| Controle de geração das leituras; resultado antigo não valida versão nova | Atendido | Regras 1–4 (herdadas da R1/R2A, reexecutadas: E) e a transação de leitura (um instante). Chave da leitura por id com a janela; `read.window` conferido |
| Análise de `onSnapshot`, `fromCache`, servidor, escritas locais, fora de ordem, cancelamento, workspace, preferências, remontagem | Atendido | Relatório §C (análise por item) e testes: troca de workspace, de conta e de calendário; escuta encerrada; leitura que falha; retorno só do cache local; prévia montada depois de uma mutação ou durante uma sincronização, sobre o mesmo cache; provedor e prévia relendo as mesmas exclusões (E) |
| Sem prova: não converter, BRL, mensagem pt-BR, sem ids internos, sem persistir, sem prazo que aprove | Atendido | `ESTIMATE_UPDATING`; testes ex-N03, ex-M02, ex-P01 (59 s, 60 s e 3.600 s não aprovam) (E); E2E B03-b (axe) (E); parecer pt-BR |
| Mudança de mês para fora da janela, retroativa; não limitar ao mês atual | Atendido | Gancho "(R3, d)"; integração 1 (mês retroativo); E2E B03-e (E) |
| Exclusão física e reutilização de id sem prova falsa | Atendido | Integração 12 e 13; unidade da recriação; "nó ausente com o lido presente não prova" (A02) (E) |

## §6 Rules e segurança

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Isolamento, leitura só por autorizados, negação a externos, escrita só backend, sem listagem, deny por padrão, sem collection group | Atendido | `firestore.rules` (só `get`; `list`, `create`, `update`, `delete` falsos; `isBackendOwnedCollection`); suítes de Rules das marcas 17/17: a matriz (6) e os ataques do revisor de segurança (11), no script oficial `test:rules:projection-marks` (`rules-marcas-oficial-3.log` e `verify:all`, E) |
| Campos minimizados; metadados de meses analisados | Atendido | Sem valor, descrição, data, mês ou preferência. As impressões são dado pseudonimizado: análise de confirmação por hipótese, decisão e risco aceito no desenho §3, com os números das sondas do parecer de privacidade; poda das gerações superadas no desenho §4. Os meses não são guardados (desenho §4) |
| Documentar modelo de dados e retenção | Atendido | `DATA_MODEL.md`, `DATA_RETENTION_LIFECYCLE.md`, `SECURITY_MODEL.md`, `BACKUP_RESTORE_DR.md`, `AUTH_RBAC_WORKSPACES.md`, `THREAT_MODEL.md` e `PRIVACY_LGPD.md` (§3, linha 26; §6.4, com o requisito da P8; §9) |
| Sem índice composto sem necessidade | Atendido | Nenhum índice composto. Os 6 campos de `cash_projection_marks` estão isentos de índice de campo único em `firestore.indexes.json`, porque nada consulta a coleção (teste de unidade) |

## §7 Domínios financeiros

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Contratos de caixa, contas, recorrentes, empréstimos, recebíveis, cartões, divisão, investimentos, relatórios preservados; nenhuma segunda fonte de verdade; ledger intocado | Atendido | Nenhum produtor de `transactions` mudou; os meses continuam com os dois escritores de antes; o cálculo do mês é o mesmo. `verify:all` final com saída 0, 3.250 testes (E); parecer financeiro |
| Mudança em escritor financeiro só excepcional e justificada | Atendido | Única mudança de efeito financeiro: a publicação da reconstrução recomeça em vez de publicar categorias e marcas sem uma entrega (A01). Justificada pelo contraexemplo e revisada |

## §8 RR-R2A-04

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Investigar com instrumentação; não classificar como ambiental; não só aumentar timeout; corrigir a causa | Atendido | `rr-r2a-04.md`: linha do tempo do log, mecanismo no cliente, correção, 7 testes determinísticos, mutantes Q01–Q05; E2E ×10 (20/20) e ×5 sob carga (10/10) (E); `verify:all` final com saída 0, 3.250 testes |

## §9 Testes

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Backend: versões consecutivas, fora de ordem, reentrega, concorrência, delta zero, falha antes e depois do commit, mês retroativo, exclusões, anulações, estornos, rebuild com eventos, rebuild de broken, teto, recuperação após esgotar tentativas, idempotência | Atendido | Integração 1–16 (E), inclusive a poda (15) e a corrida âncora × gatilho (16); estornos: B01 do gancho e prova de estorno (E) |
| Propriedade: proven ⇒ valor certo, com oráculo independente; regressão T02 | Atendido | INV-M (4.000 cenários, backend) e propriedade da prova (6.000 casos, cliente) (E); modelo aleatório do revisor com as funções reais, 0 violação na árvore final (RV); "regressão T02" (E) |
| Rules: owner, admin, member, viewer, outro workspace, desligado, anônimo, sem limite, acima do limite, escrita direta, modificação da marca, consulta por ids | Atendido | Suítes de Rules das marcas 17/17: matriz 6 e ataques 11 (`rules-marcas-oficial-3.log` e `verify:all`, E) |
| E2E: outra sessão, indisponível, retorno após reconciliação, exclusões pessoais, reconstrução, mudança de mês, responsividade e a11y, sem valor errado nas transições | Atendido | `e2e/work-time-b03.spec.ts` B03-a a B03-e, `--repeat-each=3`: 15/15 (E) |
| Reexecutar testes da R2A de calendário e editor; não enfraquecer S01/S03 nem mutantes | Atendido | Unidade do tempo de trabalho 211/211; E2E `work-time-p5f` 19/19; mutantes da R2A 38/38 na árvore da R3 (E) |

## §10–§11 Revisões e regressão

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Revisões das seis especialidades e da interação gatilho × reconstrução × leitura; corrigir HIGH/MEDIUM e revisar de novo | Atendido. Rodada 1: FAIL com HIGH ou MEDIUM em arquitetura, financeiro, segurança, escala, privacidade, pt-BR e observabilidade (plataforma PASS); todos corrigidos e revistos, com PASS na rodada 2. Depois do gate (rodada 1, FAIL só por evidência), as rodadas 3 e 4, só de documentos: privacidade PASS nas rodadas 3 e 4, sem achado novo na 4 (N-PRI-03 no RR-R3-08; N-PRI-04 para a P8); segurança PASS na rodada 3 (0 HIGH, 0 MEDIUM, 0 LOW e 2 INFO aplicados); observabilidade e plataforma PASS nas rodadas 3 e 4; escala FAIL na rodada 3 (R3-M1, MEDIUM, só texto), corrigida e PASS na rodada 4 | `revisoes/LEIAME.md` |
| `verify:all` sem remoção silenciosa, sem skip/only, sem timeout aumentado, TS e lint sem erro, Emulator exclusivo, mutantes dos invariantes novos | Atendido: saída 0 na 1ª execução, 3.250 testes, 0 falha, 0 skip, lint 0 erro (201 avisos, iguais à R2A), mutantes dos invariantes novos mortos | `testes-e-resultados.md`; mutantes: cliente 29/29, backend 16/16, rápidos 7/7, R2A 38/38 (E) |

## §12–§13 Documentação e entrega

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Seção da R3 no plano mestre; evidência própria com executados, herdados, reproduzidos e não executados | Atendido | Plano §20.18; este diretório; `testes-e-resultados.md` |
| Relatório, matriz, evidências, pareceres, patch binário sobre a R2A, manifesto, SHA-256, pacote cumulativo, instruções | Atendido | Pacote de auditoria (`LEIAME.md`, `REPRODUCAO.md`, `SHA256SUMS`) |

## §14 Critérios de aceite do B03

| Critério | Estado | Evidência |
| --- | --- | --- |
| A projeção identifica os efeitos aplicados por lançamento | Atendido | INV-M (E, RV) |
| Fora de ordem não aprova | Atendido | Integração 2 e 8; propriedades (E) |
| Duplicados não duplicam | Atendido | Integração 3 (E) |
| Mudança de mês sem receita omitida ou descontada errado | Atendido | Integração 1; gancho (R3, d); E2E B03-e (E) |
| Broken recuperável com segurança | Atendido | Integração 5, 6, 7, 13 (E) |
| Reconstrução preserva os posteriores ao corte | Atendido | Integração 8, 9, 10 (E) |
| Falha definitiva do gatilho impede conversão não comprovada | Atendido | Integração 5 (retry esgotado) (E) |
| Cliente não aceita resposta obsoleta | Atendido | Regras 1–5, transação de leitura, chave com a janela (E) |
| Rules mantêm isolamento e autoridade | Atendido | Suíte de Rules (E); parecer de segurança |
| Performance e custo aceitáveis | Atendido: modelo de custo completo, separando medido de estimado (desenho §9). Custo limitado por tentativa (13 meses e 100 marcas, testado) e por hora: pelo orçamento dos agendadores nas releituras agendadas e pelos limites de escrita do servidor na liberação por volta da projeção (desenho §9; R3-M1); riscos RR-R3-01 e RR-R3-09. Parecer de escala: PASS na rodada 4 | Parecer de escala |
| Domínios anteriores íntegros | Atendido: `verify:all` com 3.250 testes, 0 falha e nenhum script com teste a menos que na R2A. Ledger, saldos, centavos e regras de efeito sem mudança. Parecer financeiro PASS na rodada 2 | `verify:all`; parecer financeiro |
| RR-R2A-04 resolvido ou caracterizado | Atendido | `rr-r2a-04.md` |

**Não executado (NE):**
- ambientes DEV, STAGING e PROD reais: proibidos nesta etapa;
- exercício de restauração de DR: P7 e P10;
- o critério 2.5.8 da WCAG 2.2 (alvo de 24 px): o gate do projeto é a WCAG 2.1, e o botão do estado de erro é anterior à R3.
