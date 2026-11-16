# P5-F.1-R3 — evidência (2026-11-09)

**Base.** Etapa corretiva sobre a árvore entregue da R2A (`f82679226ec93e18f906731be09d0675326fd764`; código da R2A `cd95e1cb`; R1 `08d8c5a2`; commit-base `1730a1df`). Implementa o B03 (marcas de aplicação da projeção, prova no cliente, recuperação após reconstrução) e investiga o RR-R2A-04. Plano mestre: §20.18.

**Veredito global:** **PASS** no `regression-release-gate` (rodada 2). O B-01 foi resolvido pela privacidade nas rodadas 3 e 4, nenhum código mudou, e a E-01 é ambiental e está no RR-R3-11. Não publicar; sem commit, push ou deploy.

| Arquivo | Conteúdo |
| --- | --- |
| `DESENHO-MARCAS-B03.md` | O desenho adotado: fatos medidos, invariante INV-M, identidade de versão, dados e escritores da marca, modelo de estados, reconstrução e recuperação, prova no cliente, divergências da proposta da R2A, custos e premissa |
| `matriz-requisitos.md` | Cada requisito do pedido da R3 (§1–§14), com estado e evidência (executado, herdado, reproduzido em revisão, não executado) |
| `testes-e-resultados.md` | Testes novos, alterados e substituídos, execuções dirigidas, `verify:all` e contagens comparadas com a R2A |
| `testes-substituidos.md` e `testes-substituidos-e2e.md` | Cada teste de unidade alterado ou substituído pela regra 5 nova, com o que afirmava e o que afirma; nenhum E2E substituído |
| `mutantes.md` | Mutantes do cliente, do backend (rápidos e no Emulator) e da R2A sobre a árvore da R3, por rodada |
| `rr-r2a-04.md` | RR-R2A-04: linha do tempo, causa, correção, testes, repetições e risco residual |
| `revisoes/` | Pareceres independentes: arquitetura (gatilho × reconstrução × leitura) e as seis especialidades, com as respostas (`revisoes/LEIAME.md`) |
| `sondas/` | Sondas e roteiros reproduzíveis (Emulator ou Node puro) |
| `saidas/` | Saídas das execuções (`.log.txt`: o `.gitignore` do projeto ignora `*.log`). O log completo do `verify:all` está no pacote de auditoria |
