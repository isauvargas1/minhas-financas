---
name: regression-release-gate
description: Execute um gate rigoroso de regressão antes de concluir milestone, commit importante, release ou pull request. Use para comparar a mudança com a base Git, validar builds e testes de frontend/Firebase/Functions, detectar enfraquecimento de testes ou contratos e emitir uma decisão final PASS/FAIL com evidências e riscos residuais.
---

# Regression Release Gate

## Contexto do projeto

- Comandos oficiais (ver `package.json` e `.github/workflows/quality-gate.yml`): `npm run verify:fast` (typecheck, lint das Functions, build do frontend e das Functions, unitários), `npm run test:integration:emulator` (integração das Functions e todas as suítes de Rules em `tests/firestore/` no Emulator) e `npm run test:e2e` (build E2E + Playwright contra Emulator). `npm run verify:all` executa os três.
- Emulator sempre com projeto `minhas-financas-local`. Qualquer comando, variável ou script que aponte para o projeto de produção (`sistema-financeiro-pesso-20698`) durante o gate é violação e `FAIL`. Scripts `deploy:*` nunca fazem parte do gate.
- O plano mestre é `docs/production/PRODUCTION_READINESS_PLAN.md`. Um milestone só é concluído com este gate em `PASS` e com o plano atualizado com evidências.

## Skills de domínio exigidas pelo tipo de mudança

Este gate não substitui as skills de domínio. Quando o diff tocar a superfície abaixo, o relatório deve conter o veredito `PASS` da skill correspondente sobre o estado final, emitido no escopo definido na seção "Escopo da avaliação" da skill (quando houver); veredito ausente ou `FAIL` implica `FAIL` deste gate.

| Superfície tocada | Skill obrigatória |
| --- | --- |
| Dados, cálculos, eventos, saldos, relatórios financeiros, substituição de domínio financeiro | `financial-domain-integrity` |
| Queries, listeners, schema, índices, agregados, jobs sobre coleções | `firestore-scale-cost-review` |
| Auth, workspaces, membership, RBAC, Rules, callables, Storage | `multi-tenant-security-review` |
| Stripe, planos, assinatura, webhook, entitlements, quotas | `billing-entitlement-integrity` |
| Ambientes, `firebase.json`, runtime/exports de Functions, App Check, segredos, IAM, backup/restore | `firebase-production-readiness` |
| Dados pessoais, aceite/consentimento, retenção, exportação/exclusão, subprocessadores | `privacy-lgpd-data-lifecycle` |
| Logging, correlação, métricas, alertas, auditoria, reconciliação, incidentes, DR | `observability-incident-readiness` |
| Landing, preços, cadastro, checkout, páginas legais, footer, SEO, afirmações públicas | `saas-commercial-readiness` |
| Qualquer conteúdo renderizado ao usuário | `ptbr-product-ui-review` |

## Executar o gate

1. Ler integralmente [references/release-checklist.md](references/release-checklist.md) antes de validar.
2. Preservar o worktree e não alterar código, testes, snapshots, baselines ou configuração para obter aprovação. Este gate valida; não corrige.
3. Identificar a base Git correta e registrar base, `HEAD`, merge-base, estado do worktree e diff completo, incluindo arquivos staged, unstaged e untracked.
4. Descobrir comandos no repositório e executar todas as etapas aplicáveis do checklist. Não substituir uma etapa por inspeção estática quando ela puder ser executada.
5. Tratar etapa obrigatória ausente, não executada, inconclusiva ou sem evidência como `FAIL`, salvo impedimento ambiental externo comprovado; mesmo nesse caso, não emitir `PASS`.
6. Auditar skips, cobertura, validações, contratos e efeitos adjacentes conforme o checklist.
7. Emitir somente `PASS` quando todas as etapas obrigatórias passarem e nenhuma proibição for violada. Encerrar com o formato de relatório prescrito no checklist.

## Regras invioláveis

- Não aceitar redução de cobertura, desativação/remoção de teste, relaxamento de asserção, tipo, schema, regra de segurança ou validação.
- Não aceitar teste skipped sem evidência de causa exclusivamente ambiental e registro explícito do teste, motivo e impacto.
- Não omitir falha preexistente: separar sua origem, mas manter `FAIL` enquanto ela impedir comprovação do gate.
- Não declarar sucesso com base apenas em exit code agregado; registrar comandos, resultados e evidências por etapa.
