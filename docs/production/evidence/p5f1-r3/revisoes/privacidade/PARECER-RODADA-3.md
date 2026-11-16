PASS — Privacy/LGPD data lifecycle

Escopo do veredito: o mesmo das rodadas 1 e 2 (`PARECER.md`, `PARECER-RODADA-2.md`), isto é, a superfície da P5-F.1-R3 (marcas de aplicação da projeção, B03) e o que o plano atribui à P5 ou antes e que o diff exercita. Não é o checklist integral, que só vale em release e na P10. A rodada 3 é a reconferência, somente leitura, dos documentos no estado final, pedida pelo gate de regressão (B-01). Isto não é parecer jurídico: a qualificação jurídica continua com o E-09.

O veredito vale para o par **código `377c2f3f` + documentos `ad1660a3`**. As três edições feitas depois da rodada 2 aplicam o N-PRI-01 corretamente e batem com o código. Há dois achados novos, os dois INFO e nenhum bloqueante:
- o requisito da P8 não diz o que fazer quando há uma reconstrução em andamento (N-PRI-03);
- o resíduo de uma preparação abandonada está no RR-R3-08, mas não nos quatro documentos (N-PRI-04).

Nenhum dos dois exige mudar código ou documento nesta etapa.

`S=<scratchpad>`. Esta rodada só escreveu em `$S/p5f1r3/revisoes/privacidade/`:
- este parecer;
- a sonda `sondas/sonda-r3-ordem-p8.cjs` e o log dela;
- `r3-functions-unit.log`, `r3-tsc-sandbox.log` e `r3-reexecucao-sonda-r2.txt`;
- as cópias de trabalho `r3-tmp/` (índice temporário e extração da árvore) e `sandbox-r3/` (cópia compilada), apagadas depois do uso.

Não houve Emulator, recompilação de `WT/functions/lib`, Firebase real, `npm run dev` ou `preview`, leitura de `.env*`, commit, push nem deploy.

---

## Escopo

**Árvores**

| Papel | Hash | Conferência |
| --- | --- | --- |
| Código final | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` | Objeto `tree`. É a árvore do `verify:all` com `exit=0` (20:22:55Z) |
| Documentos final (WT) | `ad1660a336f043c7331e158e9a85efdae17e277b` | Calculada com índice temporário próprio (`read-tree HEAD`, `add -A`, `write-tree`), no início e no fim desta rodada. Fora de `docs/`, `git diff --stat 377c2f3f ad1660a3` sai vazio |
| Documentos da rodada 2 | `3eb6041dea2e791cae0c4eaa2c1ab4bad972cba1` | `PARECER-RODADA-2.md:16` |
| Árvore do gate, rodada 1 | `914f8b69098a1af57f87b7402d3aa48a65880ac2` | Usada só para isolar o que mudou no plano depois do gate |
| `HEAD` do WT | `1730a1df0d3870ff52496933f45cb73a8dacd29b` | Branch `feat/p5-f1-r3-2026-11-09`; a R3 está sem commit |

**O que mudou desde a rodada 2 (`3eb6041d` → `ad1660a3`)**
- São 85 entradas, todas em `docs/`: 13 arquivos modificados e 72 novos. A lista é idêntica a `gate-r1/docs-3eb6041d-para-X.name-status.txt`.
- Nos quatro arquivos da condição da rodada 2:
  - `PRIVACY_LGPD.md` (blob `00a274e0` → `de16a890`): só a linha 153 (§6.4), com a frase "Ordem obrigatória";
  - `DATA_RETENTION_LIFECYCLE.md` (`29658631` → `b622c9a2`): só a linha 104;
  - `DESENHO-MARCAS-B03.md` (`d9529192` → `991e41a8`): §3, linha 37, e §9, linhas 122–143;
  - `DATA_MODEL.md`: **sem mudança**, com o blob `59e2056d` nas duas árvores.
- Regenerei o diff dos quatro arquivos, e ele é idêntico byte a byte a `r3-diff-4-documentos.patch` (66 linhas).
- **Código sem mudança desde a rodada 2.** Os blobs do WT são iguais aos de `377c2f3f`:
  - `projectionMarks.ts` `dc0722b2`;
  - `periods.ts` `a7ae4f81`;
  - `rebuild.ts` `e8f24951`;
  - `triggers/transactions.ts` `92583999`;
  - `firestore.rules` `133b422e`;
  - `firestore.indexes.json` `f4322d86`;
  - `projectionProof.ts` `e9fd481f`, `projectionReads.ts`, `reports/queryKeys.ts` `9a4ebf5e`, `reports/hooks.ts` `be1476d2` e `AuthContext.tsx`.

---

## Conferência linha a linha

As linhas de código são da árvore `377c2f3f`. "Sonda r3" é `sondas/sonda-r3-ordem-p8.cjs`, com as funções compiladas dessa árvore numa cópia própria (seção "Verificação").

| Documento:linha | Frase conferida | Evidência no código | Resultado |
| --- | --- | --- | --- |
| `PRIVACY_LGPD.md:153` | "**Ordem obrigatória:** apagar a marca só depois que o gatilho aplicou todas as entregas do lançamento (marca de entrega `applied` para cada escrita, inclusive a da correção, e cadeia sem pendência)" | <ul><li>A marca de entrega, o estado e a marca de aplicação são lidos na mesma transação (`periods.ts:1313-1314`).</li><li>A marca é regravada inteira, sem merge (`:1405-1406`), no mesmo commit da marca de entrega `applied` (`:1417-1426`).</li><li>Um evento que não casa com o nó vira pendência (`projectionMarks.ts:354`), e a absorção acontece em ordem (`:237-249`).</li><li>Sonda r3: na ordem certa (cenários 3, 5c e 5d), nenhuma impressão antiga; na errada (4a, 4b e 5b, este depois do estado com pendência de 5a), a impressão antiga volta e sobrevive à reconstrução.</li></ul> | **Correto e suficiente** quando não há reconstrução em andamento. Com uma em andamento, ver N-PRI-03 (a). O critério literal é mais estrito que o necessário: ver N-PRI-03 (c) |
| `PRIVACY_LGPD.md:153` | "Uma entrega aplicada depois da exclusão grava de novo a impressão antiga como pendência, e ela sobrevive à reconstrução" | <ul><li>Na geração publicada, sem âncora nem cadeia, a visão é `absent` (`projectionMarks.ts:295-296`), e o evento com `antes = V1` vira pendência (`:354`).</li><li>A varredura só grava `anchors.{posição}`, com merge (`rebuild.ts:1266-1276`).</li><li>A poda só age na regravação seguinte (`periods.ts:1401-1406`).</li><li>Sonda r3, 4a e 4b: V1 em `chains.b.pending.0.b.fp`, antes e depois de R2.</li></ul> | **Correto** para a geração publicada. Com uma preparação em andamento, a impressão antiga também pode voltar como base da cadeia preparada (N-PRI-03 (b)). Isso não muda o requisito |
| `PRIVACY_LGPD.md:153` | "Duas reconstruções seguidas **não** bastam…" | Frase sem mudança. A varredura só regrava a âncora (`rebuild.ts:1266-1276`), e a poda vem do gatilho (`periods.ts:1401-1406`). A sonda da rodada 2, reexecutada (2b e 2c), saiu idêntica | **Correto** |
| `PRIVACY_LGPD.md:153` | "(a reconstrução ancora a versão corrigida; até a publicação, o lançamento sem marca não prova e a estimativa fica em reais)" | <ul><li>Frase sem mudança, reconferida.</li><li>"Não prova": `projectionProof.ts:333`, onde nó não vivo com o lançamento encontrado dá `content`.</li><li>"Ancora a versão corrigida" vale para uma reconstrução nova. A publicação apaga o checkpoint (`rebuild.ts:1637`), a chamada seguinte cria outro com corte novo, e a página lê a versão atual (`:757-768`).</li><li>Não vale para uma reconstrução em andamento retomada: a chamada a retoma (`:404`), segue do cursor (`:1194`) e não relê o lançamento. Sonda r3, 6a: nó `absent` e prova recusada depois da publicação.</li></ul> | **Correto** sem reconstrução em andamento; **incompleto** com uma (N-PRI-03 (a)). A falha é fechada, sem valor errado |
| `DATA_RETENTION_LIFECYCLE.md:104` | "Na correção ou anonimização a pedido do titular: depois que o gatilho aplicou todas as entregas do lançamento, apagar a marca e reconstruir (§6.4)" | <ul><li>É a mesma ordem do §6.4.</li><li>O resto da linha não mudou e continua certo:<ul><li>sem `expiresAt` e sem TTL: as 6 isenções de `firestore.indexes.json` têm `indexes: []` e nenhuma tem `ttl`;</li><li>poda pelo gatilho (`periods.ts:1401-1406`);</li><li>tamanho limitado: 2 posições e até 16 pendências (`projectionMarks.ts:43,45-46`);</li><li>saída com o workspace (P8).</li></ul></li></ul> | **Correto e coerente** com o §6.4 |
| `DESENHO-MARCAS-B03.md:37` (§3) | "…tem o passo de correção e anonimização da P8 (`PRIVACY_LGPD.md` §6.4: depois que o gatilho aplicou todas as entregas do lançamento, apagar a marca e reconstruir)" | Igual ao §6.4 | **Correto.** A enumeração da linha 31, sem mudança, omite a geração preparada (N-PRI-04) |
| `DESENHO-MARCAS-B03.md:122-143` (§9) | O que toca privacidade: "depois de uma publicação, 599 B com a poda (726 B sem ela)"; "Nenhum campo tem índice de campo único: 0 entrada de índice por marca"; "até 50 desconsideradas, pelas Rules da preferência, e janela de até 12 meses" | <ul><li>Log da sonda de escala (`escala-custo/logs/r2-sonda-poda-isencao.log.txt`): 726 B com 3 componentes antes da regravação e 599 B com 2 depois. Isso confere com a poda, que deixa só a âncora e a cadeia da geração vigente.</li><li>`firestore.indexes.json`: os 6 campos isentos e 0 índice composto.</li><li>`firestore.rules:1277-1279`: `excludedIncomeIds` com no máximo 50 ids.</li><li>`firestore.rules:1273`: `historyMonths` em {1, 3, 6, 12}.</li><li>As demais linhas (meses, reconstrução, receitas contínuas) são custo: não mudam dado pessoal, retenção nem público. As leituras a mais são do mesmo membro ativo que já lê.</li></ul> | **Correto**, sem efeito de privacidade novo |
| `DATA_MODEL.md:140` | Sem mudança | Remete a retenção e privacidade ao `DATA_RETENTION_LIFECYCLE.md` e ao `PRIVACY_LGPD.md` §3, linha 26, e não descreve o procedimento da P8. Não contradiz o §6.4 novo | **Coerente** |
| Plano §20.18:5132-5135 ("Privacidade") | "…apagar a marca, só depois que o gatilho aplicou todas as entregas do lançamento, e reconstruir; duas reconstruções não bastam…" | O mesmo do §6.4 | **Coerente** |
| Plano §20.18:5200-5205 (RR-R3-08) | Os cinco itens | <ul><li>Posição superada até a próxima regravação: `periods.ts:1401-1406`.</li><li>`requestHash`: INFO-01.</li><li>`reportFetchStarts`: `queryKeys.ts:93-105`, nunca limpo; a chave em claro vem de `queryKeys.ts:12-18` e de `hooks.ts:58` (`hashKey`).</li><li>PR-RULES-02: decisão da P6.</li><li>Preparação abandonada (N01 da arquitetura): `rebuild.ts:288-289,404`; `periods.ts:1094-1118,1401-1404`; sonda r3, 7a a 7c.</li></ul> | **Correto.** O RR-R3-08 não mudou depois do gate: o diff `914f8b69 → ad1660a3` do plano só tem a linha do gate e os RR-R3-11 a 14. O item da preparação abandonada não aparece nos quatro documentos (N-PRI-04) |

**Tratamento da impressão como dado pseudonimizado:** coerente em todos os documentos.
- **Formato** (`projectionMarks.ts:99-146`): SHA-256 em hexadecimal, sem sal, da serialização canônica com marcação de tipo do documento inteiro do lançamento.
- **Onde fica:** `anchors.{a,b}.fp`, `chains.{a,b}.base`, `chains.{a,b}.node.fp` e `chains.{a,b}.pending[].b.fp/.a.fp` (`:150-192`). Uma cadeia `broken` guarda só o código (`:364-367`).
- **Logs:** o log novo `cash_projection_mark.broken` leva `requestId`, `workspaceId`, `transactionId`, ação e `reason`, e nenhuma impressão nem conteúdo (`triggers/transactions.ts:261-268,307-313`).
- **Rules:**
  - `get` por `isMember`, a mesma condição de leitura de `transactions` (`firestore.rules:42-46,66-68,618-621,818-822`);
  - `list` e escrita negadas;
  - a coleção está em `isBackendOwnedCollection` (`:459`).
- **Classificação nos documentos:** `PRIVACY_LGPD.md:70` (linha 26), `DATA_RETENTION_LIFECYCLE.md:104`, `DATA_MODEL.md:140`, desenho §3 e plano 5132-5135, todos como "dado pseudonimizado".

---

## Estado dos achados anteriores

| ID | Sev. | Estado | Evidência |
| --- | --- | --- | --- |
| N-PRI-01 (rodada 2) | INFO | **Resolvido** | <ul><li>`PRIVACY_LGPD.md:153`, `DATA_RETENTION_LIFECYCLE.md:104`, desenho §3 (linha 37) e plano 5134.</li><li>O texto segue a recomendação: entregas aplicadas, inclusive a da correção, cadeia sem pendência, e só então apagar e reconstruir.</li><li>A sonda r3 confirma o efeito, com os cenários 3 e 5c/5d contra 4a/4b e 5b.</li></ul> |
| N-PRI-02 (rodada 2) | INFO | **Resolvido** | <ul><li>O RR-R3-08 (plano 5203) e a resposta INFO-02 (`respostas-revisao-financeiro-escala-privacidade-1.md:44`) agora dizem que a chave é JSON legível, com uid, workspace e papel, inclusive de uma conta anterior, sem conteúdo financeiro, até recarregar a página.</li><li>Confere com `queryKeys.ts:12-18,93-105`: o mapa nunca é limpo.</li></ul> |
| M-PRI-01, L-PRI-02 (rodada 1) | MEDIUM, LOW | Continuam resolvidos | Linha 26 e `DATA_MODEL.md:140` sem mudança desde `3eb6041d`. Poda igual (`projectionMarks.ts:505-518`; `periods.ts:1401-1406`), com 31/31 na cópia, inclusive "poda (L-PRI-02)" e INV-M com `pruned: 954` |
| INFO-01, INFO-02, INFO-04 | INFO | Como na rodada 2 | — |
| INFO-03 | INFO | **Resolvido** | A §20.18 está no plano (linhas 5086-5235), e a resposta "A §20.18 existe" agora é verdadeira |

**Precisão sobre a rodada 2.** A frase "a poda tira as gerações superadas e abandonadas na regravação seguinte" vale para a preparação abandonada **por recomeço**, isto é, trocada por outra e enviada a `categoryGarbage` (`rebuild.ts:325-356`). Uma preparação deixada sem nova chamada continua em `categoryStaging` e é guardada pela poda (N01 da arquitetura; N-PRI-04).

---

## Achados novos (rodada 3)

**HIGH 0 · MEDIUM 0 · LOW 0 · INFO 2.** Nenhum é bloqueante.

### N-PRI-03 — INFO — O requisito da P8 (§6.4) não trata uma reconstrução em andamento

**(a) Reconstrução em andamento.**
- A chamada de "reconstruir" retoma um checkpoint com menos de 24 h desde o corte (`rebuild.ts:288-289,404`) e segue do cursor (`:1194`).
- Se a varredura já tinha passado pelo lançamento antes da exclusão, ele não é relido. Depois da publicação, fica sem marca e sem prova (sonda r3, 6a). Nenhuma cadeia vira `broken`, então `markRecoveryNeeded` não liga: é o mesmo estado sem sinal do RR-R3-01. É falha fechada, sem valor errado, mas contradiz "a reconstrução ancora a versão corrigida".
- Há também uma janela de privacidade:
  - a página lê os lançamentos fora da transação (`:1196`);
  - a transação da página lê só o checkpoint (`:1249-1250`) e grava a âncora com merge (`:1266-1276`).
- Então uma página que leu a versão anterior **antes** da correção e faz o commit **depois** da exclusão recria a marca com a impressão antiga. Ela fica como âncora da geração que vira vigente e sobrevive à regravação seguinte. Só sai com outra reconstrução publicada seguida de uma regravação (sonda r3, 6b a 6d).
- A janela é estreita (do `query.get()` ao commit de uma página) e só existe com uma reconstrução em andamento durante o procedimento.

**(b) Precisão menor, só explicativa.** Com uma preparação em andamento, a entrega tardia da ordem errada grava a impressão antiga também como **base** da cadeia preparada, com raiz `event` (`projectionMarks.ts:342-351`; sonda r3, 6e), além da pendência na publicada. O requisito, que proíbe essa ordem, não muda.

**(c) Critério literal.** "Marca de entrega `applied` para cada escrita" é mais estrito que o necessário e nem sempre pode ser cumprido:
- as entregas cobertas pelo corte (`covered_by_rebuild`, `periods.ts:1338-1347`) e as exclusões ambíguas (`:1349-1368`) gravam a marca de entrega com esse resultado e não tocam a marca de aplicação;
- uma falha permanente não grava nenhuma das duas (`triggers/transactions.ts:314-343`).

O que importa é não haver entrega do lançamento ainda por vir e a cadeia estar sem pendência. Essa formulação veio da minha própria recomendação da rodada 2.

**Risco residual até a P8:** nenhum. Não existe fluxo de correção a pedido nem de anonimização.

**Recomendação para a P8:** executar o procedimento sem reconstrução em andamento. Esperar a publicação ou o descarte dela e reconstruir com uma chamada nova, cujo corte seja posterior à exclusão. Um checkpoint novo também faz falhar o commit de qualquer página da execução anterior (`sameCheckpoint`, `rebuild.ts:1250`).

**Nada precisa mudar nesta etapa.** Se o executor quiser registrar o achado já, o texto abaixo pode entrar **literalmente** no RR-R3-08, sem nova conferência:

> Requisito da P8 (privacidade, rodada 3, N-PRI-03): o procedimento do §6.4 roda sem reconstrução em andamento, e o passo de reconstrução é uma chamada nova, com corte posterior à exclusão da marca. Uma reconstrução já em andamento é retomada pela chamada (checkpoint com menos de 24 h) e não relê o lançamento já varrido, que fica sem marca e sem prova depois da publicação; e a página dela lida antes da correção, com commit depois da exclusão, grava de novo a âncora da versão anterior. "Todas as entregas aplicadas" quer dizer nenhuma entrega do lançamento ainda por vir: as entregas cobertas pelo corte e as exclusões ambíguas gravam a marca de entrega com esse resultado e não tocam a marca de aplicação, e uma falha permanente não grava nenhuma das duas.

### N-PRI-04 — INFO — A preparação abandonada (RR-R3-08, N01) não está nos quatro documentos

**O comportamento.**
- `pruneMarkDoc` guarda as componentes de `state.categoryStaging.generation` (`periods.ts:1402-1404`), e o gatilho alimenta essa geração a cada entrega posterior ao corte (`:1094-1118`).
- Só uma nova chamada da reconstrução tira essa geração de `categoryStaging`: com checkpoint de menos de 24 h, ela retoma a preparação; com mais, descarta a preparação e começa outra (`rebuild.ts:288-289,404,325-356`).
- Sem essa chamada, a âncora e a base da preparação, com impressões de versões anteriores, ficam enquanto o lançamento existir. Na sonda r3, 7a e 7b, V1b continua em `anchors.a.fp` e `chains.a.base` depois de duas regravações. Na 7c, sai com a chamada nova e a regravação seguinte.

**Os documentos.**
- O RR-R3-08 (plano 5205) descreve e aceita esse resíduo.
- A linha 26, o `DATA_RETENTION_LIFECYCLE.md:104` e o desenho §4 dizem "guarda só as gerações vigente e preparada", o que é verdadeiro, mas não dizem que a preparada pode ficar sem prazo.
- A enumeração do desenho §3 (linha 31) não inclui a geração preparada.

**Severidade.** Não há contradição com o código, e a retenção registrada ("acompanha o lançamento e sai com o workspace") continua verdadeira. O dado é pseudonimizado e lido pelo mesmo público. Por isso é INFO.

**Recomendação.** Não mudar nada agora, porque o resíduo já está aceito no RR-R3-08. Na próxima edição desses documentos, no máximo na P8, acrescentar a âncora e a cadeia da geração preparada, inclusive de uma preparação abandonada, "até a próxima chamada da reconstrução, que a descarta se o checkpoint tiver mais de 24 h". A sugestão da arquitetura (descartar a preparação vencida numa rotina) entra na mesma decisão.

---

## Outros documentos mudados desde `3eb6041d`

Nenhum muda dado pessoal, finalidade, retenção, compartilhamento ou exposição.
- **`respostas-revisao-financeiro-escala-privacidade-1.md:44`** (INFO-02): é de privacidade. Aplica o N-PRI-02 e está correto (ver acima).
- **Plano.** A linha da P5 e o histórico só registram a etapa. Na §20.18, o conteúdo de privacidade (5097, 5132-5135 e 5200-5205) foi conferido acima. As linhas do gate, os RR-R3-11 a 14 e o resto não são de privacidade.
- **`BACKUP_RESTORE_DR.md:123`:** duração da reconstrução e PR-ADMIN-01. A frase sobre as eliminações LGPD depois de T0 (`:120`) não mudou.
- **`FIREBASE_PRODUCTION.md:201`:** as 6 isenções e a ordem de publicação. Confere com `firestore.indexes.json`.
- **`OBSERVABILITY.md:50,277,379`:** o log novo só com ids e códigos (confere com `transactions.ts:307-313`), o A21 e a linha do Caixa.
- **`matriz-requisitos.md`, `revisoes/LEIAME.md`, `testes-e-resultados.md` e `testes-substituidos.md`:** contagens e estado das revisões. A linha da privacidade em `revisoes/LEIAME.md` reproduz corretamente as rodadas 1 e 2. `[[R3-PRIV]]` está pendente deste parecer.
- **`respostas-gate-1.md`:** novo. Diz que os quatro documentos não mudam depois da rodada 3; ver a "Condição de reconferência".
- **Cópias em `revisoes/privacidade/`.** `PARECER.md` e `PARECER-RODADA-2.md` são iguais aos originais, exceto pela troca do caminho do scratchpad por `<scratchpad>` (`copiar-pareceres.sh`). As cinco sondas e os cinco logs são idênticos.
- **Demais pareceres copiados e `arquitetura/mundo.cjs`:** são de outras superfícies, e não os reavaliei.

---

## Inventário (o que mudou desde a rodada 2)

Nada no inventário canônico: a linha 26 e o §9 do `PRIVACY_LGPD.md` estão sem mudança.
- **Impressões e metadados da marca** (linhas A e B da rodada 1): continuam como dado pseudonimizado derivado das linhas 12 e 13. Titular, origem, finalidade (INV-M), base E-09, compartilhamento (membros ativos por `get`; nenhum terceiro novo) e localização (Firestore, já listado) estão sem mudança.
- **Retenção.** Sem mudança, com a precisão do N-PRI-04: a preparada fica até a próxima chamada da reconstrução. Acompanha o lançamento. A poda tira, na regravação seguinte, as gerações que não são a vigente nem a preparada. Ficam:
  - a âncora, a base e as pendências da geração vigente;
  - a âncora e a cadeia da geração preparada, enquanto ela for a preparada;
  - a posição superada, até a próxima regravação;
  - num lançamento apagado (só desenvolvimento), essa posição até a eliminação do workspace.
- **Cliente:** sem mudança desde a rodada 2 (mesmos blobs).

## Direitos do titular

Não há fluxo novo: confirmação, acesso, portabilidade, eliminação e canal ficam na P8 (PR-AUTH-01, PR-PRIV-01). Desde a rodada 2, mudou o seguinte:
- o procedimento de correção e anonimização a pedido num workspace mantido agora tem ordem obrigatória (§6.4);
- a sonda r3 confirma que, nessa ordem e sem reconstrução em andamento, nenhuma impressão da versão anterior sobra (cenários 3 e 5d);
- a condição sobre reconstrução em andamento fica como entrada da P8 (N-PRI-03).

Prazo, registro da solicitação e teste ficam na P8.

## Matriz de evidência

| Seção do checklist | Resultado | Evidência |
| --- | --- | --- |
| 1. Inventário e registro | PASS | Linha 26 sem mudança e coerente com o código; os quatro documentos tratam a impressão como dado pseudonimizado; N-PRI-04 (INFO) é completude de um resíduo já aceito no RR-R3-08 |
| 2. Finalidade, necessidade e minimização | PASS | Poda na mesma escrita, com o conjunto vindo do estado lido na mesma transação (`periods.ts:1313-1314,1401-1406`); 0 índice por marca; log novo sem impressão nem conteúdo; resíduo da preparação abandonada aceito no RR-R3-08 |
| 3. Bases legais, transparência e aceite | PASS (registro) | Finalidade e base E-09 na linha 26. A validação jurídica fica fora do escopo (E-09, P8) |
| 4. Direitos do titular | — | Fora do escopo (PR-AUTH-01, PR-PRIV-01, PR-CR-05, P8). O §6.4 tem a ordem, e o N-PRI-03 é entrada da P8 |
| 5. Eliminação, exclusão e anonimização | PASS (parte do escopo) | §6.4 com a coleção, o requisito e a ordem, conferidos pela sonda r3; `requestHash` registrado; N-PRI-03 (INFO) para a P8 |
| 6. Retenção | PASS | `DATA_RETENTION_LIFECYCLE.md:104` coerente com o §6.4 e o código: sem `expiresAt` nem TTL (`firestore.indexes.json`), poda, tamanho limitado e saída com o workspace |
| 7. Subprocessadores e transferência | PASS | Nenhum terceiro novo; nada mudou |
| 8. Cookies, armazenamento local e trackers | PASS | Cliente sem mudança (mesmos blobs); §9 sem mudança; a descrição de `reportFetchStarts` agora é exata (N-PRI-02) |
| 9. Segurança como obrigação de privacidade | PASS | Rules sem mudança (`firestore.rules:818-822`; blob `133b422e`); `test:rules:projection-marks` 17/17 no `verify:all` da mesma árvore, herdado da rodada 2 |
| 10. Incidentes | — | Fora do escopo (PR-OBS-02, P7); nada novo |
| 11. Testes obrigatórios | PASS (itens do escopo) | Isolamento por Rules 17/17 e logout sem resíduo (`workspace-membership.spec.ts:54`) no `verify:all` de `377c2f3f`; unidade das marcas 31/31 na cópia desta rodada |
| 12. Registro documental | PASS | Os quatro documentos coerentes entre si, com o RR-R3-08 e com o código; §20.18 no plano (INFO-03); cópias dos pareceres fiéis |

## Pendências jurídicas/externas

Sem mudança desde a rodada 1:
- E-09: qualificação da impressão e base legal.
- D-07 e D-18: anonimização, correção e prazos.
- E-08: retenção dos logs.
- E-07 e D-27: dado eliminado em backup.

## Achados bloqueantes

Nenhum. N-PRI-01 e N-PRI-02 estão resolvidos; N-PRI-03 e N-PRI-04 são INFO.

## Fora do escopo desta avaliação

Igual à rodada 2:
- PR-AUTH-01, PR-PRIV-01, PR-CR-05, D-07 e E-09 (P8), agora com o N-PRI-03 como entrada do procedimento de correção e anonimização;
- D-18 (P5/P8, parte financeira);
- PR-AUTH-02 (P9);
- D-26 (P8/P9);
- PR-AI-01 e D-11 (P8);
- PR-OBS-02, PR-BKP-01, E-07, D-27 e E-08 (P7). Observação para a P7/P8: reaplicar, depois de uma restauração, uma correção ou anonimização feita depois de T0 (`BACKUP_RESTORE_DR.md:120`) precisa repetir o procedimento do §6.4, inclusive a ordem;
- PR-RULES-02 e PR-PLAT-03 (P6);
- a decisão do cache em memória do SDK (P6/P8), que inclui `reportFetchStarts`;
- a rotina de descarte da preparação vencida (N01 da arquitetura; N-PRI-04).

## Mudanças previstas depois deste parecer

Nenhuma das mudanças anunciadas exige reconferência, nas condições abaixo:
- **Cópia deste parecer e da sonda r3 para `revisoes/privacidade/`.** Não exige, se for feita por `copiar-pareceres.sh`, que só troca o caminho do scratchpad por `<scratchpad>`. Qualquer outra diferença exige.
- **`[[R3-PRIV]]` em `revisoes/LEIAME.md`, `[[REVISOES-ESTADO]]` em `matriz-requisitos.md` e a linha da privacidade na §20.18.** Não exigem, se reproduzirem o veredito: PASS na rodada 3; N-PRI-01 e N-PRI-02 resolvidos; N-PRI-03 e N-PRI-04 INFO.
- **Depois do gate:** `[[GATE]]`, `[[VEREDITO]]`, a linha do gate, o "Estado" da §20.18, a linha da P5, o histórico e a cópia do parecer do gate. Nada disso é superfície de privacidade.
- **O texto do N-PRI-03 no RR-R3-08,** se entrar literalmente, como acima.

## Condição de reconferência

Este parecer cobre o código `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` e os documentos `ad1660a336f043c7331e158e9a85efdae17e277b`. Exige nova conferência:
- qualquer mudança em `docs/production/PRIVACY_LGPD.md`, `docs/production/DATA_RETENTION_LIFECYCLE.md`, `docs/production/DATA_MODEL.md` ou `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md`;
- qualquer mudança nos trechos de privacidade da §20.18 do plano:
  - o item "Poda" de "Arquitetura implementada";
  - o item "Privacidade" de "Modelo de permissões e contratos de leitura";
  - o RR-R3-08.

  A exceção é o acréscimo literal do texto do N-PRI-03;
- qualquer mudança fora de `docs/`, porque aí a árvore de código deixa de ser `377c2f3f`.

## Verificação

**Executado nesta rodada**
1. **Árvores.**
   - `git cat-file -t` das árvores `377c2f3f`, `ad1660a3` e `3eb6041d`: `tree`.
   - Índices temporários próprios em `r3-tmp/`, apagados depois (`GIT_INDEX_FILE=… git read-tree HEAD`, `add -A` e `write-tree`): `ad1660a3` no início e no fim. O índice real não foi tocado.
   - `git diff --stat 377c2f3f ad1660a3 -- . ':(exclude)docs'`: vazio.
2. **Diffs.**
   - `git diff 3eb6041d ad1660a3` dos quatro arquivos é idêntico (`cmp`) a `r3-diff-4-documentos.patch`.
   - `DATA_MODEL.md` tem o mesmo blob (`59e2056d`) nas duas árvores.
   - `--name-status` dá 85 entradas, todas em `docs/`, iguais à lista do gate.
   - O diff do plano é idêntico a `gate-r1/r3-diff-plano.patch`. O diff do plano `914f8b69 → ad1660a3` só tem a linha do gate e os RR-R3-11 a 14.
3. **Blobs de código.** Os do WT são iguais aos de `377c2f3f`: 6 do backend e das Rules, e 5 do cliente.
4. **Cópia própria em `sandbox-r3/`, apagada depois do uso.**
   - Montagem: `git archive 377c2f3f functions/src functions/package.json functions/tsconfig.json tests/fixtures firestore.indexes.json`, com `functions/node_modules` ligado por link simbólico ao do WT, só para leitura.
   - `tsc -p tsconfig.json`: saída 0 (`r3-tsc-sandbox.log` vazio).
   - O `WT/functions/lib` não foi tocado: o mtime continua 20:04:38Z.
   - Para reproduzir, recrie a cópia com os mesmos comandos.
5. **Unidade na cópia.** `node --test lib/cash/__tests__/projectionMarks.test.js lib/cash/__tests__/dayProjection.test.js`: **31/31**, com 0 fail, skipped e todo. `[INV-M]` dá `pruned: 954` (`r3-functions-unit.log`).
6. **Sonda da rodada 2** reexecutada com a cópia: saída idêntica ao log da rodada 2 (`r3-reexecucao-sonda-r2.txt`).
7. **Sonda r3** (`sondas/sonda-r3-ordem-p8.cjs`, log `sondas/sonda-r3-ordem-p8.log`). Usa o mesmo laço de `periods.ts:1338-1406`, inclusive a saída antecipada da entrega coberta e a poda com o estado, e a âncora com merge de `rebuild.ts:1266-1276`. Resultados:
   - **3, 5c e 5d** (ordem certa): nenhuma impressão antiga; prova verdadeira;
   - **5a** (antes da exclusão, cadeia com pendência): V1 e V1b presentes, como esperado;
   - **4a, 4b e 5b** (ordem errada, ou exclusão com pendência): V1 ou V1b voltam e sobrevivem à reconstrução;
   - **6a** (reconstrução retomada): nenhuma impressão antiga, nó `absent`, prova recusada;
   - **6b a 6d** (janela da página): V1b em `anchors.a.fp`, que sobrevive à regravação seguinte e só sai depois de R3 publicada e da regravação;
   - **6e** (ordem errada com preparação): V1b como base da preparada e como pendência da publicada;
   - **7a a 7c** (preparação abandonada): V1b fica durante as regravações e sai com a chamada nova.
8. **Leitura.**
   - Os quatro documentos no estado final.
   - A §20.18, o `respostas-gate-1.md` e os diffs dos demais documentos.
   - O código citado.
   - O parecer do gate (B-01, L-01) e o N01 da arquitetura.
   - Cópias de `PARECER.md`, `PARECER-RODADA-2.md` e das sondas e logs comparadas com os originais.

**Herdado da rodada 2, não reproduzido** (mesma árvore de código):
- `verify:all` com `exit=0`:
  - `test:rules:projection-marks` 17/17;
  - integração `ok 368` (poda) e `ok 369`;
  - E2E `workspace-membership:54` e `work-time-p5f` 560 e 999.
- Mutantes B13 a B16.

## Hashes

| Objeto | Hash |
| --- | --- |
| Árvore de código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` |
| Árvore de documentos (estado final avaliado) | `ad1660a336f043c7331e158e9a85efdae17e277b` |
| Árvore de documentos da rodada 2 | `3eb6041dea2e791cae0c4eaa2c1ab4bad972cba1` |
| `PRIVACY_LGPD.md` (blob em `ad1660a3`) | `de16a890f320f55c3c91b3512c54c98498970ec9` |
| `DATA_RETENTION_LIFECYCLE.md` (blob) | `b622c9a28b6610ecab26ec3ad7ddf6472459bd8c` |
| `DATA_MODEL.md` (blob) | `59e2056d252a2fe5c1484c56f51c79c5cf914ade` |
| `DESENHO-MARCAS-B03.md` (blob) | `991e41a88e65c23c552955717c78aaa3a13cd762` |
| `PRODUCTION_READINESS_PLAN.md` (blob) | `028b12ef733a62f34fc8671948efeb761c3dfeae` |
| `sondas/sonda-r3-ordem-p8.cjs` (SHA-256) | `bd6c0dcae0f1c1b4fc5b15dc1bf8b4f9509bba544c94b43c574d226b17fbf175` |
| `sondas/sonda-r3-ordem-p8.log` (SHA-256) | `1b82eab282bd598bc6114b7d8f440b4ebcbe51dab4b6a5ae5dbae81094d17b9c` |
