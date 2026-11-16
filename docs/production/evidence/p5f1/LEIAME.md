# P5-F.1 — evidências do tempo de trabalho equivalente automático

**Base:** `1730a1df0d3870ff52496933f45cb73a8dacd29b` + patch binário da P5-F (SHA-256 `6b98969d303568196fa113383f38fca83ecbe1f6435ada7482a8a5881858a122`), árvore `455086e0fceaf9dfe32e7bc38c9f384712d4ddc3`, conferidos antes de qualquer alteração.

**Worktree:** isolado, branch local nova `feat/p5-f1-smart-worktime-2026-11-04`.

**Registro no plano:** [§20.15](../../PRODUCTION_READINESS_PLAN.md).

**O que não foi feito:** sem commit, push, merge ou deploy. Nada publicado. Firebase só no Emulator `minhas-financas-local`.

| Arquivo | Conteúdo |
| --- | --- |
| [inventario.md](inventario.md) | O que a P5-F.1 reaproveita da P5-F, a classificação oficial herdada, as mudanças e as decisões D-P5F1-01…08 |
| [contrato-v2.md](contrato-v2.md) | Campos, tipos, gramáticas e limites do documento privado; o que só o cliente confere |
| [calendario-feriados.md](calendario-feriados.md) | Motor de calendário, regras de cada dia, exemplos de horas por mês e fontes dos feriados |
| [elegibilidade-receitas.md](elegibilidade-receitas.md) | Fonte autoritativa da renda, classificação, incertezas, exclusões do usuário, consultas e limites |
| [matriz-calculos.md](matriz-calculos.md) | Fórmula, modos, estados indisponível e provisório, exemplos verificados e arredondamento |
| [autorizacao-isolamento.md](autorizacao-isolamento.md) | Camadas de autorização, cenários das Rules no Emulator, guarda estática e provas do E2E |
| [mutantes.md](mutantes.md) | 184/184 de unidade e guarda (0 não compilam), 11/11 das Rules, 52/52 dos mutantes da P5-F ainda aplicáveis e 8/8 do E2E (o da revisão 4 rodado de novo sobre o código da revisão 5) |
| [execucoes.md](execucoes.md) | Integridade da base, execuções dirigidas, gate completo e contagem contra a base |
| [visual/LEIAME.md](visual/LEIAME.md) | 78 capturas (1440, 390 e 360 px, claro e escuro), axe, teclado, comparação com a rodada anterior e antes × depois |
| [VEREDITOS.md](VEREDITOS.md) | Vereditos das skills e da revisão independente |
| [revisoes/](revisoes/) | Pareceres do revisor independente e as respostas a cada achado |

**Roteiros copiados como `.txt`:** `mutantes.py.txt`, `mutantes-p5f-na-p5f1.py.txt`, `gerar-tabela-mutantes.py.txt`, `escrever-mutantes-md.py.txt`, `run-pw.sh.txt`, `run-pw-tree.sh.txt`, `run-emu.sh.txt`, `run-verify-all.sh.txt`, `resumo-verify.py.txt`, `final-tree.sh.txt`, `comparar-antes-depois.py.txt`, `e2e-mutante.py.txt` (mutantes do E2E, desde a revisão 2), `checar-alvos.py.txt` (confere que cada trecho de mutante existe uma vez), `atualizar-mutantes-r4.py.txt`, `atualizar-mutantes-r5.py.txt`, `atualizar-mutantes-r6.py.txt`, `atualizar-mutantes-r7.py.txt`, `atualizar-mutantes-r8.py.txt`, `atualizar-mutantes-r9.py.txt`, `atualizar-mutantes-r9b.py.txt` e `atualizar-mutantes-r10.py.txt` (os trechos atualizados e os mutantes novos das rodadas das revisões 4 a 10; o `r9b`, da correção da reprovação nas repetições da revisão 9) e `exemplos-r2-10.ts.txt` (exemplos do calendário de `calendario-feriados.md`, rodados no módulo real); os da evidência visual ficam em `visual/`.

Nos roteiros e nos pareceres, `<scratchpad>` substitui o diretório temporário da sessão. Nenhum segredo, credencial ou dado real aparece nestes arquivos. As capturas usam só dados sintéticos e salários fictícios.
