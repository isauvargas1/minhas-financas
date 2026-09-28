## Engineering invariants

- Produção SaaS multiworkspace; nunca assumir single-user.
- Toda leitura/escrita deve preservar isolamento por workspace.
- Operações financeiras críticas ficam no backend.
- RBAC owner/admin/member deve ser validado server-side.
- Não fazer hard delete de histórico financeiro.
- Toda operação suscetível a retry deve ser idempotente.
- Evitar full scans, N+1, queries sem limit/paginação e listeners desnecessários.
- Índices Firestore fazem parte da implementação, não de trabalho futuro.
- Nunca reduzir segurança, testes ou integridade para concluir uma tarefa.
- Não alterar comportamento/UI fora do escopo.
- Tudo visível ao usuário final deve estar em pt-BR.
- Não fazer push, merge ou deploy; não acessar o projeto Firebase de produção; Firebase só via Emulator (`minhas-financas-local`) ou DEV/STAGING explicitamente autorizado.
- Plano mestre de produção: `docs/production/PRODUCTION_READINESS_PLAN.md`.
- Antes de concluir, executar a skill regression-release-gate.