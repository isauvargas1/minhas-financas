# Evidência visual — P5-B, Metas (2026-10-09)

Capturas de Metas no build E2E contra o Emulator (`minhas-financas-local`), com o mesmo roteiro e os mesmos valores na base (árvore auditada da P5-D1) e na árvore da P5-B. As metas são semeadas pelo Admin SDK na forma de cada árvore: na base, com `targetAmount`/`currentAmount` e o progresso patrimonial; na P5-B, com `progressSource`, centavos, `priorityRank`, `archived` e `revision`. O caso PJ usa um recebimento confirmado do mês (entregue pelo gatilho real à projeção mensal) e o saldo da conta com o mesmo valor; a base calculava os indicadores no navegador, a P5-B no servidor.

- **Telas** (desktop 1440×900 e celular 390×844, claro e escuro): `vazio`; `lista` (três metas de investimentos: 45%, 0% e 100%); `detalhe` (meta a 45%); `formulario` (nova meta); `paginacao-topo` e `paginacao-fim` (30 metas); `pj-lista` (recebimentos do mês e saldo em contas). Só na P5-B: `paginacao-carregada` (depois de "Carregar mais metas").
- **Comparação:** `diferencas-pixels.txt` — base × P5-B por captura (limiar 48 por pixel). Layout, cores, ícones, cartões, formulário e estados vazios iguais. Diferenças, todas exigidas pelo contrato da P5-B:
  - contadores do servidor (`getGoalsOverview`): "Em andamento 3 / Concluídas 0" em vez de "2 / 1" — a base contava como concluída a meta que só atingiu o alvo;
  - selo "ALVO ATINGIDO" (progresso ≥ alvo) separado de "CONCLUÍDA" (status `alcancada`);
  - datas civis corretas ("Até 31/12/2026", "Início: 01/01/2026"; a base mostrava um dia antes, por leitura em UTC);
  - percentual pt-BR no detalhe ("45,00%" em vez de "45.0%"); nos cartões o percentual é truncado (24%, não 25%), para nunca exibir 100% antes de atingir o alvo;
  - rótulos dos indicadores PJ ("Recebimentos operacionais realizados", "Saldo disponível em contas" em vez de "faturamento"/"caixa minimo");
  - paginação: a base mostra as 30 metas; a P5-B mostra 25 e o botão "Carregar mais metas" (23–45% de diferença no fim da lista, onde as metas mudam de posição).
  - O confete das metas com alvo atingido é aleatório e aparece como ruído em algumas capturas.
- **Medições:** `antes-relatorio.json` e `depois-relatorio.json`:
  - rolagem horizontal 0 em todas as capturas, nas duas árvores;
  - axe-core (WCAG 2.0/2.1 A e AA): formulário de 17 violações (`button-name` 8, `label` 6, `select-name` 3) para 0; detalhe sem a violação `button-name`; lista, detalhe e PJ mantêm as mesmas violações de `color-contrast` da base (paleta existente, fora do escopo).

Arquivos:

- `antes/` — 28 capturas da base;
- `depois/` — 32 capturas da P5-B (as 28 do mesmo roteiro e as 4 de `paginacao-carregada`).

O arquivo de captura (`p5b-evidence.spec.ts`, fora da suíte) foi executado nas duas árvores e removido.
