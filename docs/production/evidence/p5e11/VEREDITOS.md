# P5-E1.1 — vereditos das skills e do gate (2026-10-13)

**Escopo comum.** Diff da P5-E1.1 sobre a árvore auditada da P5-E1 (`43ffbfa1`) até o estado final do working tree (árvore `0857533f`, por índice Git temporário, antes do preenchimento deste campo; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`).
- Fora das evidências: 29 arquivos, 9 novos e 20 alterados, nenhum removido.
- Superfície:
  - contexto da análise de IA: `functions/src/ai/analysisContext.ts` e `prompts.ts`;
  - diálogo de envio ao provedor: `src/components/AiShareConsentDialog.tsx`;
  - painel de notificações: `src/lib/pressOrigin.ts` (novo), `NotificationsPanel.tsx`, `Header.tsx`, `src/modules/notifications/model.ts` e `feed.ts`;
  - testes; `package.json` (só a lista de arquivos de dois scripts de unitários); documentação (`PRIVACY_LGPD.md`, `SUBPROCESSORS.md`, `SECURITY_MODEL.md`, `THREAT_MODEL.md` e o plano mestre) e evidências.
- Sem diff contra a base: Rules, índices, `firebase.json`, `functions/src/index.ts`, opções de runtime, callables, `admission.ts`, dependências e lockfiles.
- Itens de milestones posteriores ficam listados com o ID do plano.

**Validação usada pelos vereditos.** Toda no Emulator `minhas-financas-local`, com o gateway de IA falso e sem nenhuma chamada ao Google. Detalhe em [`execucoes.md`](execucoes.md).

- **`npm run verify:all` no repositório, como está:** saída 0, das 14:58:50Z às 15:43:50Z.
  - Unitários: 661 das Functions e 789 do frontend.
  - Integração: 969 no Emulator.
  - Ferramentas e Rules: 273.
  - E2E: 191.
  - Total: 2.883 testes, contra 2.785 da P5-E1, com 0 falhas e 0 skips.
  - Lint: 0 erros e 201 avisos, os mesmos da base.
- **Primeira execução:** interrompida às 14:58Z pelo limite de 30 minutos do executor em segundo plano, sem falha de teste. Está registrada e não conta.
- **Pré-teste dirigido** das três specs da P5-E1.1 na árvore final: 33/33.
- **Repetições do celular, rodada 5 na árvore final:** 80/80, com 40/40 em cada tema e maior série de 40 nas duas variantes.
- **Mutações:** 54 mutantes, 54 mortos (cada morte conferida no log por uma asserção reprovada), 0 sobreviventes e 0 inválidos, com a restauração conferida por SHA-256 em todos ([`mutacoes.md`](mutacoes.md)).
- **Revisões independentes (Opus):** três rodadas. A última, sobre a árvore final, não achou BLOCKER, HIGH nem MEDIUM e achou 4 LOW ([`revisao-independente.md`](revisao-independente.md)).

---

## PASS — Privacy/LGPD data lifecycle

**Escopo:**
- o que vai ao Google (Gemini API) na análise financeira;
- o texto do diálogo de confirmação;
- o inventário em [PRIVACY_LGPD.md](../../PRIVACY_LGPD.md) (linha 14) e [SUBPROCESSORS.md](../../SUBPROCESSORS.md) (linha 7);
- as notificações, sem mudança de dado pessoal;
- as evidências, só com dados sintéticos.

**Inventário (o que mudou):**

| Dado | P5-E1 | P5-E1.1 | Evidência |
| --- | --- | --- | --- |
| Nome da categoria de despesa (texto livre do usuário) | até 5 nomes, sanitizados e cortados em 40 caracteres, iam ao Google | não sai do servidor: o grupo vai como "Grupo de despesas N", pela posição no ranking por valor | `analysisContext.ts:295-309`; P01–P20; teste "nunca lê o nome nem a chave da categoria" (getters que lançam erro, `analysisContext.test.ts:595-611`) |
| Chave e ID da categoria | não iam | não vão e nem são lidos | idem |
| Valores, participações, cobertura e demais blocos | agregados | idênticos aos da v1 | comparação campo a campo em [`minimizacao-contexto-v2.md`](minimizacao-contexto-v2.md) §4 |
| Pergunta | inteira, depois da confirmação | igual; o diálogo agora avisa que ela pode conter dados pessoais escritos pelo usuário | `AiShareConsentDialog.tsx:104` |

**Matriz:**

| Item do checklist | Resultado | Fundamento |
| --- | --- | --- |
| 1. Inventário | PASS | PRIVACY_LGPD.md e SUBPROCESSORS.md atualizados na mesma mudança |
| 2. Finalidade e minimização | PASS | O campo foi excluído, não filtrado: sem regex, lista de nomes ou detecção probabilística. Prova estrutural pela lista fechada `ALLOWED_SHAPE` (`aiContext.integration.test.ts:101`) e P01–P28 no Emulator. Os mutantes que trocam a exclusão por filtro de CPF, e-mail ou padrões (X12–X14) e o que devolve o nome (X01) morrem |
| 3. Transparência | PASS | O diálogo diz o que vai (valores agregados, grupos por posição, alertas, valores a receber, indicadores, movimentações de investimentos, patrimônio conforme a permissão, tipo do espaço) e o que não vai (nomes de categorias, clientes e cartões, descrições, identificadores internos). Nenhuma das afirmações proibidas aparece no código ou na documentação (busca) |
| 3. Confirmação técnica ≠ consentimento | PASS | `AI_PROVIDER_CONSENT_VERSION` (`ai-provider-share-v1`) e `consent.ts` sem diff; nenhuma caixa pré-marcada; P26/P27: sem confirmação, ou com a de outra operação, nada é lido, enviado ou cobrado |
| 6. Retenção | PASS | Nada novo é persistido. A pergunta não é gravada nem vai a log; o recibo de crédito da P2B.2 guarda só o hash da intenção (`aiRequestHash`) |
| 7. Subprocessadores | PASS no escopo | Google (Gemini API) já listado; a linha descreve os grupos pela posição |
| 8. Armazenamento local | PASS | O roteamento do clique guarda a origem do gesto só em memória (`pressOrigin.ts:134`); nada em `localStorage`, `sessionStorage` ou IndexedDB |
| Notificações | PASS | Conteúdo, retenção de 180 dias (D-18), estado privado por usuário e Rules sem diff |
| Evidências | PASS | Amostras sintéticas, com nomes fictícios propositalmente pessoais; o gerador falha se qualquer nome, ID ou chave de entrada aparecer na saída; nenhum dado real, segredo ou caminho de sessão |

**Pendências jurídicas e externas:** validação jurídica dos textos e da base legal do uso de IA (P8).

**Fora do escopo desta avaliação:**
- base legal e registro do tratamento por IA (PR-AI-01, P8);
- DPA e transferência internacional (E-09, P8);
- tier, retenção, ZDR e região do provedor (E-10);
- exportação, eliminação de conta e registro de solicitações do titular (P8);
- validação jurídica (P8).

**Verificação:** `aiMinimization.integration.test.ts` (P01–P28) e `aiContext.integration.test.ts` no Emulator; `analysisContext.test.ts`; `ai-share-contract.test.ts`; E2E do diálogo; busca das afirmações proibidas; mutações X01–X20.

---

## PASS — Multi-tenant security review

**Escopo e fronteiras:**
- callables de IA sem mudança de autorização: só o conteúdo do contexto mudou, depois de `resolveWorkspaceActor` e da releitura do papel na transação de contexto;
- painel de notificações no cliente: roteamento do clique, fusão de marcas no cache e remoção no fim da saída;
- Rules, callables de notificações e `notification_user_states` sem diff.

**Matriz de evidência:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Identidade, tenant e membership | PASS | Sem mudança no kernel nem nas callables. P26–P28 no Emulator: sem confirmação nada é lido; duas chamadas simultâneas com a mesma chave dão um débito |
| RBAC | PASS | Matriz da IA inalterada; P23: sem a permissão de investimentos, o patrimônio sai "sem permissão" mesmo presente no relatório, e com a permissão (controle) ele aparece. Notificações: o viewer arquiva e não exclui (casos 10 e 11 da spec nova; mutantes E02 e E03) |
| Cross-tenant e IDOR | PASS | A fusão de marcas roda dentro do `structuralSharing` de uma única consulta, cuja chave é (workspace, uid): só compara itens do mesmo escopo, pelo mesmo ID e pela mesma expiração (`model.ts:281-313`). Casos 06 (trocar de workspace) e 07 (trocar de usuário) da spec nova; testes de troca de escopo do feed |
| Camadas independentes | PASS | Rules sem diff; as suítes de Rules rodaram no `verify:all`. As marcas só ligam, nunca desligam (`isNewNotificationMark`, `isKeptOrNewNotificationMark`); o caso 11 prova que o viewer não grava `deleted` pela API (403) |
| Integridade de entrada | PASS | O roteamento do clique só reentrega a um dono marcado com `data-press-target` ainda na página; não cria ação nova, não muda payload e não chama API |
| Segredos | PASS | Nenhum segredo novo; nada de chave no contexto, no prompt, nos logs ou no bundle |
| Storage | N/A | Não usado |

**Caminhos de ataque tentados:**
- nome de categoria com CPF, CNPJ, e-mail, telefone ou nome próprio (P01–P22);
- pergunta que tenta associar um grupo a um nome (regra da instrução de sistema, `prompts.ts:44-50`);
- confirmação ausente ou de outra operação (P26, P27);
- chamadas simultâneas com a mesma chave (P28);
- viewer tentando excluir pela API (caso 11);
- troca de workspace e de usuário durante o arquivamento (casos 06 e 07).

**Verificação:** suítes de IA e de Rules no Emulator (`verify:all`); spec nova `notifications-mobile-p5e11.spec.ts`.

---

## PASS — Financial domain integrity

**Escopo:** o contexto da análise é uma projeção do relatório oficial; a P5-E1.1 trocou só o rótulo dos grupos de despesa. Nenhum cálculo, saldo, escrita, evento ou relatório mudou.

**Mapa de autoridade:** os números continuam vindo de `executeGetFinancialReport`, a mesma fonte dos Relatórios e do Dashboard. O navegador não envia nenhum valor (schema estrito). O modelo não grava nada.

**Matriz de evidência:**

| Seção | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos e pontos-base copiados sem alteração (`analysisContext.ts:295-305`); formato BRL inteiro (X01) |
| Semântica | PASS | Mesmos blocos e separações da P5-E1; as amostras v1 e v2 têm valores idênticos (só `versao` muda) |
| Fontes, totais e relatórios | PASS | Ordem por valor decrescente, empates na ordem do relatório oficial (ordenação estável; P19), teto de 5 (P17, P18), cobertura indisponível e parcial preservadas (P24, P25) |
| Autoridade e atomicidade | PASS | Nenhuma escrita financeira; `admission.ts` sem diff; um débito por intenção (P28) |
| Histórico | PASS | Nenhum hard delete; notificações seguem com tombstones |
| Substituição e legado | PASS | Saíram `sanitizeUntrustedLabel`, `ANALYSIS_CATEGORY_LABEL_MAX`, o rótulo "Sem categoria" do contexto e as regex do sanitizador. A busca em `functions/src` só encontra as asserções de ausência nos testes. `ANALYSIS_CONTEXT_VERSION = 2`, sem leitor nem payload da v1 |
| Testes obrigatórios | PASS / N/A | Não há criação, edição ou anulação de movimento. Retry e concorrência: P28 (duas chamadas simultâneas, um débito) |

**Reconciliação:** `buildAnalysisContext(report)` continua uma função pura do relatório; as amostras v2 são reproduzíveis pelo gerador.

**Verificação:** `analysisContext.test.ts`, `aiContext` e `aiMinimization` no Emulator; mutantes X04–X09 (posição, ordem, teto, participação, cobertura).

---

## PASS — Firestore scale/cost review

**Escopo:** a única mudança em consulta é a opção `structuralSharing` do feed de notificações (`feed.ts:118`). Ela atua no cache, depois da leitura. Nenhuma consulta, listener, índice, coleção ou job novo; o contexto da IA lê o mesmo relatório.

| Item | Resultado | Evidência |
| --- | --- | --- |
| Leituras por ação | PASS | Iguais às da P5-D2/D-18: o feed lê as mesmas páginas e a fusão é em memória, O(itens carregados) |
| Listeners e polling | PASS | Nenhum listener; sem `refetchInterval`, como antes |
| Índices e Rules | PASS | `firestore.indexes.json` e `firestore.rules` sem diff |
| IA | PASS | Contexto sem leitura nova; custo por pergunta igual ao da P5-E1 (`../p5e1/custos.md`) |

**Modelo de custo:** sem mudança em relação à P5-E1 e à D-18.

**Verificação:** `notifications-feed.test.ts` com React Query real (resposta antiga que chega depois da marca), suítes de Rules no `verify:all`.

---

## PASS — Firebase production readiness

**Escopo:** nenhuma mudança de plataforma.
- `firebase.json`, Rules, índices, `functions/src/index.ts`, opções de runtime e dependências sem diff.
- `package.json`: só dois scripts de unitários ganharam arquivos de teste (`test:unit:billing` com `ai-share-contract.test.ts`; `test:unit:notifications` com `press-origin.test.ts`), e os dois já estão no `verify:fast`.
- A spec nova de corrida empacota o painel com o Vite dentro do próprio Playwright (`write: false`), sem rede e sem Emulator.

**Matriz:**
- exports, região, timeout, memória e teto das Functions: PASS, sem diff (teste de contrato de deploy no `verify:fast`);
- segredos: PASS, nada novo;
- nenhum script, teste ou comando contra produção: PASS. Toda execução usou o projeto `minhas-financas-local`; nenhum `deploy:*` foi executado;
- Emulator: PASS. O `verify:all` rodou como está no repositório, nas portas padrão. A JVM órfã que o Playwright deixa depois do E2E foi encerrada só com identidade, propriedade e não uso comprovados, por SIGTERM ao PID ([`encerramentos-emulator.txt`](encerramentos-emulator.txt)).

**Configuração externa pendente** (fora do escopo e listada no plano §11): rotação da chave do provedor (PR-AI-02/E-00), termos, DPA e região (E-09, E-10), App Check em produção (P6).

---

## PASS — revisão de UI de produto em PT-BR

**Escopo:**
- `AiShareConsentDialog`, variante da análise: texto de transparência novo; corpo e citação focáveis só quando rolam;
- painel de notificações e sino: roteamento do clique, remoção no fim da saída e fusão de marcas, sem mudança visual.

**Classificação das mudanças:**
- **Texto do diálogo: requerida.** Transparência do envio (pedido §5), sem promessas não comprovadas (`ai-share-contract.test.ts`).
- **Foco nas regiões roláveis: requerida.** Acessibilidade: o axe acusava `scrollable-region-focusable`, a 360 px desde antes e a 390 px com o texto maior. A correção só muda o `tabindex`, sem estilo.
- **Notificações: requeridas.** Correção de estado e interação (arquivamento perdido, painel fechando, aviso invisível e clicável). Nenhuma mudança visual.

**Evidências de execução:**
- `ai-consent-extraction.spec.ts`, 12/12 na árvore final:
  - axe sem violação a 390 e a 360 px;
  - invariante "focável se, e somente se, rola";
  - ordem do Tab a 360 px (Fechar → corpo → Cancelar);
  - citação longa focável;
  - Escape, foco preso e devolvido;
  - HTML como texto, erros em pt-BR.
- `notifications-mobile-p5e11.spec.ts`, 20/20 na árvore final: celular 390×844 com toque real, teclado no desktop (Enter e Espaço), erro do Firestore em pt-BR, sem rolagem horizontal.
- `notifications-p5d2.spec.ts`, variante celular: rodada 5 com 80/80.

**Comparação antes e depois** ([`visual/`](visual/)), na mesma base de dados, viewport, tema e estado, 30 capturas de cada lado:
- painel e sino em todos os estados (owner, viewer, vazio, indisponível, depois de arquivar; desktop e celular; claro e escuro): **0,00%** de diferença de pixels;
- diálogo da análise: muda só pelo texto novo;
- axe idêntico antes e depois. O único resultado é o débito de contraste registrado na P5-D2 (badge e tema escuro do painel), fora do escopo até as fases de UI/UX aprovadas.

**Texto:** pt-BR em todo o diálogo; sem "anonimizado", "nenhum dado pessoal" ou equivalentes; a pergunta é descrita como enviada inteira.

**Riscos residuais:**
- se o conteúdo deixa de rolar com a região focada (por exemplo, ao girar o aparelho), o foco cai no `body`; o próximo Tab volta ao diálogo pela armadilha de foco (L8b);
- depois de uma reentrega ao corpo de um aviso (`div`), o foco fica no botão em que caiu o `mousedown` (N2);
- com caneta que se comporta como mouse, deslizar para fora de "Arquivar" e soltar arquiva o aviso; antes, o abria (soltando sobre ele) ou não fazia nada (soltando fora) (N1).

Os três são LOW e estão registrados, com a correção recomendada, no §4.1 do diagnóstico e na §20.12 do plano mestre.

---

## Não se aplicam nesta milestone

- **`billing-entitlement-integrity`:** `admission.ts`, `functions/src/billing/*` e a política de créditos sem diff; o P28 confirma um débito por intenção.
- **`observability-incident-readiness`:** nenhum log, métrica, alerta, auditoria ou evento alterado; o roteamento do clique não registra nada.
- **`saas-commercial-readiness`:** nenhuma página pública, preço, cadastro ou funil.

---

## PASS — regression release gate (P5-E1.1)

1. **Escopo Git:**
   - branch `integration/p4-finalization-2026-10-08`; HEAD `f0c172b`; índice real sem nada staged;
   - base da milestone: árvore auditada da P5-E1 (`43ffbfa1`); árvore submetida ao `verify:all`: `025e13ef`; árvore final do pacote: `0857533f`;
   - entre as duas, só mudaram arquivos de `docs/production/` (prova em [`execucoes.md`](execucoes.md));
   - diff contra a base, fora das evidências: 29 arquivos (9 novos e 20 alterados), nenhum removido;
   - Rules, índices, `firebase.json`, exports e opções das Functions, dependências e lockfiles sem diff;
   - sem commit, push, merge, rebase, reset, tag ou deploy; nada publicado.
2. **Evidências:**

   | Etapa | Comando ou inspeção | Resultado |
   | --- | --- | --- |
   | Typecheck, lint e builds | `npm run verify:all`, etapa `verify:fast` (repositório) | sem erros de tipo; lint com 0 erros e 201 avisos (base: 201); builds ok |
   | Unitários | `verify:fast` | 661 + 789, 0 falhas, 0 skips (base: 639 + 763) |
   | Integração das Functions no Emulator | `verify:all`, etapa `test:integration:emulator` | 969/969, 0 skips (base: 941) |
   | Ferramentas e Rules no Emulator | mesma etapa, 19 suítes | 273/273, 0 skips (base: 273) |
   | E2E completo | `verify:all`, etapa `test:e2e` | 191/191 em 18,6 min (base: 169) |
   | **`npm run verify:all` como está** | repositório, portas padrão, projeto `minhas-financas-local` | **saída 0**, das 14:58:50Z às 15:43:50Z |
   | Primeira execução | idem | interrompida pelo limite de tempo do executor, sem falha; não conta |
   | Pré-teste dirigido | as três specs da P5-E1.1 | 33/33 |
   | Repetições do celular | spec original, rodada 5, árvore final | 80/80; 40/40 por tema, maior série de 40 |
   | Mutações | `mutacoes.md` | 54 mutantes, 54 mortos (cada morte conferida no log por uma asserção reprovada), 0 sobreviventes e 0 inválidos, com a restauração conferida por SHA-256 em todos |
   | Diff | `git diff --check` (índice temporário, base → árvore final) | limpo |
   | Índice real | `git diff --cached --name-only` | vazio |
   | Arquivos de plataforma e contrato | SHA-256 contra a base | `firebase.json`, Rules, índices, `functions/src/index.ts`, `runtimeOptions.ts`, `admission.ts`, `consent.ts`, `callables.ts` (Functions e cliente), `playwright.config.ts`, `vite.config.ts`, `tsconfig.json`, `package-lock.json`, `functions/package.json` e `functions/package-lock.json` idênticos; o `package.json` da raiz muda só a lista de arquivos de dois scripts de unitários |
   | Afirmações proibidas e segredos | busca no código e na documentação | nenhuma afirmação de anonimização; nenhum caminho de sessão nem segredo nas evidências |

3. **Achados:**
   - **Corrigidos nesta milestone:** a falha intermitente do celular (duas causas no app), o aviso arquivado preso no DOM, a marca confirmada desfeita por resposta antiga, o `scrollable-region-focusable` do diálogo e o envio do nome livre das categorias.
   - **Revisões independentes:** três rodadas (Opus, somente leitura). Rodada 1: 3 MEDIUM e 7 LOW, tratados. Rodada 2: 2 MEDIUM e 8 LOW; M1, M2, L1, L3, L4, L6, L7 e L8 tratados, L2 e L5 residuais. Rodada 3, na árvore final: 0 BLOCKER, 0 HIGH, 0 MEDIUM, 4 LOW (N4 corrigido; N1, N2 e N3 residuais); Q14 e Q15 OK depois do `verify:all`.
   - **Processo:** Emulators simultâneos entre 13:36Z e 13:44:31Z, contra a regra de coordenação do pedido; sem efeito nos resultados que sustentam o gate ([`execucoes.md`](execucoes.md)). Os desvios de encerramento anteriores às 12:41Z foram divulgados ([`ambiente-porta-8080.md`](ambiente-porta-8080.md)).
4. **Skips e cobertura:**
   - 0 skips, nenhum `only`, `fixme` ou `todo` (contagens do `verify:all` e busca nos testes alterados);
   - nenhum `waitForTimeout` novo: o `ai-consent-extraction` tinha 10 na base e tem 10; a spec nova não tem nenhum;
   - nenhum timeout aumentado: os `test.setTimeout(300_000)` da spec nova seguem o padrão de `notifications-p5d2` e da D-18; nenhum timeout existente mudou; `playwright.config.ts` sem diff; sem retries locais;
   - a spec original `notifications-p5d2.spec.ts` está idêntica à base (SHA-256 começando com `08fd30570851559b`);
   - nenhuma asserção preexistente enfraquecida: o X29 de `aiContext` foi reescrito mais estrito (nem o nome, nem janelas de 8 caracteres, nem o ID vão ao provedor), o teste do texto do diálogo exige o texto novo inteiro, e o feed ganhou só um portão opcional no backend falso;
   - o repositório não configura métrica de cobertura;
   - total de testes: 2.883 (661 + 789 + 969 + 273 + 191) contra 2.785 na base; nenhum teste removido ou ignorado.
5. **Mudanças de superfície:**
   - **UI:** texto de transparência do diálogo da análise (requerido); `tabindex` nas regiões que rolam (acessibilidade); painel de notificações sem mudança visual (0,00% em 24 capturas).
   - **Textos:** pt-BR; nenhuma afirmação de anonimização.
   - **Rotas:** nenhuma.
   - **Contratos:** contexto da análise v2 (`grupo` no lugar de `nome`, `versao` 2), interno ao backend e ao provedor; nenhum payload de callable, documento Firestore, índice ou evento mudou.
6. **Riscos residuais:**
   - L2 e L5 (framer-motion e reentrega), N1 (caneta que se comporta como mouse), N2 (foco quando o dono é o corpo do aviso) e N3 (regressão determinística sem controle positivo), descritos com a correção recomendada no §4.1 do diagnóstico;
   - `ReportsAIChat` e `MessagesPanel` com `AnimatePresence` sem a correção;
   - foco no `body` se o conteúdo deixa de rolar com a região focada;
   - comportamento do modelo real diante da regra dos grupos, não testado;
   - débito de contraste da P5-D2, idêntico antes e depois;
   - externos: PR-AI-02/E-00, E-09, E-10, PR-AI-01, STAGING, modelo GA, política de devolução de créditos.
7. **Bloqueadores para PASS:** nenhum. Os dois bloqueadores da P5-E1 (porta 8080 e falha intermitente do celular) foram tratados: o `verify:all` rodou como está, com saída 0, e a variante celular passou 80/80 na árvore final.
8. **Skills de domínio:** todas `PASS`, acima, no escopo da P5-E1.1:
   - `privacy-lgpd-data-lifecycle`;
   - `multi-tenant-security-review`;
   - `financial-domain-integrity`;
   - `firestore-scale-cost-review` (opção `structuralSharing` do feed);
   - `firebase-production-readiness`;
   - revisão de UI em pt-BR.

   `billing-entitlement-integrity`, `observability-incident-readiness` e `saas-commercial-readiness` não se aplicam, com o fundamento acima.

---

## Declaração final

**P5-E1.1 IMPLEMENTADA — AGUARDANDO AUDITORIA INDEPENDENTE**

Não houve commit, push, merge, rebase, reset, tag nem deploy. Nada foi publicado: Functions, Rules, índices, Hosting ou configuração remota. O working tree acumulado foi preservado. A P5-E2, a P5-F e as demais milestones não foram iniciadas.
