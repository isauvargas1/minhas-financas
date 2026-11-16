# Revisão da estabilidade do processo — P5-F.1-R3.2 (Frente B, RR-R31-07 e RR-R31-08)

Leia antes `<scratchpad>/p5f1r32/revisoes/COMUM.md` (instruções comuns, obrigatórias). Sua pasta: `<scratchpad>/p5f1r32/revisoes/estabilidade`.

Primeira linha do parecer: `VEREDITO: PASS` ou `VEREDITO: FAIL`. Inclua, numa seção própria, o veredito da skill
`firebase-production-readiness` (leia `<scratchpad>/wt-p5f1-r32/.claude/skills/firebase-production-readiness/SKILL.md` e a referência),
no escopo do que a etapa toca (Emulator, `playwright.config.ts`, CI, versão do firebase-tools), começando com
`PASS — Firebase production readiness` ou `FAIL — Firebase production readiness`, com a seção "Fora do escopo".

Confira, com evidência:
1. Causas do RR-R31-07: (a) a JVM do emulador do Firestore órfã depois do Playwright (o Playwright 1.60 sem
   `gracefulShutdown` encerra o grupo com SIGKILL; o firebase-tools sobe o Firestore como processo destacado) e a
   correção com `gracefulShutdown: { signal: 'SIGTERM', timeout: 60_000 }` (veja nos `.meta` dos E2E da R3.2 a linha
   `limpeza_externa=nenhuma`); confira no código instalado do Playwright (`<scratchpad>/wt-p5f1-r32/node_modules/playwright*/`) e do
   firebase-tools (`/opt/node22/lib/node_modules/firebase-tools/`); (b) a memória do emulador de Functions (um processo
   por função, sem encerrar os ociosos) e o isolamento por grupos.
2. O fluxo oficial: `npm run test:e2e` → `tools/e2e/executar-em-grupos.mjs` (grupos `--shard=i/N`, um Emulator por
   grupo, espera das portas sem encerrar processo, logs do Emulator por grupo, conferência de que cada teste da
   lista rodou uma vez, numa tentativa, e passou); `verify:all` termina nele; o CI roda `npm run test:e2e` e os
   testes do executor; firebase-tools fixado em 15.32.1.
3. As exigências do pedido: todos os testes preservados, mesmas asserções, mesmo ambiente lógico, nenhum teste
   ignorado, nenhuma repetição automática (`retries: 0` também no CI, `forbidOnly`), nenhum aumento de prazo, nenhuma
   regra de negócio alterada, nenhuma conexão com produção. Compare `playwright.config.ts`, `package.json` e o CI com
   a R3.1.
4. RR-R31-08 (keep-alive): leia os scripts e os resultados E1, E1b, E2, E3a (fases timers e check), E3b, E3c, E3d,
   E3e e E3h em `<scratchpad>/p5f1r32/scripts/keepalive/` e `<scratchpad>/p5f1r32/logs/keepalive-*`. A conclusão do executor é: os
   ingredientes existem (o agente do Playwright 1.60 tem `keepAlive: true` sem `timeout` e ignora o aviso
   `Keep-Alive: timeout=5`; o servidor HTTP do Node 22 fecha a conexão ociosa em 5 s + 1 s de folga; o emulador real
   fecha em ~6,0 s), a corrida só se reproduziu num servidor Node puro com o laço ocupado na fase check (3/80, e 0/80
   com `Connection: close`), e não se reproduziu no emulador real em nenhuma variante; por isso a hipótese continua
   NÃO comprovada e nenhuma mudança de keep-alive foi aplicada. Avalie se os experimentos têm falhas de desenho, se a
   conclusão é sustentada e se deixar sem mitigação é razoável (ou se falta algo para o gate).
5. Memória e processos da execução oficial, se o `*-memoria.txt` dela já existir: picos por grupo, número de processos
   `node`/`java`, portas livres entre grupos.
