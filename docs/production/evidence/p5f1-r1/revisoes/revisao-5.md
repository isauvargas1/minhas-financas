# Revisão independente 5 (somente leitura): correções da revisão 4 e veredito da P5-F.1-R1

**Data:** 2026-11-06 · **Árvore revisada:** `aff667a56061487cfdf45eb1536b9d54eb113949` (cópia fixa em `<scratchpad>/p5f1r1/revisao5/arvore-aff667a5`, chamada aqui de SNAP).

`<scratchpad>` é o diretório temporário desta sessão: `<scratchpad>`. Ao copiar este texto para a árvore, a troca do caminho por `<scratchpad>` deixa esta linha sem o valor; isso já aconteceu em `revisoes/revisao-4.md:5` ("`<scratchpad>` = `<scratchpad>`").

**Comparações:**
- `775db140` (a árvore da revisão 4): o que mudou depois dela;
- `d9b33cd1` (a P5-F.1): o delta inteiro da R1, para o veredito e a passada adversarial.

**Modo:**
- Nada foi alterado na SNAP nem no worktree. Conferi a SNAP no começo e no fim: 2.764 arquivos (`git hash-object --stdin-paths`) e 10 links simbólicos (alvo conferido), 0 divergências nas duas vezes. Os únicos extras são os dois links `node_modules`.
- Do worktree, usei só objetos Git: `diff`, `diff --check`, `ls-tree`, `rev-parse` e `cat-file`. Não rodei `git status` nem `git log` nele e não li `src/`, `tests/` nem `e2e/` do disco dele.
- Não houve commit, push, rede externa, Firebase, Emulator, Playwright nem `npm run`. Rodei com `node` os testes de unidade na SNAP e em cópias minhas, o `tsc --noEmit` numa cópia minha e sondas próprias. As imagens, li com o ImageMagick e Python (`-I`).
- Os rascunhos fora da árvore (relatório, §20.16 e vereditos) estavam mudando durante a revisão. Avaliei as versões de 02:31–02:36 UTC, copiadas com SHA-256 em `revisao5/copias-lidas/SHA256-lidas.txt`.
- Tudo o que gerei está em `<scratchpad>/p5f1r1/revisao5/` (§7).

## 0. Veredito

| Achado da revisão 4 | Veredito | Resumo |
| --- | --- | --- |
| **Q01** (LOW) | **CORRIGIDO** | Os 58 logs (13 + 35 + 10) estão na árvore como `.log.txt`. Comparei os 48 de `logs-revisao-2/` e `logs-revisao-3/` com os originais de `revisao2/` e `revisao3/`: iguais, com o caminho trocado e, em 9 deles, sem os espaços no fim das linhas, como diz `revisoes/LEIAME.md:20`. As citações de `respostas-revisao-3.md:23` e `:35` apontam para arquivos que existem. As cópias de `revisao-4.md` e das sondas da revisão 4 são fiéis. |
| **Q02** (LOW) | **CORRIGIDO** | A fiação de `edited` está certa em todos os casos que o pedido desta revisão lista (§2.2), sem regressão no assistente nem nas configurações válidas. O E2E confere os quatro estados, e q02a e q02b reprovam onde as respostas dizem. Ficam duas lacunas de teste (S03): a jornada para aplicar a vários dias sem aplicar e a digitação inválida não têm teste de comportamento. |
| **Q03** (INFO) | **CORRIGIDO** | As capturas móveis do Dashboard mostram o aviso; os 84 px, as duas linhas da ajuda e os 11 px de s1 conferem. Resta uma atribuição errada: os "8 pixels na borda do cartão" de s3 ficam nos cantos do botão "Excluir meus dados" (S04). |
| **Q04** (INFO) | **CORRIGIDO** | As seis correções de texto estão feitas (§2.4). |

**Veredito da R1:** concordo com o **FAIL**. Pelo critério do pedido, o B03 está aberto em (a), (b) e (c). Pelo mesmo critério, o B02 também deveria constar como aberto no caso do RR-R1-03 (S01, MEDIUM): é uma combinação sem interpretação determinística segura, com erro certo para mais, que a R1 calcula em vez de recusar.

**Achados novos:** S01 (MEDIUM), S02 (LOW) e S03 a S07 (INFO). Nenhum é defeito do código novo do Q02.

**Recomendação final: FAIL, referente à R1 inteira** (§8). As correções da revisão 4, sozinhas, estão certas no código e nos testes; para fechar esta rodada, falta corrigir o texto de S02.

## 1. Material e integridade

**SNAP × árvore `aff667a5`:** 2.764 arquivos e 10 links, 0 divergências no começo e no fim (`revisao5/integridade/`).

**Depois da revisão 4** (`git diff 775db140 aff667a5`, 192 arquivos), fora de `docs/` mudaram exatamente os seis arquivos previstos:

| Arquivo | Mudança |
| --- | --- |
| `src/components/workTime/RoutineEditor.tsx` | +15/−5: `edited`, `routinesKey`, `initialModels` e `initialKey` |
| `src/components/WorkTimeSettingsView.tsx` | +4/−1: `else if ('message' in result && result.edited)` |
| `tests/unit/work-time-guard.test.ts` | +7, só acréscimos |
| `e2e/work-time-p5f.spec.ts` | +33, só acréscimos, no fim do teste "B02 (P5-F.1-R1)" |
| `functions/.../receivableLifecycle.integration.test.ts` | quebra de linha de um comentário |
| `functions/.../receivableReversalIdsFixture.test.ts` | nome do teste partido em duas strings concatenadas, com o mesmo valor |

- **Os dois testes do backend:** iguais aos da `775db140` depois de juntar as linhas de comentário e as strings concatenadas e normalizar os espaços (sonda Python, resultado `True` nos dois). Nenhuma linha passa de 80 caracteres. O lint das Functions dá `201 problems (0 errors, 201 warnings)` (`logs/rev4-functions-lint.log`), e os 4 avisos `max-len` desses arquivos, presentes no `verify:all` pré-revisão 4 (`verify-all-775db140-pre-revisao4.log:190-196`), sumiram.
- **Subárvores sem mudança desde a `775db140`:** `firestore.rules` (`9d6b9d77`), `firestore.indexes.json` (`8e2d27ca`), `firebase.json` (`04e17615`), `package.json` (`bc573a5f`) e `functions/src` fora de `__tests__`. No delta inteiro (`d9b33cd1 → aff667a5`), Rules, índices, `firebase.json`, `.firebaserc` e o código das Functions continuam sem diff.
- **`git diff --check d9b33cd1 aff667a5`:** saída 0, nenhuma linha (`logs/diff-check-d9b33cd1-aff667a5.log`). A rodada intermediária `diff-check-734dca48-1a.log` acusava espaços no fim das linhas dos logs; a correção foi tirá-los, o que `revisoes/LEIAME.md:20` declara.
- **Skip, only e prazos:** nenhum `skip`, `only`, `fixme` ou `todo` no delta inteiro. O único prazo novo é o `{ timeout: 30_000 }` de `e2e/work-time-p5f.spec.ts:1389`, o padrão do arquivo para asserções da estimativa.

**Bases das rodadas da equipe:** o `.sha-depois` de `e2e-q02`, `mutantes-r1-rev4` e `visual-r1-rev4` é igual, byte a byte, ao SHA-256 de `src/`, `tests/` e `e2e/` da SNAP (`logs/snap-src-tests-e2e.sha`). Nas quatro rodadas desta etapa (`e2e-q02`, `e2e-mutantes-q02`, `mutantes-r1-rev4` e `visual-r1-rev4`), SHA e `status` são iguais antes e depois. Cada mutante do E2E teve build próprio (`e2e-mutante-q02{a,b}-build.log`, `✓ built`), e a evidência visual usou o build das 02:23, posterior aos mutantes.

**Unidade na SNAP:**
- `test:unit:work-time` (os 9 arquivos): **158/158**, 0 fail, 0 skip, 0 todo, em 14,5 s;
- `test:unit:reports`: **100/100**;
- total **258/258**, os números da revisão 4. A guarda continua com 17 testes, porque as asserções novas entraram num teste existente.

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

**Typecheck:** `tsc --noEmit` numa cópia de `src/`, `tests/` e `e2e/` da SNAP (conferida com `diff -rq`): saída 0 (`logs/snap-copia-tsc.log`).

## 2. Achados da revisão 4

### 2.1 Q01

- Na SNAP (igual à árvore): `logs-revisao-2/` com 13 logs, `logs-revisao-3/` com 35 e `sondas-revisao-2/` com 10, total 58, como diz `respostas-revisao-4.md:15`.
- Os 48 logs das revisões 2 e 3 conferem com os originais, depois de trocar o caminho por `<scratchpad>`. Em 9 (os `antes-*` da revisão 2, `antes-d7-work-time-estimate`, `mut-u68-calendar` e `mut-u73`), os espaços no fim das linhas também saíram. O conteúdo é o mesmo, e `revisoes/LEIAME.md:20` declara as duas trocas.
- As citações em `respostas-revisao-3.md:23` (`logs-revisao-3/r3-espera-servidor.*.log.txt`, 3 arquivos) e `:35` (`r3-remonta-cache.log.txt`) existem. Os nomes antigos só aparecem em `revisao-4.md`, como `revisoes/LEIAME.md:18` explica.
- `revisoes/revisao-4.md` e `sondas-revisao-4/{achar,alinhar,delta}.py.txt` são cópias fiéis dos originais, com o caminho trocado.
- `empacotar.sh:54-61` passou a tirar a evidência da árvore final (`git archive`) e para se o disco diferir dela. Não conferi o disco do worktree, porque o pedido proíbe.

### 2.2 Q02

**A correção** (`RoutineEditor.tsx:90-97`, `:175-198`; `WorkTimeSettingsView.tsx:392-403`):
- `initialModels` é capturado uma vez por montagem (`useState` com inicializador);
- `edited = routinesKey(models) !== initialKey`;
- a chave usa os dias de cada rotina semanal e a escala inteira, mas não a jornada para aplicar a vários dias;
- a tela só marca edição com `'message' in result && result.edited`.

A chave é estável no ida e volta: `dayInputFromSpec` sempre espalha `OFF_DAY_INPUT` (`draft.ts:87-95`), e as edições preservam a ordem das propriedades. Voltar ao valor gravado dá a mesma chave.

**Efeitos colaterais, caso a caso:**

| Caso | Comportamento agora | Evidência |
| --- | --- | --- |
| Configuração gravada recusada, ao montar | `edited = false`. O título fica "Valor estimado da sua hora", sem nota, sem "Descartar" e com salvar desabilitado | E2E `:1371`; capturas (§3); q02a reprova aqui |
| Edição real que continua recusada | A chave muda, `edited = true` e a tela entra em edição | E2E `:1375-1381`; q02b reprova aqui |
| Digitação inválida num dia ou na escala | A chave muda (`:96-97`), e `{ ok: false, …, edited: true }` (`:187`) marca a edição, como na P5-F.1 | Por leitura de código; sem teste de comportamento (S03) |
| Jornada para aplicar a vários dias, mudada sem aplicar | A chave não muda e o resultado é o mesmo: nada é marcado. É o que a P5-F.1 já fazia numa configuração válida | Por leitura de código; sem teste (S03) |
| Acrescentar ou remover rotina | O tamanho ou o tipo mudam a chave: edição (válida, por `edit`; recusada, por `edited`) | `:232-237`, `:365-369` |
| "Descartar alterações" | `discard` (`:225-231`) zera `isDirty`, troca `draft` e a chave (`:392`). O editor remonta com o gravado e não marca. O efeito `:112-118` (por `isDirty`) remonta de novo, também sem marcar | E2E `:1382-1385` |
| Mudança vinda de outro dispositivo, fora de edição | O rascunho segue o salvo (`:114-118`) e o editor remonta; com a configuração válida, `ok`, sem `edit` e sem aviso de conflito | E2E `:1387-1392` |
| Remontagem pela chave `resetNonce` | `initialModels` é recapturado a cada montagem | `:175` |
| StrictMode (`index.tsx:12-16`) | Inicializador, memo e efeito duplos dão o mesmo resultado, com `edited = false` | Idempotente por construção |
| Editar e voltar ao gravado | `edited` volta a `false`, mas `isDirty` continua `true`: nada desmarca a edição. É o mesmo comportamento dos outros campos (`edit`, `:168-174`) e da P5-F.1. "Descartar" funciona | Por leitura de código |
| Assistente | Ignora `edited`: só bloqueia a etapa com `'message' in routineResult` | `WorkTimeWizard.tsx:86-92`, `:153-157` |
| Configuração válida gravada | Igual à P5-F.1: montagem `ok`, sem `edit`; edições válidas por `edit`; inválidas marcam | Por leitura de código |

**E2E e mutantes:**
- `e2e-q02.log`: `2 passed`, com o B02 em 15,4 s.
- **q02a** (`!result.ok`, o comportamento da `775db140`): reprova em `notEditing`, `:1365`, com `Received string: "Prévia com as alterações…"` (`e2e-mutante-q02a.resultado`).
- **q02b** (`edited = false`): reprova em `:1378`, com `Received string: "Valor estimado da sua hora…"`.
- **U76 e U77** são os mesmos dois na guarda. A guarda é textual (`work-time-guard.test.ts:505-509`): prova a fiação, não o comportamento, e `mutantes.md:30` diz isso.
- Confere que U56, U76 e U77 são os únicos dos 77 que mexem nesses dois arquivos (extraí a lista de `mutantes-r1.py`).

As afirmações de `respostas-revisao-4.md:24-26` conferem. A frase "A jornada para aplicar a vários dias só conta quando é aplicada" (`:24`) é verdadeira no código, mas não tem teste (S03).

### 2.3 Q03

| Item | Verificação |
| --- | --- |
| (a) Dashboard móvel | As 2 páginas móveis mostram o aviso inteiro, com o menu recolhido (`revisao5/visual/mobile-dashboard-lado.png`). Os recortes `-aviso` estão na página por igualdade exata em (16, 194). O JSON tem `occluded: false` nas 16 combinações e `focusAfterAction: null` no Dashboard móvel, como diz `visual/LEIAME.md:32` |
| (b) 84 px de s0 | Meu alinhamento por coluna (`logs/alinhar-s0-configuracoes-validas.json`) dá, na coluna das seções:<br>• 46 px no interruptor (delta 37);<br>• 10 px nos cantos do seletor de UF (delta 1);<br>• 4 px no calendário (dois pontos de 1 × 2, delta 1);<br>• 21 + 1 + 2 px em cantos (delta até 8).<br>Total de 84. A coluna da prévia tem 0 px diferentes. Os recortes do interruptor diferem em 736 px, que são os 46 ampliados 4 × 4 |
| (c) Ajuda | +32 linhas inseridas, e 314 px no fim da última linha antiga, onde a frase nova começa (`recortes/s0-ajuda-*.png`) |
| (d) s1 | 11 px na coluna das seções fora dos blocos (2 + 2 + 5 + 2, 2 deles no calendário). A coluna da prévia só muda no botão de salvar (17.484 px em y 627–681). Há também 20 px em x = 939, na altura do botão: é a borda dele, cortada pela divisão das colunas |

### 2.4 Q04

- `mutantes.md:29`: U74 é morto pelos testes do N03 e de 59 s; U75, pelo de 60 s.
- `execucoes.md:8`: "de 2026-11-05 e 2026-11-06"; `:93`: "00:27–00:43".
- `rotinas-matematica.md:59`: o parágrafo "Fora do horizonte" vem depois da lista de solidez (`:55-57`).
- `DATA_MODEL.md:112` e `consistencia-estimativa.md:103`: "por até 30 s", seguido de como os 30 s contam, com o caso das bases em cache.
- `revisoes/LEIAME.md:21-24`: como rodar cada tipo de sonda.

Conferi o `.mts.txt`: copiado sem o `.txt`, `dia-seguinte-reduzida.mts` roda na SNAP e reproduz os números de `rotinas-matematica.md:156-158` (`logs/dia-seguinte-reduzida-snap.log`).

## 3. Evidência visual refeita (item 3)

- **Tabela × JSON:** as 16 linhas de `visual/LEIAME.md:38-53` conferem com os 16 JSON, campo a campo: viewport, tema e fundo, axe, transbordamento, `occluded`, `role` e foco.
- **Arquivos:** os 48 de `capturas/`, os 25 de `depois/` e `comparacao-antes-depois.json` são iguais, byte a byte, às saídas de `p5f1r1/visual/` refeitas às 02:24–02:26 por `run-visual-r1-rev4.sh`, que apaga e refaz essas duas pastas. Os 25 de `antes/` são os de 01:20–01:21, mantidos, e também são iguais. Em `depois/`, s0, s1, s2 e s4 saíram iguais aos da rodada anterior, porque a renderização é determinística; só os três PNG de s3 mudaram no Git.
- **Números:** os 11 de `comparacao-antes-depois.json` conferem com o meu `compare -metric AE`: 4, 0, 0, 2, 0, 0, 806, 1.652, 1.648, 6.644 e 41.027.
- **O s3 mostra a tela fora de edição? Sim.**
  - `depois/s3-gravada-configuracoes.png`, `-salvar.png` e `-previa.png`: o título é "VALOR ESTIMADO DA SUA HORA", não há "Nada foi salvo ainda." nem "Descartar alterações", e salvar está desabilitado (`revisao5/visual/s3-salvar-topo-lado.png`, `s3-previa-depois-antes.png`, `s3-depois-topo.png`).
  - As 4 capturas `*-b02-gravada-previa.png` mostram o mesmo (`desktop-previa-dir-lado.png`, `mobile-previa-lado.png`).
  - O JSON dos fatos não registra título, nota nem botão: essa parte da afirmação se apoia nas imagens e no E2E.
- **As capturas móveis do Dashboard mostram o aviso? Sim** (§2.3, Q03 a).

**Alinhamento por coluna** (`revisao5/sondas/alinhar_colunas.py`; saídas em `logs/alinhar-*.json`):

| Estado | Coluna das seções (x 0–939) | Coluna da prévia (x 940–1439) |
| --- | --- | --- |
| s0 | +32 (ajuda), 314 px na última linha antiga da ajuda e 84 px de antisserrilhado | 0 px |
| s1 | +64 (aviso do editor), +32 (ajuda), 314 px e 11 px; mais 20 px em x = 939 (borda do salvar) | só o salvar (17.484 px) |
| s2 | +32 (ajuda) e 314 px na última linha antiga; o título e os "?" do calendário; 93 px de delta 1; mais 20 px em x = 939 (borda do salvar) | os valores da prévia e o aviso junto do salvar (o bloco do salvar passa de 54 para 182 linhas) |
| s3 | aviso do topo; +64 (editor); +32 (ajuda) e 314 px na última linha antiga; calendário; e **126 px de antisserrilhado não listados** (9 de delta 8; 84, 20 e 13 de delta 1) | aviso do topo (640 px em y 108–121, x 940–1055); o conteúdo da prévia (o motivo no lugar do valor, +20 linhas); **8 px nos cantos do botão "Excluir meus dados"** (x 944–945 e 1262–1263; y 742–745 antes, 762–765 depois); **título igual nas duas** |
| s4 | valores e aviso; linhas de "Transações recentes" que quebram | idem |

**Conclusão:** as afirmações de `visual/LEIAME.md` batem com os JSON, as imagens, a comparação e os recortes, salvo as imprecisões de S04. A conclusão (`:74`, nada mudou fora dos avisos, dos textos e dos valores) se sustenta.

## 4. O veredito FAIL e a classificação dos bloqueadores (item 4)

**Coerência entre os documentos.** Matriz (`:5-8`, `:27`, `:39`, `:51`), `consistencia-estimativa.md` (§1 `:30`, §2 `:71`, §6 `:110-134`), `VEREDITOS.md:30,34`, relatório (`:7-18`, `:54`, `:65`, `:76`, `:286-308`), §20.16 (`:46`, `:94-99`, `:140`) e `vereditos-detalhados.md:29,40,50-55,156` dizem o mesmo:
- B01 corrigido;
- B02 corrigido, com o RR-R1-03 como limitação;
- B03 aberto em (a)–(c);
- `financial-domain-integrity` e o gate em FAIL.

Com o código, a coerência também vale. Desde a revisão 3, `src/` só mudou nos dois componentes do Q02 (subárvore `130bf285` na `775db140`, a mesma da `6c459430` segundo a revisão 4). Por isso as conferências do mecanismo de B01, B02 e B03 feitas pelas revisões 2 a 4 continuam valendo. Os desvios de texto estão em S02, S05 e S06.

**FAIL bem fundado.** O pedido:
- diz que "não basta o sistema convergir … se, antes disso, apresentar uma conversão incorreta" (`pedido-r1.md:175`);
- manda "nunca converter valores utilizando uma combinação sabidamente incompatível" (`:145`);
- manda declarar FAIL com achado aberto (`:240`).

Em (a), o cliente "sabe que não provou e mostra mesmo assim" (`consistencia-estimativa.md:112`), e a espera de 30 s termina por presunção (`:71`), o que o pedido proíbe tratar como prova (`:147`). Em (b) e (c), o cliente não detecta. Os três são casos da "resposta financeira atrasada" e das "respostas que chegam em ordens diferentes" que o pedido lista (`:166`, `:172`), com o atraso e a ordem no gatilho. Daí o B03 aberto.

**B01 corrigido: bem fundado.** O resíduo do B01 é só o caso (b): a criação do espelho do estorno é uma escrita conhecida sem espera, que segura a prova sem prazo (`consistencia-estimativa.md:59-62`). Então (a) não se aplica a ela. O erro do resíduo é para mais e não é o defeito do B01 (o desconto em dobro). A matriz (`:27`) e o relatório (`:54`) dizem isso.

**RR-R1-03 "anterior à R1": confirmado.** Na cópia da `d9b33cd1` (os 16 arquivos de `src/modules/work-time` conferidos por hash), a sonda dá os mesmos números (`logs/rr-r1-03-janelas-d9b33cd1.log`).

**RR-R1-03 "fora do invariante do B02": literalmente certo.** O teste `work-time-calendar.test.ts:670-690` mostra que acrescentar uma rotina na véspera reduzida não tira horas.

**Mas, pelo critério do pedido, ele deixa o B02 aberto num caso (S01).** O pedido exige, para o B02, bloquear uma combinação sem interpretação determinística segura, em vez de produzir um resultado enganoso (`pedido-r1.md:100`), e cita "turnos atravessam a meia-noite", "exceções" e "limites diários" (`:95-96`, `:114`). O parecer pede "cálculo comprovado ou bloqueio explícito" da sobreposição de turnos noturnos (`PARECER…:47`, `:73`). O RR-R1-03 é justamente o caso em que "não se sabe onde caem os minutos" (`rotinas-matematica.md:153`), e o resultado é certamente maior que o possível.

**Outro caso aberto não declarado?** Além do S01, não achei. Procurei em:
- o resíduo do B01, que é o (b);
- os riscos da §20.15 que a §20.16 dá como superados: com a prova, a combinação deixa de aparecer, salvo quando degenera em (a)–(c), já declarados;
- o RR-R1-02 e o M09, que não convertem nada;
- a identidade da retenção, que confere com `pedido-r1.md:146`.

## 5. Achados novos

### S01 — MEDIUM — pelo critério do pedido, o RR-R1-03 deixa o B02 aberto num caso: uma combinação sem interpretação determinística segura é calculada, com erro certo para mais, em vez de recusada

**Onde:**
- **Código:** `src/modules/work-time/calendar.ts:348-356`. `followsRoutine` é falso no dia reduzido, então `workedWindowsOn` não devolve as janelas dele como véspera, e o dia seguinte não desconta o trecho depois da meia-noite. `calendarAmbiguity` (`:687-698`, comentário e assinatura) só procura ambiguidade de posição de intervalo e aceita a configuração.
- **Classificação:**
  - `matriz-bloqueadores.md:7` e `:39`;
  - relatório (rascunho) `:10`, `:65` e `:304-308`;
  - §20.16 (rascunho) `:111-115` e `:140`;
  - a linha de estado de `aplicar-plano.py` ("B01 e B02 corrigidos").

**Reprodução** (`revisao5/sondas/rr-r1-03-janelas.mts`, `node --experimental-strip-types … rr-r1-03-janelas.mts <SNAP>`; log `logs/rr-r1-03-janelas-snap.log`):
- Configuração: rotina 1 com segunda 20:00–06:00, rotina 2 com terça 00:00–08:00, sem intervalo.
- Sem exceção: segunda 600 + terça 120 = 720 min, a união.
- Com jornada reduzida a 8 h na segunda (05/10/2026): segunda **480** + terça **480** = **960 min**, e `calendarAmbiguity(…, '2026-11-06') === null`, ou seja, salvar aceita.
- As 8 h da segunda estão dentro de 20:00–06:00, e só 4 h existem antes da meia-noite. Então pelo menos 4 h caem em 00:00–06:00 de terça, dentro da janela da terça, e são contadas duas vezes. O trabalho real cabe em 20:00–08:00, no máximo 720 min. A sobra é de **pelo menos 240 min**, sem depender de onde caem as horas.
- Com 9 h: 1.020 min. A árvore da P5-F.1 dá os mesmos números.
- **O exemplo da própria R1** (`rotinas-matematica.md:156-158`, segunda reduzida e terça com 24 h de plantão) tem pelo menos 4 h da segunda no dia civil da terça, que conta 1.440. São **pelo menos 28 h num dia civil**: o mesmo tipo de erro do N02, que a R1 tratou como defeito e corrigiu para o próprio dia reduzido. A revisão 2 achou 8.408 casos assim, todos com a véspera reduzida (`revisoes/revisao-2.md:205`).
- Os documentos dizem que os minutos "podem" contar nos dois dias (`rotinas-matematica.md:154-155`; relatório `:305-306`). Nesses exemplos, contam com certeza.

**Por que conta como aberto:**
- O pedido põe no próprio B02 a regra "Se uma combinação não permitir interpretação determinística segura, bloqueie sua configuração … em vez de produzir resultado financeiro enganoso" (`pedido-r1.md:100`) e lista os turnos que atravessam a meia-noite, as exceções e os limites diários (`:95-96`, `:114`).
- O parecer pede cálculo comprovado ou bloqueio explícito (`:47`, `:73`).
- A R1 não faz nenhum dos dois e justifica com o invariante de monotonia, que é mais estreito que a correção exigida.
- As revisões 2 e 3 aceitaram a exceção como registrada (`revisao-2.md:205`, `revisao-3.md:150`). Foi com o critério de "limite documentado", o mesmo que a R1 agora recusa para o B03 (relatório `:18`).
- Fechar este caso não exige mudar a arquitetura: é uma recusa local, do mesmo tipo de `calendarAmbiguity`.

**Efeito:** a decisão pedida ao dono (§11 e §20.16, RR-R1-01) trata só do B03. Se ele aceitar o risco do B03, o B02 parecerá fechado, com um caso em que as horas ficam acima do possível sem aviso. A hora sai subestimada, e o tempo convertido, superestimado.

**Correção mínima (uma das duas):**
1. Recusar ao salvar, em `calendarAmbiguity`, o dia de jornada reduzida cuja janela passa da meia-noite sobre uma janela do dia seguinte, ou seguido de dia com acréscimos ou duração que ocupem o dia civil. Com mensagem e teste dirigido; o teste `:670-690` passa a esperar a recusa.
2. Ou declarar nos documentos "B02 corrigido no invariante e aberto no RR-R1-03", com a sobra certa (≥ 240 min nos exemplos), e incluir o caso nas decisões de RR-R1-01.

### S02 — LOW — `VEREDITOS.md` na árvore afirma o que deixou de ser verdade com a correção do Q02 (a mesma classe do P02)

| Onde | O que diz | Fato |
| --- | --- | --- |
| `VEREDITOS.md:8` | a revisão 4 leu a árvore `775db140`, "a mesma do `verify:all` final" | O `verify:all` final roda na `aff667a5` (`logs/verify-all-final.log.meta`: `arvore=aff667a5…`). A lista `:5-8` também não tem o quarto elo: as correções da revisão 4 (dois componentes de `src/`, a guarda, o E2E e os dois testes do backend), lidas por esta revisão na `aff667a5` |
| `VEREDITOS.md:21` | "75/75 de unidade e 3/3 do E2E, na árvore final" | `mutantes.md:17` e `:126` dizem 77/77, e `:32`, 5/5. A §20.16 (`:87`) e `vereditos-detalhados.md:152` também |
| `vereditos-detalhados.md:151` (rascunho) | `git diff --check` do delta em `logs/execucoes/diff-check-775db140.log` | O log da árvore final é `diff-check-aff667a5.log`, vazio. O conteúdo do `-775db140` também é vazio, mas é de outra árvore |

**Reprodução:** `git -C <WT> diff --word-diff 775db140 aff667a5 -- docs/production/evidence/p5f1-r1/VEREDITOS.md`. Os marcadores `{{REV4_ARVORE}}` e `{{MUTANTES_UNIDADE}}` foram preenchidos com valores da `775db140`.

**Correção mínima:** acrescentar o quarto elo, trocar "a mesma do `verify:all` final" pela árvore certa, usar "77/77 … e 5/5" e citar `diff-check-aff667a5.log`.

### S03 — INFO — dois comportamentos do Q02 sem teste: a jornada para aplicar a vários dias sem aplicar e a digitação inválida

Dois mutantes semânticos, aplicados em cópias minhas (`revisao5/mut-tpl`, `revisao5/mut-tplfail`; diffs em `logs/mut-tpl.diff` e `logs/mut-tplfail.diff`, resultados em `logs/mut-*-unit-work-time.log`):

| Mutante | Unidade (158 testes, com a guarda) | E2E, por leitura |
| --- | --- | --- |
| `mut-tpl`: `routinesKey = (models) => JSON.stringify(models)`. A jornada mudada sem aplicar passa a pôr a tela em edição numa configuração recusada | **158/158 passam** | Sobrevive: entre `fill('15:00')` (`:1376`) e "Aplicar" (`:1377`) não há asserção, e depois de aplicar os dois marcam edição |
| `mut-tplfail`: um ramo antes do guardado, `else if ('message' in result && !result.message.includes('se cruzam')) setRoutineResult(result);`. A digitação inválida deixa de pôr a tela em edição | **158/158 passam**; `tsc` saída 0 | Sobrevive: nenhum E2E digita valor inválido numa rotina (os únicos `fill` de rotina são `:1317-1319`, `:1326-1328` e `:1376`, todos válidos) |

O código está certo nos dois casos (§2.2). Faltam os testes de uma afirmação feita em `respostas-revisao-4.md:24` e em `RoutineEditor.tsx:94-95`.

**Correção sugerida** (no mesmo E2E, depois do `reload`):
- mudar só o "Fim" da jornada e conferir `notEditing()` antes de aplicar;
- apagar o "Fim" de um dia e conferir `work-time-unsaved` visível;
- depois de "Descartar", conferir que a jornada mostra 14:00, o que fixa a volta do editor ao gravado.

### S04 — INFO — `visual/LEIAME.md:71` e `respostas-revisao-4.md:27`: os "8 pixels de antisserrilhado na borda do cartão" não ficam no cartão

- **Onde estão:** nos cantos superiores do botão "Excluir meus dados": (1262–1263, 742) e (944–945, 743–745) no "antes", 20 linhas abaixo no "depois", com delta 1. O vermelho da borda, `(251, 193, 193)`, é o desse botão (`revisao5/visual/s3-antes-y742.png`, `s3-depois-y762.png`).
- **O que mais a faixa x 940–1439 de s3 mostra:** 640 px do aviso do topo (y 108–121). O texto do aviso passa de x = 940, e o `LEIAME.md` o atribui só à coluna das seções.
- **O que falta na coluna das seções de s3:** 126 px de antisserrilhado (delta ≤ 8), que não estão na tabela, ao contrário de s0 e s1.
- A conclusão não muda. Correção: trocar "na borda do cartão" por "nos cantos do botão 'Excluir meus dados'" e listar os resíduos de s3.

### S05 — INFO — "fechar esses casos exige mudar a arquitetura" vale para (b) e (c), mas não para (a)

**Onde:** `matriz-bloqueadores.md:8` e `:51`; relatório `:16` e `:295`; §20.16 `:46` e `:99`; `vereditos-detalhados.md:40`.

**O que vale para (a):**
- O pedido manda, onde a arquitetura não permite comprovar consistência: "implemente fallback seguro e documente" (`pedido-r1.md:149`).
- Para (a), esse fallback existe e é local: o fail-closed estrito de `consistencia-estimativa.md:116-119`.
- A R1 o deixou para decisão de produto, por causa da vivacidade.
- Está documentado no §6, mas as frases de resumo dão a entender que os três casos dependem da arquitetura.

**Correção:** dizer, no resumo, que (a) fica aberto por escolha, contra `:149` do pedido, e que só (b) e (c) dependem da arquitetura.

### S06 — INFO — "as revisões 2 e 3" × "as revisões 2 a 4"

- `matriz-bloqueadores.md:16` e o relatório `:18` dizem que as revisões 2 e 3 deram o B03 como corrigido dentro dos limites.
- `rascunho/revisoes-vereditos.md:11` diz "2 a 4".
- A revisão 4 também deu: "Os três bloqueadores continuam corrigidos" (`revisoes/revisao-4.md:29`, `:324`).
- Correção: usar "2 a 4" nos três lugares.

### S07 — INFO — referências que dependem do fechamento

- `LEIAME.md:15` e `respostas-revisao-4.md:58` citam `revisao-5.md`, que não está na `aff667a5`.
- `VEREDITOS.md:3` diz que, depois do `verify:all`, só mudaram documentos "(`execucoes.md`)". Vão mudar também `VEREDITOS.md`, `revisoes/LEIAME.md`, `revisao-5.md` e o plano mestre.
- Valem se a árvore final as contiver. Conferir no `mudancas-depois-do-verify-all.txt` do pacote.

## 6. O que foi verificado e passou

- **Integridade:** a SNAP é a `aff667a5` (0 divergências no começo e no fim). Fora de `docs/`, só os seis arquivos previstos, e os dois do backend só na quebra de linhas. `git diff --check` do delta inteiro vazio.
- **Q02, código:**
  - a fiação de `edited` está certa em todos os casos pedidos, sem efeito no assistente nem nas configurações válidas;
  - "Descartar" volta ao gravado e sai da edição;
  - a mudança de outro dispositivo entra sem aviso de conflito;
  - o StrictMode e a remontagem por `resetNonce` não marcam edição.
- **Q02, testes:** E2E 2/2 sobre o mesmo `src/`, `tests/` e `e2e/` da SNAP. q02a e q02b reprovam onde dizem, cada um com build novo. U56, U76 e U77 mortos pela guarda, sem `skip`, `only` nem prazo aumentado.
- **Unidade na SNAP:** 158/158 e 100/100. Typecheck da cópia: saída 0. Lint das Functions: 201 avisos e 0 erros, os 4 `max-len` da R1 resolvidos.
- **Q01, Q03 e Q04:** corrigidos (§2), com os logs na árvore fiéis aos originais.
- **Evidência visual:**
  - 16/16 linhas da tabela conferem com os JSON;
  - axe 0, sem transbordamento e sem aviso coberto;
  - os números da comparação conferem com o meu `compare`;
  - o s3 e as `b02-gravada-previa` mostram a tela fora de edição;
  - o Dashboard móvel mostra o aviso;
  - os arquivos da árvore são as saídas da rodada da revisão 4.
- **Veredito:** o FAIL da R1 é bem fundado pelo critério do pedido, e os documentos são coerentes entre si e com o código, salvo S01, S02, S05 e S06.

## 7. Sondas, cópias e logs desta revisão (em `<scratchpad>/p5f1r1/revisao5/`)

| Caminho | Conteúdo |
| --- | --- |
| `integridade/` | `ls-tree` da `aff667a5`, hashes da SNAP no começo e no fim, listas de arquivos |
| `logs/snap-unit-work-time.log`, `logs/snap-unit-reports.log`, `logs/snap-por-arquivo.log` | Unidade na SNAP |
| `logs/snap-copia-tsc.log`; `mut-none/` | Typecheck numa cópia sem mudança |
| `mut-tpl/`, `mut-tplfail/`; `logs/mut-tpl.diff`, `logs/mut-tplfail.diff`, `logs/mut-*-unit-work-time.log`, `logs/mut-tplfail-tsc.log` | Mutantes de S03 |
| `sondas/alinhar_colunas.py`; `logs/alinhar-*.json`; `visual-raw/` | Alinhamento por coluna (RGBA cru do ImageMagick) |
| `visual/*.png` | Recortes e lados a lado citados em §3 e S04 |
| `sondas/rr-r1-03-janelas.mts`, `sondas/dia-seguinte-reduzida.mts`; `logs/rr-r1-03-janelas-{snap,d9b33cd1}.log`, `logs/dia-seguinte-reduzida-snap.log` | S01 |
| `logs/diff-check-d9b33cd1-aff667a5.log`, `logs/snap-src-tests-e2e.sha`, `logs/citacoes-revisoes.txt` | `diff --check`, base das rodadas e citações de Q01 |
| `copias-lidas/` | Os rascunhos avaliados (relatório, §20.16 e vereditos), com SHA-256 e horário |

**Comandos:**
- Testes: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/<arquivo>`, de dentro da SNAP ou da cópia.
- Sonda: `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON sondas/rr-r1-03-janelas.mts <raiz>`.
- Imagens: `convert <png> -alpha on -depth 8 rgba:<saída>` e `python3 -I sondas/alinhar_colunas.py visual-raw <nome> 0 939 940 1439`.

## 8. Recomendação final

**FAIL, referente à R1 inteira.**
- Concordo com o FAIL declarado: o B03 continua aberto em (a), (b) e (c), e o pedido não aceita convergir depois de mostrar uma conversão incorreta.
- Pelo mesmo critério, o B02 deveria constar como aberto no caso do RR-R1-03 (S01). Recusar a configuração é uma correção local, que não depende de mudar a arquitetura.
- Não publicar.

**Correções da revisão 4 (o escopo desta rodada):** Q01 a Q04 estão corrigidos. O código novo do Q02 não tem defeito nem regressão encontrados, e os testes e a evidência conferem. Antes de empacotar, corrigir S02 (texto, LOW). S03 a S07 são INFO, de testes e de texto. S01 muda a classificação do B02, não o veredito, que já é FAIL.
