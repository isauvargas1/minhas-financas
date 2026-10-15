# Reprodução determinística do defeito do `AnimatePresence` (framer-motion 10.16.4)

Página mínima, fora do app e da suíte, com as mesmas versões do app: React 18.2.0, react-dom 18.2.0 e framer-motion 10.16.4. Ela mostra que um item que começa a sair logo depois de outro terminar fica preso no DOM (opacidade 0, altura 0), e que o padrão usado no painel resolve: re-renderizar o pai a cada `onExitComplete`, com atualização funcional.

Parâmetros da página: `?fix=1` liga a correção, `?layout=1` põe `layout` nas linhas e `?n=` define o número de itens (padrão 3).

Como rodar, a partir da raiz do repositório:

```
NODE_PATH=node_modules npx esbuild <dir>/harness.jsx --bundle --format=iife --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --minify --outfile=<saída>/harness.js
NODE_PATH=node_modules node <dir>/run-harness.cjs  <saída>/harness.js   # corrida, 20 vezes com e sem a correção
NODE_PATH=node_modules node <dir>/run-harness2.cjs <saída>/harness.js   # corrida, sobreposição e varredura de atrasos, com e sem layout
NODE_PATH=node_modules node <dir>/run-harness3.cjs <saída>/harness.js   # estresse com 6 remoções em intervalos aleatórios, 50 vezes
```

Resultados (2026-10-13, Chromium do Playwright 1.60):

| Roteiro | Sem a correção | Com a correção |
| --- | --- | --- |
| Corrida ([resultado](resultado-corrida.txt)) | preso em 20/20 | 0/20 |
| Cenários, com e sem `layout` ([resultado](resultado-cenarios.txt)) | corrida 20/20; sobreposição 0/20; varredura: preso só com atraso de 0–12 ms | 0 em todos |
| Estresse, rodada 1 ([resultado](resultado-estresse-1.txt)) | sem `layout` 0/50; com `layout` 3/50 | 0/50 nos dois |
| Estresse, rodada 2 ([resultado](resultado-estresse-2.txt)) | sem `layout` 7/50; com `layout` 0/50 | 0/50 nos dois |

A rodada 1 do estresse rodou com a versão anterior da página, que tinha 8 itens fixos (o mesmo que `?n=8`); as demais, com a versão atual.

Sem a correção, a frequência no estresse varia de rodada para rodada e não acompanha o `layout`: o que decide é o atraso entre o fim de uma saída e o início da seguinte. Com a correção, nenhum item ficou preso em nenhum roteiro.
