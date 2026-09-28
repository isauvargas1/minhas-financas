@AGENTS.md

## Claude Code — instruções globais do projeto

### Plano mestre

- O plano mestre é [`docs/production/PRODUCTION_READINESS_PLAN.md`](docs/production/PRODUCTION_READINESS_PLAN.md): milestones P0–P10, blockers confirmados, estado e evidências. Leia-o antes de qualquer trabalho.
- Os documentos de referência ficam em `docs/production/`. Eles classificam cada tema como CURRENT, TARGET, GAP, DECISION ou EXTERNAL CONFIGURATION REQUIRED; descrevem alvo e lacunas, não provam implementação.
- `docs/investments/` e `docs/credit-card-domain-phase-*.md` são registro histórico de programas anteriores. Podem orientar, mas não definem o estado atual.
- Não inicie um milestone sem pedido explícito e não avance automaticamente para o seguinte.
- Atualize o plano mestre somente com decisões, progresso, evidências, riscos e rollback novos.

### Proibições

- Não fazer push, merge, deploy nem publicar Rules, índices, Functions, Hosting ou configuração remota. Os scripts `deploy:*` não são executados por agentes.
- Não acessar Firebase de produção (`sistema-financeiro-pesso-20698`) nem seus dados, usuários, logs ou configuração — por CLI, SDK, script, console ou ferramenta MCP.
- Firebase durante desenvolvimento: somente Emulator (projeto `minhas-financas-local`) ou ambiente DEV/STAGING autorizado explicitamente pelo usuário na conversa corrente, com o projeto nomeado.
- Ferramentas MCP do Firebase: apenas as de documentação (`developerknowledge_*`), salvo autorização explícita para um projeto não produtivo.
- Não executar `npm run dev` nem `npm run preview` com a configuração local: o app conecta ao projeto de produção (PR-PLAT-01). Para inspecionar a UI, use o build E2E contra o Emulator (`npm run test:e2e`, `npm run test:e2e:ui`).
- Não ler, imprimir ou copiar segredos (`.env*`, chaves, service accounts, tokens).
- Não enfraquecer testes, asserções, Rules, tipos, validações, cobertura ou gates para obter PASS. Não usar `skip`/`only`, mocks excessivos, timeouts maiores ou fallbacks permissivos para contornar falhas.

### Direção de arquitetura

Referência: [`docs/production/ARCHITECTURE.md`](docs/production/ARCHITECTURE.md). Em resumo:

- Operações financeiras críticas são autoritativas exclusivamente no backend (Functions com Admin SDK, validação estrita, transação, idempotência, auditoria). Firestore Rules são a segunda camada independente e negam escrita do cliente em dados autoritativos.
- Valores monetários em centavos inteiros; nenhuma autoridade financeira em ponto flutuante.
- Operações compostas são transacionais; concorrência é testada; não há hard delete de histórico financeiro; não há fonte de verdade financeira concorrente.
- Quotas e entitlements são validados server-side. DEV/STAGING/PROD isolados. Nenhum segredo no cliente ou no repositório.

### Legado e substituição de arquitetura

- Não existem dados reais de produção. Compatibilidade com código, schema ou fluxos legados **não** deve ser preservada quando existir apenas para manter dados de desenvolvimento/teste.
- Ao substituir uma arquitetura, remova no mesmo milestone o write path antigo, readers, fallbacks, adapters, flags de alternância, Rules e índices sem uso, Functions órfãs e fontes de verdade concorrentes. Dados de teste são recriados por seed/Emulator, não migrados.
- Um milestone que substitui domínio só é concluído quando a remoção está provada por busca no código, Rules que negam o caminho antigo e testes.

### Interface

- O frontend autenticado deve permanecer visualmente inalterado. Mudanças de UI só quando estritamente necessárias para corrigir integração, estado, validação, segurança ou contrato alterado pelo backend, com a menor alteração possível. Sem redesign, ajuste estético, mudança de layout ou reorganização de navegação.
- Todo conteúdo visível ao usuário final em pt-BR, inclusive erros vindos do backend.

### Fluxo de trabalho

1. Inspecione o código real (HEAD) antes de implementar ou de assumir que algo está concluído.
2. Carregue as skills relevantes (tabela abaixo) antes de alterar a superfície correspondente.
3. Durante a implementação, execute testes direcionados. Firebase somente via Emulator ou DEV/STAGING autorizado nos termos de "Proibições".
4. Ao final de cada milestone, execute `regression-release-gate` com as skills de domínio exigidas pela superfície tocada. O milestone só é concluído com `PASS`.
5. Para exploração ampla, logs extensos e suítes, use subagents e retorne apenas conclusões relevantes.
6. Não imprima arquivos completos, diffs completos ou logs extensos sem necessidade.
7. Resumo final de milestone: no máximo 8 bullets.

### Skills do projeto

Fonte canônica em `.agents/skills/` (compartilhada com Codex); `.claude/skills/` contém links para elas (exceto `playwright-cli`, local ao Claude Code). A tabela que obriga cada gate está em `regression-release-gate`; a lista abaixo é o mesmo mapa, para consulta. Todas emitem apenas `PASS` ou `FAIL`; ausência de evidência obrigatória é `FAIL`.

| Skill | Acionar quando a tarefa tocar |
| --- | --- |
| `financial-domain-integrity` | dados, cálculos, eventos, saldos, relatórios financeiros, substituição de domínio financeiro |
| `firestore-scale-cost-review` | queries, listeners, schema, índices, agregados, jobs sobre coleções |
| `multi-tenant-security-review` | Auth, workspaces, membership, RBAC, Rules, callables, Storage |
| `billing-entitlement-integrity` | Stripe, planos, assinatura, webhook, entitlements, quotas |
| `firebase-production-readiness` | ambientes, `firebase.json`, runtime/exports de Functions, App Check, segredos, IAM, backup/restore |
| `privacy-lgpd-data-lifecycle` | dados pessoais, aceite/consentimento, retenção, exportação/exclusão, subprocessadores |
| `observability-incident-readiness` | logging, correlação, métricas, alertas, auditoria, reconciliação, incidentes, DR |
| `saas-commercial-readiness` | landing, preços, cadastro, checkout, páginas legais, footer, SEO, afirmações públicas |
| `ptbr-product-ui-review` | qualquer conteúdo renderizado ao usuário |
| `regression-release-gate` | fechamento de milestone, commit importante, release ou PR |
| `playwright-cli` | inspeção interativa da aplicação no navegador (sempre contra Emulator) |

As Firebase Agent Skills oficiais do plugin `firebase` (por exemplo `firebase:firebase-security-rules-auditor`, `firebase:firebase-firestore`, `firebase:firebase-auth-basics`) podem ser usadas como referência técnica complementar; não substituem as skills do projeto.
