# P5-E2 — inventário inicial do módulo simulado de Mensagens (D-09)

**Base:** commit `92e5a9c231d2c9a52f38146dd9b3c8f7fbffe081`, árvore `f21531cacaf0f0c356fad7fea2b70e388f1cd2a7`.

- Branch remota: `fix/p5-e2e-stability-2026-10-15` (PR #3).
- CI "Gate de qualidade": run 39070300689, `success`, no mesmo SHA.
- Conteúdo cumulativo: checkpoint P5-E1.1 (`5f79584`), Java 21 (`ce7f87d`) e a correção da E2E-FIX-01.
- Busca feita em `git fetch --no-tags --refmap=` (nenhuma ref local alterada).
- Trabalho num worktree isolado, branch nova `feat/p5-e2-remove-mock-messages-2026-10-17`.
- As alterações pendentes de tarefas anteriores ficaram intocadas: o workflow no repositório principal e o `TransactionModal.tsx` no worktree da E2E-FIX-01.

## Os pontos informados, conferidos no código da base

| Arquivo | Na base (`92e5a9c`) | Ação na P5-E2 |
| --- | --- | --- |
| `src/components/Header.tsx` | Import de `EnvelopeIcon` (`:3`), de `MessagesPanel` (`:5`) e de `useUnreadMessagesCount` (`:12-14`). Prop `onOpenSplitGroup` (`:29`, `:34`). Estado `isMessagesOpen` (`:47`), contador (`:120`), `toggleMessages` (`:175-178`) e o fechamento cruzado (`:171`, `:181`). `Badge` com `count` (`:230-234`). Fundo que fecha os painéis (`:238`, `:242`). Botão do envelope, badge e painel (`:358-381`). | Removidos. A prop `count` do `Badge` só servia ao contador de Mensagens; o sino usa `label`, com o mesmo DOM. O separador vertical fica, entre o sino e o tema. |
| `src/components/MessagesPanel.tsx` | 341 linhas: painel de conversas e busca, presença "Online" fixa, vínculo com a Divisão de contas (`:230-232`). | Excluído. |
| `src/components/NewConversationModal.tsx` | 175 linhas: criação fictícia de conversa com busca de pessoas. | Excluído. |
| `src/modules/messages/api.ts` | 204 linhas, detalhadas abaixo. | Excluído. |
| `src/modules/messages/hooks.ts` | 91 linhas: React Query (`useChatThreads`, `useThreadMessages`, `useUnreadMessagesCount`, `useMarkThreadAsRead`, `useSendMessage`, `useCreateConversation`, `useSearchUsers`). | Excluído. |
| `src/modules/messages/types.ts` | 28 linhas: `ChatUser`, `ChatMessage`, `ChatThread`. | Excluído; a pasta saiu junto. |
| `src/types.ts` | Reexport `export * from './modules/messages/types.ts'` (`:9`). | Só essa linha removida. A duplicata preexistente do reexport de `settings-catalog` (`:11-12`) ficou, fora do escopo. |
| `src/lib/sessionCleanup.ts` | Prefixos `app_chat_threads` e `app_chat_messages` (`:26-27`) e a menção no comentário (`:12-13`). | Removidos. Ficam `lastWorkspaceId_`, `finance_ai_chat_history_` e `dindin_local_session_owner`, com a mesma lógica de reconciliação. O comentário da carga sem sessão (`:130`) passa a dizer "o histórico do assistente de IA" em vez de "as conversas". |
| `e2e/ux-navigation-a11y.spec.ts` | Exigia o botão "Mensagens" visível (`:244`, `:252-254`). | Passa a exigir zero botões "Mensagens" na página inteira, inclusive ocultos (`includeHidden`), no desktop e no celular, com o sino visível. Fechamento por clique fora do menu da conta acrescentado. |
| `src/App.tsx` | `handleOpenSplitGroup` (`:283-286`), usado só na prop `onOpenSplitGroup` do Header (`:513`), que o repassava ao painel simulado. | Função e prop removidas. A navegação real da Divisão de contas continua em `SplitGroupsView` e `SplitGroupDetailsView`, com callbacks próprios. |

**Detalhe de `src/modules/messages/api.ts`:**
- conversas fixas (`MOCK_THREADS`, `:5-27`, com "Alice" e "Bruno");
- pessoas fixas com cargo em `createConversation`/`searchUsers` (`:149-153`, `:190-194`): Alice, Bruno, Carla, Daniel e Eduarda;
- atrasos artificiais de 100 a 600 ms (`setTimeout`, `:70-137`);
- tudo em `localStorage`, nas chaves `app_chat_threads[_<workspaceId>]` e `app_chat_messages[_<workspaceId>]` (`:35-66`), sem uid.

## Referências encontradas além da lista

| Arquivo | Referência | Ação |
| --- | --- | --- |
| `tests/unit/session-cleanup.test.ts` | Lista exata de prefixos com as chaves `app_chat_*` (`:84-85`); chaves semeadas que deviam sair (`:62-65`, `:215`). | Lista exata atualizada para os 3 prefixos restantes; sementes do módulo removido retiradas. As asserções de IA, último workspace e dono local não mudaram. |
| `tests/unit/ai-chat-history.test.ts` | Semente `app_chat_messages_ws-pf` no teste 11b (`:434`). | Semente retirada; o predicado de posse da IA continua provado pelas mesmas asserções. |
| `tests/unit/notifications-guard.test.ts` | O fundo do Header precisava fechar também `setIsMessagesOpen` (`:169`). | O regex exato passa a exigir o fechamento de notificações e do menu da conta, com `pressTargetProps`. |
| `e2e/notifications-p5d2.spec.ts` | Comentário dizendo que o `Badge` "é o mesmo das mensagens" (`:850-853`). | Comentário atualizado; nenhuma linha de teste mudou. |
| `src/components/Icons.tsx` | `EnvelopeIcon` era usado só no botão de Mensagens do Header; `MessageCirclePlusIcon`, só no painel. | Os dois componentes nomeados foram removidos, porque o único consumidor era o módulo; o ajuste veio da revisão independente. As entradas `Envelope` e `MessageCirclePlus` do `ICON_MAP` ficam, porque podem ser referenciadas por nome via `DynamicIcon`/`AppIcon` a partir de dados. O pacote continua genérico: os outros 9 exports sem consumidor já existiam e não são deste módulo. |
| `e2e/workspace-membership.spec.ts` | Depois do logout, exige que não sobre chave `lastWorkspaceId_`, `finance_ai_chat_history_`, `app_chat_` nem o dono local (`:110-113`). A linha já estava na base. | Fica como armadilha de ausência: nenhum código produz `app_chat_` hoje, e o teste falharia se o módulo voltasse a gravar essas chaves sem limpeza. |
| `e2e/ux-navigation-a11y.spec.ts`, V-01 | Exige pelo menos 5 ícones pintados em `header button:visible` (`:112`, `:126`, `:139`). | Sem alteração. No desktop eram 6 e agora são exatamente 5 (ChevronLeft, Search, ChevronRight, Bell e Moon). O teste passa, sem margem; registrado. |
| `src/components/Header.tsx` | `BuildingIcon` importado e não usado. | Já estava na base; não é do módulo e fica fora do escopo. |
| `docs/production/*.md` | Plano mestre (16 menções), `ARCHITECTURE`, `DATA_MODEL`, `DATA_RETENTION_LIFECYCLE`, `LAUNCH_CHECKLIST` e `PRIVACY_LGPD`. | Atualizados só nas linhas de Mensagens, PR-MSG-01 e D-09. Os registros históricos ficam (riscados ou marcados como "até a P5-E1.1"). |

## O que não foi tocado

- **Assistente de IA:**
  - `ReportsAIChat` e `aiChatStorage`/`aiChatSession` (`AiChatMessage`): é o chat da IA, não o módulo da D-09;
  - o histórico isolado por usuário e workspace e a confirmação de envio ao provedor;
  - a extração de documentos da P5-E1.1.
- **Notificações:** `NotificationsPanel`, `src/modules/notifications/*`, contagem, paginação, exclusão individual e foco.
- **Sistema financeiro e segurança:** domínio financeiro, Functions, Firestore Rules, índices, `firebase.json`, Auth, memberships e RBAC (nenhum diff).
- **Busca pela palavra "mensagem"/"message":** não foi usada como critério. Ela aparece em erros, notificações, operações financeiras e respostas da IA.

## Buscas de confirmação na base

- **"Mensagens"** no `src`: só `Header.tsx:363` e `MessagesPanel.tsx:124`.
- **"conversa":**
  - no módulo e nos dois componentes;
  - em `ReportsAIChat.tsx:139` ("Limpar conversa"), que é da IA e fica.
- **Landing, páginas públicas, `index.html` e `public/`:** nenhuma afirmação sobre Mensagens. `saas-commercial-readiness` não é acionada pela superfície.
- **Backend e infraestrutura:** nenhuma coleção, Rule, índice, Function, callable, dependência npm exclusiva ou CSS do módulo.
