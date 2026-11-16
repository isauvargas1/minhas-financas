# P5-F.1-R2A — evidência visual, acessibilidade, teclado e antes × depois (S01)

## Condições

- **Ambiente:** build E2E (`npm run build:e2e`) contra o Emulator `minhas-financas-local`, com o Chromium do Playwright e a mesma fonte nas duas árvores.
- **Dados sintéticos:** os do E2E da P5-F (`seedTenant`). São um usuário de teste, um workspace PF e salários fictícios, criados pela callable real. Nenhum dado real.
- **Configuração do S01:** a preferência é gravada pelo `seedPreference` do E2E, com rotinas `W:20:00-06:00/0,00:00-08:00/0,-,-,-,-,-` (segunda 20:00–06:00, terça 00:00–08:00). A jornada reduzida a 480 min cai na primeira segunda do mês anterior.
- **Roteiros temporários:** `capturas-r2a.append.ts.txt` e `antes-depois-r2a.append.ts.txt`. São acrescentados a uma cópia de `e2e/work-time-p5f.spec.ts` só durante a execução e apagados depois. O SHA-256 de `src/`, `tests/` e `e2e/` e o `git status` do worktree ficaram iguais antes e depois (`../saidas/visual-r2a.sha-*`, `../saidas/visual-r2a.status-*`).
- **Acessibilidade:** axe-core com as regras WCAG 2.0/2.1 A e AA, no escopo de cada aviso. Também o transbordamento horizontal da página, a oclusão do centro do aviso, o foco depois da ação e as 4 paradas seguintes de Tab.

## Capturas dos estados novos (`capturas/`)

Em cada combinação (1440 × 900 e 390 × 844, claro e escuro, cada uma num contexto próprio), há a página, o recorte do aviso e um JSON.

| Estado | O que mostra |
| --- | --- |
| `referencia-previa` | As mesmas rotinas, sem a jornada reduzida: a prévia com valor |
| `s01-previa` | A jornada reduzida gravada: a prévia indisponível, com o motivo `ambiguous_reduced_eve` |
| `s01-configuracoes` | A recusa junto do botão de salvar (`role="alert"`), com a véspera, o dia e a rotina |
| `s01-calendario` | O calendário de exceções no mês da redução: a terça com "?" e o nome acessível "horas sem cálculo seguro: jornada reduzida na véspera" |
| `s01-dashboard` | O Dashboard em modo tempo: os valores continuam em reais, com o aviso |

**Resultado:** 8/8 testes, em `../saidas/visual-r2a-capturas.log.txt`. Em todas as 20 capturas:
- o axe acha 0 violações;
- não há transbordamento horizontal;
- o aviso não está coberto por outro elemento.

**Avisos e foco.**
- A recusa junto do botão de salvar tem `role="alert"` e não toma o foco.
- O calendário é um grupo com nome. O foco fica em "Mês anterior", o botão usado para chegar ao mês da redução, e o Tab segue para "Próximo mês" e os dias.
- No Dashboard móvel, o foco depois da ação fica vazio: o link "Dashboard" está no menu recolhido, invisível nessa largura (o mesmo da R1).

| Captura | Viewport | Tema (fundo) | Axe | Transbordamento | Aviso coberto | Papel | Foco depois da ação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `desktop-dark-referencia-previa` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `desktop-dark-s01-calendario` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | group | button: Mês anterior |
| `desktop-dark-s01-configuracoes` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | — |
| `desktop-dark-s01-dashboard` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | a: Dashboard |
| `desktop-dark-s01-previa` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | input: Semanal |
| `desktop-light-referencia-previa` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `desktop-light-s01-calendario` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | group | button: Mês anterior |
| `desktop-light-s01-configuracoes` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | — |
| `desktop-light-s01-dashboard` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | a: Dashboard |
| `desktop-light-s01-previa` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | input: Semanal |
| `mobile-dark-referencia-previa` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `mobile-dark-s01-calendario` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | group | button: Mês anterior |
| `mobile-dark-s01-configuracoes` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | — |
| `mobile-dark-s01-dashboard` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `mobile-dark-s01-previa` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | input: Semanal |
| `mobile-light-referencia-previa` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `mobile-light-s01-calendario` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | group | button: Mês anterior |
| `mobile-light-s01-configuracoes` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | — |
| `mobile-light-s01-dashboard` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `mobile-light-s01-previa` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | input: Semanal |

## Antes × depois (`antes/`, `depois/`, `recortes/`)

As capturas foram feitas no mesmo estado e na mesma viewport nas duas árvores, com o mesmo roteiro: a da R1 (`08d8c5a2`, numa cópia exata) e a da R2A. A comparação é pixel a pixel, sem tolerância (ImageMagick `compare -metric AE`), em `comparacao-antes-depois.json`. A caixa que contém as diferenças está no formato largura × altura + x + y.

| Imagem | Tamanho (antes → depois) | Pixels diferentes | Caixa das diferenças |
| --- | --- | --- | --- |
| `desktop-dark-referencia-previa.png` | 270x242 → 270x242 | 0 | — |
| `desktop-dark-referencia.png` | 1440x3917 → 1440x3917 | 0 | — |
| `desktop-dark-s01-previa.png` | 270x242 → 270x282 | tamanhos diferentes | — |
| `desktop-dark-s01.png` | 1440x3917 → 1440x3917 | 71745 | 328x643+940+321 |
| `desktop-light-referencia-previa.png` | 270x242 → 270x242 | 0 | — |
| `desktop-light-referencia.png` | 1440x3917 → 1440x3917 | 0 | — |
| `desktop-light-s01-previa.png` | 270x242 → 270x282 | tamanhos diferentes | — |
| `desktop-light-s01.png` | 1440x3917 → 1440x3917 | 71868 | 328x643+940+321 |
| `mobile-dark-referencia-previa.png` | 324x243 → 324x243 | 0 | — |
| `mobile-dark-referencia.png` | 390x5743 → 390x5743 | 0 | — |
| `mobile-dark-s01-previa.png` | 324x243 → 324x243 | 18147 | 315x184+0+25 |
| `mobile-dark-s01.png` | 390x5763 → 390x5875 | tamanhos diferentes | — |
| `mobile-light-referencia-previa.png` | 324x243 → 324x243 | 0 | — |
| `mobile-light-referencia.png` | 390x5743 → 390x5743 | 0 | — |
| `mobile-light-s01-previa.png` | 324x243 → 324x243 | 18203 | 315x184+0+25 |
| `mobile-light-s01.png` | 390x5763 → 390x5875 | tamanhos diferentes | — |

**Leitura:**
- **Referência:** 0 pixel diferente nas 4 combinações, na página e no cartão da prévia. A tela da configuração válida não mudou.
- **S01, desktop:** as diferenças ficam numa caixa de 328 × 643 na coluna da prévia. Entram nela o texto do cartão (na R1, "R$ 115,00" calculado sobre os 960 min impossíveis; na R2A, "Estimativa indisponível" com o motivo), a recusa junto do botão de salvar e o deslocamento dos botões abaixo dela, com o mesmo estilo (`recortes/desktop-light-s01-*-caixa.png`).
- **S01, celular:** a página cresce 112 px. As linhas são idênticas até y = 5.290 e nas últimas 238. A faixa que muda tem o cartão da prévia e a recusa (`recortes/mobile-light-s01-*-faixa.png`).
- Todas as diferenças são as do S01: a configuração passa a ser recusada, com a explicação. Não há mudança de layout, cor, fonte ou componente.

**Resultado:** 8/8 nas duas árvores (`../saidas/visual-r2a-depois.log.txt`, `../saidas/visual-r2a-antes.log.txt`).
