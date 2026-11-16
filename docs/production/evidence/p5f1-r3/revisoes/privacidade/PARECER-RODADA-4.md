PASS — Privacy/LGPD data lifecycle

Escopo do veredito: o mesmo das rodadas 1 a 3, isto é, a superfície da P5-F.1-R3 (marcas de aplicação da projeção, B03) e o que o plano atribui à P5 ou antes e que o diff exercita. Não é o checklist integral, que só vale em release e na P10. A rodada 4 é a conferência, somente leitura, das mudanças de documentos posteriores à rodada 3: o §9 do desenho, alterado pelo R3-M1 de escala, aciona a minha condição. Isto não é parecer jurídico: a qualificação jurídica continua com o E-09.

O veredito vale para o par **código `377c2f3f` + documentos `99817712`**.
- As mudanças do §9 são de custo e não mudam dado pessoal, finalidade, retenção, público nem fluxo.
- O texto do N-PRI-03 entrou **literalmente** no RR-R3-08.
- A condição de implantação nova não tem efeito de privacidade e é coerente com o inventário.

**Nenhum achado novo.**

`S=<scratchpad>`. Esta rodada só escreveu em `$S/p5f1r3/revisoes/privacidade/`:
- este parecer;
- a pasta de trabalho `r4-tmp/` (índice temporário, extrações e diffs), apagada depois do uso.

Não houve cópia compilada, sonda nova, Emulator, Firebase real, `npm run dev` ou `preview`, leitura de `.env*`, commit, push nem deploy. Os scripts `deploy:*` foram só lidos em `package.json`.

---

## Escopo

**Árvores**

| Papel | Hash | Conferência |
| --- | --- | --- |
| Código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` | Sem mudança. Fora de `docs/`, os diffs `377c2f3f → 99817712` e `ad1660a3 → 99817712` saem vazios |
| Documentos, estado avaliado (WT) | `998177124585f0e4ab478f2ddc0d42e421cbcb5f` | Calculada com índice temporário próprio (`read-tree HEAD`, `add -A`, `write-tree`) no início e no fim desta rodada. `HEAD` `1730a1df`; índice real intocado |
| Documentos da rodada 3 | `ad1660a336f043c7331e158e9a85efdae17e277b` | `PARECER-RODADA-3.md` |

**O que mudou (`ad1660a3` → `99817712`):** 17 arquivos, todos em `docs/`.
- **Os três outros documentos da condição não mudaram.** Têm o mesmo blob nas duas árvores:
  - `PRIVACY_LGPD.md` `de16a890`;
  - `DATA_RETENTION_LIFECYCLE.md` `b622c9a2`;
  - `DATA_MODEL.md` `59e2056d`.
- **`DESENHO-MARCAS-B03.md`** (`991e41a8` → `7c4ab334`): só o §9.
  - As linhas 1 a 107 (§1 a §8, inclusive §3 e §4) têm o mesmo SHA-256 nas duas árvores.
  - Mudaram as linhas 125, 129, 143 e 144, e entrou a 130.
- **Plano** (`028b12ef` → `c7b0fe2c`), na §20.18:
  - "Limites" (5111), "Custos", "Condições de implantação" (5148), "Revisões independentes" (5174), RR-R3-08, RR-R3-09, RR-R3-11 e RR-R3-12.
- **Outros:**
  - `FIREBASE_PRODUCTION.md:201` (condição de implantação);
  - `OBSERVABILITY.md` §13 (A01–A21);
  - `testes-e-resultados.md` (texto do RR-R3-11);
  - `revisoes/LEIAME.md`;
  - `respostas-rodada-3.md`, novo;
  - as cópias dos pareceres da rodada 3 de escala, observabilidade, segurança e privacidade, com as sondas e os hashes.

---

## Conferência

| Onde | O que mudou | Conferência | Resultado |
| --- | --- | --- | --- |
| Desenho §9:125 (Reconstrução) | "na página padrão (300)" e "com a página máxima de 500, a queda chega a cerca de 44%; a capacidade absoluta … é a mesma" | Capacidade e custo. Não toca a marca, a impressão, a retenção nem o público. Para o procedimento da P8, a duração só alonga o tempo em que o lançamento corrigido fica sem prova, já coberto por "até a publicação, … a estimativa fica em reais" (§6.4) | Sem efeito de privacidade |
| Desenho §9:129 (receitas contínuas) | "com as bases em passo"; "fora de passo … até cerca de 121/h" | São releituras da prova pelo cliente: o mesmo membro ativo lê os mesmos meses e marcas, num cache em memória limpo no logout (`PRIVACY_LGPD.md` §9, linha 204, sem mudança). Nada é gravado | Sem efeito de privacidade |
| Desenho §9:130 (linha nova: projeção que diverge e volta) | 1 prova por volta, limitada pelas escritas: "120 lançamentos e 120 correções ou anulações a cada 10 min" por membro | <ul><li>Os limites existem e são por ator e workspace: `createTransaction.ts:98-102` e `mutateTransaction.ts:123-127`, os dois com `limit: 120` e `windowSeconds: 10 * 60`.</li><li>Os contadores já estão no inventário: linha 20, `workspaces/{id}/rate_limits`, `expiresAt` de 2 dias.</li><li>A releitura não cria dado, cópia nem destinatário novo.</li><li>Quem observa a mudança do mês já a via pela escuta e pelo relatório.</li></ul> | Sem efeito de privacidade |
| Desenho §9:143-144 (Leitura) | "de cerca de 4 a 7 vezes"; a última frase troca o limite por hora "pelos agendadores" pela distinção entre a releitura pelo agendador e a liberação por volta, "limitada pela frequência de escrita dos membros" | Só custo | Sem efeito de privacidade |
| Desenho §3 e §4 | Sem mudança | As linhas 31, 37 e 52 continuam iguais, e valem as conclusões da rodada 3, inclusive o N-PRI-04 sobre a linha 31 | — |
| Plano, RR-R3-08 (5201-5207) | Ganhou um último subitem (5207) | <ul><li>Comparação por programa das seis linhas anteriores com a versão `ad1660a3`: **iguais**.</li><li>Comparação da linha 5207, sem o marcador de lista, com o texto citado no `PARECER-RODADA-3.md`: **idêntica**.</li></ul> | **Literal.** Não exige nova conferência, como previsto na rodada 3 |
| Plano, "Poda" (5097) e "Privacidade" (5132-5135) | Sem mudança | Comparação por programa com `ad1660a3`: iguais | — |
| Plano, "Limites" (5111) | Primeira gravação `broken` "de cada cadeia (lançamento × geração)" e os seis campos duráveis, inclusive `lastMarkIssueTransactionId` | <ul><li>Confere com `periods.ts:1385-1399` (`recorded` por `g` da posição) e `:1194-1213` (`markIssuePatch`).</li><li>O id do lançamento fica em `cash_period_events/projection_state`, negado ao cliente nos dois sentidos (`firestore.rules:804-806`).</li><li>É um identificador interno, como o `transactionId` dos logs (linha 18). Já estava no código e no `OBSERVABILITY.md` §2.1 da rodada 3.</li></ul> | Sem efeito de privacidade novo |
| Plano, "Revisões independentes" (5174) e `revisoes/LEIAME.md:16,23` | Linha da privacidade com a rodada 3 e o marcador `[[R4-PRIV]]` | Reproduzem o veredito e os achados da rodada 3: PASS; N-PRI-01 e N-PRI-02 resolvidos; N-PRI-03 e N-PRI-04 INFO; o N-PRI-03 no RR-R3-08 e o N-PRI-04 para a P8 | **Correto** |
| Plano, "Condições de implantação" (5148), e `FIREBASE_PRODUCTION.md:201` (§5) | Rules e índices da R3 antes das Functions, ou junto; descrição do efeito de Rules anteriores | Ver a seção seguinte | Sem efeito de privacidade; coerente com o inventário |
| `respostas-rodada-3.md:9-10` | Respostas a N-PRI-03 e N-PRI-04 | <ul><li>N-PRI-03: "entrou literalmente no RR-R3-08". Verdadeiro.</li><li>N-PRI-04: "classificado, para a P8", com o risco residual escrito ("o leitor dos quatro documentos não vê que a preparada pode ficar sem prazo até a próxima chamada da reconstrução"). Segue a minha recomendação: não mudar agora e incluir na próxima edição, no máximo na P8.</li></ul> | **Aceito** |
| Cópias em `revisoes/privacidade/` | `PARECER-RODADA-3.md`, `sondas/sonda-r3-ordem-p8.cjs` e `.log.txt` | <ul><li>O parecer é igual ao original, exceto pela troca do caminho do scratchpad por `<scratchpad>` (comparado com `diff` depois da mesma troca).</li><li>A sonda e o log são idênticos (`cmp`).</li><li>As cópias das rodadas 1 e 2 não mudaram.</li></ul> | **Fiéis** |
| Demais arquivos | `OBSERVABILITY.md` §13, `testes-e-resultados.md` e os pareceres e sondas de escala, observabilidade e segurança | De outras superfícies; não mudam dado pessoal | Fora da minha superfície |

### Condição de implantação: efeito de privacidade e coerência com o inventário

**O que o texto diz.** Com as Functions da R3 sob Rules anteriores, a coleção cairia na regra genérica de subcoleção. Isso daria `get` e `list` sem teto das marcas a qualquer membro ativo do próprio workspace, sem caminho entre tenants e com a escrita negada.

**Conferido nas Rules anteriores** (árvore entregue da R2A `f8267922`, `firestore.rules` blob `9d6b9d77`, e o `HEAD` `1730a1df`):
- `match /{subCollection}/{docId}`, dentro de `match /workspaces/{workspaceId}` (`firestore.rules:1148-1154` nas duas), dá `allow read` a `!isBackendOwnedCollection(subCollection) && canReadWorkspaceScopedData(workspaceId)` e nega a escrita (`allow write: if false`);
- `cash_projection_marks` não aparece em nenhuma das duas (0 ocorrência).

**Os scripts** (só lidos, nunca executados): em `package.json` de `377c2f3f`, `deploy:firestore` publica `firestore:rules,firestore:indexes`, e `deploy:safe` publica `firestore:rules,firestore:indexes,functions`. O texto confere.

**Efeito de privacidade: nenhum além do risco já aceito.**
- O público é o mesmo: `canReadWorkspaceScopedData` é `isMember` nas Rules anteriores e na R3 (`firestore.rules:42-46,66-68`). São os membros ativos com conta ativa que já leem e listam `transactions` (`:618-621`) e leem `activity_logs`.
- Os dados são os mesmos, pseudonimizados.
- Com `list`, muda o modo de acesso: uma consulta sem teto em vez de um `get` por id. Não muda o que esse público consegue saber, porque ele já lista os lançamentos e pode ler a marca de cada um por id. Isso inclui o lançamento apagado (só desenvolvimento), cujo id aparece em `activity_logs`.
- Não há caminho entre tenants nem escrita. O teto e o custo são assunto de segurança e escala.

**Coerência com o inventário.**
- A linha 26 ("`get` por todo membro ativo…; `list`, consulta de grupo e escrita negadas") descreve as Rules da R3. A condição de implantação existe justamente para que isso seja verdade em todo ambiente em que as Functions da R3 rodarem.
- Não há contradição. Uma implantação fora de ordem seria um desvio temporário do "`list` negada", com o mesmo público, e cabe ao CD da P6 impedir isso.
- O inventário não precisa mudar.

---

## Estado dos achados

| ID | Sev. | Estado |
| --- | --- | --- |
| N-PRI-01, N-PRI-02 (rodada 2) | INFO | Resolvidos; sem mudança |
| N-PRI-03 (rodada 3) | INFO | **Registrado**, literalmente, no RR-R3-08 (plano 5207). Continua como entrada da P8 |
| N-PRI-04 (rodada 3) | INFO | **Classificado para a P8** (`respostas-rodada-3.md:10`), com o risco residual escrito. Aceito |
| M-PRI-01, L-PRI-02, INFO-01 a INFO-04 | — | Como na rodada 3 |

## Achados novos (rodada 4)

**HIGH 0 · MEDIUM 0 · LOW 0 · INFO 0.**

## Achados bloqueantes

Nenhum.

## Inventário, direitos do titular, pendências e fora do escopo

Tudo sem mudança desde a rodada 3: o código e os três outros documentos não mudaram, e o §9 só trata de custo.
- **Inventário:** a linha 26, a linha 20 (rate limits) e o §9 do `PRIVACY_LGPD.md` continuam como estão.
- **Direitos do titular:** ficam na P8. O procedimento de correção e anonimização do §6.4 tem agora, no RR-R3-08, a condição sobre reconstrução em andamento (N-PRI-03).
- **Pendências jurídicas e externas:** E-09, D-07, D-18, E-08, E-07 e D-27.
- **Fora do escopo:** a lista da rodada 3.

## Matriz de evidência

A mesma da rodada 3. Nenhuma linha muda de resultado:

| Seção | Resultado |
| --- | --- |
| 1. Inventário e registro | PASS |
| 2. Finalidade, necessidade e minimização | PASS |
| 3. Bases legais, transparência e aceite | PASS (registro) |
| 4. Direitos do titular | — (P8) |
| 5. Eliminação, exclusão e anonimização | PASS (parte do escopo) |
| 6. Retenção | PASS |
| 7. Subprocessadores e transferência | PASS |
| 8. Cookies, armazenamento local e trackers | PASS |
| 9. Segurança como obrigação de privacidade | PASS. A condição de implantação reforça que a linha 26 valha em todo ambiente |
| 10. Incidentes | — (P7) |
| 11. Testes obrigatórios | PASS (itens do escopo) |
| 12. Registro documental | PASS |

## Mudanças previstas depois deste parecer

Nenhuma exige nova conferência, nas condições abaixo:
- **Cópia deste parecer** por `copiar-pareceres.sh`, que só troca o caminho do scratchpad.
- **`[[R4-PRIV]]`** no plano (5174) e em `revisoes/LEIAME.md:23`, e **`[[REVISOES-ESTADO]]`** na matriz. Precisam reproduzir: **PASS** na rodada 4, sem achado novo; N-PRI-03 no RR-R3-08; N-PRI-04 para a P8.
- **Depois do gate:** os marcadores de veredito, a linha da P5 e o histórico.

## Condição de reconferência

Este parecer cobre o código `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` e os documentos `998177124585f0e4ab478f2ddc0d42e421cbcb5f`. Exige nova conferência:
- qualquer mudança em `docs/production/PRIVACY_LGPD.md`, `docs/production/DATA_RETENTION_LIFECYCLE.md`, `docs/production/DATA_MODEL.md` ou `docs/production/evidence/p5f1-r3/DESENHO-MARCAS-B03.md`;
- qualquer mudança nos trechos de privacidade da §20.18:
  - o item "Poda";
  - o item "Privacidade";
  - o RR-R3-08, agora com o subitem do N-PRI-03;
- uma mudança na condição de implantação (plano 5148; `FIREBASE_PRODUCTION.md:201`) que altere a ordem (Rules e índices da R3 antes das Functions, ou junto) ou o público e as permissões descritos;
- qualquer mudança fora de `docs/`.

## Verificação

1. **Árvores.**
   - Índice temporário próprio em `r4-tmp/`: `ad1660a3 → 99817712`, no início e no fim.
   - `git cat-file -t 99817712`: `tree`.
   - `git diff --stat` fora de `docs/` vazio, nas duas comparações.
2. **Blobs** dos quatro arquivos da condição, do plano e do `FIREBASE_PRODUCTION.md` nas duas árvores, com `git rev-parse <árvore>:<caminho>`.
3. **Desenho.**
   - `git diff ad1660a3 99817712` do desenho: só duas partes, as duas no §9.
   - SHA-256 das linhas 1 a 107 igual nas duas árvores.
4. **Plano.**
   - Extração dos itens "Poda", "Privacidade" e RR-R3-08 nas duas árvores e comparação por programa: iguais, e o RR-R3-08 com uma linha a mais.
   - Comparação da linha 5207 com a citação do `PARECER-RODADA-3.md`: idêntica.
5. **Rules anteriores:**
   - `git show f8267922:firestore.rules` e `git show 1730a1df:firestore.rules`: regra genérica em `:1148-1154`;
   - 0 ocorrência de `cash_projection_marks`;
   - `canReadWorkspaceScopedData = isMember`.
6. **Leitura de código** em `377c2f3f`:
   - `package.json` (`deploy:firestore`, `deploy:safe`, `predeploy:rules`), sem executar;
   - `createTransaction.ts:98-102`;
   - `mutateTransaction.ts:123-127`;
   - `firestore.rules:804-806`;
   - `periods.ts:1194-1213,1385-1399`.
7. **Cópias da evidência:** `diff` do `PARECER-RODADA-3.md` depois da troca do caminho, e `cmp` da sonda e do log.
8. **Sem execução nova de testes nem de sondas.** O código é o mesmo da rodada 3, e as mudanças são de texto sem efeito de privacidade. Valem os resultados da rodada 3: unidade 31/31 na cópia, as sondas r2 e r3 e o `verify:all` herdado.

## Hashes

| Objeto | Hash |
| --- | --- |
| Árvore de código | `377c2f3ff3cd1729a819e5be8d89dc06dea7cf93` |
| Árvore de documentos avaliada | `998177124585f0e4ab478f2ddc0d42e421cbcb5f` |
| Árvore de documentos da rodada 3 | `ad1660a336f043c7331e158e9a85efdae17e277b` |
| `PRIVACY_LGPD.md` (blob) | `de16a890f320f55c3c91b3512c54c98498970ec9` |
| `DATA_RETENTION_LIFECYCLE.md` (blob) | `b622c9a28b6610ecab26ec3ad7ddf6472459bd8c` |
| `DATA_MODEL.md` (blob) | `59e2056d252a2fe5c1484c56f51c79c5cf914ade` |
| `DESENHO-MARCAS-B03.md` (blob) | `7c4ab33472135f2936c4c428117382d56330bf20` |
| `PRODUCTION_READINESS_PLAN.md` (blob) | `c7b0fe2c8a28ab2e7638d55f63d2d9f02ed4e12c` |
| `FIREBASE_PRODUCTION.md` (blob) | `9f81074fa3f64f6c913b774831c6e33d6086b3ea` |
| `respostas-rodada-3.md` (blob) | `bba1f4d2aab8027f7d7d9528c03f6bac1288d522` |
| Cópia de `privacidade/PARECER-RODADA-3.md` (blob) | `f355fb5f5c870ef73d4596bcbe7f056d760d221b` |
| `firestore.rules` da R2A, `f8267922` (blob) | `9d6b9d77a25290b19157b85f956e2ce210894ce3` |
