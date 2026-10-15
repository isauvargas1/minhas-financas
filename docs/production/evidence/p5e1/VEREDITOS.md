# P5-E1 — vereditos das skills e do gate (2026-10-12)

**Escopo comum.** Diff da P5-E1 sobre a árvore da P5-D2.1 (`91ed2c58`) até o estado final do working tree (árvore `03775e7a`, antes do preenchimento deste campo; HEAD `f0c172b`, branch `integration/p4-finalization-2026-10-08`).
- Superfície avaliada: consultor e extração por IA (`functions/src/ai/*`), opção `omitTopClients` do relatório, SDK do provedor, diálogos e fluxos do frontend (chat dos Relatórios e formulário de lançamento), testes e documentação.
- Itens de milestones posteriores ficam listados com o ID do plano.

**Validação usada pelos vereditos.** Toda no Emulator `minhas-financas-local`, com o provedor falso injetado e sem nenhuma chamada ao Google:
Detalhe em `execucoes.md`.

- **Integração das Functions:** 941/941, a partir do `functions/lib` oficial, em portas próprias. A base tinha 891.
- **Ferramentas e Rules:** 273/273, numa cópia isolada em que só os números de porta mudaram.
- **E2E completo:** 167/169 na cópia. Das duas falhas:
  - uma era defeito do teste novo, já corrigido: na nova execução, `ai-consent-extraction` passou 11/11;
  - a outra é intermitente e preexistente em `notifications-p5d2` no celular. Reproduz na base: 1 falha em 16 execuções, contra 3 em 20 na P5-E1.
- **`verify:fast` no repositório:** 639 unitários das Functions (base 573) e 763 do frontend (base 735), lint sem erros, 0 falhas e 0 skips.
- **Mutações, rodada final sobre a árvore `6fca66bc`:** 42 mutantes, 41 mortos (cada um com asserção que falhou no log), 0 inválidos. F08 é equivalente justificado: o F10, que remove as duas proteções, morre. Todos os arquivos foram restaurados, conferidos por SHA-256.
- **`verify:all` como está:** não roda. A porta 8080 está presa por um Firestore Emulator órfão (PID 7545), e encerrá-lo é decisão pendente do usuário.

---

## PASS — Financial domain integrity

**Escopo.**
- Leitura do contexto financeiro pelo consultor: relatório oficial → contexto mínimo → texto ao modelo.
- Resultado da extração: sugestão, nunca gravação.
- Nenhum cálculo, saldo, projeção ou escrita financeira alterado.
- A única mudança em código financeiro é a opção `omitTopClients`, que deixa de ler a amostra de clientes PJ (`functions/src/reports/report.ts`).

**Mapa de autoridade:**
- **Números do contexto:** única fonte é `executeGetFinancialReport`, a mesma callable dos Relatórios e do Dashboard (`functions/src/ai/callables.ts:381-393`), lida com o papel relido na transação de contexto (`:326-340`).
- **Navegador:** não informa nenhum valor, perfil ou indicador. O payload é estrito (`callables.ts:117-128`); testes S10–S13 e X23; mutantes M01 e F04.
- **Modelo:** não escreve nada. Não há ferramentas nem caminho de escrita, e a resposta é texto validado (`validateAnalysisAnswer`). Na extração, o resultado só preenche o formulário; o salvamento continua pelo botão e pelas callables oficiais.
- **Teste de não escrita:** `financialWritesOf` confirma que nenhuma coleção financeira muda nas suítes de segurança e de contexto.

**Semântica de movimentos.** O contexto projeta os blocos do relatório sem misturar semânticas. Cada par foi provado contra o oráculo à mão, com os mesmos números do relatório:

| Bloco | Separação provada | Teste |
| --- | --- | --- |
| Caixa realizado | recebimentos × pagamentos | — |
| Cartões | fatura × despesa; o pagamento da fatura não conta de novo | X06/X07/X09 |
| Compras parceladas | ocupam limite e obrigações, não o caixa | X08 |
| Investimentos | aporte não é despesa; resgate não é receita | X10/X11 |
| Empréstimos | principal fora de receita e despesa | X12/X13 |
| Recebíveis | em aberto não é caixa | X14/X15 |

**Matriz de evidência:**

| Seção | Resultado | Evidência |
| --- | --- | --- |
| Representação e tempo | PASS | Centavos inteiros formatados por aritmética inteira (BigInt) até o teto do contrato (X20); pontos-base; período civil de São Paulo pelo contrato dos Relatórios (X19). Extração: valor por string decimal → BigInt, ausente ≠ zero, datas existentes (`extraction.test`) |
| Semântica financeira | PASS | Tabela acima; categorias como rótulo não confiável (X29) |
| Autoridade e atomicidade | PASS | Contexto só do backend; papel relido na transação de contexto (C07, X26; mutante M02); nenhuma escrita financeira |
| Cobertura e indisponível | PASS | "Indisponível" nunca vira zero (X16/X17 com falha real do leitor de cartões, S15, X18, X25); dívidas sem obrigações de cartão nunca saem "completo" nem "sem movimento" (`withPartialCardObligations`, `analysisContext.ts:303-310`; mutante M28) |
| Histórico e auditoria | PASS | Nenhum hard delete; recibos de crédito P2B.2 inalterados |
| Fontes, totais e relatórios | PASS | Uma fonte só: X21, mesmos números em PF e PJ com dados iguais; X24, reconsulta depois de alteração autoritativa |
| Substituição e remoção de legado | PASS | Removidos o contexto montado pelo cliente (`FinancialQuestionContext`), `buildPrompt`, `applyAIData(any)`, a correspondência aproximada de categoria, o `parcelado` na extração e o SDK legado. Restam só a guarda negativa `tests/unit/ai-backend-only.test.ts` e um comentário histórico em `gateway.ts` |
| Testes obrigatórios | PASS / N/A | Não há criação, edição ou anulação de movimento financeiro: a IA não grava (provado por `financialWritesOf` e pelo mutante M14; no formulário, F05 e F12). Retry (X28, C04/C05) e concorrência (X27, C07) cobertos |

**Reconciliação.** O contexto é uma projeção pura do relatório: `buildAnalysisContext(report)`. As amostras de PF e PJ em `contexto-amostras-sinteticas.json` são reproduzíveis pelo gerador.

**Retry e concorrência.** A fronteira de idempotência é o recibo da P2B.2:
- A mesma chave dá "já processada", com uma chamada e um crédito (X28).
- Uma intenção duplicada, concorrente ou reenviada, gera um débito (C04/C05).
- Membership perdida ou papel rebaixado entre a pré-checagem e o contexto: recusa (C07).

**Verificação:** suítes de IA e de relatórios no Emulator e mutações (abaixo).

---

## PASS — Firestore scale/cost review

**Escopo:**
- Leituras do consultor: relatório oficial, sem série e sem ranking de clientes.
- Transação de contexto: releitura do ator e limite de leitura de contexto.
- Admissão P2B.2, inalterada.
- Nenhuma consulta, listener, coleção ou índice novo; `firestore.indexes.json` sem diff.

**Evidência:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Tenant e limites | PASS | Toda leitura sai do workspace do ator relido; o relatório já é limitado por bloco (P5-C1). X27: chamadas simultâneas em dois workspaces leem e cobram só o próprio |
| Índices | PASS | Sem consulta nova; Rules e índices sem diff em relação à base |
| Leituras e listeners | PASS | Sem listener; recusas antes da admissão custam no máximo as 3 leituras da pré-checagem (S01–S04, S08, S20, S23, S24) |
| Escritas e modelo | PASS | Um contador de limite por operação e ator (`workspaces/{ws}/rate_limits/{op}_{uid}`, `functions/src/shared/rateLimit.ts:68-78`), com `expiresAt` de 2 dias (mecanismo existente) |
| Abuso e repetição | PASS | 60 leituras de contexto por hora (`policy.ts:75-79`); acima disso, recusa **antes** de ler o relatório (C14) |
| Minimização de leitura | PASS | `omitTopClients` evita a amostra ordenada de recebíveis PJ (até 501 leituras mais os nomes); X14 confirma a opção |
| Custo | PASS | `custos.md`: cerca de 101 leituras e 4 escritas por pergunta de 30 dias; cerca de 136 em 12 meses; cerca de 305 em todo o período com 5 anos; 11 leituras e 3 escritas por extração |

**Modelo de custo:** como na tabela; pior caso por ator e workspace, 60 relatórios por hora.

**Verificação:** suítes `aiSecurity`, `aiContext` e `aiCredits` no Emulator.

---

## PASS — Multi-tenant security review

**Escopo e fronteiras:**
- Callables `analyzeFinancialQuestion` e `extractTransactionFromContent`, no kernel `defineCallable`: schema estrito, depois `resolveWorkspaceActor`, depois o handler.
- Matriz `AI_OPERATION_ROLES`: owner, admin e member; viewer recusado.
- Releitura na transação de contexto e na admissão.
- Rules sem diff.

**Matriz de evidência:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Identidade, tenant e membership | PASS | Não autenticado, suspenso, removido e arquivado recusados sem leitura nem crédito (S01–S04); UID, papel ou titular falsos no payload recusados pelo contrato (S10/S11) |
| RBAC | PASS | Owner, admin e member usam (S05–S07); viewer recusado (S08, X22); mutante M03 |
| Cross-tenant e IDOR | PASS | Usuário de A consultando B: recusa, nada de B é lido (S09); pergunta tentando trocar de workspace (S18); créditos de outro workspace (S26); dois workspaces simultâneos (X27) |
| Corrida | PASS | Membership perdida ou papel rebaixado entre a pré-checagem e o contexto (C07, com barreira real); workspace arquivado no meio (X26); mutante M02 |
| Camadas independentes | PASS | Rules inalteradas; as suítes de Rules passaram (273/273, abaixo). O backend revalida o papel em duas transações |
| Segredos | PASS | Chave só via `secrets` (`callables.ts:74-79`). Nenhuma variável `VITE_*` de IA, nenhum padrão de chave no repositório (busca) e nenhuma chave no prompt, nos logs ou nos erros (S16, S21/S22; mutante M19) |
| Storage | N/A | O documento vai em base64 na callable e não é gravado |

**Caminhos de ataque tentados:**
- IDOR por `workspaceId` de outro tenant;
- campos extras de identidade, papel, custo ou indicadores;
- confirmação ausente ou de outra operação (S23/S24);
- arquivo com tipo falso (C15);
- prompt injection na pergunta, no documento e no nome de categoria (S16–S19, X29);
- payload grande (S20);
- repetição e corrida (C04/C05, C07).

---

## PASS — Billing entitlement integrity

**Escopo:** contrato de créditos de IA da P2B.2 diante dos fluxos novos. `admission.ts`, `functions/src/billing/*` e `functions/src/shared/*` sem diff.

**Matriz:**

| Item | Resultado | Evidência |
| --- | --- | --- |
| Crédito server-side pelo plano do titular | PASS | `admitAiCall` inalterada; `aiCredits` (30 testes) |
| Recusas antes da admissão não cobram | PASS | Testes `assertNothingConsumed`: confirmação ausente, segredo ausente (C03), relatório indisponível (C12/C13), limite de contexto (C14), tipo de arquivo (C15) |
| Idempotência | PASS | Mesma chave: um débito (X28, C04/C05); chave nova por confirmação no cliente (`ai-client.test.ts`) |
| Sem contorno | PASS | Campo de custo recusado pelo contrato; último crédito disputado (S25) |
| Falha depois da admissão | PASS | Crédito mantido, mensagem pt-BR transparente com `ai_provider_failed` e sem a mensagem do SDK (S21/S22; mutante M20) |

Nenhuma mudança de plano, preço, Stripe ou webhook. A recomendação de devolver o crédito na falha do provedor ficou registrada e não foi implementada.

---

## PASS — Firebase production readiness

**Escopo:**
- Exports `analyzeFinancialQuestion` e `extractTransactionFromContent`, com os mesmos nomes.
- Dependência `@google/genai ~2.28.0`, no lugar de `@google/generative-ai`.
- Segredo do provedor.
- Nenhuma mudança em `firebase.json`, Rules ou índices.

**Inventário de Functions alteradas** (`AI_CALLABLE_OPTIONS`, `functions/src/shared/runtimeOptions.ts:86-91`):

| Opção | Valor |
| --- | --- |
| Tipo | callable |
| Região | `southamerica-east1` |
| Timeout | 120 s |
| Memória | 256 MiB |
| `maxInstances` | 10 |
| Segredo | `GOOGLE_AI_API_KEY` |
| App Check | aplicado pelo kernel (inalterado) |
| Retry | sem retry de evento; o SDK não repete (`gateway.ts:100`) |
| Tempo limite do provedor | 90 s, abaixo da função |

**Matriz:**
- Região, timeout e teto: PASS.
- Segredo gerenciado: PASS, sem `VITE_*` e sem valor no repositório.
- Contrato de exports e runtime: PASS (unitários de deploy no `verify:fast`).
- Nenhum script ou comando contra produção: PASS.
- `npm audit --omit=dev` das Functions: idêntico ao da base (23 avisos preexistentes na cadeia de `firebase-admin`, `google-gax`, `protobufjs`, entre outros), nenhum vindo de `@google/genai`. Os preexistentes ficam para o hardening da P6.

**Configuração externa pendente** (fora do escopo da milestone e listada no plano §11):
- rotação da chave (PR-AI-02/E-00, **não** executada);
- termos, DPA e região do provedor (E-09, E-10);
- billing tier do projeto no Google;
- App Check em produção (P6).

---

## PASS — Privacy/LGPD data lifecycle

**Escopo:**
- dados enviados ao provedor;
- confirmação antes do envio;
- logs;
- persistência;
- inventário em [PRIVACY_LGPD.md](../../PRIVACY_LGPD.md) e [SUBPROCESSORS.md](../../SUBPROCESSORS.md).

**Inventário:**

| Dado | Vai ao Google (Gemini API)? | Persistência e logs |
| --- | --- | --- |
| Pergunta | Sim, só depois da confirmação | Não persistida no servidor e nunca em log |
| Contexto financeiro agregado | Sim, só depois da confirmação; sem IDs, nomes, descrições, contrapartes, clientes ou e-mails, e sem ranking de clientes | Não persistido no servidor |
| Comprovante | Sim, só depois da confirmação | Não gravado; nunca em log |
| Transcrição da voz | Sim, depois de duas confirmações | Nunca em log |
| Resposta do modelo | — | Não persistida no servidor; nunca em log |
| Histórico do chat | Não | Só no navegador, por usuário e workspace (D-41) |
| Logs | Não | Só IDs, operação, `requestId`, códigos e contadores (S21/S22) |

Sobre a voz: o reconhecimento é do navegador, e o diálogo avisa que o áudio pode ir ao serviço do navegador.

**Matriz:**

| Item | Resultado | Fundamento |
| --- | --- | --- |
| Finalidade e minimização | PASS | Contexto mínimo; `omitTopClients`; até 5 categorias |
| Transparência | PASS | Diálogo antes de cada envio, com destinatário, conteúdo e finalidade |
| Subprocessador | PASS | Google listado em `SUBPROCESSORS.md` |
| Retenção no servidor | PASS | Nada além do recibo de crédito da P2B.2, que não guarda conteúdo |
| Logs | PASS | Só IDs, operação, `requestId`, códigos e contadores |
| Confirmação ≠ consentimento | PASS | A confirmação de envio é controle técnico e não se apresenta como consentimento LGPD (D-11.3) |

**Fora do escopo desta avaliação:**
- base legal e registro formal do tratamento por IA (PR-AI-01, P8);
- DPA e transferência internacional (E-09, P8);
- tier, retenção, ZDR e região do provedor (E-10);
- validação jurídica (P8).

---

## PASS — Observability and incident readiness

**Escopo:** eventos de log das duas callables e o registro em [OBSERVABILITY.md](../../OBSERVABILITY.md).

**Mapa de sinais:**
- `callable.start` e `callable.end`, com `requestId`, `operation` e ator;
- `ai.credit_consumed` (`callables.ts:406`, `:455`), com período, custo e ID do débito;
- `ai.provider_failed` (`:251`), com a classe da falha e o status HTTP, sem a mensagem do SDK;
- `ai.extraction_result` (`:470`) e `ai.extraction_invalid_response` (`:474`), com o estado ou o código;
- falha de domínio (`logAiFailure`, `:93-101`), com operação, `requestId`, ator e código.

**Correlação:** o `requestId` do kernel aparece em todos os eventos da chamada.

**Matriz:**
- logging estruturado e sanitizado: PASS (S21/S22: nenhum segredo, prompt, documento, resposta ou mensagem do SDK; mutante M19);
- erros ao usuário: PASS (pt-BR, sem detalhe interno);
- métricas e alertas de taxa de falha do provedor: fora do escopo (P7, PR-OBS-*), registrados.

---

## PASS — revisão de UI de produto em PT-BR

**Escopo:**
- `AiShareConsentDialog`, novo, com 4 variantes;
- chat dos Relatórios: confirmação por pergunta, limites de 3 a 2.000 caracteres;
- formulário de lançamento: comprovante, voz, painel de sugestão, avisos de troca de aba e de sugestão descartada;
- mensagens pt-BR vindas do backend.

**Classificação das mudanças.** Todas são **requeridas** pelo contrato novo: confirmação de envio (D-11.3), revisão da sugestão estruturada (D-11.4) e mensagens corrigidas. Nenhum redesign, layout novo ou reorganização de navegação; os botões existentes mantêm lugar e estilo.

**Execução:** a spec `ai-consent-extraction` cobriu as 11 situações e passou 11/11 na cópia: confirmação, cancelamento, Escape, clique fora, duplo clique, foco preso e devolvido, axe sem violações no diálogo, nenhuma rolagem horizontal a 360 px, HTML como texto, erro do backend em pt-BR, documento inválido, sugestão parcial e completa, troca de aba, fechamento e voz em duas etapas. A spec `ai-chat-isolation` passou 2/2. As specs que usam o formulário de lançamento passaram na suíte completa (167/169; as duas falhas estão fora das superfícies da P5-E1 ou eram defeito do teste, já corrigido).

**Capturas:** `capturas/` em desktop 1280×800 e mobile 390×844, com dados sintéticos:
- diálogo do consultor;
- comprovante;
- voz, início e envio;
- painel de sugestão parcial.

**Texto:**
- pt-BR em todos os diálogos, avisos e erros;
- "Verifique sua chave API" removida;
- falha do provedor com mensagem transparente sobre o crédito;
- nenhuma promessa contratual ("provedor de IA usado pelo FênixGran").

---

## FAIL — regression release gate (P5-E1)

1. **Escopo Git:**
   - branch `integration/p4-finalization-2026-10-08`; HEAD `f0c172b`;
   - base da milestone: árvore `91ed2c58` (P5-D2.1); árvore final do working tree, por índice temporário: `03775e7a` (antes do preenchimento deste campo);
   - diff contra a base: 34 arquivos novos e 34 alterados, nenhum removido (68 arquivos; +9.402 / −562 linhas):
     - Functions: `analysisContext.ts`, `consent.ts`, `extraction.ts`, `prompts.ts` e `testSupport` novos; `callables.ts`, `gateway.ts`, `policy.ts`, `reports/report.ts` e `package.json`/lockfile alterados;
     - frontend: `AiShareConsentDialog.tsx`, `extractionForm.ts` e `scopeToken.ts` novos; `ReportsAIChat.tsx`, `TransactionModal.tsx`, `modules/ai/*` e `modules/reports/{api,aiChatSession,adapter,types}.ts` alterados;
     - testes, evidência e documentação;
   - Rules, índices e `firebase.json` sem diff;
   - índice real sem nada staged; sem commit, push, merge ou deploy; nada publicado.
2. **Evidências:**

   | Etapa | Comando ou inspeção | Resultado |
   | --- | --- | --- |
   | Typecheck, lint, builds | `npm run verify:fast` (repositório, saída 0) | OK; lint com 0 erros e 201 avisos (base: 202), nenhum em arquivo da P5-E1 |
   | Unitários | `verify:fast` | 639 + 763, 0 falhas, 0 skips (base: 573 + 735) |
   | Integração das Functions no Emulator | `functions/lib` oficial em portas próprias (8180/9199) | 941/941, 0 skips (base: 891) |
   | Ferramentas e Rules no Emulator | parte não-Functions de `test:integration:emulator`, em cópia com só as portas trocadas | 273/273, 0 skips (base: 17 + 256) |
   | **`npm run test:integration:emulator` como está** | repositório | **não executável**: porta 8080 ocupada pelo PID 7545 |
   | E2E | `npm run test:e2e` em cópia com só as portas trocadas | 167/169; depois, `ai-consent-extraction` 11/11 e `notifications-p5d2` 8/9 |
   | **`npm run test:e2e` como está** | repositório | **não executável** (porta 8080) |
   | Diff | `git diff --check` (índice temporário, base→árvore) | limpo |
   | Mutações | `mutacoes.json` (rodada final, árvore `6fca66bc`) | 42 mutantes; 41 mortos; 1 equivalente justificado (F08); 0 inválidos; restauração conferida por SHA-256 |
   | Segredos e bundle | busca no repositório e em `dist/` | nenhuma chave, `VITE_*` de IA, endpoint ou SDK do provedor no bundle |
   | Dependências | `npm audit --omit=dev` das Functions | idêntico ao da base; nada vindo de `@google/genai` |
   | Legado | busca no código | só a guarda negativa e um comentário histórico |

3. **Achados:**
   - **Falha intermitente preexistente:** `e2e/notifications-p5d2.spec.ts:832`, variante celular com toque (linha 971 ou painel fechado entre toques). Reproduz na árvore base (1 falha em 16), e o código envolvido não tem diff na P5-E1 (`execucoes.md`). Não foi corrigida aqui por estar fora do escopo.
   - **Corrigido durante a validação:**
     - defeito no teste novo `ai-consent-extraction.spec.ts:241` (pergunta não redigitada antes de confirmar; nenhuma asserção alterada);
     - caminho de captura da sessão gravado na spec, que passou a ser opcional por `E2E_CAPTURE_DIR`.
   - **Revisão independente:** todos os MEDIUM e LOW foram tratados (`revisao-independente.md`).
4. **Skips e cobertura:**
   - 0 skips e nenhum `only`;
   - nenhum timeout aumentado: o `test.setTimeout(120_000)` da spec nova segue o padrão das specs com Emulator e Functions;
   - o repositório não configura métrica de cobertura;
   - total de testes: de 2.630 para 2.785;
   - nenhum teste removido; os testes do contrato antigo da IA foram reescritos para o contrato novo, com mais casos.
5. **Mudanças de superfície:**
   - **UI:** diálogo de confirmação novo; confirmação no chat e no formulário; painel de aviso da sugestão. Todas requeridas por D-11.3/D-11.4, sem redesign (capturas em `capturas/`).
   - **Textos:** pt-BR. Saíram "Verifique sua chave API" e os erros genéricos; entraram mensagens de crédito mantido, de sugestão descartada e de troca de aba.
   - **Rotas:** nenhuma.
   - **Contratos:**
     - payloads das duas callables (estritos, com `providerConsent`; o contexto do cliente sai);
     - resposta da análise com `workspaceType`, `period` e `coverage`;
     - resultado da extração estruturado;
     - opção interna `omitTopClients` no relatório;
     - nomes das callables mantidos.
6. **Riscos residuais:**
   - modelo preview mantido (troca para GA pendente de STAGING);
   - rotação da chave e termos, DPA e região do provedor (externos: PR-AI-02/E-00, E-09, E-10);
   - crédito não devolvido em falha do provedor (política P2B.2 mantida; recomendação comercial registrada);
   - falha intermitente preexistente das notificações no celular.
7. **Bloqueadores para PASS:**
   - **(a)** Encerrar o Firestore Emulator órfão (PID 7545), que prende a porta 8080, e rodar `npm run verify:all` como está no repositório. Isso depende de decisão do usuário.
   - **(b)** Eliminar a falha intermitente de `notifications-p5d2.spec.ts:832` no celular: corrigir a disputa entre o toque e a releitura do painel no milestone dono das notificações e repetir a suíte até não haver falha. Ela é preexistente e não foi causada pela P5-E1, mas impede a prova completa.
8. **Skills de domínio:** todas `PASS`, acima, no escopo da P5-E1:
   - `financial-domain-integrity`;
   - `firestore-scale-cost-review`;
   - `multi-tenant-security-review`;
   - `billing-entitlement-integrity`;
   - `firebase-production-readiness`;
   - `privacy-lgpd-data-lifecycle`;
   - `observability-incident-readiness`;
   - revisão de UI em pt-BR.

   `saas-commercial-readiness` não se aplica: nenhuma página pública, preço ou funil foi tocado.
