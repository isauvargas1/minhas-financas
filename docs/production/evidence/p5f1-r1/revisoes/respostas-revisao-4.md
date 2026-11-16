# P5-F.1-R1 — respostas à revisão independente 4 (2026-11-06)

A revisão 4 (`revisao-4.md`) leu a árvore `775db140` e terminou em **FAIL**, sem defeito no cálculo nem na prova:
- P01, P02, P03, P05 e P06 da revisão 3: corrigidos;
- P04: não corrigido (é o Q01).

O FAIL veio de dois achados LOW (Q01 e Q02). Houve ainda dois INFO (Q03 e Q04).

Onde há teste novo, o "antes" é o mutante que devolve o comportamento da árvore `775db140` (q02a).

## Q01 — LOW — os logs que as respostas diziam estar na árvore não estavam

| Item | Conteúdo |
| --- | --- |
| Causa | O `.gitignore` do projeto ignora `*.log`. Os 58 logs de `logs-revisao-2/`, `logs-revisao-3/` e `sondas-revisao-2/` estavam no disco do worktree, mas fora da árvore, do patch e da fonte do pacote. |
| Correção | • Cada log ganhou a extensão `.txt` e entra na árvore. `git status --ignored` na pasta da evidência não lista mais nada.<br>• As citações de `respostas-revisao-3.md` e de `revisoes/LEIAME.md` usam os nomes novos.<br>• O `LEIAME.md` explica a extensão: o `x.log` citado num relatório de revisão está em `x.log.txt`.<br>• O material da revisão 4 também está na árvore: o relatório, as sondas (`.py.txt`, `.mts.txt`), os logs, a conferência da cópia (`logs-revisao-4/integridade/`) e os recortes. |
| Pacote | O `empacotar.sh` copiava a evidência do disco (`cp -r`), e um arquivo ignorado iria para o pacote sem estar na árvore. Agora ela sai da árvore final (`git archive`), e o roteiro para se o disco diferir dela nessa pasta. |

## Q02 — LOW — uma configuração gravada que o editor recusa abria Configurações como editada

| Item | Conteúdo |
| --- | --- |
| Causa | Na P5-F.1, um resultado recusado do editor de rotinas só vinha de digitação da pessoa, e a tela o tratava como edição. Na R1, o editor também recusa uma configuração gravada que se cruza com intervalo, logo ao montar. Por isso a tela abria com:<br>• o título "Prévia com as alterações";<br>• "Nada foi salvo ainda.";<br>• um "Descartar alterações" que não descartava: o editor montava de novo e marcava a edição outra vez.<br>Além disso, enquanto a tela estava "editada", o rascunho deixava de seguir o salvo. |
| Correção | • `RoutineEditor.tsx`: o resultado recusado leva `edited`, verdadeiro só quando os dias ou a escala de alguma rotina mudaram desde a montagem. A jornada para aplicar a vários dias só conta quando é aplicada. Esse caso e o da digitação inválida não têm teste próprio (revisão 5, S03).<br>• `WorkTimeSettingsView.tsx`: só `'message' in result && result.edited` põe a tela em edição. A forma `'message' in result` é a que o resto da tela usa; `!result.ok` não estreita o tipo neste projeto, e o typecheck reprovou na 1ª tentativa.<br>Agora a configuração gravada e recusada abre com o título "Valor estimado da sua hora", sem a nota e sem "Descartar alterações", e com salvar desabilitado. Uma correção feita em outro dispositivo entra na tela. |
| Testes | **E2E "B02 (P5-F.1-R1)"**, depois do `reload`, com quatro passos novos:<br>• a tela fora de edição;<br>• uma edição de verdade que mantém o cruzamento (11:00–15:00 com 60 min) põe a tela em edição;<br>• "Descartar alterações" volta ao gravado, tira a tela da edição e não grava nada;<br>• a correção feita em outro dispositivo entra, sem o aviso de conflito.<br>**Resultados:** E2E 2/2 (o B02 e o N07). Guarda 17/17, com a fiação nova. Suítes do tempo de trabalho 158/158. |
| Mutantes | **E2E, cada um com build novo:**<br>• q02a, o comportamento da árvore `775db140`: reprova logo depois do `reload`, porque falta "Valor estimado da sua hora";<br>• q02b, o editor que nunca informa edição: reprova na edição de verdade, porque falta "Prévia com as alterações".<br>**Unidade:** U76 e U77, os mesmos dois pela guarda, e de novo o U56, o único dos anteriores nesses arquivos: 3/3. Total: 77/77 de unidade e 5/5 do E2E. |
| Evidência | Refeitos as capturas e o "depois" do antes × depois, com a mesma configuração.<br>• No s3, a coluna da prévia só muda no conteúdo dela (o motivo no lugar do valor), fora antisserrilhado nos cantos do botão "Excluir meus dados" e o texto do aviso do topo (`visual/recortes/s3-coluna-direita-lado.png`). A versão anterior desta linha atribuía os 8 pixels à borda do cartão (revisão 5, S04).<br>• `visual/LEIAME.md` registra o estado anterior e a correção. |

## Q03 — INFO — evidência visual

| Item | Correção |
| --- | --- |
| (a) Dashboard móvel encoberto pelo menu lateral | O roteiro tira o mouse do menu antes de mudar a largura e confere, no centro do aviso, que nenhum outro elemento o cobre (`occluded` no JSON e asserção). As 16 combinações foram refeitas: nenhum aviso coberto, axe 0 e sem transbordamento. No Dashboard móvel, o foco depois da ação agora fica vazio: o link do menu recolhido fica invisível nessa largura. |
| (b) A explicação dos 84 px | Refeita com a sonda da revisão, nas capturas novas: 46 px no interruptor de feriados (delta até 37/255), 10 nos cantos do seletor de UF, 4 no calendário e 24 em cantos arredondados. Não há texto sobreposto. Os recortes do argumento errado saíram, e entraram os do interruptor. |
| (c) A ajuda das rotinas | A frase nova ocupa duas linhas (32 px). |
| (d) O s1 | Os 11 pixels da página alinhada, 2 deles no calendário, agora estão na tabela. |
| Método | O alinhamento passou a ser por coluna: a das seções e a da prévia separadas, porque uma diferença de altura numa coluna desalinha as linhas da outra. |

## Q04 — INFO — imprecisões de texto

| Onde | Correção |
| --- | --- |
| `mutantes.md` | U74 morre nos testes do N03 com a hora do servidor e de 59 s; U75, no de 60 s. |
| `execucoes.md` | "Horários em UTC, de 2026-11-05 e 2026-11-06"; a rodada U1 a U73 foi às 00:27–00:43. |
| `rotinas-matematica.md` §2 | O parágrafo "Fora do horizonte" saiu do meio do de `validateDraft` e ficou depois da lista de solidez. |
| `DATA_MODEL.md` e `consistencia-estimativa.md` §5 | Dizem "por até 30 s", e a frase seguinte diz como eles contam, com o caso das bases em cache. |
| `revisoes/LEIAME.md` e `LEIAME.md` | Como rodar cada tipo de sonda: tirar o `.txt` dos `.mts`, porque o Node só tira os tipos de `.mts` e `.ts`; os `.test.ts` vão para `tests/unit/` de uma cópia e rodam com `--test`; os `.tail` são trechos acrescentados ao fim de um teste; os `.py`, com `python3 -I`. |

## Além do pedido

- **Lint:** os 4 avisos de linha longa que a R1 tinha posto em dois testes do backend saíram. O lint das Functions voltou a 201 avisos e 0 erros, os números da P5-F.1.
- **Veredito da R1:** continua **FAIL**, pelo B03 aberto nos casos (a), (b) e (c) de `consistencia-estimativa.md` §6, como no relatório.

## Depois das correções

- **Código:** em `src/`, só `RoutineEditor.tsx` e `WorkTimeSettingsView.tsx`, na fiação de `edited`.
- **Testes:** a guarda, o E2E do B02 e os dois testes do backend, estes só na quebra de linhas.
- **Execuções:** o `verify:all` final roda sobre a árvore corrigida, e a revisão independente 5, somente leitura, confere estas correções (`revisao-5.md`).
