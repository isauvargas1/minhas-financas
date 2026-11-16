# Revisão independente 4 (somente leitura): P5-F.1-R1 depois das correções da revisão 3

**Data:** 2026-11-06 · **Árvore revisada:** `775db1408727aa953645ab6647e3c9a37a227df2` (cópia fixa em `<scratchpad>/p5f1r1/revisao4/arvore-775db140`, chamada aqui de SNAP).

`<scratchpad>` = `<scratchpad>`.

**Comparações:**
- `6c459430` (a árvore da revisão 3): só o que mudou depois dela;
- `d9b33cd1` (a P5-F.1): o delta inteiro da R1, na passada adversarial.

**Modo:**
- Nada foi alterado na SNAP, nas árvores anteriores nem no worktree. Conferi a SNAP no começo e no fim: 2.645 entradas (2.635 arquivos e 10 links simbólicos), 0 divergências. Os únicos extras são os dois links `node_modules` da cópia.
- Do worktree usei objetos Git: `diff`, `diff --check`, `ls-tree`, `rev-parse`, `cat-file` e `grep` numa árvore. No começo houve também um `git log` e um `git status --short`. Os dois só leem, mas o `status` pode atualizar os dados de stat do índice; o conteúdo do índice não muda. Não li nenhum arquivo do disco do worktree.
- Não houve commit, push, rede externa, Firebase, Emulator, Playwright nem `npm run`.
- Rodei com `node` os testes de unidade, na SNAP e em cópias minhas com mutantes. As imagens da evidência visual eu li com o ImageMagick e com scripts Python próprios, sem alterar nada.
- Tudo o que gerei está em `<scratchpad>/p5f1r1/revisao4/` (§8).

## 0. Veredito

| Achado da revisão 3 | Veredito | Resumo |
| --- | --- | --- |
| **P01** (LOW) | **CORRIGIDO** | Os três testes existem, estão certos e passam na SNAP (consistência 30/30).<br>**Mutante de 1 ms da revisão 3:** reprovam o do N03 (`mostrados: loading → 1026000`, o estado misto) e o de 59 s.<br>**`<` no lugar de `<=`:** reprova o de 60 s (tempo esgotado).<br>Cada mutante cai em pelo menos um teste; nenhum teste sozinho mata os dois (§2.1). |
| **P02** (LOW) | **CORRIGIDO** | `VEREDITOS.md:5-8` diz a ordem certa das árvores e das revisões, e `:21` não afirma mais 67/67. O que sobra são marcadores. |
| **P03** (INFO) | **CORRIGIDO** | `DATA_MODEL.md:112` e `matriz-bloqueadores.md:43` têm a ressalva das bases em cache. Resta uma frase anterior que a contradiz (Q04). |
| **P04** (INFO) | **NÃO CORRIGIDO** | `revisoes/logs-revisao-2/` e `revisoes/logs-revisao-3/` não existem na árvore, porque `*.log` está no `.gitignore`. As respostas e o `LEIAME.md` dizem que estão lá (Q01).<br>A nota das duas sondas de gancho e as cópias de `sondas-revisao-3/` estão certas. |
| **P05** (INFO) | **CORRIGIDO** | O parágrafo "Fora do horizonte" (`rotinas-matematica.md:54`) confere com o M09: exemplo de 14/10/2024 e teste do horizonte em `work-time-calendar.test.ts:879-880`. O parágrafo foi inserido no meio de outro (Q04). |
| **P06** (INFO) | **CORRIGIDO** | No passo 6, "Cada perda `δ_d > 0`… compensada pelo ganho `ΔT_{d−1} = δ_d`" e "(§3, Período)", que existe no §3. |

**Recomendação final: FAIL.** Não há defeito no cálculo nem na prova. Os três bloqueadores continuam corrigidos, e o `src/` é o mesmo da revisão 3. O FAIL vem de dois achados LOW:
- **Q01:** o P04 não foi corrigido. Pior: as respostas afirmam evidências na árvore que ela não tem. É a mesma classe do P02.
- **Q02:** com uma configuração ambígua já gravada, Configurações abre como se houvesse alteração não salva:
  - o título é "Prévia com as alterações";
  - aparece "Nada foi salvo ainda.";
  - aparece "Descartar alterações", que não descarta.

  As capturas da própria R1 mostram isso, mas `visual/LEIAME.md` não registra e afirma que nada mudou fora dos avisos, dos textos e dos valores.

Q03 e Q04 são INFO, de evidência e de texto.

**Para virar PASS sem mexer no cálculo:**
1. **Q01:** gravar os logs como `.log.txt` (como as sondas, `.mts.txt`) e ajustar as citações. Ou dizer "no pacote" e fazer o `empacotar.sh` copiá-los de `revisao2/` e `revisao3/`.
2. **Q02:**
   - na tela, marcar edição só quando a mudança vem da pessoa;
   - acrescentar a asserção no E2E "B02 (P5-F.1-R1)";
   - refazer a captura `s3` e as `b02-gravada-previa`, e corrigir `visual/LEIAME.md:62` e `:65`.

   Se o estado for desejado, registrá-lo e fazer "Descartar alterações" funcionar.
3. **Q03 e Q04:** ajustes de texto e uma recaptura.

## 1. Material e integridade

**SNAP × árvore `775db140`:**
- 2.635 arquivos (`git hash-object --stdin-paths`) e 10 links (alvo conferido);
- 0 divergências, no começo e no fim (`revisao4/integridade/`).

**Depois da revisão 3** (`diff 6c459430 775db140`, 132 arquivos):
- fora de `docs/`, só `tests/unit/work-time-consistency.test.ts` mudou: +43 linhas, só acréscimos;
- `git diff --check` não acusa nada;
- as subárvores são idênticas nas duas árvores: `src` (`130bf285…`), `functions` (`61c56abe…`), `e2e` (`5baca57f…`) e `firestore.rules` (`9d6b9d77…`). Os 19 arquivos de `src/` da §8 da revisão 3 são os mesmos.

**Unidade na SNAP** (os 15 arquivos de `test:unit:work-time` e `test:unit:reports`): **258/258 PASS**, 0 fail, 0 skip, 0 todo, em 20 s.

| Arquivo | Testes |
| --- | --- |
| cálculo | 15 |
| preferência | 13 |
| guarda | 17 |
| calendário | 29 |
| gramática | 5 |
| estimativa | 23 |
| retenção | 21 |
| consistência | 30 |
| paginação | 5 |
| relatórios | 100 |

São os números de `execucoes.md`, com a consistência de 27 para 30.

**Bases das rodadas da equipe:**
- `mutantes-r1-rev3.sha-antes` confere com a SNAP: 407 OK. SHA e `git status` são iguais antes e depois.
- `mutantes-r1-rev2`, `e2e-mutantes-rev2b`, `visual-r1-final` e `visual-r1-capturas2` diferem da SNAP só em `work-time-consistency.test.ts`: rodaram antes dos testes de P01, com o mesmo `src/` e o mesmo `e2e/`. Nas quatro, SHA e `status` são iguais antes e depois.
- **Incidente:** o `incomeBasis.ts` da SNAP tem SHA-256 `fab816fc…`, o valor que `incidente-reinicio-conteiner.log` registra.

**Cópia "antes" da evidência visual** (`p5f1r1/antes-visual/arvore-d9b33cd1`): os 314 arquivos de `src/`, `e2e/` e da configuração de build conferem com a `d9b33cd1` (0 divergências).

**Cópias na árvore:** `revisoes/revisao-3.md` e as 10 sondas de `sondas-revisao-3/` são cópias fiéis dos originais, com o caminho trocado por `<scratchpad>`.

## 2. Achados da revisão 3 (P01–P06)

### 2.1 P01: os três testes do limite

**O que verifiquei no código** (`work-time-consistency.test.ts:713-754`):
- **Testes:** `serverClock = true` e `pendingWaitMs: 60_000`. A escrita sai na hora 106, depois de `stamp`, e a base sai na hora `106 + s`.
- **Limiar:** `useIncomeEstimateWith.ts:360` encerra a espera quando `106000 ≤ (106 + s)·1000 − 60000`. Com `s = 59`, isso é falso; com `s = 60`, é verdadeiro.
- **Relógio da montagem:** é o real (o mundo de teste não injeta um), com espera de 60 s. Ele não interfere em `until` de 3 s nem em `settle` de 400 ms.
- **Produção:** `ESTIMATE_PENDING_WAIT_MS = 30_000` é fixado pela guarda (`work-time-guard.test.ts:431`), e nenhum caminho de produção passa `pendingWaitMs`.

**Rodadas** (cópias minhas: `src/` mutado e os `tests/` da SNAP; logs em `revisao4/logs/`):

| Árvore | N03 com a hora do servidor (5 s) | 59 s | 60 s | Consistência |
| --- | --- | --- | --- | --- |
| SNAP | ok | ok | ok | **30/30** |
| Mutante de 1 ms da revisão 3 (`serverNowMs - 1`, arquivo de `revisao3/mut-m02-limiar-1ms`) | **not ok 22**: `antes do gatilho, nenhuma estimativa (mostrados: loading → 1026000)` | **not ok 23**: `59 s: a espera ainda vale (mostrados: loading → 1056000)` | ok | 28/30 |
| `<` no lugar de `<=` | ok | ok | **not ok 24**: `tempo esgotado: 60 s: a espera terminou pela hora do servidor (mostrados: loading)` | 29/30 |
| Limiar fixo de 30 s (`ESTIMATE_PENDING_WAIT_MS` no lugar de `waitMs`; mutante meu) | ok | **not ok 23** | ok | 29/30 |
| `src/` da `d7dabb10` (cópia conferida: 264 arquivos, 0 divergências) | ok | ok | **not ok 24** (e o M02, not ok 21) | 28/30 |

**Resultado:**
- Os três testes reprovam os dois mutantes pedidos e passam na SNAP. Também reprovam o que confunde a espera injetada com os 30 s fixos.
- A `d7dabb10` se comporta como as respostas dizem: só o caso de 60 s reprova.

**Mutantes e log da equipe:**
- U74 e U75 em `mutantes-r1.py` são as entradas 74 (linha 109, `serverNowMs - 1`) e 75 (linha 110, `<`).
- O log `mutantes-r1-rev3.log` dá `5/5 mortos`.

**Resolução do teste:** o relógio do mundo de teste anda em segundos inteiros. Por isso, um limiar até 999 ms mais cedo passaria, o que não pesa diante de 30 s.

**Observações de texto (Q04):**
- U74 não é morto "pelos três testes novos": o de 60 s passa com ele.
- U75 é morto só pelo de 60 s.

### 2.2 P02 a P06

| Achado | Evidência |
| --- | --- |
| **P02** | `VEREDITOS.md:5-8`: d7dabb10 pela revisão 2; as correções da revisão 2 (4 de `src/`, 4 testes e o E2E) pela revisão 3 na 6c459430; as da revisão 3 pela revisão 4 (marcadores). `:21`: `{{MUTANTES_UNIDADE}}` (75/75 em `mutantes.md`).<br>As afirmações "fora da superfície" (`:37-41`) conferem com o delta: nenhum diff em `firebase.json`, `.firebaserc`, Rules ou índices; em `functions/`, só dois testes; em `src/`, nenhuma escrita, callable ou log novo. |
| **P03** | `DATA_MODEL.md:112` e `matriz-bloqueadores.md:43` têm a frase pedida. Confere com o código: `serverNowMs` vem das bases em uso (`useIncomeEstimateWith.ts:348-353`), e senão vale o relógio da montagem (`:367-380`).<br>Resta, em `DATA_MODEL.md:112`, "segura a prova por até 30 s depois da escrita", que a frase nova contradiz (Q04). |
| **P04** | **Não corrigido** (Q01).<br>`sondas-revisao-3/` (10 arquivos) está certo. `revisoes/LEIAME.md:18` documenta a troca da linha 6 das duas sondas de gancho; conferi as duas linhas 6 e a cópia já corrigida em `sondas-revisao-3/rev2-b03-gancho-rev1.mts.txt:6`.<br>A instrução geral (`LEIAME.md:16`) não roda como está (Q04). |
| **P05** | O exemplo é o do M09 (`revisao-2.md:173`).<br>"Nenhuma estimativa usa esse mês" confere com o conferidor (12 meses antes do mês de hoje).<br>O teste do horizonte existe: `calendarAmbiguity(dayOff, '2027-11-05') === null`. |
| **P06** | `rotinas-matematica.md:117`, como pedido. A conferência algébrica da revisão 3 (§3.1) continua valendo, porque só o texto mudou. |

## 3. Evidência visual (`docs/production/evidence/p5f1-r1/visual/`)

**Capturas (`capturas/`):**
- São 32 PNG (16 páginas e 16 recortes) e 16 JSON. A tabela de `LEIAME.md:34-51` confere com os JSON, linha a linha: viewport, tema e fundo, axe 0, transbordamento 0, `role` e foco depois da ação.
- `visual-r1-capturas2.log`: `12 passed`, com SHA e `status` iguais.
- A 1ª rodada (`visual-r1-capturas`) teve 6 falhas, todas em `openWorkTimeSettings`, na largura móvel, como diz o texto.
- Os textos dos JSON estão em pt-BR.

**Antes × depois:**
- Os números de `comparacao-antes-depois.json` conferem com o meu `compare -metric AE`: 4, 0, 0, 2, 0, 0, 806, 1.652, 1.648, 6.644 e 41.027.
- Os fatos dos JSON conferem com o `LEIAME.md`: avisos, salvar, prévia R$ 25,00, R$ 123,08 → R$ 117,95, e 8 → 0 valores convertidos.
- **s2, a explicação da prévia:** a prévia é de agosto a outubro de 2026, e a folga de novembro não entra nela. As horas vão de 149 h 30 min para 156 h, a razão de 12 h para 11 h 30 min por semana. É a união dos turnos (B02).

**Alinhamento linha a linha das páginas inteiras** (`revisao4/sondas/alinhar.py`; saídas `logs/alinhar-*.json`):

| Estado | O que muda, alinhado | Resíduo fora disso |
| --- | --- | --- |
| `s0` | **+32 linhas na ajuda das rotinas.** São duas linhas de texto, e não uma (Q03). | **84 px** (`delta.py`):<br>• 46 px no interruptor "Trabalho normalmente em feriados", com delta até 37/255;<br>• 10 px nos cantos do seletor de UF, com delta 1;<br>• 4 px no calendário, com delta 1;<br>• 21 + 1 + 2 px em cantos arredondados, com delta ≤ 8.<br>Nada de layout. |
| `s1` | +64 (aviso do editor) e +32 (ajuda); salvar de habilitado para desabilitado | 11 px, delta ≤ 4 |
| `s2` | **Coluna da direita:** valores da prévia, o aviso junto do salvar e o salvar desabilitado.<br>**Calendário:** o título ("horas sem cálculo seguro"), as segundas (5h30 → 6h) e o "?" em 09/11.<br>**Ajuda:** +32. | Delta 1 |
| `s3` | **Página:** o aviso do topo (indisponível), o aviso do editor (+64), a ajuda (+32), o calendário com "?" nos dias úteis e a prévia indisponível.<br>**Coluna da direita, além disso** (Q02):<br>• título "Prévia com as alterações";<br>• "Nada foi salvo ainda." (+32 linhas);<br>• o botão "Descartar alterações" (+62 linhas). | Delta 1 |
| `s4` | Valores em reais e o texto do aviso. As linhas de "Transações recentes" quebram em duas porque os valores ficaram mais largos. | — |

**Conclusão (item 3 do pedido):**
- Em s0, s1, s2 e s4, a comparação sustenta que, fora dos avisos, dos textos e dos valores de B02 e B03, nada mudou. O que sobra é ruído de antisserrilhado.
- Em **s3**, não sustenta. A tela entra no estado de edição sem edição nenhuma, e o `LEIAME.md` não registra isso (Q02).
- Também há afirmações imprecisas sobre os 84 px e as capturas móveis do Dashboard (Q03).

## 4. Documentos (item 4 do pedido)

| Documento | Resultado |
| --- | --- |
| `mutantes.md` | **Confere:** 73/73 (`mutantes-r1-rev2.log`, 940 s), 5/5 (`mutantes-r1-rev3.log`), total 75/75, E2E 3/3 (`e2e-mutantes-rev2b`) e o incidente.<br>**Imprecisão (`:28`):** "morto pelos três testes novos" (Q04). |
| `execucoes.md` | **Conferem:**<br>• o `verify:all` pré-revisão 2 (3.045 s; 1.665 + 1.256 testes; 209 E2E; lint com 0 erros e 205 avisos);<br>• as contagens por suíte;<br>• o visual: 6/12, depois 12/12, 4/4 e 4/4, e a troca do Pillow pelo ImageMagick;<br>• o incidente;<br>• 30/30 e 5/5.<br>**Imprecisões (Q04):** os horários. **Afirmação sem apoio (Q03):** "um artefato da captura da P5-F.1" (`:91`). **Omissão (Q02):** o estado de edição em s3 (`:91`). |
| `revisoes/LEIAME.md` | **Diz que `logs-revisao-2/` e `logs-revisao-3/` estão na árvore** (`:12-13`, `:18`), e eles não estão (Q01). A instrução de execução está incompleta (Q04). |
| `respostas-revisao-3.md` | **P01:** confere, mas cita `logs-revisao-3/…`, que não existe (`:23`).<br>**P03:** a mesma citação inexistente (`:35`).<br>**P04:** "Na árvore", falso (`:41`).<br>**P02, P05 e P06:** conferem.<br>**"O código de `src/` é o mesmo":** confere. |
| `rotinas-matematica.md` §2 e §4 | **Conteúdo certo.** O parágrafo do P05 foi emendado ao meio do parágrafo de `validateDraft` (Q04). |
| `DATA_MODEL.md` | A ressalva do P03 está certa, mas a frase de antes (Q04) a contradiz. |
| `matriz-bloqueadores.md` | Confere. |
| `VEREDITOS.md` | Confere, além dos marcadores. |

## 5. Achados novos

### Q01 — LOW — os logs que as respostas dizem estar "na árvore" não estão nela: o P04 continua aberto

**Onde as respostas e o `LEIAME.md` citam os logs:**
- `respostas-revisao-3.md:23`: `logs-revisao-3/r3-espera-servidor.*.log`;
- `respostas-revisao-3.md:35`: `logs-revisao-3/r3-remonta-cache.log`;
- `respostas-revisao-3.md:41`: "Na árvore: `revisoes/logs-revisao-2/` … e `revisoes/logs-revisao-3/`";
- `revisoes/LEIAME.md:12-13` e `:18`: `logs-revisao-3/rev1-b03-gancho-r3.log`.

**A causa:** `.gitignore:3`, `*.log`.

**Reprodução:**
- `git ls-tree -r --name-only 775db140 | grep -c '\.log$'` → `0`.
- `git ls-tree 775db140:docs/production/evidence/p5f1-r1/revisoes` só lista `LEIAME.md`, as revisões, as respostas e `sondas-revisao-1/2/3`.
- `git check-ignore --no-index -v docs/production/evidence/p5f1-r1/revisoes/logs-revisao-3/r3-remonta-cache.log` → `.gitignore:3:*.log` (`revisao4/gi-test/`).
- A extração da própria equipe (`p5f1r1/dirigidos-775db140`) também não tem os diretórios.

**Efeito:**
- Um auditor da árvore, do patch ou de `fonte/` não acha os logs que provam o P01, o P03 e as respostas da revisão 2. É o que o P04 pedia, agora com a afirmação contrária no texto.
- Se os logs existirem no disco do worktree, o `empacotar.sh:54` (`cp -r` do disco) os levaria a `evidencias/`. Nesse caso, a pasta divergiria da árvore, de `fonte/` e dos patches. Não conferi, porque o pedido proíbe ler o disco do worktree.

**Correção mínima:**
- gravar os logs como `logs-revisao-2/*.log.txt` e `logs-revisao-3/*.log.txt` e ajustar as cinco citações;
- ou trocar "na árvore" por "no pacote", com o `empacotar.sh` copiando de `p5f1r1/revisao2/` e `revisao3/` e o `LEIAME.md` dizendo isso.

### Q02 — LOW — uma configuração ambígua já gravada abre Configurações como "editada": título, aviso de não salvo e um "Descartar alterações" que não descarta

**Onde:**
- `src/components/workTime/RoutineEditor.tsx:174-188`: na montagem, o resultado com a ambiguidade (`{ ok: false, message }`) é emitido para as rotinas gravadas.
- `src/components/WorkTimeSettingsView.tsx:393-399`: `else if (!result.ok) { … setIsDirty(true); }`. O trecho vem da P5-F.1, quando um resultado `ok: false` só podia vir de digitação inválida da pessoa.
- Em seguida:
  - `:441`: o título "Prévia com as alterações";
  - `:442-449`: "Nada foi salvo ainda.";
  - `:464-468`: "Descartar alterações".

**Reprodução (evidência da própria R1):**
- `visual/depois/s3-gravada-configuracoes.png` × `visual/antes/s3-gravada-configuracoes.png`, coluna da direita (recorte lado a lado em `revisao4/visual-crops/s3-dir-lado.png`):
  - P5-F.1: "VALOR ESTIMADO DA SUA HORA", sem a nota e sem "Descartar";
  - R1: "PRÉVIA COM AS ALTERAÇÕES", "Nada foi salvo ainda." e "Descartar alterações".
- O alinhamento de `s3-gravada-configuracoes-salvar` dá +32 e +62 linhas nesses dois elementos.
- As 4 capturas `capturas/*-b02-gravada-previa.png` mostram o mesmo.
- O roteiro só semeia a preferência e abre Configurações: não há nenhuma edição.

**"Descartar alterações" não descarta (análise do código):**
1. `discard()` (`:225-231`) zera `isDirty` e incrementa `resetNonce`.
2. A chave do `RoutineEditor` (`:392`) muda, e ele monta de novo.
3. O efeito (`RoutineEditor.tsx:186-188`) emite `ok: false` outra vez, e `setIsDirty(true)` volta.

O botão continua lá. Enquanto `isDirty`, o rascunho também deixa de seguir a preferência salva (`:112-130`). Uma correção feita em outro aparelho aparece como "A configuração foi alterada em outra aba ou dispositivo…", em vez de entrar na tela.

**Alcance:**
- É o cenário que o próprio E2E cobre (`e2e/work-time-p5f.spec.ts:1350-1359`: "por exemplo, antes desta correção, em outro dispositivo"), mas ele não confere título, nota nem botão.
- Salvar continua bloqueado, e não há número errado.
- O efeito é um estado de interface falso, em pt-BR enganoso ("Nada foi salvo ainda."), e um botão inútil. É mudança de interface além do necessário (CLAUDE.md, Interface).
- Não está em `visual/LEIAME.md:25`, `:62` e `:65` nem em `execucoes.md:91`. As duas afirmam que, fora dos avisos, dos textos e dos valores, nada mudou.

**Correção mínima:**
- marcar edição só por mudança feita pela pessoa: o `RoutineEditor` informa `edited` no resultado (modelos alterados desde a montagem), e a tela usa `else if (!result.ok && result.edited)`;
- no E2E "B02 (P5-F.1-R1)", depois do `reload`: título "Valor estimado da sua hora", `work-time-unsaved` com contagem 0 e nenhum "Descartar alterações";
- refazer `s3` e `b02-gravada-previa` e ajustar o `LEIAME.md`.

### Q03 — INFO — evidência visual: capturas móveis do Dashboard encobertas e explicações imprecisas

**(a) As capturas móveis do Dashboard não mostram o aviso.**
- **Arquivos:** `capturas/mobile-{light,dark}-b02-gravada-dashboard.png` e os `-aviso.png`.
- **O que mostram:** o menu lateral aberto, cobrindo o painel e o aviso. O recorte do aviso mostra "Cartões de Crédito" e "Metas" por cima de "…ndisponível … eais. Veja o".
- **Causa:**
  - `openDashboard` clica no menu em 1440 px, com o mouse sobre ele, e `Sidebar.tsx:172` expande o menu no hover;
  - `r1Capture` (`capturas-r1.append.ts.txt:21-29`) troca para 390 px sem tirar o mouse;
  - `toBeVisible` não detecta oclusão.
- **O que continua valendo:** os JSON (texto, axe no escopo e transbordamento). As imagens, porém, não mostram o estado que `LEIAME.md:26` descreve.
- **Correção:** mover o mouse para fora (ou fechar o menu) antes de `setViewportSize` e capturar de novo.

**(b) `LEIAME.md:59` e `execucoes.md:91`: a explicação dos 84 px está errada.**
- **O que dizem:** que parte dos 84 px é "o texto de um seletor sobreposto na captura de página inteira da P5-F.1".
- **O que medi:** não há texto sobreposto. `recortes/s0-antes-faixa1.png` e `s0-depois-faixa1.png` são iguais à vista e estão na mesma posição alinhada (240, 3510) e (240, 3542). A "sobreposição" só aparece no empilhamento `s0-faixa1-antes-sobre-depois.png`, sem separador.
- **De onde vêm os 84 px:**
  - 46 px do interruptor "Trabalho normalmente em feriados", que em s1 não difere;
  - 10 px dos cantos do seletor de UF, com delta 1;
  - o resto, cantos arredondados.
- A conclusão (sem mudança ali) vale; a explicação, não.

**(c) "A frase de ajuda das rotinas ganhou uma linha"** (`LEIAME.md:59`; "a linha nova", `execucoes.md:91`): são duas linhas em 1440 px (2 × 16 = 32 px). A R1 acrescentou uma frase.

**(d) s1:** o calendário tem 2 px diferentes (um ponto de 1 × 2, delta 1), omitidos na linha s1 (`LEIAME.md:60`). É ruído, como os 4 px de s0.

### Q04 — INFO — imprecisões de texto

| Onde | O que diz | Fato | Correção |
| --- | --- | --- | --- |
| `mutantes.md:28` | U74 "é morto pelos três testes novos do limite" | U74 é morto pelo do N03 e pelo de 59 s; o de 60 s passa com ele e mata U75 (§2.1) | "pelos testes do N03 com a hora do servidor e de 59 s; U75, pelo de 60 s" |
| `execucoes.md:8` | "Horários em UTC, 2026-11-05" | as linhas das revisões 2 e 3 em diante são de 2026-11-06 | "2026-11-05 e 2026-11-06" |
| `execucoes.md:85` | "U1 a U73, 00:30–00:46" | `mutantes-r1-rev2.sha-antes` às 00:27:40 e `.log`/`.sha-depois` às 00:43:20 UTC; são os 940 s | "00:27–00:43" |
| `rotinas-matematica.md:54` | o parágrafo "Fora do horizonte" termina com "A propriedade de solidez confere 220 amostras…" e a lista seguinte | a frase e a lista eram a continuação do parágrafo de `validateDraft` | separar o parágrafo novo |
| `DATA_MODEL.md:112` | "segura a prova por até 30 s depois da escrita", e logo depois "com bases em cache geradas antes disso, conta no relógio de cada montagem" | a segunda frase (certa) desmente a primeira | "por até 30 s" na primeira (resíduo do P03; o mesmo em `consistencia-estimativa.md:101`) |
| `revisoes/LEIAME.md:16` | "Rode as sondas com `node --experimental-strip-types … <sonda> <raiz>`" | um `.mts.txt` não roda assim (`SyntaxError`: sem a extensão `.mts`, não há remoção de tipos; prova em `revisao4/sondas/ext/`). Os `.test.ts.txt` importam `../../src/…` e precisam ir para `tests/unit/` de uma cópia, com `--test` | dizer que é preciso tirar o `.txt` e onde pôr as sondas de teste |

## 6. Passada adversarial no delta inteiro (item 5)

Sem repetir as revisões 1 a 3, olhei:
- **O que a interface faz com o resultado novo do `RoutineEditor`** (Q02). No assistente (`WorkTimeWizard.tsx:153-157`), o resultado `ok: false` só bloqueia a etapa, sem efeito colateral.
- **`basisRegistry.ts`:**
  - chaves por `uid|workspace` (`syncKeyOf`), sem mistura entre contas na mesma aba;
  - mapas limitados pelo número de chaves e meses (`PROJECTION_VERSIONS_KEPT = 4`);
  - `clearBasisRegistry` só nos testes, sem efeito no isolamento.
- **A espera pela hora do servidor com duas bases (`Math.max`).** A expiração sem a escrita na base mais nova só acontece no limite (a), e a regra 3 continua exigindo as bases iguais à projeção. Não há classe nova.
- **"Fora da superfície"** (`VEREDITOS.md:37-41`), contra o delta inteiro:
  - nenhum diff em `firebase.json`, `.firebaserc`, `firestore.rules`, índices ou `functions/src` fora de dois testes;
  - `package.json` só acrescenta `work-time-consistency.test.ts`;
  - nenhum `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`, `writeBatch`, `runTransaction`, `httpsCallable`, `logCode` ou `console` novo em `src/`.
- **pt-BR:** o aviso do Dashboard ("indisponível agora…") já existia na P5-F.1 (`Header.tsx:536` nas duas árvores). Os textos novos estão em pt-BR. O "Nada foi salvo ainda." de Q02 é texto antigo exibido no estado errado.

## 7. O que foi verificado e passou

- **Código:**
  - `src/` idêntico ao da revisão 3, e por isso B01, B02 e B03 continuam como a revisão 3 os deixou;
  - os 3 testes de P01 fixam o limite nos dois lados e não enfraquecem nada: só acréscimos, sem `skip`, `only` nem `todo`, com timeouts dentro do padrão do arquivo.
- **Unidade:** 258/258 na SNAP. Mutantes: os dois pedidos e mais um meu, mortos.
- **Logs:** mutantes (73/73 e 5/5), E2E mutantes (3/3), visual (12/12, 4/4 e 4/4), incidente e `verify:all` pré-revisão 2 conferem com o que os documentos dizem, salvo Q04.
- **Bases das rodadas:** iguais à SNAP, salvo o teste novo; SHA e `status` iguais antes e depois.
- **Evidência visual:**
  - os 16 JSON conferem com a tabela;
  - axe 0 e transbordamento 0;
  - tema escuro `rgb(11, 17, 32)`;
  - `role="alert"` sem tomar o foco;
  - antes × depois sem mudança fora de avisos, textos e valores em s0, s1, s2 e s4, com resíduo só de antisserrilhado;
  - a prévia de s2 muda exatamente na razão 12/11,5 da B02.
- **P02, P03, P05 e P06:** corrigidos, com os resíduos de texto de Q04.

## 8. Sondas, cópias e logs desta revisão (em `<scratchpad>/p5f1r1/revisao4/`)

| Caminho | Conteúdo |
| --- | --- |
| `integridade/` | `ls-tree` da 775db140, hashes da SNAP (início e fim), a conferência da `d9b33cd1` (cópia "antes") e da `d7dabb10` |
| `logs/snap-consistency.log`, `logs/snap-unit-wt-rep.log`, `logs/snap-por-arquivo.log` | Unidade na SNAP |
| `mut-1ms-r3/`, `mut-lt/`, `mut-const30/`, `h-d7dabb10-testes-775db140/` e `logs/*-consistency.log` | Mutantes e o "antes" de P01 |
| `sondas/alinhar.py`, `sondas/delta.py`, `sondas/achar.py`; `logs/alinhar-s0.json`, `logs/alinhar-s1-s3.json` | Alinhamento linha a linha, deltas por pixel e posição dos recortes da equipe |
| `visual-raw/` e `visual-crops/` | RGBA cru das capturas e recortes lado a lado (inclusive `s3-dir-lado.png`, de Q02) |
| `gi-test/` | `check-ignore` com o `.gitignore` da SNAP (Q01) |
| `sondas/ext/` | Um `.mts.txt` rodado direto (Q04) |

**Comandos:**
- Testes: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/<arquivo>`, de dentro da cópia.
- Imagens: `convert <png> -alpha on -depth 8 rgba:<saída>` e `python3 -I sondas/alinhar.py visual-raw <nomes…>`.

## 9. Recomendação final

**FAIL.**
- **Q01:** o P04 segue aberto, agora com afirmações falsas sobre a árvore.
- **Q02:** um estado de interface falso numa situação que a própria R1 testa e captura, sem registro na evidência, que afirma o contrário.

Os três bloqueadores e o cálculo não têm defeito.

Com Q01 e Q02 resolvidos e os textos de Q03 e Q04 ajustados, nada nesta revisão impede o PASS. Para Q02, basta a correção mínima com a asserção no E2E e a recaptura.
