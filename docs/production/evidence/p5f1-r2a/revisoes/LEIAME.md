# Revisões independentes do delta da P5-F.1-R2A

As três rodadas foram feitas pelo mesmo revisor, só em leitura e em cópias dele. Ele não usou Emulator, E2E, rede nem segredos, e não escreveu no worktree.

| Rodada | Árvore lida | Veredito | Respostas |
| --- | --- | --- | --- |
| [`revisao-r2a-1.md`](revisao-r2a-1.md) | `5a7dad57` e, pelo adendo, `cf9cb2a9` | FAIL: T01 HIGH, a regressão no dia que abre o período; T02, a prova do B03; T03 MEDIUM; T04 a T06 LOW; T07 a T12 INFO | [`respostas-revisao-r2a-1.md`](respostas-revisao-r2a-1.md) |
| [`revisao-r2a-2.md`](revisao-r2a-2.md) | `63e4c3c6` | FAIL só pelo B03; T01, T02, T07, T08 e T11 resolvidos; T13 LOW novo | [`respostas-revisao-r2a-2.md`](respostas-revisao-r2a-2.md) |
| [`revisao-r2a-3.md`](revisao-r2a-3.md) | `cd95e1cb` (código final) | sem achado de código aberto em nenhuma severidade; a variante adotada para o T13 é a da revisão, com 29/29 mutantes do revisor mortos, 0 violações de solidez e monotonia e a mesma aceitação de `cf9cb2a9`; T03 a T06 eram documentais e estão no pacote; FAIL só pelo B03 | — |

**Outros arquivos:**
- `pedido-revisao-r2a-1.md`: o pedido da primeira rodada. As rodadas 2 e 3 foram pedidas por mensagem, com o delta de cada uma; os deltas saem de `git diff` entre as árvores citadas.
- `sondas-revisao-r2a/`: as sondas do revisor (`.mts.txt` e `.py.txt`).
- `logs-revisao-r2a/`: os logs do revisor, com o prefixo `r2a2-` na rodada 2 e `r2a3-` na rodada 3.
- Ficaram fora as cópias de árvore do revisor (`saida/r1`, `final`, `r2a2`, `r2a3` e as instrumentadas). Cada uma é uma árvore citada acima, extraída por `git archive`; as instrumentadas têm uma linha de `export` a mais no fim de `calendar.ts`.

**Extensões e reprodução.** Iguais às de `p5f1-r1/revisoes/LEIAME.md`:
- **Nomes:** o `x.log` citado num relatório está em `x.log.txt`, e as sondas são texto. Para rodar uma sonda, copie-a para um nome sem o `.txt` e rode `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda>.mts <raiz da árvore>`, numa árvore com `node_modules`.
- **Conteúdo:** nas cópias, o diretório temporário da sessão virou `<scratchpad>`, e os espaços no fim das linhas saíram.
