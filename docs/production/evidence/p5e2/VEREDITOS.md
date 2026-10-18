# P5-E2 — vereditos das skills e auditoria do delta

**Escopo das revisões:** o diff do worktree contra `92e5a9c`, avaliado sobre a árvore final ``2f8649da575123373020b254d2b0f066e3dbcb13`, a árvore do `verify:all` final (depois dele, só documentação mudou)`. Superfícies e evidências:
- [`inventario.md`](inventario.md);
- [`visual/LEIAME.md`](visual/LEIAME.md);
- [`guarda-mutantes.md`](guarda-mutantes.md);
- [`execucoes.md`](execucoes.md).

Cada skill foi aplicada no escopo definido pela própria política, que inclui as seções do checklist exercitadas pelo diff e as invariantes que ele poderia violar. Itens de milestones posteriores não afetados ficam listados como fora do escopo.

## PASS — revisão de UI de produto em PT-BR (`ptbr-product-ui-review`)

- **Requisito e justificativa da mudança visual:**
  - D-09, opção A, aprovada pelo usuário em 2026-10-12 (plano §9.4);
  - o `ARCHITECTURE.md` registrava que a remoção altera o Header e exige aprovação;
  - a mudança é a mínima: o controle sai, sem espaço reservado e sem reorganizar o resto.
- **Texto:**
  - nenhum texto novo visível;
  - continuam iguais os rótulos do Header ("Notificações, N não lidas", "Ativar modo escuro/claro", "Abrir/Fechar menu da conta", "Abrir/Fechar menu", "Mês anterior", "Próximo mês", "Selecionar Mês e Ano", "Hoje");
  - saíram "Mensagens", "Nova Conversa", "Iniciar nova conversa", "Pesquisar conversa..." e "Selecione uma conversa".
- **Estados:** loading, vazio e erro do sino não mudaram. Os do painel simulado saíram com ele.
- **Acessibilidade:**
  - a ordem do Tab é a mesma, sem "Mensagens", nas 6 combinações;
  - nenhum botão sem nome (E2E V-05);
  - o clique ou toque fora fecha as notificações e o menu da conta; Esc fecha o menu lateral;
  - o anel de foco do sino é o mesmo;
  - axe sem violações no Header antes e depois;
  - o débito de contraste do badge (P5-D2) não mudou.
- **Responsividade:**
  - 1440, 390 e 360 px, claro e escuro;
  - transbordamento 0 e mesma altura;
  - pixel a pixel, só a faixa dos controles muda; menu da conta, painel no celular e interior do painel no desktop têm 0 px;
  - o separador fica, com controle dos dois lados.
- **Testes:**
  - E2E `ux-navigation-a11y` exige a ausência do botão na página toda, inclusive oculto, no desktop e a 390 px;
  - E2E direcionado e suíte completa com resultados em [`execucoes.md`](execucoes.md).

## PASS — Privacy/LGPD data lifecycle (`privacy-lgpd-data-lifecycle`, escopo P5-E2)

- **Inventário a partir do código final:**
  - chaves do navegador: `lastWorkspaceId_<uid>` (`WorkspaceContext.tsx:61,102`), `app-theme` (`ThemeContext.tsx:53,87`, preferência do dispositivo), `finance_ai_chat_history_v2:<uid>:<workspaceId>` (`aiChatStorage.ts`, por `resolveBrowserStorage`) e `dindin_local_session_owner`;
  - saíram os 5 acessos de `src/modules/messages/api.ts` a `app_chat_threads[_ws]` e `app_chat_messages[_ws]`, que eram texto livre de conversa sem uid;
  - nenhum código grava ou lê `app_chat_*` (busca no código e guarda).
- **Minimização (§2):** sai um armazenamento local de texto livre e as pessoas fictícias. Nenhum dado novo é coletado.
- **Retenção e armazenamento local (§6, §8):**
  - as chaves que ficam mantêm o mecanismo D-41: saem no logout, na troca de conta e no resíduo de outra conta (`sessionCleanup.ts`);
  - provas: `test:unit:p1` 131/131, `test:unit:ai-chat` 37/37 e E2E `ai-chat-isolation`.
- **Resíduo de builds antigos:** chaves `app_chat_*` deixadas em navegador de desenvolvimento deixam de ser apagadas no logout. Não há usuários reais (política de legado), nenhum leitor existe e o E2E `workspace-membership.spec.ts:110-113` continua exigindo que nenhuma chave `app_chat_` sobre depois do logout.
- **Documentação (§1, §12):** `PRIVACY_LGPD.md` e `DATA_RETENTION_LIFECYCLE.md` atualizados na mesma mudança.
- **Fora do escopo desta avaliação** (milestones posteriores, não afetados pelo diff):
  - bases legais e validação jurídica (PR-AI-01, P8);
  - aceite versionado (PR-AUTH-02, P9);
  - direitos do titular, exportação e eliminação (P8);
  - subprocessadores e transferência internacional (E-09, E-10);
  - incidentes (P7);
  - D-26 (banner/CMP).

## PASS — Multi-tenant security review (`multi-tenant-security-review`, escopo P5-E2)

- **Fronteiras:** o diff é só de frontend. Auth, memberships, RBAC, Firestore Rules, índices, Functions, callables e `firebase.json` não mudaram (`git diff --quiet 92e5a9c -- functions firestore.rules firestore.indexes.json firebase.json .firebaserc ...`).
- **Exposição entre contas no navegador:**
  - o módulo removido guardava conversas por `workspaceId`, sem uid; hoje não há leitor nem produtor;
  - o histórico da IA continua escopado por uid e workspace, com a mesma reconciliação (`AuthContext`: `ownsLastWorkspaceKey || isAiChatHistoryKeyOf`);
  - a escolha do que é limpo continua no backend de identidade (Firebase Auth); o dono local não concede acesso.
- **IDOR, escalada, mass assignment, replay e concorrência:** N/A. O módulo nunca teve backend e nenhum caminho de escrita mudou.
- **Emulator:** as suítes de Rules com dois tenants (workspaces, notificações, relatórios e demais) rodaram no `verify:all` (273/273 de ferramentas e Rules, inclusive as suítes de workspaces e notificações com dois tenants).

## PASS — regression release gate (`regression-release-gate`)

- **Base e escopo:**
  - base `92e5a9c` (pedida pelo usuário; HEAD do worktree e merge-base);
  - mudanças sem commit: 5 arquivos excluídos, 17 alterados (6 documentos, 5 de código, 3 testes unitários, 2 specs E2E e o `package.json`), a guarda nova e `docs/production/evidence/p5e2/`;
  - superfícies: frontend (Header, App, Icons, types, limpeza de sessão), testes, um script do `package.json` e documentação;
  - sem Functions, Rules, índices, `firebase.json`, lockfiles, workflow ou `.claude`.
- **Proibições:**
  - nenhum teste removido, pulado, `only`, `fixme`, timeout ou retry novo;
  - as asserções exatas continuam exatas;
  - nenhum tipo, Rule ou validação relaxada;
  - nenhum resto do módulo removido em código, Rules, índices ou Functions (guarda não vazia e busca);
  - nenhum comando aponta para produção;
  - plano atualizado (§20.13).
- **Matriz:**
  - typecheck, builds, unitários, integração, Emulator, Rules e Playwright completo no `verify:all` final, saída 0;
  - smoke adjacente pelo E2E direcionado: notificações, histórico da IA, Divisão de contas e smokes.
- **Skips e cobertura:** 0 skip, todo, cancelado ou retry. Sem ferramenta de cobertura no repositório: comparação por contagem, 2.883 → 2.887, só +4 da guarda.
- **Superfícies:**
  - UI: só o Header, com evidência antes × depois e justificativa D-09;
  - textos: só remoções;
  - rotas: nenhuma;
  - contratos: só exports do módulo, dos dois ícones órfãos e do reexport de tipos, sem consumidor (typecheck).
- **Skills exigidas pela superfície:**
  - `ptbr-product-ui-review`, `privacy-lgpd-data-lifecycle` e `multi-tenant-security-review`: PASS;
  - `financial-domain-integrity`, `firestore-scale-cost-review`, `billing-entitlement-integrity`, `firebase-production-readiness`, `observability-incident-readiness` e `saas-commercial-readiness`: não acionadas, porque o diff não toca dados financeiros, consultas, billing, plataforma, observabilidade nem afirmação pública.
- **Riscos residuais:** os da §20.13, sem bloqueador. A instabilidade histórica de `cash-accounts.spec.ts:559` segue registrada e passou em todas as execuções.

## Auditoria independente do delta

Revisor independente, somente leitura, sem executar testes. Parecer: remoção no código e nos testes correta e sem regressão. Achados e tratamento:

1. **HIGH:** §20.13, `execucoes.md` e `VEREDITOS.md` ainda não existiam.
   - Era o fechamento previsto para depois do gate, agora escrito.
2. **LOW:** `e2e/workspace-membership.spec.ts:112` ainda filtra `app_chat_` depois do logout.
   - Fica como armadilha de ausência: falharia se o módulo voltasse a gravar essas chaves.
   - A guarda estática continua limitada a `src/`: testes citam as chaves e o rótulo em asserções negativas legítimas.
3. **LOW:** tempo verbal e condicional obsoletos no TARGET de `DATA_MODEL.md` §8.
   - Corrigido.
4. **LOW:** o E2E de ausência olhava só o `header` e ignorava elementos ocultos.
   - Corrigido para a página toda com `includeHidden: true`.
5. **INFO:** robustez da guarda.
   - Corrigido: raiz por `fileURLToPath`, checagem positiva da raiz e varredura sem remover comentários (comentários também não podem citar o módulo).
6. **INFO:** V-01 sem margem.
   - O teste exige pelo menos 5 ícones no Header do desktop, e agora são exatamente 5 (ChevronLeft, Search, ChevronRight, Bell e Moon).
   - O teste não foi alterado e passa.
7. **INFO:** `EnvelopeIcon` e `MessageCirclePlusIcon` sem consumidor.
   - Os dois componentes nomeados foram removidos de `Icons.tsx`, porque o único uso era o módulo.
   - As entradas `Envelope` e `MessageCirclePlus` do `ICON_MAP` ficam, porque podem ser referenciadas por nome a partir de dados.
   - O `BuildingIcon` importado e não usado no Header é anterior e fica fora do escopo.
8. **INFO:** comentário ambíguo em `sessionCleanup.ts`.
   - Passa a dizer "o histórico do assistente de IA".
