# Evidência visual — P5-B.1, complementação de Metas (2026-10-09)

Capturas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos dados na árvore auditada da P5-B (`bf70a089`, "antes") e na P5-B.1 ("depois"). As metas são semeadas pelo Admin SDK no formato persistido da P5-B (o contrato não mudou): uma meta manual PJ com centro de custo "Operações", um indicador PJ (faturamento, mensal) com centro de custo "Comercial" e 130 metas de investimento ativas no workspace PF.

- **Telas** (desktop 1440×900 e celular 390×844, claro e escuro): `pj-lista`; `pj-formulario` (nova meta empresarial); `pj-detalhe-manual` e `pj-detalhe-manual-atualizar` (painel "Atualizar valor acumulado" aberto); `pj-detalhe-indicador`; `investimentos` (tela de Investimentos); `investimento-seletor` (formulário "Novo investimento" aberto). Só na P5-B.1: `pj-formulario-manual` (objetivo "Valor informado" escolhido) e `investimento-seletor-101` (depois de quatro "Carregar mais metas", com a 101ª meta selecionada).
- **Comparação:** `diferencas-pixels.txt` — antes × depois por captura (limiar 48 por pixel).
  - Sem diferença: lista PJ e tela de Investimentos (0,00%).
  - Formulário PJ: um sétimo objetivo, "Valor informado", no mesmo grid e no mesmo estilo dos demais, e a nota do centro de custo abaixo do campo ("Informativo: não filtra os indicadores automáticos, que usam os valores gerais da empresa."). Com "Valor informado", o período de apuração some e aparece "Valor já acumulado (R$)" (zero vale).
  - Detalhe da meta manual PJ: só o rótulo do centro de custo ("Centro de custo: Operações" em vez de "Operações"); o painel de atualização do valor é o mesmo da base.
  - Detalhe do indicador PJ: "Centro de custo: Comercial" e a nota "O centro de custo é informativo: este indicador usa os valores gerais da empresa, sem filtrar por centro de custo." — o conteúdo abaixo desce uma linha (por isso a porcentagem maior no celular escuro).
  - Seletor de metas de investimento: a base carregava 100 metas de uma vez (101 opções com "Sem meta") e parava — a 101ª não existia no seletor; a P5-B.1 mostra a 1ª página (25), a linha "Mostrando 25 metas; carregue mais para ver as demais." e o botão "Carregar mais metas". Os campos abaixo descem essa linha (a maior parte da diferença em pixels); o restante do formulário é igual.
- **Medições:** `antes-relatorio.json` e `depois-relatorio.json`:
  - rolagem horizontal 0 em todas as capturas, nas duas árvores;
  - objetivos no formulário PJ: 6 → 7; "Valor informado" indisponível na base;
  - opções do seletor: 101 (teto de 100, sem a 101ª) → 26 na abertura e 126 depois de quatro páginas, com a 101ª selecionada;
  - axe-core (WCAG 2.0/2.1 A e AA): formulário PJ 0 violação nas duas árvores e 0 com "Valor informado"; detalhe da meta manual com as mesmas violações de `color-contrast` da base (paleta existente, fora do escopo); no formulário de investimento, só os avisos âmbar de cadastro vazio, anteriores à P5-B.1.

Arquivos:

- `antes/` — 28 capturas da árvore auditada da P5-B;
- `depois/` — 36 capturas da P5-B.1 (as 28 do mesmo roteiro, 4 de `pj-formulario-manual` e 4 de `investimento-seletor-101`).

O arquivo de captura (`p5b1-evidence.spec.ts`, fora da suíte) foi executado nas duas árvores e removido.
