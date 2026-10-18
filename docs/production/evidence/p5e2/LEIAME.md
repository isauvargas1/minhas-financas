# P5-E2 — evidências da remoção definitiva das Mensagens simuladas (D-09, PR-MSG-01)

**Base:** `92e5a9c231d2c9a52f38146dd9b3c8f7fbffe081`, árvore `f21531ca`, PR #3 com CI `success`. Inclui o checkpoint P5-E1.1, o Java 21 e a E2E-FIX-01.

**Worktree:** isolado, branch nova `feat/p5-e2-remove-mock-messages-2026-10-17`.

**Registro no plano:** [§20.13](../../PRODUCTION_READINESS_PLAN.md).

**O que não foi feito:** sem commit, push, merge ou deploy. Firebase só no Emulator `minhas-financas-local`.

| Arquivo | Conteúdo |
| --- | --- |
| [inventario.md](inventario.md) | Diagnóstico na base: os pontos informados conferidos linha a linha, as referências extras encontradas e o que ficou de propósito. |
| [guarda-mutantes.md](guarda-mutantes.md) | A guarda estática reprova a base e mata 5 mutantes que reintroduzem o módulo. Inclui o roteiro reproduzível. |
| [visual/LEIAME.md](visual/LEIAME.md) | Header antes × depois (1440, 390 e 360 px, claro e escuro): controles, ordem do Tab, axe, transbordamento, fechamento por toque ou clique fora, pixel a pixel e ruído da captura. |
| [execucoes.md](execucoes.md) | Comandos, resultados, durações e totais contra o baseline (2.883). |
| [VEREDITOS.md](VEREDITOS.md) | Vereditos das skills (`ptbr-product-ui-review`, `privacy-lgpd-data-lifecycle`, `multi-tenant-security-review`, `regression-release-gate`) e a auditoria do delta. |

Nos roteiros copiados como `.txt`, `<scratchpad>` substitui o diretório temporário da sessão. Nenhum segredo, credencial ou dado real aparece nestes arquivos.
