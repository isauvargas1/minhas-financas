# P5-F — evidências do tempo de trabalho equivalente (REQ-FUT-01)

**Base:** `1730a1df0d3870ff52496933f45cb73a8dacd29b` (árvore `3995eb7f`): a P5-E2, branch `feat/p5-e2-remove-mock-messages-2026-10-17`.

**Worktree:** isolado, branch local nova `feat/p5-f-worktime-equivalent-2026-10-18`.

**Registro no plano:** [§20.14](../../PRODUCTION_READINESS_PLAN.md).

**O que não foi feito:** sem commit, push, merge ou deploy. Nada publicado. Firebase só no Emulator `minhas-financas-local`.

> **Evolução na P5-F.1 (2026-11-04, [§20.15](../../PRODUCTION_READINESS_PLAN.md), [`evidence/p5f1/`](../p5f1/LEIAME.md)):** este registro continua sendo o da entrega da P5-F. Na P5-F.1, a renda digitada e a carga mensal (contrato v1, `form.ts`) foram substituídas pela renda automática do relatório oficial e pelas horas de um calendário configurado (contrato v2); a camada de conversão e a matriz de cobertura desta pasta continuam as mesmas.

| Arquivo | Conteúdo |
| --- | --- |
| [matriz-cobertura.md](matriz-cobertura.md) | Classificação de cada ponto monetário, montada antes de codificar e mantida na revisão: T 105, G 18, em BRL 129 |
| [cache-sdk.md](cache-sdk.md) | Sonda no Emulator. O cache em memória do SDK guarda documentos lidos até recarregar a página. O que a P5-F garante e o risco residual |
| [mutantes.md](mutantes.md) | Testes não vazios: 59/59 de unidade e guarda, 15/15 das Rules (2 rodadas) e os mutantes do E2E (varredura e logs) |
| [visual/LEIAME.md](visual/LEIAME.md) | Antes × depois em 1440, 390 e 360 px, claro e escuro: transbordamento, axe, teclado, pixel a pixel, eixos e rodadas de correção |
| [execucoes.md](execucoes.md) | Comandos, resultados, durações e totais contra o baseline: 2.887 → 2.937 testes, com o E2E 191 → 195 |
| [VEREDITOS.md](VEREDITOS.md) | Vereditos das skills e auditoria independente (quatro revisões) |
| [revisoes/](revisoes/) | Os quatro pareceres do revisor independente, com caminhos de sessão substituídos |

**Roteiros copiados como `.txt`:**
- mutantes: `mutantes.py.txt`, `mutantes-guarda-anterior.py.txt`, `mutantes-guarda-r3.py.txt`, `mutantes-guarda-sessao.py.txt`, `mutantes-guarda-r4.py.txt`, `mutante-e2e-r3.py.txt`, `mutante-e2e-logs.py.txt` e `mutantes-rules.py.txt`;
- execução: `run-pw.sh.txt`, `run-emu.sh.txt`, `run-verify-all.sh.txt` e `resumo-verify.py.txt`;
- os de evidência visual ficam em `visual/`.

Nos roteiros e nos pareceres, `<scratchpad>` substitui o diretório temporário da sessão. Nenhum segredo, credencial ou dado real aparece nestes arquivos. As capturas usam só dados sintéticos e uma renda fictícia.
