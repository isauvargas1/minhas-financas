# Acessibilidade do painel de notificações e do seletor de período (P5-GATE-FINAL: PTBR-02 a PTBR-05)

Correções autorizadas pelo usuário na P5. Critério: WCAG 2.2 nível AA, nas regras aplicáveis; sem mudança de cor nem
de layout no tema claro (o **estado de foco** mudou nos dois temas: o contorno padrão do navegador virou um anel de 2 px,
ver §5) e sem mudança na identidade visual; elementos HTML nativos em vez de atalhos próprios. A §5 registra a 2ª
revisão (PTBR2-01 a PTBR2-07), feita depois da 2ª rodada de revisões e aprovada pela execução oficial `verify-all-p5gate-4`
(saída 0, 230 E2E) e pela 3ª rodada de revisões; aprovado no código pelo gate final (a P5 aguarda só a evidência do E-00).

## 1. O que mudou

| Achado | Correção | Arquivos |
| --- | --- | --- |
| PTBR-02 (P5-D1): "Carregar mais", "Carregando…" e "Tentar novamente" abaixo de 4,5:1 no tema escuro | No escuro, o texto na cor do espaço usa `dark:text-primary-on-dark` (o tom mais claro do mesmo matiz, já usado no Header). O claro não muda. Foco pelo teclado com anel visível (`focus-visible:ring-2`, por dentro nos controles em área com corte) | `src/components/NotificationsPanel.tsx` |
| Mesmo débito no mesmo painel (PTBR-06, parte do painel): chip de não lidas, "Marcar exibidas como lidas", rótulo de ação | Mesma correção (problema diretamente relacionado, no mesmo componente). O badge do Header e os títulos de "Condições do período" continuam fora (P9) | `src/components/NotificationsPanel.tsx` |
| PTBR-03: aviso não acionável pelo teclado | O título de cada aviso é um `<button>` nativo (alcançável por Tab; Enter e Espaço nativos), com a mensagem como descrição acessível (`aria-describedby`); faz o mesmo que o clique (marca como lido e, com destino, abre a tela). Ordem do Tab: cabeçalho, cada aviso e as ações dele, "Carregar mais". As ações aparecem com o foco no aviso | `src/components/NotificationsPanel.tsx` |
| PTBR-04: Escape não fechava o painel | Escape fecha o painel aberto, de qualquer ponto; o X e o aviso que abre outra tela também fecham; o foco volta ao sino. Com o diálogo de exclusão aberto, o Escape é só do diálogo (ele o trata na captura e não o deixa passar) | `src/components/Header.tsx` |
| PTBR-05: Enter e Espaço alternavam duas vezes no seletor de período | Padrão de divulgação com botões nativos: o `keydown` não alterna mais (o clique nativo do botão basta); Escape fecha e devolve o foco; escolher um período fecha e devolve o foco; sair pelo Tab fecha. A lista deixa de se anunciar como `listbox`/`option` (não tinha a navegação por setas desse padrão): é um grupo "Períodos do relatório" de botões, com o atual em `aria-current` | `src/components/ReportPeriodSelect.tsx` |
| Problema do mesmo controle achado pelo axe: nome acessível do seletor sem o texto visível (WCAG 2.5.3) | O nome passa a ser "Período do relatório: <período visível>" (texto só para leitor de tela dentro do botão, sem `aria-label`) | `src/components/ReportPeriodSelect.tsx` |

Testes ajustados à mudança pedida (não enfraquecidos): a ordem do Tab dos dois testes de teclado das notificações
inclui agora o próprio aviso (`e2e/notifications-private-state.spec.ts`, `e2e/notifications-retention-d18.spec.ts`);
o seletor de período é localizado pelo nome novo e pelos botões do grupo (`e2e/financial-reports.spec.ts`); a
exceção em bloco de contraste do painel escuro saiu de `e2e/notifications-p5d2.spec.ts` (o painel e o cabeçalho do
escuro passaram a ser auditados sem exceção e passam).

## 2. Contraste medido (antes e depois)

Medido no painel real, com o CSS real do app (Tailwind do build), pela cor calculada (`getComputedStyle`) contra o
fundo efetivo (camadas compostas), depois do fim das animações (`e2e/a11y-keyboard-p5gate.spec.ts`, teste PTBR-02;
"antes" com o `NotificationsPanel.tsx` anterior, na cópia `E2m` de `prova-vermelha-2.py`). Cores do espaço: a padrão do
PF (`#4f46e5`) e do PJ (`#0f766e`) nos dois temas e, só no escuro, a do tema escuro padrão (`#6366f1`). O fundo medido
do painel escuro é `rgb(30, 41, 59)`. "Anel" é o contraste do anel de foco contra o mesmo fundo (WCAG 1.4.11, mínimo
3:1); antes não havia anel próprio (só o contorno padrão do navegador, não medido por esta sonda).

"Carregando…" é o botão desativado durante a carga (`disabled:opacity-60`): componente inativo, fora do critério 1.4.3;
medido e registrado.

| Tema | Cor do espaço | Controle | Estado | Antes | Depois | Anel depois |
| --- | --- | --- | --- | --- | --- | --- |
| escuro | espaço PF | Carregar mais | normal | 2,33 | 5,24 | — |
| escuro | espaço PF | Carregar mais | hover | 2,33 | 5,24 | — |
| escuro | espaço PF | Carregar mais | foco (teclado) | 2,33 | 5,24 | 5,24 |
| escuro | espaço PF | Carregar mais | pressionado | 2,33 | 5,24 | 5,24 |
| escuro | espaço PF | Tentar novamente | normal | 2,33 | 5,24 | — |
| escuro | espaço PF | Tentar novamente | hover | 2,33 | 5,24 | — |
| escuro | espaço PF | Tentar novamente | foco (teclado) | 2,33 | 5,24 | 5,24 |
| escuro | espaço PF | Tentar novamente | pressionado | 2,33 | 5,24 | 5,24 |
| escuro | espaço PF | Carregando… | normal | 1,61 | 2,82 | — |
| escuro | espaço PF | Marcar exibidas como lidas | normal | 2,33 | 5,24 | — |
| escuro | espaço PF | chip de não lidas | normal | 2,33 | 5,24 | — |
| escuro | espaço PF | rótulo de ação | normal | 2,33 | 5,24 | — |
| escuro | espaço PJ | Carregar mais | normal | 2,67 | 5,71 | — |
| escuro | espaço PJ | Carregar mais | hover | 2,67 | 5,71 | — |
| escuro | espaço PJ | Carregar mais | foco (teclado) | 2,67 | 5,71 | 5,71 |
| escuro | espaço PJ | Carregar mais | pressionado | 2,67 | 5,71 | 5,71 |
| escuro | espaço PJ | Tentar novamente | normal | 2,67 | 5,71 | — |
| escuro | espaço PJ | Tentar novamente | hover | 2,67 | 5,71 | — |
| escuro | espaço PJ | Tentar novamente | foco (teclado) | 2,67 | 5,71 | 5,71 |
| escuro | espaço PJ | Tentar novamente | pressionado | 2,67 | 5,71 | 5,71 |
| escuro | espaço PJ | Carregando… | normal | 1,77 | 3,00 | — |
| escuro | espaço PJ | Marcar exibidas como lidas | normal | 2,67 | 5,71 | — |
| escuro | espaço PJ | chip de não lidas | normal | 2,67 | 5,71 | — |
| escuro | espaço PJ | rótulo de ação | normal | 2,67 | 5,71 | — |
| escuro | tema escuro padrão | Carregar mais | normal | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | Carregar mais | hover | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | Carregar mais | foco (teclado) | 3,27 | 6,35 | 6,35 |
| escuro | tema escuro padrão | Carregar mais | pressionado | 3,27 | 6,35 | 6,35 |
| escuro | tema escuro padrão | Tentar novamente | normal | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | Tentar novamente | hover | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | Tentar novamente | foco (teclado) | 3,27 | 6,35 | 6,35 |
| escuro | tema escuro padrão | Tentar novamente | pressionado | 3,27 | 6,35 | 6,35 |
| escuro | tema escuro padrão | Carregando… | normal | 2,03 | 3,25 | — |
| escuro | tema escuro padrão | Marcar exibidas como lidas | normal | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | chip de não lidas | normal | 3,27 | 6,35 | — |
| escuro | tema escuro padrão | rótulo de ação | normal | 3,27 | 6,35 | — |
| claro | espaço PF | Carregar mais | normal | 6,29 | 6,29 | — |
| claro | espaço PF | Carregar mais | hover | 6,29 | 6,29 | — |
| claro | espaço PF | Carregar mais | foco (teclado) | 6,29 | 6,29 | 6,29 |
| claro | espaço PF | Carregar mais | pressionado | 6,29 | 6,29 | 6,29 |
| claro | espaço PF | Tentar novamente | normal | 6,29 | 6,29 | — |
| claro | espaço PF | Tentar novamente | hover | 6,29 | 6,29 | — |
| claro | espaço PF | Tentar novamente | foco (teclado) | 6,29 | 6,29 | 6,29 |
| claro | espaço PF | Tentar novamente | pressionado | 6,29 | 6,29 | 6,29 |
| claro | espaço PF | Carregando… | normal | 2,79 | 2,79 | — |
| claro | espaço PF | Marcar exibidas como lidas | normal | 6,29 | 6,29 | — |
| claro | espaço PF | chip de não lidas | normal | 6,29 | 6,29 | — |
| claro | espaço PF | rótulo de ação | normal | 6,29 | 6,29 | — |
| claro | espaço PJ | Carregar mais | normal | 5,47 | 5,47 | — |
| claro | espaço PJ | Carregar mais | hover | 5,47 | 5,47 | — |
| claro | espaço PJ | Carregar mais | foco (teclado) | 5,47 | 5,47 | 5,47 |
| claro | espaço PJ | Carregar mais | pressionado | 5,47 | 5,47 | 5,47 |
| claro | espaço PJ | Tentar novamente | normal | 5,47 | 5,47 | — |
| claro | espaço PJ | Tentar novamente | hover | 5,47 | 5,47 | — |
| claro | espaço PJ | Tentar novamente | foco (teclado) | 5,47 | 5,47 | 5,47 |
| claro | espaço PJ | Tentar novamente | pressionado | 5,47 | 5,47 | 5,47 |
| claro | espaço PJ | Carregando… | normal | 2,56 | 2,56 | — |
| claro | espaço PJ | Marcar exibidas como lidas | normal | 5,47 | 5,47 | — |
| claro | espaço PJ | chip de não lidas | normal | 5,47 | 5,47 | — |
| claro | espaço PJ | rótulo de ação | normal | 5,47 | 5,47 | — |

## 3. Testes

| Correção | Teste | Prova vermelha (árvore anterior) |
| --- | --- | --- |
| PTBR-02 | `e2e/a11y-keyboard-p5gate.spec.ts` (PTBR-02): ≥ 4,5:1 nos 4 estados, anel ≥ 3:1, axe sem exceção no painel pronto e no de erro, nos dois temas; `e2e/notifications-p5d2.spec.ts` F (escuro, desktop e celular) sem a exceção de contraste | E2 (reprovou) |
| PTBR-03 | `a11y-keyboard-p5gate.spec.ts` (PTBR-03): ordem do Tab, foco visível, Enter e Espaço uma vez cada, as ações não acionam o aviso, o clique continua valendo | E2 (reprovou) |
| PTBR-04 | `a11y-keyboard-p5gate.spec.ts` (PTBR-04), no app com Emulator: Escape com foco no sino e dentro do painel, X pelo teclado, diálogo de exclusão, aviso com destino marcado como lido no Firestore | E2 (reprovou) |
| PTBR-05 | `a11y-keyboard-p5gate.spec.ts` (PTBR-05): Enter e Espaço abrem uma vez, Escape, `aria-controls`, `aria-current`, Tab até o período, Enter escolhe (pedido do relatório com o período), foco de volta, sair pelo Tab fecha, axe sem exceção | E2 (reprovou) |
| Sem regressão | `notifications-p5d2`, `notifications-private-state`, `notifications-retention-d18`, `notifications-mobile-p5e11`, `notifications-exit-race`, `financial-reports` (57 testes: 55 passaram e os 2 de ordem do Tab reprovaram pela mudança pedida; ajustados, 16/16 nos dois arquivos) e o `verify:all` oficial | — |

## 4. Fora desta correção (destino registrado)

- Badge numérico do sino (branco sobre `bg-red-500`) e títulos de "Condições do período" no tema claro: PTBR-06, P9.
- `<select>` de "Transações Recentes" sem nome acessível (V-08) e rótulo do seletor de mês do Header (2.5.3): P9.
- Cor do espaço escolhida livremente em Configurações: o contraste só é garantido para as cores padrão; uma cor
  personalizada muito escura ou muito clara pode ficar abaixo de AA em qualquer texto na cor do espaço (débito do
  produto inteiro, anterior à P5): P9.

## 5. 2ª revisão (PTBR2-01 a PTBR2-07)

Achados da 2ª rodada de revisões (árvore `201749e8`, parecer de pt-BR com veredito `FAIL`), corrigidos depois dela. Os
mesmos critérios e a mesma regra de "problemas diretamente relacionados nos mesmos componentes". A revisão focada nestas
correções (3ª rodada) veio depois da execução oficial `verify-all-p5gate-4` (saída 0): `PASS` no código e na interface,
com o PTBR3-01 (documental) registrado no plano §20.21; **gate final `FAIL` só pelo E-00 externo (rodada 2); nenhum bloqueio de código.**

| Achado | Antes | Correção | Arquivo |
| --- | --- | --- | --- |
| PTBR2-01 | No escuro, o anel de foco de "Arquivar para mim" e "Excluir para mim" (P5-D1) usava `ring-primary`: PF 2,33, PJ 2,67, tema escuro padrão 3,27 (mínimo 3:1, WCAG 1.4.11) | Os dois botões usam o anel do painel (`FOCUS_RING`, com `dark:focus-visible:ring-primary-on-dark`): escuro PF 2,33 → 5,24, PJ 2,67 → 5,71, tema escuro padrão 3,27 → 6,35. Claro sem mudança (6,29 e 5,47) | `src/components/NotificationsPanel.tsx:264,275` |
| PTBR2-02 | Nenhuma opção do seletor de período mostrava anel de foco, e o foco da opção selecionada tinha o mesmo estilo da seleção (foco invisível; WCAG 2.4.7) | Cada opção com foco tem anel de 2 px por dentro (`focus-visible:ring-2 focus-visible:ring-inset`, 5,24 ou mais nos dois temas); o estado normal não mudou | `src/components/ReportPeriodSelect.tsx:116-127` |
| PTBR2-03 | No escuro, o texto em destaque do seletor (período selecionado, opção com foco ou hover, rótulo do botão aberto) tinha 2,33 (PF) e 2,67 (PJ), e o anel do botão 2,99 (PF) | O destaque no escuro usa `primary-on-dark` (5,24 ou mais) e o anel do botão no escuro usa `dark:focus-visible:ring-primary-on-dark` (6,75 no PF, 7,36 no PJ, 8,17 no tema escuro padrão) | `src/components/ReportPeriodSelect.tsx:71-89,118-124` |
| PTBR2-04 | A legenda do widget dizia "estas 9" mesmo com menos de 9 linhas | "Mostra até as 9 mais recentes dos últimos 12 meses. Ordenar por coluna reorganiza só as exibidas." (vale com menos de 9 e em qualquer estado) | `src/components/RecentTransactions.tsx:122` |
| PTBR2-05 | Ao trocar o filtro, a tabela do widget ficava vazia até a consulta voltar | Linha com `role="status"`: "Carregando transações recentes…" | `src/components/RecentTransactions.tsx:196` |
| PTBR2-07 | Nos navegadores em que o clique não foca o botão, um clique de mouse numa opção, com a lista aberta pelo teclado, fechava a lista antes do clique e o período se perdia (inferido do comportamento conhecido do WebKit e do Firefox; a matriz E2E é só Chromium) | `onMouseDown` com `preventDefault` em cada opção: o `mousedown` não move o foco | `src/components/ReportPeriodSelect.tsx:108` |

**Resumo dos valores.** Menor texto medido: 2,33 → 5,24. Menor anel de foco: 2,33 → 5,24. No claro nenhum texto mudou;
só o anel nas opções com foco do seletor (os valores do claro nas ações "Arquivar para mim" e "Excluir para mim" são os
de antes). A medição usa o CSS real do app e o fundo efetivo, como na §2; o fundo do painel escuro é `rgb(30, 41, 59)`.

**O foco mudou nos dois temas (PTBR2-10).** No claro, só o anel: nas opções com foco do seletor (novo), no título do
aviso e nos controles da §1, onde o contorno do navegador virou um anel de 2 px. As ações do aviso ("Arquivar para mim"
e "Excluir para mim") já tinham anel desde a P5-D1, e no claro ele não mudou (6,29 e 5,47); no escuro, passaram à cor de
foco do painel. No escuro, também a cor do destaque do seletor (de `text-primary` para `primary-on-dark`). O estado
normal do tema claro não mudou. A frase "sem mudança no tema claro" vale para cor e layout do estado normal, não para o
estado de foco.

### Tabela completa (75 medições, antes e depois)

Fonte: `p5gate/evidencia-rascunho/tabela-contraste-ptbr2.md` (rascunho de trabalho; a tabela está copiada aqui). "(ícone)"
é um botão só com ícone: não tem texto, só o anel. "Anel" é o contraste do anel de foco contra o fundo efetivo (mínimo
3:1); no botão do seletor, contra o recuo. O texto do botão do seletor fechado não muda (13,29 no escuro e 14,68 no
claro: é texto comum).

| Tema | Cor do espaço | Controle | Estado | Texto antes | Texto depois | Anel antes | Anel depois |
| --- | --- | --- | --- | --- | --- | --- | --- |
| escuro | espaço PF | Arquivar para mim | foco (teclado) | (ícone) | (ícone) | 2,33 | 5,24 |
| escuro | espaço PF | Excluir para mim | foco (teclado) | (ícone) | (ícone) | 2,33 | 5,24 |
| escuro | espaço PJ | Arquivar para mim | foco (teclado) | (ícone) | (ícone) | 2,67 | 5,71 |
| escuro | espaço PJ | Excluir para mim | foco (teclado) | (ícone) | (ícone) | 2,67 | 5,71 |
| escuro | tema escuro padrão | Arquivar para mim | foco (teclado) | (ícone) | (ícone) | 3,27 | 6,35 |
| escuro | tema escuro padrão | Excluir para mim | foco (teclado) | (ícone) | (ícone) | 3,27 | 6,35 |
| claro | espaço PF | Arquivar para mim | foco (teclado) | (ícone) | (ícone) | 6,29 | 6,29 |
| claro | espaço PF | Excluir para mim | foco (teclado) | (ícone) | (ícone) | 6,29 | 6,29 |
| claro | espaço PJ | Arquivar para mim | foco (teclado) | (ícone) | (ícone) | 5,47 | 5,47 |
| claro | espaço PJ | Excluir para mim | foco (teclado) | (ícone) | (ícone) | 5,47 | 5,47 |
| escuro | espaço PF | botão do seletor | normal | 13,29 | 13,29 | — | — |
| escuro | espaço PF | botão do seletor | hover | 13,29 | 13,29 | — | — |
| escuro | espaço PF | botão do seletor | foco (teclado) | 13,29 | 13,29 | 2,99 | 6,75 |
| escuro | espaço PF | botão do seletor | pressionado | 13,29 | 13,29 | 2,99 | 6,75 |
| escuro | espaço PF | botão do seletor | aberto | 2,33 | 5,24 | 2,99 | 6,75 |
| escuro | espaço PF | opção selecionada | normal | 2,33 | 5,24 | — | — |
| escuro | espaço PF | opção selecionada | foco (teclado) | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PF | opção selecionada | hover | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PF | opção selecionada | pressionado | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PF | opção comum | normal | 13,29 | 13,29 | — | — |
| escuro | espaço PF | opção comum | foco (teclado) | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PF | opção comum | hover | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PF | opção comum | pressionado | 2,33 | 5,24 | — | 5,24 |
| escuro | espaço PJ | botão do seletor | normal | 13,29 | 13,29 | — | — |
| escuro | espaço PJ | botão do seletor | hover | 13,29 | 13,29 | — | — |
| escuro | espaço PJ | botão do seletor | foco (teclado) | 13,29 | 13,29 | 3,44 | 7,36 |
| escuro | espaço PJ | botão do seletor | pressionado | 13,29 | 13,29 | 3,44 | 7,36 |
| escuro | espaço PJ | botão do seletor | aberto | 2,67 | 5,71 | 3,44 | 7,36 |
| escuro | espaço PJ | opção selecionada | normal | 2,67 | 5,71 | — | — |
| escuro | espaço PJ | opção selecionada | foco (teclado) | 2,67 | 5,71 | — | 5,71 |
| escuro | espaço PJ | opção selecionada | hover | 2,67 | 5,71 | — | 5,71 |
| escuro | espaço PJ | opção selecionada | pressionado | 2,67 | 5,71 | — | 5,71 |
| escuro | espaço PJ | opção comum | normal | 13,29 | 13,29 | — | — |
| escuro | espaço PJ | opção comum | foco (teclado) | 2,67 | 5,71 | — | 5,71 |
| escuro | espaço PJ | opção comum | hover | 2,67 | 5,71 | — | 5,71 |
| escuro | espaço PJ | opção comum | pressionado | 2,67 | 5,71 | — | 5,71 |
| escuro | tema escuro padrão | botão do seletor | normal | 13,29 | 13,29 | — | — |
| escuro | tema escuro padrão | botão do seletor | hover | 13,29 | 13,29 | — | — |
| escuro | tema escuro padrão | botão do seletor | foco (teclado) | 13,29 | 13,29 | 4,22 | 8,17 |
| escuro | tema escuro padrão | botão do seletor | pressionado | 13,29 | 13,29 | 4,22 | 8,17 |
| escuro | tema escuro padrão | botão do seletor | aberto | 3,27 | 6,35 | 4,22 | 8,17 |
| escuro | tema escuro padrão | opção selecionada | normal | 3,27 | 6,35 | — | — |
| escuro | tema escuro padrão | opção selecionada | foco (teclado) | 3,27 | 6,35 | — | 6,35 |
| escuro | tema escuro padrão | opção selecionada | hover | 3,27 | 6,35 | — | 6,35 |
| escuro | tema escuro padrão | opção selecionada | pressionado | 3,27 | 6,35 | — | 6,35 |
| escuro | tema escuro padrão | opção comum | normal | 13,29 | 13,29 | — | — |
| escuro | tema escuro padrão | opção comum | foco (teclado) | 3,27 | 6,35 | — | 6,35 |
| escuro | tema escuro padrão | opção comum | hover | 3,27 | 6,35 | — | 6,35 |
| escuro | tema escuro padrão | opção comum | pressionado | 3,27 | 6,35 | — | 6,35 |
| claro | espaço PF | botão do seletor | normal | 14,68 | 14,68 | — | — |
| claro | espaço PF | botão do seletor | hover | 14,68 | 14,68 | — | — |
| claro | espaço PF | botão do seletor | foco (teclado) | 14,68 | 14,68 | 6,02 | 6,02 |
| claro | espaço PF | botão do seletor | pressionado | 14,68 | 14,68 | 6,02 | 6,02 |
| claro | espaço PF | botão do seletor | aberto | 6,29 | 6,29 | 6,02 | 6,02 |
| claro | espaço PF | opção selecionada | normal | 6,29 | 6,29 | — | — |
| claro | espaço PF | opção selecionada | foco (teclado) | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PF | opção selecionada | hover | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PF | opção selecionada | pressionado | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PF | opção comum | normal | 14,68 | 14,68 | — | — |
| claro | espaço PF | opção comum | foco (teclado) | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PF | opção comum | hover | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PF | opção comum | pressionado | 6,29 | 6,29 | — | 6,29 |
| claro | espaço PJ | botão do seletor | normal | 14,68 | 14,68 | — | — |
| claro | espaço PJ | botão do seletor | hover | 14,68 | 14,68 | — | — |
| claro | espaço PJ | botão do seletor | foco (teclado) | 14,68 | 14,68 | 5,24 | 5,24 |
| claro | espaço PJ | botão do seletor | pressionado | 14,68 | 14,68 | 5,24 | 5,24 |
| claro | espaço PJ | botão do seletor | aberto | 5,47 | 5,47 | 5,24 | 5,24 |
| claro | espaço PJ | opção selecionada | normal | 5,47 | 5,47 | — | — |
| claro | espaço PJ | opção selecionada | foco (teclado) | 5,47 | 5,47 | — | 5,47 |
| claro | espaço PJ | opção selecionada | hover | 5,47 | 5,47 | — | 5,47 |
| claro | espaço PJ | opção selecionada | pressionado | 5,47 | 5,47 | — | 5,47 |
| claro | espaço PJ | opção comum | normal | 14,68 | 14,68 | — | — |
| claro | espaço PJ | opção comum | foco (teclado) | 5,47 | 5,47 | — | 5,47 |
| claro | espaço PJ | opção comum | hover | 5,47 | 5,47 | — | 5,47 |
| claro | espaço PJ | opção comum | pressionado | 5,47 | 5,47 | — | 5,47 |

### Testes e provas

| Correção | Teste | Prova vermelha |
| --- | --- | --- |
| PTBR2-01 | `e2e/a11y-keyboard-p5gate.spec.ts:318`: o anel de foco das duas ações mede 3:1 ou mais, nos dois temas e nas três cores | Vermelho na árvore anterior (`p5gate/logs/ptbr2-antes.log`) |
| PTBR2-02 e PTBR2-03 | `a11y-keyboard-p5gate.spec.ts:348`, na página própria `e2e/support/reportPeriodSelectA11yHarness.tsx` (o seletor real com o CSS do app): foco visível em toda opção, inclusive a selecionada; contraste AA no escuro e no claro, em normal, hover, foco e pressionado | Vermelho na árvore anterior (`ptbr2-antes.log`) |
| PTBR2-07 | `a11y-keyboard-p5gate.spec.ts:417`: abrir pelo teclado e escolher o período com um clique de mouse | Vermelho na árvore anterior (`ptbr2-antes.log`) |
| PTBR2-04 e PTBR2-05 | Guarda de unidade `tests/unit/transactions-reads.test.ts:302` (legenda, estado de carregando, falha, teto) e o E2E `e2e/transactions-reads-p5gate.spec.ts` | Guarda e E2E ajustados à legenda nova |

Na árvore anterior, os 3 testes novos de acessibilidade reprovaram (`ptbr2-antes.log`: 3 reprovados). Na execução oficial
da árvore de código final (`verify-all-p5gate-4`, saída 0), os 7 testes de acessibilidade passaram.

### Registrados com destino (não corrigidos aqui)

- **PTBR2-06 (P9):** o rótulo do sino não contém o texto visível (WCAG 2.5.3); o E2E o aceita como débito conhecido
  (`e2e/notifications-p5d2.spec.ts`, `LABEL_IN_NAME_DEBT`), ao lado do rótulo do seletor de mês do Header (§4).
- **PTBR2-08 a PTBR2-12 (INFO, P9):** o foco volta ao sino também depois de um fechamento pelo mouse, e o sino usa `focus:ring`
  (o anel aparece depois do clique); a descrição acessível do título do aviso não inclui o destino ("Ver cartões →"); a prova
  vermelha E2 reverte três arquivos juntos (mutantes isolados no próximo ciclo); o aviso de teto do widget filtrado por
  "Investimentos" manda à "lista completa em Receitas ou Despesas", onde não há investimentos (exige mais de 91 anuladas
  entre as 100 mais recentes).
- **Cobertura de navegadores:** a matriz E2E é só Chromium; o foco no Safari e no Firefox fica sem prova até o P10.
