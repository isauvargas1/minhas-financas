# Gate da etapa P5-F.1-R3.2 — `regression-release-gate`

Você executa o gate de regressão da etapa P5-F.1-R3.2 do projeto minhas-financas, em português brasileiro. Este gate
valida; não corrige. Sua pasta: `<scratchpad>/p5f1r32/revisoes/gate`.

## Leia antes

1. A skill inteira: `<scratchpad>/wt-p5f1-r32/.claude/skills/regression-release-gate/SKILL.md` e `references/release-checklist.md`.
2. O pedido do usuário: `<scratchpad>/p5f1r32/relatorio/pedido-r32.md` (critério de encerramento no fim).
3. As instruções comuns das revisões: `<scratchpad>/p5f1r32/revisoes/COMUM.md` (árvores, evidências e regras; o que ali proíbe
   rodar Emulator/E2E/verify NÃO vale para você: o gate exige a própria execução, descrita abaixo).
4. A evidência e o relatório do executor: `<scratchpad>/wt-p5f1-r32/docs/production/evidence/p5f1-r32/` (comece pelo `LEIAME.md`), o plano
   mestre `<scratchpad>/wt-p5f1-r32/docs/production/PRODUCTION_READINESS_PLAN.md` §20.20 e `<scratchpad>/p5f1r32/relatorio/RELATORIO-P5F1-R32.md`.

## O que validar

- Base: árvore da R3.1 `efcbd2645b8e7b08b5add2812f6b319f4a76369b` (commit-base do worktree: HEAD `1730a1df`, nada commitado
  desde então; o índice real é o HEAD e não deve ser alterado). Estado final: a árvore do diretório de trabalho de `<scratchpad>/wt-p5f1-r32`
  no momento da sua execução (calcule com `bash <scratchpad>/p5f1r32/tree-now.sh`, que usa um índice temporário).
- Árvore de código final do executor: `5ea7fabee02c3ae4ca79400f416ce9e67e425ec7`; da sua árvore final a ela, só `docs/` pode diferir.
- Vereditos de domínio exigidos pela superfície tocada, todos sobre o estado final, nos pareceres em
  `<scratchpad>/p5f1r32/revisoes/{financeiro,adversarial,estabilidade,ptbr}/PARECER.md` (rodada 1) e
  `…/rodada-2/`, `…/rodada-3/` e `…/rodada-4/PARECER.md`, e na estabilidade também `…/rodada-5/` e `…/rodada-6/PARECER.md`.
  A rodada 4 é focada na mudança de `ef514869` para `698f9644`. De `698f9644` para a árvore de código final só mudaram
  um ajudante de `tests/tools/e2e-grupos.test.mjs` e uma linha de `docs/production/DATA_MODEL.md`: a rodada 5 da
  estabilidade (interina, na `b2b15267`) e a rodada 6 (na árvore de código final, com a execução oficial
  `verify-all-r32-9`) cobrem essa mudança. Confira você mesmo se o veredito de cada área cobre o estado final:
  `financial-domain-integrity`,
  `firestore-scale-cost-review`, `firebase-production-readiness` (no escopo da etapa) e `ptbr-product-ui-review`.
  Confira as respostas do executor a cada achado em `<scratchpad>/wt-p5f1-r32/docs/production/evidence/p5f1-r32/revisoes/LEIAME.md`.
  Justifique por que `multi-tenant-security-review`, `billing-entitlement-integrity`, `privacy-lgpd-data-lifecycle`,
  `observability-incident-readiness` e `saas-commercial-readiness` não se aplicam, se for o caso, pelo diff.
- Enfraquecimento: testes removidos, ignorados, `skip`/`only`, asserções relaxadas, prazos aumentados, nova tentativa,
  tipos, Rules ou validações afrouxados (compare com a R3.1; a lista dos reescritos está em `testes-substituidos.md`).
- O critério do pedido: nenhuma conversão sem comprovação financeira válida, nenhum bloqueador material aberto e
  `verify:all` aprovado pelo procedimento oficial (uma execução, saída 0).

## O que o executor já rodou (confira; não substitui a sua execução)

- `verify:all` oficial na árvore de código final: `verify-all-r32-9` (`logs/verify-all-r32-9.log`, `.log.meta`,
  `-memoria.txt` e `verify-all-r32-9-artefatos/`). A `verify-all-r32-8`, na mesma árvore, reprovou pelo falso positivo
  de um teste do backend anterior à etapa (RR-R32-12); confira a causa e o critério registrados no plano (§20.20).
- Mutantes finais e prova vermelha de unidade na árvore de código final: `logs/mutantes-finais.meta`,
  `logs/mutantes-*-final*.log`, `logs/mutantes-cliente-r3*-na-r32.log` e `logs/red-r32-na-r31-3.json`/`.log`;
  resumo em `evidence/p5f1-r32/mutantes.md` e `testes-e-resultados.md`.

## A sua execução (obrigatória)

Rode o procedimento oficial uma vez, na árvore final, com o roteiro do executor (ambiente deste contêiner: o
loopback-proxy para o firebase-tools e o navegador do Playwright 1.60), sem nada rodando nas portas do Emulator:

```
bash <scratchpad>/p5f1r32/run-oficial.sh gate-verify-all-r32 verify:all
```

Os logs ficam em `<scratchpad>/p5f1r32/logs/gate-verify-all-r32.log`, `.log.meta` (árvore, saída, duração, portas e JVM no fim) e
`gate-verify-all-r32-memoria.txt`. Leva uns 50 minutos (a `verify-all-r32-9` levou 2.871 s). Não rode outra coisa pesada em paralelo. Uma execução que
falhar fica no histórico; não a repita para "ver se passa" sem registrar a causa.

## Regras

- Não altere código, testes, configuração nem documentos em `<scratchpad>/wt-p5f1-r32`; os artefatos de build e de teste que o
  `verify:all` gera (dist/, functions/lib, test-results/, playwright-report/) são esperados e ignorados pelo git.
- Nunca acesse o Firebase de produção nem leia segredos. Nada de commit, push ou deploy.

## Saída

`<scratchpad>/p5f1r32/revisoes/gate/PARECER-RODADA-1.md`, no formato de relatório que o checklist da skill prescreve, com o
veredito `PASS` ou `FAIL` e as evidências por etapa. Na mensagem final, devolva só o veredito, a lista curta de
achados e o caminho do parecer.
