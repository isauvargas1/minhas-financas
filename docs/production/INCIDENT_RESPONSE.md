# Resposta a incidentes

Este documento cobre três coisas: o que existe hoje para detectar e conter incidentes, o processo alvo (severidades, papéis, fluxo, comunicação, pós-incidente e exercícios) e os playbooks por cenário deste produto. Baseline: HEAD `9c3ab46`. Os IDs são os do plano mestre [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers), e o processo fecha no P7. O gate do tema é a skill `observability-incident-readiness`. A comunicação à ANPD e aos titulares também passa por `privacy-lgpd-data-lifecycle`, e as alavancas de plataforma por `firebase-production-readiness`. As ameaças que originam os incidentes estão em [THREAT_MODEL.md](THREAT_MODEL.md).

> Rótulos: **CURRENT** (existe no HEAD, com evidência `arquivo:linha`), **TARGET** (alvo, não implementado), **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED** (estado NÃO VERIFICADO até haver registro). Este documento não é parecer jurídico. As referências à LGPD e à ANPD precisam ser confirmadas pelo jurídico (E-09).

## 1. Estado atual (CURRENT)

### 1.1 Processo, papéis e contatos

- **CURRENT:** não há processo de resposta a incidentes, severidades, papéis, escala de plantão, contatos nem drills. Não existe `SECURITY.md` na raiz. Uma busca por "incidente", "incident" e "postmortem" em `docs/` e `README.md` não encontra nada fora de `docs/production/`. GAP PR-OBS-02.
- **CURRENT:** não há canal de suporte nem do titular (PR-PRIV-01: `src/components/auth/LoginView.tsx:50-52`). Também não há provedor de e-mail transacional no código: uma busca por `nodemailer`, `sendgrid`, `resend`, `mailgun` e `postmark` em `functions/src`, `src` e nos `package.json` não encontra nada. Hoje não existe como avisar usuários fora da própria UI.
- **CURRENT:** os alertas existem só como sugestão em documento (`docs/investments/PRODUCTION_DEPLOYMENT_CHECKLIST.md:276-278`, "Nada disto é código"). GAP PR-OBS-01.

### 1.2 Detecção disponível

| Sinal | Onde (CURRENT) | Limitação (GAP) |
| --- | --- | --- |
| Falhas e métricas de investimentos | Documentos Firestore por workspace (`functions/src/investments/observability.ts:83-128,169-242`) | Sem Cloud Logging estruturado nem alerta (PR-OBS-01) |
| Falhas das callables de cartão | `processing_failure` em `financial_events` mais uma notificação ao workspace (`functions/src/creditCards/observability.ts:72-101,205-301`) | Sem teto nem alerta (NOTIF-04) |
| Execução de crons | Resumo em `console.log` com contagens (`truncated` em recorrentes e faturas; `inconclusive` na deriva) (`functions/src/crons/recurring.ts:571-585`; `functions/src/crons/creditCardInvoices.ts:315-438`; `functions/src/crons/investmentDrift.ts:368-374`) | Não estruturado. Nada alerta sobre cron que não rodou (ENTRY-16) |
| Deriva patrimonial | `processInvestmentDriftScan` grava `investment_drift_reports` (`functions/src/crons/investmentDrift.ts:325-375`) | 50 workspaces por execução (`functions/src/crons/investmentDrift.ts:58`). Compara projeções entre si, não contra o ledger (INV-05). Sem alerta |
| Caixa oficial | Nenhum detector de deriva. O gatilho roda sem retry (`functions/src/triggers/transactions.ts:35-37`) | Divergência silenciosa (PR-TX-04) |
| Erros inesperados de callables | Convertidos em `HttpsError` e nunca registrados (`functions/src/creditCards/errors.ts:78-83`; `functions/src/goals/callables.ts:49-55`) | Invisíveis no Cloud Logging (PR-OBS-01) |
| Webhook Stripe | Nenhum registro de evento (`functions/src/webhooks/stripe.ts:49-110`) | Só o painel do Stripe mostra as entregas (PR-BILL-06, E-06) |
| Frontend | Sem ErrorBoundary nem telemetria de erro (FIRE-04) | Quem detecta é o usuário |
| Custo | Nenhum alerta de orçamento versionado | E-08 |

### 1.3 Mecanismos de contenção existentes

| Mecanismo | Evidência (CURRENT) | O que contém | Limitação |
| --- | --- | --- | --- |
| Rate limit transacional | `functions/src/shared/rateLimit.ts:49-66,89`. IA: 20/h e 60/h (`functions/src/ai/callables.ts:44-48,167-171`). Checkout: 10/h (`functions/src/callables/billing.ts:70-74,126-134`). Investimentos: `functions/src/investments/infrastructure.ts:266-270` | Abuso de um ator num workspace | Contornável criando workspaces (PR-AI-03). Ausente em cartões e metas (ENTRY-12). Revertido nos convites de divisão de contas (SPLIT-09). Os limites só mudam por deploy |
| `maxInstances` por classe | `functions/src/shared/runtimeOptions.ts:41-91` (global 20, domínio 20, pesada 3, IA 10, cron 1) | Teto de concorrência e de custo | Não é interruptor. Mudar exige deploy |
| Firestore Rules | Default deny fora de `workspaces/` e `users/` (`firestore.rules:990,1456`). Domínios server-only (`firestore.rules:1121-1349`). Campos de plano e admin não graváveis (`firestore.rules:148-157`) | Escrita direta do cliente nos domínios server-only | Para bloquear um domínio é preciso editar e publicar Rules à mão no projeto único (PR-PLAT-01), sem ensaio |
| Remoção de membership | `firestore.rules:1046-1050`; `src/modules/workspaces/api.ts:249-252`. O backend recusa membership inativa (`functions/src/creditCards/auth.ts:81-87`) | Corta o acesso de um membro ao workspace | Feita só pelo cliente, por hard delete e sem auditoria (WS-11). Risco de trancar o titular fora (PR-WS-04) |
| IA falha fechada sem chave | `functions/src/ai/callables.ts:107-116` | Revogar a chave no provedor interrompe a IA | Desliga a IA inteira, não só um tenant |
| Baixa lógica em `transactions` | `firestore.rules:1094` | Preserva o histórico de caixa | Não cobre as coleções adjacentes (PR-RULES-01) |

### 1.4 Ausências verificadas no HEAD

- **Interruptor, modo manutenção ou somente leitura:** nenhuma ocorrência de kill switch, `maintenance`, modo somente leitura ou flag operacional em `functions/src`, `src` e `firestore.rules`. O único documento `system/` é o cursor da varredura de deriva (`functions/src/crons/investmentDrift.ts:66`). Hoje, desligar uma funcionalidade exige deploy.
- **Suspensão e revogação de sessão:** nenhuma ocorrência de `revokeRefreshTokens`, `checkRevoked`, `updateUser(` ou `setCustomUserClaims` em `functions/src` e `src` (AUTH-09, PR-OBS-02).
- **Backup, PITR e restore:** nenhum (`firebase.json:2-7`; PR-BKP-01).
- **Ambiente para reproduzir e ensaiar:** existe um único projeto (`.firebaserc:3`; PR-PLAT-01).
- **Releases versionadas e rollback testado:** nenhum (`package.json:4`, versão `0.0.0`; PR-REL-01).
- **Registro e replay de webhook:** nenhum (PR-BILL-06).
- **Ferramentas administrativas:** nenhuma callable administrativa (`functions/src/index.ts:13-37`; PR-ADMIN-01).

## 2. Severidades (TARGET)

Suspeita de SEV1 é tratada como SEV1 até a triagem. Um incidente que envolva dado pessoal abre também a trilha de privacidade (§6.6), qualquer que seja a severidade.

| SEV | Critério | Exemplos neste produto | Acionamento e contenção (**DECISION** D-32, proposta) |
| --- | --- | --- | --- |
| SEV1 | Dano em curso ou confirmado a dados de vários clientes, a dinheiro ou a um segredo de produção, ou produto inteiro fora | Vazamento cross-tenant confirmado. Perda ou corrupção do ledger em vários workspaces, por exemplo pela ferramenta destrutiva (PR-PLAT-02). Chave Gemini ou `STRIPE_SECRET_KEY` exposta e utilizável (E-00). Plano concedido em massa por webhook forjado (PR-BILL-05). Cobrança em dobro em escala (PR-BILL-03). Hosting publicado com build E2E (PR-AUTH-04) | Acionar em até 15 min. Contenção em até 1 h. Atualização interna a cada 30 min |
| SEV2 | Impacto confirmado e limitado, ou função crítica degradada sem perda irreversível | Projeção de caixa divergente num workspace (PR-TX-04). Webhook parado. Cron diário que não rodou. Abuso de custo de IA em curso (PR-AI-03). Conta owner/admin comprometida. Incidente com dados de poucos titulares | Acionar em até 1 h. Contenção em até 4 h |
| SEV3 | Degradação parcial com contorno | Consulta falhando por índice ausente (PR-CC-08). Notificações que não carregam (PR-NOTIF-01). Orçamento em 50% | Próximo dia útil |
| SEV4 | Nenhum impacto em dado ou dinheiro | Pico de `permission-denied` sem sucesso. Defeito cosmético | Backlog |

## 3. Papéis e contatos

| Papel (TARGET) | Responsabilidade |
| --- | --- |
| Coordenador do incidente (IC) | Declara a SEV, decide a contenção, mantém a linha do tempo e encerra o incidente |
| Responsável técnico | Diagnóstico, contenção, correção e verificação |
| Comunicação | Clientes afetados, fornecedores e página de status |
| Privacidade e jurídico (encarregado) | Avalia o risco aos titulares, decide a comunicação à ANPD e aos titulares e mantém o registro do incidente |
| Registro | Linha do tempo, ações, evidências e cadeia de custódia |
| Aprovador de ação em produção | Autoriza rollback, restore, publicação de Rules e rotação. Depois do P6, pelo environment com aprovação do CD (E-12) |

Uma pessoa pode acumular papéis. Em SEV1, o IC deve ser separado do responsável técnico sempre que possível. Agentes de IA não executam ações em produção nem acessam os dados dela (`CLAUDE.md:15-19`). Podem apoiar a análise de código e de artefatos exportados em ambiente não produtivo, com dados minimizados.

| Contato (**EXTERNAL CONFIGURATION REQUIRED**) | Uso | Estado | Referência |
| --- | --- | --- | --- |
| Escala de plantão e canal interno do incidente | Acionamento | NÃO VERIFICADO | **DECISION** D-28 |
| Encarregado de dados | ANPD e titulares | NÃO VERIFICADO | D-21, E-09 |
| Canal público de suporte e do titular | Entrada de relatos | NÃO VERIFICADO | D-21, PR-PRIV-01 |
| Suporte Google Cloud/Firebase | Incidente de plataforma | NÃO VERIFICADO | E-01 |
| Suporte Stripe | Cobrança, webhook e disputa | NÃO VERIFICADO | E-06 |
| Provedor de IA | Chave comprometida ou uso indevido | NÃO VERIFICADO | E-10 |
| Jurídico | Comunicação regulatória | NÃO VERIFICADO | E-09 |
| Provedor de e-mail transacional | Aviso a usuários | NÃO VERIFICADO | E-11, D-05 |

## 4. Fluxo de resposta (TARGET)

1. **Detecção.** Fontes: alertas registrados em [OBSERVABILITY.md](OBSERVABILITY.md) (E-08, PR-OBS-01), canal de suporte (D-21), painel do Stripe, alerta de orçamento, reconciliação financeira e auditoria. **CURRENT:** só relato de usuário e inspeção manual (§1.2).
2. **Triagem.** Confirmar o fato, atribuir SEV e IC e abrir o registro do incidente: ID, hora (America/Sao_Paulo), quem detectou, SEV, escopo (workspaces, usuários, período) e se há dado pessoal envolvido. Se houver, iniciar o §6.6.
3. **Contenção.** Usar a alavanca menos destrutiva que interrompa o dano (§5). Registrar cada ação com autor e hora. Não alterar os dados afetados antes de preservar a evidência (§7), salvo para parar um dano ativo.
4. **Erradicação.** Corrigir a causa raiz no fluxo normal, com teste de regressão que reproduza o incidente e `regression-release-gate` em `PASS`. Depois do P6, a correção só vai para produção pelo CD. Um procedimento de *break-glass* é **DECISION** (D-32).
5. **Recuperação.** Fazer restore ou reconciliação ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)) e rodar os rebuilds do domínio (§6.2). Verificar pela reconciliação financeira. Monitorar reforçado até o encerramento.
6. **Pós-incidente.** Postmortem sem culpados (§9) e ações registradas no plano.

## 5. Catálogo de alavancas de contenção

| Alavanca | CURRENT | TARGET | GAP | Milestone |
| --- | --- | --- | --- | --- |
| Desligar funcionalidade ou callable | Não existe (§1.4). Só por deploy | Flag operacional server-side avaliada pelo wrapper do kernel antes de executar, com auditoria de quem ligou e desligou | PR-OBS-02 | P7 |
| Modo somente leitura (global ou por workspace) | Não existe | Estado avaliado pelo wrapper e pelas Rules | PR-OBS-02 | P7 |
| Suspender usuário e revogar sessão | Não existe no código. Desativar no console do Auth é EXTERNAL, e o token vigente segue válido até expirar (AUTH-09) | Callable de suspensão com `revokeRefreshTokens`, `users/{uid}.status` e `checkRevoked` nas operações sensíveis | AUTH-09, PR-OBS-02, PR-ADMIN-01 | P1, P7 |
| Remover membro | Pelo cliente, por hard delete (`src/modules/workspaces/api.ts:249-252`) | `removeMember` por callable, com remoção lógica e auditoria | PR-WS-02 | P1 |
| Rotacionar segredo | Manual no Secret Manager. O webhook falha **aberto** com segredo vazio (`functions/src/webhooks/stripe.ts:9,52`) | Segredos por ambiente, sem fallback, com runbook de rotação ([RUNBOOKS.md](RUNBOOKS.md)) | PR-BILL-05 (E-05) | P2, P6 |
| Revogar chave de IA | Ação no console do provedor. A IA falha fechada (`functions/src/ai/callables.ts:107-116`) | Somar quota por plano e App Check | PR-AI-02 (E-00) | P0 |
| Pausar o webhook no Stripe | Painel do Stripe (EXTERNAL) | Fila de falhas e replay idempotente | PR-BILL-06 | P2, P7 |
| App Check enforcement | Não existe | Enforcement em callables, Firestore e Auth | PR-APPCHK-01 (E-02, D-33) | P6 |
| Bloquear escrita por Rules | Edição e publicação manual no projeto único | Versão de Rules publicada pelo CD, com rollback | PR-PLAT-01, PR-REL-01 | P6 |
| Rollback de Hosting, Functions e Rules | Sem versão nem teste (`package.json:4`; REL-13) | Job de rollback do CD que republica a tag anterior | PR-REL-01 (E-12) | P6 |
| Teto de custo | `maxInstances` por classe (`functions/src/shared/runtimeOptions.ts:41-91`) | Quotas por plano, cota da API de IA e alerta de orçamento | PR-AI-03 (E-08) | P2, P7 |

## 6. Playbooks

Os playbooks são **TARGET**: descrevem o procedimento esperado e mostram o que falta no HEAD. Toda ação em produção é executada por um humano autorizado. Agentes estão proibidos (`CLAUDE.md:15-16`; `.claude/settings.json:3-76`).

### 6.1 Segredo exposto

- **Gatilho:** segredo em commit, bundle, log, ticket ou chat; uso anômalo no provedor; aviso do provedor.
- **SEV inicial:** SEV1 se o segredo for de produção e ainda utilizável; SEV2 se já estiver revogado ou for de teste.
- **Passos:**
  1. Identificar o segredo, os ambientes afetados e a janela de exposição (histórico git e builds publicados).
  2. Criar a credencial nova no provedor, restrita ao mínimo (API, referrers, escopo).
  3. Adicionar uma versão nova no Secret Manager do projeto correto. **Nunca deixar o segredo vazio:** no HEAD, `STRIPE_WEBHOOK_SECRET` vazio vira `whsec_placeholder`, e o webhook passa a aceitar eventos assinados com um valor público (`functions/src/webhooks/stripe.ts:9,52`; PR-BILL-05).
  4. Reimplantar as funções que declaram o segredo (`functions/src/ai/callables.ts:24-29`; `functions/src/callables/billing.ts:90-94`; `functions/src/webhooks/stripe.ts:35-39`) para que usem a versão nova. Confirmar o comportamento de versão no ensaio em STAGING.
  5. Revogar a credencial antiga no provedor e desabilitar a versão antiga.
  6. Verificar que a credencial antiga falha e que o fluxo normal funciona.
  7. Revisar o uso durante a janela (faturamento do provedor, painel do Stripe, Cloud Audit Logs) e avaliar se houve dado pessoal envolvido (§6.6).
  8. Registrar a evidência: data, responsável, IDs de versão e de chave. Nunca o valor.
- **Caso E-00 (chave Gemini), CURRENT:** de `39806fb` (2026-01-22) até `92473c8` (2026-08-24), a chave era injetada no bundle público (`git show 39806fb:vite.config.ts:14-15`; `vite.config.ts:14-19`). Segundo a auditoria, o `.env.local` de desenvolvimento ainda guarda uma `GEMINI_API_KEY` (valor não lido), e não há evidência de rotação. **GAP:** PR-AI-02 (P0, ação externa imediata; D-ORD-06; R-06). **Passos específicos:**
  1. Revogar toda chave que já esteve no `.env.local` ou num bundle.
  2. Criar uma chave por ambiente, restrita à Generative Language API e com quota.
  3. Gravá-la como `GOOGLE_AI_API_KEY` no Secret Manager de cada projeto.
  4. Remover `GEMINI_API_KEY` do `.env.local`.
  5. Revisar o consumo da API no período.
  6. Verificar se há conteúdo armazenado no projeto que a chave consiga acessar. O código atual envia o documento inline (`functions/src/ai/callables.ts:227-238`).
  7. Registrar a evidência em [SECURITY_MODEL.md](SECURITY_MODEL.md).

### 6.2 Divergência financeira

- **Gatilho:** relato de usuário; `investment_drift_reports`; `cash_report_periods` diferente da soma das transações; fatura que não bate com os pagamentos; saldo de empréstimo incoerente (PR-LOAN-02).
- **SEV inicial:** SEV1 se atinge vários workspaces ou houve perda irreversível; SEV2 se atinge um workspace.
- **Contenção:** **CURRENT**, não há modo somente leitura. As opções são drásticas (publicar Rules negando escrita no domínio, ou retirar a membership) e exigem aprovação do IC. **TARGET:** somente leitura por workspace (§5).
- **Evidência:** exportar as coleções do workspace **antes** de qualquer rebuild (§7).
- **Recuperação CURRENT.** As ferramentas existentes não têm tela montada para chamá-las (FEW-15):
  - `rebuildCashPeriods` (`functions/src/cash/rebuild.ts:247`): owner/admin, com `dryRun` e paginação. Não tem cerca de versão e pode publicar valores absolutos desatualizados se houver escrita concorrente (ENTRY-08, PR-TX-04). Rodar só com a escrita contida.
  - `recalculateCardLimit` e `rebuildCardInvoicesForCard` (`functions/src/creditCards/callables.ts:163,182`): owner/admin (e `system`) (`functions/src/creditCards/writeStrategy.ts:240,256`).
  - `rebuildInvestmentProjections` (`functions/src/investments/callables.ts:244`) e a varredura `processInvestmentDriftScan` (`functions/src/crons/investmentDrift.ts:325`).
  - Empréstimos, recebíveis, divisão de contas e recorrentes não têm fonte autoritativa de onde reconstruir. A correção é manual, e o hard delete é irreversível sem backup (PR-RULES-01, PR-BKP-01).
- **TARGET:** eventos append-only que permitem reconstruir cada domínio (P3–P5); reconciliação por domínio com alerta (P7, [OBSERVABILITY.md](OBSERVABILITY.md)); restore ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)). A correção dos totais é validada pela skill `financial-domain-integrity` ([FINANCIAL_DOMAIN_MODEL.md](FINANCIAL_DOMAIN_MODEL.md)).

### 6.3 Falha ou forja do webhook Stripe

- **Gatilho:** entregas falhando no painel do Stripe; usuário que pagou e continua sem plano; plano concedido sem pagamento.
- **SEV inicial:** SEV2 se o webhook parou; SEV1 se há forja ou concessão em massa.
- **CURRENT:**
  - Só `checkout.session.completed` é tratado (`functions/src/webhooks/stripe.ts:60`).
  - `event.id` não é registrado (`functions/src/webhooks/stripe.ts:49-110`).
  - O segredo tem fallback público (`functions/src/webhooks/stripe.ts:9`).
  - Não há log estruturado (PR-OBS-01).
  - O plano nunca é revogado (PR-BILL-01): cancelamentos e falhas de pagamento não chegam ao produto em nenhum cenário.
- **Contenção:**
  - Se houver suspeita de forja: garantir que `STRIPE_WEBHOOK_SECRET` tem uma versão válida (§6.1), rotacionar o signing secret do endpoint no Stripe (E-06) e comparar as concessões em `users/{uid}` com as sessões pagas no Stripe.
  - Se o webhook parou: corrigir a causa. O Stripe reenvia sozinho as entregas com falha por um período limitado (confirmar o prazo vigente na documentação do Stripe).
- **Recuperação:**
  - Hoje, o reenvio manual pelo painel só é seguro para o `checkout.session.completed` de uma sessão paga cujo efeito ainda não foi aplicado. Reenviar um evento antigo sobrescreve `stripeSubscriptionId` (`functions/src/webhooks/stripe.ts:100-104`).
  - Reconciliação manual: assinaturas ativas no Stripe × `users/{uid}.planId`.
- **TARGET:** `stripe_events/{event.id}` idempotente e ordenado, fila de falhas, runbook de replay ([RUNBOOKS.md](RUNBOOKS.md)) e alerta de falhas consecutivas (E-08). **GAP:** PR-BILL-01, PR-BILL-05, PR-BILL-06 (P2); PR-OBS-01 (P7).

### 6.4 Deploy defeituoso (Hosting, Functions, Rules, índices)

- **Gatilho:** erros logo após um deploy; tela branca; `permission-denied` ou `FAILED_PRECONDITION` em massa; função com erro.
- **SEV inicial:** SEV1 se o produto está fora ou as Rules ficaram permissivas; SEV2 se há degradação.
- **CURRENT:**
  - O deploy é manual, da estação, sem versão, CD nem rollback testado (PR-REL-01).
  - O alvo de deploy é fixo (PR-PLAT-01).
  - `dist/` é compartilhado com o build E2E, e o Hosting não tem predeploy (`package.json:9,27`; `firebase.json:25-30`; PR-AUTH-04).
  - O Emulator não exige índice, então uma consulta sem índice só falha em produção (PR-CC-08, PR-RULES-03).
- **Contenção:**
  1. Congelar novos deploys e identificar o último commit bom.
  2. Hosting: voltar à release anterior pelo histórico do Hosting (console; EXTERNAL, NÃO VERIFICADO).
  3. Rules: republicar o `firestore.rules` do commit bom ou usar o histórico de releases do console (EXTERNAL).
  4. Functions: reimplantar a partir do commit bom.
  5. Índices: criar o índice ausente e aguardar o build.

  Todas são ações em produção, reservadas a humano autorizado.
- **Recuperação:** verificar se a versão defeituosa gravou dados errados, por exemplo escrita indevida com Rules permissivas. Se gravou, seguir o §6.2.
- **TARGET:** CD com tags, STAGING antes de PROD, aprovação e job de rollback (PR-REL-01, PR-PLAT-01; E-01, E-12). Rollback ensaiado no P10.

### 6.5 Comprometimento de conta administrativa

- **(a) Conta humana com acesso ao projeto GCP/Firebase (SEV1).**
  - Remover os papéis IAM e revogar sessões e credenciais no provedor de identidade (E-04).
  - Rotacionar todo segredo acessível (§6.1).
  - Revisar os Cloud Audit Logs de atividade administrativa (retenção: E-08).
  - Conferir deploys, Rules, índices e exclusões feitos no período.
  - Agravantes CURRENT: projeto único (PR-PLAT-01) e funções rodando com a conta padrão de runtime (`functions/src/shared/runtimeOptions.ts:41-91`, sem `serviceAccount`; FIRE-09).
- **(b) Owner ou admin de workspace (SEV2).**
  - Contenção CURRENT: desativar o usuário no console do Auth (EXTERNAL; o token vigente continua válido, AUTH-09). Outro owner remove ou rebaixa a membership pelo cliente, com o risco PR-WS-04.
  - Investigar `activity_logs`, `credit_card_audit_logs`, `goal_audit_logs`, `investment_event_logs` e `financial_events`. As coleções adjacentes não têm trilha e aceitam hard delete (PR-TX-05, PR-RULES-01).
- **(c) Admin de plataforma (`users/{uid}.isAdmin`).**
  - Hoje só libera o painel placeholder no cliente (`src/contexts/AuthContext.tsx:55-61`; `src/components/AdminDashboard.tsx:39,51,63`) e não dá poder algum no backend (`functions/src/index.ts:13-37`).
  - Não é autoconcedível (`firestore.rules:148-157`).
- **TARGET:** suspensão com revogação (P1); custom claim com MFA e callables auditadas (PR-ADMIN-01, D-10, P7); MFA para contas humanas (D-06, E-03, E-04).

### 6.6 Incidente com dados pessoais

Aplica-se a acesso, divulgação, alteração ou perda de dados pessoais: usuários, membros, clientes/devedores, contrapartes, participantes de divisão, comprovantes enviados à IA e histórico guardado no dispositivo. Os dados estão inventariados em [PRIVACY_LGPD.md](PRIVACY_LGPD.md).

1. Abrir a trilha de privacidade junto com o incidente técnico e acionar o encarregado (D-21).
2. Delimitar o escopo:
   - categorias de dados e titulares (estimativa de quantidade);
   - workspaces e período afetados;
   - se há dados de terceiros cadastrados por workspaces PJ. O papel de controlador ou operador ainda não está definido (PRIV-07; E-09).
3. Avaliar se há risco ou dano relevante aos titulares, com critérios aprovados pelo jurídico. Dados financeiros e CPF/CNPJ elevam o risco.
4. Decidir sobre a comunicação à ANPD e aos titulares. Referência **a confirmar pelo jurídico:** LGPD art. 48 e Resolução CD/ANPD nº 15/2024 (prazo de 3 dias úteis a partir do conhecimento, com complementação posterior).
5. Conteúdo mínimo da comunicação (LGPD art. 48 §1º):
   - natureza dos dados;
   - titulares envolvidos;
   - medidas técnicas de segurança;
   - riscos;
   - motivo da demora, se houver;
   - medidas adotadas.
6. Avisar os clientes controladores e os subprocessadores quando o contrato exigir (E-09; [SUBPROCESSORS.md](SUBPROCESSORS.md)).
7. Registrar o incidente mesmo sem comunicação: fatos, efeitos, avaliação e decisão. O prazo de guarda do registro está pendente (**DECISION** D-18). A Resolução 15/2024 prevê no mínimo 5 anos, a confirmar.

- **CURRENT:** nada disso existe hoje. Não há encarregado nem canal (PR-PRIV-01), não há política de privacidade (PR-AUTH-02), dados vão a terceiros sem divulgação (PR-AI-01) e não há e-mail transacional para avisar titulares (§1.1; E-11).

### 6.7 Vazamento cross-tenant ou falha de autorização

- **Gatilho:** usuário vê dado de outro workspace; um teste ou a auditoria do P10 acha um bypass; pico de negações indicando sondagem.
- **SEV inicial:** SEV1 se confirmado.
- **Contexto CURRENT:** a auditoria não encontrou vazamento atual. Os vetores latentes estão em [THREAT_MODEL.md](THREAT_MODEL.md) (T-20, T-21).
- **Contenção:** fechar o caminho (Rules ou callable) com a menor correção possível e um teste que reproduza o problema. Sem correção imediata, desligar a funcionalidade, o que hoje só é possível por deploy (§5). Seguir para o §6.6.
- **Limitação CURRENT:** sem logs estruturados nem correlation ID de servidor (PR-OBS-01), talvez não seja possível delimitar os workspaces afetados. Nesse caso, tratar o escopo como amplo.
- **TARGET:** suíte cross-tenant por coleção; negações de autorização com métrica e alerta ([OBSERVABILITY.md](OBSERVABILITY.md)).

### 6.8 Abuso de custo e indisponibilidade

- **Gatilho:** alerta de orçamento (TARGET, E-08); pico de chamadas de IA; cota de API esgotada; Hosting fora; CDN fora (`index.html:8`, app sem estilo); região indisponível.
- **Contenção CURRENT:**
  - `maxInstances` limita a concorrência (IA: 10, `functions/src/shared/runtimeOptions.ts:72-77`).
  - Rate limit por workspace e ator.
  - Revogar ou limitar a chave de IA (§6.1).
  - Desativar o usuário abusivo no console (EXTERNAL).
- **CDN fora:** não há mitigação antes do P6 (PR-PLAT-03).
- **Indisponibilidade regional:** ver [BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md).
- **TARGET:** quotas por plano (PR-AI-03, PR-ENT-01), App Check (PR-APPCHK-01) e desligamento por funcionalidade (§5).

## 7. Preservação de evidências

### 7.1 Fontes e retenção (CURRENT)

| Fonte | Evidência | Retenção e limitação |
| --- | --- | --- |
| `activity_logs` | `functions/src/triggers/transactions.ts:19,103-116` | TTL de 365 dias quando a política estiver ativa. Qualquer membro lê pelo catch-all e o cliente não grava (`firestore.rules:1436-1442`). Atribui ao criador, não ao ator (ENTRY-17) |
| Trilhas de metas, cartões e investimentos | `goal_audit_logs`, `credit_card_audit_logs`, `financial_events`, `investment_event_logs` (`firestore.rules:1146-1149,1156-1159,1181-1184,1238-1242`); o cliente não grava | Fato financeiro e trilha de domínio não recebem `expiresAt` (`functions/src/shared/retention.ts:11-15`) |
| Coleções operacionais | `expiresAt` definido em `functions/src/shared/retention.ts:23-47`: idempotência 90 d, métricas e eventos operacionais 400 d, rate limits 2 d, checkpoints 30 d, marcas de caixa 90 d | O TTL apaga de forma definitiva quando ativado. A ativação é manual e não está versionada (RULES-13) |
| `transactions` | Baixa lógica (`firestore.rules:1094`) | Preservadas, mas as edições não têm trilha (PR-TX-05) |
| Coleções adjacentes | Hard delete permitido a member (`firestore.rules:1097-1105,1351-1369,1384-1402`) | O próprio ator pode destruir a evidência (PR-RULES-01) |
| Cloud Logging | `console.*` sem estrutura; erros internos não registrados | PR-OBS-01. Retenção e sinks: E-08 |
| Eventos Stripe | Não persistidos | Só no Stripe (PR-BILL-06, E-06) |
| Backups | Inexistentes | Não há cópia point-in-time (PR-BKP-01) |
| Dispositivo do usuário | Histórico de IA em `localStorage` (`src/modules/reports/hooks.ts:343`) | Fora do alcance do operador |

### 7.2 Procedimento (TARGET)

1. Não alterar o ambiente afetado além do necessário para conter. Registrar cada ação: quem, quando, o quê.
2. Antes de rebuild, restore ou correção de dados, fazer export gerenciado do Firestore (coleções ou workspaces afetados) para um bucket isolado com retenção bloqueada (E-07). Com PITR, anotar o timestamp de referência.
3. Exportar os logs relevantes (Cloud Logging e Cloud Audit Logs) para um sink com retenção (E-08).
4. Se a evidência estiver numa coleção com TTL ativo, exportá-la imediatamente. Avaliar suspender a política de TTL do grupo de coleção durante a investigação (configuração de console, EXTERNAL).
5. Calcular o hash SHA-256 de cada artefato e manter a cadeia de custódia. Acesso restrito a IC, responsável técnico e privacidade.
6. Nunca copiar dados pessoais ou segredos para tickets, chat ou prompts de agentes. Analisar em ambiente não produtivo, com dados minimizados (`CLAUDE.md:16,19`).
7. Guardar a evidência pelo prazo do registro de incidentes (§6.6; D-18).

## 8. Comunicação

- **CURRENT:** não existe canal com usuários fora da UI. Não há e-mail transacional (§1.1), página de status nem contato publicado (PR-PRIV-01, D-21, E-11).
- **TARGET, interna:** um canal por incidente, com atualização a cada 30 min em SEV1 e a cada 2 h em SEV2 (**DECISION** D-32, proposta).
- **TARGET, clientes afetados:** avisar os owners dos workspaces afetados por e-mail transacional (E-11) e por aviso no app. Textos em pt-BR, factuais e sem especulação, a partir de modelos aprovados pelo jurídico (E-09). Estrutura mínima: o que aconteceu; quando; quais dados ou funções foram afetados; o que já foi feito; o que o cliente deve fazer; canal de contato.
- **TARGET, página de status:** **DECISION** D-32.
- **TARGET, fornecedores:** Google Cloud, Stripe e provedor de IA, conforme o caso (§3).
- **TARGET, ANPD e titulares:** §6.6.
- Nenhuma afirmação pública antes da validação dos fatos. Os textos públicos seguem a skill `saas-commercial-readiness`.

## 9. Pós-incidente

- Postmortem sem culpados em até 5 dias úteis para SEV1 e SEV2 (**DECISION**, proposta).
- Conteúdo:
  - linha do tempo;
  - impacto (workspaces, usuários, valores);
  - causa raiz;
  - o que funcionou e o que falhou na detecção e na contenção;
  - ações com dono e prazo.
- Cada ação vira item no registro do plano (§6) ou no documento de domínio, com teste de regressão obrigatório. Atualizar também [THREAT_MODEL.md](THREAT_MODEL.md), [RUNBOOKS.md](RUNBOOKS.md) e este documento.
- Encerramento: `observability-incident-readiness` em `PASS` e, se houve dado pessoal, `privacy-lgpd-data-lifecycle` em `PASS`.

## 10. Exercícios

Nenhum exercício foi feito (**CURRENT**). **TARGET:** tabletop dos playbooks e drills técnicos em STAGING no P7, o que depende do projeto de STAGING criado no P6 (E-01, PR-PLAT-01). Drill completo no P10 ([plano §8](PRODUCTION_READINESS_PLAN.md#8-milestones)). Cada exercício registra: data, cenário, participantes, tempo até detecção e até contenção, resultado e ações.

| Exercício | Ambiente | Milestone | Estado |
| --- | --- | --- | --- |
| Rotação de segredo (Gemini, Stripe) sem indisponibilidade | STAGING | P7 | NÃO EXECUTADO |
| Replay idempotente de webhook | STAGING (Stripe em modo teste) | P7 | NÃO EXECUTADO |
| Restore do Firestore com reconciliação ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)) | STAGING | P7 | NÃO EXECUTADO |
| Rollback de Hosting, Rules e Functions pelo CD | STAGING | P7, P10 | NÃO EXECUTADO |
| Suspensão de usuário com revogação de sessão | STAGING | P7 | NÃO EXECUTADO |
| Tabletop de incidente com dados pessoais e decisão sobre a ANPD | — | P7 | NÃO EXECUTADO |
| Drill completo de incidente | STAGING | P10 | NÃO EXECUTADO |

## 11. Lacunas, decisões e configuração externa

### 11.1 GAP

| Lacuna | ID | Milestone |
| --- | --- | --- |
| Processo, severidades, papéis, contatos e drills | PR-OBS-02 | P7 |
| Observabilidade, alertas e correlação | PR-OBS-01 | P7 |
| Backup, PITR e restore | PR-BKP-01 | P7 |
| Capacidades administrativas auditadas | PR-ADMIN-01 | P7 |
| Interruptor por funcionalidade e modo somente leitura | PR-OBS-02 | P7 |
| Suspensão com revogação de sessão | AUTH-09 | P1 |
| Registro e replay de webhook; segredo sem fallback | PR-BILL-06, PR-BILL-05 | P2 |
| Detecção e reparo de deriva de caixa | PR-TX-04 | P3 |
| Ambientes para reproduzir e ensaiar | PR-PLAT-01 | P6 |
| Releases versionadas e rollback | PR-REL-01 | P6 |
| Canal do titular e encarregado | PR-PRIV-01 | P8 |
| Rotação da chave Gemini | PR-AI-02 | P0 |

### 11.2 DECISION

- **D-21:** identidade jurídica do fornecedor, encarregado e canal de suporte (P7, P9).
- **D-10:** painel administrativo.
- **D-06 (tomada, §9.1 do plano):** sem MFA para usuários comuns; MFA de administradores de plataforma em P7 (E-03); `auth_time` recente em transferência de ownership e arquivamento de workspace.
- **D-18:** retenção de logs, auditoria, registro de incidentes e backups.
- **D-19:** mapeamento de ambientes, que define onde os drills rodam.
- **D-32:** tempos de acionamento e contenção por SEV, página de status e procedimento de *break-glass* em PROD.
- **D-28:** stack de observabilidade, escala de plantão e canal interno, SLOs e limiares dos alertas.
- **D-27:** RPO/RTO e política de backup ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)).
- **D-25:** telemetria de erros do frontend (afeta [SUBPROCESSORS.md](SUBPROCESSORS.md)).

### 11.3 EXTERNAL CONFIGURATION REQUIRED

| Item | ID | Estado | Data | Responsável |
| --- | --- | --- | --- | --- |
| Rotação da chave Gemini e revogação das anteriores, com evidência | E-00 | NÃO VERIFICADO | — | — |
| Projetos DEV/STAGING/PROD e plano de suporte do Google Cloud | E-01 | NÃO VERIFICADO | — | — |
| App Check: chave reCAPTCHA Enterprise por ambiente, enforcement e monitoramento de rejeições | E-02 | NÃO VERIFICADO | — | — |
| Auth: desativação de usuário, MFA para admins, proteção contra enumeração | E-03 | NÃO VERIFICADO | — | — |
| IAM: MFA humano, sem chaves baixadas, contas de emergência, Cloud Audit Logs | E-04 | NÃO VERIFICADO | — | — |
| Secret Manager por ambiente e política de rotação | E-05 | NÃO VERIFICADO | — | — |
| Stripe: endpoint por ambiente, alertas de falha de entrega, contato de suporte | E-06 | NÃO VERIFICADO | — | — |
| PITR, backups agendados, delete protection e políticas de TTL | E-07 | NÃO VERIFICADO | — | — |
| Políticas de alerta, canais, retenção de logs, sinks, Error Reporting e orçamento | E-08 | NÃO VERIFICADO | — | — |
| Jurídico: procedimento e modelos de comunicação à ANPD e aos titulares, cláusulas de notificação nos DPAs, encarregado | E-09 | NÃO VERIFICADO | — | — |
| Provedor de IA: termos e canal de reporte de abuso ou de chave | E-10 | NÃO VERIFICADO | — | — |
| E-mail transacional com SPF/DKIM/DMARC para avisar usuários | E-11 | NÃO VERIFICADO | — | — |
| GitHub environments com aprovação para correção e rollback | E-12 | NÃO VERIFICADO | — | — |
