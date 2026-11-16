# P5-F.1-R1 — execuções e resultados

Todas as execuções rodaram no worktree isolado da R1 (branch local `feat/p5-f1-r1-corrections-2026-11-05`, sobre a árvore `d9b33cd1`), contra o Emulator `minhas-financas-local`:
- Java 21.0.12 e o Firebase CLI do projeto;
- loopback-proxy seguro só durante o comando;
- ao fim de cada execução com Emulator, só a JVM órfã daquela execução foi encerrada, com SIGTERM e checagem de identidade (`emulator-cleanup.log`, nunca SIGKILL).

Nenhum projeto real foi usado. Horários em UTC, de 2026-11-05 e 2026-11-06.

Roteiros no pacote (`roteiros/`), com `<scratchpad>` no lugar do diretório temporário da sessão:
- execução: `run-verify-all.sh`, `run-emu.sh`, `run-pw.sh`, `run-pw-arvore.sh`, `resumo-verify.py` e `final-tree.sh`;
- mutantes: `mutantes-r1.py`, `run-mutantes.sh`, `gerar-mutantes-md.py`, `e2e-mutante-r1.py`, `e2e-mutantes-r1.sh` e `e2e-mutantes-q02.sh`;
- a correção do Q02, aplicada por roteiro: `aplicar-q02.py`;
- sondas e o antes: `run-sondas-final.sh` e `antes-revisao/preparar.py`;
- evidência visual: os de `visual/`, também no pacote;
- pacote e plano: `empacotar.sh` e `aplicar-plano.py`.

## Integridade da base (antes de qualquer alteração)

| Etapa | Resultado |
| --- | --- |
| Objeto `d9b33cd1c83bdbf03399f8100de640db7b3cb66a` no repositório | presente (`tree`); é a árvore final da P5-F.1 (§20.15) |
| Worktree novo (19:29) | `git worktree add --no-checkout -b feat/p5-f1-r1-corrections-2026-11-05 <wt> 1730a1df…`; arquivos a partir de `d9b33cd1` (`read-tree -u --reset`); índice de volta a `1730a1df` (nada staged) |
| Árvore Git integral do working tree (índice temporário) | `d9b33cd1c83bdbf03399f8100de640db7b3cb66a`, igual à informada |
| Worktree e artefatos da P5-F.1 | intocados (outro worktree) |

## Antes × depois (a mesma bateria sobre a árvore da P5-F.1)

| Etapa | Comando ou roteiro | Resultado |
| --- | --- | --- |
| Cópia exata da P5-F.1 | `git archive d9b33cd1 src tests package.json tsconfig.json` num diretório novo, com os `node_modules` do worktree | só os cenários de gancho da R1 copiados para lá, sem as funções puras que não existiam (`consistency.ts`) e com a mensagem nova da R1 como texto |
| B03 e B01, gancho (`antes-b03-b01-hooks`) | `node --test tests/unit/work-time-consistency.antes.test.ts` | **14 de 18 reprovam**, com o valor exato mostrado: R$ 10.560,00 da base antiga, R$ 36.000,00 sem prova, R$ 35.000,00 (R8-02), R$ 35.300,00 (R11-01), R$ 36.500,00 (R11-02), R$ 10.060,00 com o calendário trocado, R$ 10.360,00 descontada duas vezes, R$ 9.060,00 e R$ 9.360,00 (B01). Os 4 que passam são guardas (uma base sem desconsiderada, troca de workspace, troca de conta, falha da leitura por id) |
| B02, sondas | `node --experimental-strip-types sondas/<sonda>.mts <árvore>` nas duas árvores | exemplo do parecer 480 → **390** (P5-F.1) e 480 → **480** (R1); borda do período 44.640 → 42.840 e 44.640 → 44.640; teto 7.200 → 6.240 e 7.200 → 7.440; noturno com intervalo 14.220 (P5-F.1) e 26 dias sem cálculo seguro (R1); revisão 2, 2 h por dia e sem cálculo seguro (`rotinas-matematica.md` §5) |
| B01, unidade | o cenário A/B do parecer | P5-F.1: renda elegível R$ 0,00; R1: R$ 100,00 (`work-time-estimate.test.ts`) |

## Dirigidas, durante a implementação

| Etapa | Comando ou log | Resultado |
| --- | --- | --- |
| Suíte do tempo de trabalho, 1ª com B03 (20:42) | `test:unit:work-time` (`wt-unit-b03a`) | 94/113. Reprovaram: <br>• a guarda nº 67, porque o teste novo do backend citava o caminho da preferência num comentário, reescrito sem enfraquecer a guarda; <br>• a guarda nº 76, cujas expressões fixavam a retenção heurística da P5-F.1 (`holdEstimate(holding, last.current, params, state)`) e passaram a fixar a prova (`holdEstimate(proof.proven, …)`); <br>• 17 cenários da estimativa inteira: os dublês não entregavam a gravação do gatilho da projeção (versão e retorno inicial), que a prova exige; esperavam o tempo esgotar sem projeção. |
| Dublês com o servidor | `wt-unit-b03b`, `b03c`, `wt-est-b03d`…`g` | Os dublês ganharam relógio do servidor (`createdAt`, `updatedAt`, `voidedAt`), versões das projeções e o retorno inicial da escuta, como no produto. As expectativas dos cenários da P5-F.1 foram reescritas para o contrato fail-closed: onde antes uma versão mista era tolerada ou mostrada, agora só "calculando" ou a estimativa provada (detalhe em `consistencia-estimativa.md` §7). Duas causas reais apareceram e foram corrigidas: <br>• releituras por id a mais com a sincronização segurando: o agendador passou a ficar parado enquanto ela segura, com cancelamento; <br>• R9-03 preso: sem estimativa anterior compatível, a provada atual é mostrada mesmo com a sincronização relendo. <br>Resultado: 21/21 em `wt-est-b03g` |
| Relatórios e guarda | `test:unit:reports` (`rep-unit-b03h`), guarda (`guard-b03`) | 100/100 e 17/17 |
| Suíte do tempo de trabalho, 3 vezes (`wt-unit-b03i-1..3`) | `test:unit:work-time` | 113/114 nas três, o mesmo teste: a guarda nº 76 ainda com uma expressão antiga. Corrigida, a guarda passou (17/17), sem tirar asserção |
| Cenários de consistência | `work-time-consistency` (`wt-cons-a`, `wt-cons-b`) | 20/20 e 20/20 |
| E2E novos, 1ª (21:18) | `run-pw.sh` (`e2e-r1-novos`) | 0/2, causas do próprio teste: <br>• B01 semeava o cliente no PF ("Clientes e recebíveis estão disponíveis só em espaço PJ"); passou ao PJ, com a renda semeada lá e `allowBusinessIncome`; <br>• B02 esperava a prévia indisponível com a rotina ambígua, mas a prévia não adota rotina inválida (como qualquer outra); a asserção passou a ser o aviso, o salvar bloqueado e nada gravado, mais a parte da configuração ambígua já gravada (estimativa indisponível) |
| E2E novos, 2ª (21:22) | `e2e-r1-novos-b` | **2/2** (1,8 min) |
| Calendário: período e teto (E1, E2) | `cal-e1e2`, `cal-e1e2b`, `cal-e1e2c` | 40/40 com a regra nova. Na 2ª, 19/21 por expectativas minhas: <br>• o teste explícito esperava 1.800 min limitados na segunda 12/10, mas a conta certa é 1.740 sem limite: 1 h do turno mais 22 h sem horário, que cabem nas 23 h livres; <br>• a propriedade conferia menos pares que o mínimo pedido, e as amostras subiram para 4.000. <br>Na 3ª, 21/21 |
| Suíte do tempo de trabalho (21:35) | `test:unit:work-time` (`wt-unit-e1e2`) | **137/137** |
| Rules da P5-F com o teste da R1 | `run-emu.sh` (`rules-wt-r1`) | **14/14** |
| Mutantes, 1ª rodada (21:42) | `mutantes-r1.py unit` (`mutantes-r1`) | 41/44. Um era inválido (trecho repetido) e saiu. Sobreviveram: <br>• U30, o estorno nas escritas conhecidas: ganhou teste; <br>• a condição `listenFailedKey` do retorno da projeção confirmada: era redundante e saiu do código, e o mutante foi trocado por U41, sem o descarte no erro. <br>Rodadas só dos sobreviventes: `mutantes-r1b` 2/2 (os índices passados estavam errados, 31 e 42; a rodada vale como teste deles) e `mutantes-r1c` **2/2** (U30 e U41) |
| Consistência e guarda depois dos sobreviventes | `cons-sobrev` | 38/38 |
| Repetições (21:46–21:48) | `work-time-consistency`, `work-time-income-estimate` e `report-basis-sync` juntos, 5 vezes (`repeticao-1..5`) | **5 × 92/92**, 0 falha, 0 skip |

## Revisão independente 1 e correções

| Etapa | Comando ou log | Resultado |
| --- | --- | --- |
| Revisão independente 1 (21:41–22:20), somente leitura, sobre a árvore `b97806c4` | `revisoes/revisao-1.md` | **FAIL**: B01 corrigido; B02 reaberto (N01 HIGH, N02, N07); B03 incompleto (N03 a N06); N08 a N10 INFO. Respostas item a item em `revisoes/respostas-revisao-1.md` |
| Protótipo do teto, fora do worktree | `sondas` da revisão contra o protótipo (`busca-proto-60k`, `cobertura-proto-80k`, `cobertura-proto-80k-s2`) | 0 violações em 60.000 e 2 × 80.000 amostras; os testes de calendário, estimativa e preferência do protótipo, 54/54 |
| Calendário com os testes da revisão | `work-time-calendar` (`rev-cal-1` a `rev-cal-4`) | 1ª: 25/27, por pisos dos próprios testes novos, sem violação: o gerador da propriedade do teto achava poucos pares, e o do conferidor nenhum caso recusado pelo calendário. Na 2ª e na 3ª, os geradores refeitos (cobertura vinda da véspera; janelas só às vezes com intervalo) dão 26/27 e 27/27. A propriedade do teto foi refeita de novo depois do "antes" (abaixo), dirigida ao caso da revisão; com ela, 6/6 dos testes da revisão |
| Preferência | `work-time-preference` (`rev-pref-1`) | 12/12. A asserção da recusa das rotinas ganhou o campo novo `ambiguity` (contrato do resultado), sem tirar nada |
| Consistência e retenção | `work-time-consistency` (`rev-cons-1` a `rev-cons-3`), `work-time-income-estimate` e guarda (`rev-ie-1`, `rev-ie-2`) | 21/21 com a regra nova. Três testes antigos fixavam o contrato anterior e foram atualizados, sem tirar asserção: a guarda da fiação, o `held` novo e o erro com a anterior, que agora mostra o aviso. Com eles, 59/59. Nos testes novos da revisão, a 1ª reprovou 2/5: o dublê dava à projeção uma versão posterior à edição feita antes da montagem, o que não modela o gatilho que ainda não gravou. O dublê ganhou `stamp`, a projeção gravada antes, e deu 5/5 |
| Suítes completas | `test:unit:work-time` (`rev-wt-1`), `test:unit:reports` (`rev-rep-1`) | **151/151** e **100/100** |
| Rules no Emulator, com a leitura do servidor e sem rede | `run-emu.sh` (`rules-wt-rev1`) | **14/14**. Sem rede, `getDocs` responde do cache (`fromCache`); `getDocsFromServer` falha como `unavailable`; de volta à rede, lê do servidor |
| E2E da R1 e o novo de N07 | `run-pw.sh` (`e2e-rev-1`, build novo) | **3/3** (1,8 min) |
| E2E da P5-F, P5-F.1 e R1 | `e2e-rev-2` (mesmo build) | **18/18** (3,8 min) |
| Antes, na árvore revisada | `antes-revisao/preparar.py` (cópia de `b97806c4` por `git archive`) e os logs `antes-revisao-*` | Reprovam:<br>• calendário 4/4 (N01: 1.980 → 1.440; N02: 25 h 40 min; a propriedade do teto, na amostra 14; a de 24 h, com 2.040 min num dia);<br>• preferência 1/1 (N07);<br>• pares 1/1 (ID repetido);<br>• ganchos 5/5 (N05: "calculando" para sempre; N03: R$ 10.260,00; N03 sem efeito na renda; N06: presa em R$ 10.560,00; N06: sem aviso).<br>A 1ª versão da propriedade do teto passava na árvore revisada: o gerador não isolava o dia reduzido, e os ganhos em outros dias escondiam a perda. A sonda `sondas/teto-e` mediu o dirigido: 210 violações em 1.000 amostras na árvore revisada e 0 na corrigida. A propriedade foi refeita assim e reprova lá |

## Mutantes, sondas e E2E finais

| Etapa | Comando ou log | Resultado |
| --- | --- | --- |
| Mutantes de unidade, rodada final (23:00–23:15), U1 a U67 | `run-mutantes.sh mutantes-r1-final` | 65/67 mortos. O SHA-256 dos 407 arquivos de `src/`, `tests/` e `e2e/` e o `git status` são iguais antes e depois.<br>• U13 sobreviveu: nenhum teste tinha a véspera ocupando o dia civil num dia de jornada reduzida com acréscimos.<br>• U53 não compilava. |
| Teste novo para U13 e o caso que ele mostrou (`rotinas-matematica.md` §6, hoje declarado aberto) | `work-time-calendar` (`final-cal-1`) | **28/28**, com:<br>• o caso do N02 com a véspera;<br>• o teste do limite registrado da véspera em jornada reduzida (`rotinas-matematica.md` §6), que vale igual na árvore da P5-F.1 (`sondas/dia-seguinte-reduzida`).<br>A nota `capped_days` deixou de afirmar que nenhum dia passa de 24 h. |
| U13 e U53 de novo, U53 com uma mutação que compila | `MUTANTES_SO=13,53 run-mutantes.sh mutantes-r1-final-b` | **2/2** mortos e 0 que não compilam, com SHA-256 e `git status` iguais. Total: **67/67** (`mutantes.md`). |
| Sondas da B02 na árvore `d7dabb10` (cópia de `src/`, conferida arquivo a arquivo) | `run-sondas-final.sh` | Buscas da revisão 1:<br>• `b02-cobertura`, 80.000 amostras com a semente 99 e 80.000 com a 4242: 55.641 e 55.791 pares conferidos, **0 violações**;<br>• `b02-busca`, 60.000 amostras com a semente 7: 9.765 pares, **0 violações**. A gravação de agora aceita 9.662 configurações, **nenhuma** com dia ambíguo na janela; o conferidor antigo, só das rotinas, aceitava 287 com dia ambíguo.<br>Solidez do conferidor (`aceita`, 5.000): 3.538 aceitas e **0** com dia ambíguo de nov/2025 a jun/2027. Das 1.462 recusas, 1.447 apontam um dia ambíguo no calendário; as 15 restantes (`aceita-causas`) têm a causa nas rotinas sozinhas, ambíguas naquele dia, que o calendário suspende.<br>Teto dirigido (`teto-e`): **1.000/1.000** sem violação.<br>Custo:<br>• `custo-cal`: 0,1 ms nos casos comuns;<br>• `aceita`: média de 9 ms e pior caso entre 59 e 80 ms;<br>• `custo-rotinas`: até 88 ms na primeira chamada e média de 25 ms nos ciclos longos. |
| Mutantes do E2E | `e2e-mutantes-r1.sh` (`e2e-mutante-b01`, `-b02`, `-n07`) | **3/3 mortos** (`e2e-mutante-b01`, `-b02` e `-n07`), cada um com build novo; o teste indicado reprova com o mutante. O SHA-256 dos arquivos de `src/`, `tests/` e `e2e/` e o `git status` são iguais antes e depois (`e2e-mutantes-final.*`). Nenhuma JVM sobrou. |


## Revisão independente 2 e correções

| Etapa | Comando ou log | Resultado |
| --- | --- | --- |
| Revisão independente 2 (23:31–00:13), somente leitura, sobre a árvore `d7dabb10` | `revisoes/revisao-2.md` | **FAIL**, sem defeito de código nos três bloqueadores:<br>• B02 com 0 violações em 182.354 pares;<br>• conferidor sólido em 1.373 configurações aceitas;<br>• M01 (MEDIUM), a direção do erro nos limites (a) e (b);<br>• M02 a M05 (LOW) e M06 a M09 (INFO).<br>Respostas em `revisoes/respostas-revisao-2.md` |
| `verify:all` na árvore `4d81171e`, com o código e os testes da `d7dabb10`, antes das correções | `verify-all-pre-revisao2` | saída 0 em 3.045 s: 1.665 + 1.256 testes do node e **209 E2E**, 0 falha, 0 skip; lint com 0 erros e 205 avisos. Referência: não é o gate final |
| Testes novos da revisão 2, sobre o `src/` da `d7dabb10` | `antes-revisao2-m02`, `-m03`, `-m05`, `-m06`, `-m07` | **Reprovam:**<br>• M02: tempo esgotado, "a estimativa sem esperar de novo";<br>• M05: o texto antigo;<br>• M06: `RangeError`;<br>• M07: "o estorno logo depois".<br>**Passa:** M03, porque o código estava certo; o teste novo mata o mutante U68, que sobrevivia.<br>Na 1ª versão, o teste de M06 também passava na `d7dabb10`: sem janela coberta, o conferidor não lia as exceções. Ele foi refeito com uma janela coberta |
| Correção de M02, 1ª tentativa | `work-time-consistency` | 2 testes do N03 reprovaram. O `Date.parse` leniente lia os rótulos falsos de `generatedAt` do mundo de teste ("s-1") como 01/01/2001 e encerrava a espera. Só o formato ISO em UTC vale agora (`ISO_INSTANT`), com os mutantes U70 e U71. Depois: **27/27** |
| Correção de M03, 1ª versão do teste | `work-time-calendar` | 1 reprovação: o conferidor recusava a configuração, porque a terça 07/09/2027, feriado de folga, tira a cobertura da segunda. Ele estava certo. O teste passou a trabalhar nos feriados, e a revisão usou o mesmo caso. Depois: **29/29** |
| Suítes tocadas | `rev2-*` e a suíte de cálculo, gramática e paginação | calendário 29/29, preferência 13/13, estimativa 23/23, consistência 27/27, guarda 17/17, retenção 21/21; cálculo, gramática e paginação 25/25 |
| Typecheck | `npm run typecheck` (`rev2-typecheck`) | saída 0 |
| Custo do conferidor (M04), sonda da revisão na árvore `75027d92` | `sonda-final-custo-m04` | comum 0–1 ms; coberta 42–84 ms; pior caso 368–389 ms (`validateDraft` 481 ms); o rascunho com data inválida dá a mensagem do formato |
| Sondas da B02 | `sonda-final-*` | Rodaram na `d7dabb10`. `calendar.ts` e `dates.ts` da árvore final são os mesmos (SHA-256 `b5b62b6f…` e o de `dates.ts`, sem diff desde então), então valem para ela |
| Mutantes de unidade, rodada final (U1 a U73, 00:27–00:43) | `run-mutantes.sh mutantes-r1-rev2` | **73/73** mortos, 0 que não compilam, em 940 s. O SHA-256 dos 407 arquivos de `src/`, `tests/` e `e2e/` e o `git status` são iguais antes e depois |
| Revisão independente 3, somente leitura, sobre a cópia fixa da árvore `6c459430` | `revisoes/revisao-3.md` | **FAIL**, sem defeito de código:<br>• B01, B02 (com a prova conferida contra `planDay`) e B03 corrigidos;<br>• P01 (LOW): faltava teste do limite de 30 s, e o mutante de 1 ms passava;<br>• P02 (LOW): afirmações falsas no rascunho de `VEREDITOS.md`;<br>• P03 a P06 (INFO): texto, logs e notação.<br>Respostas em `revisoes/respostas-revisao-3.md` |
| **Incidente:** o contêiner reiniciou no meio do mutante b01 do E2E (por volta de 00:45) | `incidente-reinicio-conteiner.log` | `incomeBasis.ts` ficou com a mutação b01, porque o processo morreu sem restaurar o arquivo. Foi restaurado com o blob da árvore `6c459430`, e o SHA-256 dos 407 arquivos voltou a ser igual ao de antes da rodada. A rodada foi repetida inteira (`e2e-mutantes-rev2b`), e a revisão 3 foi retomada sobre a mesma cópia fixa |
| Mutantes do E2E na árvore final | `e2e-mutantes-r1.sh` (`e2e-mutantes-rev2b`) | **3/3 mortos** (b01, b02, n07), com SHA-256 e `git status` iguais antes e depois |
| Evidência visual, 1ª rodada | `run-visual-r1.sh` (`visual-r1-final`) | **Capturas da R1:** 6/12. As 390 × 844 falharam no ajudante de navegação do teste, que só conhece o menu do desktop; a página abria já na largura móvel.<br>**Antes × depois:** 4/4 na P5-F.1 e 4/4 na R1.<br>**Comparação:** o Pillow quebrou depois do reinício (`_imaging`); ela foi refeita com o ImageMagick, como na P5-F.1 |
| Evidência visual, capturas da R1 de novo (navegação no desktop, viewport móvel só na captura) | `visual-r1-capturas2` | **12/12**: 16 combinações, axe com 0 violações, sem transbordamento. Tema escuro aplicado: fundo `rgb(11, 17, 32)`. `role="alert"`, e o foco fica no botão usado. SHA-256 e `git status` iguais (`visual/LEIAME.md`) |
| Antes × depois, comparação | `comparar-antes-depois-r1.py` (`visual-r1-comparacao`) | **Configurações válidas:** prévia e rotina com 0 pixels diferentes. A página tem 32 px a mais, a linha nova da ajuda das rotinas; o resto é antisserrilhado de 1 px e um artefato da captura da P5-F.1. **Corrigido pela revisão 4 (Q02 e Q03):** a frase nova ocupa duas linhas; não há artefato, e os 84 px são antisserrilhado; o s3 mostrava a tela em edição sem edição. A comparação refeita está na rodada da revisão 4, abaixo.<br>**Outros estados:** só os avisos, o salvar desabilitado, a prévia indisponível e o Dashboard em reais (`visual/LEIAME.md`) |
| Correções da revisão 3 | `work-time-consistency` (`dirigidos-775db140`) | **30/30**, com os três testes do limite (P01) |
| Mutantes da espera pela hora do servidor, com os testes novos | `MUTANTES_SO=69,70,71,74,75` (`mutantes-r1-rev3`) | **5/5 mortos**, U74 (o mutante de 1 ms da revisão 3) e U75 inclusive. SHA-256 e `git status` iguais. Total: **75/75** |
| Suítes de tempo de trabalho na árvore `775db140` (a da revisão 4), numa cópia própria (`git archive`) | `test:unit:work-time` (`dirigidos-775db140`; cada arquivo sozinho, `dirigidos-775db140-por-arquivo`) | **158/158**, 0 skip, em 16 s: calendário 29, preferência 13, guarda 17, estimativa 23, retenção 21, consistência 30, cálculo 15, gramática 5 e paginação 5 |
| `verify:all` na árvore `775db140`, com o código revisado pela revisão 4, antes das correções dela | `verify-all-775db140-pre-revisao4` | Saída 0 em 2.527 s: 1.671 + 1.256 testes do node e **209 E2E**, 0 falha, 0 skip; lint com 0 erros e 205 avisos. Referência: não é o gate final, porque o Q02 mudou o código |
| Revisão independente 4, somente leitura, sobre a cópia fixa da árvore `775db140` | `revisoes/revisao-4.md` | **FAIL**, sem defeito no cálculo nem na prova:<br>• Q01 (LOW): os logs das revisões ficavam fora da árvore pelo `.gitignore` (`*.log`), e os documentos diziam que estavam nela;<br>• Q02 (LOW): uma configuração gravada que o editor recusa abria Configurações como editada, com um "Descartar alterações" que não descartava;<br>• Q03 e Q04 (INFO): evidência visual e textos |
| Q01: logs na árvore | `git status --ignored` na pasta da evidência | Os 58 logs ganharam a extensão `.txt` e entram na árvore; nenhum arquivo ignorado sobrou na pasta. O `empacotar.sh` copia a evidência da árvore final e para se o disco diferir dela |
| Q02: typecheck | `npm run typecheck` (`q02-typecheck`) | 1ª: TS2339, porque `!result.ok` não estreita o tipo neste projeto (o resto da tela usa `'message' in result`). A condição passou a usar a mesma forma. 2ª: saída 0. O log guarda só a 2ª, porque a 2ª execução sobrescreveu o arquivo |
| Q02: guarda | `work-time-guard` (`q02-guarda`) | **17/17**, com a fiação nova de `edited` |
| Q02: E2E dirigido, build novo | `run-pw.sh e2e-q02 … -g 'B02 \('` | **2/2** (o B02 com os passos novos e o N07), em 57 s. SHA-256 e `git status` iguais antes e depois |
| Q02: mutantes do E2E | `e2e-mutantes-q02.sh` (`e2e-mutantes-q02`) | **2/2 mortos**, cada um com build novo:<br>• q02a, o comportamento anterior da tela, reprova logo depois do `reload` (falta "Valor estimado da sua hora");<br>• q02b, o editor que nunca informa edição, reprova na edição de verdade (falta "Prévia com as alterações").<br>SHA-256 e `git status` iguais |
| Q02: mutantes de unidade | `MUTANTES_SO=56,76,77 run-mutantes.sh mutantes-r1-rev4` | **3/3 mortos**: U76 e U77, novos, e U56, o único de U1 a U75 que muda um dos dois arquivos alterados. Total: **77/77** |
| Q02: suítes do tempo de trabalho | `test:unit:work-time` (`q02-unit-work-time`) | **158/158**, 0 skip |
| Evidência visual depois da revisão 4 | `run-visual-r1-rev4.sh` (`visual-r1-capturas3`, `visual-r1-depois2`, `visual-r1-comparacao2`) | **Capturas:** 12/12, com o mouse fora do menu lateral antes da troca de largura e a conferência de oclusão: 16 combinações sem aviso coberto, axe 0 e sem transbordamento.<br>**"Depois":** 4/4; o "antes" é o mesmo.<br>**Comparação:** alinhada por coluna com a sonda da revisão 4. Em s3, o título, "Nada foi salvo ainda." e "Descartar alterações" não aparecem mais.<br>SHA-256 e `git status` iguais (`visual-r1-rev4.sha-*`) |
| `verify:all` final | ver "Gate completo", abaixo | **Saída 0**: 3.136 PASS, 0 FAIL, 0 SKIP, 0 RETRY |
| Revisão independente 5, somente leitura, sobre a cópia fixa da árvore `aff667a5` | `revisoes/revisao-5.md` | **FAIL para a R1 inteira**, de acordo com o FAIL dela. Q01 a Q04 corrigidos, e o código do Q02 sem defeito. Achados:<br>• S01 (MEDIUM): o B02 aberto no caso da véspera em jornada reduzida;<br>• S02 (LOW): `VEREDITOS.md` com valores da `775db140`;<br>• S03 a S07 (INFO): textos e dois testes que faltam.<br>Respostas só de documento (`revisoes/respostas-revisao-5.md`) |

## Gate completo

| Etapa | Comando | Resultado |
| --- | --- | --- |
| `verify:all` final, na árvore `aff667a5` (Java 21.0.12, Firebase CLI 15.32.1, Emulator `minhas-financas-local`), 02:34–03:15 | `run-verify-all.sh` (`verify-all-final`) | **Saída 0** em 2.502 s, sem interrupção:<br>• `verify:fast`: 1.671 testes do node em 18 scripts, 0 falha, 0 skip; typecheck e builds sem erro; lint das Functions com 0 erros e 201 avisos, os da P5-F.1;<br>• integração no Emulator, com todas as suítes de Rules: 1.256 testes em 21 scripts, 0 falha, 0 skip;<br>• E2E: 209 passed (18,0 min), 0 failed, 0 flaky, 0 skipped.<br>**3.136 PASS, 0 FAIL, 0 SKIP, 0 RETRY.** O Playwright só repete no CI, e `CI` não estava definido. Ao fim, nenhuma JVM órfã (`limpeza=0`) |
| `git diff --check` do delta | `git diff --check d9b33cd1 aff667a5` (`diff-check-aff667a5`) | Saída 0, sem nenhuma linha. A 1ª, na árvore `734dca48`, acusou 136 espaços no fim de linha nos logs das revisões copiados para a árvore (Q01). Eles foram tirados, e o resultado ficou em `diff-check-734dca48-1a` |
| Depois do `verify:all` | `patches/mudancas-depois-do-verify-all.txt` (no pacote) | Só arquivos em `docs/`: as respostas à revisão 5, a revisão 5 e o material dela, os vereditos, os textos de S01 a S07 e a §20.16 do plano |
| Avisos de ambiente | — | São os mesmos das execuções anteriores e não afetam os testes:<br>• `MetadataLookupWarning`: o SDK do Google procura o servidor de metadados, que o proxy recusa;<br>• o aviso de autenticação do Firebase CLI;<br>• `EAFNOSUPPORT` de IPv6 no Emulator |
