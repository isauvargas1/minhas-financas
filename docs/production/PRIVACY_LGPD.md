# Privacidade e LGPD

Documento de referência de privacidade e proteção de dados pessoais do programa de Production Readiness. Reúne o inventário de dados pessoais extraído do código, transparência e aceite, direitos do titular, eliminação e anonimização, dados de terceiros, IA, armazenamento local, canal do titular e o registro de validação jurídica. Baseline: HEAD `9c3ab46`. IDs, milestones, decisões e configuração externa seguem o [plano mestre](PRODUCTION_READINESS_PLAN.md). O gate do tema é a skill `privacy-lgpd-data-lifecycle`, que dá `FAIL` a qualquer item jurídico sem validação registrada na §15.

> **Este documento não é parecer jurídico.** Ele registra o que o código faz e o que precisa existir. As menções à LGPD (Lei 13.709/2018), ao Marco Civil da Internet (Lei 12.965/2014), ao CDC e a regulamentos da ANPD servem só de referência e precisam ser confirmadas pelo jurídico (E-09). Nada aqui constitui base legal, prazo ou texto validado.

Os rótulos **CURRENT**, **TARGET**, **GAP**, **DECISION** e **EXTERNAL CONFIGURATION REQUIRED** seguem a [classificação do plano mestre](PRODUCTION_READINESS_PLAN.md#classificação-usada-em-docsproduction). Detalhes relacionados estão em [SUBPROCESSORS.md](SUBPROCESSORS.md) (terceiros e transferência internacional), [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md) (prazos e mecanismos de retenção) e [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) (incidentes).

---

## 1. Estado resumido

| Tema | Classificação | Estado no HEAD | Referência |
| --- | --- | --- | --- |
| Política de Privacidade, Termos e aceite | CURRENT → GAP | Não existem. O login Google cria a conta sem aviso e sem registro de aceite. | PR-AUTH-02 (P9) |
| Exportação e exclusão de conta/workspace | CURRENT → GAP | Não existem. As Rules negam delete de `users` e não definem delete de `workspaces`. | PR-AUTH-01 (P8) |
| Canal do titular, controlador e encarregado | CURRENT → GAP | Nenhum contato, identificação ou formulário. | PR-PRIV-01 (P8), D-21 |
| Dados de terceiros (clientes, contrapartes, participantes, convidados) | CURRENT → GAP | Clientes (P3-I, D-24): cadastro compartilhado mínimo e PII em `client_private`, só owner/admin. Contrapartes, participantes e convidados seguem coletados sem minimização. Ciclo de vida (exportação, eliminação, anonimização, retenção) inexistente. | PR-CR-05 (P8) |
| IA (Gemini) | CURRENT (P5-E1) → GAP | Antes de cada envio, o usuário confirma a operação em diálogo próprio (versão `ai-provider-share-v1`). Enviados: pergunta e contexto mínimo montado pelo servidor no consultor; transcrição de voz ou comprovante integral na extração, só após confirmação. Contrato, tier e base legal não comprovados. | PR-AI-01 (P8), D-11 |
| Armazenamento local | CURRENT (IA) · GAP (Mensagens) | Histórico do chat de IA no `localStorage` por usuário e workspace, apagado no logout (D-41, P5-A, §8). As mensagens simuladas seguem no `localStorage` sem `uid` na chave. | PR-AI-04 resolvido na P5-A; PR-MSG-01 (P5) |
| Terceiros carregados no navegador | CURRENT → GAP | Google Fonts e sons de `assets.mixkit.co`, sem divulgação. Tailwind Play CDN e importmap `esm.sh` removidos em P2C-H2 (CSS compilado no build). | PR-PLAT-03 (P6) |
| Retenção de dados pessoais | CURRENT → GAP | Notificações têm prazo de 180 dias desde a D-18-NOTIF (TTL declarado, não publicado). Os demais dados pessoais não têm política; TTL técnico só em coleções operacionais. | PRIV-08, D-18 |
| Controles positivos já existentes | CURRENT | Sem analytics ou trackers; `users/{uid}` legível só pelo próprio usuário; campos de plano/admin server-owned; logs de IA sem conteúdo; Firestore e Functions em `southamerica-east1`; chave de IA só no backend. | §3, §13 |

---

## 2. Papéis e premissas

| Item | Classificação | Conteúdo |
| --- | --- | --- |
| Identificação do controlador | CURRENT | Razão social, CNPJ, endereço e contato não aparecem em lugar nenhum (`src/components/auth/LoginView.tsx:50-52` mostra só "Ambiente seguro © 2024"). |
| Identidade jurídica do fornecedor | DECISION | D-21 (razão social, CNPJ, endereço, encarregado, canal). |
| Papel do SaaS por categoria de dado | EXTERNAL CONFIGURATION REQUIRED | E-09, NÃO VALIDADO. Hipótese de trabalho da auditoria (PRIV-07): o SaaS é controlador dos dados de conta, cobrança e uso, e operador dos dados de terceiros que o cliente cadastra (clientes, contrapartes, participantes). Nesse caso os Termos precisam de cláusula de operador. |
| Dados reais | CURRENT | Não existem dados reais de produção (`CLAUDE.md`, seção "Legado e substituição de arquitetura"). Hoje só há dados de teste. |
| Ambiente de desenvolvimento | CURRENT → GAP | O único projeto (`.firebaserc:3`) também é usado como desenvolvimento (PR-PLAT-01). Depois do lançamento, isso faria o desenvolvimento local tratar dados pessoais reais. A separação (E-01, P6) é pré-requisito de privacidade. |

---

## 3. Inventário de dados pessoais (CURRENT)

Inventário extraído do código no HEAD `9c3ab46`. Todas as linhas são **CURRENT** e trazem evidência. A coluna "Base legal" é **DECISION/EXTERNAL CONFIGURATION REQUIRED (E-09)**, NÃO VALIDADO, em todas as linhas. As finalidades opcionais (IA e voz) dependem também de D-11. O alvo de retenção por categoria é D-18 (ver [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md)). Pela regra da skill, este inventário precisa ser atualizado na mesma mudança que criar ou alterar um campo pessoal.

| # | Dado | Titular | Armazenamento | Origem (evidência) | Finalidade | Base legal | Compartilhamento | Retenção CURRENT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Identidade de login: `uid`, nome, e-mail, foto e provedor da conta Google | Usuário | Firebase Auth | `src/contexts/AuthContext.tsx:83-86` (`signInWithPopup`) | Autenticação e sessão | E-09 | Google (provedor de identidade e Firebase Auth) | Indefinida, sem exclusão (PR-AUTH-01) |
| 2 | Estado de assinatura: `planId`, `entitlementStatus`, `subscriptionStatus`, `graceUntil`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `cancelAt`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `lastStripeEventId`, `lastStripeEventType`, `stripeSyncedAt` | Usuário | `billing_accounts/{uid}` (titular), com vínculo reverso em `billing_customers/{stripeCustomerId}` | `functions/src/billing/model.ts:21-30,102-121` | Entitlement do plano | E-09 | Stripe (IDs de referência) | Indefinida; delete negado (`firestore.rules:1427-1429,1443-1445`) |
| 3 | Campos de perfil (`displayName`, `photoURL`, `phoneNumber`, `email`, `locale`, `timezone`, `activeWorkspaceId`) | Usuário | `users/{uid}` | O perfil é gravado só pelo backend; as Rules negam toda escrita do cliente em `users/{uid}` (`firestore.rules:1384-1388`). O código do cliente só lê (`src/contexts/AuthContext.tsx:75-76`). | Nenhuma implementada (AUTH-12) | E-09 | — | Indefinida |
| 4 | Membership: `uid`, `email`, `role`, `displayName` (placeholder `"Owner"`), `joinedAt` | Usuário e membros | `workspaces/{id}/members/{uid}` | `src/modules/workspaces/api.ts:199-206` | Controle de acesso | E-09 | Todo membro ativo lê (`firestore.rules:1010-1014`) | Hard delete na remoção (`src/modules/workspaces/api.ts:249-252`) |
| 5 | E-mail da pessoa "convidada" e `displayName` derivado dele, gravados sem aviso nem aceite | Terceiro convidado | `workspaces/{id}/members/{fakeUid}` | `src/components/MembersManagerModal.tsx:53-66` | Convite (não funciona: PR-WS-01) | E-09 | Membros do workspace | Indefinida |
| 6 | Workspace: nome, `cnpj`, `logoUrl`, `ownerId` | Usuário; empresa (o CNPJ de empresário individual pode identificar pessoa natural; item E-09) | `workspaces/{id}` | `src/components/CreateWorkspaceModal.tsx:33`; `src/components/SettingsView.tsx:455`; `firestore.rules:101-105` | Identificação do workspace PF/PJ | E-09 | Membros | Indefinida; sem delete (`firestore.rules:990-1009`) |
| 7 | Clientes. Cadastro compartilhado (`clients`): só `name`, `status` e metadados do sistema, sem PII. Dados pessoais em `client_private`: documento, e-mail, telefone, endereço e observações (D-24) | Terceiros (clientes/devedores) | `workspaces/{id}/clients` (mínimo) e `workspaces/{id}/client_private` (PII) | `functions/src/receivables/clientOperations.ts`; `firestore.rules` (blocos `clients` e `client_private`); `src/components/ClientFormModal.tsx` | Controle de recebíveis | E-09 (papel de operador, PRIV-07) | Cadastro mínimo: qualquer membro ativo, inclusive viewer (nome e situação); PII: só owner/admin (`get` e `list` com `limit <= 100`); a interface nem consulta `client_private` para member e viewer | Cliente arquivado, nunca apagado (`archiveClient`); sem PII em recebíveis, movimentos, eventos, espelhos de caixa, logs nem respostas das callables; exportação, eliminação, anonimização e retenção em P8 (PR-CR-05, D-07, D-18) |
| 8 | Recebíveis ligados ao cliente (valores em centavos, vencimento, status, descrição e categoria), movimentos de recebimento e estorno, e eventos de auditoria: só IDs, centavos, status e nomes de campos, sem PII do cadastro. Texto livre digitado pelo usuário — descrição, categoria, motivo de cancelamento e de estorno — pode conter dado pessoal e é visível aos membros (o motivo também vai ao evento, só owner/admin); o backend não copia para ele nenhum dado de `client_private` | Terceiros (indireto, por `clientId`) | `workspaces/{id}/receivables`, `receivable_movements`, `receivable_events`, `client_events`; espelho em `transactions` com descrição genérica ("Recebimento de recebível") | `functions/src/receivables/model.ts`; `functions/src/receivables/cashEffect.ts`; `firestore.rules` | Contas a receber | E-09 | Membros leem recebíveis e movimentos; eventos só owner/admin | Sem exclusão física (cancelamento lógico e estorno compensatório); ciclo de vida em P8 (PR-CR-05) |
| 9 | Contrapartes de empréstimo: `personName`, `personContact`, `cnpjCpf` (só PJ, com dígitos verificadores) | Terceiros (credor/devedor) | `workspaces/{id}/loans` (só o schema autoritativo, gravado pelo backend; P3-G/P3-H) | `src/modules/loans/types.ts`; `src/components/PJLoanFormModal.tsx`; `functions/src/loans/contracts.ts`; `functions/src/loans/operations.ts` | Controle de empréstimos | E-09 | Membros | Só no contrato; nunca copiado para espelho de caixa, `loan_events` ou logs (o frontend registra no console só o ID de documento fora do formato); correção por `updateLoanMetadata` com auditoria só dos nomes dos campos; sem hard delete; eliminação/anonimização em P8 (PR-CR-05) |
| 10 | ~~Nome da contraparte copiado para a descrição do lançamento de caixa~~ — eliminado na P3-H: a interface não cria mais lançamento de empréstimo; o espelho do backend usa descrição genérica ("Empréstimo recebido", "Pagamento de empréstimo"…) e o vínculo por ID, e o gatilho só replica essa descrição genérica para `activity_logs` | — | `transactions.description`; `activity_logs.description` | `functions/src/loans/model.ts` (`mirrorDescription`); `functions/src/triggers/transactions.ts` | Descrição do lançamento | E-09 | Membros | Sem cópia de dado de terceiro; `activity_logs` 365 dias |
| 11 | Participantes de divisão: `nomeExibicao` (nome Google do criador; `"Você"` fixo para convidados) e `userId`; o convite aceito grava `aceitoPor` | Usuário e membros | `split_participants`, `split_invites` | `src/modules/split-bills/api.ts:140,164`; `src/components/JoinGroupModal.tsx:31`; `functions/src/callables/splitGroups.ts:250-262` | Divisão de contas | E-09 | Qualquer membro do workspace (SPLIT-06, SPLIT-14) | Hard delete (PR-SPLIT-02); convites sem TTL (SPLIT-16) |
| 12 | Dados financeiros: valor, data, categoria, descrição, fornecedor, centro de custo e autor (`userId`) | Usuário (no PF, revelam comportamento financeiro pessoal); terceiros citados | `workspaces/{id}/transactions` e demais coleções financeiras | Allowlist `firestore.rules:67-75` | Gestão financeira | E-09 | Membros; parte agregada vai ao Gemini (linha 14) | Não expira, por desenho (`functions/src/shared/retention.ts:11-15`) |
| 13 | Textos livres (descrição, fornecedor, observações de cliente, descrição de empréstimo). Podem conter dados de terceiros e, por inferência, dados sensíveis (ex.: saúde). | Usuário e terceiros | Campos das linhas 7, 9 e 12 | Só há limite de tamanho, nenhum de conteúdo | — | E-09 | Membros | Igual ao documento de origem |
| 14 | IA, consultor: pergunta livre (3 a 2.000 caracteres), enviada inteira — pode conter dados pessoais que o próprio usuário escreva, o que o diálogo de confirmação informa (P5-E1.1) — e contexto mínimo montado pelo servidor a partir do relatório oficial: valores agregados em BRL, cobertura por bloco e até 5 grupos de despesas identificados só pela posição ("Grupo de despesas N"), sem nome, ID ou chave de categoria (P5-E1.1, aguardando auditoria independente). Sem IDs, nomes de cartão, descrições de compra, contrapartes, nomes de clientes, e-mails ou séries. | Usuário | Não persistido no servidor (o histórico do chat fica só no navegador, por usuário e workspace — D-41) | `functions/src/ai/callables.ts`; `functions/src/ai/analysisContext.ts`; `functions/src/ai/prompts.ts` | Resposta de consultoria | D-11 / E-09 | Google Gemini API (`functions/src/ai/gateway.ts`) | No provedor: E-10, NÃO VERIFICADO |
| 15 | IA, extração: transcrição de voz (3 a 4.000 caracteres) ou imagem ou PDF integral do comprovante (PNG, JPEG, WEBP ou PDF; até 6 MiB em base64), somente após confirmação da operação | Usuário e terceiros que aparecem no comprovante | Não persistido pelo FênixGran; a extração não grava nada | `functions/src/ai/callables.ts`; `functions/src/ai/extraction.ts`; `functions/src/ai/consent.ts`; `src/components/TransactionModal.tsx` | Pré-preenchimento do lançamento | D-11 / E-09 | Gemini (`functions/src/ai/gateway.ts`) | No provedor: E-10, NÃO VERIFICADO |
| 16 | Áudio da voz | Usuário | Não armazenado pelo app | Web Speech API do navegador (`src/components/TransactionModal.tsx`, `lang = 'pt-BR'`) | Transcrição. O usuário é informado antes de gravar, porque o reconhecimento do navegador pode enviar o áudio ao fornecedor do navegador. | D-11 / E-09 | Fornecedor do navegador ([SUBPROCESSORS.md](SUBPROCESSORS.md)) | NÃO VERIFICADO |
| 17 | Cobrança: e-mail do token (só se verificado), `billingOwnerUid` em `metadata`, `priceId`; os dados de cartão são coletados pela página hospedada do Stripe | Usuário | Stripe; IDs em `billing_accounts/{uid}` (linha 2) | `functions/src/billing/checkout.ts:278-283`; `functions/src/billing/stripeGateway.ts:239-246,275-300`; `src/modules/billing/hooks.ts:34-37` | Assinatura | E-09 | Stripe | No Stripe: E-06/E-09, NÃO VERIFICADO |
| 18 | Logs de aplicação: `actorId` (uid) nas falhas de IA; `stripeEventId` e `stripeEventType` no webhook, com pilha sanitizada e sem `error.message`. Prompt e resposta não entram no log. | Usuário | Cloud Logging | `functions/src/ai/callables.ts:50-58`; `functions/src/billing/webhook.ts:862-865`; `functions/src/shared/logger.ts:68-77,131-132` | Operação e diagnóstico | E-09 | Google Cloud | E-08, NÃO VERIFICADO |
| 19 | Trilhas com ator: `activity_logs.userId`, `goal_audit_logs.actorId`/`actorRole`, `credit_card_events` (trilha de cartões, P4-A), eventos de observabilidade com `actorId` | Usuário e membros | Subcoleções do workspace | `functions/src/triggers/transactions.ts:103-110`; `functions/src/goals/operations.ts:147-168`; `functions/src/cards/*.ts` | Auditoria e investigação | E-09 | `activity_logs` é legível por qualquer membro pelo catch-all (`firestore.rules:1436-1442`) | `activity_logs` 365 dias; trilhas de domínio não expiram |
| 20 | Contadores de rate limit indexados por `uid` | Usuário | `workspaces/{id}/rate_limits`, `users/{uid}/rate_limits` | `functions/src/shared/rateLimit.ts:49-66,89`; `firestore.rules:1472-1474` (server-only) | Limite de uso | E-09 | — | `expiresAt` de 2 dias (`functions/src/shared/retention.ts:23-61`), TTL manual (FIRE-08) |
| 21 | Armazenamento local e requisições a terceiros no navegador | Usuário | Navegador | §9 | §9 | E-09 | §9 e [SUBPROCESSORS.md](SUBPROCESSORS.md) | §9 |
| 22 | Estado de notificação por usuário: `read`/`readAt`, `dismissed`/`dismissedAt` (arquivar para si) e `deleted`/`deletedAt` (excluir para si), com `expiresAt` igual ao do evento (o que cada pessoa leu, arquivou ou excluiu, e quando) | Usuário | `workspaces/{id}/notification_user_states/{uid}/notification_entries/{notificationId}` (P5-D1; D-18-NOTIF) | `src/modules/notifications/api.ts` (transação do próprio usuário); `firestore.rules` (bloco `notification_user_states`) | Mostrar não lidas e arquivar ou excluir só para si | E-09 | Ninguém além do próprio usuário: outros membros, inclusive owner/admin, não leem (Rules testadas no Emulator) | 180 dias desde a criação do evento (D-18-NOTIF), com TTL declarado e não publicado (E-07); a exclusão de conta não o remove (PR-AUTH-01, P8) |
| 23 | Evento de notificação do workspace: título e mensagem fixos em pt-BR, tipo, link interno, datas, coleção de origem e identificadores da entidade (IDs de empréstimo, recebível, conta, meta, recorrente, ocorrência ou fatura). Não há nome de pessoa ou cliente, documento, telefone, e-mail, descrição livre nem valor | Membros ativos do workspace (todos os papéis) | `workspaces/{id}/notifications/{notificationId}` (D-18-NOTIF; produtores da P5-D2) | `functions/src/notifications/builder.ts`; `functions/src/notifications/producers/*.ts`; `functions/src/cards/closing.ts` (cartões); `firestore.rules` (leitura por membro) | Avisar o usuário de um fato do próprio workspace | E-09 | Nenhum envio externo: e-mail, SMS, push e WhatsApp não existem. Dentro do workspace, todo membro ativo lê o evento; o produtor de recebíveis nunca lê `client_private` | 180 dias desde a criação, sem renovação (D-18-NOTIF); TTL declarado e não publicado (E-07) |
| 24 | Controle dos avisos de recebível vencido (P5-D2.1): trabalho pendente (IDs do workspace e do recebível, vencimento enfileirado, próximo dia de tentativa, tentativas, código do último erro, carimbos) e confirmação por episódio (IDs, vencimento, origem, `runId`, data da entrega). Não é dado pessoal: nenhum nome, documento, contato, descrição ou valor | Nenhum titular direto (estado operacional do workspace) | `workspaces/{id}/receivable_overdue_queue/{receivableId}`, `workspaces/{id}/receivable_overdue_deliveries/{notificationId}` | `functions/src/notifications/producers/receivableQueue.ts`; `functions/src/notifications/producers/receivables.ts`; `firestore.rules` (negado a todo cliente) | Garantir um único aviso por episódio, sem perda por falha transitória | Não se aplica (sem dado pessoal) | Nenhum: nem membros leem | Fila: só enquanto há trabalho. Confirmação: sem TTL, vinculada ao recebível (nunca apagado) e eliminada com o workspace (P8, PR-PRIV-01) |

**GAP do inventário.** Não há registro das operações de tratamento validado, nem finalidade e base legal por linha. A linha 3 lista campos que as Rules aceitam mas nenhuma funcionalidade usa, o que viola a minimização (AUTH-12). As linhas 5, 10 e 13 levam dados de terceiros a lugares que o titular não conhece. A remediação fica em P8 (PR-PRIV-01, PR-CR-05), sobre o modelo de dados final de P1–P5.

---

## 4. Transparência, aviso e aceite

| Item | Classificação | Conteúdo |
| --- | --- | --- |
| Cadastro | CURRENT | A conta nasce no primeiro login Google, sem aviso e sem aceite (`src/contexts/AuthContext.tsx:83-86`; `src/components/auth/LoginView.tsx:15-53`). O visitante sem sessão só vê o `LoginView` (`src/App.tsx:689`). |
| Textos legais | CURRENT | Não existem. Busca por "Termos", "Privacidade" e "LGPD" em `src`: zero ocorrências (auditoria AUTH-02). |
| Campo de aceite | CURRENT | Nenhum. `ownProfileEditableKeys` não tem campo de aceite (`firestore.rules:151-157`), e nenhum backend grava aceite. |
| Aviso na IA | CURRENT (P5-E1) | Antes de cada envio, diálogo de confirmação por operação (`src/components/AiShareConsentDialog.tsx`): análise, documento, voz antes de gravar e texto reconhecido antes de enviar. O aviso "A IA pode cometer erros" (`src/components/ReportsAIChat.tsx`) continua. A confirmação não é consentimento LGPD. |
| Páginas legais públicas | TARGET | `/privacidade`, `/termos` e `/cookies` servidas pelo Hosting, com link no `LoginView` e no rodapé institucional (P9; PR-AUTH-02, PR-COMM-01). O conteúdo precisa descrever o que o código faz, inclusive a lista de [SUBPROCESSORS.md](SUBPROCESSORS.md). |
| Registro de aceite | TARGET | Callable `acceptLegalTerms` (PRIV-01) grava registro append-only (uid, documento, versão, timestamp de servidor) em coleção server-only e espelha a versão vigente em `users/{uid}.legal { termsVersion, privacyVersion, acceptedAt }`, fora de `ownProfileEditableKeys`. As Rules negam escrita do cliente. Mudança material de versão exige novo aceite, e o app fica bloqueado até ele. Os nomes finais são definidos no milestone. |
| Sequência entre milestones | TARGET | P1 cria `bootstrapAccount` com ponto de extensão para o aceite (PR-AUTH-03); P8 implementa o registro de aceite e de consentimentos; P9 torna o aceite obrigatório no cadastro (PR-AUTH-02). |
| Consentimentos opcionais | TARGET | Se D-11 escolher consentimento como base da IA/voz, o registro é separado por finalidade, granular, revogável com a mesma facilidade e tem efeito técnico verificável (a callable de IA recusa sem consentimento vigente). Hoje a P5-E1 implementa só a confirmação técnica por operação (§8), que não é consentimento. |
| Textos e bases legais | EXTERNAL CONFIGURATION REQUIRED | E-09: Política, Termos, aviso de cookies/armazenamento e idade mínima. NÃO VALIDADO. |
| Tela de consentimento OAuth | EXTERNAL CONFIGURATION REQUIRED | E-03: exige URL da política, URL dos termos e domínio verificado. NÃO VERIFICADO. |
| Lacuna | GAP | PR-AUTH-02 (P9), com origem em AUTH-02 e PRIV-01. |

---

## 5. Direitos do titular

Nenhum direito tem fluxo implementado no HEAD. Todos fecham em P8 (D-ORD-03), exceto quando outra linha indica.

| Direito (referência a confirmar) | CURRENT (evidência) | TARGET | Milestone | GAP |
| --- | --- | --- | --- | --- |
| Confirmação e acesso | Nada. `functions/src/index.ts:13-37` não exporta callable de conta. | `exportAccountData` (dados próprios) e export por workspace para owner/admin: paginado, com rate limit e auditoria, gerando JSON/CSV com URL assinada de expiração curta (AUTH-01, PRIV-03) | P8 | PR-AUTH-01 |
| Correção | O perfil é editável pelas Rules (`firestore.rules:151-157`), mas não há tela de conta (`src/components/SettingsView.tsx:630-721`). Dados de terceiros (clientes) são editados só por owner/admin, pela callable `updateClient` (D-24, P3-I); o fluxo do titular segue em P8. | Correção pelo canal do titular (§11) e pelas callables dos domínios. Os dados de identidade vêm do token verificado (AUTH-12). | P1 (perfil), P8 (fluxo) | PR-PRIV-01 |
| Anonimização, bloqueio ou eliminação de dados desnecessários | Nada. A única "eliminação" disponível é o hard delete pelo cliente em divisão (PR-SPLIT-02); empréstimos (P3-H) e clientes e recebíveis (P3-I, PR-CR-02) não são apagados pelo cliente, e a anonimização do cliente segue em P8. | `anonymizeClient` e equivalentes por domínio (§6, §7) | P8 | PR-CR-05 |
| Portabilidade | Nada. Busca por `text/csv`, `Blob(` e "Exportar" em `src`: zero (PRIV-03). | Export estruturado (linha "Confirmação e acesso") | P8 | PR-AUTH-01 |
| Eliminação | Nada. `firestore.rules:1467` (delete de `users` negado); `firestore.rules:990-1009` (sem delete de `workspaces`). | `requestAccountDeletion` (§6.3) | P8 | PR-AUTH-01, D-07 |
| Informação sobre compartilhamento | Nada. Não há lista pública de terceiros. | Política com a lista de [SUBPROCESSORS.md](SUBPROCESSORS.md) | P8/P9 | PR-PRIV-01 |
| Informação sobre não consentir e revogação | Não existe consentimento registrado. | Registro de consentimento revogável (§4), se D-11 decidir por consentimento | P8 | PR-AI-01 |
| Revisão de decisão automatizada | A IA só pré-preenche o formulário, apenas com campos identificados, e a extração não grava nada. O usuário revisa antes de salvar (`src/components/TransactionModal.tsx`; `functions/src/ai/extraction.ts`). Não há decisão automatizada que produza efeito sozinha. | Confirmar com o jurídico a não aplicabilidade | P8 | E-09 (NÃO VALIDADO) |
| Petição e canal | Nada (`src/components/auth/LoginView.tsx:50-52`; PRIV-04). | Canal publicado e registro `dsr_requests` (§11) | P8; ferramenta administrativa em P7 | PR-PRIV-01, PR-ADMIN-01 |

**TARGET transversal.** Toda solicitação passa por verificação de identidade (sessão com `auth_time` recente) e é registrada em `dsr_requests`, com tipo, data, prazo, responsável e resposta. O prazo segue o art. 19 da LGPD, com números a confirmar (E-09). O atendimento usa callables administrativas auditadas com custom claim (PR-ADMIN-01, D-10). Não há edição manual no console.

---

## 6. Exclusão de conta, eliminação e anonimização

### 6.1 CURRENT

- Não há callable, trigger de Auth nem UI de exclusão (`functions/src/index.ts:13-37`; `src/components/Header.tsx:316-317`, onde "Minha Conta" não oferece nenhuma ação).
- Apagar o usuário pelo console deixa órfãos `users/{uid}` e `billing_accounts/{uid}` (com `stripeSubscriptionId` ativo, e o Stripe continua cobrando), os workspaces com `ownerId` inexistente e as memberships (AUTH-01).
- Coleções adjacentes sofrem hard delete pelo cliente, o que ao mesmo tempo destrói histórico financeiro e não elimina de forma controlada (PR-SPLIT-02; PR-CC-01 resolvido na P4-A, plano §19.1). Empréstimos saíram dessa lista na P3-H e clientes e recebíveis na P3-I (PR-CR-02).
- **Fato verificado (P3-H):** o nome da contraparte de empréstimo não é mais copiado para `transactions.description` nem, pelo gatilho, para `activity_logs.description` — a interface não grava lançamento de empréstimo e o espelho do backend é genérico (linha 10 do inventário). A anonimização da contraparte (P8) trata só o contrato.

### 6.2 Conflito com "nenhum hard delete de histórico financeiro"

**DECISION D-07** ([§10 do plano](PRODUCTION_READINESS_PLAN.md#10-decisões-pendentes-decision)). Abordagem recomendada para decisão, sujeita a validação jurídica (E-09):

1. **Workspace cujo único titular pede a eliminação:** elimina-se o workspace inteiro, depois de oferecer a exportação, preservando só o que tiver obrigação legal de retenção (fiscal, cobrança).
2. **Workspace compartilhado:** remove-se a membership. O ator é anonimizado nas trilhas que precisam permanecer (`activity_logs.userId`, `*_audit_logs.actorId`, `members.email`/`displayName`) por um pseudônimo estável e não reversível. Os fatos financeiros ficam intactos.
3. **Dados de terceiros:** os campos pessoais (clientes, contrapartes, participantes, convidados) são anonimizados por marcador, preservando valores e vínculos, inclusive nas cópias em texto livre (§6.1).
4. **Retenção por obrigação legal:** o dado fica bloqueado para outros usos, tem prazo (D-18) e é eliminado ao fim do prazo por mecanismo implementado.
5. **Owner único de workspace com outros membros:** a exclusão fica bloqueada até transferência de ownership ou arquivamento (D-03, callables de P1).

A invariante financeira não pode bloquear a eliminação sem base legal de retenção registrada. A eliminação, por sua vez, não pode ser feita por hard delete em cascata no cliente.

### 6.3 TARGET — `requestAccountDeletion`

Callable idempotente, com efeito executado por job no backend:

1. Exige reautenticação recente (`auth_time`) e registra o pedido em `dsr_requests`.
2. Resolve os workspaces em que o usuário é owner: transferência (`transferOwnership`, P1), encerramento com export prévio ou bloqueio (item 5 da §6.2).
3. Cancela a assinatura e trata o customer no Stripe (capacidade entregue em P2; o fluxo de exclusão é PR-AUTH-01, P8).
4. Anonimiza a PII em `users/{uid}`, `members`, `users/{uid}/workspaces`, trilhas e dados de terceiros, conforme a §6.2.
5. Mantém os registros financeiros com retenção legal, marcando a base.
6. Revoga os tokens (`revokeRefreshTokens`), apaga o usuário do Auth por último e grava um evento de auditoria.
7. É reexecutável sob retry sem efeito duplicado. Depois de um restore de backup, as eliminações registradas são reaplicadas ([BACKUP_RESTORE_DR.md](BACKUP_RESTORE_DR.md)).

**Dependências:** P1 (ciclo de vida de workspace e membership), P2 (cancelamento Stripe), P3–P5 (schemas finais de cada domínio), P7 (auditoria, backups, ferramenta administrativa). Esse é o motivo da D-ORD-03.

### 6.4 Superfícies que a exclusão precisa cobrir (TARGET)

Firebase Auth; `users/{uid}` e subcoleções (`workspaces`, `rate_limits`); `workspaces/{id}` e `members`; `clients`, `client_private`, `receivables`, `receivable_movements`, `client_events`, `receivable_events`, `loans`, `loan_movements`; `split_*`; `transactions` (texto livre e `userId`); `activity_logs`, `goal_audit_logs`, `credit_card_events` e eventos com `actorId`; Stripe (customer); Cloud Logging (retenção E-08); backups e PITR (E-07); `localStorage` do navegador (limpeza no logout, §9). O teste de exclusão (§14) percorre essa lista.

---

## 7. Dados de terceiros

| Categoria | CURRENT | TARGET | GAP / DECISION |
| --- | --- | --- | --- |
| Clientes (documento, e-mail, telefone, endereço, observações) | **P3-I (D-24):** cadastro compartilhado `clients` mínimo (nome, situação, autoria e timestamps); PII em `client_private`, legível só por owner/admin, com `list` de `limit <= 100`; `client_private`, `client_events` e `receivable_events` estão em `isBackendOwnedCollection`, sem o que a regra genérica de subcoleção entregaria PII a member e viewer. Escrita só por `createClient`/`updateClient`/`archiveClient`; sem PII em recebíveis, movimentos, eventos, espelhos de caixa, logs nem respostas das callables; o hash da intenção não fica no cadastro compartilhado. Member e viewer veem só a lista mínima, e a interface nem consulta `client_private` para eles (E2E que inspeciona as requisições ao Firestore). Trilha de ator em `client_events` (CR-09 resolvido). | `anonymizeClient` preservando recebíveis; inclusão em exportação e eliminação (CR-07). | PR-CR-05 (P8): exportação, eliminação, anonimização e retenção (D-07, D-18); D-24 e escrita autoritativa (PR-CR-01) resolvidas na P3-I. |
| Contrapartes de empréstimo (`personName`, `personContact`, `cnpjCpf`) | Sem ciclo de vida (LOAN-16). Ficam só no contrato: espelho genérico, vínculo por ID, auditoria sem valores de metadados pessoais (P3-G/P3-H). O motivo do estorno e do cancelamento é texto livre do usuário e fica no movimento e em `loan_events` (trilha de auditoria). | Anonimização da contraparte no contrato, preservando valores. | PR-CR-05 (inclui LOAN-16), P8 |
| Participantes de divisão (`nomeExibicao`) | A identidade depende do nome de exibição (SPLIT-06). Participar exige ser membro do workspace inteiro, o que expõe todas as finanças (SPLIT-14). | Identidade por `userId == auth.uid`; anonimização do participante que sai. | PR-SPLIT-04 (P4); DECISION D-14 |
| Pessoas convidadas (e-mail) | O e-mail é gravado em `members` sem convite real nem aceite (`src/components/MembersManagerModal.tsx:53-66`). | Convite server-side com token de uso único, expiração e aceite com e-mail verificado; convite expirado é eliminado por TTL. | PR-WS-01 (P1); DECISION D-05 |
| Terceiros em comprovantes enviados à IA | Imagem ou PDF integral ao Gemini (§8), somente após confirmação da operação. | Aviso antes do envio: implementado na P5-E1 (confirmação por operação). Avaliar mascaramento de CPF e nomes (D-11). | PR-AI-01 (P8) |

**EXTERNAL CONFIGURATION REQUIRED (E-09, NÃO VALIDADO):** base legal e papel (controlador/operador) para cada categoria; cláusula de operador ou DPA com clientes PJ; texto da política sobre dados de terceiros.

---

## 8. Inteligência artificial

| Item | Classificação | Conteúdo |
| --- | --- | --- |
| Chave e execução | CURRENT | A chave fica só no backend (`GOOGLE_AI_API_KEY`, `functions/src/ai/callables.ts:33-38`); a ausência falha fechada (`functions/src/ai/callables.ts:131-141`). O cliente não importa SDK de IA (`tests/unit/ai-backend-only.test.ts:33-76`). |
| Autorização e limites | CURRENT | Payload estrito: campos extras (contexto, KPIs, perfil, papel, uid ou custo) são recusados sem crédito. Papel owner, admin ou member, relido na transação de contexto e na admissão (viewer recusado). Rate limit de 20 análises/h e 60 extrações/h por (workspace, ator), e limite de leitura de contexto de 60/h. |
| Provedor e modelo | CURRENT | Gemini API com chave do Google AI Studio, modelo `gemini-3-flash-preview` (preview, mantido na P5-E1; troca para GA pendente) e SDK `@google/genai` ~2.28.0, que substituiu o SDK legado `@google/generative-ai` (`functions/src/ai/gateway.ts`; `functions/package.json`). |
| Dados enviados | CURRENT | Linhas 14–15 do inventário. Consultor: pergunta e contexto mínimo do servidor. Extração: transcrição ou documento, só após confirmação da operação. A voz é transcrita pelo navegador, e só a transcrição segue ao Gemini (`functions/src/ai/callables.ts`; `src/components/TransactionModal.tsx`). O áudio vai para o serviço de fala do navegador (linha 16). |
| Logs | CURRENT | Sem pergunta, resposta, documento, transcrição, payload ou erro cru do SDK. Eventos sanitizados: `ai.provider_failed` (classe e status), `ai.extraction_invalid_response` (motivo), `ai.extraction_result` (status) e `ai.credit_consumed`. Identificadores registrados: `requestId`, `actorId`, `workspaceId` e `errorCode`. |
| Persistência | CURRENT | A resposta não é gravada no servidor; não há histórico server-side. **D-41 (P5-A, 2026-10-08): o DINDIN mantém o histórico da IA no navegador, isolado por usuário e workspace, com limpeza no logout.** Chave `finance_ai_chat_history_v2:<uid>:<workspaceId>` (partes escapadas) com envelope `{v: 2, uid, workspaceId, messages}` validado na leitura; escopo só com o uid da sessão do Firebase Auth e o workspace carregado para ele (`src/modules/reports/aiChatStorage.ts:92`; `src/modules/reports/hooks.ts:270`). |
| Transparência e consentimento | CURRENT (confirmação técnica, P5-E1) → GAP | Confirmação de envio por operação, versão `ai-provider-share-v1`: controle técnico de transparência e ação afirmativa, não registro de consentimento LGPD nem base legal (`functions/src/ai/consent.ts`). Política, base legal e RIPD seguem em P8. Tier e termos do provedor não comprovados. PR-AI-01 (P8). |
| Chave histórica | CURRENT → GAP | A chave foi embutida no bundle até ago/2026 e a rotação não está comprovada: PR-AI-02 e E-00 (ação imediata). Uma chave válida em mãos de terceiros permite consumir a conta e contornar o backend. |
| Provedor, tier e minimização | DECISION (parcial, P5-E1) | D-11.2: provedor Google mantido, com verificação de termos antes de qualquer troca. D-11.3: confirmação por operação e minimização implementadas. Pendentes: tier pago com termos de não treinamento e DPA; base legal; mascaramento de CPF e nomes em comprovantes; modelo GA. Vertex AI é alternativa não adotada. |
| Termos do provedor | EXTERNAL CONFIGURATION REQUIRED | E-10: retenção, uso para treinamento, revisão humana e região. NÃO VERIFICADO. |
| Contexto e saída | CURRENT (P5-E1; milestone não concluída: gate `FAIL` por bloqueadores alheios ao código) | Contexto mínimo montado no servidor a partir do relatório oficial, com cobertura por bloco e sem identificadores diretos; instruções fixas em `systemInstruction`, separadas do conteúdo (`functions/src/ai/analysisContext.ts`; `functions/src/ai/prompts.ts`). Saída validada: texto simples no consultor; extração por schema e Zod estrito (`functions/src/ai/extraction.ts`). PR-AI-05 tratado na P5-E1. |
| Histórico | CURRENT (D-41, P5-A) | Substitui a recomendação anterior (só memória ou coleção server-side). O histórico de um par (usuário, workspace) nunca aparece em outro, nem por um quadro na troca de workspace; resposta atrasada (troca de workspace ou de conta, "Limpar Histórico", chat desmontado) não entra nem é gravada; o botão "Limpar Histórico" apaga só o par atual; logout e troca de conta apagam todo histórico local (inclusive o formato antigo, sem `uid`, que nunca é lido — expurgo, não migração); numa carga nova com outra conta, os resíduos saem antes de a interface abrir; logout em outra aba impede novas gravações (`src/modules/reports/aiChatSession.ts`; `src/lib/sessionCleanup.ts:139`; `src/contexts/AuthContext.tsx:74,92,108`). **Limites:** `localStorage` não é criptografado nem cofre — o isolamento é lógico, por sessão; scripts da mesma origem (XSS), extensões do navegador e quem acessa o perfil do navegador leem o conteúdo. Sem prazo de expiração (retenção: D-18, P8). Transparência, base legal e direitos do titular sobre o histórico: P8 (PR-AI-01). |
| Custo e abuso | CURRENT (créditos, P2B.2) · TARGET (App Check) | Créditos por plano no servidor (PR-AI-03 fechado na P2B.2); teto de saída de 2.048 tokens (análise) e 1.024 (extração), desde a P5-E1; leitura de contexto limitada a 60/h. App Check: PR-APPCHK-01 (P6). |
| Aviso e opt-in | CURRENT (confirmação por operação, P5-E1) · TARGET | Confirmação antes de cada envio de análise, documento e voz, e antes de gravar a voz. Política listando o provedor e a transferência internacional, e base legal, em P8 (PR-AI-01). |
| Microfone e cabeçalhos | DECISION | A remediação de PR-PLAT-03 propõe `Permissions-Policy` negando o microfone, o que desliga a entrada por voz (`src/components/TransactionModal.tsx:723-782`). D-11 precisa decidir antes de P6 se a voz fica. `metadata.json:2-4` (manifesto do AI Studio que pede microfone) é legado a remover. |

---

## 9. Cookies, armazenamento local e terceiros no navegador

| Item | Tipo | Conteúdo | Essencial? | Limpeza no logout | Evidência (CURRENT) | TARGET / GAP |
| --- | --- | --- | --- | --- | --- | --- |
| Sessão do Firebase Auth | IndexedDB do SDK (persistência padrão de `getAuth`) | Tokens e perfil da sessão | Sim | `signOut` | `src/lib/firebase.ts:37`; nenhum `setPersistence` no código (AUTH-17) | DECISION D-06 (política de sessão) |
| `lastWorkspaceId_{uid}` | `localStorage` | Último workspace aberto (o uid aparece na chave) | Sim (preferência) | Sim (P1); numa carga nova com outra conta, a de outros uids também sai (P5-A) | `src/contexts/WorkspaceContext.tsx:44,88`; `src/lib/sessionCleanup.ts:70,139` | Manter |
| `app-theme` | `localStorage` | Tema, sons e efeitos | Sim (preferência) | Não | `src/contexts/ThemeContext.tsx:53,87` | Sem dado pessoal; manter |
| `finance_ai_chat_history_v2:<uid>:<workspaceId>` | `localStorage` | Perguntas e respostas da IA com números financeiros, por usuário e workspace | Não (funcionalidade escolhida pelo usuário) | Sim, todas as chaves do histórico (e as do formato antigo `finance_ai_chat_history_<workspaceId>`, expurgadas) | `src/modules/reports/aiChatStorage.ts`; `src/lib/sessionCleanup.ts:70`; `src/contexts/AuthContext.tsx:74` | D-41 (P5-A); retenção e direitos do titular em P8 (D-18, PR-AI-01) |
| `dindin_local_session_owner` | `localStorage` | Uid da conta dona dos dados locais; só identifica resíduos de outra conta e bloqueia gravação de aba antiga, não autoriza nada | Sim (sessão) | Sim | `src/lib/sessionCleanup.ts:19,139`; `src/contexts/AuthContext.tsx:108` | P5-A |
| `app_chat_threads`, `app_chat_messages` (sufixo `_{workspaceId}`) | `localStorage` | Mensagens digitadas no módulo simulado | Não | Não | `src/modules/messages/api.ts:28-35,61,65` | GAP PR-MSG-01 (P5); DECISION D-09 |
| Cookies próprios | — | Nenhum | — | — | Nenhuma escrita de `document.cookie` em `src` (busca: zero) | Manter |
| Analytics e trackers | — | Nenhum | — | — | Busca por `gtag`, `getAnalytics`, `sentry`, `posthog` e `hotjar` em `src` e `index.html`: zero | Manter; adotar algum exige consentimento prévio (D-26, E-09) |
| `cdn.tailwindcss.com` | **Removido em P2C-H2.** Era script de terceiro em toda carga, antes do login | — | — | — | `index.html` sem o script; CSS gerado no build (`tailwind.config.js`, `postcss.config.js`) | Resolvido (PLAN §17.11); D-20 executada |
| Google Fonts | CSS e fontes de terceiro em toda carga | IP, user agent, Referer | Não (auto-hospedável) | — | `index.html:8-10` | GAP PR-PLAT-03 (remediação: fontes locais) |
| Importmap `esm.sh` | **Removido em P2C-H2.** Era mapeamento declarado no HTML, sem consumidor: o build Vite não declara `external` e empacota todos os módulos | — | — | — | `index.html` sem importmap | Resolvido (PLAN §17.11) |
| Sons de `assets.mixkit.co` | Áudio de terceiro a cada navegação e notificação (ligado por padrão) | IP, user agent, Referer | Não | — | `src/contexts/ThemeContext.tsx:28-43,155-170`; `src/contexts/themePresets.ts:10-19`; `src/App.tsx:236-246` | GAP PR-PLAT-03 (P6; remediação: sons servidos pelo próprio Hosting ou removidos) |

**TARGET.** Só armazenamento essencial, com os terceiros de runtime removidos em P6. Nessas condições basta um aviso de armazenamento, sem banner de consentimento; confirmar com o jurídico (DECISION D-26; E-09). Se algum analytics for adotado, entra CMP com opt-in antes do carregamento. O logout limpa o cache em memória e as chaves locais do usuário (escopo de P1, AUTH-11).

---

## 10. Retenção de dados pessoais

Detalhe completo em [DATA_RETENTION_LIFECYCLE.md](DATA_RETENTION_LIFECYCLE.md).

- **CURRENT:** `RETENTION_DAYS` cobre coleções operacionais e, desde a D-18-NOTIF, notificações (180 dias, `functions/src/shared/retention.ts:84`): idempotência 90 dias, métricas 400, eventos 400, rate limit 2, checkpoints 30, eventos de caixa 90 (`functions/src/shared/retention.ts:23-61`). `activity_logs` grava `expiresAt` de 365 dias (`functions/src/triggers/transactions.ts:25,221`), sem política de TTL declarada (destino em D-18). Fatos financeiros nunca expiram (`functions/src/shared/retention.ts:11-15`). As políticas de TTL de 16 grupos estão versionadas em `firestore.indexes.json`, mas só valem depois de publicadas em cada ambiente, o que segue NÃO VERIFICADO (`functions/src/shared/retention.ts:17-20`; E-07, FIRE-08).
- **GAP:** não há prazo nem mecanismo para dados de conta, dados de terceiros, logs, trilhas de auditoria, dados pós-cancelamento ou contas inativas (PRIV-08).
- **DECISION:** D-18, prazos por categoria.
- **EXTERNAL CONFIGURATION REQUIRED:** E-07 (TTL e retenção de backups/PITR) e E-08 (retenção de logs). NÃO VERIFICADO.
- **Regra do gate:** prazo sem mecanismo implementado é `FAIL`.

---

## 11. Encarregado, canal do titular e identificação do controlador

| Item | Classificação | Conteúdo |
| --- | --- | --- |
| Canal, encarregado, controlador | CURRENT | Nenhum. Busca por `mailto`, `suporte@`, `contato@`, "encarregado" e "dpo" em `src` e `index.html`: zero (PRIV-04). |
| Identidade e contatos | DECISION | D-21: razão social, CNPJ, endereço, encarregado e canal de suporte. |
| Nomeação ou dispensa do encarregado | EXTERNAL CONFIGURATION REQUIRED | E-09: nomeação, ou justificativa documentada de dispensa aplicável a agente de pequeno porte. NÃO VALIDADO. |
| Página e formulário | TARGET | `/privacidade` identifica controlador e encarregado. O formulário de solicitação usa uma callable que grava `dsr_requests` (tipo, status, prazo, auditoria), gravável só pelo backend e legível pelo titular (PRIV-04). |
| Atendimento | TARGET | Ferramenta administrativa server-side com custom claim e `admin_audit_logs` imutável (PR-ADMIN-01, P7; DECISION D-10), sem edição manual no console de PROD. |
| Lacuna | GAP | PR-PRIV-01 (P8). |

---

## 12. Incidentes com dados pessoais

Procedimento completo em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

- **CURRENT:** não há processo, papéis, modelo de comunicação nem registro de incidentes. **GAP:** PR-OBS-02 (P7).
- **TARGET:** avaliação de risco ou dano relevante aos titulares; decisão registrada sobre comunicar a ANPD e os titulares dentro do prazo regulamentar vigente (a confirmar com o jurídico); conteúdo mínimo da comunicação; registro de incidentes pelo prazo regulamentar. Entregue em P7 (PR-OBS-02; D-32 para tempos por severidade), com validação jurídica em P8.
- **Caso conhecido:** chave Gemini exposta no passado (PR-AI-02). A rotação imediata (E-00) é contenção; a avaliação de impacto sobre titulares faz parte do registro.
- **EXTERNAL CONFIGURATION REQUIRED:** contatos do encarregado e do jurídico, e modelos de comunicação (E-09, D-21).

---

## 13. Segurança como obrigação de privacidade

Controles completos em [SECURITY_MODEL.md](SECURITY_MODEL.md).

| Controle | Classificação | Conteúdo |
| --- | --- | --- |
| Perfil e entitlements | CURRENT | `users/{uid}` é legível só pelo próprio usuário e não tem escrita do cliente (`firestore.rules:1384-1388`). O plano e a cobrança vivem em `billing_accounts/{uid}`, legível só pelo titular ativo e sem escrita do cliente, e isso tem teste (`firestore.rules:1427-1429`; `tests/firestore/billing-p2.rules.integration.test.mjs:162-217`). |
| Isolamento entre tenants | CURRENT | Leitura por membership ativa (helpers em `firestore.rules:9-33`). Os auditores não acharam vazamento entre tenants nos domínios de dados pessoais. |
| Exposição dentro do workspace | CURRENT → GAP | A PII de clientes só é legível por owner/admin desde a P3-I (D-24; `client_private`). Permanece: `activity_logs` legível por qualquer membro pelo catch-all (`firestore.rules:1436-1442`; PR-RULES-02, P6). |
| Scripts de terceiros na origem da sessão | CURRENT → GAP | PR-PLAT-03 (P6): sem CSP. O único script de terceiro em runtime (Tailwind Play CDN) saiu em P2C-H2; seguem CSS e fontes do Google Fonts e áudio do Mixkit. |
| App Check | CURRENT → GAP | PR-APPCHK-01 (P6). |
| Acesso administrativo | CURRENT → GAP | Não há ferramenta auditada; qualquer atendimento hoje seria manual no console (PR-ADMIN-01, P7). |
| Ambientes | CURRENT → GAP | Desenvolvimento e produção no mesmo projeto (PR-PLAT-01, P6). |
| Backups | CURRENT → GAP | Sem backup nem PITR (PR-BKP-01, P7). Quando existirem, o prazo em que um dado eliminado continua em backup precisa ser definido e divulgado (D-18, D-27, E-07). |

---

## 14. Testes obrigatórios (TARGET)

Todos no Emulator (projeto `minhas-financas-local`). Nenhum existe hoje (auditoria privacy-commercial-admin, `existingTests`).

| # | Teste | Milestone |
| --- | --- | --- |
| 1 | Exportação traz todos os dados do titular nas coleções do §6.4 e nenhum dado de outro tenant ou de outro titular sem base | P8 |
| 2 | Exclusão de conta remove ou anonimiza todas as superfícies do §6.4, respeita retenção legal, trata corretamente owner único e workspace compartilhado e é idempotente sob retry | P8 |
| 3 | Anonimização de cliente e de contraparte preserva valores e vínculos e alcança as cópias em texto livre (§6.1) | P8 |
| 4 | Aceite gravado pelo servidor com versão; o cliente não consegue forjar nem alterar (Rules) | P8/P9 |
| 5 | Revogação de consentimento de IA faz a callable recusar o processamento, se D-11 adotar consentimento | P8 |
| 6 | TTL e jobs de retenção eliminam só o que expirou, com limite por execução | P8 |
| 7 | Rules: dados pessoais de um workspace inacessíveis a outro; `dsr_requests` e registros de aceite imutáveis pelo cliente | P8 |
| 8 | Logout limpa o `localStorage` do usuário e o cache de consultas | P1/P5 |
| 9 | Bundle e `index.html` sem requisição a terceiros não listados em [SUBPROCESSORS.md](SUBPROCESSORS.md) | P6 |

---

## 15. Registro de validação jurídica

Todos os itens estão **NÃO VALIDADO** e são **EXTERNAL CONFIGURATION REQUIRED**. O gate `privacy-lgpd-data-lifecycle` dá `FAIL` enquanto houver linha sem data e responsável. Preencher só com evidência (documento versionado, parecer ou contrato).

| Item | Referência | Estado | ID | Data | Responsável |
| --- | --- | --- | --- | --- | --- |
| Política de Privacidade versionada e coerente com o código e com [SUBPROCESSORS.md](SUBPROCESSORS.md) | §3, §4 | NÃO VALIDADO | E-09, PR-AUTH-02 | — | — |
| Termos de Uso, incluindo cláusula de operador para dados de terceiros | §2, §7 | NÃO VALIDADO | E-09, PR-AUTH-02 | — | — |
| Aviso de cookies e armazenamento local | §9 | NÃO VALIDADO | E-09, D-26 | — | — |
| Base legal por finalidade (cada linha do inventário) | §3 | NÃO VALIDADO | E-09 | — | — |
| Qualificação controlador × operador por categoria | §2 | NÃO VALIDADO | E-09 | — | — |
| Base legal e forma de aviso ou consentimento para IA e voz | §8 | NÃO VALIDADO | E-09, D-11 | — | — |
| Relatório de impacto (RIPD) do processamento de comprovantes por IA | §8 | NÃO VALIDADO | E-09 | — | — |
| DPAs com Google Cloud/Firebase, Stripe e provedor de IA | [SUBPROCESSORS.md](SUBPROCESSORS.md) | NÃO VALIDADO | E-09, E-10 | — | — |
| Mecanismo de transferência internacional por fornecedor | [SUBPROCESSORS.md](SUBPROCESSORS.md) | NÃO VALIDADO | E-09 | — | — |
| Nomeação do encarregado ou justificativa de dispensa | §11 | NÃO VALIDADO | E-09, D-21 | — | — |
| Canal do titular e prazos de resposta | §5, §11 | NÃO VALIDADO | E-09, D-21 | — | — |
| Tratamento de exclusão × histórico financeiro compartilhado | §6.2 | NÃO VALIDADO | D-07 | — | — |
| Prazos de retenção por categoria, inclusive registros de acesso a aplicações e registros fiscais | §10 | NÃO VALIDADO | D-18 | — | — |
| Prazo de permanência de dados eliminados em backups | §13 | NÃO VALIDADO | D-18, D-27, E-07 | — | — |
| Comunicação de incidente à ANPD e aos titulares (prazo, conteúdo) | §12 | NÃO VALIDADO | E-09 | — | — |
| Idade mínima e dados de crianças e adolescentes | §4 | NÃO VALIDADO | E-09 | — | — |
| URLs legais na tela de consentimento OAuth | §4 | NÃO VERIFICADO | E-03 | — | — |

---

## 16. Lacunas do tema

BLOCKER e HIGH estão no [registro do plano](PRODUCTION_READINESS_PLAN.md#6-registro-de-blockers). MEDIUM e LOW aparecem com o ID de origem da auditoria.

| ID | Sev. | Milestone | Lacuna |
| --- | --- | --- | --- |
| PR-AUTH-01 | BLOCKER | P8 | Sem exclusão de conta, exportação nem cancelamento de assinatura na saída do titular |
| PR-AUTH-02 | BLOCKER | P9 | Cadastro sem Termos, Política e aceite versionado server-side |
| PR-AI-01 | BLOCKER | P8 | Dados financeiros, comprovantes e transcrições ao Gemini sem base legal, transparência nem contrato |
| PR-AI-02 | BLOCKER | P0 (E-00) | Chave Gemini exposta no passado, rotação não comprovada |
| PR-PRIV-01 | HIGH | P8 | Sem canal do titular, identificação do controlador/encarregado nem divulgação de subprocessadores |
| PR-CR-05 | HIGH | P8 | Dados de terceiros sem ciclo de vida (inclui LOAN-16). Parcial na P3-I: minimização e visibilidade por papel dos clientes (D-24); exportação, eliminação, anonimização e retenção seguem em P8 |
| PR-AI-04 | HIGH | P5 | Histórico de chat de IA no `localStorage`, vazando entre workspaces e usuários — **resolvido na P5-A** (D-41; plano §20.1), aguardando auditoria independente |
| PR-MSG-01 | HIGH | P5 | Mensagens simuladas em `localStorage` |
| PR-PLAT-03 | HIGH | P6 | Terceiros em runtime na origem da sessão (Google Fonts, sons do Mixkit), sem CSP. Tailwind Play CDN e importmap `esm.sh` removidos em P2C-H2 |
| PR-WS-01 | BLOCKER | P1 | E-mail de convidado gravado sem convite real nem aceite |
| PR-ADMIN-01 | HIGH | P7 | Sem ferramenta administrativa auditada para atender o titular |
| PR-BKP-01 | BLOCKER | P7 | Sem backups; política de eliminação em backup inexistente |
| PR-RULES-02 | MEDIUM | P6 | Catch-all expõe `activity_logs` (ator e descrição) a qualquer membro |
| PRIV-06 | MEDIUM | P5 | Armazenamento local por workspace, sem limpeza no logout (consolidado em PR-AI-04) |
| PRIV-07 | MEDIUM | P8 | Dados de terceiros sem allowlist de campos nem definição de papel de operador (consolidado em PR-CR-05) |
| PRIV-08 | MEDIUM | P8 | Sem política de retenção de dados pessoais |
| AUTH-11 | MEDIUM | P1/P5 | Logout não limpa o estado local (escopo de logout de P1; histórico de IA em PR-AI-04) |
| AUTH-12 | MEDIUM | P1 | Perfil sem dono server-side; campos pessoais sem finalidade (consolidado em PR-AUTH-03) |
| AUTH-17 | LOW | P1 | Política de sessão indefinida |
| CR-09 | MEDIUM | P3 | **Resolvido na P3-I:** ator e tempo do servidor em `client_events` e `receivable_events` |
| SPLIT-14 | MEDIUM | P4 | Participar da divisão expõe todas as finanças do workspace |
| SPLIT-16 | LOW | P4 | Convites sem TTL nem revogação |
| FIRE-08 | MEDIUM | P6 | TTL, que é o mecanismo de retenção, versionado para 16 grupos (inclui `notifications` e `notification_entries`, D-18-NOTIF), mas sem publicação verificada por ambiente (E-07) |
| FIRE-11 | MEDIUM | P5 | IA com modelo preview e chave AI Studio, sem residência de dados |

---

## 17. Fatos verificados no código nesta redação

Fatos CURRENT que não estavam na auditoria, ou que refinam o que ela diz, conferidos no HEAD `9c3ab46`:

- A Web Speech API é usada com `lang = 'pt-BR'`, e só a transcrição vai à callable (`src/components/TransactionModal.tsx:723-760`). O Gemini não recebe áudio.
- ~~O nome da contraparte de empréstimo é copiado para `transactions.description` e daí para `activity_logs.description`~~ — eliminado na P3-H (o caminho de escrita da interface foi removido; o espelho do backend é genérico).
- Os logs de falha de IA levam `actorId` (uid) (`functions/src/ai/callables.ts:155,254`).
- Sons de terceiro (`assets.mixkit.co`) são ligados por padrão e tocados a cada navegação (`src/contexts/themePresets.ts:10-19`; `src/contexts/ThemeContext.tsx:28-43,155-170`; `src/App.tsx:236-246`). Já incorporado a PR-PLAT-03.
- O importmap `esm.sh` foi removido em P2C-H2: não tinha consumidor (o build não marca dependências como externas, `vite.config.ts:36-59`) e a aplicação roda inteira no E2E com o host negado (PLAN §17.11).
- Os campos de perfil pessoal permitidos pelas Rules em `users/{uid}` não são gravados por nenhum código do cliente no HEAD.
