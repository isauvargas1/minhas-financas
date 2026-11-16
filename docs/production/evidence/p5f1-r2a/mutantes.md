# P5-F.1-R2A — mutantes

Cada mutante muda uma regra do código novo. O teste correspondente precisa **reprovar**.

**Como os roteiros rodam:**
- aplicam um trecho exato, com uma ocorrência só;
- conferem a sintaxe com o esbuild;
- rodam os testes;
- restauram o arquivo byte a byte, conferindo o SHA-256;
- registram o SHA-256 de `src/`, `tests/` e `e2e/` e o `git status` antes e depois.

**Roteiros** (em `roteiros/`, no pacote):
- `mutantes-r2a.py`, `run-mutantes.sh` e `run-mutantes-copia.sh`: unidade. As rodadas finais rodaram numa cópia exata da árvore final (`git archive` de `cf9cb2a9`, com `node_modules` por link). Assim, o worktree ficou livre para a evidência visual e o `verify:all`;
- `e2e-mutante-r2a.py` e `e2e-mutantes-r2a.sh`: E2E, cada um com build novo;
- `mutantes-r1-na-r2a.py`: a lista da R1, refeita.

## Unidade (R2A): 38 mutantes na árvore final

**Rodadas:**
- 1ª rodada, na árvore `5a7dad57` (`saidas/mutantes-r2a-1.log.txt`): 32/34. Sobreviveram dois mutantes da combinação dos extremos:
  - U4: ignorar a ambiguidade do extremo "turno inteiro";
  - U5: devolver o plano desse extremo em vez do da véspera sem nada.
- O teste novo "o dia seguinte só tem cálculo seguro com os dois extremos seguros, e o plano mostrado é o da véspera sem nada" mata os dois.
- 2ª rodada (`MUTANTES_SO=4,5`, `saidas/mutantes-r2a-2.log.txt`): 2/2.
- 3ª rodada, na árvore `cf9cb2a9` (`saidas/mutantes-r2a-3.log.txt`): **35/35**, em 558 s. Inclui o U29, da memória por chamada do conferidor.
- 4ª rodada, na árvore `63e4c3c6`, depois da primeira correção da revisão independente: **37/37**, em 689 s. O resumo está em `saidas/mutantes-arvore-63e4c3c6/`.
  - O U11 passou a ser o contrário: volta a descontar a véspera no máximo, a regra anterior à correção R2A-01. Morre pelos testes R2A-01.
  - Entraram U30 e U31, que tiram a conferência do objeto na memória (os M26 e M28 da revisão, T07). Morrem pelo teste novo da memória de um calendário só.
  - A âncora do U25 acompanhou o texto novo da mensagem.
- 5ª rodada, na árvore final do código `cd95e1cb`, com a variante do T13 (`saidas/mutantes-r2a-final.log.txt`): **38/38** mortos.
  - O U11 desconta a véspera também no dia 1: é a regra de antes da R2A-01. Morre pelos testes R2A-01 e pelo caso de 01/06.
  - O U38, novo, nunca desconta a véspera: é a regra estrita de `63e4c3c6`. Morre pelo caso da segunda 05/10, aceita com 60.
- Arquivos: o SHA-256 de 408 arquivos ficou igual em todas as rodadas. Nas duas primeiras, o `git status` do worktree também ficou igual.

| # | Regra mutada | Teste que reprova |
| --- | --- | --- |
| U1 | o dia seguinte ignora a véspera incerta (o motor da R1) | S01 do parecer, preferência e estimativa |
| U2 | o dia seguinte desconta o turno inteiro da véspera incerta | casos comuns e recusa do plantão |
| U3 | aceitar com os dois extremos seguros, sem comparar os minutos | S01 do parecer |
| U4 | aceitar sem conferir o extremo "turno inteiro" | dois extremos seguros (2ª rodada) |
| U5 | mostrar o plano do extremo "turno inteiro" | dois extremos seguros (2ª rodada) |
| U6 | `reducedEve` sempre falso | `reducedEveDays`, motivo da estimativa |
| U7–U10 | a véspera reduzida sempre certa, sempre incerta, sem as durações no máximo, ou com `<` no lugar de `<=` | S01 (redução de 10 h), duração de 2 h, propriedade do oráculo |
| U11 | o máximo desconta a véspera que segue a rotina também no dia 1 (a regra antes da R2A-01) | dia que abre o período (R2A-01, dirigido e propriedade) e a segunda 01/06 |
| U12 | o dia que segue a rotina também fica incerto (a guarda `flags.reduced === null` some) | S01 sem a redução e casos comuns |
| U13 | a véspera sempre pela regra da R1 (`followedWindowsOn`) | S01 |
| U14 | o dia seguinte incerto entra como vizinho | cobertura pela véspera reduzida |
| U15 | `reducedEveDays` vazio | S01 e estimativa |
| U16–U23 | o conferidor: sem a passada nova, o atalho antigo, os filtros invertidos, o último dia reduzido fora, a causa do vizinho no lugar da véspera, a janela que passa da meia-noite medida no próprio dia | S01, plantão, cobertura, propriedade do conferidor |
| U24–U26 | a mensagem: seção, datas trocadas, lista das rotinas | preferência |
| U27–U28 | o motivo da estimativa | estimativa |
| U29 | a memória do conferidor sobrevive à chamada (sem a restauração no `finally`) | a memória vale só durante a chamada |
| U30–U31 | a memória sem conferir o objeto do calendário (bandeiras e janelas de vizinho) | a memória é de um calendário só |
| U32–U37 | o S03: a chave com a jornada para aplicar (`mut-tpl`), `edited` falso na digitação inválida, `edited` verdadeiro na recusa ao montar, `edited` constante, aplicar em todos os dias, o botão sem `applyTemplate` | S03 de unidade e guarda |
| U38 | o máximo nunca desconta a véspera (a regra estrita, antes do T13) | a segunda 05/10 do caso domingo/segunda de 24 h, aceita com 60 |

## E2E (R2A): 6/6

Cada mutante teve build novo. O `e2e-mutante-r2a.py` conferiu o SHA-256 de cada arquivo, e o roteiro conferiu o de `src/`, `tests/` e `e2e/`, além do `git status`.

**Rodadas:**
- 1ª, na árvore `5a7dad57`: 6/6 (`saidas/e2e-mutantes-1-arvore-5a7dad57/`);
- 2ª, na árvore `63e4c3c6`, com as mensagens novas: 6/6 em 630 s, com SHA-256 e `git status` iguais (`saidas/e2e-mutantes-final.*`).

A árvore final `cd95e1cb` só muda a regra do dia 1 no motor e o teste de unidade. As âncoras e os testes E2E desses mutantes são os mesmos.

| Mutante | O que muda | Onde reprova |
| --- | --- | --- |
| tpl (revisão 5) | a chave das rotinas inclui a jornada para aplicar | B02 (P5-F.1-R1): `notEditing` depois de mudar só o "Fim" da jornada (recebe "Prévia com as alterações") |
| tplfail (revisão 5) | um ramo engole a recusa por digitação inválida | B02 (P5-F.1-R1): espera "Prévia com as alterações" depois de apagar o "Fim" de segunda (recebe "Valor estimado da sua hora") |
| s01a | o motor da R1 (a véspera reduzida ignorada) | S01 (P5-F.1-R2A): a estimativa gravada deveria ficar indisponível |
| s01b | o conferidor com o atalho antigo | S01: o aviso junto do botão de salvar não aparece |
| s01c | o motivo da estimativa sempre o das rotinas | S01: o texto da prévia indisponível |
| s01d | o nome acessível do dia sem a causa da véspera | S01: o dia do calendário de exceções |

## A lista da R1 na árvore R2A

Os 77 mutantes de unidade da R1 foram refeitos nas árvores da R2A, sempre com o SHA-256 dos 408 arquivos igual antes e depois:
- `cf9cb2a9`: **77/77**, em 1.109 s (`saidas/mutantes-r1-na-r2a-2.log.txt`);
- `63e4c3c6`: **77/77**, em 1.122 s (`saidas/mutantes-arvore-63e4c3c6/`);
- final, `cd95e1cb`: **77/77** mortos (`saidas/mutantes-r1-na-r2a-final.log.txt`).

A primeira rodada, na árvore sem a memória, foi interrompida de propósito. A rodada anterior, na árvore sem a memória, foi interrompida de propósito para a otimização; o roteiro restaurou o arquivo em teste. Cinco trechos mudaram de lugar e foram adaptados (comentário `R2A` em cada um, em `mutantes-r1-na-r2a.py`):
- U7: `holidayOff` saiu de `planDay`;
- U9: o bloco da estimativa ambígua ganhou o motivo novo;
- U46: `happensWith`;
- U51: o atalho do conferidor;
- U77: a lógica de `edited` foi para `routineModels.ts`.
