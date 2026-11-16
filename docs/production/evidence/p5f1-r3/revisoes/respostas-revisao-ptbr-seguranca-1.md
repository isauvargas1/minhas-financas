# P5-F.1-R3 — respostas às revisões pt-BR e multi-tenant (rodada 1)

## `ptbr-product-ui-review` (FAIL: M-01, M-02)

| ID | Severidade | Resposta | Onde | Evidência |
| --- | --- | --- | --- | --- |
| M-01 | MEDIUM | **Corrigido** pela opção (a) do parecer: o texto de `ESTIMATE_UPDATING` deixa de apontar causa. Agora: "A estimativa está em atualização: ainda não foi possível confirmá-la com os totais oficiais. Enquanto isso, os valores ficam em reais." Ele vale para qualquer motivo da prova (projeção, bases ou marcas). Sem mudança visual nem de componente. | `src/modules/work-time/messages.ts`; `e2e/work-time-b03.spec.ts` (`UPDATING_TEXT`) | Teste de unidade novo: sem desconsiderada, 12 meses e a escuta sem retorno do servidor. Depois do tempo de interface aparece o texto (sem "desconsiderada"), sem conversão; com o retorno, a estimativa provada |
| M-02 | MEDIUM | **Corrigido.** O B03-b ganhou a sequência por teclado em desktop e em 375×812: Tab a partir do título até "Tentar de novo", `:focus-visible` e anel de foco, Enter e Espaço pedindo de novo o relatório, foco mantido no botão. Os E2E vizinhos (`work-time-p5f`, `cash-pending-entries`, `work-time-b03`) rodam de novo na árvore final, no `verify:all` | `e2e/work-time-b03.spec.ts` (`expectKeyboardRetry`) | `logs/execucoes/r3-b03-teclado.log`; `verify:all` final |
| L-01 | LOW | **Classificado, sem mudança.** Os textos "a estimativa não carregou" do painel e da contagem são anteriores à R3, e o estado "em atualização" usa o ramo de erro que já existia. Separar o estado exigiria um ramo novo no componente, mudança de UI que a correção de M-01 pela opção (a) não precisa. Risco: texto impreciso no painel enquanto não há prova; os valores ficam em reais | — | — |
| L-02 | LOW | **Classificado, sem mudança.** "Tentar de novo" relê a série, os lançamentos e as marcas (pelo orçamento das releituras). O texto não muda enquanto a prova não chega, e o padrão é o mesmo dos outros erros de `EstimateSummary`, anterior à R3 | — | — |
| L-03 | LOW | **Corrigido.** Teste de unidade novo: a leitura das marcas falha, aparece o erro fixo em pt-BR (`ESTIMATE_EXCLUDED_READ_FAILED`) com "Tentar de novo", nunca a conversão, e o "Tentar de novo" prova | `tests/unit/work-time-consistency.test.ts` | `unit-work-time-3.log` |
| I-01 | INFO | Classificado: `role="alert"` vem do ramo de erro existente; a WCAG 2.1 4.1.3 é atendida | — | — |
| I-02 | INFO | Classificado: alvo anterior à R3; a exceção de espaçamento da 2.5.8 é atendida; o gate do projeto é a WCAG 2.1 | — | — |
| I-03 | INFO | Classificado: cronômetros independentes por instância da estimativa, por até 30 s | — | — |
| I-04 | INFO | Classificado: estados persistentes (A04 da revisão de arquitetura), registrados no plano como RR-R3-01 | — | — |
| I-05 | INFO | Classificado: sem efeito visual; o custo está no parecer de escala | — | — |

## `multi-tenant-security-review` (FAIL: M1)

| ID | Severidade | Resposta | Onde | Evidência |
| --- | --- | --- | --- | --- |
| M1 | MEDIUM | **Corrigido.** Os 11 testes de ataque do revisor entraram na suíte oficial como estavam; só trocaram o `WT_DIR` por caminhos relativos ao próprio arquivo. Cobrem: <br>• leitura A→B e B→A pelos quatro papéis (get, consulta por id, listagem, contagem, transação), com controle positivo; <br>• escrita cruzada nos dois sentidos (create, overwrite, merge, update, delete, lote, transação), com as marcas conferidas intactas; <br>• não membros (removido, conta suspensa, sem perfil, membership sem status, sem membership, claims forjadas) e anônimo; <br>• consulta de grupo; caminho × conteúdo; subcaminhos; workspace arquivado; <br>• tetos do cliente (13 + 100); revogação no meio da transação; `verify` sem oráculo de existência; estado backend-only. <br>`test:rules:projection-marks` roda as duas suítes, com `--test-concurrency=1` | `tests/firestore/cash-projection-marks-p5f1r3-ataques.rules.integration.test.mjs`; `package.json` | `logs/execucoes/rules-marcas-oficial-3.log` |
| L1 | LOW | **Corrigido.** Linha da coleção na matriz canônica de papéis e no ativo A2 do modelo de ameaças | `docs/production/AUTH_RBAC_WORKSPACES.md`; `docs/production/THREAT_MODEL.md` | — |
| I1 | INFO | Classificado: as impressões de versões antigas não expõem nada além do que `activity_logs` já mostra a membros; reavaliar com o PR-RULES-02 (registrado no plano) | — | — |
| I2 | INFO | Classificado: custo da reconstrução, no parecer de escala | — | — |
| I3 | INFO | Classificado: anterior à R3; `markSlot` não é sensível | — | — |
| I4 | INFO | **Corrigido.** `predeploy:rules` compila as Functions antes das suítes, então a paridade da impressão confere o código atual | `package.json` | — |
| I5 | INFO | **Corrigido.** A §20.18 existe no plano mestre | `PRODUCTION_READINESS_PLAN.md` | — |

**Pedido de nova rodada:** conferir M-01, M-02 e L-03 (pt-BR) e M1, L1, I4 e I5 (segurança) na árvore final, com as execuções citadas.
