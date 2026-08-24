---
name: regression-release-gate
description: Execute um gate rigoroso de regressão antes de concluir milestone, commit importante, release ou pull request. Use para comparar a mudança com a base Git, validar builds e testes de frontend/Firebase/Functions, detectar enfraquecimento de testes ou contratos e emitir uma decisão final PASS/FAIL com evidências e riscos residuais.
---

# Regression Release Gate

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
