# Revisões independentes do delta da P5-F.1-R1

| Revisão | Árvore lida | Veredito | Respostas |
| --- | --- | --- | --- |
| [`revisao-1.md`](revisao-1.md) | `b97806c4` | FAIL (N01 a N10) | [`respostas-revisao-1.md`](respostas-revisao-1.md) |
| [`revisao-2.md`](revisao-2.md) | `d7dabb10` | FAIL (M01 a M09) | [`respostas-revisao-2.md`](respostas-revisao-2.md) |
| [`revisao-3.md`](revisao-3.md) | `6c459430` | FAIL (P01 a P06) | [`respostas-revisao-3.md`](respostas-revisao-3.md) |
| [`revisao-4.md`](revisao-4.md) | `775db140` | FAIL (Q01 e Q02 LOW; Q03 e Q04 INFO) | [`respostas-revisao-4.md`](respostas-revisao-4.md) |
| [`revisao-5.md`](revisao-5.md) | `aff667a5` | FAIL (S01 MEDIUM; S02 LOW; S03 a S07 INFO), de acordo com o FAIL da R1 | [`respostas-revisao-5.md`](respostas-revisao-5.md) |

**Sondas e logs:**
- `sondas-revisao-1/`: as sondas da revisão 1.
- `sondas-revisao-2/` e `logs-revisao-2/`: as da revisão 2 e os logs dela, também os da raiz da pasta de trabalho, como `unit-snap.log.txt` e os `antes-*.log.txt`.
- `sondas-revisao-3/` e `logs-revisao-3/`: as da revisão 3 e os logs dela.
- `sondas-revisao-4/`, `logs-revisao-4/` e `recortes-revisao-4/`: as sondas da revisão 4, os logs dela (com `integridade/`, a conferência da cópia) e os recortes de imagem.
- `sondas-revisao-5/`, `logs-revisao-5/` e `recortes-revisao-5/`: o mesmo para a revisão 5.
- Ficaram fora os mutantes e as cópias de árvore de cada revisão. São cópias de `src/` com uma linha trocada, descrita no relatório da revisão.

**Extensões.** O `.gitignore` do projeto ignora `*.log`. Por isso, na árvore, cada log tem a extensão `.txt` a mais: o `x.log` citado num relatório de revisão está em `x.log.txt`. Até a árvore `775db140`, eles ficavam fora dela (revisão 4, Q01). As sondas também são texto: `.mts.txt`, `.test.ts.txt`, `.test.ts.tail.txt` e `.py.txt`.

**Como rodar as sondas.** Nas cópias, o diretório temporário da sessão virou `<scratchpad>`, e os espaços no fim das linhas dos logs saíram, para o `git diff --check` do delta; o conteúdo é o mesmo.
- **`.mts.txt`:** copie para um nome sem o `.txt` (por exemplo, `b02-custo.mts`). O Node só tira os tipos de arquivos `.mts` e `.ts`, e com o `.txt` dá `SyntaxError`. Depois, rode `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <sonda>.mts <raiz da árvore>`, numa árvore com `node_modules`.
- **`.test.ts.txt`:** os testes importam `../../src/…`. Copie-os sem o `.txt` para `tests/unit/` de uma cópia da árvore e rode `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/unit/<sonda>.test.ts` de dentro dela.
- **`.test.ts.tail.txt`:** o trecho que a revisão acrescentou ao fim do teste de mesmo nome, que usa o mundo de teste dele.
- **`.py.txt`:** rode com `python3 -I`, como no §8 de `revisao-4.md`.

Duas sondas de gancho (`sondas-revisao-1/b03-gancho.mts.txt` e `sondas-revisao-2/b03-gancho-rev1.mts.txt`) fixam na linha 6 o caminho de `node_modules` (`const nm = '<scratchpad>/…/node_modules'`). Para rodá-las, troque esse valor por `` `${root}/node_modules` ``, como fez a revisão 3 (`logs-revisao-3/rev1-b03-gancho-r3.log.txt`).
