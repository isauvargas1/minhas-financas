# Subprocessadores e transferência internacional

Documento de referência dos terceiros que recebem, processam ou podem observar dados pessoais dos usuários do produto, e das transferências internacionais que isso implica. A lista foi montada a partir do código e da configuração no HEAD `9c3ab46`: `firebase.json`, `src/lib/firebase.ts`, `index.html`, `functions/src/ai/callables.ts`, `functions/src/callables/billing.ts`, `functions/src/webhooks/stripe.ts` e o uso de APIs e recursos do navegador. Estado, IDs e milestones seguem o [plano mestre](PRODUCTION_READINESS_PLAN.md). O gate é a skill `privacy-lgpd-data-lifecycle`, que dá `FAIL` a qualquer dado pessoal enviado a um terceiro que não esteja listado aqui.

> **Este documento não é parecer jurídico.** A qualificação de cada fornecedor (suboperador, operador ou controlador independente), os contratos (DPA) e o mecanismo de transferência internacional (LGPD, art. 33, a confirmar) dependem do jurídico: E-09 e E-10, com estado NÃO VERIFICADO.

Os rótulos **CURRENT**, **TARGET**, **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED** seguem a [classificação do plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction). O inventário de dados pessoais que alimenta esta lista está em [PRIVACY_LGPD.md](PRIVACY_LGPD.md#3-inventário-de-dados-pessoais-current).

---

## 1. Critérios

- Entra aqui todo serviço de terceiro que recebe dado pessoal, inclusive IP, user agent e Referer de requisições do navegador, ou que executa código com acesso à sessão.
- **Região:** só é CURRENT quando o repositório a fixa. Hoje isso vale apenas para Firestore (`firebase.json:4`) e Functions (`functions/src/shared/runtimeOptions.ts:38-42`; `src/lib/firebase.ts:43-45`), ambos em `southamerica-east1`. Todo o resto está NÃO VERIFICADO e exige verificação externa.
- **Contrato/DPA:** nenhum contrato, aceite de adendo ou tier está evidenciado no repositório. Todos são EXTERNAL CONFIGURATION REQUIRED (E-09, e E-10 para IA), com estado NÃO VERIFICADO.
- **Divulgação ao usuário:** CURRENT inexistente para todos os itens. Não há política nem página que liste terceiros (PR-PRIV-01).

---

## 2. Subprocessadores em uso (CURRENT)

| # | Fornecedor / serviço | Finalidade no produto | Dados pessoais compartilhados | Onde é invocado (evidência) | Região de processamento | Transferência internacional | Contrato / DPA | Classificação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Google — Firebase Authentication (login com Google) | Autenticação e sessão | `uid`, nome, e-mail, foto e provedor da conta Google; IP e dados de dispositivo da sessão | `src/lib/firebase.ts:37`; `src/contexts/AuthContext.tsx:83-86` | NÃO VERIFICADO | NÃO VERIFICADO | E-09 — NÃO VERIFICADO | CURRENT |
| 2 | Google — Cloud Firestore | Banco de todos os dados do produto (conta, workspace, financeiro, terceiros, trilhas) | Todo o inventário de [PRIVACY_LGPD.md](PRIVACY_LGPD.md) | `firebase.json:2-7`; `src/lib/firebase.ts:38` | `southamerica-east1` (`firebase.json:4`) | Armazenamento primário no Brasil. Acesso de suporte e operação do provedor: NÃO VERIFICADO. | E-09 — NÃO VERIFICADO | CURRENT |
| 3 | Google — Cloud Functions for Firebase (2ª geração), com gatilho de Firestore e crons agendados | Callables, gatilho `onTransactionWrite`, 3 crons e webhook Stripe | Payloads das callables (inclusive os enviados à IA e ao checkout) e dados lidos do Firestore | `functions/src/index.ts:13-37`; `functions/src/triggers/transactions.ts:35`; `functions/src/crons/recurring.ts:571`; `functions/src/crons/creditCardInvoices.ts:315`; `functions/src/crons/investmentDrift.ts:325` | `southamerica-east1` (`functions/src/shared/runtimeOptions.ts:38-42`). A região da infraestrutura de agendamento e de eventos: NÃO VERIFICADO. | Execução no Brasil; demais componentes NÃO VERIFICADO | E-09 — NÃO VERIFICADO | CURRENT |
| 4 | Google — Firebase Hosting | Entrega do app estático | IP, user agent e URL de cada visitante | `firebase.json:25-58` | NÃO VERIFICADO (CDN do provedor) | NÃO VERIFICADO | E-09 — NÃO VERIFICADO | CURRENT |
| 5 | Google — Cloud Logging | Logs das Functions | `actorId` (uid) nas falhas de IA; `sessionId` do Stripe e `error.message` no webhook | `functions/src/ai/callables.ts:151-158,251-257`; `functions/src/webhooks/stripe.ts:55,65-66,73-74,87-88` | NÃO VERIFICADO (bucket e retenção: E-08) | NÃO VERIFICADO | E-09 — NÃO VERIFICADO | CURRENT |
| 6 | Google — Secret Manager | Guarda de `GOOGLE_AI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS` | Nenhum dado pessoal (só credenciais e configuração) | `functions/src/ai/callables.ts:24-29`; `functions/src/callables/billing.ts:90-94`; `functions/src/webhooks/stripe.ts:35-39` | NÃO VERIFICADO (replicação: E-05) | Não se aplica a dados pessoais | E-09 — NÃO VERIFICADO | CURRENT (listado por completude) |
| 7 | Google — Gemini API (chave do Google AI Studio; modelo `gemini-3-flash-preview`) | Análise financeira e extração de lançamento | Pergunta livre; KPIs, 5 maiores categorias e alertas montados no cliente; imagem ou PDF integral do comprovante (até ~6 MB em base64); transcrição de voz | `functions/src/ai/callables.ts:118-124,222-238`; payload em `functions/src/ai/callables.ts:50-72,173-197` | NÃO VERIFICADO. A auditoria aponta ausência de residência de dados com chave AI Studio (FIRE-11). | NÃO VERIFICADO; provável | E-10 (retenção, treinamento, revisão humana, tier) e E-09 (DPA) — NÃO VERIFICADO | CURRENT; DECISION D-11; GAP PR-AI-01 |
| 8 | Stripe | Checkout de assinatura e webhook de pagamento | E-mail do token (`customer_email`), `uid` em `metadata`, `priceId`; cartão e dados de cobrança coletados na página hospedada do Stripe; IDs de customer e assinatura voltam para `users/{uid}` | `functions/src/callables/billing.ts:136-146`; `src/modules/billing/hooks.ts:34`; `functions/src/webhooks/stripe.ts:52,97-106` | NÃO VERIFICADO | NÃO VERIFICADO | E-06 (configuração) e E-09 (DPA, papel) — NÃO VERIFICADO | CURRENT |
| 9 | Tailwind Labs — `cdn.tailwindcss.com` (Tailwind Play CDN) | Gera o CSS no navegador | IP, user agent e Referer em toda carga, inclusive antes do login. O script roda na origem da sessão, com acesso ao token e aos dados exibidos. | `index.html:8,12-13` | NÃO VERIFICADO | NÃO VERIFICADO | Nenhum contrato | CURRENT; GAP PR-PLAT-03; DECISION D-20 |
| 10 | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | Fonte Poppins | IP, user agent e Referer em toda carga | `index.html:9-11` | NÃO VERIFICADO | NÃO VERIFICADO | E-09 — NÃO VERIFICADO | CURRENT; GAP PR-PLAT-03 |
| 11 | `esm.sh` (importmap) | Mapeia `react`, `recharts`, `@tanstack/react-query`, `@google/genai` e outros para o CDN | IP e user agent, se o mapeamento for consultado | `index.html:75-90`. O build não declara `external` (`vite.config.ts:36-59`), então a requisição efetiva em runtime não foi verificada. | NÃO VERIFICADO | NÃO VERIFICADO | Nenhum contrato | CURRENT (declarado); GAP PR-PLAT-03 |
| 12 | Mixkit (`assets.mixkit.co`) | Efeitos sonoros da interface, ligados por padrão e tocados a cada navegação | IP, user agent e Referer a cada som carregado | `src/contexts/ThemeContext.tsx:28-43,155-170`; `src/contexts/themePresets.ts:10-19`; `src/App.tsx:236-246` | NÃO VERIFICADO | NÃO VERIFICADO | Nenhum contrato | CURRENT; GAP PR-PLAT-03 |
| 13 | Serviço de reconhecimento de fala do navegador (Web Speech API) | Transcreve a voz para o lançamento por IA | Áudio da voz do usuário. Segundo a auditoria (PRIV-05), no Chrome o áudio vai a um servidor do Google; isso não é verificável no repositório. | `src/components/TransactionModal.tsx:723-737` | NÃO VERIFICADO | NÃO VERIFICADO | O SaaS não tem contrato: o serviço vem do navegador. O enquadramento jurídico é E-09 — NÃO VERIFICADO. | CURRENT; DECISION D-11 |

**Observações CURRENT:**

- O Cloud Storage é inicializado no cliente (`src/lib/firebase.ts:4,39`), mas nada o usa e o `firebase.json` não tem seção `storage` (FIRE-12). Hoje não recebe dados. TARGET: remover a inicialização ou versionar Rules deny-all (P6).
- Não há analytics, trackers nem monitoramento de erros de terceiro no cliente. A busca por `gtag`, `getAnalytics`, `sentry`, `posthog` e `hotjar` em `src` e `index.html` dá zero. Adotar monitoramento de erros de terceiro depende da DECISION D-25 (linha T3).
- A CI (`.github/workflows/quality-gate.yml`) roda no Emulator, sem segredos e sem dados de titulares. Por isso o GitHub não entra como subprocessador de dados de usuários.

---

## 3. Subprocessadores previstos (TARGET)

| # | Fornecedor / serviço | Finalidade | Dados pessoais previstos | Onde entra | Região | Transferência | Contrato / DPA | Classificação |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Google — reCAPTCHA Enterprise (provedor do App Check) | Atestação do app e antiabuso | Sinais do navegador e do dispositivo, IP | `initializeAppCheck` em `src/lib/firebase.ts` e enforcement nas callables, Firestore e Auth (PR-APPCHK-01) | A verificar | A verificar | E-02 (configuração), E-09 (DPA) — NÃO VERIFICADO | TARGET — P6 |
| T2 | Provedor de e-mail transacional (a escolher) | Convites de workspace e avisos de conta | E-mail e nome do convidado ou usuário, conteúdo da mensagem | Callables de convite de P1 (PR-WS-01) | A verificar | A verificar | E-11 (domínio, SPF/DKIM/DMARC), E-09 (DPA) — NÃO VERIFICADO | TARGET — P1; DECISION D-05 |
| T3 | Monitoramento de erros do frontend (se for adotado) | Captura de erros do cliente | Stack, URL, user agent e possivelmente `uid`; exige sanitização | Escopo de observabilidade de P7 (PR-OBS-01) | A verificar | A verificar | E-09 — NÃO VERIFICADO | TARGET condicional — P7; DECISION D-25 |
| T4 | Google — Vertex AI, em substituição à Gemini API | Mesmas finalidades da linha 7 | Mesmos dados, minimizados (D-11) | `functions/src/ai/callables.ts` | Região aprovada a definir | A verificar | E-10, E-09 — NÃO VERIFICADO | TARGET condicional — P5/P8; DECISION D-11 |

---

## 4. Transferência internacional

| Fluxo | CURRENT | TARGET |
| --- | --- | --- |
| Armazenamento e processamento principal (Firestore, Functions) | No Brasil (`firebase.json:4`; `functions/src/shared/runtimeOptions.ts:38-42`). O acesso de suporte do provedor não foi verificado. | Confirmar os termos do provedor quanto a acesso e suporte fora do Brasil (E-09). |
| Auth, Hosting, Logging, Secret Manager | Região não fixada no repositório; NÃO VERIFICADO. | Registrar a região efetiva de cada um em PROD (E-01, E-05, E-08) e o mecanismo legal (E-09). |
| IA (Gemini) | Dados financeiros agregados, comprovantes e transcrições enviados sem região definida (FIRE-11). | Provedor e região aprovados, termos de não treinamento, minimização e divulgação na política (D-11, E-10, PR-AI-01). |
| Stripe | Região NÃO VERIFICADO. | Registrar o papel do Stripe, a região e o mecanismo legal (E-06, E-09). |
| Terceiros no navegador (linhas 9–13) | IP e metadados de requisição enviados a CDNs, fontes, sons e serviço de fala, sem divulgação. | Remover os de runtime em P6 (PR-PLAT-03). O que restar (ex.: fala, se D-11 mantiver a voz) é divulgado na política. |
| Mecanismo legal (art. 33) | Nenhum registrado. | Mecanismo por fornecedor validado pelo jurídico (E-09), registrado na §5. |

---

## 5. Registro de evidência contratual (EXTERNAL CONFIGURATION REQUIRED)

Nada aqui pode ser verificado pelo repositório. Preencher só com evidência (aceite no console, contrato assinado, página de termos arquivada com data).

| Fornecedor | Evidência esperada | ID | Estado | Data | Responsável |
| --- | --- | --- | --- | --- | --- |
| Google Cloud / Firebase | Aceite do adendo de processamento de dados do Google Cloud no projeto PROD; lista de subprocessadores do provedor arquivada | E-09 | NÃO VERIFICADO | — | — |
| Google Cloud / Firebase | Região efetiva de Auth, Hosting, Logging e Secret Manager em PROD | E-01, E-05, E-08 | NÃO VERIFICADO | — | — |
| Gemini API ou Vertex AI | Tier contratado, termos de retenção, uso para treinamento e revisão humana, região | E-10 | NÃO VERIFICADO | — | — |
| Gemini API ou Vertex AI | DPA e mecanismo de transferência | E-09 | NÃO VERIFICADO | — | — |
| Gemini (chave exposta no passado) | Revogação da chave antiga e emissão de chaves por ambiente | E-00 | NÃO VERIFICADO | — | — |
| Stripe | DPA, papel (operador ou controlador independente para dados de pagamento) e região | E-09 | NÃO VERIFICADO | — | — |
| Stripe | Conta, preços, webhook e Customer Portal por ambiente | E-06 | NÃO VERIFICADO | — | — |
| Google Fonts, Tailwind CDN, `esm.sh`, Mixkit | Remoção em P6, ou justificativa e divulgação se algum for mantido | E-09 | NÃO VERIFICADO | — | — |
| Web Speech API | Enquadramento e texto de divulgação, se a voz for mantida | E-09 | NÃO VERIFICADO | — | — |
| reCAPTCHA Enterprise | Chave por ambiente e termos aplicáveis | E-02, E-09 | NÃO VERIFICADO | — | — |
| Provedor de e-mail transacional | Contrato, DPA, domínio autenticado | E-11, E-09 | NÃO VERIFICADO | — | — |

---

## 6. Regras de manutenção

1. **Novo subprocessador:** qualquer serviço, SDK, script, fonte, mídia ou API de navegador que passe a receber dado pessoal ou IP do usuário exige atualizar este documento, o inventário de [PRIVACY_LGPD.md](PRIVACY_LGPD.md) e a Política de Privacidade **antes** do uso em produção. Sem isso, o gate `privacy-lgpd-data-lifecycle` é `FAIL`.
2. **Mudança de fornecedor, região, tier ou modelo** (ex.: Gemini API para Vertex AI, modelo preview para GA) atualiza a linha correspondente e a política na mesma mudança.
3. **Remoção em P6 (PR-PLAT-03):** compilar o Tailwind (D-20), auto-hospedar as fontes e os sons (ou remover os sons) e remover o importmap tira as linhas 9, 10, 11 e 12. Linhas removidas vão para a §7 com a evidência do commit.
4. **Verificação automática (TARGET, P6):** um teste confere que o `index.html` e o bundle não fazem requisição a hosts fora desta lista (teste 9 de [PRIVACY_LGPD.md](PRIVACY_LGPD.md#14-testes-obrigatórios-target)), e a CSP de Hosting limita `script-src`, `font-src`, `media-src` e `connect-src` aos hosts listados.
5. **Revisão:** a cada milestone que toque integração externa (P1 e-mail, P2 Stripe, P5 IA, P6 App Check e Hosting, P7 monitoramento) e na reauditoria de P10.

---

## 7. Histórico de remoções

Nenhuma remoção até o HEAD `9c3ab46`.

| Fornecedor | Removido em | Evidência |
| --- | --- | --- |
| — | — | — |

---

## 8. Lacunas

| ID | Sev. | Milestone | Lacuna |
| --- | --- | --- | --- |
| PR-PRIV-01 | HIGH | P8 | Subprocessadores e transferência internacional não divulgados ao titular |
| PR-AI-01 | BLOCKER | P8 | Envio ao Gemini sem base legal, transparência nem contrato ou tier comprovado |
| PR-AI-02 | BLOCKER | P0 (E-00) | Chave Gemini exposta no passado, sem rotação comprovada |
| PR-PLAT-03 | HIGH | P6 | Scripts e recursos de terceiros em runtime (Tailwind Play CDN, Google Fonts, sons do Mixkit) e importmap `esm.sh`, sem CSP |
| PR-APPCHK-01 | HIGH | P6 | App Check ausente; reCAPTCHA Enterprise entra como novo subprocessador |
| FIRE-11 | MEDIUM | P5 | IA com modelo preview e chave AI Studio, sem residência de dados |
| FIRE-12 | LOW | P6 | Cloud Storage inicializado sem uso e sem Rules versionadas |
