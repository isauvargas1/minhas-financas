# P5-F.1-R3 — revisões independentes

Cada revisão foi feita por um revisor distinto do executor, com acesso ao código, aos testes e às evidências, e sem as conclusões do executor. Os revisores trabalharam em modo somente leitura e não alteraram o repositório. O Firebase foi usado só no Emulator, e só quando a revisão exigia uma execução (dentro de um lock, para não colidir com outras execuções).

| Revisão | Arquivos | Rodada 1 | Rodada 2 (árvore final de código `377c2f3f`) |
| --- | --- | --- | --- |
| Arquitetura: interação gatilho × reconstrução × leitura (adversarial, com sondas e modelo aleatório usando as funções reais) | `arquitetura/PARECER-ARQUITETURA-R3.md`, `arquitetura/PARECER-ARQUITETURA-R3-RODADA-2.md` | FAIL: A01 HIGH e A02 MEDIUM; A03 LOW; A04 LOW; A05, A06 e A07 INFO | **PASS.** A01, A02, A03, A05 e A06 corrigidos; A04 aceito (RR-R3-01); A07 classificado (RR-R3-02). Poda conferida: modelo com 6 × 20.000 cenários, 756.841 provas verdadeiras, 0 violação. Novos: N01 e N02 (INFO) |
| `financial-domain-integrity` | `financeiro/PARECER.md`, `financeiro/PARECER-RODADA-2.md` | FAIL: F-01 MEDIUM (evidência da árvore final); F-02 a F-06 LOW; F-07 a F-12 INFO | **PASS.** F-01, F-02 e F-12 resolvidos; F-03, F-04, F-05 e F-07 a F-11 aceitos com risco registrado; F-06 resolvido no fechamento (§20.18 no plano). Nenhum achado novo |
| `multi-tenant-security-review` | `seguranca/PARECER.md`, `seguranca/PARECER-RODADA-2.md` | FAIL: M1 MEDIUM (ataques fora da suíte oficial); L1 LOW; I1 a I5 INFO | **PASS.** M1, L1 e I4 resolvidos; I1 a I3 aceitos; I5 resolvido no fechamento. Novos: R2-I1 a R2-I4 (INFO, documentação, tratados) |
| `firestore-scale-cost-review` | `escala-custo/PARECER.md`, `escala-custo/PARECER-RODADA-2.md` | FAIL: M1 MEDIUM (modelo de custo); M2 MEDIUM (teto sem teste versionado); L1 a L4 LOW; I1 a I4 INFO | **PASS.** M1, M2, L1, L4, I2 e I3 corrigidos; I1 e I4 atendidos; L2 e L3 aceitos (RR-R3-09, RR-R3-01). Novos: N1 a N7 (INFO, texto ou processo, tratados) |
| `privacy-lgpd-data-lifecycle` | `privacidade/PARECER.md`, `privacidade/PARECER-RODADA-2.md` | FAIL: M-PRI-01 MEDIUM (inventário e requisito da P8); L-PRI-02 LOW (poda); INFO-01 a INFO-04 | **PASS.** M-PRI-01 e L-PRI-02 resolvidos; INFO em ordem; INFO-03 resolvido no fechamento. Novos: N-PRI-01 e N-PRI-02 (INFO, tratados) |
| `ptbr-product-ui-review` | `ptbr/PARECER.md`, `ptbr/PARECER-RODADA-2.md` | FAIL: M-01 e M-02 MEDIUM; L-01 a L-03 LOW; I-01 a I-05 INFO | **PASS.** M-01, M-02 e L-03 resolvidos; L-01 e L-02 aceitos (RR-R3-10); I-01 a I-05 aceitos. Novo: I-06 (INFO, RR-R3-10) |
| `observability-incident-readiness` e `firebase-production-readiness` (superfície do diff: log novo, DR, `firestore.indexes.json`, `package.json`) | `obs-plataforma/PARECER-OBSERVABILIDADE.md`, `obs-plataforma/PARECER-PLATAFORMA.md`, `obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-2.md` | Observabilidade FAIL: OBS-B1 MEDIUM, só documentação; OBS-L1 a OBS-L3 LOW. Plataforma **PASS** no escopo da R3 | Observabilidade **PASS**: OBS-B1 resolvido (§2.1, A21 e §20.18); OBS-L1 e OBS-L2 aceitos; OBS-L3 resolvido. Plataforma mantida **PASS**. Novos: R2-I1 e R2-I2 (INFO, tratados) |

**Rodada 3 (documentos finais, pedida pelo gate).** A árvore de código continua `377c2f3f`, e a rodada confere só o diff de documentos:
- `privacy-lgpd-data-lifecycle` (B-01 do gate, obrigatória): **PASS**: N-PRI-01 e N-PRI-02 resolvidos; N-PRI-03 e N-PRI-04 INFO (o N-PRI-03 entrou literalmente no RR-R3-08; o N-PRI-04 fica para a P8) (`privacidade/PARECER-RODADA-3.md`);
- `observability-incident-readiness` (L-01): **PASS**, com a plataforma mantida em PASS: R3-L1 LOW, corrigido (A01–A21 no §13); R3-I1 a R3-I4 e PLAT-R3-I1 INFO (R3-I3 e PLAT-R3-I1 corrigidos; R3-I1 e R3-I2 para a P7; R3-I4 sem ação) (`obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-3.md`);
- `firestore-scale-cost-review` (L-01): **FAIL**: R3-M1 MEDIUM, só de documento (o §9 declarava um limite por hora que o código não impõe à liberação por volta da projeção), corrigido no §9 e na §20.18; R3-I1 a R3-I6 INFO (o R3-I5 não pede ação; os outros foram aplicados) (`escala-custo/PARECER-RODADA-3.md`);
- `multi-tenant-security-review` (L-01): **PASS**: 0 HIGH, 0 MEDIUM e 0 LOW; R3-I1 e R3-I2 INFO, aplicados no RR-R3-12 e na condição de implantação, no plano e em `FIREBASE_PRODUCTION.md` (`seguranca/PARECER-RODADA-3.md`).

**Rodada 4 (confirmação das correções da rodada 3).** Ainda só documentos, com o código em `377c2f3f`:
- `firestore-scale-cost-review`, sobre o R3-M1 e os INFO aplicados: **PASS**: o R3-M1 e os INFO aplicados conferem; o R4-L1 (LOW, a frase antiga na matriz) está corrigido, e o R4-I1 (INFO, logs das sondas fora da árvore por causa do `.gitignore`) foi resolvido com os logs em `saidas/` (`escala-custo/PARECER-RODADA-4.md`);
- `privacy-lgpd-data-lifecycle`, porque o §9 do desenho mudou: **PASS**, sem achado novo; o N-PRI-03 está no RR-R3-08, e o N-PRI-04 fica para a P8 (`privacidade/PARECER-RODADA-4.md`);
- `observability-incident-readiness` e `firebase-production-readiness`, porque mudaram a condição de implantação, o RR-R3-09, o RR-R3-11, o `FIREBASE_PRODUCTION.md` e o §13 do `OBSERVABILITY.md`: **PASS** na observabilidade e na plataforma (esta no escopo da R3). O R4-I1 e o R4-I2, INFO, ficam para a P7; o R4-I3 está corrigido no índice das revisões; o PLAT-R4-I1 e o PLAT-R4-I2 não pedem ação (`obs-plataforma/PARECER-OBSERVABILIDADE-RODADA-4.md` e `obs-plataforma/PARECER-PLATAFORMA-RODADA-4.md`).

**`regression-release-gate`.**
- Rodada 1 (`gate/PARECER-RODADA-1.md`): **FAIL**.
  - B-01, só de evidência: a reconferência de privacidade exigida pelo próprio parecer não existia.
  - E-01: falha ambiental da reexecução do E2E, registrada no histórico.
  - L-01 a L-03 LOW e I-01 a I-05 INFO.
- Rodada 2 (`gate/PARECER-RODADA-2.md`): **PASS**. O B-01 foi resolvido pela privacidade nas rodadas 3 e 4, nenhum código mudou, e a E-01 é ambiental e está no RR-R3-11.

**Respostas:**
- `respostas-revisao-arquitetura-1.md`, `respostas-revisao-ptbr-seguranca-1.md` e `respostas-revisao-financeiro-escala-privacidade-1.md`. A rodada 2 de cada revisor conferiu essas respostas na árvore final de código, com o `verify:all` dela.
- `respostas-gate-1.md`, as respostas ao gate (rodada 1).
- `respostas-rodada-3.md`, as respostas à rodada 3;
- `respostas-rodada-4.md`, as respostas à rodada 4.

**Logs dos revisores.** O `.gitignore` ignora diretórios `logs`, então os logs das sondas dos revisores ficam em `<pasta do revisor>/saidas/`, com o mesmo conteúdo (`.log` vira `.log.txt`). Quando um parecer cita `logs/<arquivo>` da própria pasta, o arquivo está em `saidas/`. Os logs do executor citados pelos pareceres (por exemplo, `logs/verify-all-final.log`) estão no pacote, em `logs/` e `logs/execucoes/`.

**Sondas do revisor de arquitetura:**
- Rodam em Node puro, sem Emulator nem rede, sobre pacotes das funções reais.
- Para gerar os pacotes, na raiz da árvore, com cada `build/*-entry.ts.txt` copiado como `build/<nome>-entry.ts` (troque `<raiz da árvore>` pelo caminho): `npx esbuild build/<nome>-entry.ts --bundle --platform=node --format=cjs --outfile=build/<nome>.cjs --external:firebase-admin --external:firebase-functions`.
- Depois: `NODE_PATH=<raiz>/functions/node_modules node <sonda>.cjs`.
- A sonda A01 gerada assim reproduziu byte a byte a saída do revisor na árvore final.
