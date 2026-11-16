PASS — Financial domain integrity

Rodada 2 da revisão independente da P5-F.1-R3.1 (R3-AUD-01) pela skill `financial-domain-integrity`, feita em 2026-11-10, só com leitura. Nada foi alterado no worktree nem no índice. Não rodei Emulator, E2E, build nem `verify*`; rodei só os dois arquivos de unidade alterados, um por vez.

- `W` = `<scratchpad>/wt-p5f1-r31`.
- Árvores: código final `d9fed573c803d64827ba278c347215054a31e0d2`; rodada 1 `40057d2a78c47fea537480b0a2bc21fc46e2a500`; base R3 `1c9155dbc8d6aedd35e6f39a63fac46b53d81919`.
- **Disco × árvore final** (às 21:55Z, `git hash-object` sem `-w`):
  - batem 3.474 dos 3.477 blobs. Todo arquivo fora de `docs/` (código, testes, Rules, índices, Functions) é idêntico à `d9fed573`;
  - diferem só três documentos de evidência ainda em edição: `matriz-antes-depois.md`, `mutantes.md` e `testes-substituidos.md`;
  - há documentos fora da árvore: `evidence/p5f1-r31/LEIAME.md` e `evidence/p5f1-r31/revisoes/`.
- **A cópia do meu parecer da rodada 1** (`revisoes/financeiro/PARECER-RODADA-1.md`) e das minhas saídas é fiel. Só os caminhos absolutos foram trocados por `<scratchpad>`, conferido com `diff` depois de normalizar.

**Veredito em uma frase.** O F-01 foi corrigido; as mudanças da rodada 2 só acrescentam afirmações aos testes e corrigem comentário e documentação; os testes alterados passaram nas versões finais, nas minhas execuções e nas do executor. Nenhum item aplicável desta skill falha. Ficam com o gate, sem condicionar este PASS (V-02 e N-01): a regressão consolidada `verify-all-2`, ainda em curso, e o fechamento da documentação, com plano mestre e marcadores.

---

## Escopo (Scope)

Diff `40057d2a → d9fed573`, árvore com árvore: 8 arquivos.

- **Código.** Só `src/modules/work-time/useIncomeEstimate.ts`, uma linha de comentário (`:18`, "a retenção" → "a apresentação fail-closed"). `useIncomeEstimateWith.ts` é o mesmo blob da rodada 1 (`24e9c2b…`).
- **Testes** (só afirmações e nomes a mais):
  - `tests/unit/work-time-income-estimate.test.ts`: o R6-02 passa a conferir todas as renderizações até a prova, e a propriedade ganha um nome correto;
  - `tests/unit/work-time-consistency.test.ts`: segundo período de espera em "antes e depois do tempo de interface";
  - `e2e/work-time-p5f.spec.ts`: "releitura que falha" com 5 fases;
  - `e2e/work-time-b03.spec.ts`: o B03-f prova os reais pelo registrador.
- **Documentação:** `docs/production/DATA_MODEL.md:279`, `evidence/p5f1-r31/mutantes.md` (novo) e `testes-e-resultados.md` (novo).
- **Inalterados nas três árvores** (hashes idênticos): `functions/` (`6437cb4`), `firestore.rules` (`133b422`), `firestore.indexes.json` (`f4322d8`), `firebase.json`, `package.json`, `package-lock.json` e `tests/firestore/` (`6eaa7a2`). Ledger, saldos, marcas, gatilhos, reconstrução, Rules, índices e Billing continuam como na R3.
- **A árvore do `verify-all-2`** (`b841ec69b68fb02ab6c05cd65c8267fabe9cf364`) difere da `d9fed573` só em `docs/`: 55 arquivos, 54 em `revisoes/` e mais `testes-substituidos.md`, e nenhum fora de `docs/`.

## Mapa de autoridade (Authority map)

Igual ao da rodada 1: nenhum arquivo de autoridade, de cálculo ou de apresentação mudou.

- **Fontes oficiais:**
  - `cash_report_periods`: Rules com `allow write: if false` (`W/firestore.rules:792-799`);
  - `cash_projection_marks`: `create, update, delete: if false` (`:818-822`), com o teste no Emulator `W/tests/firestore/cash-projection-marks-p5f1r3.rules.integration.test.mjs:239-245`;
  - `transactions`: o cliente não cria, edita nem apaga (`:618` em diante).

  Todas são escritas só por Functions (gatilho e reconstrução) e lidas pela callable `getFinancialReport` e pela transação só de leitura das marcas.
- **Estimativa e conversão:** derivadas em memória a cada renderização (`W/src/modules/work-time/useIncomeEstimateWith.ts:113-118`, `:363`; `WorkTimeContext.tsx:127-135`). Nenhum escritor, nada persistido, nenhuma fonte concorrente.
- Os E2E continuam afirmando que a estimativa não grava nada (`W/e2e/work-time-b03.spec.ts:357`, `:715`).

## Semântica dos movimentos (Movement semantics)

Sem mudança. A renda elegível é a receita recebida oficial da janela, menos as desconsideradas cujo conteúdo a projeção comprovadamente contém; o estorno confirmado zera a exclusão e a PJ só entra com `allowBusinessIncome`. A conversão é informativa e não tem efeito em caixa, ativos, passivos, receita, despesa, principal, rendimento ou valorização.

Os testes novos da rodada 2 exercitam:

- criação de receitas por outra sessão (fases 1, 3 e 5 do p5f);
- anulação pela callable `voidCashTransaction` com `idempotencyKey` (`W/e2e/work-time-p5f.spec.ts:1108-1111`);
- edição de uma desconsiderada com o gatilho atrasado, em dois períodos seguidos (`W/tests/unit/work-time-consistency.test.ts:1234-1259`);
- marca quebrada e reconstrução (B03-f).

## Matriz de evidências (Evidence matrix)

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | `calculation.ts`, `estimate.ts` e `incomeBasis.ts` sem diff desde a R3 (centavos inteiros e BigInt, `calculation.ts:89-128`). O E2E calcula a hora esperada em BigInt (`p5f.spec.ts:1046`). O tempo de interface só muda o texto (`useIncomeEstimateWith.ts:367`, `:385`), e o segundo período prova que ele recomeça a cada espera (`consistency.test.ts:1234-1252`). |
| Semântica financeira | PASS | Nenhuma regra de classificação mudou. PF/PJ inalterado; o E2E `p5f.spec.ts:374` está entre os 216 do `verify-all-1`. |
| Autoridade e atomicidade | PASS (autoridade); N/A (atomicidade) | Nenhuma escrita nova: o diff de código é uma linha de comentário. Rules e Functions idênticas. Não há operação composta. |
| Operações críticas e eventos | N/A (escrita); PASS (exibição sob eventos) | Edição em outra sessão com gatilho atrasado, repetida (`consistency.test.ts:1234-1259`); anulação idempotente pela callable (`p5f.spec.ts:1108-1111`); "Tentar de novo" sem a marca aplicada e com o relatório de volta (`p5f.spec.ts:1088-1095`). |
| Histórico e auditabilidade | N/A | Nenhum registro financeiro criado, editado ou apagado pelo cliente. |
| Fontes, totais, projeções e relatórios | PASS no diff; F-02 fora do escopo (RR-R31-05) | A prova não mudou (`consistency.ts:54-73`; `projectionProof.ts` sem diff). A conversão só aparece com `proof.proven && !holding` (`useIncomeEstimateWith.ts:118`, `:363`). |
| Substituição de domínio e remoção do legado | PASS | F-01 corrigido: `W/docs/production/DATA_MODEL.md:279` e `W/src/modules/work-time/useIncomeEstimate.ts:18`. A busca dos símbolos removidos dá 0 em `src/` e `functions/src`; restam a guarda negativa (`W/tests/unit/work-time-guard.test.ts:466`, `:485`) e registros históricos. O plano mestre só tem a R1 nas seções históricas (§20.16); a entrada nova (§20.19) é do fechamento (N-01). |
| Migração com dados reais | N/A | Nenhum dado persistido muda, e não existem dados reais de produção. |
| Testes obrigatórios | PASS | Os arquivos alterados foram executados nas versões finais, por mim (unidade) e pelo executor (unidade, E2E no Emulator e mutantes); as superfícies inalteradas têm o `verify-all-1` com saída 0 (seção "Verificação"). Criação, edição, anulação, nova tentativa e concorrência estão cobertas; autoridade, pelas suítes de Rules inalteradas; atomicidade: N/A. |

## Reconciliação (Reconciliation)

Sem mudança de fórmula, e as afirmações novas reconciliam com o oficial.

- **B03-f.** O último saldo registrado tem de ser `reais|R$ 20.200,00` (`W/e2e/work-time-b03.spec.ts:670-671`), além de não haver `[data-work-time]` (`:672`) e de o estado inseguro `tempo|≈ 808 h` nunca aparecer (`:678`, `:712`). Na R3 essa afirmação falha com `Received: "tempo|≈ 808 h"` (`p5f1r31/logs/e2e-red-r3-2.log`).
- **Segundo período de unidade.** O valor esperado é 352.000 + 412.000 + (472.000 − 120.000) = 1.116.000 (`consistency.test.ts:1253-1259`). Antes da aplicação não há conversão nenhuma (`:1244`, `:1252`). Assim, o total coincidente de um estado misto, por exemplo 352.000 + 412.000 + (442.000 − 90.000), não pode passar: ele seria barrado pelas duas `assertNoConversion`.
- **p5f.** As horas esperadas X, XZ e R$ 25,00 são distintas entre si (`p5f.spec.ts:1046-1049`). O aviso de leitura anterior só aparece com a hora confirmada pela escuta (X).

## Retentativa e concorrência (Retry and concurrency)

- **Fase 2 do p5f** (`p5f.spec.ts:1088-1095`). Com o relatório de volta, o "Tentar de novo" do erro traz a hora com a receita nova (X) em 30 s, sem erro nem aviso. É a recuperação que a R3 afirmava; a reescrita da rodada 1 a tinha perdido (A-03).
- **Fase 3.** Outra sessão lança e anula uma receita (`:1096-1118`): erro sem hora e, com a projeção de volta à última leitura, o aviso imediato com X.
- **Fase 4:** o "Tentar de novo" do aviso o apaga.
- **Fase 5:** a receita nova (XZ) entra sem aviso nem erro.
- **Registrador** (`:1137-1149`):
  - nenhuma hora nos dois intervalos de erro;
  - o aviso só com X;
  - X e XZ nunca junto do erro;
  - XZ nunca com aviso.

  Isso cobre o que a versão da rodada 1 cobria, com um intervalo a mais. O "hora nova sem aviso nem erro" de antes vale agora para a última receita (XZ). X com aviso é o estado atual confirmado da fase 3, como o item 6 do pedido manda preservar.
- **R6-02** (`income-estimate.test.ts:711-714`). Em todas as renderizações até a prova, a base nova não aparece convertida; com a escuta encerrada, não há conversão nenhuma desde a falha.

## Remoção do legado (Legacy removal)

PASS.

- `git grep` na `d9fed573` por `HeldEstimate`, `EstimateIdentity`, `sameEstimateIdentity`, `sameEstimateInputs`, `heldTooLong`, `heldSince`, `decision.held`, `decision.last`, `last.current` e `lastProven` dá **0** em `src/` e `functions/src`. Em `tests/` e `e2e/` só aparece a guarda negativa.
- A documentação de referência do estado atual descreve o contrato novo (texto no F-01). O resto da busca por "última provada" e "mesma identidade" fora do plano é falso positivo: `AUTH_RBAC_WORKSPACES.md:297` trata da retenção da trilha de auditoria.
- Rules, índices e Functions: N/A, porque a retenção era só do cliente.

## Achados bloqueantes (Blocking findings)

Nenhum.

## Achados da rodada 1: conferência das respostas

| Achado | Situação | Evidência |
| --- | --- | --- |
| **F-01** (LOW, bloqueante) | **Resolvido** | `W/docs/production/DATA_MODEL.md:279` (blob `d08b485`, o mesmo da árvore final) agora diz: "sem prova, ou com a sincronização em curso, nenhuma conversão: os valores ficam em reais (…), e nenhuma estimativa anterior é mostrada no lugar da atual (fail-closed; a retenção da última provada saiu na P5-F.1-R3.1)". Diz também que a escuta encerrada aparece "como atualização que falhou numa base sem desconsideradas (com desconsideradas ou na janela de 12 meses, como erro, sem conversão…)", o que bate com `consistency.ts:56-60` e `basisSync.ts:531-542`. O comentário de `W/src/modules/work-time/useIncomeEstimate.ts:18` diz "a apresentação fail-closed". |
| **F-02** (MEDIUM, fora do diff) | **Fora do escopo, registrado como RR-R31-05** (não bloqueia) | O texto está em `W/docs/production/evidence/p5f1-r31/matriz-antes-depois.md:34` (no disco, blob `a83f5c4`) e em `revisoes/LEIAME.md:20`, e confere com os meus experimentos: só até o primeiro retorno do servidor na R3.1, durante toda a sincronização na R3, sem prazo sem rede. A entrada no plano mestre (§20.19) ainda não está no disco (N-01). |
| **F-03** (INFO) | **Resolvido na substância**; documento pendente (N-01) | Execuções refeitas depois da última edição de cada arquivo final (horários no disco): `unit-consistency-4.log` 46/46 (21:45:54Z, depois de 21:45:34Z); `unit-income-estimate-3.log` 21/21 (21:31:38Z, depois de 21:31:30Z); `e2e-r31-work-time-2.log` 25/25 (21:36:25Z–21:42:47Z, depois dos specs de 21:31:01Z e 21:31:16Z); mutantes 12/12 na `d9fed573` (21:51Z, com a base em 0 falha). Também rodei os dois arquivos de unidade finais de forma independente (seção "Verificação"). |
| **F-04** (INFO) | **Resolvido** | `testes-substituidos.md:21-27` (no disco, blob `a6c91b1`) descreve os prazos por fase, e o código confere: 45 s no primeiro estado observável (`p5f.spec.ts:1081`), como na R3; 30 s na recuperação (`:1092`), como na R3; 45 s e 30 s nas fases novas (`:1101`, `:1114`, `:1122-1123`, `:1128`); orçamento total de 240 s para 300 s (`:1039`). |
| **F-05** (INFO) | **Pendente**; a resposta é antecipada | `revisoes/LEIAME.md:23` diz "Registrada no plano mestre (§20.19…)", mas o plano no disco é o blob `75a789f`, o mesmo da árvore e da rodada 1, sem "R3.1", "R3-AUD-01", "RR-R31" nem "20.19". O coordenador informou que o plano ainda vai ser atualizado (N-01). |
| **V-01** | **Resolvido para `40057d2a`** | `verify-all-1`: saída 0 em 2.547 s. `verify:fast` 1.754/1.754; integração 1.289/1.289, com `tests/firestore/cash-projection-marks-p5f1r3.rules…` e `work-time-p5f.rules…`; lint com 0 erro (201 avisos); Playwright "216 passed", sem nenhum "✘" e sem fail, cancelled, skipped ou todo acima de zero no log. |

## Novos itens (para o gate; não condicionam este PASS)

### V-02 — verificação pendente

- **Estado.** O `verify-all-2` roda sobre a `b841ec69` (início 21:51:30Z, `p5f1r31/logs/verify-all-2.log.meta`), que só difere da `d9fed573` em `docs/`. Às 22:00Z estava na integração no Emulator `minhas-financas-local`. Não presumo resultado.
- **O que ele consolida:**
  - a execução única de tudo na árvore final;
  - o `tsc` e o lint da versão final de `work-time-consistency.test.ts`, editada às 21:45:34Z, depois do último `tsc` do executor (`tsc-root-3.log`, 21:32:24Z).
- **Por que não condiciona este PASS.** As verificações desta skill já estão comprovadas nas versões finais (seção "Verificação"). Os tipos de um teste não mudam o comportamento financeiro, porque o runner tira os tipos antes de executar.

### N-01 — INFO — documentação de evidência ainda não fechada (para o gate fixar o estado final)

- **Marcadores não preenchidos:**
  - `W/docs/production/evidence/p5f1-r31/testes-e-resultados.md:49` (`[[VERIFY_RESULTADO]]`), `:50` (`[[EXECUCOES_EXTRAS]]`), `:67` (`[[VERIFY_DETALHE]]`) e `:71` (`[[MEMORIA]]`). O arquivo, que está na árvore final, ainda lista só as execuções da rodada 1, enquanto `revisoes/LEIAME.md:21` e `:24` remetem a ele as execuções refeitas;
  - `W/docs/production/evidence/p5f1-r31/LEIAME.md:6` (`{{ARVORE_VERIFY}}`) e `:10` (`{{VEREDITO}}`).
- **Plano mestre.** Falta o §20.19, com a decisão que supera em parte D-P5F1-R1-04 e D-P5F1-R1-06 e com os RR-R31, inclusive o RR-R31-05 (F-02).
- **Documentos ainda em edição durante esta revisão** (blobs no disco às 21:55Z): `matriz-antes-depois.md` `a83f5c4`, `mutantes.md` `7a146f3`, `testes-substituidos.md` `a6c91b1` e `LEIAME.md` da raiz `ace9209`.
- **Remediação.** Preencher os marcadores com os resultados reais (inclusive o do `verify-all-2`), registrar o §20.19 e congelar os documentos antes do gate. Nada disso muda código nem testes.

### N-02 — INFO, opcional

- **Situação.** `DATA_MODEL.md:279` diz que nenhuma estimativa anterior aparece no lugar da atual. Vale para o gancho, mas a exceção conhecida da leitura única servida do cache antes do primeiro retorno do servidor (RR-R31-05) não é citada.
- **Remediação.** Uma remissão ao RR-R31-05 evitaria ler ali uma garantia de frescor que a regra 1 não dá.

## Verificação (Verification)

As saídas desta rodada ficam em `<scratchpad>/fdi-runs/` (prefixo `r2-`).

| Comando ou evidência | Árvore | Resultado |
| --- | --- | --- |
| `git hash-object` (sem `-w`) de cada blob da `d9fed573` contra o disco | `d9fed573` | 3.474/3.477; os 3 que diferem são documentos de evidência em edição; código e testes idênticos |
| `git diff --stat` / `--name-status` `40057d2a → d9fed573`; `git rev-parse` de backend, Rules, índices e `tests/firestore` | — | 8 arquivos; backend, Rules, índices e `tests/firestore` idênticos nas três árvores |
| `git diff --name-only d9fed573 b841ec69` | — | Só `docs/` |
| `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/work-time-income-estimate.test.ts` (blob `9be1f88`, igual ao da árvore final) | Final | **21/21**, 0 skip, 0 todo, 8 s (`r2-unit-income-estimate.txt`) |
| O mesmo com `tests/unit/work-time-consistency.test.ts` (blob `84ed20b`, igual ao da árvore final), rodado em seguida, um arquivo por vez | Final | **46/46**, 0 skip, 0 todo, 20 s (`r2-unit-consistency.txt`) |
| `git grep` dos símbolos da retenção | `d9fed573` | 0 em `src/` e `functions/src` |
| Contagem de `test(` e busca de `skip`/`only`/`todo`/`fixme` nos 5 arquivos de teste | `40057d2a` × `d9fed573` | Mesma contagem (40, 20, 18, 6 e 19); 0 `skip`/`only`/`todo` |
| Evidência do executor: E2E dirigido | Specs finais, código R3.1 | 25/25 em 5,9 min (`e2e-r31-work-time-2.log`) |
| Evidência do executor: vermelho na R3 | Cópia `copia-r3-e2e`, com `useIncomeEstimateWith.ts`, `basisSync.ts` e `consistency.ts` da R3 e os specs finais, todos conferidos por hash | 2/2 falham pelo motivo do achado: `Received: "tempo|≈ 808 h"` em `b03.spec.ts:671`; o erro esperado ausente em `p5f.spec.ts:1081` (`e2e-red-r3-2.log`) |
| Evidência do executor: mutantes | `d9fed573` | 12/12 mortos, com a base em 0 falha; o A12 ("em atualização" herdado) é morto pelo segundo período (`mutantes-cliente-r31-final.log`) |
| Evidência do executor: unidade | Finais | `unit-work-time-3.log` 221/221 (21:32Z, antes da última edição da consistência); `unit-consistency-4.log` 46/46 e `unit-income-estimate-3.log` 21/21, depois das edições finais |
| Evidência do executor: `verify-all-1` | `40057d2a` | Saída 0 (ver V-01) |
| `verify-all-2` | `b841ec69` (código e testes iguais à `d9fed573`) | **Pendente** (V-02) |

**Veredito: PASS — Financial domain integrity.**

- F-01: resolvido.
- F-02: fora do escopo, registrado como RR-R31-05.
- F-03 e F-04: resolvidos.
- F-05: pendente para o fechamento.
- V-01: resolvido para `40057d2a`.
- V-02: `verify-all-2` pendente, para o gate.
- N-01: INFO, documentação de evidência e plano por fechar.
- N-02: INFO opcional.
