# P5-F.1-R2A — evidência (2026-11-06)

**Base.** Etapa corretiva sobre a árvore da P5-F.1-R1 (`08d8c5a2f5141f19d06968737c5f7fdc71c4a45f`), pelo parecer independente de 2026-11-06.
- **Frente A (implementada):** o S01 (B02) no motor de calendário e os testes de comportamento do S03.
- **Frente B (só desenho):** a proposta arquitetural do B03. Nenhum escritor financeiro, gatilho, Rule ou índice mudou.
- **Árvore final do código:** `cd95e1cb`. A árvore entregue acrescenta só documentos.

**Veredito global:** **FAIL**, porque o B03 continua aberto. O B02 e o S03 estão resolvidos conforme esta evidência, com três rodadas de revisão independente.

| Arquivo | Conteúdo |
| --- | --- |
| `s01-vespera-reduzida.md` | O S01: modelo, regra, Teorema 3 (a regra é segura), fontes da recusa conservadora, Teorema 2 estendido, conferidor, antes × depois e o dia que abre o período (§9, revisão T01 e T13) |
| `s03-edicao-rotinas.md` | O S03: contrato, extração para o módulo puro, testes de unidade e E2E, antes × depois |
| `matriz-antes-depois.md` | Matriz S01 e S03, R1 × R2A, com a evidência de cada linha |
| `testes-e-resultados.md` | Testes novos e reescritos, execuções (unidade, E2E, mutantes, capturas, `verify:all`), contagens das propriedades, frequência da recusa conservadora e custo do conferidor |
| `mutantes.md` | Mutantes de unidade e de E2E da R2A e a lista da R1 refeita, por rodada e árvore |
| `PROPOSTA-ARQUITETURAL-B03.md` | Frente B: o desenho do B03 (alternativas, recomendação, testes que provam, rollback), com a prova corrigida pela revisão (T02) |
| `revisoes/` | As três rodadas da revisão independente, as respostas, as sondas e os logs do revisor (`revisoes/LEIAME.md`) |
| `sondas/` | Sondas reproduzíveis. Copie para um nome sem o `.txt` e rode `node --experimental-strip-types <sonda>.mts <raiz da árvore>` |
| `saidas/` | Saídas das execuções (`.log.txt`: o `.gitignore` do projeto ignora `*.log` e as pastas `logs`). O log completo do `verify:all` está no ZIP de auditoria |
| `visual/` | Capturas do estado recusado, comparação pixel a pixel com a R1 e os roteiros temporários (`visual/LEIAME.md`) |
