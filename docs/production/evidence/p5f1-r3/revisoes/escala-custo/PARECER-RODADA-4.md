PASS — Firestore scale/cost review

Rodada 4 da revisão independente da P5-F.1-R3, especialidade `firestore-scale-cost-review`: conferência da correção do R3-M1 e dos INFO da rodada 3, só no diff de documentos. Revisão só de leitura, em 2026-11-09, das 22:56 às 23:05 UTC.

**Veredito.**

- O R3-M1 está corrigido com o meu texto literal: a linha nova do §9 e a frase da linha 144 do desenho são idênticas às do parecer da rodada 3, conferidas por programa. A §20.18 tem a mesma ressalva nos custos (`:5144`) e no RR-R3-09 (`:5211`), com a recomendação para a P7.
- R3-I1, R3-I2, R3-I3, R3-I4 e R3-I6 estão aplicados corretamente; o R3-I5 ficou sem ação, como indiquei.
- Nenhuma mudança de outro revisor altera número de custo.
- O código continua `377c2f3f`, então valem as medições da rodada 3 e o `verify:all` da árvore congelada.
- Ficam um LOW e um INFO, nenhum bloqueante:
  - **R4-L1:** a linha 115 de `matriz-requisitos.md` ainda afirma o limite por hora "pelo orçamento dos agendadores", sem a ressalva, e cita o "PASS na rodada 2". Deve ser corrigida na edição já prevista da matriz.
  - **R4-I1:** os logs das minhas sondas estão num diretório que o `.gitignore` ignora.

## Escopo e estado

**Árvores** (índice temporário meu, apagado; sem tocar no índice real):

| Árvore | Hash | Conferência |
| --- | --- | --- |
| Documentos, estado do W | `998177124585f0e4ab478f2ddc0d42e421cbcb5f` | `read-tree HEAD` (`1730a1df`), `add -A` e `write-tree`, às 22:56:54 UTC |
| Código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` | `git diff --quiet --exit-code 377c2f3f 99817712 -- . ':(exclude)docs'` com saída 0, e `--stat` vazio |
| Base do diff | `ad1660a336f043c7331e158e9a85efdae17e277b` | A árvore da minha rodada 3 |

**Diff conferido** (`git diff ad1660a3 99817712`, salvo em `r4-diff-desenho.patch` e `r4-diff-plano.patch`):

- `DESENHO-MARCAS-B03.md`: 5 linhas mais, 4 menos (blob `991e41a8` → `7c4ab334`).
- `PRODUCTION_READINESS_PLAN.md`: 20 mais, 16 menos (`028b12ef` → `c7b0fe2c`).
- Também li os diffs de `FIREBASE_PRODUCTION.md`, `OBSERVABILITY.md`, `testes-e-resultados.md` e `revisoes/LEIAME.md`, e as respostas (`revisoes/respostas-rodada-3.md`).

**Cópias da rodada 3 no pacote:**

- O parecer copiado só troca o caminho absoluto por `<scratchpad>`.
- As duas sondas novas e `hashes-rodada-3.txt` são idênticos aos originais.
- Os sete logs `r3-*` copiados como `.log.txt` têm o mesmo conteúdo dos originais, pelo sha-256 (ver R4-I1).

## Conferência de cada mudança na minha superfície

| Onde | Mudança | Conferido contra | Resultado |
| --- | --- | --- | --- |
| Desenho, linha 125 (R3-I4) | "na página padrão (300)"; "com a página máxima de 500, a queda chega a cerca de 44%; a capacidade absoluta da R3 (516 mil, ou 9,3 h para 200 mil lançamentos) é a mesma nas duas" | **Código:** `rebuild.ts:124` (padrão 300, máximo 500). **Log:** `r3-sonda-orcamento-pagina.log`. Diverso/500: R2A 52 chamadas por 20 mil (cerca de 923 mil em 24 h); R3 93 nas duas páginas (cerca de 516 mil); queda de 44%. Para 200 mil, 930 chamadas, ou 9,3 h | **Confere.** "A mesma nas duas" vale no cenário diverso, a que os números se referem, e também no extremo e no adversário. No concentrado e no típico, a página de 500 dá mais capacidade à R3; para o DR, a frase é conservadora. Sem ação |
| Desenho, linha 129 (R3-I2) | "até 78/h, … com as bases em passo. Fora de passo, cada base pode liberar sozinha: até cerca de 121/h, cerca de 54 mil leituras/h no teto"; fonte "fora de passo: leitura do código, não medida" | **Código:** `basisSync.ts:472-492` e `:583-589`. **Conta:** 35 + 2 × (35 + 8) = 121; 121 × 446 = 53.966 | **Confere.** O rótulo de não medido está certo |
| Desenho, linha 130, nova (R3-M1, item 1) | A linha "Prova, projeção que diverge e volta" | Comparação por programa com o texto do parecer da rodada 3 | **Idêntica.** Valores conferidos na rodada 3: `basisSync.ts:443-446` e `:428`; `incomeReads.ts:21-30`; `createTransaction.ts:98-102`; `mutateTransaction.ts:118-127`; sonda com 20 voltas, 20 provas e 0 releitura de base |
| Desenho, linha 143 (R3-I1) | "de cerca de 4 a 7 vezes … nos casos desta seção; a razão cresce com m e cai com u" | **Razões:** 5,0, 5,5, 4,1 e 6,7 (PJ). A razão é 1 + (3m + 3u + 2)/(u + 2Q): cresce com m e cai com u (por exemplo, 10,4 com m = 12 e u = 3; 4,1 com m = 12 e u = 100) | **Confere** |
| Desenho, linha 144 (R3-M1, item 2) | A última frase da Leitura | Comparação por programa com o texto do parecer | **Idêntica** |
| Desenho, linha 123 (R3-I5) | Sem mudança | — | **Confere com o que indiquei** (contrafactual, sem ação) |
| Plano `:5139` (R3-I3) | "de 373 B a 726 B no caso típico" | **Logs:** 373, 494, 599, 615 e 726 B (`r3-sonda-tamanho-marca`, `r3-sonda-poda-isencao` e `r3-sonda-marca-intocada`) | **Confere** |
| Plano `:5141` (R3-I4) | "na página padrão (300); com a de 500, até cerca de 44%, com a mesma capacidade absoluta" | O mesmo da linha 125 do desenho | **Confere** (a mesma observação, sem ação) |
| Plano `:5142` (R3-I6) | "446 no teto da janela (12 meses e 100 marcas; o código aceita até 13 meses)" | `projectionReads.ts:9`; `estimate.ts:110-124`; `contract.ts:48` | **Confere** |
| Plano `:5143` (R3-I2) | "até 78 releituras por hora com as bases em passo … (fora de passo, até cerca de 121 por hora, por leitura do código)" | O mesmo da linha 129 do desenho | **Confere** |
| Plano `:5144`, novo (R3-M1, item 3) | "Projeção que diverge e volta …: até cerca de 720 voltas por hora por membro que escreve, cerca de 321 mil leituras por hora no teto (R2A: cerca de 78 mil). No uso normal é raro" | **Conta:** 720 × 446 = 321.120; 720 × 108 = 77.760. Limites de escrita citados acima | **Confere** |
| Plano `:5209` (RR-R3-09, R3-I4) | "na página padrão de 300 (L2)" | `rebuild.ts:124` | **Confere** |
| Plano `:5211`, novo (RR-R3-09, R3-M1) | O custo da liberação por volta e a recomendação para a P7 | O mesmo de `:5144` | **Confere** |
| Plano `:5173` (linha desta revisão) | FAIL na rodada 3 pelo R3-M1, a correção e "Rodada 4: [[R4-ESC]]" | Os pareceres das rodadas 3 e 4 | **Confere.** O marcador deve virar "PASS" com este parecer |
| `revisoes/respostas-rodada-3.md:30-40` | As respostas ao R3-M1 e aos INFO | O parecer da rodada 3 | **Confere** com o que pedi, inclusive o risco residual LOW do R3-M1 |

## Mudanças de outros revisores: efeito no custo

Nenhuma altera número de custo.

- **Plano `:5111`, resumo do modelo de estados (observabilidade, R3-I3):** a primeira quebra de cada cadeia continua sendo **uma** escrita `merge` no estado, com os seis campos (`periods.ts:1194-1213`, aplicada em `:1407-1413`). Igual à linha 121 do §9.
- **Plano `:5148` e `FIREBASE_PRODUCTION.md:201`, condição de implantação (segurança, R3-I2):**
  - Coerente com o meu N6: `deploy:firestore` publica Rules e índices (`package.json:38`), e `deploy:safe` publica os dois com as Functions (`:40`). Li os scripts, sem executá-los.
  - Do lado do custo, a condição também evita o `list` sem teto das marcas sob Rules anteriores, que seria uma leitura da coleção inteira por qualquer membro.
- **Plano `:5207`, requisito da P8 (privacidade, N-PRI-03):** não muda número do §9.
  - Cada correção ou anonimização da P8 custa uma reconstrução completa nova, conforme a linha 125 do §9 (cerca de 9,3 h para 200 mil lançamentos no limite de chamadas, no cenário diverso).
  - Pode ser preciso esperar a reconstrução em andamento terminar.
  - A P8 herda esse custo ao implementar o fluxo (informativo).
- **Sem custo Firestore:**
  - plano `:5167`, `:5172-5177`, `:5220`, `:5223` e `:5225-5227` (revisões, RR-R3-11 e RR-R3-12);
  - `OBSERVABILITY.md:471` (A01–A21);
  - `testes-e-resultados.md` e `revisoes/LEIAME.md`.

## Achados

Nenhum bloqueante. Não há HIGH nem MEDIUM.

**R4-L1. LOW, só de documento. `matriz-requisitos.md:115` repete a frase que o R3-M1 corrigiu.**

- **Hoje diz:** "Custo limitado por tentativa (13 meses e 100 marcas, testado) e por hora (orçamento dos agendadores); riscos RR-R3-01 e RR-R3-09. Parecer de escala PASS na rodada 2".
- **O que está errado:**
  - o limite por hora pelos agendadores não vale para a liberação por volta da projeção (linha 130 do §9);
  - o estado da revisão está desatualizado.
- **Por que não bloqueia:**
  - o modelo canônico (§9) e o plano (§20.18) estão certos;
  - a linha remete a eles e ao RR-R3-09, que já tem o caminho;
  - a matriz vai ser editada em seguida (`[[REVISOES-ESTADO]]`).
- **Correção sugerida, na mesma edição:**

  > Custo limitado por tentativa (13 meses e 100 marcas, testado) e por hora: pelo orçamento dos agendadores nas releituras agendadas e pelos limites de escrita do servidor na liberação por volta da projeção (desenho §9; R3-M1); riscos RR-R3-01 e RR-R3-09. Parecer de escala: PASS na rodada 4

- Busquei a mesma afirmação no resto de `docs/production`. As outras ocorrências do "orçamento do agendador" estão certas no contexto:
  - o estado pendente A04 em `respostas-revisao-financeiro-escala-privacidade-1.md:30`;
  - o Dashboard em `rr-r2a-04.md:47`;
  - o teste do motivo passageiro em `testes-substituidos.md:71`.

**R4-I1. INFO. Os logs das minhas sondas não entram na árvore versionada.**

- **Causa:** `.gitignore:2` (`logs`) ignora qualquer diretório com esse nome. As cópias em `revisoes/escala-custo/logs/*.log.txt`, das rodadas 1 a 3, estão em disco, mas nenhuma está na árvore `99817712` (`git ls-tree` vazio; `git check-ignore` aponta `.gitignore:2`).
- **Por que não bloqueia:** as sondas estão versionadas (`revisoes/escala-custo/sondas/`), são determinísticas e reproduzem os números. Os logs são evidência complementar.
- **Sugestão:** mover os logs para fora de um diretório `logs/` (por exemplo, `revisoes/escala-custo/saidas/`), como os outros revisores e o `saidas/` do pacote já fazem (`LEIAME.md:17`). Ou registrar que eles só estão no pacote de auditoria.

## Verificação

Comandos desta rodada. Nada no W foi alterado.

| Comando | Resultado |
| --- | --- |
| Árvore do W com índice temporário | `99817712`, igual à informada |
| `git diff --quiet --exit-code 377c2f3f 99817712 -- . ':(exclude)docs'` | Saída 0. Sem execução nova, a de Emulator continua valendo: `verify:all` da árvore congelada, com `test:integration:emulator` em código 0 e os "tetos do cliente" ok 8 |
| `git diff ad1660a3 99817712` (desenho, plano e demais documentos) | Diff lido inteiro. Os dois textos literais do R3-M1 foram comparados por programa e são idênticos |
| `sha256sum` das cópias da rodada 3 contra os originais | Iguais, salvo a troca do caminho no parecer |
| `git check-ignore -v` e `git ls-tree` dos logs | Ignorados por `.gitignore:2`; nenhum na árvore |
| Busca em `docs/production` pelo limite por hora antigo | A única ocorrência sem a ressalva é `matriz-requisitos.md:115` (R4-L1) |

**Emulator:** não executei, porque não era indispensável. Esta rodada só confere documentos, e o código não mudou.

## Condição de reconferência

**Não exigem reconferência minha:**

- **Mudanças previstas:**
  - a cópia deste parecer por `copiar-pareceres.sh`;
  - o `[[R4-ESC]]` no plano e em `revisoes/LEIAME.md`;
  - o `[[REVISOES-ESTADO]]` da matriz;
  - depois do gate, os marcadores de veredito, a linha da P5 e o histórico.
- **A correção do R4-L1,** com o texto sugerido ou um equivalente que não atribua só aos agendadores o limite por hora. O gate pode conferir.
- **A mudança do R4-I1,** se os logs mudarem de diretório com o mesmo conteúdo (sha-256 em `hashes-rodada-3.txt` e nos originais).

**Exigem reconferência:**

- diferença fora de `docs/` em relação a `377c2f3f`;
- mudança de `firestore.indexes.json`;
- mudança no desenho (§3, §4 ou §9; blob `7c4ab334`);
- mudança nas linhas de custo e risco da §20.18: `:5137-5145`, `:5148`, `:5182-5188` e `:5208-5212`.

## Hashes

Em `<scratchpad>/p5f1r3/revisoes/escala-custo/hashes-rodada-4.txt`:

- as árvores;
- os blobs, antes e depois, do desenho (`7c4ab334`), do plano (`c7b0fe2c`), da matriz (`b1e87d0d`, sem mudança), de `FIREBASE_PRODUCTION.md` (`9f81074f`) e de `OBSERVABILITY.md` (`3156e647`);
- as respostas (`bba1f4d2`) e a cópia do parecer da rodada 3 (`87cc62ab`);
- o sha-256 dos dois diffs salvos.

## Riscos residuais (inalterados desde a rodada 3)

- **R3-M1 (LOW, registrado no RR-R3-09):** a liberação por volta da projeção relê a prova sem orçamento no cliente, até cerca de 720 vezes por hora por membro que escreve, cerca de 321 mil leituras por hora no teto. Recomendação para a P7.
- **L3 / RR-R3-01:** 31 releituras por hora, até cerca de 13,8 mil leituras por hora no teto, até a P7.
- **L2 / RR-R3-09:** a reconstrução de 200 mil lançamentos leva cerca de 9,3 h.
- **N6:** as isenções só valem depois da implantação dos índices.
- **P3:** não está verificado que o `verify` do commit não seja cobrado como escrita.
