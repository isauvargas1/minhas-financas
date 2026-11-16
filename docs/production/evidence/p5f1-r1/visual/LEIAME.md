# P5-F.1-R1 — evidência visual, acessibilidade, teclado e antes × depois

## Condições

- **Ambiente:** build E2E (`npm run build:e2e`) contra o Emulator `minhas-financas-local`, com o Chromium do Playwright. A fonte é a do contêiner, a mesma nas duas árvores.
- **Dados sintéticos:** os do E2E da P5-F (`seedTenant`): um usuário de teste, um workspace PF e salários fictícios criados pela callable real, que dão R$ 25,00 por hora numa rotina de 8 h. Nenhum dado real.
- **Roteiros temporários:** `capturas-r1.append.ts.txt` e `antes-depois-r1.append.ts.txt`. São acrescentados a uma cópia de `e2e/work-time-p5f.spec.ts` só durante a execução, para usar os mesmos ajudantes, e apagados depois. O SHA-256 de `src/`, `tests/` e `e2e/` e o `git status` do worktree são iguais antes e depois (`logs/execucoes/visual-r1-*.sha-*`).
- **Acessibilidade:** axe-core com as regras WCAG 2.0/2.1 A e AA, no escopo de cada aviso.
- **Transbordamento horizontal:** `scrollWidth − clientWidth` da página.
- **Teclado:** o elemento com foco depois da ação e as 4 paradas seguintes de Tab.

## Capturas dos estados novos (`capturas/`)

São 32 imagens (16 páginas e 16 recortes do aviso) e 16 JSON. Para cada combinação (1440 × 900 e 390 × 844, claro e escuro, cada uma num contexto próprio), há a página e o recorte do aviso, além de um JSON com:
- o tema efetivo e a cor de fundo;
- as violações do axe e o transbordamento;
- o papel (`role`), o foco, a sequência de Tab e o texto.

A navegação dos ajudantes do teste é a do desktop. A página é aberta em 1440 × 900, e a viewport móvel é aplicada para a captura: o layout é responsivo à largura.

| Estado | O que mostra |
| --- | --- |
| `b02-editor` | Configurações: a rotina 11:00–14:00 com 1 h cruza a pausa do almoço. Aparece o aviso do editor (`role="alert"`), e salvar fica desabilitado |
| `n07-configuracoes` | Configurações: a folga na próxima terça tira a cobertura do turno de segunda. Aparece o aviso junto do botão de salvar, e salvar fica desabilitado |
| `b02-gravada-previa` | Uma configuração com cruzamento já gravada: a prévia indisponível, com o motivo |
| `b02-gravada-dashboard` | A mesma, no Dashboard em modo tempo: os valores continuam em reais, com o aviso |

**Resultado** (`logs/execucoes/visual-r1-capturas3.log`, depois das correções da revisão 4): 12/12 testes. Em todas as 16 combinações, o axe acha 0 violações, não há transbordamento horizontal e o aviso não está coberto por outro elemento. O tema escuro foi aplicado: o fundo é `rgb(11, 17, 32)`, contra `rgb(249, 250, 251)` no claro.

Os avisos do editor e de Configurações têm `role="alert"` e não tomam o foco. Ele fica no botão que a pessoa usou ("Aplicar aos dias marcados", "Incluir exceção"), e o Tab segue para os controles seguintes na ordem da tela. A sequência de cada caso está no JSON.

**Menu lateral (revisão 4, Q03).** A navegação clica no menu lateral em 1440 px, e o menu se expande no hover. Nas capturas anteriores, a troca para 390 px era feita com o mouse ainda sobre ele, e o menu aberto cobria o aviso do Dashboard móvel (`toBeVisible` não detecta oclusão). Agora o roteiro tira o mouse do menu antes de mudar a largura e confere no centro do aviso que nenhum outro elemento o cobre (`occluded` no JSON). No Dashboard móvel, o foco depois da ação fica vazio: o link "Dashboard" está no menu recolhido, invisível nessa largura.

A 1ª rodada (`visual-r1-capturas`) tinha 6 falhas, todas no roteiro, não no produto: as 390 × 844 abriam a página já na largura móvel, e o ajudante de navegação do teste só conhece o menu do desktop.

| Captura | Viewport | Tema (fundo) | Axe | Transbordamento | Aviso coberto | Papel do aviso | Foco depois da ação |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `desktop-dark-b02-editor` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | button: Aplicar aos dias marcados |
| `desktop-dark-b02-gravada-dashboard` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | a: Dashboard |
| `desktop-dark-b02-gravada-previa` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `desktop-dark-n07-configuracoes` | 1440 × 900 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | button: Incluir exceção |
| `desktop-light-b02-editor` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | button: Aplicar aos dias marcados |
| `desktop-light-b02-gravada-dashboard` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | a: Dashboard |
| `desktop-light-b02-gravada-previa` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `desktop-light-n07-configuracoes` | 1440 × 900 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | button: Incluir exceção |
| `mobile-dark-b02-editor` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | button: Aplicar aos dias marcados |
| `mobile-dark-b02-gravada-dashboard` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `mobile-dark-b02-gravada-previa` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | — | — |
| `mobile-dark-n07-configuracoes` | 390 × 844 | dark (rgb(11, 17, 32)) | 0 | 0 | não | alert | button: Incluir exceção |
| `mobile-light-b02-editor` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | button: Aplicar aos dias marcados |
| `mobile-light-b02-gravada-dashboard` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `mobile-light-b02-gravada-previa` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | — | — |
| `mobile-light-n07-configuracoes` | 390 × 844 | light (rgb(249, 250, 251)) | 0 | 0 | não | alert | button: Incluir exceção |

## Antes × depois (`antes/`, `depois/`, `comparacao-antes-depois.json`)

Mesmos dados, mesmo estado e mesma viewport (1440 × 900, claro), na árvore da P5-F.1 (`d9b33cd1`, cópia extraída) e na da R1. O roteiro não afirma o comportamento de nenhuma das duas: registra o que aparece e captura a página inteira e as regiões tocadas pela R1. A comparação usa o ImageMagick, sem tolerância, como na P5-F.1.

**Rodadas:**
- o "antes" é o da 1ª rodada (`visual-r1-antes`), porque a árvore da P5-F.1 não mudou;
- o "depois" foi refeito depois das correções da revisão 4 (`visual-r1-depois2`, com o build das capturas), e a comparação também (`visual-r1-comparacao2`);
- o SHA-256 de `src/`, `tests/` e `e2e/` e o `git status` do worktree são iguais antes e depois (`visual-r1-rev4.sha-*`).

**Alinhamento por coluna.** As páginas inteiras foram alinhadas linha a linha com a sonda da revisão 4 (`revisoes/sondas-revisao-4/alinhar.py.txt`). A coluna das seções (x 0–939) e a da prévia (x 940–1439) foram alinhadas separadamente, porque uma diferença de altura numa coluna desalinha as linhas da outra.

| Estado | P5-F.1 | R1 | Comparação |
| --- | --- | --- | --- |
| `s0` Configurações com rotinas válidas | prévia R$ 25,00, sem aviso | igual | **Prévia e rotina: 0 pixels diferentes;** a coluna da prévia é igual linha a linha.<br>**A ajuda das rotinas ganhou uma frase**, que começa no fim da última linha e ocupa mais duas linhas (32 px; `recortes/s0-ajuda-*.png`).<br>**Sobram 84 pixels esparsos, nenhum de layout:**<br>• 46 no interruptor "Trabalho normalmente em feriados" (antisserrilhado, delta até 37/255; `recortes/s0-interruptor-feriados-*.png`);<br>• 10 nos cantos do seletor de UF (delta 1);<br>• 4 no calendário, dois pontos de 1 × 2 (delta 1);<br>• 24 em cantos arredondados (delta até 8).<br>A versão anterior deste texto falava em "texto de um seletor sobreposto", que não existe (revisão 4, Q03) |
| `s1` A rotina que cruza a pausa do almoço, no editor | aceita, salvar habilitado, prévia R$ 25,00 | o aviso do editor, salvar desabilitado, prévia R$ 25,00 | Rotina 3 e prévia: 0 pixels diferentes. A página cresce pelo aviso do editor (64 px) e pelas duas linhas da ajuda (32 px). Na coluna da prévia, só o botão de salvar muda (desabilitado). Na página alinhada, sobram 11 pixels de antisserrilhado (delta até 4), 2 deles no calendário (um ponto de 1 × 2, delta 1) |
| `s2` A folga que tira a cobertura | aceita, salvar habilitado, prévia R$ 123,08 | o aviso junto do salvar, salvar desabilitado, prévia R$ 117,95 | A prévia muda porque a B02 conta a união dos turnos, e não cada janela com o próprio intervalo. O calendário marca o dia sem cálculo seguro |
| `s3` A configuração com cruzamento já gravada, em Configurações | prévia R$ 25,00 | prévia indisponível, com o motivo e o aviso do editor; sem edição, a tela não está em edição | **Coluna da prévia:** só o conteúdo da prévia muda (o motivo no lugar do valor). Fora dele, há 8 pixels de antisserrilhado nos cantos do botão "Excluir meus dados" (delta 1), 20 linhas abaixo por causa da prévia, e 640 pixels do aviso do topo, cujo texto passa de x = 940. O título continua "Valor estimado da sua hora", e não aparecem "Nada foi salvo ainda." nem "Descartar alterações" (`recortes/s3-coluna-direita-lado.png`).<br>**Coluna das seções:** o aviso do topo, o do editor (64 px), as duas linhas da ajuda (32 px) e o calendário com os dias sem cálculo seguro. Sobram 126 pixels de antisserrilhado (delta até 8), nenhum de layout (revisão 5, S04).<br>**Antes da correção do Q02** (revisão 4), a R1 abria essa tela como editada, com o título "Prévia com as alterações", "Nada foi salvo ainda." e um "Descartar alterações" que não descartava. Esta comparação não registrava isso |
| `s4` A mesma, no Dashboard em modo tempo | 8 valores convertidos, com o aviso de estimativa aproximada | nenhum valor convertido, em reais, com o aviso de indisponível | A mudança está só nos valores (de tempo para reais) e no texto do aviso. As linhas de "Transações recentes" quebram em duas porque os valores em reais são mais largos |

Fora dos avisos, dos textos e dos valores que a B02 e a B03 mudam, nada mudou na interface: nem layout, nem estilo, nem navegação. Isso vale nos cinco estados, conferido por coluna.
