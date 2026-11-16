# P5-F.1-R1 — vereditos das skills e das revisões independentes

**Escopo.** O delta da R1 sobre a árvore da P5-F.1 (`d9b33cd1`), avaliado na árvore `aff667a56061487cfdf45eb1536b9d54eb113949`, a do `verify:all` final (saída 0 em 41 min 42 s: 3.136 testes (1.671 + 1.256 do node e 209 E2E), 0 FAIL, 0 SKIP, 0 RETRY; lint com 0 erros e 201 avisos). Depois dela, só documentos mudaram (`patches/mudancas-depois-do-verify-all.txt`, no pacote).

O código e os testes dessa árvore são os que as revisões independentes leram, nesta ordem:
- a árvore `d7dabb10`, lida pela revisão 2;
- mais as correções da revisão 2 (4 arquivos de `src/`, 4 testes de unidade e o E2E), lidas pela revisão 3 na árvore `6c459430`;
- mais as correções da revisão 3 (os três testes do limite da espera e documentos; `src/` não mudou), lidas pela revisão 4 na árvore `775db140`;
- mais as correções da revisão 4 (dois componentes, a guarda, o E2E do B02, a quebra de linhas de dois testes do backend e documentos), lidas pela revisão 5 na árvore `aff667a5`, a mesma do `verify:all` final.

Cada skill foi aplicada no escopo da própria política:
- as seções do checklist exercitadas pelo delta;
- as invariantes que ele poderia violar;
- os itens que o plano atribui à P5 ou a milestones anteriores.

Os vereditos da P5-F.1 (`evidence/p5f1/VEREDITOS.md`) continuam valendo para o que a R1 não tocou.

**Evidências:**
- [`matriz-bloqueadores.md`](matriz-bloqueadores.md);
- [`rotinas-matematica.md`](rotinas-matematica.md);
- [`consistencia-estimativa.md`](consistencia-estimativa.md);
- [`mutantes.md`](mutantes.md): 77/77 de unidade e 5/5 do E2E;
- [`execucoes.md`](execucoes.md);
- [`visual/`](visual/);
- [`revisoes/`](revisoes/).

## Skills exigidas pela superfície tocada

| Superfície | Skill | Veredito |
| --- | --- | --- |
| Cálculo da estimativa, exclusões, estornos, leitura de dados financeiros | `financial-domain-integrity` | **FAIL** |
| Consultas (leitura por id do servidor, leitura em par), escuta das projeções, custo | `firestore-scale-cost-review` | PASS |
| Leituras sob Rules de membros, suíte de Rules alterada | `multi-tenant-security-review` | PASS |
| Textos, avisos e estados renderizados | `ptbr-product-ui-review` | **FAIL** |
| Fechamento | `regression-release-gate` | **FAIL** |

**Fora da superfície da R1, com prova:**
- `billing-entitlement-integrity`: nenhum arquivo de Stripe, plano, assinatura ou quota no delta (`patches/arquivos-r1.txt`).
- `firebase-production-readiness`: sem diff em `firebase.json`, `.firebaserc`, Rules, índices, exports ou opções das Functions. Em `functions/`, só testes.
- `privacy-lgpd-data-lifecycle`: nenhum dado pessoal novo coletado, gravado ou enviado. O contrato da preferência é o mesmo da P5-F.1, e as Rules não mudaram. A R1 só lê dados financeiros do workspace, que já eram lidos.
- `observability-incident-readiness`: nenhum log, métrica, alerta, auditoria ou job no delta.
- `saas-commercial-readiness`: nenhuma superfície pública no delta.

## FAIL — Financial domain integrity

**Escopo.** Só a estimativa de exibição: renda oficial, exclusões, estornos, horas e conversão. A R1 lê dados financeiros oficiais e não grava nenhum. Nenhuma operação, callable, gatilho, projeção, relatório, lançamento, saldo, fatura ou investimento mudou. Em `functions/`, só testes: a fixture de IDs e uma asserção na integração P3-I.

**Mapa de autoridade.**

| Número | Fonte oficial | Quem grava | Efeito da R1 |
| --- | --- | --- | --- |
| Receita do mês (`incomeCents` da projeção, `receiptsCents` do relatório) | `cash_report_periods`, pelo gatilho de caixa; lida por `getFinancialReport` | Backend (inalterado) | Lida. O `updatedAt` do mesmo documento passa a ser lido como versão, sem escrita |
| Recebimento desconsiderado e espelho do estorno | `transactions` (`recvcash_…`), gravados pelas callables de recebíveis na mesma transação | Backend (inalterado) | Lidos por id, em par e do servidor (`src/modules/transactions/api.ts:169`). O cliente não grava (`firestore.rules:614-617`) |
| Renda da janela, horas, valor da hora, minutos convertidos | Nenhuma | Ninguém (em memória) | Calculados em memória e mostrados só com prova; nunca gravados |

**Semântica dos movimentos.**
- Recebimento de cliente (receita de caixa) e o estorno dele: o espelho com `reversalOf` e principal oposto, no mesmo mês.
- Desconsiderar A, que foi estornado, não tira nada: o estorno já anula A no total oficial do mês (`excludedItemOf`, `src/modules/work-time/incomeBasis.ts:126-140`).
- B não é afetado.
- Nenhuma reclassificação; nada decidido por descrição ou categoria.
- PF e PJ: uma fonte por vez, com o PJ sujeito à confirmação, como na P5-F.1.

**Matriz de evidência.**

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos e minutos inteiros, com BigInt nos produtos (inalterado). Datas civis `YYYY-MM-DD`. O `updatedAt` do servidor só ordena versões e nunca entra em valor |
| Semântica financeira | PASS | O estorno é confirmado pelo ID oficial derivado do movimento (`receivableReversal.ts:33-39`, paridade com o backend pela fixture), pela marca, por `reversalOf`, pelo mês e pelo principal oposto. Sem confirmação, a estimativa fica suspensa (`exclusion_unconfirmed`). Sem dupla contagem: o A/B do parecer dá R$ 100,00 |
| Autoridade e atomicidade | PASS | Nenhuma escrita nova. As Rules negam escrita do cliente em `transactions`, e a suíte da P5-F confere que o cliente não grava o espelho |
| Operações críticas e eventos | N/A | Provado pela lista de arquivos: nenhuma operação, evento, idempotência ou concorrência de escrita mudou |
| Histórico e auditabilidade | PASS | A exclusão nunca altera o lançamento; o estorno e o recebimento continuam como estão; nada é apagado |
| Fontes, totais, projeções e relatórios | **FAIL** | A estimativa só aparece com a prova contra a projeção confirmada pelo servidor (`src/modules/work-time/consistency.ts:227-244`), com cinco regras: projeção, receita das bases, ordem da leitura por id e escritas conhecidas. Sem prova, aparece a última provada da mesma identidade ou nenhuma conversão, e a memória de cálculo reconstrói o total. **Mas a prova não cobre três casos** (`consistencia-estimativa.md` §6): em (a), a espera termina por tempo; em (b), a versão passa da escrita sem incluí-la; em (c), o mês de antes não é conhecido. Neles, até o gatilho gravar, a renda mostrada pode estar acima ou abaixo da oficial, e em (a) e (b) pode abater outra receita (M01) |
| Substituição de domínio e legado | PASS | A retenção heurística da P5-F.1 foi substituída pela prova no mesmo delta: `holdEstimate` recebe a prova (`useIncomeEstimateWith.ts:150`, fixado pela guarda), sem flag nem caminho antigo. O desconto do recebimento estornado e o texto "Volte a considerá-lo" saíram |
| Migração com dados reais | N/A | Não há dados reais; nada é migrado |
| Testes obrigatórios | PASS | **Criação:** exclusão de recebimento, estimativa com exclusões e configuração nova.<br>**Edição:** a desconsiderada editada antes do gatilho (N03) e a edição sem efeito na renda.<br>**Estorno e anulação:** estorno depois da exclusão, em outra sessão e durante a releitura; anulação durante a sincronização.<br>**Retry:** releitura com orçamento, "Tentar de novo" e escuta reaberta (N05).<br>**Concorrência:** três ordens de resposta, R11-01, R11-02, R8-02 e R10-02, conferindo todas as renderizações.<br>**Autoridade:** Rules no Emulator.<br>**Atomicidade:** N/A, nenhuma escrita composta |

**Reconciliação.**
- **Estimativa** = Σ meses (`receiptsCents` oficial − contribuição das desconsideradas no mês) ÷ Σ minutos dos mesmos meses. A contribuição de um recebimento com estorno confirmado é 0.
- **Só aparece** quando:
  - a receita das bases é a da projeção (regra 3);
  - a leitura por id começou depois da versão atual de cada mês com desconsiderada (regra 4);
  - nenhuma escrita conhecida é posterior (regra 5).
- **Limites** (a) a (c): `consistencia-estimativa.md` §6. (c), e o estorno em (b), só superestimam. Em (a) e (b), uma desconsiderada que sobe de valor subestima a renda até o gatilho gravar (revisão 2, M01). (b) e (c) só se fecham mudando a arquitetura financeira: a projeção teria de registrar quais escritas aplicou. O (a) tem um fallback local, o fail-closed estrito, que o pedido exige onde não há prova (`pedido-r1.md:149`). A R1 não o adotou, porque ele deixa a estimativa em reais, às vezes por meses, depois de uma edição sem efeito na renda; ficou para decisão. Não há PASS com ressalvas: por eles, este veredito é FAIL.

**Retry e concorrência.**
- A leitura por id é do servidor e só começa depois do primeiro retorno da escuta.
- A releitura é agendada com orçamento.
- A espera limitada é de 30 s para as escritas que o gatilho pode não gravar, contados da escrita na hora do servidor das bases (revisão 2, M02).
- A política é fail-closed em cada renderização, conferida nos testes de gancho.

**Legado removido.** O caminho que descontava o recebimento estornado e a retenção heurística. Nenhuma fonte concorrente.

**Achados bloqueantes.**
- **B03 aberto em (a), (b) e (c).**
  - Invariante: a estimativa mostrada corresponde a um estado oficial único.
  - Cenário: a edição de valor de uma desconsiderada (R$ 500,00 → R$ 800,00) com o gatilho mais lento que 30 s, ou com o gatilho de outra escrita do mesmo mês rodando antes. Até o gatilho gravar, mostra R$ 10.260,00 no lugar de R$ 10.560,00 em (a), e R$ 10.360,00 em (b).
  - Impacto: a conversão em tempo de trabalho fica errada por alguns segundos, ou mais com retentativas. Nada é gravado, e os valores em reais não mudam.
  - Remediação: a projeção registrar o que aplicou, ou outro mecanismo verificável sobre as fontes oficiais (mudança de arquitetura, que exige autorização). Ou, só para (a), o fail-closed estrito, que não fecha (b) e (c). Ou a aceitação formal do risco (`consistencia-estimativa.md` §6).
- **B02 aberto num caso (revisão 5, S01).**
  - Invariante: as horas de um dia nunca passam do que é possível.
  - Cenário: segunda 20:00–06:00 reduzida a 8 h e terça 00:00–08:00 somam 960 min, quando cabem 720; o conferidor aceita.
  - Impacto: a hora sai subestimada, e o tempo convertido, superestimado. Nada é gravado, e os valores em reais não mudam.
  - Remediação: recusar a combinação, tratando como sem cálculo seguro o dia seguinte à véspera reduzida (`rotinas-matematica.md` §6). É local e fica para a próxima etapa.

**Verificação.** Testes dirigidos de unidade e gancho, Rules no Emulator, E2E `B01 (P5-F.1-R1)`, mutantes de unidade e o mutante E2E do B01, e o `verify:all` (saída 0 em 41 min 42 s: 3.136 testes (1.671 + 1.256 do node e 209 E2E), 0 FAIL, 0 SKIP, 0 RETRY; lint com 0 erros e 201 avisos).

## PASS — Firestore scale/cost review

**Escopo.**
- A leitura por id das desconsideradas, que passa a vir do servidor e a trazer os espelhos de estorno.
- A escuta das projeções da janela: a mesma consulta, agora com o campo `updatedAt`.
- O agendador da releitura por id.

Nenhuma escrita, índice, Rule ou listener novo.

| Item | Resultado | Evidência |
| --- | --- | --- |
| Isolamento e limites | PASS | **Leituras** sob `workspaces/{incomeWorkspaceId}/transactions` e `…/cash_report_periods` (`api.ts:160-169`; `firestore.rules:614-617` e `788-792`).<br>**Emulator:** a leitura em par é negada a outro workspace, a membro removido, a conta suspensa e a anônimo (`work-time-p5f.rules.integration.test.mjs:468`) |
| Paginação e limites | PASS | **Leitura por id** limitada pela lista: até 50 desconsideradas e os espelhos, no máximo 100 documentos, em até 4 consultas `documentId() in` de 30, lado a lado e sem ID repetido (`pairedReadIds`, teste com mais de 30 IDs).<br>**Escuta:** `documentId()` entre o primeiro e o último mês da janela, `limit(13)`, inalterada |
| Índices | PASS | `documentId() in` e o intervalo de `documentId()` não precisam de composto. `firestore.indexes.json` sem diff |
| Listeners | PASS | Nenhum novo. O existente lê um campo a mais dos mesmos documentos; o retorno só do cache não vale |
| Leituras e execução | PASS | `getDocsFromServer` não usa o atalho do cache: cada leitura cobra os documentos lidos. A releitura só acontece numa versão nova de um mês com desconsiderada depois do começo da leitura, com orçamento: agrupada em 5 s, 5 seguidas e mais 1 a cada 120 s. Sem polling (guarda) |
| Escritas e modelo | N/A | Nenhuma escrita nem documento novo |
| Legado | PASS | A leitura por id do cache (`getDocs`) saiu; a guarda e o mutante U66 garantem que não volta |
| Custo | PASS | **Caso comum:** nada a mais.<br>**Pior caso por releitura:** 100 leituras de documento; o orçamento limita a cerca de 30 por hora por estimativa aberta.<br>**Projeções:** os mesmos 3 a 13 documentos da P5-F.1 |
| Emulator | PASS | Rules da P5-F no `verify:all`. O SDK real confere: sem rede, `getDocs` responde do cache e `getDocsFromServer` falha como `unavailable`; de volta à rede, lê do servidor |

**Verificação.** Rules no Emulator dentro do `verify:all` (saída 0 em 41 min 42 s: 3.136 testes (1.671 + 1.256 do node e 209 E2E), 0 FAIL, 0 SKIP, 0 RETRY; lint com 0 erros e 201 avisos), guarda, mutantes U66 e U67, e o E2E da P5-F.1 e da R1.

## PASS — Multi-tenant security review

**Escopo e fronteiras de confiança.** Leituras do cliente, sob as Rules, no workspace-fonte da renda:
- lançamentos por id, inclusive os IDs dos espelhos de estorno derivados no cliente;
- o `updatedAt` das projeções.

Nenhuma Rule, callable ou escrita mudou.

| Item | Resultado | Evidência |
| --- | --- | --- |
| Identidade, workspace e vínculo | PASS | O caminho é o do workspace-fonte, e as Rules exigem vínculo ativo: `isMember`, `firestore.rules:614-617` para lançamentos e `788-792` para projeções. Emulator com dois workspaces: outro workspace, membro removido, conta suspensa e anônimo negados |
| RBAC | PASS | Só leitura, para qualquer papel com vínculo, viewer inclusive; nenhuma escrita |
| Integridade de dados | PASS | O ID derivado não decide nada sozinho: o documento precisa confirmar o estorno. O cliente não grava espelho nem lançamento (Rules e teste), então um espelho forjado não existe |
| Camadas independentes | PASS | **Rules:** negam a escrita. **Backend:** inalterado, grava os espelhos em transação (`functions/src/receivables`) |
| Auditoria, segredos e Storage | N/A | Nenhuma ação sensível, segredo ou Storage no delta |
| Testes no Emulator | PASS | Suíte da P5-F, com o teste novo da R1, no `verify:all` |

**Caminhos de ataque tentados.**
- **IDOR com IDs derivados de outro workspace:** a consulta é presa ao caminho do workspace-fonte, e as Rules negam o caminho de outro.
- **Espelho forjado:** a escrita do cliente é negada.
- **Cache de outra conta no mesmo navegador:** a leitura do servidor não usa o cache local, e a troca de conta já era testada na P5-F.1.

## FAIL — revisão de UI de produto em PT-BR

**Escopo.** Superfícies tocadas pela R1:
- Configurações: o editor de rotinas, o aviso junto do botão de salvar, a prévia indisponível e o calendário de exceções;
- a memória de cálculo: as notas `capped_days` e `exclusions_reversed` e a explicação dos turnos;
- o painel "Receitas consideradas", com o texto do recebimento estornado;
- o aviso do topo, quando a estimativa não se confirma;
- o assistente, no passo da seção recusada;
- Configurações aberta com uma configuração gravada que o editor recusa: fora de edição (revisão 4, Q02).

Justificativa de cada mudança:
- **validação:** recusar configuração sem cálculo seguro (B02);
- **estado:** a estimativa indisponível ou não confirmada (B03);
- **contrato:** a exclusão que não desconta (B01);
- **estado (Q02):** sem mudança da pessoa, a tela não fica em edição, como na P5-F.1. A correção é a menor possível: a fiação de `edited` entre o editor e a tela.

**Evidências do código:** os textos estão em `src/modules/work-time/messages.ts` e `draft.ts` (`routinesAmbiguityMessage`, `calendarAmbiguityMessage`); os avisos, em `RoutineEditor.tsx` e `WorkTimeSettingsView.tsx`. Todos em pt-BR, sem detalhe interno, com a ação que resolve. O aviso da estimativa que usa a leitura anterior diz que não foi possível atualizar, e não que falhou, porque também vale para a confirmação pendente (revisão 2, M05).

**Evidências de execução:**
- E2E `B02 (P5-F.1-R1)`, `B02 (revisão da R1, N07)` e `B01 (P5-F.1-R1)`: textos exatos, `role="alert"`, salvar desabilitado, nada gravado e axe no escopo dos avisos.
- E2E `B02 (P5-F.1-R1)`, passos da revisão 4: a configuração gravada recusada abre fora de edição; a edição de verdade põe a tela em edição; "Descartar alterações" volta ao gravado; a correção vinda de outro dispositivo entra sem aviso de conflito.
- Capturas da R1 (`visual/`), refeitas depois da revisão 4: 16 combinações dos 4 estados novos (1440 × 900 e 390 × 844, claro e escuro). Foram 12/12 testes, axe com 0 violações, sem transbordamento e sem aviso coberto (o menu lateral recolhido antes da troca de largura). O tema escuro foi aplicado (fundo `rgb(11, 17, 32)`), e o aviso tem `role="alert"`.
- Antes × depois, no mesmo estado e na mesma viewport, nas árvores da P5-F.1 e da R1: com rotinas válidas, a prévia e a rotina têm 0 pixels diferentes. A página cresce 32 px: as duas linhas da frase nova da ajuda das rotinas, que explica a recusa. O resto são 84 pixels esparsos de antisserrilhado, nenhum de layout (conferido por coluna). Nos estados com cruzamento, mudam só os avisos, o salvar desabilitado, a prévia indisponível e o Dashboard, que volta a reais (`visual/LEIAME.md`).
- Teclado: o aviso não toma o foco, que fica no botão usado ("Aplicar aos dias marcados", "Incluir exceção"); ele é anunciado por `role="alert"`, e o Tab segue a ordem da tela (JSON de cada captura). O salvar desabilitado não recebe foco.

**Comparação antes/depois.**
- O que mudou: os avisos, o salvar desabilitado diante da configuração sem cálculo seguro, a prévia indisponível no lugar do valor errado e o Dashboard em reais.
- O que não mudou: o resto da página.

**Achados.** O da revisão 4 (Q02, a tela aberta como editada) foi corrigido, com E2E e mutantes.

**Bloqueador para PASS (revisão 5, S03).** A correção do Q02 mexeu no estado de edição do editor de rotinas, mas dois caminhos dele não são exercitados por nenhum teste:
- a validação: a digitação inválida deve pôr a tela em edição;
- a jornada para aplicar a vários dias, mudada sem aplicar, não deve pôr.

O checklist exige exercitar a validação do fluxo alterado (§7, item 3) e não aceita critério sem comprovação. Dois mutantes semânticos sobrevivem. O código está certo nos dois casos pela leitura (revisão 5, §2.2), mas falta o teste. A correção é acrescentar esses passos ao E2E "B02 (P5-F.1-R1)", com mutantes, na próxima etapa.

**Riscos residuais.** Débitos de acessibilidade anteriores do Dashboard, registrados na P5-F.1 e fora do delta.

## FAIL — regression release gate

**Escopo Git.**
- Base: a árvore `d9b33cd1` (P5-F.1) sobre o commit `1730a1df`.
- Worktree isolado na branch local `feat/p5-f1-r1-corrections-2026-11-05`, `HEAD` `1730a1df`, sem nada staged.
- Delta: `patches/arquivos-r1.txt`.

**Evidências.**

| Etapa | Comando | Resultado |
| --- | --- | --- |
| Typecheck, lint, builds, unitários | `verify:fast` (no `verify:all`) | 1.671 testes do node em 18 scripts, 0 falha, 0 skip; typecheck e builds sem erro (Vite em 26,80s e 27,01s); lint com 0 erros e 201 avisos, os da P5-F.1 |
| Integração, Emulator e Rules | `test:integration:emulator` (no `verify:all`) | 1.256 testes em 21 scripts (Functions no Emulator, ferramentas e todas as suítes de Rules), 0 falha, 0 skip |
| Playwright E2E completo | `test:e2e` (no `verify:all`) | 209 passed (18,0 min), 0 failed, 0 flaky, 0 skipped; sem `CI` no ambiente, o Playwright não repete testes (`retries: process.env.CI ? 2 : 0`) |
| `git diff --check` do delta | `git diff --check d9b33cd1 <final>` | saída 0, sem nenhuma linha (`logs/execucoes/diff-check-aff667a5.log`) |
| Mutantes | `mutantes.md` | 77/77 de unidade e 5/5 do E2E |
| Smoke adjacente | E2E da P5-F e da P5-F.1 inteiros, e as superfícies convertidas | no `verify:all` |

**Achados.**
- `financial-domain-integrity` em **FAIL**: o B03 continua aberto nos casos (a), (b) e (c), e o B02, num caso (acima).
- `ptbr-product-ui-review` em **FAIL**: a validação do editor de rotinas, que a correção do Q02 tocou, não tem teste (S03). Pela tabela do gate, uma skill de domínio em FAIL reprova o gate, mesmo com todas as execuções verdes.
- Nenhuma falha de teste, build, lint, Rules ou E2E (tabela acima).

**Skips e cobertura:**
- 0 skip, 0 todo e 0 cancelado no node; 0 skipped, 0 flaky e 0 "did not run" no Playwright, com retries desligados (sem `CI`);
- nenhum teste removido, desativado ou com `only`;
- nenhum prazo existente aumentado;
- as asserções do contrato anterior foram reescritas para o novo.

**Mudanças de superfície:**
- **UI e textos:** só os do escopo acima.
- **Rotas:** nenhuma.
- **Contratos:** nenhum documento, campo, índice, Rule ou Function mudou. O tipo do resultado de `validateDraft` ganhou o campo opcional `ambiguity`, só no cliente.

**Riscos residuais.** RR-R1-01 é o B03 aberto, acima. RR-R1-02 a RR-R1-04 estão na §20.16 do plano.

**Skills de domínio.** As quatro acima: `financial-domain-integrity` FAIL, `firestore-scale-cost-review` PASS, `multi-tenant-security-review` PASS e `ptbr-product-ui-review` FAIL.

## Revisões independentes

Cinco revisões independentes, somente leitura, leram o delta. O índice, as sondas e os logs delas estão em [`revisoes/`](revisoes/LEIAME.md).

| Revisão | Árvore | Veredito | Depois dela |
| --- | --- | --- | --- |
| [1](revisoes/revisao-1.md) | `b97806c4` | FAIL: B02 reaberto (N01 HIGH, N02, N07); B03 incompleto (N03 a N06); N08 a N10 INFO | Cada achado corrigido, com teste que reprova numa cópia exata da árvore revisada ([respostas](revisoes/respostas-revisao-1.md)) |
| [2](revisoes/revisao-2.md) | `d7dabb10` | FAIL, sem defeito de código nos bloqueadores: M01 MEDIUM (direção do erro nos limites do B03); M02 a M05 LOW; M06 a M09 INFO | 4 arquivos de `src/`, testes e documentos ([respostas](revisoes/respostas-revisao-2.md)) |
| [3](revisoes/revisao-3.md) | `6c459430` | FAIL, sem defeito de código nos bloqueadores: P01 e P02 LOW (o limite da espera sem teste; afirmações falsas no rascunho deste arquivo); P03 a P06 INFO | Três testes e documentos; `src/` igual ([respostas](revisoes/respostas-revisao-3.md)) |
| [4](revisoes/revisao-4.md) | `775db140` | FAIL, sem defeito no cálculo nem na prova: Q01 e Q02 LOW (os logs das revisões fora da árvore pelo `.gitignore`; Configurações aberta como editada com uma configuração gravada recusada); Q03 e Q04 INFO | Dois componentes, a guarda, o E2E do B02 e documentos ([respostas](revisoes/respostas-revisao-4.md)) |
| [5](revisoes/revisao-5.md) | `aff667a5` | FAIL para a R1 inteira, de acordo com o veredito dela: Q01 a Q04 corrigidos; S01 MEDIUM (o B02 aberto no caso da véspera em jornada reduzida); S02 LOW e S03 a S07 INFO (textos e dois testes que faltam) | Documentos: o S01 declarado aberto, com a recusa local para a próxima etapa ([respostas](revisoes/respostas-revisao-5.md)) |

As revisões 2 a 4 deram o B03 como corrigido dentro dos limites registrados. O veredito da R1 é mais estrito: os três casos de `consistencia-estimativa.md` §6 deixam o B03 aberto, e por eles `financial-domain-integrity` e o gate ficam em FAIL. A revisão 5 concorda e acha também o B02 aberto num caso, que a R1 passou a declarar.
